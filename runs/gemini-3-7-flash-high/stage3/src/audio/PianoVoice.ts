import { SampleLibrary } from './SampleLibrary';
import { midiToFrequency } from '../model/keyboard';

export type VoiceState = 'active' | 'sustained' | 'sostenuto' | 'releasing' | 'dead';

export interface PianoVoiceConfig {
  layerId: 'A' | 'B';
  typeIdx: number; // 0..5
  modelIdx: number; // 1..9
  octaveShift: number; // -2..+2
  kbTouch: number; // 0..3
  timbre: number; // 0..5
  dynComp: number; // 0..3
  unison: number; // 0..3
  softRelease: boolean;
  stringRes: boolean;
  sustainEnabled: boolean;
  pitchStickEnabled: boolean;
  softPedalActive: boolean;
}

export class PianoVoice {
  public readonly originalMidi: number;
  public readonly effectiveMidi: number;
  public readonly rawVelocity: number;
  public readonly effectiveVelocity: number;
  public readonly layerId: 'A' | 'B';
  public readonly startTime: number;
  public state: VoiceState = 'active';

  private ctx: AudioContext;
  private destination: AudioNode;
  private voiceGain: GainNode;
  private timbreFilter: BiquadFilterNode;
  private dynamicFilter: BiquadFilterNode;
  private stringResGain: GainNode | null = null;

  // Buffer sources (for recorded sample instruments)
  private bufferSources: AudioBufferSourceNode[] = [];
  // Oscillators (for synthesized instruments / unison / fallback)
  private oscillators: OscillatorNode[] = [];
  private oscGains: GainNode[] = [];

  private isCleanedUp = false;
  private onEndedCallback?: () => void;
  private config: PianoVoiceConfig;

  constructor(
    ctx: AudioContext,
    destination: AudioNode,
    sampleLibrary: SampleLibrary,
    midi: number,
    velocity: number,
    config: PianoVoiceConfig,
    isSustained: boolean,
    onEnded?: () => void
  ) {
    this.ctx = ctx;
    this.destination = destination;
    this.originalMidi = midi;
    this.effectiveMidi = Math.max(0, Math.min(127, midi + config.octaveShift * 12));
    this.rawVelocity = Math.max(0.01, Math.min(1.0, velocity));
    this.layerId = config.layerId;
    this.config = config;
    this.startTime = ctx.currentTime;
    this.onEndedCallback = onEnded;

    const now = ctx.currentTime;

    // 1. Calculate effective velocity through KB Touch curve (0=Linear, 1=Light, 2=Medium, 3=Heavy)
    let vel = this.rawVelocity;
    if (config.kbTouch === 1) {
      vel = Math.pow(vel, 0.65); // Light: softer hits produce louder velocity
    } else if (config.kbTouch === 2) {
      vel = Math.pow(vel, 0.82); // Medium: slight boost
    } else if (config.kbTouch === 3) {
      vel = Math.pow(vel, 1.35); // Heavy: firmer touch needed
    }

    // 2. Dyn Comp: raises the level of softer strokes, narrowing dynamic range
    if (config.dynComp > 0) {
      const compBoost = (config.dynComp * 0.18) * (1.0 - vel);
      vel = Math.min(1.0, vel + compBoost);
    }

    // Soft pedal (una corda) dampens velocity and attack
    if (config.softPedalActive) {
      vel *= 0.82;
    }

    this.effectiveVelocity = vel;

    // 3. Build Audio Node Graph
    this.voiceGain = ctx.createGain();
    this.timbreFilter = ctx.createBiquadFilter();
    this.dynamicFilter = ctx.createBiquadFilter();

    // Voice Gain Envelope
    const peakGain = Math.pow(vel, 1.3) * 0.32;
    const decayDuration = Math.max(1.8, 8.5 - (this.effectiveMidi - 28) * 0.08);

    this.voiceGain.gain.setValueAtTime(0.0001, now);
    this.voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakGain), now + 0.003);
    this.voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.00001, peakGain * 0.04), now + 0.003 + decayDuration);

    // Dynamic Filter (brightness increases with velocity)
    const baseFreq = midiToFrequency(this.effectiveMidi);
    this.dynamicFilter.type = 'lowpass';
    const cutoffBase = Math.min(18000, baseFreq * (2.2 + vel * 9.0) * (config.softPedalActive ? 0.75 : 1.0));
    this.dynamicFilter.frequency.setValueAtTime(cutoffBase, now);
    this.dynamicFilter.Q.setValueAtTime(1.0, now);

    // Timbre Filter EQ (Soft, Mid, Bright, Dyno 1, Dyno 2)
    this.configureTimbreFilter(config.timbre, config.typeIdx, now);

    // Connect node chain: voice generators -> dynamicFilter -> timbreFilter -> voiceGain -> destination
    this.dynamicFilter.connect(this.timbreFilter);
    this.timbreFilter.connect(this.voiceGain);
    this.voiceGain.connect(this.destination);

    // 4. String Resonance simulation
    if (config.stringRes && (isSustained || config.typeIdx === 0 || config.typeIdx === 1)) {
      this.setupStringResonance(baseFreq, vel, now);
    }

    // 5. Spawn sound sources (Sampled, Synthesized, or Fallback)
    const isRecordedSampleType = config.typeIdx >= 0 && config.typeIdx <= 2;
    const sample = isRecordedSampleType
      ? sampleLibrary.getSample(config.typeIdx, config.modelIdx, this.effectiveMidi, vel)
      : null;

    if (sample && !sampleLibrary.isFailureMode()) {
      // Play recorded multi-sample
      this.spawnSampleVoice(sample.entry.buffer, sample.pitchRatio, config.unison, now);
    } else if (config.typeIdx === 3) {
      // Clavinet physical synthesis
      this.spawnClavinetVoice(baseFreq, vel, config.unison, now);
    } else if (config.typeIdx === 4) {
      // Digital FM Piano synthesis
      this.spawnDigitalFmVoice(baseFreq, vel, config.modelIdx, config.unison, now);
    } else if (config.typeIdx === 5) {
      // Misc (Vibraphone / Marimba) physical synthesis
      this.spawnMiscMalletVoice(baseFreq, vel, config.modelIdx, config.unison, now);
    } else {
      // Labeled Playable Fallback Voice (acoustic grand additive synthesis)
      this.spawnFallbackVoice(baseFreq, vel, config.unison, now);
    }

    // Auto-cleanup timeout if note decays completely
    setTimeout(() => {
      if (!this.isCleanedUp && (this.state === 'dead' || this.state === 'releasing')) {
        this.cleanup();
      }
    }, (decayDuration + 1.0) * 1000);
  }

  private configureTimbreFilter(timbre: number, typeIdx: number, now: number): void {
    if (timbre === 1) {
      // Soft: high cut (-6dB shelf at 3500Hz)
      this.timbreFilter.type = 'highshelf';
      this.timbreFilter.frequency.setValueAtTime(3500, now);
      this.timbreFilter.gain.setValueAtTime(-6.5, now);
    } else if (timbre === 2) {
      // Mid: peaking boost at 1800Hz (+5dB)
      this.timbreFilter.type = 'peaking';
      this.timbreFilter.frequency.setValueAtTime(1800, now);
      this.timbreFilter.Q.setValueAtTime(1.4, now);
      this.timbreFilter.gain.setValueAtTime(5.5, now);
    } else if (timbre === 3) {
      // Bright: high shelf boost (+6dB at 3800Hz)
      this.timbreFilter.type = 'highshelf';
      this.timbreFilter.frequency.setValueAtTime(3800, now);
      this.timbreFilter.gain.setValueAtTime(6.0, now);
    } else if (timbre === 4 && typeIdx === 2) {
      // Dyno 1 (Electric Piano preamp boost at 2.8kHz & 100Hz)
      this.timbreFilter.type = 'peaking';
      this.timbreFilter.frequency.setValueAtTime(2800, now);
      this.timbreFilter.Q.setValueAtTime(1.8, now);
      this.timbreFilter.gain.setValueAtTime(7.5, now);
    } else if (timbre === 5 && typeIdx === 2) {
      // Dyno 2 (Extreme bright chime EQ +9dB at 4.8kHz)
      this.timbreFilter.type = 'highshelf';
      this.timbreFilter.frequency.setValueAtTime(4500, now);
      this.timbreFilter.gain.setValueAtTime(9.0, now);
    } else {
      // Off (flat allpass)
      this.timbreFilter.type = 'allpass';
    }
  }

  private setupStringResonance(baseFreq: number, velocity: number, now: number): void {
    try {
      this.stringResGain = this.ctx.createGain();
      const resOsc = this.ctx.createOscillator();
      resOsc.type = 'sine';
      resOsc.frequency.setValueAtTime(baseFreq * 2.0, now); // 2nd harmonic sympathetic ringing

      this.stringResGain.gain.setValueAtTime(0.0001, now);
      this.stringResGain.gain.linearRampToValueAtTime(0.025 * velocity, now + 0.05);
      this.stringResGain.gain.exponentialRampToValueAtTime(0.00001, now + 3.0);

      resOsc.connect(this.stringResGain);
      this.stringResGain.connect(this.dynamicFilter);
      resOsc.start(now);

      this.oscillators.push(resOsc);
    } catch {}
  }

  private spawnSampleVoice(
    buffer: AudioBuffer,
    pitchRatio: number,
    unison: number,
    now: number
  ): void {
    // Unison detuning cents: Off = [0], 1 = [-3, +3], 2 = [-7, +7], 3 = [0, -14, +14]
    const detuneOffsets =
      unison === 1 ? [-3, 3] : unison === 2 ? [-7, 7] : unison === 3 ? [0, -14, 14] : [0];

    detuneOffsets.forEach((cents) => {
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        const detuneMultiplier = Math.pow(2, cents / 1200);
        src.playbackRate.setValueAtTime(pitchRatio * detuneMultiplier, now);

        src.connect(this.dynamicFilter);
        src.start(now);
        this.bufferSources.push(src);
      } catch {}
    });
  }

  private spawnClavinetVoice(baseFreq: number, velocity: number, unison: number, now: number): void {
    const detunes = unison === 1 ? [-3, 3] : unison === 2 ? [-7, 7] : unison === 3 ? [0, -12, 12] : [0];

    detunes.forEach((cents) => {
      try {
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const g = this.ctx.createGain();

        osc1.type = 'sawtooth';
        osc2.type = 'square';

        const freq = baseFreq * Math.pow(2, cents / 1200);
        osc1.frequency.setValueAtTime(freq, now);
        osc2.frequency.setValueAtTime(freq * 1.002, now);

        g.gain.setValueAtTime(0.35, now);
        g.gain.exponentialRampToValueAtTime(0.00001, now + 1.2);

        osc1.connect(g);
        osc2.connect(g);
        g.connect(this.dynamicFilter);

        osc1.start(now);
        osc2.start(now);

        this.oscillators.push(osc1, osc2);
        this.oscGains.push(g);
      } catch {}
    });
  }

  private spawnDigitalFmVoice(baseFreq: number, velocity: number, modelId: number, unison: number, now: number): void {
    const detunes = unison === 1 ? [-4, 4] : unison === 2 ? [-8, 8] : unison === 3 ? [0, -14, 14] : [0];

    detunes.forEach((cents) => {
      try {
        const carrier = this.ctx.createOscillator();
        const mod1 = this.ctx.createOscillator();
        const mod1Gain = this.ctx.createGain();
        const carrierGain = this.ctx.createGain();

        const freq = baseFreq * Math.pow(2, cents / 1200);
        carrier.type = 'sine';
        carrier.frequency.setValueAtTime(freq, now);

        // Modulator 1: Bell tine overtone ratio (14x for DX7 bell chime)
        const modRatio = modelId === 2 ? 7.0 : 14.0;
        mod1.type = 'sine';
        mod1.frequency.setValueAtTime(freq * modRatio, now);

        const modIndex = velocity * (modelId === 2 ? 800 : 1400);
        mod1Gain.gain.setValueAtTime(modIndex, now);
        mod1Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35); // Fast bell decay

        carrierGain.gain.setValueAtTime(0.4, now);
        carrierGain.gain.exponentialRampToValueAtTime(0.00001, now + 3.0);

        mod1.connect(mod1Gain);
        mod1Gain.connect(carrier.frequency);
        carrier.connect(carrierGain);
        carrierGain.connect(this.dynamicFilter);

        mod1.start(now);
        carrier.start(now);

        this.oscillators.push(mod1, carrier);
        this.oscGains.push(mod1Gain, carrierGain);
      } catch {}
    });
  }

  private spawnMiscMalletVoice(baseFreq: number, velocity: number, modelId: number, unison: number, now: number): void {
    const detunes = unison === 1 ? [-3, 3] : unison === 2 ? [-6, 6] : unison === 3 ? [0, -12, 12] : [0];

    detunes.forEach((cents) => {
      try {
        const oscFund = this.ctx.createOscillator();
        const oscOvertone = this.ctx.createOscillator();
        const g = this.ctx.createGain();

        const freq = baseFreq * Math.pow(2, cents / 1200);
        oscFund.type = 'sine';
        oscFund.frequency.setValueAtTime(freq, now);

        // Vibraphone (model 1) = 4.0x tuned overtone; Marimba (model 2) = 3.0x overtone
        const overtoneRatio = modelId === 2 ? 3.0 : 4.0;
        oscOvertone.type = 'sine';
        oscOvertone.frequency.setValueAtTime(freq * overtoneRatio, now);

        const decay = modelId === 2 ? 0.9 : 2.5; // Marimba decays fast, vibraphone rings
        g.gain.setValueAtTime(0.35, now);
        g.gain.exponentialRampToValueAtTime(0.00001, now + decay);

        oscFund.connect(g);
        oscOvertone.connect(g);
        g.connect(this.dynamicFilter);

        oscFund.start(now);
        oscOvertone.start(now);

        this.oscillators.push(oscFund, oscOvertone);
        this.oscGains.push(g);
      } catch {}
    });
  }

  private spawnFallbackVoice(baseFreq: number, velocity: number, unison: number, now: number): void {
    const detunes = unison === 1 ? [-3, 3] : unison === 2 ? [-6, 6] : unison === 3 ? [0, -12, 12] : [0];

    detunes.forEach((cents) => {
      try {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();

        const freq = baseFreq * Math.pow(2, cents / 1200);
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);

        g.gain.setValueAtTime(0.3, now);
        g.gain.exponentialRampToValueAtTime(0.00001, now + 2.5);

        osc.connect(g);
        g.connect(this.dynamicFilter);

        osc.start(now);
        this.oscillators.push(osc);
        this.oscGains.push(g);
      } catch {}
    });
  }

  public setPitchBend(bendSemitones: number): void {
    if (!this.config.pitchStickEnabled || this.isCleanedUp) return;
    const now = this.ctx.currentTime;
    const bendMultiplier = Math.pow(2, bendSemitones / 12);

    this.bufferSources.forEach((src) => {
      try {
        src.playbackRate.setTargetAtTime(bendMultiplier, now, 0.015);
      } catch {}
    });

    const baseFreq = midiToFrequency(this.effectiveMidi);
    this.oscillators.forEach((osc) => {
      try {
        osc.frequency.setTargetAtTime(baseFreq * bendMultiplier, now, 0.015);
      } catch {}
    });
  }

  public noteOff(isSustainPedalDown: boolean): void {
    if (this.state === 'dead') return;

    if (isSustainPedalDown && this.config.sustainEnabled) {
      this.state = 'sustained';
    } else {
      this.release();
    }
  }

  public release(): void {
    if (this.state === 'dead' || this.state === 'releasing') return;
    this.state = 'releasing';

    const now = this.ctx.currentTime;

    // Soft Release: Clavinet is crisp, other instruments extend damping time
    let releaseSec = Math.max(0.14, 0.38 - (this.effectiveMidi - 28) * 0.003);
    if (this.config.softRelease && this.config.typeIdx !== 3) {
      releaseSec *= 1.6; // Longer smoother release
    }

    try {
      this.voiceGain.gain.cancelScheduledValues(now);
      const currentGain = Math.max(0.0001, this.voiceGain.gain.value);
      this.voiceGain.gain.setValueAtTime(currentGain, now);
      this.voiceGain.gain.exponentialRampToValueAtTime(0.00001, now + releaseSec);
    } catch {}

    setTimeout(() => {
      this.cleanup();
    }, (releaseSec + 0.05) * 1000);
  }

  public stop(immediate: boolean = false): void {
    if (this.state === 'dead') return;
    this.state = 'dead';

    const now = this.ctx.currentTime;
    const fadeSec = immediate ? 0.005 : 0.02;

    try {
      this.voiceGain.gain.cancelScheduledValues(now);
      const currentGain = Math.max(0.0001, this.voiceGain.gain.value);
      this.voiceGain.gain.setValueAtTime(currentGain, now);
      this.voiceGain.gain.linearRampToValueAtTime(0.00001, now + fadeSec);
    } catch {}

    setTimeout(() => {
      this.cleanup();
    }, (fadeSec + 0.01) * 1000);
  }

  public isActive(): boolean {
    return this.state === 'active' || this.state === 'sustained' || this.state === 'sostenuto';
  }

  public cleanup(): void {
    if (this.isCleanedUp) return;
    this.isCleanedUp = true;
    this.state = 'dead';

    this.bufferSources.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {}
    });
    this.bufferSources = [];

    this.oscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {}
    });
    this.oscillators = [];

    this.oscGains.forEach((g) => {
      try {
        g.disconnect();
      } catch {}
    });
    this.oscGains = [];

    try {
      if (this.stringResGain) this.stringResGain.disconnect();
      this.dynamicFilter.disconnect();
      this.timbreFilter.disconnect();
      this.voiceGain.disconnect();
    } catch {}

    if (this.onEndedCallback) {
      this.onEndedCallback();
    }
  }
}

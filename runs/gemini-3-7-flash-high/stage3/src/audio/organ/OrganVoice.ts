import { OrganModel } from './types';

export interface OrganVoiceOptions {
  ctx: AudioContext;
  destination: AudioNode;
  midi: number;
  velocity: number;
  model: OrganModel;
  drawbars: [number, number, number, number, number, number, number, number, number];
  percussion: {
    on: boolean;
    soft: boolean;
    fast: boolean;
    third: boolean;
  };
  triggerPercussion: boolean;
  isSustained: boolean;
}

// B3 Drawbar ratios relative to 8' (fundamental)
const B3_DRAWBAR_RATIOS = [0.5, 1.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0];

export class OrganVoice {
  private ctx: AudioContext;
  private destination: AudioNode;
  public midi: number;
  public velocity: number;
  private model: OrganModel;

  private voiceGain: GainNode;
  private oscillators: OscillatorNode[] = [];
  private partialGains: GainNode[] = [];
  private noiseNodes: AudioNode[] = [];

  public isReleased = false;
  public isSustained = false;
  private isDisposed = false;

  constructor(options: OrganVoiceOptions) {
    this.ctx = options.ctx;
    this.destination = options.destination;
    this.midi = options.midi;
    this.velocity = Math.max(0.1, Math.min(1.0, options.velocity));
    this.model = options.model;
    this.isSustained = options.isSustained;

    const now = this.ctx.currentTime;
    this.voiceGain = this.ctx.createGain();
    this.voiceGain.gain.setValueAtTime(0, now);
    this.voiceGain.gain.linearRampToValueAtTime(1.0, now + 0.003); // Fast 3ms anti-click attack
    this.voiceGain.connect(this.destination);

    this.setupSoundGeneration(options);
  }

  private setupSoundGeneration(options: OrganVoiceOptions): void {
    const now = this.ctx.currentTime;
    const f0 = 440 * Math.pow(2, (this.midi - 69) / 12);

    switch (this.model) {
      case 'B3':
      case 'B3 Bass': {
        this.buildB3Sound(f0, options, now);
        break;
      }
      case 'Vox': {
        this.buildVoxSound(f0, options, now);
        break;
      }
      case 'Farf': {
        this.buildFarfSound(f0, options, now);
        break;
      }
      case 'Pipe 1':
      case 'Pipe 2': {
        this.buildPipeSound(f0, options, now);
        break;
      }
    }
  }

  private buildB3Sound(f0: number, options: OrganVoiceOptions, now: number): void {
    const isBass = this.model === 'B3 Bass';

    // 1. Drawbar Harmonic Partials (Additive Sine Oscillators)
    options.drawbars.forEach((dbValue, idx) => {
      // For B3 Bass, only 16' (idx 0) and 8' (idx 2) are active
      if (isBass && idx !== 0 && idx !== 2) return;

      if (dbValue <= 0) return;

      const ratio = B3_DRAWBAR_RATIOS[idx] ?? 1.0;
      const partialFreq = f0 * ratio;
      if (partialFreq > 18000) return; // Prevent aliasing above Nyquist

      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(partialFreq, now);

      const pGain = this.ctx.createGain();
      // Drawbar 0..8 mapped to harmonic amplitude (0..0.35)
      const amplitude = (dbValue / 8) * 0.15;
      pGain.gain.setValueAtTime(amplitude, now);

      osc.connect(pGain);
      pGain.connect(this.voiceGain);

      try {
        osc.start(now);
      } catch {}

      this.oscillators.push(osc);
      this.partialGains.push(pGain);
    });

    // 2. Key Click Generator (Short random transient burst)
    this.createKeyClick(now);

    // 3. B3 Percussion (Single-triggered harmonic decaying partial)
    if (!isBass && options.percussion.on && options.triggerPercussion) {
      this.createB3Percussion(f0, options.percussion, now);
    }
  }

  private createKeyClick(now: number): void {
    try {
      const clickBuffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * 0.006), this.ctx.sampleRate);
      const data = clickBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        // Highpass shaped random noise with fast decay
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (this.ctx.sampleRate * 0.0015));
      }

      const clickSource = this.ctx.createBufferSource();
      clickSource.buffer = clickBuffer;

      const clickFilter = this.ctx.createBiquadFilter();
      clickFilter.type = 'bandpass';
      clickFilter.frequency.setValueAtTime(3200, now);
      clickFilter.Q.setValueAtTime(2.0, now);

      const clickGain = this.ctx.createGain();
      clickGain.gain.setValueAtTime(0.08, now);

      clickSource.connect(clickFilter);
      clickFilter.connect(clickGain);
      clickGain.connect(this.voiceGain);

      clickSource.start(now);
      this.noiseNodes.push(clickSource, clickFilter, clickGain);
    } catch {}
  }

  private createB3Percussion(
    f0: number,
    perc: { soft: boolean; fast: boolean; third: boolean },
    now: number
  ): void {
    const percRatio = perc.third ? 3.0 : 2.0; // 3rd harmonic (2 2/3') or 2nd harmonic (4')
    const percFreq = f0 * percRatio;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(percFreq, now);

    const pGain = this.ctx.createGain();
    const peakLevel = perc.soft ? 0.18 : 0.35;
    const decayTime = perc.fast ? 0.18 : 0.85;

    pGain.gain.setValueAtTime(peakLevel, now);
    pGain.gain.exponentialRampToValueAtTime(0.0001, now + decayTime);

    osc.connect(pGain);
    pGain.connect(this.voiceGain);

    try {
      osc.start(now);
      osc.stop(now + decayTime + 0.05);
    } catch {}

    this.oscillators.push(osc);
    this.partialGains.push(pGain);
  }

  private buildVoxSound(f0: number, options: OrganVoiceOptions, now: number): void {
    // Vox Continental: Transistor pulse/square waves + tone filter
    const ratios = [0.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
    const mixFilterDb = options.drawbars[8] ?? 4; // 9th drawbar is Tone / Filter mix

    const masterFilter = this.ctx.createBiquadFilter();
    masterFilter.type = 'lowpass';
    const cutoff = 1500 + (mixFilterDb / 8) * 6000;
    masterFilter.frequency.setValueAtTime(cutoff, now);
    masterFilter.Q.setValueAtTime(1.5, now);
    masterFilter.connect(this.voiceGain);

    ratios.forEach((ratio, idx) => {
      const dbVal = options.drawbars[idx] ?? 0;
      if (dbVal <= 0) return;

      const osc = this.ctx.createOscillator();
      osc.type = idx % 2 === 0 ? 'square' : 'triangle';
      osc.frequency.setValueAtTime(f0 * ratio, now);

      const pGain = this.ctx.createGain();
      pGain.gain.setValueAtTime((dbVal / 8) * 0.14, now);

      osc.connect(pGain);
      pGain.connect(masterFilter);

      try {
        osc.start(now);
      } catch {}

      this.oscillators.push(osc);
      this.partialGains.push(pGain);
    });

    this.noiseNodes.push(masterFilter);
  }

  private buildFarfSound(f0: number, options: OrganVoiceOptions, now: number): void {
    // Farfisa Compact: Register switches (pulled > 4 is ON) with rich saw/pulse
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'peaking';
    filter.frequency.setValueAtTime(2800, now);
    filter.gain.setValueAtTime(6.0, now); // Treble bite
    filter.connect(this.voiceGain);

    const farfRatios = [0.5, 1.0, 1.0, 1.5, 2.0, 2.0, 3.0, 4.0, 5.0];

    options.drawbars.forEach((dbVal, idx) => {
      // Switch active if > 4
      if (dbVal <= 4) return;

      const ratio = farfRatios[idx] ?? 1.0;
      const osc = this.ctx.createOscillator();
      osc.type = idx % 2 === 0 ? 'sawtooth' : 'square';
      osc.frequency.setValueAtTime(f0 * ratio, now);

      const pGain = this.ctx.createGain();
      pGain.gain.setValueAtTime(0.12, now);

      osc.connect(pGain);
      pGain.connect(filter);

      try {
        osc.start(now);
      } catch {}

      this.oscillators.push(osc);
      this.partialGains.push(pGain);
    });

    this.noiseNodes.push(filter);
  }

  private buildPipeSound(f0: number, options: OrganVoiceOptions, now: number): void {
    const isPrincipal = this.model === 'Pipe 2';

    // Pipe Chiff transient
    this.createKeyClick(now);

    options.drawbars.forEach((dbVal, idx) => {
      if (dbVal <= 0) return;

      const ratio = B3_DRAWBAR_RATIOS[idx] ?? 1.0;
      const osc = this.ctx.createOscillator();
      // Flute ranks use sine/triangle, Principal ranks use triangle/saw
      osc.type = isPrincipal ? (idx < 3 ? 'triangle' : 'sawtooth') : 'triangle';

      // Slight pipe detune
      const detuneCents = (Math.random() * 4 - 2);
      osc.frequency.setValueAtTime(f0 * ratio, now);
      osc.detune.setValueAtTime(detuneCents, now);

      const pGain = this.ctx.createGain();
      const gainScale = isPrincipal ? 0.12 : 0.15;
      pGain.gain.setValueAtTime((dbVal / 8) * gainScale, now);

      osc.connect(pGain);
      pGain.connect(this.voiceGain);

      try {
        osc.start(now);
      } catch {}

      this.oscillators.push(osc);
      this.partialGains.push(pGain);
    });
  }

  public setPitchBend(semitones: number): void {
    if (this.isDisposed) return;
    const now = this.ctx.currentTime;
    const cents = semitones * 100;
    this.oscillators.forEach((osc) => {
      try {
        osc.detune.setTargetAtTime(cents, now, 0.015);
      } catch {}
    });
  }

  public release(onComplete?: () => void): void {
    if (this.isReleased || this.isDisposed) return;
    this.isReleased = true;

    const now = this.ctx.currentTime;
    const releaseTime = 0.005; // Fast 5ms organ note cutoff

    try {
      this.voiceGain.gain.cancelScheduledValues(now);
      this.voiceGain.gain.setValueAtTime(this.voiceGain.gain.value, now);
      this.voiceGain.gain.linearRampToValueAtTime(0, now + releaseTime);
    } catch {}

    setTimeout(() => {
      this.dispose();
      onComplete?.();
    }, (releaseTime + 0.02) * 1000);
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.oscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {}
    });
    this.oscillators = [];

    this.partialGains.forEach((g) => {
      try {
        g.disconnect();
      } catch {}
    });
    this.partialGains = [];

    this.noiseNodes.forEach((n) => {
      try {
        (n as OscillatorNode).stop?.();
        n.disconnect();
      } catch {}
    });
    this.noiseNodes = [];

    try {
      this.voiceGain.disconnect();
    } catch {}
  }
}

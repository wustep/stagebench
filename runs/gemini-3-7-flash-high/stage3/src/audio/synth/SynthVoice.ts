import { SynthOscillator } from './SynthOscillator';
import {
  SynthOscCategory,
  SynthFilterType,
  SynthLfoWaveform,
  SynthLfoDestination,
} from './types';

export interface SynthVoiceOptions {
  ctx: AudioContext;
  destination: AudioNode;
  midi: number;
  velocity: number;
  isSustained: boolean;

  // Oscillator
  oscCategory: SynthOscCategory;
  waveformIndex: number;
  oscCtrl: number;
  pitchCoarse: number; // -24..+24
  pitchFine: number; // -50..+50
  unisonLevel: number; // 0..3

  // Filter
  filterType: SynthFilterType;
  filterCutoff: number; // 0..10
  filterResonance: number; // 0..10
  filterDrive: number; // 0..3
  filterEnvAmt: number; // -10..+10
  filterKbTracking: number; // 0: Off, 1: 1/3, 2: 2/3, 3: 1

  // Envelopes
  ampAttack: number; // seconds
  ampDecay: number;
  ampSustain: number; // 0..10
  ampRelease: number;
  ampVelocity: number; // 0..3

  modAttack: number;
  modDecay: number;
  modRelease: number;
  modVelocity: boolean;
  modToPitch: boolean;
  modEnvAmt: number;

  // LFO
  lfoWaveform: SynthLfoWaveform;
  lfoDestination: SynthLfoDestination;
  lfoRate: number; // Hz (or clock scaled)
  lfoAmount: number; // 0..10

  // Vibrato
  vibratoActive: boolean;
  vibratoRate: number; // 2..8 Hz
  vibratoAmount: number; // 0..10
}

export class SynthVoice {
  private ctx: AudioContext;
  private destination: AudioNode;
  public midi: number;
  public velocity: number;
  public isSustained: boolean;
  public isReleased = false;
  private isDisposed = false;

  private oscillator: SynthOscillator | null = null;
  private primaryFilter: BiquadFilterNode | null = null;
  private secondaryFilter: BiquadFilterNode | null = null; // for LP24 (4-pole cascade)
  private driveNode: WaveShaperNode | null = null;
  private ampGain: GainNode;

  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private vibratoOsc: OscillatorNode | null = null;
  private vibratoGain: GainNode | null = null;

  // Stored envelope and filter parameters for release phase
  private ampReleaseTime: number;
  private filterReleaseTime: number;
  private baseCutoffHz: number = 1000;
  private filterEnvAmt: number = 0;
  private targetGain: number = 0.8;

  constructor(options: SynthVoiceOptions) {
    this.ctx = options.ctx;
    this.destination = options.destination;
    this.midi = options.midi;
    this.velocity = Math.max(0.1, Math.min(1.0, options.velocity));
    this.isSustained = options.isSustained;

    this.ampReleaseTime = Math.max(0.01, options.ampRelease);
    this.filterReleaseTime = Math.max(0.01, options.modRelease);
    this.filterEnvAmt = options.filterEnvAmt;

    const now = this.ctx.currentTime;

    // 1. Amp Gain Node
    this.ampGain = this.ctx.createGain();
    this.ampGain.gain.setValueAtTime(0, now);
    this.ampGain.connect(this.destination);

    // 2. Filter Graph & Drive
    const filterInput = this.buildFilterGraph(options, now);

    // 3. Pitch computation
    const totalPitchSemitones =
      this.midi + options.pitchCoarse + options.pitchFine / 100;
    const fundamentalHz = 440 * Math.pow(2, (totalPitchSemitones - 69) / 12);

    // 4. Oscillator Generation
    this.oscillator = new SynthOscillator({
      ctx: this.ctx,
      destination: filterInput,
      frequency: fundamentalHz,
      category: options.oscCategory,
      waveformIndex: options.waveformIndex,
      oscCtrl: options.oscCtrl,
      unisonLevel: options.unisonLevel,
    });

    // 5. Modulation & LFO & Vibrato
    this.setupModulation(options, fundamentalHz, now);

    // 6. Trigger Envelopes (Amp, Filter, Osc)
    this.triggerEnvelopes(options, now);
  }

  private buildFilterGraph(options: SynthVoiceOptions, now: number): AudioNode {
    // Cutoff frequency curve: 20 Hz to 20 kHz exponential
    const cutoffNorm = options.filterCutoff / 10;
    const baseFreq = 20 * Math.pow(1000, cutoffNorm);

    // Keyboard tracking: shift cutoff relative to MIDI 60 (Middle C)
    const trackingMultiplier =
      options.filterKbTracking === 1
        ? 0.33
        : options.filterKbTracking === 2
        ? 0.66
        : options.filterKbTracking === 3
        ? 1.0
        : 0;
    const trackingOffsetSemitones = (this.midi - 60) * trackingMultiplier;
    this.baseCutoffHz = Math.max(
      20,
      Math.min(20000, baseFreq * Math.pow(2, trackingOffsetSemitones / 12))
    );

    // Resonance Q curve: 0.7 to 18
    const qValue = 0.7 + Math.pow(options.filterResonance / 10, 2) * 17.3;

    this.primaryFilter = this.ctx.createBiquadFilter();
    this.primaryFilter.frequency.setValueAtTime(this.baseCutoffHz, now);
    this.primaryFilter.Q.setValueAtTime(qValue, now);

    let filterOutput: AudioNode = this.primaryFilter;

    if (options.filterType === 'LP12') {
      this.primaryFilter.type = 'lowpass';
    } else if (options.filterType === 'LP24') {
      // 24dB / 4-pole: two cascaded 12dB biquads
      this.primaryFilter.type = 'lowpass';
      this.secondaryFilter = this.ctx.createBiquadFilter();
      this.secondaryFilter.type = 'lowpass';
      this.secondaryFilter.frequency.setValueAtTime(this.baseCutoffHz, now);
      this.secondaryFilter.Q.setValueAtTime(Math.sqrt(qValue), now);
      this.primaryFilter.connect(this.secondaryFilter);
      filterOutput = this.secondaryFilter;
    } else if (options.filterType === 'HP') {
      this.primaryFilter.type = 'highpass';
    } else if (options.filterType === 'BP') {
      this.primaryFilter.type = 'bandpass';
    }

    // Drive Node (WaveShaper saturation)
    if (options.filterDrive > 0) {
      this.driveNode = this.ctx.createWaveShaper();
      const nSamples = 256;
      const curve = new Float32Array(nSamples);
      const k = options.filterDrive * 2.5;
      for (let i = 0; i < nSamples; i++) {
        const x = (i * 2) / nSamples - 1;
        curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      }
      this.driveNode.curve = curve;
      filterOutput.connect(this.driveNode);
      this.driveNode.connect(this.ampGain);
    } else {
      filterOutput.connect(this.ampGain);
    }

    return this.primaryFilter;
  }

  private setupModulation(options: SynthVoiceOptions, fundamentalHz: number, now: number): void {
    // 1. Vibrato Oscillator (2..8 Hz sine modulating oscillator pitch)
    if (options.vibratoActive && options.vibratoAmount > 0) {
      this.vibratoOsc = this.ctx.createOscillator();
      this.vibratoOsc.type = 'sine';
      this.vibratoOsc.frequency.setValueAtTime(options.vibratoRate, now);

      this.vibratoGain = this.ctx.createGain();
      // Amount: 0..10 -> up to 50 cents modulation
      const vibratoCents = (options.vibratoAmount / 10) * 50;
      this.vibratoGain.gain.setValueAtTime(vibratoCents, now);

      this.vibratoOsc.connect(this.vibratoGain);
      try {
        this.vibratoOsc.start(now);
      } catch {}
    }

    // 2. LFO
    if (options.lfoDestination !== 'Off' && options.lfoAmount > 0) {
      this.lfo = this.ctx.createOscillator();
      const lfoWf = options.lfoWaveform;
      if (lfoWf === 'Triangle') this.lfo.type = 'triangle';
      else if (lfoWf === 'Saw down' || lfoWf === 'Saw up') this.lfo.type = 'sawtooth';
      else if (lfoWf === 'Square' || lfoWf === 'Sample & Hold') this.lfo.type = 'square';

      this.lfo.frequency.setValueAtTime(Math.max(0.1, options.lfoRate), now);

      this.lfoGain = this.ctx.createGain();
      const lfoNormalized = options.lfoAmount / 10;

      if (options.lfoDestination === 'Filter Freq') {
        // Modulate filter cutoff (up to 3500 Hz)
        const filterModDepth = lfoNormalized * 3500;
        this.lfoGain.gain.setValueAtTime(filterModDepth, now);
        if (this.primaryFilter) {
          this.lfo.connect(this.lfoGain);
          this.lfoGain.connect(this.primaryFilter.frequency);
        }
      } else if (options.lfoDestination === 'Osc Pitch') {
        // Modulate oscillator pitch (up to 600 cents / 6 semitones)
        const pitchModDepth = lfoNormalized * 600;
        this.lfoGain.gain.setValueAtTime(pitchModDepth, now);
      }

      try {
        this.lfo.start(now);
      } catch {}
    }
  }

  private triggerEnvelopes(options: SynthVoiceOptions, now: number): void {
    // 1. Amp Envelope (ADR)
    // Velocity scaling
    const velScale =
      options.ampVelocity === 0
        ? 1.0
        : options.ampVelocity === 1
        ? 0.5 + this.velocity * 0.5
        : options.ampVelocity === 2
        ? 0.3 + this.velocity * 0.7
        : this.velocity;

    this.targetGain = velScale * 0.8;
    const sustainGain = (options.ampSustain / 10) * this.targetGain;
    const attTime = Math.max(0.003, options.ampAttack);
    const decTime = Math.max(0.01, options.ampDecay);

    this.ampGain.gain.cancelScheduledValues(now);
    this.ampGain.gain.setValueAtTime(0, now);
    this.ampGain.gain.linearRampToValueAtTime(this.targetGain, now + attTime);
    this.ampGain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, sustainGain),
      now + attTime + decTime
    );

    // 2. Filter Envelope
    if (this.primaryFilter && options.filterEnvAmt !== 0) {
      const fAtt = Math.max(0.003, options.modAttack);
      const fDec = Math.max(0.01, options.modDecay);

      // Env amt: -10..+10 scales peak frequency shift up to +8000 Hz or -3000 Hz
      const envShiftHz = (options.filterEnvAmt / 10) * 8000;
      const peakCutoff = Math.max(20, Math.min(20000, this.baseCutoffHz + envShiftHz));
      const sustainCutoff = Math.max(20, Math.min(20000, this.baseCutoffHz + envShiftHz * 0.3));

      this.primaryFilter.frequency.cancelScheduledValues(now);
      this.primaryFilter.frequency.setValueAtTime(this.baseCutoffHz, now);
      this.primaryFilter.frequency.linearRampToValueAtTime(peakCutoff, now + fAtt);
      this.primaryFilter.frequency.exponentialRampToValueAtTime(
        sustainCutoff,
        now + fAtt + fDec
      );

      if (this.secondaryFilter) {
        this.secondaryFilter.frequency.cancelScheduledValues(now);
        this.secondaryFilter.frequency.setValueAtTime(this.baseCutoffHz, now);
        this.secondaryFilter.frequency.linearRampToValueAtTime(peakCutoff, now + fAtt);
        this.secondaryFilter.frequency.exponentialRampToValueAtTime(
          sustainCutoff,
          now + fAtt + fDec
        );
      }
    }

    // 3. Oscillator Envelope (Pitch modulation if modToPitch is true)
    if (options.modToPitch && options.modEnvAmt !== 0 && this.oscillator) {
      const pAtt = Math.max(0.003, options.modAttack);
      const pDec = Math.max(0.01, options.modDecay);
      const pitchShiftCents = (options.modEnvAmt / 10) * 2400; // ±24 semitones
      this.oscillator.setDetune(pitchShiftCents);
      setTimeout(() => {
        this.oscillator?.setDetune(0);
      }, (pAtt + pDec) * 1000);
    }
  }

  public setGlidePitch(targetMidi: number, glideTime: number): void {
    this.midi = targetMidi;
    const targetHz = 440 * Math.pow(2, (targetMidi - 69) / 12);
    if (this.oscillator) {
      this.oscillator.setFrequency(targetHz, Math.max(0.005, glideTime));
    }
  }

  public setPitchBend(semitones: number): void {
    if (this.oscillator) {
      this.oscillator.setDetune(semitones * 100);
    }
  }

  public release(onComplete?: () => void): void {
    if (this.isReleased || this.isDisposed) return;
    this.isReleased = true;

    const now = this.ctx.currentTime;
    const relTime = Math.max(0.01, this.ampReleaseTime);

    try {
      this.ampGain.gain.cancelScheduledValues(now);
      this.ampGain.gain.setValueAtTime(this.ampGain.gain.value, now);
      this.ampGain.gain.exponentialRampToValueAtTime(0.0001, now + relTime);

      if (this.primaryFilter) {
        this.primaryFilter.frequency.cancelScheduledValues(now);
        this.primaryFilter.frequency.setValueAtTime(this.primaryFilter.frequency.value, now);
        this.primaryFilter.frequency.exponentialRampToValueAtTime(
          Math.max(20, this.baseCutoffHz * 0.5),
          now + this.filterReleaseTime
        );
      }
    } catch {}

    setTimeout(() => {
      this.dispose();
      onComplete?.();
    }, (relTime + 0.05) * 1000);
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (this.oscillator) {
      this.oscillator.dispose();
      this.oscillator = null;
    }

    if (this.vibratoOsc) {
      try {
        this.vibratoOsc.stop();
        this.vibratoOsc.disconnect();
      } catch {}
    }

    if (this.lfo) {
      try {
        this.lfo.stop();
        this.lfo.disconnect();
      } catch {}
    }

    try {
      this.primaryFilter?.disconnect();
      this.secondaryFilter?.disconnect();
      this.driveNode?.disconnect();
      this.ampGain.disconnect();
    } catch {}
  }
}

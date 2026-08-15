import { Mod1Params, Mod1Type } from './types';

export class Mod1Effect {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private ctx: AudioContext;
  private dryGain: GainNode;
  private wetGain: GainNode;

  // Processing nodes
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private panner: StereoPannerNode | null = null;
  private tremoloGain: GainNode | null = null;
  private ringModCarrier: OscillatorNode | null = null;
  private ringModGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;

  private currentParams: Mod1Params = {
    on: false,
    type: 'A-Pan',
    rate: 5.0,
    amount: 5.0,
  };

  private isDisposed = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();

    this.dryGain.gain.setValueAtTime(1.0, ctx.currentTime);
    this.wetGain.gain.setValueAtTime(0.0, ctx.currentTime);

    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);

    this.setupEffectGraph();
  }

  private setupEffectGraph(): void {
    if (this.isDisposed) return;
    this.cleanupGraph();

    const now = this.ctx.currentTime;
    const type = this.currentParams.type;
    const rateHz = 0.2 + (this.currentParams.rate / 10) * 12.0; // 0.2Hz to 12.2Hz LFO

    if (type === 'A-Pan') {
      try {
        if (this.ctx.createStereoPanner) {
          this.panner = this.ctx.createStereoPanner();
          this.lfo = this.ctx.createOscillator();
          this.lfoGain = this.ctx.createGain();

          this.lfo.frequency.setValueAtTime(rateHz, now);
          const panDepth = (this.currentParams.amount / 10) * 0.95;
          this.lfoGain.gain.setValueAtTime(panDepth, now);

          this.lfo.connect(this.lfoGain);
          this.lfoGain.connect(this.panner.pan);
          this.lfo.start(now);

          this.input.connect(this.panner);
          this.panner.connect(this.wetGain);
        } else {
          // Fallback if StereoPanner is not supported
          this.input.connect(this.wetGain);
        }
      } catch {
        this.input.connect(this.wetGain);
      }
    } else if (type === 'Tremolo') {
      this.tremoloGain = this.ctx.createGain();
      this.lfo = this.ctx.createOscillator();
      this.lfoGain = this.ctx.createGain();

      const baseGain = 1.0 - (this.currentParams.amount / 10) * 0.5;
      const modDepth = (this.currentParams.amount / 10) * 0.5;
      this.tremoloGain.gain.setValueAtTime(baseGain, now);
      this.lfo.frequency.setValueAtTime(rateHz, now);
      this.lfoGain.gain.setValueAtTime(modDepth, now);

      this.lfo.connect(this.lfoGain);
      this.lfoGain.connect(this.tremoloGain.gain);
      this.lfo.start(now);

      this.input.connect(this.tremoloGain);
      this.tremoloGain.connect(this.wetGain);
    } else if (type === 'Ring Mod') {
      this.ringModGain = this.ctx.createGain();
      this.ringModCarrier = this.ctx.createOscillator();

      const carrierFreq = 50 + (this.currentParams.rate / 10) * 1200; // 50Hz to 1250Hz audio rate
      this.ringModCarrier.frequency.setValueAtTime(carrierFreq, now);
      this.ringModGain.gain.setValueAtTime(0.0, now);

      this.ringModCarrier.connect(this.ringModGain.gain);
      this.ringModCarrier.start(now);

      this.input.connect(this.ringModGain);
      this.ringModGain.connect(this.wetGain);
    } else if (type === 'Wah' || type === 'A-Wah' || type === 'Pump') {
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = type === 'Pump' ? 'lowshelf' : 'bandpass';
      this.filter.Q.setValueAtTime(type === 'Pump' ? 1.0 : 4.0, now);

      this.lfo = this.ctx.createOscillator();
      this.lfoGain = this.ctx.createGain();

      if (type === 'Wah') {
        this.filter.frequency.setValueAtTime(1000, now);
        this.lfo.frequency.setValueAtTime(rateHz, now);
        const sweepAmt = (this.currentParams.amount / 10) * 1800;
        this.lfoGain.gain.setValueAtTime(sweepAmt, now);
        this.lfo.connect(this.lfoGain);
        this.lfoGain.connect(this.filter.frequency);
        this.lfo.start(now);
      } else if (type === 'A-Wah') {
        // Auto-wah envelope follower sensitivity
        const centerFreq = 400 + (this.currentParams.rate / 10) * 2000;
        this.filter.frequency.setValueAtTime(centerFreq, now);
        this.lfo.frequency.setValueAtTime(rateHz * 1.5, now);
        const sens = (this.currentParams.amount / 10) * 1200;
        this.lfoGain.gain.setValueAtTime(sens, now);
        this.lfo.connect(this.lfoGain);
        this.lfoGain.connect(this.filter.frequency);
        this.lfo.start(now);
      } else {
        // Pump (ducking modulation)
        this.filter.frequency.setValueAtTime(250, now);
        this.filter.gain.setValueAtTime(-12, now);
        this.lfo.type = 'sawtooth';
        this.lfo.frequency.setValueAtTime(rateHz * 0.8, now);
        this.lfoGain.gain.setValueAtTime(this.currentParams.amount * 1.5, now);
        this.lfo.connect(this.lfoGain);
        this.lfoGain.connect(this.filter.gain);
        this.lfo.start(now);
      }

      this.input.connect(this.filter);
      this.filter.connect(this.wetGain);
    }

    this.wetGain.connect(this.output);
  }

  public setParams(params: Partial<Mod1Params>): void {
    if (params.enabled !== undefined) {
      params.on = params.enabled;
    }
    const typeChanged = params.type && params.type !== this.currentParams.type;
    this.currentParams = { ...this.currentParams, ...params };

    if (typeChanged) {
      this.setupEffectGraph();
    }

    const now = this.ctx.currentTime;
    const isEngaged = this.currentParams.on && this.currentParams.amount > 0.05;

    // Crossfade dry/wet for click-free bypass
    this.dryGain.gain.setTargetAtTime(isEngaged ? 0.0 : 1.0, now, 0.015);
    this.wetGain.gain.setTargetAtTime(isEngaged ? 1.0 : 0.0, now, 0.015);

    // Update real-time parameters
    const rateHz = 0.2 + (this.currentParams.rate / 10) * 12.0;

    if (this.lfo && this.currentParams.type !== 'Ring Mod') {
      try {
        this.lfo.frequency.setTargetAtTime(rateHz, now, 0.02);
      } catch {}
    }

    if (this.ringModCarrier) {
      const carrierFreq = 50 + (this.currentParams.rate / 10) * 1200;
      try {
        this.ringModCarrier.frequency.setTargetAtTime(carrierFreq, now, 0.02);
      } catch {}
    }

    if (this.lfoGain) {
      let depth = (this.currentParams.amount / 10);
      if (this.currentParams.type === 'Wah' || this.currentParams.type === 'A-Wah') {
        depth *= 1800;
      } else if (this.currentParams.type === 'Pump') {
        depth *= 15;
      }
      try {
        this.lfoGain.gain.setTargetAtTime(depth, now, 0.02);
      } catch {}
    }
  }

  public setType(type: Mod1Type): void {
    this.setParams({ type });
  }

  public setOn(on: boolean): void {
    this.setParams({ on });
  }

  public getParams(): Mod1Params {
    return { ...this.currentParams };
  }

  public updateParams(params: Partial<Mod1Params>): void {
    this.setParams(params);
  }

  private cleanupGraph(): void {
    if (this.lfo) {
      try {
        this.lfo.stop();
        this.lfo.disconnect();
      } catch {}
      this.lfo = null;
    }
    if (this.lfoGain) {
      try {
        this.lfoGain.disconnect();
      } catch {}
      this.lfoGain = null;
    }
    if (this.ringModCarrier) {
      try {
        this.ringModCarrier.stop();
        this.ringModCarrier.disconnect();
      } catch {}
      this.ringModCarrier = null;
    }
    if (this.ringModGain) {
      try {
        this.ringModGain.disconnect();
      } catch {}
      this.ringModGain = null;
    }
    if (this.panner) {
      try {
        this.panner.disconnect();
      } catch {}
      this.panner = null;
    }
    if (this.tremoloGain) {
      try {
        this.tremoloGain.disconnect();
      } catch {}
      this.tremoloGain = null;
    }
    if (this.filter) {
      try {
        this.filter.disconnect();
      } catch {}
      this.filter = null;
    }
  }

  public dispose(): void {
    this.isDisposed = true;
    this.cleanupGraph();
    try {
      this.input.disconnect();
      this.output.disconnect();
      this.dryGain.disconnect();
      this.wetGain.disconnect();
    } catch {}
  }
}

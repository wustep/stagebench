import { Mod2Params, Mod2Type } from './types';

export class Mod2Effect {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private ctx: AudioContext;
  private dryGain: GainNode;
  private wetGain: GainNode;

  private delayNode1: DelayNode | null = null;
  private delayNode2: DelayNode | null = null;
  private delayNode3: DelayNode | null = null;
  private feedbackGain: GainNode | null = null;
  private allpassFilters: BiquadFilterNode[] = [];
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;

  private currentParams: Mod2Params = {
    on: false,
    type: 'Chorus',
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
    const rateHz = 0.2 + (this.currentParams.rate / 10) * 8.0;

    if (type === 'Chorus' || type === 'Flanger' || type === 'Vibe' || type === 'Spin') {
      try {
        const baseDelay =
          type === 'Flanger' ? 0.003 : type === 'Spin' ? 0.008 : type === 'Vibe' ? 0.012 : 0.022;

        this.delayNode1 = this.ctx.createDelay(0.1);
        this.delayNode1.delayTime.setValueAtTime(baseDelay, now);

        this.lfo = this.ctx.createOscillator();
        this.lfoGain = this.ctx.createGain();

        this.lfo.frequency.setValueAtTime(rateHz, now);
        const modDepth = (this.currentParams.amount / 10) * (type === 'Flanger' ? 0.002 : 0.006);
        this.lfoGain.gain.setValueAtTime(modDepth, now);

        this.lfo.connect(this.lfoGain);
        this.lfoGain.connect(this.delayNode1.delayTime);
        this.lfo.start(now);

        if (type === 'Flanger') {
          this.feedbackGain = this.ctx.createGain();
          const fbAmt = (this.currentParams.amount / 10) * 0.75;
          this.feedbackGain.gain.setValueAtTime(fbAmt, now);

          this.input.connect(this.delayNode1);
          this.delayNode1.connect(this.feedbackGain);
          this.feedbackGain.connect(this.delayNode1);
          this.delayNode1.connect(this.wetGain);
        } else {
          this.input.connect(this.delayNode1);
          this.delayNode1.connect(this.wetGain);
        }
      } catch {
        this.input.connect(this.wetGain);
      }
    } else if (type === 'Phaser') {
      // 4-stage allpass filter cascade
      this.allpassFilters = [];
      const numStages = 4;
      let lastNode: AudioNode = this.input;

      for (let i = 0; i < numStages; i++) {
        const ap = this.ctx.createBiquadFilter();
        ap.type = 'allpass';
        ap.frequency.setValueAtTime(1000, now);
        ap.Q.setValueAtTime(1.5, now);
        lastNode.connect(ap);
        lastNode = ap;
        this.allpassFilters.push(ap);
      }

      this.feedbackGain = this.ctx.createGain();
      this.feedbackGain.gain.setValueAtTime((this.currentParams.amount / 10) * 0.6, now);
      lastNode.connect(this.feedbackGain);
      this.feedbackGain.connect(this.allpassFilters[0]);

      lastNode.connect(this.wetGain);

      // LFO modulation of phaser frequency
      this.lfo = this.ctx.createOscillator();
      this.lfoGain = this.ctx.createGain();
      this.lfo.frequency.setValueAtTime(rateHz, now);
      this.lfoGain.gain.setValueAtTime((this.currentParams.amount / 10) * 1400, now);

      this.lfo.connect(this.lfoGain);
      this.allpassFilters.forEach((ap) => {
        this.lfoGain?.connect(ap.frequency);
      });
      this.lfo.start(now);
    } else if (type === 'Ensemble') {
      // 3 delay lines
      this.delayNode1 = this.ctx.createDelay(0.1);
      this.delayNode2 = this.ctx.createDelay(0.1);
      this.delayNode3 = this.ctx.createDelay(0.1);

      this.delayNode1.delayTime.setValueAtTime(0.015, now);
      this.delayNode2.delayTime.setValueAtTime(0.022, now);
      this.delayNode3.delayTime.setValueAtTime(0.028, now);

      this.lfo = this.ctx.createOscillator();
      this.lfoGain = this.ctx.createGain();
      this.lfo.frequency.setValueAtTime(rateHz, now);
      this.lfoGain.gain.setValueAtTime((this.currentParams.amount / 10) * 0.005, now);

      this.lfo.connect(this.lfoGain);
      this.lfoGain.connect(this.delayNode1.delayTime);
      this.lfoGain.connect(this.delayNode2.delayTime);
      this.lfoGain.connect(this.delayNode3.delayTime);
      this.lfo.start(now);

      this.input.connect(this.delayNode1);
      this.input.connect(this.delayNode2);
      this.input.connect(this.delayNode3);

      this.delayNode1.connect(this.wetGain);
      this.delayNode2.connect(this.wetGain);
      this.delayNode3.connect(this.wetGain);
    }

    this.wetGain.connect(this.output);
  }

  public setParams(params: Partial<Mod2Params>): void {
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

    this.dryGain.gain.setTargetAtTime(isEngaged ? 0.0 : 1.0, now, 0.015);
    this.wetGain.gain.setTargetAtTime(isEngaged ? 1.0 : 0.0, now, 0.015);

    const rateHz = 0.2 + (this.currentParams.rate / 10) * 8.0;

    if (this.lfo) {
      try {
        this.lfo.frequency.setTargetAtTime(rateHz, now, 0.02);
      } catch {}
    }

    if (this.lfoGain) {
      const type = this.currentParams.type;
      const depth =
        type === 'Phaser'
          ? (this.currentParams.amount / 10) * 1400
          : type === 'Flanger'
            ? (this.currentParams.amount / 10) * 0.002
            : (this.currentParams.amount / 10) * 0.006;
      try {
        this.lfoGain.gain.setTargetAtTime(depth, now, 0.02);
      } catch {}
    }

    if (this.feedbackGain) {
      const fb = (this.currentParams.amount / 10) * 0.7;
      try {
        this.feedbackGain.gain.setTargetAtTime(fb, now, 0.02);
      } catch {}
    }
  }

  public setType(type: Mod2Type): void {
    this.setParams({ type });
  }

  public setOn(on: boolean): void {
    this.setParams({ on });
  }

  public getParams(): Mod2Params {
    return { ...this.currentParams };
  }

  public updateParams(params: Partial<Mod2Params>): void {
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
    if (this.delayNode1) {
      try {
        this.delayNode1.disconnect();
      } catch {}
      this.delayNode1 = null;
    }
    if (this.delayNode2) {
      try {
        this.delayNode2.disconnect();
      } catch {}
      this.delayNode2 = null;
    }
    if (this.delayNode3) {
      try {
        this.delayNode3.disconnect();
      } catch {}
      this.delayNode3 = null;
    }
    if (this.feedbackGain) {
      try {
        this.feedbackGain.disconnect();
      } catch {}
      this.feedbackGain = null;
    }
    this.allpassFilters.forEach((ap) => {
      try {
        ap.disconnect();
      } catch {}
    });
    this.allpassFilters = [];
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

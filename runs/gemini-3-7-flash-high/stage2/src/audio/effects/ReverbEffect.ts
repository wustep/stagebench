import { ReverbParams, ReverbType } from './types';

export class ReverbEffect {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private ctx: AudioContext;
  private dryGain: GainNode;
  private wetGain: GainNode;

  private convolver: ConvolverNode;
  private dampingFilter: BiquadFilterNode;

  private currentParams: ReverbParams = {
    on: false,
    type: 'Stage',
    decay: 5.0,
    amount: 4.0,
    bright: false,
    global: false,
  };

  private isDisposed = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();

    const now = ctx.currentTime;
    this.dryGain.gain.setValueAtTime(1.0, now);
    this.wetGain.gain.setValueAtTime(0.0, now);

    this.convolver = ctx.createConvolver();
    this.dampingFilter = ctx.createBiquadFilter();
    this.dampingFilter.type = 'lowpass';
    this.dampingFilter.frequency.setValueAtTime(6000, now);

    // Dry path: input -> dryGain -> output
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);

    // Wet path: input -> convolver -> dampingFilter -> wetGain -> output
    this.input.connect(this.convolver);
    this.convolver.connect(this.dampingFilter);
    this.dampingFilter.connect(this.wetGain);
    this.wetGain.connect(this.output);

    this.generateImpulseResponse();
    this.applyParams();
  }

  public setParams(params: Partial<ReverbParams>): void {
    if (params.enabled !== undefined) {
      params.on = params.enabled;
    }
    const typeChanged = params.type && params.type !== this.currentParams.type;
    const decayChanged = params.decay !== undefined && Math.abs(params.decay - this.currentParams.decay) > 0.5;

    this.currentParams = { ...this.currentParams, ...params };

    if (typeChanged || decayChanged) {
      this.generateImpulseResponse();
    }

    this.applyParams();
  }

  public getParams(): ReverbParams {
    return { ...this.currentParams };
  }

  public updateParams(params: Partial<ReverbParams>): void {
    this.setParams(params);
  }

  private generateImpulseResponse(): void {
    if (this.isDisposed) return;
    const sampleRate = this.ctx.sampleRate || 44100;
    const type = this.currentParams.type;
    const decayKnob = this.currentParams.decay / 10;

    // Decay durations: Booth < Room < Stage < Hall < Cathedral
    let baseDuration = 1.6;
    if (type === 'Booth') baseDuration = 0.35;
    else if (type === 'Room') baseDuration = 0.85;
    else if (type === 'Stage') baseDuration = 1.7;
    else if (type === 'Hall') baseDuration = 2.8;
    else if (type === 'Cathedral') baseDuration = 5.2;
    else if (type === 'Spring') baseDuration = 1.4;

    const duration = Math.max(0.2, baseDuration * (0.6 + decayKnob * 0.9));
    const length = Math.floor(sampleRate * duration);
    const impulse = this.ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const decayEnvelope = Math.exp((-3.5 * t) / duration);

      if (type === 'Spring') {
        // Spring reverb: Chirped dispersion / boing modulation
        const chirp1 = Math.sin(2 * Math.PI * (120 + t * 400) * t);
        const chirp2 = Math.sin(2 * Math.PI * (340 + t * 650) * t);
        const noise = (Math.random() * 2 - 1) * 0.4;
        const springSignal = (chirp1 * 0.4 + chirp2 * 0.3 + noise) * decayEnvelope;

        left[i] = springSignal * (0.8 + 0.2 * Math.sin(t * 80));
        right[i] = springSignal * (0.8 - 0.2 * Math.sin(t * 80));
      } else {
        // Acoustic space diffuse noise decay
        const noiseL = (Math.random() * 2 - 1) * decayEnvelope;
        const noiseR = (Math.random() * 2 - 1) * decayEnvelope;

        // Early reflections
        let early = 0;
        if (t < 0.04) {
          early = (Math.random() * 2 - 1) * Math.exp(-t * 60) * 0.6;
        }

        left[i] = noiseL + early;
        right[i] = noiseR - early * 0.5;
      }
    }

    try {
      this.convolver.buffer = impulse;
    } catch {}
  }

  private applyParams(): void {
    if (this.isDisposed) return;
    const now = this.ctx.currentTime;
    const isEngaged = this.currentParams.on && this.currentParams.amount > 0.05;

    // Fully wet at max amount (amount = 10 -> dryGain = 0, wetGain = 1.0)
    const amtNorm = this.currentParams.amount / 10;
    const wetLevel = isEngaged ? amtNorm * 1.0 : 0.0;
    const dryLevel = isEngaged ? Math.max(0.0, 1.0 - amtNorm) : 1.0;

    this.dryGain.gain.setTargetAtTime(dryLevel, now, 0.015);
    this.wetGain.gain.setTargetAtTime(wetLevel, now, 0.015);

    // Bright/Dark damping filter
    const cutoffHz = this.currentParams.bright ? 12000 : 4500;
    this.dampingFilter.frequency.setTargetAtTime(cutoffHz, now, 0.02);
  }

  public setType(type: ReverbType): void {
    this.setParams({ type });
  }

  public setBright(bright: boolean): void {
    this.setParams({ bright });
  }

  public setOn(on: boolean): void {
    this.setParams({ on });
  }

  public dispose(): void {
    this.isDisposed = true;
    try {
      this.input.disconnect();
      this.output.disconnect();
      this.dryGain.disconnect();
      this.wetGain.disconnect();
      this.convolver.disconnect();
      this.dampingFilter.disconnect();
    } catch {}
  }
}

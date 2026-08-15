import { CompressorParams } from './types';

export class CompressorEffect {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private ctx: AudioContext;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private compressor: DynamicsCompressorNode;
  private makeupGain: GainNode;

  private currentParams: CompressorParams = {
    on: false,
    amount: 4.0,
    fast: false,
    global: false,
  };

  private isDisposed = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.compressor = ctx.createDynamicsCompressor();
    this.makeupGain = ctx.createGain();

    const now = ctx.currentTime;
    this.dryGain.gain.setValueAtTime(1.0, now);
    this.wetGain.gain.setValueAtTime(0.0, now);

    // Dry bypass path
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);

    // Compressed path: input -> compressor -> makeupGain -> wetGain -> output
    this.input.connect(this.compressor);
    this.compressor.connect(this.makeupGain);
    this.makeupGain.connect(this.wetGain);
    this.wetGain.connect(this.output);

    this.applyParams();
  }

  public setParams(params: Partial<CompressorParams>): void {
    if (params.enabled !== undefined) {
      params.on = params.enabled;
    }
    this.currentParams = { ...this.currentParams, ...params };
    this.applyParams();
  }

  public getParams(): CompressorParams {
    return { ...this.currentParams };
  }

  public updateParams(params: Partial<CompressorParams>): void {
    this.setParams(params);
  }

  private applyParams(): void {
    if (this.isDisposed) return;
    const now = this.ctx.currentTime;
    const isEngaged = this.currentParams.on && this.currentParams.amount > 0.05;

    // Crossfade dry/wet for click-free bypass
    this.dryGain.gain.setTargetAtTime(isEngaged ? 0.0 : 1.0, now, 0.015);
    this.wetGain.gain.setTargetAtTime(isEngaged ? 1.0 : 0.0, now, 0.015);

    // Amount (0..10): threshold from -6dB down to -40dB, ratio from 2:1 up to 16:1
    const amtNorm = this.currentParams.amount / 10;
    const thresholdDb = -6 - amtNorm * 34; // -6 to -40 dB
    const ratioVal = 2.0 + amtNorm * 14.0; // 2:1 to 16:1
    const kneeDb = 6.0 + amtNorm * 12.0;

    // Fast mode recovers quicker and pumps at high amounts
    const attackSec = this.currentParams.fast ? 0.003 : 0.025;
    const releaseSec = this.currentParams.fast ? 0.05 : 0.22;

    // Makeup gain compensates for compression threshold
    const makeupFactor = 1.0 + amtNorm * 1.8;

    this.compressor.threshold.setTargetAtTime(thresholdDb, now, 0.02);
    this.compressor.ratio.setTargetAtTime(ratioVal, now, 0.02);
    this.compressor.knee.setTargetAtTime(kneeDb, now, 0.02);
    this.compressor.attack.setTargetAtTime(attackSec, now, 0.02);
    this.compressor.release.setTargetAtTime(releaseSec, now, 0.02);
    this.makeupGain.gain.setTargetAtTime(makeupFactor, now, 0.02);
  }

  public setFast(fast: boolean): void {
    this.setParams({ fast });
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
      this.compressor.disconnect();
      this.makeupGain.disconnect();
    } catch {}
  }
}

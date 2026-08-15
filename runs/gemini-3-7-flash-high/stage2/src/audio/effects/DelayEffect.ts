import { DelayFilterType, DelayParams } from './types';

export class DelayEffect {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private ctx: AudioContext;
  private dryGain: GainNode;
  private wetGain: GainNode;

  private delayLeft: DelayNode;
  private delayRight: DelayNode;
  private feedbackLeft: GainNode;
  private feedbackRight: GainNode;
  private filterLeft: BiquadFilterNode;
  private filterRight: BiquadFilterNode;

  private currentParams: DelayParams = {
    on: false,
    tempo: 5.0,
    feedback: 4.0,
    amount: 3.0,
    filter: 'Off',
    pingPong: false,
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

    this.delayLeft = ctx.createDelay(2.0);
    this.delayRight = ctx.createDelay(2.0);
    this.feedbackLeft = ctx.createGain();
    this.feedbackRight = ctx.createGain();
    this.filterLeft = ctx.createBiquadFilter();
    this.filterRight = ctx.createBiquadFilter();

    this.filterLeft.type = 'allpass';
    this.filterRight.type = 'allpass';

    // Graph routing:
    // input -> dryGain -> output
    // input -> delayLeft -> filterLeft -> feedbackLeft -> (delayLeft or delayRight for pingpong)
    // filterLeft -> wetGain -> output
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);

    this.input.connect(this.delayLeft);
    this.input.connect(this.delayRight);

    this.delayLeft.connect(this.filterLeft);
    this.delayRight.connect(this.filterRight);

    this.filterLeft.connect(this.feedbackLeft);
    this.filterRight.connect(this.feedbackRight);

    // Initial non-pingpong feedback loop (passes through filter every repeat!)
    this.feedbackLeft.connect(this.delayLeft);
    this.feedbackRight.connect(this.delayRight);

    this.filterLeft.connect(this.wetGain);
    this.filterRight.connect(this.wetGain);
    this.wetGain.connect(this.output);

    this.applyParams();
  }

  public setParams(params: Partial<DelayParams>): void {
    if (params.enabled !== undefined) {
      params.on = params.enabled;
    }
    const pingPongChanged = params.pingPong !== undefined && params.pingPong !== this.currentParams.pingPong;
    this.currentParams = { ...this.currentParams, ...params };

    if (pingPongChanged) {
      this.reconnectFeedback();
    }

    this.applyParams();
  }

  public getParams(): DelayParams {
    return { ...this.currentParams };
  }

  public updateParams(params: Partial<DelayParams>): void {
    this.setParams(params);
  }

  private reconnectFeedback(): void {
    if (this.isDisposed) return;
    try {
      this.feedbackLeft.disconnect();
      this.feedbackRight.disconnect();

      if (this.currentParams.pingPong) {
        // Cross-channel feedback for ping-pong
        this.feedbackLeft.connect(this.delayRight);
        this.feedbackRight.connect(this.delayLeft);
      } else {
        this.feedbackLeft.connect(this.delayLeft);
        this.feedbackRight.connect(this.delayRight);
      }
    } catch {}
  }

  private applyParams(): void {
    if (this.isDisposed) return;
    const now = this.ctx.currentTime;
    const isEngaged = this.currentParams.on && this.currentParams.amount > 0.05;

    // Delay time: 0.05s to 1.0s based on tempo knob (0..10)
    const delayTimeSec = 0.05 + (this.currentParams.tempo / 10) * 0.95;
    const rightDelayTime = this.currentParams.pingPong ? delayTimeSec * 1.5 : delayTimeSec;

    this.delayLeft.delayTime.setTargetAtTime(delayTimeSec, now, 0.03);
    this.delayRight.delayTime.setTargetAtTime(Math.min(1.8, rightDelayTime), now, 0.03);

    // Feedback: 0..0.90
    const fbGain = (this.currentParams.feedback / 10) * 0.88;
    this.feedbackLeft.gain.setTargetAtTime(fbGain, now, 0.02);
    this.feedbackRight.gain.setTargetAtTime(fbGain, now, 0.02);

    // Filter in feedback loop (each repeat is progressively filtered!)
    const filterType = this.currentParams.filter;
    if (filterType === 'LP') {
      this.filterLeft.type = 'lowpass';
      this.filterRight.type = 'lowpass';
      this.filterLeft.frequency.setTargetAtTime(2200, now, 0.02);
      this.filterRight.frequency.setTargetAtTime(2200, now, 0.02);
      this.filterLeft.Q.setTargetAtTime(1.0, now, 0.02);
      this.filterRight.Q.setTargetAtTime(1.0, now, 0.02);
    } else if (filterType === 'HP') {
      this.filterLeft.type = 'highpass';
      this.filterRight.type = 'highpass';
      this.filterLeft.frequency.setTargetAtTime(750, now, 0.02);
      this.filterRight.frequency.setTargetAtTime(750, now, 0.02);
      this.filterLeft.Q.setTargetAtTime(1.0, now, 0.02);
      this.filterRight.Q.setTargetAtTime(1.0, now, 0.02);
    } else if (filterType === 'BP') {
      this.filterLeft.type = 'bandpass';
      this.filterRight.type = 'bandpass';
      this.filterLeft.frequency.setTargetAtTime(1400, now, 0.02);
      this.filterRight.frequency.setTargetAtTime(1400, now, 0.02);
      this.filterLeft.Q.setTargetAtTime(2.0, now, 0.02);
      this.filterRight.Q.setTargetAtTime(2.0, now, 0.02);
    } else {
      this.filterLeft.type = 'allpass';
      this.filterRight.type = 'allpass';
    }

    // Dry / Wet mix crossfade
    const wetLevel = isEngaged ? (this.currentParams.amount / 10) * 0.95 : 0.0;
    const dryLevel = isEngaged ? Math.max(0.1, 1.0 - (this.currentParams.amount / 10) * 0.4) : 1.0;

    this.dryGain.gain.setTargetAtTime(dryLevel, now, 0.015);
    this.wetGain.gain.setTargetAtTime(wetLevel, now, 0.015);
  }

  public setFilter(filter: DelayFilterType): void {
    this.setParams({ filter });
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
      this.delayLeft.disconnect();
      this.delayRight.disconnect();
      this.feedbackLeft.disconnect();
      this.feedbackRight.disconnect();
      this.filterLeft.disconnect();
      this.filterRight.disconnect();
    } catch {}
  }
}

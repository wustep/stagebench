import { AmpEqParams, AmpType } from './types';

export class AmpEqEffect {
  public readonly input: GainNode;
  public readonly output: GainNode;
  public readonly toRotaryOutput: GainNode;

  private ctx: AudioContext;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private toRotaryGain: GainNode;

  // 3-band EQ
  private bassFilter: BiquadFilterNode;
  private midFilter: BiquadFilterNode;
  private trebleFilter: BiquadFilterNode;

  // Amp Drive WaveShaper & Cabinet Filters
  private preDriveGain: GainNode;
  private waveShaper: WaveShaperNode;
  private postDriveGain: GainNode;
  private cabFilterLow: BiquadFilterNode;
  private cabFilterHigh: BiquadFilterNode;

  // 24dB Filters (LP24 & HP24 cascades)
  private filter24_1: BiquadFilterNode;
  private filter24_2: BiquadFilterNode;

  private currentParams: AmpEqParams = {
    on: false,
    type: 'EQ only',
    drive: 2.0,
    bass: 0,
    mid: 0,
    midFreq: 5.0,
    treble: 0,
  };

  private isDisposed = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.toRotaryOutput = ctx.createGain();
    this.toRotaryGain = ctx.createGain();

    const now = ctx.currentTime;
    this.dryGain.gain.setValueAtTime(1.0, now);
    this.wetGain.gain.setValueAtTime(0.0, now);
    this.toRotaryGain.gain.setValueAtTime(0.0, now);

    // Bypass path
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);

    // 3-Band EQ Nodes
    this.bassFilter = ctx.createBiquadFilter();
    this.bassFilter.type = 'lowshelf';
    this.bassFilter.frequency.setValueAtTime(100, now);

    this.midFilter = ctx.createBiquadFilter();
    this.midFilter.type = 'peaking';
    this.midFilter.frequency.setValueAtTime(1000, now);
    this.midFilter.Q.setValueAtTime(1.2, now);

    this.trebleFilter = ctx.createBiquadFilter();
    this.trebleFilter.type = 'highshelf';
    this.trebleFilter.frequency.setValueAtTime(4000, now);

    // Drive & Cabinet Nodes
    this.preDriveGain = ctx.createGain();
    this.waveShaper = ctx.createWaveShaper();
    this.waveShaper.oversample = '2x';
    this.postDriveGain = ctx.createGain();
    this.cabFilterLow = ctx.createBiquadFilter();
    this.cabFilterHigh = ctx.createBiquadFilter();

    // 24dB Filter Nodes
    this.filter24_1 = ctx.createBiquadFilter();
    this.filter24_2 = ctx.createBiquadFilter();

    this.updateDistortionCurve('EQ only', 2.0);

    // Connect Processing Chain:
    // input -> preDriveGain -> waveShaper -> postDriveGain -> cabFilterLow -> cabFilterHigh -> bassFilter -> midFilter -> trebleFilter -> filter24_1 -> filter24_2 -> wetGain -> output
    //                                                                                                                                └-> toRotaryGain -> toRotaryOutput
    this.input.connect(this.preDriveGain);
    this.preDriveGain.connect(this.waveShaper);
    this.waveShaper.connect(this.postDriveGain);
    this.postDriveGain.connect(this.cabFilterLow);
    this.cabFilterLow.connect(this.cabFilterHigh);
    this.cabFilterHigh.connect(this.bassFilter);
    this.bassFilter.connect(this.midFilter);
    this.midFilter.connect(this.trebleFilter);
    this.trebleFilter.connect(this.filter24_1);
    this.filter24_1.connect(this.filter24_2);

    this.filter24_2.connect(this.wetGain);
    this.wetGain.connect(this.output);

    this.filter24_2.connect(this.toRotaryGain);
    this.toRotaryGain.connect(this.toRotaryOutput);

    this.applyParams();
  }

  public setParams(params: Partial<AmpEqParams>): void {
    if (params.enabled !== undefined) {
      params.on = params.enabled;
    }
    const typeChanged = params.type && params.type !== this.currentParams.type;
    const driveChanged = params.drive !== undefined && params.drive !== this.currentParams.drive;

    this.currentParams = { ...this.currentParams, ...params };

    if (typeChanged || driveChanged) {
      this.updateDistortionCurve(this.currentParams.type, this.currentParams.drive);
    }

    this.applyParams();
  }

  public getParams(): AmpEqParams {
    return { ...this.currentParams };
  }

  public updateParams(params: Partial<AmpEqParams>): void {
    this.setParams(params);
  }

  private updateDistortionCurve(type: AmpType, drive: number): void {
    const samples = 1024;
    const curve = new Float32Array(samples);
    const driveNorm = drive / 10;

    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;

      if (type === 'Twin') {
        // Fender Twin: Warm tube saturation with mild compression
        const k = 1.0 + driveNorm * 8.0;
        curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
      } else if (type === 'JC') {
        // Roland JC-120: Crisp clean with subtle top-end clipping
        const k = 1.0 + driveNorm * 4.0;
        curve[i] = Math.tanh(x * k);
      } else if (type === 'Small') {
        // Small combo: Aggressive asymmetric tube fuzz / breakup
        const k = 2.0 + driveNorm * 18.0;
        const shaped = x >= 0 ? Math.tanh(x * k) : Math.tanh(x * k * 0.7) * 1.2;
        curve[i] = Math.max(-1, Math.min(1, shaped));
      } else {
        // EQ only / LP24 / HP24 / To Rotary (linear)
        curve[i] = x;
      }
    }

    try {
      this.waveShaper.curve = curve;
    } catch {}
  }

  private applyParams(): void {
    if (this.isDisposed) return;
    const now = this.ctx.currentTime;
    const isEngaged = this.currentParams.on;
    const isToRotary = this.currentParams.type === 'To Rotary';

    // Crossfade bypass
    this.dryGain.gain.setTargetAtTime(isEngaged ? 0.0 : 1.0, now, 0.015);
    this.wetGain.gain.setTargetAtTime(isEngaged && !isToRotary ? 1.0 : 0.0, now, 0.015);
    this.toRotaryGain.gain.setTargetAtTime(isEngaged && isToRotary ? 1.0 : 0.0, now, 0.015);

    // 3-Band EQ (Bass ±15dB, Mid ±15dB, Treble ±15dB)
    const bassDb = (this.currentParams.bass / 10) * 15;
    const midDb = (this.currentParams.mid / 10) * 15;
    const trebleDb = (this.currentParams.treble / 10) * 15;

    // Mid Freq sweepable: 200 Hz to 8000 Hz (logarithmic)
    const midFreqHz = 200 * Math.pow(40, this.currentParams.midFreq / 10);

    this.bassFilter.gain.setTargetAtTime(bassDb, now, 0.02);
    this.midFilter.frequency.setTargetAtTime(midFreqHz, now, 0.02);
    this.midFilter.gain.setTargetAtTime(midDb, now, 0.02);
    this.trebleFilter.gain.setTargetAtTime(trebleDb, now, 0.02);

    const type = this.currentParams.type;

    // Cabinet simulation filters per amp model
    if (type === 'Twin') {
      this.cabFilterLow.type = 'highpass';
      this.cabFilterLow.frequency.setTargetAtTime(80, now, 0.02);
      this.cabFilterHigh.type = 'lowpass';
      this.cabFilterHigh.frequency.setTargetAtTime(5500, now, 0.02);
      this.preDriveGain.gain.setTargetAtTime(1.0 + (this.currentParams.drive / 10) * 2.5, now, 0.02);
      this.postDriveGain.gain.setTargetAtTime(0.7, now, 0.02);
    } else if (type === 'JC') {
      this.cabFilterLow.type = 'highpass';
      this.cabFilterLow.frequency.setTargetAtTime(120, now, 0.02);
      this.cabFilterHigh.type = 'lowpass';
      this.cabFilterHigh.frequency.setTargetAtTime(8000, now, 0.02);
      this.preDriveGain.gain.setTargetAtTime(1.0 + (this.currentParams.drive / 10) * 1.5, now, 0.02);
      this.postDriveGain.gain.setTargetAtTime(0.85, now, 0.02);
    } else if (type === 'Small') {
      this.cabFilterLow.type = 'highpass';
      this.cabFilterLow.frequency.setTargetAtTime(250, now, 0.02);
      this.cabFilterHigh.type = 'lowpass';
      this.cabFilterHigh.frequency.setTargetAtTime(4000, now, 0.02);
      this.preDriveGain.gain.setTargetAtTime(1.0 + (this.currentParams.drive / 10) * 4.0, now, 0.02);
      this.postDriveGain.gain.setTargetAtTime(0.55, now, 0.02);
    } else {
      this.cabFilterLow.type = 'allpass';
      this.cabFilterHigh.type = 'allpass';
      this.preDriveGain.gain.setTargetAtTime(1.0, now, 0.02);
      this.postDriveGain.gain.setTargetAtTime(1.0, now, 0.02);
    }

    // 24dB Filters (LP24 / HP24)
    if (type === 'LP24 Filter' || (type as string) === 'LP24') {
      this.filter24_1.type = 'lowpass';
      this.filter24_2.type = 'lowpass';
      const cutoff = Math.max(80, Math.min(18000, midFreqHz));
      const resQ = 0.707 + (Math.max(0, this.currentParams.mid) / 10) * 6.0;

      this.filter24_1.frequency.setTargetAtTime(cutoff, now, 0.02);
      this.filter24_2.frequency.setTargetAtTime(cutoff, now, 0.02);
      this.filter24_1.Q.setTargetAtTime(resQ, now, 0.02);
      this.filter24_2.Q.setTargetAtTime(resQ, now, 0.02);
    } else if (type === 'HP24 Filter' || (type as string) === 'HP24') {
      this.filter24_1.type = 'highpass';
      this.filter24_2.type = 'highpass';
      const cutoff = Math.max(80, Math.min(18000, midFreqHz));
      const resQ = 0.707 + (Math.max(0, this.currentParams.mid) / 10) * 6.0;

      this.filter24_1.frequency.setTargetAtTime(cutoff, now, 0.02);
      this.filter24_2.frequency.setTargetAtTime(cutoff, now, 0.02);
      this.filter24_1.Q.setTargetAtTime(resQ, now, 0.02);
      this.filter24_2.Q.setTargetAtTime(resQ, now, 0.02);
    } else {
      this.filter24_1.type = 'allpass';
      this.filter24_2.type = 'allpass';
    }
  }

  public setType(type: AmpType): void {
    this.setParams({ type });
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
      this.toRotaryGain.disconnect();
      this.toRotaryOutput.disconnect();
      this.bassFilter.disconnect();
      this.midFilter.disconnect();
      this.trebleFilter.disconnect();
      this.preDriveGain.disconnect();
      this.waveShaper.disconnect();
      this.postDriveGain.disconnect();
      this.cabFilterLow.disconnect();
      this.cabFilterHigh.disconnect();
      this.filter24_1.disconnect();
      this.filter24_2.disconnect();
    } catch {}
  }
}

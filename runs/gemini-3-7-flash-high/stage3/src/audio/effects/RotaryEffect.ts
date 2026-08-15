import { RotaryParams } from './types';

export class RotaryEffect {
  public readonly input: GainNode;
  public readonly output: GainNode;

  private ctx: AudioContext;
  private driveGain: GainNode;
  private waveShaper: WaveShaperNode;

  // Split horn (treble) & rotor (bass)
  private hornFilter: BiquadFilterNode;
  private rotorFilter: BiquadFilterNode;
  private hornPanner: StereoPannerNode | null = null;
  private rotorPanner: StereoPannerNode | null = null;
  private hornGain: GainNode;
  private rotorGain: GainNode;

  private hornLfo: OscillatorNode | null = null;
  private rotorLfo: OscillatorNode | null = null;
  private hornLfoGain: GainNode | null = null;
  private rotorLfoGain: GainNode | null = null;

  private currentParams: RotaryParams = {
    on: true,
    speed: 'slow',
    stop: false,
    drive: 2.0,
  };

  private isDisposed = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    const now = ctx.currentTime;
    this.driveGain = ctx.createGain();
    this.waveShaper = ctx.createWaveShaper();
    this.waveShaper.oversample = '2x';

    this.hornFilter = ctx.createBiquadFilter();
    this.hornFilter.type = 'highpass';
    this.hornFilter.frequency.setValueAtTime(800, now);

    this.rotorFilter = ctx.createBiquadFilter();
    this.rotorFilter.type = 'lowpass';
    this.rotorFilter.frequency.setValueAtTime(800, now);

    this.hornGain = ctx.createGain();
    this.rotorGain = ctx.createGain();

    this.updateDriveCurve(2.0);

    // Graph routing:
    // input -> driveGain -> waveShaper -> hornFilter -> hornPanner -> hornGain -> output
    //                                  -> rotorFilter -> rotorPanner -> rotorGain -> output
    this.input.connect(this.driveGain);
    this.driveGain.connect(this.waveShaper);

    this.waveShaper.connect(this.hornFilter);
    this.waveShaper.connect(this.rotorFilter);

    try {
      if (ctx.createStereoPanner) {
        this.hornPanner = ctx.createStereoPanner();
        this.rotorPanner = ctx.createStereoPanner();

        this.hornLfo = ctx.createOscillator();
        this.rotorLfo = ctx.createOscillator();
        this.hornLfoGain = ctx.createGain();
        this.rotorLfoGain = ctx.createGain();

        this.hornLfo.frequency.setValueAtTime(0.8, now);
        this.rotorLfo.frequency.setValueAtTime(0.7, now);
        this.hornLfoGain.gain.setValueAtTime(0.85, now);
        this.rotorLfoGain.gain.setValueAtTime(0.65, now);

        this.hornLfo.connect(this.hornLfoGain);
        this.rotorLfo.connect(this.rotorLfoGain);
        this.hornLfoGain.connect(this.hornPanner.pan);
        this.rotorLfoGain.connect(this.rotorPanner.pan);

        this.hornLfo.start(now);
        this.rotorLfo.start(now);

        this.hornFilter.connect(this.hornPanner);
        this.hornPanner.connect(this.hornGain);

        this.rotorFilter.connect(this.rotorPanner);
        this.rotorPanner.connect(this.rotorGain);
      } else {
        this.hornFilter.connect(this.hornGain);
        this.rotorFilter.connect(this.rotorGain);
      }
    } catch {
      this.hornFilter.connect(this.hornGain);
      this.rotorFilter.connect(this.rotorGain);
    }

    this.hornGain.connect(this.output);
    this.rotorGain.connect(this.output);

    this.applyParams();
  }

  public setParams(params: Partial<RotaryParams>): void {
    if (params.enabled !== undefined) {
      params.on = params.enabled;
    }
    const driveChanged = params.drive !== undefined && params.drive !== this.currentParams.drive;
    this.currentParams = { ...this.currentParams, ...params };

    if (driveChanged) {
      this.updateDriveCurve(this.currentParams.drive);
    }

    this.applyParams();
  }

  public getParams(): RotaryParams {
    return { ...this.currentParams };
  }

  public updateParams(params: Partial<RotaryParams>): void {
    this.setParams(params);
  }

  private updateDriveCurve(drive: number): void {
    const samples = 1024;
    const curve = new Float32Array(samples);
    const k = 1.0 + (drive / 10) * 6.0;

    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(x * k);
    }

    try {
      this.waveShaper.curve = curve;
    } catch {}
  }

  private applyParams(): void {
    if (this.isDisposed) return;
    const now = this.ctx.currentTime;

    // Speeds: Slow horn=0.8Hz / rotor=0.7Hz; Fast horn=6.8Hz / rotor=5.9Hz; Stop=0.001Hz
    let targetHornHz = 0.8;
    let targetRotorHz = 0.7;
    const speedLower = (this.currentParams.speed || '').toLowerCase();

    if (this.currentParams.stop) {
      targetHornHz = 0.001;
      targetRotorHz = 0.001;
    } else if (speedLower === 'fast') {
      targetHornHz = 6.8;
      targetRotorHz = 5.9;
    }

    // Horn accelerates quickly (~0.8s), Rotor has more inertia (~1.8s)
    if (this.hornLfo) {
      try {
        this.hornLfo.frequency.setTargetAtTime(targetHornHz, now, 0.4);
      } catch {}
    }
    if (this.rotorLfo) {
      try {
        this.rotorLfo.frequency.setTargetAtTime(targetRotorHz, now, 0.9);
      } catch {}
    }
  }

  public setSpeed(speed: 'slow' | 'fast'): void {
    this.setParams({ speed, stop: false });
  }

  public toggleSpeed(): void {
    this.setSpeed(this.currentParams.speed === 'slow' ? 'fast' : 'slow');
  }

  public setStop(stop: boolean): void {
    this.setParams({ stop });
  }

  public dispose(): void {
    this.isDisposed = true;
    if (this.hornLfo) {
      try {
        this.hornLfo.stop();
        this.hornLfo.disconnect();
      } catch {}
      this.hornLfo = null;
    }
    if (this.rotorLfo) {
      try {
        this.rotorLfo.stop();
        this.rotorLfo.disconnect();
      } catch {}
      this.rotorLfo = null;
    }
    try {
      this.input.disconnect();
      this.output.disconnect();
      this.driveGain.disconnect();
      this.waveShaper.disconnect();
      this.hornFilter.disconnect();
      this.rotorFilter.disconnect();
      if (this.hornPanner) this.hornPanner.disconnect();
      if (this.rotorPanner) this.rotorPanner.disconnect();
      this.hornGain.disconnect();
      this.rotorGain.disconnect();
    } catch {}
  }
}

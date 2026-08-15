import { VibratoChorusMode } from './types';

export class OrganVibratoChorus {
  private ctx: AudioContext;
  public input: GainNode;
  public output: GainNode;

  private dryGain: GainNode;
  private wetGain: GainNode;
  private delayNode: DelayNode;
  private lfo: OscillatorNode;
  private lfoGain: GainNode;

  private isEnabled: boolean = false;
  private mode: VibratoChorusMode = 'V1';

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    const now = ctx.currentTime;

    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.dryGain = ctx.createGain();
    this.wetGain = ctx.createGain();

    this.delayNode = ctx.createDelay(0.05);
    this.delayNode.delayTime.setValueAtTime(0.005, now);

    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.setValueAtTime(6.8, now); // Hammond scanner rate ~6.8 Hz

    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.setValueAtTime(0.0015, now);

    // LFO -> DelayTime
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.delayNode.delayTime);

    // Input -> Dry -> Output
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);

    // Input -> Delay -> Wet -> Output
    this.input.connect(this.delayNode);
    this.delayNode.connect(this.wetGain);
    this.wetGain.connect(this.output);

    try {
      this.lfo.start(now);
    } catch {
      // Ignored if already running or mock
    }

    this.updateGains();
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    this.updateGains();
  }

  public setMode(mode: VibratoChorusMode): void {
    this.mode = mode;
    this.updateGains();
  }

  private updateGains(): void {
    const now = this.ctx.currentTime;
    if (!this.isEnabled) {
      this.dryGain.gain.setTargetAtTime(1.0, now, 0.01);
      this.wetGain.gain.setTargetAtTime(0.0, now, 0.01);
      return;
    }

    const isChorus = this.mode.startsWith('C');
    const depthLevel = parseInt(this.mode[1] || '1', 10); // 1, 2, or 3

    // Modulation depth in seconds
    const depthSeconds = 0.001 + depthLevel * 0.0012; // Level 1: 0.0022s, Level 2: 0.0034s, Level 3: 0.0046s
    this.lfoGain.gain.setTargetAtTime(depthSeconds, now, 0.015);

    if (isChorus) {
      // Chorus: mix dry and wet 50/50
      this.dryGain.gain.setTargetAtTime(0.7, now, 0.01);
      this.wetGain.gain.setTargetAtTime(0.7, now, 0.01);
    } else {
      // Vibrato: 100% wet
      this.dryGain.gain.setTargetAtTime(0.0, now, 0.01);
      this.wetGain.gain.setTargetAtTime(1.0, now, 0.01);
    }
  }

  public dispose(): void {
    try {
      this.lfo.stop();
      this.lfo.disconnect();
      this.lfoGain.disconnect();
      this.delayNode.disconnect();
      this.dryGain.disconnect();
      this.wetGain.disconnect();
      this.input.disconnect();
      this.output.disconnect();
    } catch {}
  }
}

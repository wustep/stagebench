import { Mod1Effect } from './Mod1Effect';
import { Mod2Effect } from './Mod2Effect';
import { DelayEffect } from './DelayEffect';
import { AmpEqEffect } from './AmpEqEffect';
import { CompressorEffect } from './CompressorEffect';
import { ReverbEffect } from './ReverbEffect';
import { RotaryEffect } from './RotaryEffect';
import {
  Mod1Params,
  Mod2Params,
  DelayParams,
  AmpEqParams,
  CompressorParams,
  ReverbParams,
} from './types';

export class EffectChain {
  public readonly input: GainNode;
  public readonly output: GainNode;
  public get inputBus(): GainNode {
    return this.input;
  }
  public get outputBus(): GainNode {
    return this.output;
  }

  public readonly mod1: Mod1Effect;
  public readonly mod2: Mod2Effect;
  public readonly delay: DelayEffect;
  public readonly ampEq: AmpEqEffect;
  public readonly compressor: CompressorEffect;
  public readonly reverb: ReverbEffect;

  private ctx: AudioContext;
  private sharedRotary: RotaryEffect;
  private allEffectsBypassGain: GainNode;
  private chainOutputGain: GainNode;
  private isAllEffectsBypassed = false;
  private isRoutedToRotary = false;
  private isDisposed = false;

  constructor(ctx: AudioContext, sharedRotary: RotaryEffect) {
    this.ctx = ctx;
    this.sharedRotary = sharedRotary;

    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.allEffectsBypassGain = ctx.createGain();
    this.chainOutputGain = ctx.createGain();

    const now = ctx.currentTime;
    this.allEffectsBypassGain.gain.setValueAtTime(0.0, now);
    this.chainOutputGain.gain.setValueAtTime(1.0, now);

    // Instantiate 6 effect units
    this.mod1 = new Mod1Effect(ctx);
    this.mod2 = new Mod2Effect(ctx);
    this.delay = new DelayEffect(ctx);
    this.ampEq = new AmpEqEffect(ctx);
    this.compressor = new CompressorEffect(ctx);
    this.reverb = new ReverbEffect(ctx);

    // Direct all-effects bypass path: input -> allEffectsBypassGain -> output
    this.input.connect(this.allEffectsBypassGain);
    this.allEffectsBypassGain.connect(this.output);

    // Documented Signal Order:
    // Layer source -> Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ or Filter -> Compressor -> Reverb -> (Rotary when routed) -> output
    this.input.connect(this.mod1.input);
    this.mod1.output.connect(this.mod2.input);
    this.mod2.output.connect(this.delay.input);
    this.delay.output.connect(this.ampEq.input);

    // AmpEq has 2 outputs: normal wet/dry output AND toRotaryOutput
    this.ampEq.output.connect(this.compressor.input);
    this.ampEq.toRotaryOutput.connect(this.compressor.input);

    this.compressor.output.connect(this.reverb.input);

    // Reverb connects to chainOutputGain -> output AND to shared rotary when routed
    this.reverb.output.connect(this.chainOutputGain);
    this.chainOutputGain.connect(this.output);
  }

  public setAllEffectsBypass(bypassed: boolean): void {
    this.isAllEffectsBypassed = bypassed;
    const now = this.ctx.currentTime;

    // Crossfade all-effects bypass click-free
    this.allEffectsBypassGain.gain.setTargetAtTime(bypassed ? 1.0 : 0.0, now, 0.015);
    this.chainOutputGain.gain.setTargetAtTime(bypassed ? 0.0 : 1.0, now, 0.015);
  }

  public isBypassed(): boolean {
    return this.isAllEffectsBypassed;
  }

  public updateMod1(params: Partial<Mod1Params>): void {
    this.mod1.setParams(params);
  }

  public updateMod2(params: Partial<Mod2Params>): void {
    this.mod2.setParams(params);
  }

  public updateDelay(params: Partial<DelayParams>): void {
    this.delay.setParams(params);
  }

  public routeToRotary(route: boolean): void {
    this.isRoutedToRotary = route;
    if (route) {
      try {
        this.reverb.output.connect(this.sharedRotary.input);
      } catch {}
    } else {
      try {
        this.reverb.output.disconnect(this.sharedRotary.input);
      } catch {}
    }
  }

  public isToRotary(): boolean {
    return this.isRoutedToRotary;
  }

  public updateAmpEq(params: Partial<AmpEqParams>): void {
    this.ampEq.setParams(params);
    const toRotary = params.toRotary ?? (params.type === 'To Rotary');
    if (toRotary !== undefined) {
      this.routeToRotary(toRotary && (params.on ?? (params.enabled ?? true)));
    }
  }

  public updateCompressor(params: Partial<CompressorParams>): void {
    this.compressor.setParams(params);
  }

  public updateReverb(params: Partial<ReverbParams>): void {
    this.reverb.setParams(params);
  }

  public dispose(): void {
    this.isDisposed = true;
    this.mod1.dispose();
    this.mod2.dispose();
    this.delay.dispose();
    this.ampEq.dispose();
    this.compressor.dispose();
    this.reverb.dispose();

    try {
      this.input.disconnect();
      this.output.disconnect();
      this.allEffectsBypassGain.disconnect();
      this.chainOutputGain.disconnect();
      this.reverb.output.disconnect(this.sharedRotary.input);
    } catch {}
  }
}

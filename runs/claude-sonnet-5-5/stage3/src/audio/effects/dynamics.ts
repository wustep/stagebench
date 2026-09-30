import type { CompState } from '../../engine/state'
import { clamp, dbToGain } from '../params'
import type { AudioContextLike, CompressorLike, GainNodeLike } from '../types'
import { ramp, Rig, type FxNode } from './rig'

/** Compressor effect: amount raises the ratio and lowers the threshold, with make-up gain; fast mode reacts and recovers quicker. */
export class CompressorUnit implements FxNode {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly rig: Rig
  private readonly comp: CompressorLike
  private readonly makeup: GainNodeLike
  private readonly dry: GainNodeLike
  private readonly wet: GainNodeLike

  constructor(private readonly ctx: AudioContextLike) {
    const rig = (this.rig = new Rig(ctx))
    this.input = rig.gain(1)
    this.output = rig.gain(1)
    this.dry = rig.gain(1)
    this.wet = rig.gain(0)
    this.comp = rig.add(ctx.createDynamicsCompressor())
    this.makeup = rig.gain(1)
    this.input.connect(this.dry)
    this.dry.connect(this.output)
    this.input.connect(this.comp)
    this.comp.connect(this.makeup)
    this.makeup.connect(this.wet)
    this.wet.connect(this.output)
  }

  /** current gain reduction in dB (0 when the unit is idle or the context cannot tell) */
  get reduction(): number {
    return this.comp.reduction ?? 0
  }

  apply(cfg: CompState, active: boolean): void {
    const ctx = this.ctx
    if (!active) {
      ramp(ctx, this.dry.gain, 1)
      ramp(ctx, this.wet.gain, 0)
      return
    }
    const a = clamp(cfg.amount, 0, 1)
    const threshold = -6 - 34 * a
    const ratio = 2 + 14 * a
    this.comp.threshold.value = threshold
    this.comp.knee.value = 8
    this.comp.ratio.value = ratio
    this.comp.attack.value = cfg.fast ? 0.002 : 0.012
    this.comp.release.value = cfg.fast ? 0.08 : 0.3
    // make-up: give back about half of the average gain reduction
    ramp(ctx, this.makeup.gain, dbToGain(0.5 * -threshold * (1 - 1 / ratio)))
    ramp(ctx, this.dry.gain, 0)
    ramp(ctx, this.wet.gain, 1)
  }

  dispose(): void {
    this.rig.dispose()
  }
}

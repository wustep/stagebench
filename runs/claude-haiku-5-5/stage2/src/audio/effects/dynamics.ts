// Compressor (the effect, not the piano's Dyn Comp). Higher Amount lowers the threshold and raises
// the ratio, so the dynamic range audibly narrows. Fast mode recovers quicker, which pumps at high
// Amount. A makeup stage keeps the level roughly steady as the amount rises.

import type { AudioContextLike, DynamicsCompressorNodeLike, GainNodeLike } from '../audioBoundary'
import { EffectSlot } from './slot'
import { clamp01, gainNode, ramp } from './nodes'
import type { CompSettings } from './types'

export class CompressorUnit {
  readonly slot: EffectSlot
  private readonly context: AudioContextLike
  private compressor: DynamicsCompressorNodeLike | undefined
  private makeup: GainNodeLike | undefined

  constructor(context: AudioContextLike) {
    this.context = context
    this.slot = new EffectSlot(context, {
      build: (ctx, bag, wetIn) => {
        const compressor = bag.add(ctx.createDynamicsCompressor())
        const makeup = gainNode(ctx, bag, 1)
        wetIn.connect(compressor)
        compressor.connect(makeup)
        this.compressor = compressor
        this.makeup = makeup
        return makeup
      },
    })
  }

  apply(settings: CompSettings): void {
    this.slot.setOn(settings.on)
    if (!this.compressor || !this.makeup) return
    const amount = clamp01(settings.amount)
    ramp(this.context, this.compressor.threshold, -6 - 30 * amount)
    ramp(this.context, this.compressor.ratio, 2 + 10 * amount)
    ramp(this.context, this.compressor.knee, 6)
    ramp(this.context, this.compressor.attack, settings.fast ? 0.001 : 0.012)
    ramp(this.context, this.compressor.release, settings.fast ? 0.05 : 0.25)
    ramp(this.context, this.makeup.gain, 1 + 0.8 * amount)
  }

  dispose(): void {
    this.slot.dispose()
  }
}

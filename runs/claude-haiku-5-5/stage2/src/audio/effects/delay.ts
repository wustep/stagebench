// Delay: a delay line whose repeats pass back through a feedback filter. The filter sits inside the
// loop, so every repeat is filtered again and grows darker (LP), thinner (HP), or narrower (BP).
// The dry path never touches the filter. Time runs 60 to 1000 ms on the Time control.

import type { AudioContextLike, BiquadFilterNodeLike, DelayNodeLike, GainNodeLike } from '../audioBoundary'
import { EffectSlot } from './slot'
import { gainNode, ramp, clamp01 } from './nodes'
import { DELAY_FILTERS, type DelaySettings } from './types'

const MAX_DELAY_SECONDS = 1
const MAX_FEEDBACK = 0.85

/** Feedback filter settings per DELAY_FILTERS entry. Off is a 20 kHz low-pass, which is transparent. */
const FILTERS: readonly { type: BiquadFilterNodeLike['type']; hz: number; q: number }[] = [
  { type: 'lowpass', hz: 20000, q: 0.7 },
  { type: 'lowpass', hz: 1600, q: 0.7 },
  { type: 'highpass', hz: 600, q: 0.8 },
  { type: 'bandpass', hz: 1400, q: 1.2 },
]

export function delaySeconds(time: number): number {
  return 0.06 + 0.94 * clamp01(time)
}

export class DelayUnit {
  readonly slot: EffectSlot
  private readonly context: AudioContextLike
  private delay: DelayNodeLike | undefined
  private feedback: GainNodeLike | undefined
  private filter: BiquadFilterNodeLike | undefined
  private filterIndex = -1

  constructor(context: AudioContextLike) {
    this.context = context
    this.slot = new EffectSlot(context, {
      build: (ctx, bag, wetIn) => {
        const delay = bag.add(ctx.createDelay(MAX_DELAY_SECONDS))
        delay.delayTime.setValueAtTime(delaySeconds(0.4), ctx.currentTime)
        const filter = bag.add(ctx.createBiquadFilter())
        const feedback = gainNode(ctx, bag, 0)
        wetIn.connect(delay)
        delay.connect(filter)
        filter.connect(feedback)
        feedback.connect(delay)
        this.delay = delay
        this.filter = filter
        this.feedback = feedback
        return delay
      },
    })
  }

  apply(settings: DelaySettings): void {
    this.slot.setOn(settings.on)
    this.slot.setMix(settings.mix)
    if (!this.delay || !this.feedback || !this.filter) return
    ramp(this.context, this.delay.delayTime, delaySeconds(settings.time))
    ramp(this.context, this.feedback.gain, MAX_FEEDBACK * clamp01(settings.feedback))
    const index = Math.min(DELAY_FILTERS.length - 1, Math.max(0, settings.filter))
    if (index !== this.filterIndex) {
      this.filterIndex = index
      const shape = FILTERS[index]
      this.filter.type = shape.type
      this.filter.frequency.setValueAtTime(shape.hz, this.context.currentTime)
      this.filter.Q.setValueAtTime(shape.q, this.context.currentTime)
    }
  }

  dispose(): void {
    this.slot.dispose()
  }
}

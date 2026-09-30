import type { DelayState } from '../../engine/state'
import { clamp, delaySeconds } from '../params'
import type { AudioContextLike, BiquadLike, GainNodeLike } from '../types'
import { ramp, Rig, type FxNode } from './rig'

const FILTER_SETTINGS: Record<DelayState['filter'], { type: string; frequency: number; q: number }> = {
  Off: { type: 'lowpass', frequency: 20000, q: 0.5 },
  LP: { type: 'lowpass', frequency: 1500, q: 0.7 },
  HP: { type: 'highpass', frequency: 1100, q: 0.7 },
  BP: { type: 'bandpass', frequency: 1300, q: 1.1 },
}

/**
 * Delay with a filtered feedback loop.
 *
 *   input ─┬─► dry ───────────────────────────────► output
 *          └─► delay ─┬─► wet ───────────────────► output
 *                     └─► feedback filter ─► feedback gain ─► delay      (every repeat is filtered again)
 *
 * Ping-pong swaps the mono loop for a two-delay cross-fed loop panned hard left / right; both loops always exist and
 * a crossfade selects the audible one.
 */
export class DelayUnit implements FxNode {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly rig: Rig
  private readonly dry: GainNodeLike
  private readonly wetMono: GainNodeLike
  private readonly wetPing: GainNodeLike
  private readonly delay: ReturnType<Rig['delay']>
  private readonly fbFilter: BiquadLike
  private readonly fbGain: GainNodeLike
  private readonly delayL: ReturnType<Rig['delay']>
  private readonly delayR: ReturnType<Rig['delay']>
  private readonly fbFilterL: BiquadLike
  private readonly fbFilterR: BiquadLike
  private readonly fbGainLR: GainNodeLike
  private readonly fbGainRL: GainNodeLike
  private filterName: DelayState['filter'] = 'Off'

  constructor(private readonly ctx: AudioContextLike) {
    const rig = (this.rig = new Rig(ctx))
    this.input = rig.gain(1)
    this.output = rig.gain(1)
    this.dry = rig.gain(1)
    this.wetMono = rig.gain(0)
    this.wetPing = rig.gain(0)
    this.input.connect(this.dry)
    this.dry.connect(this.output)

    // mono loop
    this.delay = rig.delay(2, delaySeconds(0.35))
    this.fbFilter = rig.biquad('lowpass', 20000, 0.5)
    this.fbGain = rig.gain(0)
    this.input.connect(this.delay)
    this.delay.connect(this.wetMono)
    this.wetMono.connect(this.output)
    this.delay.connect(this.fbFilter)
    this.fbFilter.connect(this.fbGain)
    this.fbGain.connect(this.delay)

    // ping-pong loop: input → L, L → R → L
    this.delayL = rig.delay(2, delaySeconds(0.35))
    this.delayR = rig.delay(2, delaySeconds(0.35))
    this.fbFilterL = rig.biquad('lowpass', 20000, 0.5)
    this.fbFilterR = rig.biquad('lowpass', 20000, 0.5)
    this.fbGainLR = rig.gain(0)
    this.fbGainRL = rig.gain(0)
    const panL = rig.panner(-0.9)
    const panR = rig.panner(0.9)
    this.input.connect(this.delayL)
    this.delayL.connect(this.fbFilterL)
    this.fbFilterL.connect(this.fbGainLR)
    this.fbGainLR.connect(this.delayR)
    this.delayR.connect(this.fbFilterR)
    this.fbFilterR.connect(this.fbGainRL)
    this.fbGainRL.connect(this.delayL)
    this.delayL.connect(panL)
    this.delayR.connect(panR)
    panL.connect(this.wetPing)
    panR.connect(this.wetPing)
    this.wetPing.connect(this.output)
  }

  apply(cfg: DelayState, active: boolean): void {
    const ctx = this.ctx
    if (!active) {
      // wet ramps out; the loop keeps running so repeats decay naturally instead of being cut
      ramp(ctx, this.dry.gain, 1)
      ramp(ctx, this.wetMono.gain, 0)
      ramp(ctx, this.wetPing.gain, 0)
      return
    }
    const seconds = delaySeconds(cfg.tempo)
    const feedback = clamp(cfg.feedback, 0, 1) * 0.88
    ramp(ctx, this.delay.delayTime, seconds, 0.05)
    ramp(ctx, this.delayL.delayTime, seconds, 0.05)
    ramp(ctx, this.delayR.delayTime, seconds, 0.05)
    ramp(ctx, this.fbGain.gain, feedback)
    ramp(ctx, this.fbGainLR.gain, feedback)
    ramp(ctx, this.fbGainRL.gain, feedback)
    if (cfg.filter !== this.filterName) {
      this.filterName = cfg.filter
      const f = FILTER_SETTINGS[cfg.filter]
      for (const node of [this.fbFilter, this.fbFilterL, this.fbFilterR]) {
        node.type = f.type
        ramp(ctx, node.frequency, f.frequency)
        node.Q.value = f.q
      }
    }
    // equal-power dry/wet: fully wet at maximum
    const angle = clamp(cfg.dryWet, 0, 1) * Math.PI * 0.5
    ramp(ctx, this.dry.gain, Math.cos(angle))
    const wet = Math.sin(angle)
    ramp(ctx, this.wetMono.gain, cfg.pingPong ? 0 : wet)
    ramp(ctx, this.wetPing.gain, cfg.pingPong ? wet : 0)
  }

  dispose(): void {
    this.rig.dispose()
  }
}

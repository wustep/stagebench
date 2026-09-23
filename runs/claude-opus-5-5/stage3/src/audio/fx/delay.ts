// Delay (manual p. 51): a feedback delay whose feedback filter sits inside the loop, so every
// successive repeat passes through the filter again (progressively more filtered) while the dry
// path is untouched. Tempo knob and tap tempo share one mapping.
import type { DelayState } from '../../model/sound'
import type { AudioContextLike, BiquadLike, DelayLike, GainLike } from '../webAudioTypes'
import { expRange, FxUnit, glideTo, rampTo, unit } from './common'

export const DELAY_MIN = 0.03
export const DELAY_MAX = 1.5

/** Tempo knob (0…127) → delay time in seconds. */
export const delaySeconds = (tempo: number) => expRange(tempo, DELAY_MIN, DELAY_MAX)

/** Inverse of delaySeconds: the knob position for a tapped interval (clamped to the range). */
export function tempoForSeconds(seconds: number): number {
  const s = Math.min(DELAY_MAX, Math.max(DELAY_MIN, seconds))
  return Math.round((127 * Math.log(s / DELAY_MIN)) / Math.log(DELAY_MAX / DELAY_MIN))
}

/** Feedback knob → loop gain (kept below 1 so the loop always decays). */
export const feedbackGain = (feedback: number) => 0.9 * unit(feedback)

/** Dry/Wet knob → [dry, wet]: centre = both full, ends = dry only / wet only. */
export function dryWet(v: number): [number, number] {
  const w = unit(v)
  return [Math.min(1, 2 * (1 - w)), Math.min(1, 2 * w)]
}

const FILTERS: Record<DelayState['filter'], { type: string; freq: number; q: number }> = {
  off: { type: 'allpass', freq: 20, q: 0.0001 },
  lp: { type: 'lowpass', freq: 1400, q: 0.7 },
  hp: { type: 'highpass', freq: 1200, q: 0.7 },
  bp: { type: 'bandpass', freq: 1300, q: 1.1 },
}

/** Tap tempo: the interval between the last two taps, if it is a plausible delay time. */
export class TapTempo {
  private last: number | null = null
  tap(nowMs: number): number | null {
    const prev = this.last
    this.last = nowMs
    if (prev === null) return null
    const s = (nowMs - prev) / 1000
    return s >= DELAY_MIN && s <= 3 ? s : null
  }
}

export class DelayUnit extends FxUnit<DelayState> {
  readonly line: DelayLike
  readonly filter: BiquadLike
  readonly feedback: GainLike
  private filterType: string | null = null
  private started = false

  constructor(ctx: AudioContextLike) {
    super(ctx)
    const b = this.bag
    const sum = b.gain(1)
    this.line = b.add(ctx.createDelay(DELAY_MAX + 0.1))
    this.line.delayTime.value = delaySeconds(60)
    this.filter = b.add(ctx.createBiquadFilter())
    this.feedback = b.gain(0)
    // input → sum → delay line → filter → wet; filter → feedback → sum (the filter is in the loop).
    this.input.connect(sum)
    sum.connect(this.line)
    this.line.connect(this.filter)
    this.filter.connect(this.wet)
    this.filter.connect(this.feedback)
    this.feedback.connect(sum)
  }

  /** Current delay time (s) for the settings; `synced` = Master Clock subdivision (clamped to range). */
  static time(s: DelayState, synced?: number): number {
    return synced === undefined ? delaySeconds(s.tempo) : Math.min(DELAY_MAX, Math.max(DELAY_MIN, synced))
  }

  apply(s: DelayState, active: boolean, now: number, synced?: number): void {
    // Tempo changes glide (tape-like, no clicks); the first setting is exact.
    const time = DelayUnit.time(s, synced)
    if (this.started) glideTo(this.line.delayTime, time, now, 0.03)
    else this.line.delayTime.setValueAtTime(time, now)
    this.started = true
    rampTo(this.feedback.gain, feedbackGain(s.feedback), now)
    const f = FILTERS[s.filter]
    if (this.filterType !== s.filter) {
      this.filter.type = f.type
      this.filterType = s.filter
    }
    glideTo(this.filter.frequency, f.freq, now)
    this.filter.Q.value = f.q
    const [dry, wet] = dryWet(s.dryWet)
    // Bypass keeps the dry path and stops feeding the loop; existing repeats are cut by the wet ramp.
    if (active) this.mix(dry, wet, now)
    else this.mix(1, 0, now)
  }
}

/**
 * MASTER: the Master Level knob (audio-taper gain, smoothed over ≈15 ms) followed by a peak limiter (threshold 0.95,
 * 0.3 ms attack, 80 ms release) and a final hard clip at ±1, so nothing leaving the instrument exceeds full scale.
 */
import { clamp, masterKnobToGain, type MasterParams, type StereoProcessor } from './types'
import { Smoother } from './util'

export const LIMITER_THRESHOLD = 0.95

export class MasterUnit implements StereoProcessor {
  private readonly gain: Smoother
  private env = 0
  private red = 1
  private started = false
  private readonly ka: number
  private readonly kr: number

  constructor(sr: number) {
    this.gain = new Smoother(sr, 15, masterKnobToGain(7))
    this.ka = 1 - Math.exp(-1000 / (0.3 * sr))
    this.kr = 1 - Math.exp(-1000 / (80 * sr))
  }

  /** Current limiter gain reduction in dB (≥ 0). */
  get gainReduction() {
    return -20 * Math.log10(this.red)
  }

  get level() {
    return this.gain.target
  }

  setParams(p: MasterParams) {
    const g = masterKnobToGain(clamp(p.level, 0, 10))
    if (!this.started) this.gain.snap(g)
    else this.gain.set(g)
  }

  process(l: Float32Array, r: Float32Array, n: number) {
    this.started = true
    for (let i = 0; i < n; i++) {
      const g = this.gain.next()
      const xl = l[i] * g
      const xr = r[i] * g
      const pk = Math.max(Math.abs(xl), Math.abs(xr))
      this.env += (pk - this.env) * (pk > this.env ? this.ka : this.kr)
      this.red = this.env > LIMITER_THRESHOLD ? LIMITER_THRESHOLD / this.env : 1
      let yl = xl * this.red
      let yr = xr * this.red
      if (yl > 1) yl = 1
      else if (yl < -1) yl = -1
      if (yr > 1) yr = 1
      else if (yr < -1) yr = -1
      l[i] = yl
      r[i] = yr
    }
  }

  reset() {
    this.env = 0
    this.red = 1
    this.gain.snap(this.gain.target)
  }
}

/**
 * COMPRESSOR (manual p. 52): feed-forward peak compressor. Amount 0 is exact unity; higher amounts lower the
 * threshold (−6 → −36 dB), raise the ratio (1.5:1 → 8:1) and add make-up gain chosen so a −18 dBFS signal keeps
 * roughly its level, so soft playing gets louder and loud playing quieter. Normal mode: 10 ms attack / 300 ms release;
 * FAST mode: 1 ms / 50 ms, which recovers quickly and pumps audibly at high amounts.
 */
import { clamp, dbToGain, knob01, type CompressorParams, type StereoProcessor } from './types'
import { Smoother } from './util'

export class CompressorUnit implements StereoProcessor {
  private readonly amount: Smoother
  private fast = false
  private env = 0
  private gr = 0
  private started = false
  private readonly kaNormal: number
  private readonly krNormal: number
  private readonly kaFast: number
  private readonly krFast: number

  constructor(sr: number) {
    this.amount = new Smoother(sr, 10, 0)
    const coef = (ms: number) => 1 - Math.exp(-1000 / (ms * sr))
    this.kaNormal = coef(10)
    this.krNormal = coef(300)
    this.kaFast = coef(1)
    this.krFast = coef(50)
  }

  /** Current gain reduction in dB (≥ 0). */
  get gainReduction() {
    return this.gr
  }

  get fastMode() {
    return this.fast
  }

  setParams(p: CompressorParams) {
    this.amount.set(clamp(p.amount, 0, 10))
    if (!this.started) this.amount.snap(this.amount.target)
    this.fast = !!p.fast
  }

  process(l: Float32Array, r: Float32Array, n: number) {
    this.started = true
    const ka = this.fast ? this.kaFast : this.kaNormal
    const kr = this.fast ? this.krFast : this.krNormal
    for (let i = 0; i < n; i++) {
      const a = knob01(this.amount.next())
      const xl = l[i]
      const xr = r[i]
      const det = Math.max(Math.abs(xl), Math.abs(xr))
      this.env += (det - this.env) * (det > this.env ? ka : kr)
      if (a <= 0) {
        this.gr = 0
        continue
      }
      const thrDb = -6 - 30 * a
      const ratio = 1.5 + 6.5 * a
      const slope = 1 - 1 / ratio
      const makeupDb = Math.max(0, -18 - thrDb) * slope
      const envDb = 20 * Math.log10(Math.max(this.env, 1e-9))
      const over = envDb - thrDb
      const grDb = over > 0 ? over * slope : 0
      this.gr = grDb
      const gain = dbToGain(makeupDb - grDb)
      l[i] = xl * gain
      r[i] = xr * gain
    }
  }

  reset() {
    this.env = 0
    this.gr = 0
    this.amount.snap(this.amount.target)
  }
}

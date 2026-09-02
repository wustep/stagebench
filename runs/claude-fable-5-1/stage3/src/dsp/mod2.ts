/**
 * MOD 2 (manual p. 50). Types in panel order:
 *  Chorus   — two sine-modulated delay lines (7 ms ± depth, left/right 90° apart); Amount sets depth and mix and,
 *             above 5, blends in a second slower / longer line for a denser sound.
 *  Flanger  — 1–6 ms modulated delay with feedback (Amount → sweep depth and feedback up to 0.7); left and right
 *             sweep in opposite phase.
 *  Phaser   — four first-order all-pass stages swept 200 Hz–2 kHz (Small-Stone style); Amount adds feedback colour
 *             (none at minimum).
 *  Vibe     — four all-pass stages with staggered LFO phases and different centre frequencies plus a short modulated
 *             delay for the pitch-bending Uni-Vibe character.
 *  Ensemble — three cross-connected modulated delay lines (rates r, 1.3r, 1.7r; 3–8 ms), Eminent-style.
 *  Spin     — rotary-like AM + pan + slight pitch modulation; Rate changes ramp gradually (≈1.5 s).
 * Type changes fade over 5 ms; Rate / Amount are smoothed.
 */
import { clamp, knob01, knobLog, type Mod2Params, type StereoProcessor } from './types'
import { Allpass1, DelayLine, Lfo, Smoother, SwitchFade, allpassCoefficient, msToSamples } from './util'

const VIBE_BASE = [180, 400, 900, 2000]
const VIBE_OFFSET = [0, 0.08, 0.16, 0.24]

export class Mod2Unit implements StereoProcessor {
  private type = 0
  private reqType = 0
  private started = false
  private readonly rate: Smoother
  private readonly amount: Smoother
  private readonly spinRate: Smoother
  private readonly fade: SwitchFade
  private readonly lfo: Lfo
  private readonly lfo2: Lfo
  private readonly lfo3: Lfo
  private readonly dL: DelayLine
  private readonly dR: DelayLine
  private readonly e0: DelayLine
  private readonly e1: DelayLine
  private readonly e2: DelayLine
  private readonly apL: Allpass1[] = []
  private readonly apR: Allpass1[] = []
  private phFbL = 0
  private phFbR = 0
  private o0p = 0
  private o1p = 0
  private o2p = 0

  constructor(private readonly sr: number) {
    this.rate = new Smoother(sr, 10, 3)
    this.amount = new Smoother(sr, 10, 6)
    this.spinRate = new Smoother(sr, 500, 1)
    this.fade = new SwitchFade(sr)
    this.lfo = new Lfo(sr)
    this.lfo2 = new Lfo(sr)
    this.lfo3 = new Lfo(sr)
    const max = msToSamples(40, sr)
    this.dL = new DelayLine(max)
    this.dR = new DelayLine(max)
    this.e0 = new DelayLine(max)
    this.e1 = new DelayLine(max)
    this.e2 = new DelayLine(max)
    for (let k = 0; k < 4; k++) {
      this.apL.push(new Allpass1())
      this.apR.push(new Allpass1())
    }
  }

  get activeType() {
    return this.type
  }

  setParams(p: Mod2Params) {
    this.rate.set(p.rate)
    this.amount.set(p.amount)
    const t = clamp(Math.round(p.type), 0, 5)
    if (!this.started) {
      this.rate.snap(p.rate)
      this.amount.snap(p.amount)
      this.spinRate.snap(knobLog(p.rate, 0.3, 7))
      this.type = this.reqType = t
    } else if (t !== this.reqType) {
      this.reqType = t
      this.fade.request(() => this.switchType(t))
    }
  }

  private clearMemory() {
    this.lfo.reset()
    this.lfo2.reset()
    this.lfo3.reset()
    this.dL.reset()
    this.dR.reset()
    this.e0.reset()
    this.e1.reset()
    this.e2.reset()
    for (const a of this.apL) a.reset()
    for (const a of this.apR) a.reset()
    this.phFbL = this.phFbR = 0
    this.o0p = this.o1p = this.o2p = 0
  }

  private switchType(t: number) {
    this.type = t
    this.clearMemory()
    this.spinRate.snap(knobLog(this.rate.target, 0.3, 7))
  }

  process(l: Float32Array, r: Float32Array, n: number) {
    this.started = true
    const sr = this.sr
    for (let i = 0; i < n; i++) {
      const g = this.fade.next()
      const rate = this.rate.next()
      const amt = knob01(this.amount.next())
      const xl = l[i]
      const xr = r[i]
      let yl = xl
      let yr = xr
      switch (this.type) {
        case 0: {
          const hz = knobLog(rate, 0.1, 5)
          this.lfo.setRate(hz)
          this.lfo.advance()
          this.lfo2.setRate(hz * 0.7)
          this.lfo2.advance()
          const depth = msToSamples(0.5 + 3.5 * amt, sr)
          const base = msToSamples(7, sr)
          let wetL = this.dL.read(base + depth * this.lfo.sin(0))
          let wetR = this.dR.read(base + depth * this.lfo.sin(0.25))
          if (amt > 0.5) {
            const w2 = (amt - 0.5) * 2 * 0.6
            wetL += w2 * this.dL.read(base * 2.2 + depth * 0.7 * this.lfo2.sin(0.1))
            wetR += w2 * this.dR.read(base * 2.2 + depth * 0.7 * this.lfo2.sin(0.35))
          }
          this.dL.write(xl)
          this.dR.write(xr)
          const mix = 0.3 + 0.4 * amt
          yl = xl * (1 - 0.5 * mix) + wetL * mix
          yr = xr * (1 - 0.5 * mix) + wetR * mix
          break
        }
        case 1: {
          this.lfo.setRate(knobLog(rate, 0.05, 3))
          this.lfo.advance()
          const sweep = (0.2 + 0.8 * amt) * 2.5
          const dl = msToSamples(1 + sweep * (1 + this.lfo.sin(0)), sr)
          const dr = msToSamples(1 + sweep * (1 + this.lfo.sin(0.5)), sr)
          const fb = 0.7 * amt
          const wL = this.dL.read(dl)
          const wR = this.dR.read(dr)
          this.dL.write(xl + fb * wL)
          this.dR.write(xr + fb * wR)
          yl = (xl + wL) * 0.7
          yr = (xr + wR) * 0.7
          break
        }
        case 2: {
          this.lfo.setRate(knobLog(rate, 0.05, 5))
          this.lfo.advance()
          const aL = allpassCoefficient(sr, 200 * Math.pow(10, (this.lfo.sin(0) + 1) / 2))
          const aR = allpassCoefficient(sr, 200 * Math.pow(10, (this.lfo.sin(0.25) + 1) / 2))
          const fb = 0.75 * amt
          let vL = xl + fb * this.phFbL
          let vR = xr + fb * this.phFbR
          for (let k = 0; k < 4; k++) {
            this.apL[k].setCoefficient(aL)
            this.apR[k].setCoefficient(aR)
            vL = this.apL[k].process(vL)
            vR = this.apR[k].process(vR)
          }
          this.phFbL = vL
          this.phFbR = vR
          yl = (xl + vL) * 0.5
          yr = (xr + vR) * 0.5
          break
        }
        case 3: {
          this.lfo.setRate(knobLog(rate, 0.1, 6))
          this.lfo.advance()
          const depth = 0.3 + 0.7 * amt
          let vL = xl + 0.2 * this.phFbL
          let vR = xr + 0.2 * this.phFbR
          for (let k = 0; k < 4; k++) {
            const fL = VIBE_BASE[k] * Math.pow(2.5, ((this.lfo.sin(VIBE_OFFSET[k]) + 1) / 2) * depth)
            const fR = VIBE_BASE[k] * Math.pow(2.5, ((this.lfo.sin(VIBE_OFFSET[k] + 0.5) + 1) / 2) * depth)
            this.apL[k].setBreak(sr, fL)
            this.apR[k].setBreak(sr, fR)
            vL = this.apL[k].process(vL)
            vR = this.apR[k].process(vR)
          }
          this.phFbL = vL
          this.phFbR = vR
          const pL = (xl + vL) * 0.5
          const pR = (xr + vR) * 0.5
          const dmL = msToSamples(0.6 + 0.35 * amt * this.lfo.sin(0.5), sr)
          const dmR = msToSamples(0.6 + 0.35 * amt * this.lfo.sin(1.0), sr)
          yl = this.dL.read(dmL)
          yr = this.dR.read(dmR)
          this.dL.write(pL)
          this.dR.write(pR)
          break
        }
        case 4: {
          const hz = knobLog(rate, 0.1, 6)
          this.lfo.setRate(hz)
          this.lfo2.setRate(hz * 1.3)
          this.lfo3.setRate(hz * 1.7)
          this.lfo.advance()
          this.lfo2.advance()
          this.lfo3.advance()
          const xm = (xl + xr) * 0.5
          const dep = msToSamples(2.5 * amt, sr)
          const base = msToSamples(5.5, sr)
          const o0 = this.e0.read(base + dep * this.lfo.sin(0))
          const o1 = this.e1.read(base + dep * this.lfo2.sin(0.33))
          const o2 = this.e2.read(base + dep * this.lfo3.sin(0.67))
          this.e0.write(xm + 0.3 * this.o1p)
          this.e1.write(xm + 0.3 * this.o2p)
          this.e2.write(xm + 0.3 * this.o0p)
          this.o0p = o0
          this.o1p = o1
          this.o2p = o2
          const eL = (o0 + 0.5 * o2) / 1.5
          const eR = (o1 + 0.5 * o2) / 1.5
          yl = xl * 0.5 + eL * 0.5
          yr = xr * 0.5 + eR * 0.5
          break
        }
        default: {
          this.spinRate.set(knobLog(rate, 0.3, 7))
          this.lfo.setRate(this.spinRate.next())
          this.lfo.advance()
          const am = 1 - 0.3 * amt * (1 - this.lfo.sin()) * 0.5
          const th = (0.6 * amt * this.lfo.sin(0.25) + 1) * (Math.PI / 4)
          const dm = msToSamples(1 + 0.3 * amt * this.lfo.sin(0.5), sr)
          const wL = this.dL.read(dm)
          const wR = this.dR.read(dm)
          this.dL.write(xl)
          this.dR.write(xr)
          yl = wL * am * Math.cos(th) * Math.SQRT2
          yr = wR * am * Math.sin(th) * Math.SQRT2
        }
      }
      if (g === 1) {
        l[i] = yl
        r[i] = yr
      } else {
        l[i] = xl + (yl - xl) * g
        r[i] = xr + (yr - xr) * g
      }
    }
  }

  reset() {
    this.clearMemory()
    this.fade.reset()
    this.rate.snap(this.rate.target)
    this.amount.snap(this.amount.target)
    this.spinRate.snap(this.spinRate.target)
  }
}

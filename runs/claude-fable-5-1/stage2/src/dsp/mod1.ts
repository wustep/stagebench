/**
 * MOD 1 (manual p. 49). Types in panel order:
 *  Ring Mod — the signal multiplied by a sine whose pitch follows the Rate knob (20 Hz–2 kHz); Amount = wet mix.
 *  Tremolo  — sine LFO volume modulation; full level at zero Amount, up to full depth.
 *  A-Pan    — equal-power LFO panning between left and right, depth from Amount.
 *  A-Wah    — envelope follower (5 ms / 120 ms) sweeping a resonant band-pass 300 Hz–2.5 kHz; Rate acts as sensitivity,
 *             Amount = wet mix.
 *  Wah      — triangle LFO sweeping a resonant (Q 4) two-pole low-pass 250 Hz–2 kHz; Amount = wet mix.
 *  Pump     — LFO-timed side-chain-style ducking: a fast dip at every cycle followed by an exponential recovery.
 * LFO rates follow lfoKnobToHz (0.1–10 Hz). Type changes fade over 5 ms; Rate / Amount are smoothed.
 */
import { clamp, knob01, lfoKnobToHz, ringModKnobToHz, type Mod1Params, type StereoProcessor } from './types'
import { EnvFollower, Lfo, Smoother, Svf, SwitchFade } from './util'

export class Mod1Unit implements StereoProcessor {
  private type = 5
  private reqType = 5
  private started = false
  private readonly rate: Smoother
  private readonly amount: Smoother
  private readonly lfo: Lfo
  private readonly fade: SwitchFade
  private readonly env: EnvFollower
  private readonly svfL: Svf
  private readonly svfR: Svf
  private pumpEnv = 0
  private pumpHold = 0
  private readonly holdSamples: number
  private readonly kPumpAttack: number

  constructor(private readonly sr: number) {
    this.rate = new Smoother(sr, 10, 4)
    this.amount = new Smoother(sr, 10, 5)
    this.lfo = new Lfo(sr)
    this.fade = new SwitchFade(sr)
    this.env = new EnvFollower(sr, 5, 120)
    this.svfL = new Svf(sr)
    this.svfR = new Svf(sr)
    this.holdSamples = Math.max(1, Math.round(0.002 * sr))
    this.kPumpAttack = 1 - Math.exp(-1000 / (1 * sr))
    this.pumpHold = this.holdSamples
  }

  get activeType() {
    return this.type
  }

  setParams(p: Mod1Params) {
    this.rate.set(p.rate)
    this.amount.set(p.amount)
    const t = clamp(Math.round(p.type), 0, 5)
    if (!this.started) {
      this.rate.snap(p.rate)
      this.amount.snap(p.amount)
      this.type = this.reqType = t
    } else if (t !== this.reqType) {
      this.reqType = t
      this.fade.request(() => this.switchType(t))
    }
  }

  private switchType(t: number) {
    this.type = t
    this.lfo.reset()
    this.env.reset()
    this.svfL.reset()
    this.svfR.reset()
    this.pumpEnv = 0
    this.pumpHold = this.holdSamples
  }

  process(l: Float32Array, r: Float32Array, n: number) {
    this.started = true
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
          this.lfo.setRate(ringModKnobToHz(rate))
          this.lfo.advance()
          const m = 1 - amt + amt * this.lfo.sin()
          yl = xl * m
          yr = xr * m
          break
        }
        case 1: {
          this.lfo.setRate(lfoKnobToHz(rate))
          this.lfo.advance()
          const tg = 1 - (amt * (1 - this.lfo.sin())) / 2
          yl = xl * tg
          yr = xr * tg
          break
        }
        case 2: {
          this.lfo.setRate(lfoKnobToHz(rate))
          this.lfo.advance()
          const th = (amt * this.lfo.sin() + 1) * (Math.PI / 4)
          yl = xl * Math.cos(th) * Math.SQRT2
          yr = xr * Math.sin(th) * Math.SQRT2
          break
        }
        case 3: {
          const e = this.env.process((Math.abs(xl) + Math.abs(xr)) * 0.5)
          const sweep = Math.min(1, e * (1 + 20 * knob01(rate)))
          const fc = 300 * Math.pow(2500 / 300, sweep)
          this.svfL.set(fc, 3)
          this.svfR.copyFrom(this.svfL)
          this.svfL.process(xl)
          this.svfR.process(xr)
          yl = xl + (this.svfL.band * 1.5 - xl) * amt
          yr = xr + (this.svfR.band * 1.5 - xr) * amt
          break
        }
        case 4: {
          this.lfo.setRate(lfoKnobToHz(rate))
          this.lfo.advance()
          const sw = (this.lfo.tri() + 1) * 0.5
          const fc = 250 * Math.pow(8, sw)
          this.svfL.set(fc, 4)
          this.svfR.copyFrom(this.svfL)
          this.svfL.process(xl)
          this.svfR.process(xr)
          yl = xl + (this.svfL.low - xl) * amt
          yr = xr + (this.svfR.low - xr) * amt
          break
        }
        default: {
          const hz = lfoKnobToHz(rate)
          this.lfo.setRate(hz)
          if (this.lfo.advanceWrap()) this.pumpHold = this.holdSamples
          if (this.pumpHold > 0) {
            this.pumpHold--
            this.pumpEnv += (1 - this.pumpEnv) * this.kPumpAttack
          } else {
            const tau = Math.max(0.03, 0.25 / hz)
            this.pumpEnv *= Math.exp(-1 / (tau * this.sr))
          }
          const pg = 1 - amt * this.pumpEnv
          yl = xl * pg
          yr = xr * pg
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
    this.lfo.reset()
    this.env.reset()
    this.svfL.reset()
    this.svfR.reset()
    this.pumpEnv = 0
    this.pumpHold = this.holdSamples
    this.fade.reset()
    this.rate.snap(this.rate.target)
    this.amount.snap(this.amount.target)
  }
}

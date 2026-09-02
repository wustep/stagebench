/**
 * DELAY (manual p. 50–51): a stereo digital delay (20 ms–1.5 s) with the FILTER placed inside the feedback loop, so
 * the first repeat is filtered once, the second twice and so on while the dry path is never filtered
 * (HP 700 Hz, BP 400 Hz–2.5 kHz, LP 2.5 kHz). Feedback follows feedbackKnobToGain (0–0.9), Dry/Wet is an equal-power
 * mix (0 = dry only, 10 = repeats only). Time changes cross-fade between two read heads over 50 ms — no pitch zip —
 * and a change arriving mid-fade waits for the fade to finish. Optional ping-pong sends repeats alternately left
 * and right. Filter changes fade over 5 ms.
 */
import { clamp, feedbackKnobToGain, knob01, type DelayParams, type StereoProcessor } from './types'
import { Biquad, DelayLine, HALF_PI, Smoother, SwitchFade } from './util'

export const MAX_DELAY_SECONDS = 1.5

export class DelayUnit implements StereoProcessor {
  private readonly lineL: DelayLine
  private readonly lineR: DelayLine
  private timeA: number
  private timeB: number
  private xf = 1
  private readonly xfStep: number
  private pendingTime = -1
  private readonly fb: Smoother
  private readonly wet: Smoother
  private readonly fL = new Biquad()
  private readonly fR = new Biquad()
  private filterType = 0
  private reqFilter = 0
  private pingPong = false
  private started = false
  private readonly fade: SwitchFade
  private lastW = -1
  private dryG = 1
  private wetG = 0

  constructor(private readonly sr: number) {
    const max = Math.ceil(MAX_DELAY_SECONDS * sr) + 8
    this.lineL = new DelayLine(max)
    this.lineR = new DelayLine(max)
    this.timeA = this.timeB = Math.round(0.3 * sr)
    this.xfStep = 1 / Math.max(1, Math.round(0.05 * sr))
    this.fb = new Smoother(sr, 10, feedbackKnobToGain(6))
    this.wet = new Smoother(sr, 10, knob01(4))
    this.fade = new SwitchFade(sr)
    this.fL.identity()
    this.fR.identity()
  }

  /** Current delay time in samples (the head being read). */
  get delaySamples() {
    return this.timeA
  }

  get activeFilter() {
    return this.filterType
  }

  setParams(p: DelayParams) {
    const t = clamp(Math.round(p.seconds * this.sr), 1, this.lineL.maxDelay)
    if (!this.started) {
      this.timeA = this.timeB = t
      this.xf = 1
      this.pendingTime = -1
    } else if (t !== this.timeB) {
      if (this.xf >= 1) {
        this.timeB = t
        this.xf = 0
      } else this.pendingTime = t
    } else if (this.pendingTime >= 0) this.pendingTime = -1
    this.fb.set(feedbackKnobToGain(p.feedback))
    this.wet.set(knob01(p.dryWet))
    if (!this.started) {
      this.fb.snap(this.fb.target)
      this.wet.snap(this.wet.target)
    }
    const f = clamp(Math.round(p.filter), 0, 3)
    if (f !== this.reqFilter) {
      this.reqFilter = f
      if (!this.started) this.configureFilter(f)
      else this.fade.request(() => this.configureFilter(f))
    }
    this.pingPong = !!p.pingPong
  }

  private configureFilter(f: number) {
    if (f === 1) this.fL.highpass(this.sr, 700)
    else if (f === 2) this.fL.bandpass(this.sr, 1000, 0.48)
    else if (f === 3) this.fL.lowpass(this.sr, 2500)
    else this.fL.identity()
    this.fL.reset()
    this.fR.copyFrom(this.fL)
    this.fR.reset()
    this.filterType = f
  }

  process(l: Float32Array, r: Float32Array, n: number) {
    this.started = true
    for (let i = 0; i < n; i++) {
      const g = this.fade.next()
      const fb = this.fb.next()
      const w = this.wet.next()
      if (w !== this.lastW) {
        this.lastW = w
        this.dryG = Math.cos(w * HALF_PI)
        this.wetG = Math.sin(w * HALF_PI)
      }
      let outL = this.lineL.read(this.timeA)
      let outR = this.lineR.read(this.timeA)
      if (this.xf < 1) {
        const bL = this.lineL.read(this.timeB)
        const bR = this.lineR.read(this.timeB)
        outL += (bL - outL) * this.xf
        outR += (bR - outR) * this.xf
        this.xf = Math.min(1, this.xf + this.xfStep)
        if (this.xf >= 1) {
          this.timeA = this.timeB
          if (this.pendingTime >= 0) {
            this.timeB = this.pendingTime
            this.pendingTime = -1
            this.xf = 0
          }
        }
      }
      const xl = l[i]
      const xr = r[i]
      let inL: number
      let inR: number
      if (this.pingPong) {
        inL = this.fL.process((xl + xr) * 0.5 + fb * outR)
        inR = this.fR.process(outL)
      } else {
        inL = this.fL.process(xl + fb * outL)
        inR = this.fR.process(xr + fb * outR)
      }
      if (inL > 4) inL = 4
      else if (inL < -4) inL = -4
      if (inR > 4) inR = 4
      else if (inR < -4) inR = -4
      this.lineL.write(inL)
      this.lineR.write(inR)
      const yl = xl * this.dryG + outL * this.wetG
      const yr = xr * this.dryG + outR * this.wetG
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
    this.lineL.reset()
    this.lineR.reset()
    this.fL.reset()
    this.fR.reset()
    this.fade.reset()
    if (this.xf < 1) this.timeA = this.timeB
    this.xf = 1
    if (this.pendingTime >= 0) {
      this.timeA = this.timeB = this.pendingTime
      this.pendingTime = -1
    }
    this.fb.snap(this.fb.target)
    this.wet.snap(this.wet.target)
  }
}

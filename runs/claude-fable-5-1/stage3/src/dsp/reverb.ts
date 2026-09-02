/**
 * REVERB (manual p. 52–53): a Schroeder / Freeverb-style algorithmic reverb — per channel eight parallel feedback
 * combs with in-loop damping followed by four series all-passes, the right channel offset by 23 samples (at 44.1 kHz)
 * for width. Each type sets the comb lengths (size), the feedback for its RT60 and the damping:
 *  Booth (0.35 s, tiny), Room (0.9 s), Stage (1.6 s), Hall (2.6 s), Cathedral (5 s, largest, most diffusion).
 *  Spring is a different structure: a band-limited (200 Hz–4 kHz) feedback loop of ~55 ms whose recirculating signal
 *  passes six long all-passes every trip, so each echo is more dispersed ("boing"), with a slow modulation.
 * Bright/Dark tone: −4 dB low shelf @ 300 Hz with lighter damping / −8 dB high shelf @ 3 kHz with heavier damping on
 * the wet signal. Dry/Wet is an equal-power mix that is fully wet at maximum. Type changes fade over 5 ms.
 */
import { clamp, knob01, type ReverbParams, type StereoProcessor } from './types'
import { Biquad, DelayLine, HALF_PI, Lfo, OnePole, Smoother, SwitchFade, msToSamples } from './util'

class Comb {
  private readonly buf: Float32Array
  private idx = 0
  private store = 0
  len = 1
  fb = 0
  damp = 0
  norm = 1

  constructor(max: number) {
    this.buf = new Float32Array(Math.max(2, max))
  }

  setLength(len: number) {
    this.len = clamp(Math.round(len), 1, this.buf.length)
    this.idx = 0
  }

  process(x: number): number {
    const out = this.buf[this.idx]
    this.store = out * (1 - this.damp) + this.store * this.damp
    this.buf[this.idx] = x + this.store * this.fb
    if (++this.idx >= this.len) this.idx = 0
    return out * this.norm
  }

  reset() {
    this.buf.fill(0)
    this.idx = 0
    this.store = 0
  }
}

class AllpassN {
  private readonly buf: Float32Array
  private idx = 0
  len = 1
  g = 0.5

  constructor(max: number) {
    this.buf = new Float32Array(Math.max(2, max))
  }

  setLength(len: number) {
    this.len = clamp(Math.round(len), 1, this.buf.length)
    this.idx = 0
  }

  process(x: number): number {
    const d = this.buf[this.idx]
    const v = x + this.g * d
    this.buf[this.idx] = v
    if (++this.idx >= this.len) this.idx = 0
    return d - this.g * v
  }

  reset() {
    this.buf.fill(0)
    this.idx = 0
  }
}

const COMB_BASE = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
const AP_BASE = [556, 441, 341, 225]
const SPREAD = 23
const MAX_SIZE = 1.8

interface TypeSpec {
  rt60: number
  size: number
  damp: number
  apG: number
}

/** Indexed by REVERB_TYPES order; index 2 (Spring) uses its own structure. */
const TYPES: (TypeSpec | null)[] = [
  { rt60: 0.9, size: 0.7, damp: 0.35, apG: 0.5 },
  { rt60: 0.35, size: 0.45, damp: 0.4, apG: 0.5 },
  null,
  { rt60: 1.6, size: 1.0, damp: 0.3, apG: 0.5 },
  { rt60: 2.6, size: 1.35, damp: 0.25, apG: 0.55 },
  { rt60: 5.0, size: 1.8, damp: 0.2, apG: 0.65 },
]

const SPRING_AP_MS = [3.7, 5.1, 7.3, 9.7, 12.1, 15.9]
const SPRING_LOOP_MS = [55, 57]
const SPRING_RT60 = 1.8

export class ReverbUnit implements StereoProcessor {
  private readonly combsL: Comb[] = []
  private readonly combsR: Comb[] = []
  private readonly apsL: AllpassN[] = []
  private readonly apsR: AllpassN[] = []
  private readonly sapL: AllpassN[] = []
  private readonly sapR: AllpassN[] = []
  private readonly loopL: DelayLine
  private readonly loopR: DelayLine
  private readonly loopLpL = new OnePole()
  private readonly loopLpR = new OnePole()
  private readonly hpL = new Biquad()
  private readonly hpR = new Biquad()
  private readonly wetLpL = new Biquad()
  private readonly wetLpR = new Biquad()
  private readonly springLfoL: Lfo
  private readonly springLfoR: Lfo
  private springFb = 0.8
  private readonly toneL = new Biquad()
  private readonly toneR = new Biquad()
  private readonly wet: Smoother
  private type = 5
  private reqType = 5
  private tone = 0
  private reqTone = 0
  private started = false
  private readonly fade: SwitchFade
  private lastW = -1
  private dryG = 1
  private wetG = 0

  constructor(private readonly sr: number) {
    const scale = sr / 44100
    for (let k = 0; k < 8; k++) {
      const max = Math.ceil(COMB_BASE[k] * MAX_SIZE * scale + SPREAD * scale) + 2
      this.combsL.push(new Comb(max))
      this.combsR.push(new Comb(max))
    }
    for (let k = 0; k < 4; k++) {
      const max = Math.ceil(AP_BASE[k] * MAX_SIZE * scale + SPREAD * scale) + 2
      this.apsL.push(new AllpassN(max))
      this.apsR.push(new AllpassN(max))
    }
    for (let k = 0; k < 6; k++) {
      const max = Math.ceil(msToSamples(SPRING_AP_MS[k] * 1.1, sr)) + 2
      this.sapL.push(new AllpassN(max))
      this.sapR.push(new AllpassN(max))
    }
    this.loopL = new DelayLine(msToSamples(70, sr))
    this.loopR = new DelayLine(msToSamples(70, sr))
    this.loopLpL.setCutoff(sr, 4000)
    this.loopLpR.setCutoff(sr, 4000)
    this.hpL.highpass(sr, 200)
    this.hpR.highpass(sr, 200)
    this.wetLpL.lowpass(sr, 4000)
    this.wetLpR.lowpass(sr, 4000)
    this.springLfoL = new Lfo(sr, 0.35)
    this.springLfoR = new Lfo(sr, 0.31, 0.5)
    this.wet = new Smoother(sr, 10, knob01(6))
    this.fade = new SwitchFade(sr)
    this.configure(5, 0)
  }

  get activeType() {
    return this.type
  }

  get activeTone() {
    return this.tone
  }

  setParams(p: ReverbParams) {
    this.wet.set(knob01(clamp(p.dryWet, 0, 10)))
    const t = clamp(Math.round(p.type), 0, 5)
    const tone = clamp(Math.round(p.tone), 0, 2)
    if (!this.started) {
      this.wet.snap(this.wet.target)
      if (t !== this.reqType || tone !== this.reqTone) {
        this.reqType = t
        this.reqTone = tone
        this.configure(t, tone)
      }
    } else if (t !== this.reqType || tone !== this.reqTone) {
      this.reqType = t
      this.reqTone = tone
      this.fade.request(() => this.configure(t, tone))
    }
  }

  private configure(t: number, tone: number) {
    const sr = this.sr
    const scale = sr / 44100
    const toneDamp = tone === 1 ? -0.15 : tone === 2 ? 0.25 : 0
    const spec = TYPES[t]
    if (spec) {
      const damp = clamp(spec.damp + toneDamp, 0, 0.9)
      for (let k = 0; k < 8; k++) {
        const lenL = COMB_BASE[k] * spec.size * scale
        const lenR = lenL + SPREAD * scale
        const cl = this.combsL[k]
        const cr = this.combsR[k]
        cl.setLength(lenL)
        cr.setLength(lenR)
        cl.fb = Math.pow(0.001, cl.len / (spec.rt60 * sr))
        cr.fb = Math.pow(0.001, cr.len / (spec.rt60 * sr))
        cl.norm = 1 - cl.fb
        cr.norm = 1 - cr.fb
        cl.damp = cr.damp = damp
        cl.reset()
        cr.reset()
      }
      for (let k = 0; k < 4; k++) {
        this.apsL[k].setLength(AP_BASE[k] * spec.size * scale)
        this.apsR[k].setLength(AP_BASE[k] * spec.size * scale + SPREAD * scale)
        this.apsL[k].g = this.apsR[k].g = spec.apG
        this.apsL[k].reset()
        this.apsR[k].reset()
      }
    } else {
      for (let k = 0; k < 6; k++) {
        this.sapL[k].setLength(msToSamples(SPRING_AP_MS[k], sr))
        this.sapR[k].setLength(msToSamples(SPRING_AP_MS[k] * 1.07, sr))
        this.sapL[k].g = this.sapR[k].g = 0.6
        this.sapL[k].reset()
        this.sapR[k].reset()
      }
      this.springFb = Math.pow(0.001, SPRING_LOOP_MS[0] / 1000 / SPRING_RT60)
      this.loopL.reset()
      this.loopR.reset()
      this.loopLpL.reset()
      this.loopLpR.reset()
      const lpHz = tone === 1 ? 5500 : tone === 2 ? 2500 : 4000
      this.loopLpL.setCutoff(sr, lpHz)
      this.loopLpR.setCutoff(sr, lpHz)
      this.hpL.reset()
      this.hpR.reset()
      this.wetLpL.reset()
      this.wetLpR.reset()
      this.springLfoL.reset()
      this.springLfoR.reset(0.5)
    }
    if (tone === 1) this.toneL.lowShelf(sr, 300, -4)
    else if (tone === 2) this.toneL.highShelf(sr, 3000, -8)
    else this.toneL.identity()
    this.toneL.reset()
    this.toneR.copyFrom(this.toneL)
    this.toneR.reset()
    this.type = t
    this.tone = tone
  }

  process(l: Float32Array, r: Float32Array, n: number) {
    this.started = true
    const spring = this.type === 2
    for (let i = 0; i < n; i++) {
      const g = this.fade.next()
      const w = this.wet.next()
      if (w !== this.lastW) {
        this.lastW = w
        this.dryG = Math.cos(w * HALF_PI)
        this.wetG = Math.sin(w * HALF_PI)
      }
      const xl = l[i]
      const xr = r[i]
      const inp = (xl + xr) * 0.5
      let wetL: number
      let wetR: number
      if (spring) {
        this.springLfoL.advance()
        this.springLfoR.advance()
        const dL = msToSamples(SPRING_LOOP_MS[0] + 0.4 * this.springLfoL.sin(), this.sr)
        const dR = msToSamples(SPRING_LOOP_MS[1] + 0.4 * this.springLfoR.sin(), this.sr)
        const outL = this.loopL.read(dL)
        const outR = this.loopR.read(dR)
        let vL = this.hpL.process(inp) + this.springFb * this.loopLpL.lp(outL)
        let vR = this.hpR.process(inp) + this.springFb * this.loopLpR.lp(outR)
        for (let k = 0; k < 6; k++) {
          vL = this.sapL[k].process(vL)
          vR = this.sapR[k].process(vR)
        }
        if (vL > 4) vL = 4
        else if (vL < -4) vL = -4
        if (vR > 4) vR = 4
        else if (vR < -4) vR = -4
        this.loopL.write(vL)
        this.loopR.write(vR)
        wetL = this.wetLpL.process(outL) * 0.9
        wetR = this.wetLpR.process(outR) * 0.9
      } else {
        let sL = 0
        let sR = 0
        for (let k = 0; k < 8; k++) {
          sL += this.combsL[k].process(inp)
          sR += this.combsR[k].process(inp)
        }
        sL *= 0.6
        sR *= 0.6
        for (let k = 0; k < 4; k++) {
          sL = this.apsL[k].process(sL)
          sR = this.apsR[k].process(sR)
        }
        wetL = sL
        wetR = sR
      }
      wetL = this.toneL.process(wetL)
      wetR = this.toneR.process(wetR)
      const yl = xl * this.dryG + wetL * this.wetG
      const yr = xr * this.dryG + wetR * this.wetG
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
    for (const c of this.combsL) c.reset()
    for (const c of this.combsR) c.reset()
    for (const a of this.apsL) a.reset()
    for (const a of this.apsR) a.reset()
    for (const a of this.sapL) a.reset()
    for (const a of this.sapR) a.reset()
    this.loopL.reset()
    this.loopR.reset()
    this.loopLpL.reset()
    this.loopLpR.reset()
    this.hpL.reset()
    this.hpR.reset()
    this.wetLpL.reset()
    this.wetLpR.reset()
    this.toneL.reset()
    this.toneR.reset()
    this.springLfoL.reset()
    this.springLfoR.reset(0.5)
    this.fade.reset()
    this.wet.snap(this.wet.target)
  }
}

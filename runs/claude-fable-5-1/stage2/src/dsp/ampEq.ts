/**
 * AMP SIM / EQ (manual p. 51–52). Signal order: three-band EQ (100 Hz low shelf, sweepable 200 Hz–8 kHz peak,
 * 4 kHz high shelf, ±15 dB) → tube-style overdrive (Drive knob = 0–30 dB pre-gain into an asymmetric saturator,
 * output compensated so a −12 dBFS signal keeps its level) → model colouration:
 *  EQ only / To Rotary — no colouration (To Rotary only changes routing outside this unit).
 *  Small — Wurlitzer 200A internal speaker: HP 150 Hz, +5 dB @ 1.4 kHz, LP 4.5 kHz, hotter saturation (×2).
 *  JC    — Jazz Chorus cabinet: +6 dB presence @ 3 kHz, LP 7 kHz, cleaner saturation (×0.7).
 *  Twin  — tube amp and cabinet: +3 dB low shelf @ 120 Hz, +5 dB @ 2 kHz, LP 6 kHz, medium saturation (×1.2).
 *  LP24 / HP24 — resonant 24 dB/oct filters (two cascaded biquads) with Freq as cutoff and the Mid knob as
 *  resonance (Q 0.5–8); bass, treble and drive stay active, the mid peak is disabled.
 * The three amp models are documented approximations of the originals. Model changes fade over 5 ms.
 */
import { clamp, driveKnobToGain, midFreqKnobToHz, type AmpEqParams, type StereoProcessor } from './types'
import { Biquad, OnePole, Smoother, SwitchFade, tubeSaturate } from './util'

interface Stage {
  kind: 'lowpass' | 'highpass' | 'peak' | 'lowShelf'
  f: number
  db?: number
  q?: number
}

const MODEL_STAGES: Record<number, Stage[]> = {
  1: [
    { kind: 'highpass', f: 150 },
    { kind: 'peak', f: 1400, db: 5, q: 1 },
    { kind: 'lowpass', f: 4500 },
  ],
  2: [
    { kind: 'peak', f: 3000, db: 6, q: 1.2 },
    { kind: 'lowpass', f: 7000 },
  ],
  3: [
    { kind: 'lowShelf', f: 120, db: 3 },
    { kind: 'peak', f: 2000, db: 5, q: 1 },
    { kind: 'lowpass', f: 6000 },
  ],
}
const MODEL_PRE: Record<number, number> = { 1: 2.0, 2: 0.7, 3: 1.2 }

export class AmpEqUnit implements StereoProcessor {
  private readonly lowL = new Biquad()
  private readonly midL = new Biquad()
  private readonly highL = new Biquad()
  private readonly lowR = new Biquad()
  private readonly midR = new Biquad()
  private readonly highR = new Biquad()
  private readonly mL: Biquad[] = [new Biquad(), new Biquad(), new Biquad()]
  private readonly mR: Biquad[] = [new Biquad(), new Biquad(), new Biquad()]
  private modelCount = 0
  private readonly f1L = new Biquad()
  private readonly f2L = new Biquad()
  private readonly f1R = new Biquad()
  private readonly f2R = new Biquad()
  private mode: 'none' | 'lp' | 'hp' = 'none'
  private readonly dcL = new OnePole()
  private readonly dcR = new OnePole()
  private readonly bass: Smoother
  private readonly mid: Smoother
  private readonly midFreq: Smoother
  private readonly treble: Smoother
  private readonly drive: Smoother
  private model = 0
  private reqModel = 0
  private modelPre = 1
  private started = false
  private eqDirty = true
  private lastDrive = -1
  private pre = 1
  private post = 1
  private readonly fade: SwitchFade

  constructor(private readonly sr: number) {
    this.bass = new Smoother(sr, 10, 0)
    this.mid = new Smoother(sr, 10, 0)
    this.midFreq = new Smoother(sr, 10, 5)
    this.treble = new Smoother(sr, 10, 0)
    this.drive = new Smoother(sr, 10, 0)
    this.dcL.setCutoff(sr, 10)
    this.dcR.setCutoff(sr, 10)
    this.fade = new SwitchFade(sr)
    this.configureModel(0)
  }

  get activeModel() {
    return this.model
  }

  /** True while the Drive knob is above zero (the DRIVE LED). */
  get driveActive() {
    return this.drive.target > 0.05
  }

  setParams(p: AmpEqParams) {
    this.bass.set(clamp(p.bass, -15, 15))
    this.mid.set(clamp(p.mid, -15, 15))
    this.midFreq.set(clamp(p.midFreq, 0, 10))
    this.treble.set(clamp(p.treble, -15, 15))
    this.drive.set(clamp(p.drive, 0, 10))
    const m = clamp(Math.round(p.model), 0, 6)
    if (!this.started) {
      this.bass.snap(this.bass.target)
      this.mid.snap(this.mid.target)
      this.midFreq.snap(this.midFreq.target)
      this.treble.snap(this.treble.target)
      this.drive.snap(this.drive.target)
      this.eqDirty = true
      if (m !== this.reqModel) {
        this.reqModel = m
        this.configureModel(m)
      }
    } else if (m !== this.reqModel) {
      this.reqModel = m
      this.fade.request(() => this.configureModel(m))
    }
  }

  private configureModel(m: number) {
    const stages = MODEL_STAGES[m] ?? []
    for (let i = 0; i < 3; i++) {
      const st = stages[i]
      const a = this.mL[i]
      if (!st) a.identity()
      else if (st.kind === 'lowpass') a.lowpass(this.sr, st.f)
      else if (st.kind === 'highpass') a.highpass(this.sr, st.f)
      else if (st.kind === 'peak') a.peaking(this.sr, st.f, st.q ?? 1, st.db ?? 0)
      else a.lowShelf(this.sr, st.f, st.db ?? 0)
      a.reset()
      this.mR[i].copyFrom(a)
      this.mR[i].reset()
    }
    this.modelCount = stages.length
    this.modelPre = MODEL_PRE[m] ?? 1
    this.mode = m === 5 ? 'lp' : m === 6 ? 'hp' : 'none'
    for (const b of [this.f1L, this.f2L, this.f1R, this.f2R]) b.reset()
    this.model = m
    this.eqDirty = true
    this.lastDrive = -1
  }

  private updateEq(bass: number, mid: number, midFreq: number, treble: number) {
    const sr = this.sr
    this.lowL.lowShelf(sr, 100, bass)
    this.lowR.copyFrom(this.lowL)
    if (this.mode === 'none') this.midL.peaking(sr, midFreqKnobToHz(midFreq), 1, mid)
    else this.midL.identity()
    this.midR.copyFrom(this.midL)
    this.highL.highShelf(sr, 4000, treble)
    this.highR.copyFrom(this.highL)
    if (this.mode !== 'none') {
      const fc = midFreqKnobToHz(midFreq)
      const q = 0.5 * Math.pow(16, (clamp(mid, -15, 15) + 15) / 30)
      if (this.mode === 'lp') {
        this.f1L.lowpass(sr, fc, Math.max(0.5, q))
        this.f2L.lowpass(sr, fc, 0.6)
      } else {
        this.f1L.highpass(sr, fc, Math.max(0.5, q))
        this.f2L.highpass(sr, fc, 0.6)
      }
      this.f1R.copyFrom(this.f1L)
      this.f2R.copyFrom(this.f2L)
    }
  }

  process(l: Float32Array, r: Float32Array, n: number) {
    this.started = true
    for (let i = 0; i < n; i++) {
      const g = this.fade.next()
      const bass = this.bass.next()
      const mid = this.mid.next()
      const mf = this.midFreq.next()
      const treble = this.treble.next()
      const drive = this.drive.next()
      if (this.eqDirty || !(this.bass.settled && this.mid.settled && this.midFreq.settled && this.treble.settled)) {
        this.updateEq(bass, mid, mf, treble)
        this.eqDirty = false
      }
      if (drive !== this.lastDrive) {
        this.lastDrive = drive
        this.pre = driveKnobToGain(drive) * this.modelPre
        this.post = 0.25 / Math.tanh(0.25 * this.pre)
      }
      const xl = l[i]
      const xr = r[i]
      let yl = this.highL.process(this.midL.process(this.lowL.process(xl)))
      let yr = this.highR.process(this.midR.process(this.lowR.process(xr)))
      yl = tubeSaturate(yl * this.pre) * this.post
      yr = tubeSaturate(yr * this.pre) * this.post
      for (let k = 0; k < this.modelCount; k++) {
        yl = this.mL[k].process(yl)
        yr = this.mR[k].process(yr)
      }
      if (this.mode !== 'none') {
        yl = this.f2L.process(this.f1L.process(yl))
        yr = this.f2R.process(this.f1R.process(yr))
      }
      yl = this.dcL.hp(yl)
      yr = this.dcR.hp(yr)
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
    for (const b of [this.lowL, this.midL, this.highL, this.lowR, this.midR, this.highR, this.f1L, this.f2L, this.f1R, this.f2R, ...this.mL, ...this.mR]) b.reset()
    this.dcL.reset()
    this.dcR.reset()
    this.fade.reset()
    for (const s of [this.bass, this.mid, this.midFreq, this.treble, this.drive]) s.snap(s.target)
    this.eqDirty = true
    this.lastDrive = -1
  }
}

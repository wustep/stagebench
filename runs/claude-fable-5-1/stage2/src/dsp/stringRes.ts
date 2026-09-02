/**
 * STRING RES (manual p. 25): simulated sympathetic string resonance. Every undamped string (held key, or every
 * sounding note while the sustain pedal is down) is a feedback comb tuned to its fundamental
 * (y = x·(1−fb) + fb·lp(y[n−N]), N = sr/f0, loop low-pass ≈ 4 kHz) whose recirculating signal is mixed in at
 * about −18 dB (−15 dB with the pedal down, which also lengthens the resonance). Strings that stop being held are
 * released with a short decay instead of being cut. Off is an exact pass-through.
 */
import { clamp, type StereoProcessor, type StringResParams } from './types'
import { DelayLine, OnePole, Smoother, midiHz } from './util'

export const MAX_STRINGS = 16
const MIX_NORMAL = 0.126 // −18 dB
const MIX_PEDAL = 0.178 // −15 dB
const RELEASE_SECONDS = 0.5
const LOOP_LP_HZ = 4000

interface StringVoice {
  midi: number
  line: DelayLine
  delay: number
  fb: number
  lp: OnePole
  /** −1 while held; otherwise samples left before the slot is freed. */
  releaseLeft: number
  dead: boolean
}

export class StringResUnit implements StereoProcessor {
  private strings: StringVoice[] = []
  private pool: DelayLine[] = []
  private on = false
  private pedal = false
  private readonly mix: Smoother
  private readonly maxDelay: number

  constructor(private readonly sr: number) {
    this.mix = new Smoother(sr, 10, MIX_NORMAL)
    this.maxDelay = sr / 25
  }

  /** MIDI notes currently modelled as undamped strings (excluding releasing ones). */
  get heldStrings(): number[] {
    return this.strings.filter((s) => !s.dead && s.releaseLeft < 0).map((s) => s.midi)
  }

  get enabled() {
    return this.on
  }

  private fbFor(midi: number): number {
    const base = 0.985 + 0.01 * clamp((84 - midi) / 48, 0, 1) + (this.pedal ? 0.004 : 0)
    return Math.min(0.997, base)
  }

  private releaseFbFor(delay: number): number {
    // −60 dB over 0.4 s whatever the pitch, so low strings are not cut mid-ring.
    return Math.exp((Math.log(0.001) * delay) / (0.4 * this.sr))
  }

  setParams(p: StringResParams) {
    this.on = !!p.on
    this.pedal = !!p.pedal
    this.mix.set(this.pedal ? MIX_PEDAL : MIX_NORMAL)
    const wanted = new Set<number>()
    for (const m of p.strings) if (Number.isFinite(m)) wanted.add(Math.round(m))
    for (const s of this.strings) {
      if (s.dead) continue
      if (wanted.has(s.midi)) {
        s.releaseLeft = -1
        s.fb = this.fbFor(s.midi)
        wanted.delete(s.midi)
      } else if (s.releaseLeft < 0) {
        s.releaseLeft = Math.round(RELEASE_SECONDS * this.sr)
        s.fb = this.releaseFbFor(s.delay)
      }
    }
    for (const midi of wanted) {
      if (this.strings.filter((s) => !s.dead && s.releaseLeft < 0).length >= MAX_STRINGS) break
      const delay = this.sr / midiHz(midi)
      if (delay < 2 || delay > this.maxDelay) continue
      const line = this.pool.pop() ?? new DelayLine(this.maxDelay + 2)
      line.reset()
      const lp = new OnePole()
      lp.setCutoff(this.sr, LOOP_LP_HZ)
      this.strings.push({ midi, line, delay, fb: this.fbFor(midi), lp, releaseLeft: -1, dead: false })
    }
  }

  process(l: Float32Array, r: Float32Array, n: number) {
    if (!this.on) return
    let live = 0
    for (const s of this.strings) if (!s.dead) live++
    if (live === 0) return
    for (let i = 0; i < n; i++) {
      const mix = this.mix.next()
      const x = (l[i] + r[i]) * 0.5
      let sum = 0
      for (const s of this.strings) {
        if (s.dead) continue
        const rec = s.lp.lp(s.line.read(s.delay)) * s.fb
        let v = x * (1 - s.fb) + rec
        if (v > 4) v = 4
        else if (v < -4) v = -4
        s.line.write(v)
        sum += rec
        if (s.releaseLeft > 0) {
          s.releaseLeft--
          if (s.releaseLeft === 0) s.dead = true
        }
      }
      const add = sum * mix
      l[i] += add
      r[i] += add
    }
    if (this.strings.some((s) => s.dead)) {
      for (const s of this.strings) if (s.dead) this.pool.push(s.line)
      this.strings = this.strings.filter((s) => !s.dead)
    }
  }

  reset() {
    for (const s of this.strings) {
      s.line.reset()
      s.lp.reset()
    }
    this.mix.snap(this.mix.target)
  }
}

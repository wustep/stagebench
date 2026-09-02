/**
 * DSP building blocks shared by every unit: RBJ biquads, one-pole filters, parameter smoothing, LFOs, fractional
 * delay lines, envelope followers, a tube-style saturator, a state-variable filter and a seeded PRNG.
 * Everything advances one sample at a time so results never depend on the host's block size.
 */
import { clamp } from './types'

export const TWO_PI = 2 * Math.PI
export const HALF_PI = Math.PI / 2

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

function clampFreq(f: number, sr: number): number {
  return clamp(f, 10, sr * 0.45)
}

/** RBJ "Audio EQ Cookbook" biquad, transposed direct form II. */
export class Biquad {
  b0 = 1
  b1 = 0
  b2 = 0
  a1 = 0
  a2 = 0
  private z1 = 0
  private z2 = 0

  process(x: number): number {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }

  reset() {
    this.z1 = 0
    this.z2 = 0
  }

  identity() {
    this.b0 = 1
    this.b1 = this.b2 = this.a1 = this.a2 = 0
  }

  copyFrom(o: Biquad) {
    this.b0 = o.b0
    this.b1 = o.b1
    this.b2 = o.b2
    this.a1 = o.a1
    this.a2 = o.a2
  }

  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) {
    const n = 1 / a0
    this.b0 = b0 * n
    this.b1 = b1 * n
    this.b2 = b2 * n
    this.a1 = a1 * n
    this.a2 = a2 * n
  }

  lowpass(sr: number, f: number, q = Math.SQRT1_2) {
    const w = (TWO_PI * clampFreq(f, sr)) / sr
    const c = Math.cos(w)
    const a = Math.sin(w) / (2 * Math.max(0.05, q))
    this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + a, -2 * c, 1 - a)
  }

  highpass(sr: number, f: number, q = Math.SQRT1_2) {
    const w = (TWO_PI * clampFreq(f, sr)) / sr
    const c = Math.cos(w)
    const a = Math.sin(w) / (2 * Math.max(0.05, q))
    this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + a, -2 * c, 1 - a)
  }

  /** Constant 0 dB peak-gain band-pass. */
  bandpass(sr: number, f: number, q: number) {
    const w = (TWO_PI * clampFreq(f, sr)) / sr
    const c = Math.cos(w)
    const a = Math.sin(w) / (2 * Math.max(0.05, q))
    this.set(a, 0, -a, 1 + a, -2 * c, 1 - a)
  }

  peaking(sr: number, f: number, q: number, db: number) {
    const A = Math.pow(10, db / 40)
    const w = (TWO_PI * clampFreq(f, sr)) / sr
    const c = Math.cos(w)
    const a = Math.sin(w) / (2 * Math.max(0.05, q))
    this.set(1 + a * A, -2 * c, 1 - a * A, 1 + a / A, -2 * c, 1 - a / A)
  }

  lowShelf(sr: number, f: number, db: number) {
    const A = Math.pow(10, db / 40)
    const w = (TWO_PI * clampFreq(f, sr)) / sr
    const c = Math.cos(w)
    const b = 2 * Math.sqrt(A) * ((Math.sin(w) / 2) * Math.SQRT2)
    this.set(A * (A + 1 - (A - 1) * c + b), 2 * A * (A - 1 - (A + 1) * c), A * (A + 1 - (A - 1) * c - b), A + 1 + (A - 1) * c + b, -2 * (A - 1 + (A + 1) * c), A + 1 + (A - 1) * c - b)
  }

  highShelf(sr: number, f: number, db: number) {
    const A = Math.pow(10, db / 40)
    const w = (TWO_PI * clampFreq(f, sr)) / sr
    const c = Math.cos(w)
    const b = 2 * Math.sqrt(A) * ((Math.sin(w) / 2) * Math.SQRT2)
    this.set(A * (A + 1 + (A - 1) * c + b), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - b), A + 1 - (A - 1) * c + b, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - b)
  }
}

/** One-pole low-pass (and the complementary high-pass). */
export class OnePole {
  private k = 1
  private y = 0

  setCutoff(sr: number, fc: number) {
    this.k = 1 - Math.exp((-TWO_PI * clamp(fc, 0.5, sr * 0.45)) / sr)
  }

  lp(x: number): number {
    this.y += this.k * (x - this.y)
    return this.y
  }

  hp(x: number): number {
    return x - this.lp(x)
  }

  reset() {
    this.y = 0
  }
}

/** One-pole parameter smoother (default 10 ms time constant) that snaps exactly onto its target once close. */
export class Smoother {
  private readonly k: number
  private y: number
  private t: number
  private done = true

  constructor(sr: number, ms = 10, initial = 0) {
    this.k = 1 - Math.exp(-1000 / (Math.max(0.01, ms) * sr))
    this.y = initial
    this.t = initial
  }

  set(target: number) {
    if (target !== this.t) {
      this.t = target
      this.done = false
    }
  }

  snap(v: number) {
    this.y = v
    this.t = v
    this.done = true
  }

  next(): number {
    if (this.done) return this.y
    this.y += (this.t - this.y) * this.k
    if (Math.abs(this.t - this.y) <= 1e-6 * Math.max(1, Math.abs(this.t))) {
      this.y = this.t
      this.done = true
    }
    return this.y
  }

  get value() {
    return this.y
  }

  get target() {
    return this.t
  }

  get settled() {
    return this.done
  }
}

/** Phase-accumulating LFO; read any shape at any phase offset after `advance()`. */
export class Lfo {
  phase: number
  private inc = 0

  constructor(private readonly sr: number, hz = 1, phase = 0) {
    this.phase = phase
    this.setRate(hz)
  }

  setRate(hz: number) {
    this.inc = Math.max(0, hz) / this.sr
  }

  advance() {
    this.phase += this.inc
    if (this.phase >= 1) this.phase -= Math.floor(this.phase)
  }

  /** Advances and reports whether the phase wrapped on this sample. */
  advanceWrap(): boolean {
    this.phase += this.inc
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase)
      return true
    }
    return false
  }

  sin(offset = 0): number {
    return Math.sin(TWO_PI * (this.phase + offset))
  }

  tri(offset = 0): number {
    const p = this.phase + offset
    const f = p - Math.floor(p)
    return 4 * Math.abs(f - 0.5) - 1
  }

  square(offset = 0): number {
    const p = this.phase + offset
    return p - Math.floor(p) < 0.5 ? 1 : -1
  }

  reset(phase = 0) {
    this.phase = phase
  }
}

/** Circular delay line with linear-interpolated fractional reads. Call `read` before `write` each sample. */
export class DelayLine {
  private readonly buf: Float32Array
  private readonly mask: number
  private w = 0

  constructor(maxSamples: number) {
    const size = nextPow2(Math.ceil(maxSamples) + 4)
    this.buf = new Float32Array(size)
    this.mask = size - 1
  }

  get maxDelay() {
    return this.buf.length - 3
  }

  write(x: number) {
    this.buf[this.w] = x
    this.w = (this.w + 1) & this.mask
  }

  /** The sample written `d` samples ago (d ≥ 1, fractional). */
  read(d: number): number {
    const dd = d < 1 ? 1 : d > this.maxDelay ? this.maxDelay : d
    const pos = this.w - dd
    const i = Math.floor(pos)
    const frac = pos - i
    const a = this.buf[i & this.mask]
    const b = this.buf[(i + 1) & this.mask]
    return a + (b - a) * frac
  }

  /** Integer read (d ≥ 1). */
  readInt(d: number): number {
    return this.buf[(this.w - d) & this.mask]
  }

  reset() {
    this.buf.fill(0)
    this.w = 0
  }
}

/** Peak envelope follower with separate attack and release time constants. */
export class EnvFollower {
  private readonly ka: number
  private readonly kr: number
  env = 0

  constructor(sr: number, attackMs: number, releaseMs: number) {
    this.ka = 1 - Math.exp(-1000 / (Math.max(0.01, attackMs) * sr))
    this.kr = 1 - Math.exp(-1000 / (Math.max(0.01, releaseMs) * sr))
  }

  process(x: number): number {
    const a = Math.abs(x)
    this.env += (a - this.env) * (a > this.env ? this.ka : this.kr)
    return this.env
  }

  reset() {
    this.env = 0
  }
}

/** Asymmetric tube-style soft clipper: tanh on the positive half, a softer knee on the negative half (even harmonics). */
export function tubeSaturate(x: number): number {
  return x >= 0 ? Math.tanh(x) : Math.tanh(x * 0.85) / 0.85
}

/** Fades to silence over `ms`, applies a pending switch, then fades back in, so type changes never jump. */
export class SwitchFade {
  private g = 1
  private readonly step: number
  private target = 1
  private pending: (() => void) | null = null

  constructor(sr: number, ms = 2.5) {
    this.step = 1 / Math.max(1, Math.round((ms / 1000) * sr))
  }

  request(apply: () => void) {
    this.pending = apply
    this.target = 0
  }

  get value() {
    return this.g
  }

  get idle() {
    return this.g === 1 && this.pending === null
  }

  next(): number {
    if (this.target === 0) {
      this.g = Math.max(0, this.g - this.step)
      if (this.g === 0) {
        const p = this.pending
        this.pending = null
        this.target = 1
        p?.()
      }
    } else if (this.g < 1) {
      this.g = Math.min(1, this.g + this.step)
    }
    return this.g
  }

  /** Applies any pending switch immediately and returns to unity. */
  reset() {
    const p = this.pending
    this.pending = null
    this.g = 1
    this.target = 1
    p?.()
  }
}

/** Trapezoidal (Simper) state-variable filter: unconditionally stable with per-sample cutoff changes. */
export class Svf {
  low = 0
  band = 0
  high = 0
  private ic1 = 0
  private ic2 = 0
  private a1 = 0
  private a2 = 0
  private a3 = 0
  private k = 1

  constructor(private readonly sr: number) {
    this.set(1000, 0.707)
  }

  set(fc: number, q: number) {
    const g = Math.tan((Math.PI * clamp(fc, 10, this.sr * 0.45)) / this.sr)
    this.k = 1 / Math.max(0.1, q)
    this.a1 = 1 / (1 + g * (g + this.k))
    this.a2 = g * this.a1
    this.a3 = g * this.a2
  }

  copyFrom(o: Svf) {
    this.k = o.k
    this.a1 = o.a1
    this.a2 = o.a2
    this.a3 = o.a3
  }

  process(x: number) {
    const v3 = x - this.ic2
    const v1 = this.a1 * this.ic1 + this.a2 * v3
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    this.low = v2
    this.band = v1 * this.k // normalised to unity peak gain at resonance
    this.high = x - this.k * v1 - v2
  }

  reset() {
    this.ic1 = this.ic2 = this.low = this.band = this.high = 0
  }
}

/** Coefficient of a first-order all-pass with its −90° point at `f`. */
export function allpassCoefficient(sr: number, f: number): number {
  const t = Math.tan((Math.PI * clamp(f, 10, sr * 0.45)) / sr)
  return (t - 1) / (t + 1)
}

/** First-order all-pass section for phasers: −90° at the break frequency. */
export class Allpass1 {
  private a = 0
  private x1 = 0
  private y1 = 0

  setBreak(sr: number, f: number) {
    this.a = allpassCoefficient(sr, f)
  }

  setCoefficient(a: number) {
    this.a = a
  }

  process(x: number): number {
    const y = this.a * x + this.x1 - this.a * this.y1
    this.x1 = x
    this.y1 = y
    return y
  }

  reset() {
    this.x1 = this.y1 = 0
  }
}

/** mulberry32 — tiny deterministic PRNG. */
export class Rng {
  private s: number

  constructor(seed: number) {
    this.s = seed >>> 0
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const msToSamples = (ms: number, sr: number) => (ms / 1000) * sr
export const midiHz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

import {
  AmpType,
  DelayFilter,
  Mod1Type,
  Mod2Type,
  ReverbTone,
  ReverbType,
  Timbre,
  filterFrequency,
  midFrequency,
  mod1Rate,
  mod2Rate,
  ringFrequency,
  type AmpSound,
  type ChainSound,
  type CompSound,
  type DelaySound,
  type ModSound,
  type ReverbSound,
  type TimbreFamily,
} from './params'

/**
 * The Layer Effects units. Everything here is plain arithmetic on blocks of at most
 * FX_BLOCK stereo frames, processed in place. One `FxChain` belongs to one layer and runs
 * its units in the documented order:
 *
 *   Mod 1 → Mod 2 → Delay → Amp Sim/EQ (or filter) → Compressor → Reverb
 *
 * and the kernel follows it with the Rotary path (when routed) and the layer level.
 *
 * Every unit is switched in and out with a 12 ms crossfade against its own dry input, so
 * on/bypass never clicks; a bypassed unit costs nothing and has its memory cleared.
 */

export const FX_BLOCK = 128
const TWO_PI = Math.PI * 2
const SWITCH_SECONDS = 0.012

function nextPowerOfTwo(value: number): number {
  let size = 1
  while (size < value) size *= 2
  return size
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

// ── Building blocks ───────────────────────────────────────────────────────────

/** Two-channel biquad (transposed direct form II) with shared coefficients. */
export class Biquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private l1 = 0
  private l2 = 0
  private r1 = 0
  private r2 = 0

  reset(): void {
    this.l1 = this.l2 = this.r1 = this.r2 = 0
  }

  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): void {
    this.b0 = b0 / a0
    this.b1 = b1 / a0
    this.b2 = b2 / a0
    this.a1 = a1 / a0
    this.a2 = a2 / a0
  }

  lowpass(sr: number, frequency: number, q: number): void {
    const w = (TWO_PI * Math.min(frequency, sr * 0.45)) / sr
    const cos = Math.cos(w)
    const alpha = Math.sin(w) / (2 * q)
    this.set((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha)
  }

  highpass(sr: number, frequency: number, q: number): void {
    const w = (TWO_PI * Math.min(frequency, sr * 0.45)) / sr
    const cos = Math.cos(w)
    const alpha = Math.sin(w) / (2 * q)
    this.set((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha)
  }

  /** Band-pass with 0 dB peak gain. */
  bandpass(sr: number, frequency: number, q: number): void {
    const w = (TWO_PI * Math.min(frequency, sr * 0.45)) / sr
    const cos = Math.cos(w)
    const alpha = Math.sin(w) / (2 * q)
    this.set(alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha)
  }

  peaking(sr: number, frequency: number, q: number, gainDb: number): void {
    const a = Math.pow(10, gainDb / 40)
    const w = (TWO_PI * Math.min(frequency, sr * 0.45)) / sr
    const cos = Math.cos(w)
    const alpha = Math.sin(w) / (2 * q)
    this.set(1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a)
  }

  lowShelf(sr: number, frequency: number, gainDb: number): void {
    const a = Math.pow(10, gainDb / 40)
    const w = (TWO_PI * Math.min(frequency, sr * 0.45)) / sr
    const cos = Math.cos(w)
    const beta = Math.sin(w) * Math.sqrt(2 * a)
    this.set(
      a * (a + 1 - (a - 1) * cos + beta),
      2 * a * (a - 1 - (a + 1) * cos),
      a * (a + 1 - (a - 1) * cos - beta),
      a + 1 + (a - 1) * cos + beta,
      -2 * (a - 1 + (a + 1) * cos),
      a + 1 + (a - 1) * cos - beta,
    )
  }

  highShelf(sr: number, frequency: number, gainDb: number): void {
    const a = Math.pow(10, gainDb / 40)
    const w = (TWO_PI * Math.min(frequency, sr * 0.45)) / sr
    const cos = Math.cos(w)
    const beta = Math.sin(w) * Math.sqrt(2 * a)
    this.set(
      a * (a + 1 + (a - 1) * cos + beta),
      -2 * a * (a - 1 + (a + 1) * cos),
      a * (a + 1 + (a - 1) * cos - beta),
      a + 1 - (a - 1) * cos + beta,
      2 * (a - 1 - (a + 1) * cos),
      a + 1 - (a - 1) * cos - beta,
    )
  }

  left(x: number): number {
    const y = this.b0 * x + this.l1
    this.l1 = this.b1 * x - this.a1 * y + this.l2
    this.l2 = this.b2 * x - this.a2 * y
    return y
  }

  right(x: number): number {
    const y = this.b0 * x + this.r1
    this.r1 = this.b1 * x - this.a1 * y + this.r2
    this.r2 = this.b2 * x - this.a2 * y
    return y
  }

  process(left: Float32Array, right: Float32Array, frames: number): void {
    for (let i = 0; i < frames; i += 1) {
      left[i] = this.left(left[i])
      right[i] = this.right(right[i])
    }
  }
}

/** Fractional delay line with linear interpolation. */
class DelayLine {
  readonly buffer: Float32Array
  private readonly mask: number
  private index = 0

  constructor(maxSamples: number) {
    const size = nextPowerOfTwo(Math.ceil(maxSamples) + 4)
    this.buffer = new Float32Array(size)
    this.mask = size - 1
  }

  reset(): void {
    this.buffer.fill(0)
  }

  write(x: number): void {
    this.buffer[this.index] = x
    this.index = (this.index + 1) & this.mask
  }

  /** Value written `delay` samples before the next write (delay >= 1). */
  read(delay: number): number {
    const position = this.index - delay
    const whole = Math.floor(position)
    const t = position - whole
    const a = this.buffer[whole & this.mask]
    const b = this.buffer[(whole + 1) & this.mask]
    return a + (b - a) * t
  }
}

/** One value that glides to its target in about 15 ms, read once per block. */
class Glide {
  value: number
  target: number
  private readonly coef: number

  constructor(initial: number, sr: number, seconds = 0.015) {
    this.value = initial
    this.target = initial
    this.coef = 1 - Math.exp(-FX_BLOCK / (seconds * sr))
  }

  next(): number {
    const delta = this.target - this.value
    this.value = Math.abs(delta) < 1e-6 ? this.target : this.value + delta * this.coef
    return this.value
  }

  snap(value: number): void {
    this.value = value
    this.target = value
  }
}

/** Base for every unit: click-free in/out switching against the unit's own dry input. */
abstract class Unit {
  protected readonly sr: number
  private wetness = 0
  private dirty = false
  private readonly dryL = new Float32Array(FX_BLOCK)
  private readonly dryR = new Float32Array(FX_BLOCK)

  constructor(sr: number) {
    this.sr = sr
  }

  /** True while the unit is processing (on, or still fading out). */
  get engaged(): boolean {
    return this.wetness > 0
  }

  process(left: Float32Array, right: Float32Array, frames: number, on: boolean): void {
    if (!on && this.wetness === 0) {
      if (this.dirty) {
        this.reset()
        this.dirty = false
      }
      return
    }
    // Coming on from rest: start from the current settings, not from wherever they last glided.
    if (!this.dirty) this.reset()
    const { dryL, dryR } = this
    for (let i = 0; i < frames; i += 1) {
      dryL[i] = left[i]
      dryR[i] = right[i]
    }
    this.run(left, right, frames)
    this.dirty = true
    const target = on ? 1 : 0
    if (this.wetness === 1 && target === 1) return
    const step = (target > this.wetness ? 1 : -1) / (SWITCH_SECONDS * this.sr)
    let amount = this.wetness
    for (let i = 0; i < frames; i += 1) {
      amount = clamp01(amount + step)
      left[i] = dryL[i] + amount * (left[i] - dryL[i])
      right[i] = dryR[i] + amount * (right[i] - dryR[i])
    }
    this.wetness = amount
  }

  /**
   * Take up the on/off position at once, with no crossfade. Only for a moment when no signal is
   * passing (the layer was asleep): there is nothing to click, and the first note must not be
   * heard dry while a fully wet effect fades in.
   */
  snap(on: boolean): void {
    this.wetness = on ? 1 : 0
  }

  /** Fade the processed signal back in from dry (used when the type changes under a live unit). */
  protected refade(): void {
    this.wetness = 0
  }

  hardReset(): void {
    this.reset()
    this.dirty = false
  }

  protected abstract run(left: Float32Array, right: Float32Array, frames: number): void
  protected abstract reset(): void
}

/** Topology-preserving state-variable filter: stable while its cutoff is swept every sample. */
class Svf {
  private s1 = 0
  private s2 = 0
  low = 0
  band = 0

  reset(): void {
    this.s1 = this.s2 = this.low = this.band = 0
  }

  tick(x: number, g: number, k: number): void {
    const v1 = (this.s1 + g * (x - this.s2)) / (1 + g * (g + k))
    const v2 = this.s2 + g * v1
    this.s1 = 2 * v1 - this.s1
    this.s2 = 2 * v2 - this.s2
    this.band = v1
    this.low = v2
  }
}

// ── Mod 1 ─────────────────────────────────────────────────────────────────────

export class Mod1 extends Unit {
  private type = -1
  private phase = 0
  private readonly rate: Glide
  private readonly amount: Glide
  private envelope = 0
  private readonly svfL = new Svf()
  private readonly svfR = new Svf()

  constructor(sr: number) {
    super(sr)
    this.rate = new Glide(0.3, sr)
    this.amount = new Glide(0.5, sr)
  }

  configure(sound: ModSound): void {
    if (sound.type !== this.type) {
      if (this.type !== -1 && this.engaged) this.refade()
      this.type = sound.type
      this.svfL.reset()
      this.svfR.reset()
    }
    this.rate.target = sound.rate
    this.amount.target = sound.amount
  }

  protected reset(): void {
    this.phase = 0
    this.envelope = 0
    this.svfL.reset()
    this.svfR.reset()
    this.rate.snap(this.rate.target)
    this.amount.snap(this.amount.target)
  }

  protected run(left: Float32Array, right: Float32Array, frames: number): void {
    const sr = this.sr
    const rate = this.rate.next()
    const amount = this.amount.next()
    let phase = this.phase
    switch (this.type) {
      case Mod1Type.APan: {
        const step = mod1Rate(rate) / sr
        for (let i = 0; i < frames; i += 1) {
          const angle = ((1 + amount * Math.sin(TWO_PI * phase)) * Math.PI) / 4
          left[i] *= Math.cos(angle) * Math.SQRT2
          right[i] *= Math.sin(angle) * Math.SQRT2
          phase += step
          if (phase >= 1) phase -= 1
        }
        break
      }
      case Mod1Type.Tremolo: {
        // Full level at zero amount; the dips deepen as Amount rises.
        const step = mod1Rate(rate) / sr
        for (let i = 0; i < frames; i += 1) {
          const gain = 1 - amount * (0.5 - 0.5 * Math.cos(TWO_PI * phase))
          left[i] *= gain
          right[i] *= gain
          phase += step
          if (phase >= 1) phase -= 1
        }
        break
      }
      case Mod1Type.RingMod: {
        const step = ringFrequency(rate) / sr
        for (let i = 0; i < frames; i += 1) {
          const gain = 1 - amount + amount * Math.sin(TWO_PI * phase)
          left[i] *= gain
          right[i] *= gain
          phase += step
          if (phase >= 1) phase -= 1
        }
        break
      }
      case Mod1Type.AWah: {
        // Envelope follower opens a band-pass; the Rate knob is the sensitivity.
        const attack = 1 - Math.exp(-1 / (0.004 * sr))
        const release = 1 - Math.exp(-1 / (0.14 * sr))
        const sensitivity = 2 + 22 * rate
        let envelope = this.envelope
        for (let i = 0; i < frames; i += 1) {
          const level = Math.max(Math.abs(left[i]), Math.abs(right[i]))
          envelope += (level - envelope) * (level > envelope ? attack : release)
          const cutoff = 300 * Math.pow(2, 3.4 * Math.min(1, envelope * sensitivity))
          const g = Math.tan((Math.PI * cutoff) / sr)
          this.svfL.tick(left[i], g, 0.28)
          this.svfR.tick(right[i], g, 0.28)
          left[i] += amount * (this.svfL.band * 1.3 - left[i])
          right[i] += amount * (this.svfR.band * 1.3 - right[i])
        }
        this.envelope = envelope
        break
      }
      case Mod1Type.Wah: {
        // LFO sweeps a resonant low-pass.
        const step = mod1Rate(rate) / sr
        for (let i = 0; i < frames; i += 1) {
          const sweep = 0.5 - 0.5 * Math.cos(TWO_PI * phase)
          const g = Math.tan((Math.PI * 320 * Math.pow(2, 3.2 * sweep)) / sr)
          this.svfL.tick(left[i], g, 0.34)
          this.svfR.tick(right[i], g, 0.34)
          left[i] += amount * (this.svfL.low * 0.6 - left[i])
          right[i] += amount * (this.svfR.low * 0.6 - right[i])
          phase += step
          if (phase >= 1) phase -= 1
        }
        break
      }
      default: {
        // Pump: a quick duck at the top of every cycle, then a slower recovery.
        const step = mod1Rate(rate) / sr
        for (let i = 0; i < frames; i += 1) {
          const attack = phase < 0.04 ? phase / 0.04 : 1
          const gain = 1 - amount * attack * Math.exp(-4.5 * phase)
          left[i] *= gain
          right[i] *= gain
          phase += step
          if (phase >= 1) phase -= 1
        }
      }
    }
    this.phase = phase
  }
}

// ── Mod 2 ─────────────────────────────────────────────────────────────────────

/** First-order all-pass with one sample of state per channel. */
class AllpassPair {
  l = 0
  r = 0
  reset(): void {
    this.l = this.r = 0
  }
}

export class Mod2 extends Unit {
  private type = -1
  private phase = 0
  private phase2 = 0
  private readonly rate: Glide
  private readonly amount: Glide
  /** Spin ramps its speed gradually, like a rotor. */
  private spinRate = 0
  private readonly lines: DelayLine[]
  private readonly stages = Array.from({ length: 6 }, () => new AllpassPair())
  private feedL = 0
  private feedR = 0
  private readonly cross = new Float32Array(3)

  constructor(sr: number) {
    super(sr)
    this.rate = new Glide(0.5, sr)
    this.amount = new Glide(0.3, sr)
    this.lines = Array.from({ length: 4 }, () => new DelayLine(sr * 0.06))
  }

  configure(sound: ModSound): void {
    if (sound.type !== this.type) {
      if (this.type !== -1 && this.engaged) this.refade()
      this.type = sound.type
      this.clear()
    }
    this.rate.target = sound.rate
    this.amount.target = sound.amount
  }

  private clear(): void {
    for (const line of this.lines) line.reset()
    for (const stage of this.stages) stage.reset()
    this.feedL = this.feedR = 0
    this.cross.fill(0)
  }

  protected reset(): void {
    this.clear()
    this.phase = this.phase2 = 0
    this.spinRate = 0
    this.rate.snap(this.rate.target)
    this.amount.snap(this.amount.target)
  }

  protected run(left: Float32Array, right: Float32Array, frames: number): void {
    const sr = this.sr
    const rate = this.rate.next()
    const amount = this.amount.next()
    const hz = mod2Rate(rate)
    let phase = this.phase
    let phase2 = this.phase2
    const a = this.lines[0]
    const b = this.lines[1]
    const c = this.lines[2]
    const d = this.lines[3]
    const ms = sr / 1000

    switch (this.type) {
      case Mod2Type.Chorus: {
        // Two modulated copies; above half Amount a second, slower pair joins in.
        const step = hz / sr
        const depth = (0.4 + 3.2 * amount) * ms
        const second = Math.max(0, amount - 0.5) * 2
        for (let i = 0; i < frames; i += 1) {
          const sin = Math.sin(TWO_PI * phase)
          const cos = Math.cos(TWO_PI * phase)
          const slow = Math.sin(TWO_PI * phase2)
          a.write(left[i])
          b.write(right[i])
          let wetL = a.read(9 * ms + depth * sin)
          let wetR = b.read(9 * ms + depth * cos)
          wetL += second * 0.7 * b.read(19 * ms + depth * 1.4 * slow)
          wetR += second * 0.7 * a.read(19 * ms - depth * 1.4 * slow)
          left[i] = 0.72 * left[i] + 0.72 * wetL
          right[i] = 0.72 * right[i] + 0.72 * wetR
          phase += step
          if (phase >= 1) phase -= 1
          phase2 += step * 0.63
          if (phase2 >= 1) phase2 -= 1
        }
        break
      }
      case Mod2Type.Flanger: {
        // Comb filter with feedback. At zero Amount it stands still: static resonant peaks.
        const step = hz / sr
        const depth = 4.5 * amount * ms
        for (let i = 0; i < frames; i += 1) {
          const sweepL = 0.5 - 0.5 * Math.cos(TWO_PI * phase)
          const sweepR = 0.5 - 0.5 * Math.cos(TWO_PI * (phase + 0.25))
          const wetL = a.read(0.7 * ms + depth * sweepL)
          const wetR = b.read(0.7 * ms + depth * sweepR)
          a.write(left[i] + 0.72 * wetL)
          b.write(right[i] + 0.72 * wetR)
          left[i] = 0.62 * (left[i] + wetL)
          right[i] = 0.62 * (right[i] + wetR)
          phase += step
          if (phase >= 1) phase -= 1
        }
        break
      }
      case Mod2Type.Phaser: {
        // Four aligned all-pass stages; Amount adds feedback "colour" (none at minimum).
        const step = hz / sr
        const feedback = 0.78 * amount
        for (let i = 0; i < frames; i += 1) {
          const sweep = 0.5 - 0.5 * Math.cos(TWO_PI * phase)
          const t = Math.tan((Math.PI * 280 * Math.pow(2, 3.4 * sweep)) / sr)
          const k = (t - 1) / (t + 1)
          let l = left[i] + feedback * this.feedL
          let r = right[i] + feedback * this.feedR
          for (let s = 0; s < 4; s += 1) {
            const stage = this.stages[s]
            const yl = k * l + stage.l
            stage.l = l - k * yl
            l = yl
            const yr = k * r + stage.r
            stage.r = r - k * yr
            r = yr
          }
          this.feedL = l
          this.feedR = r
          left[i] = 0.6 * (left[i] + l)
          right[i] = 0.6 * (right[i] + r)
          phase += step
          if (phase >= 1) phase -= 1
        }
        break
      }
      case Mod2Type.Vibe: {
        // Four staggered phasing filters, each sweeping its own band: phasing plus pitch wobble.
        const step = hz / sr
        const depth = (0.3 + 0.7 * amount) * 2.2
        for (let i = 0; i < frames; i += 1) {
          const lfo = Math.sin(TWO_PI * phase)
          // The lamp-and-photocell "throb": it lingers at the ends of the sweep.
          const throb = lfo * (1.5 - 0.5 * Math.abs(lfo))
          let l = left[i]
          let r = right[i]
          for (let s = 0; s < 4; s += 1) {
            const stage = this.stages[s]
            // Staggered: every stage sits in its own band, and alternate stages sweep opposite ways.
            const centre = 110 * Math.pow(2.6, s) * Math.pow(2, depth * (s % 2 === 0 ? throb : -0.6 * throb))
            const t = Math.tan((Math.PI * Math.min(centre, sr * 0.4)) / sr)
            const k = (t - 1) / (t + 1)
            const yl = k * l + stage.l
            stage.l = l - k * yl
            l = yl
            const yr = k * r + stage.r
            stage.r = r - k * yr
            r = yr
          }
          left[i] = 0.62 * (left[i] + l)
          right[i] = 0.62 * (right[i] + r)
          phase += step
          if (phase >= 1) phase -= 1
        }
        break
      }
      case Mod2Type.Ensemble: {
        // Three modulated delay lines, 120° apart, each fed a little of its neighbour.
        const slowStep = (0.15 + hz * 0.12) / sr
        const fastStep = (5.2 + hz * 0.25) / sr
        const slowDepth = (0.6 + 1.6 * amount) * ms
        const fastDepth = (0.08 + 0.22 * amount) * ms
        const cross = this.cross
        const taps = this.lines
        for (let i = 0; i < frames; i += 1) {
          const input = 0.5 * (left[i] + right[i])
          let wetL = 0
          let wetR = 0
          for (let k = 0; k < 3; k += 1) {
            const offset = k / 3
            const delay =
              7 * ms +
              slowDepth * Math.sin(TWO_PI * (phase + offset)) +
              fastDepth * Math.sin(TWO_PI * (phase2 + offset))
            const out = taps[k].read(delay)
            taps[k].write(input + 0.22 * cross[(k + 1) % 3])
            cross[k] = out
            wetL += out * (k === 0 ? 1 : k === 1 ? 0.6 : 0.2)
            wetR += out * (k === 2 ? 1 : k === 1 ? 0.6 : 0.2)
          }
          const wet = 0.35 + 0.4 * amount
          left[i] = 0.7 * left[i] + wet * wetL
          right[i] = 0.7 * right[i] + wet * wetR
          phase += slowStep
          if (phase >= 1) phase -= 1
          phase2 += fastStep
          if (phase2 >= 1) phase2 -= 1
        }
        break
      }
      default: {
        // Spin: a neutral rotating-speaker feel. Speed changes ramp, they do not jump.
        if (this.spinRate === 0) this.spinRate = hz
        const ramp = 1 - Math.exp(-FX_BLOCK / (1.2 * sr))
        this.spinRate += (hz - this.spinRate) * ramp
        const step = this.spinRate / sr
        const depth = 0.3 * ms * (0.3 + amount)
        for (let i = 0; i < frames; i += 1) {
          const sin = Math.sin(TWO_PI * phase)
          const cos = Math.cos(TWO_PI * phase)
          c.write(left[i])
          d.write(right[i])
          const l = c.read(1.5 * ms + depth * sin)
          const r = d.read(1.5 * ms - depth * sin)
          left[i] = l * (1 + 0.55 * amount * cos)
          right[i] = r * (1 - 0.55 * amount * cos)
          phase += step
          if (phase >= 1) phase -= 1
        }
      }
    }
    this.phase = phase
    this.phase2 = phase2
  }
}

// ── Delay ─────────────────────────────────────────────────────────────────────

export class Delay extends Unit {
  private readonly lineL: DelayLine
  private readonly lineR: DelayLine
  private readonly filter = new Biquad()
  private filterType = -1
  private pingPong = false
  private readonly feedback: Glide
  private readonly mix: Glide
  /** Current and incoming delay times in samples; `fade` crossfades between them. */
  private timeA = 0
  private timeB = 0
  private fade = 1
  private wanted = 0

  constructor(sr: number) {
    super(sr)
    this.lineL = new DelayLine(sr * 1.6)
    this.lineR = new DelayLine(sr * 1.6)
    this.feedback = new Glide(0.4, sr)
    this.mix = new Glide(0.3, sr)
  }

  configure(sound: DelaySound): void {
    this.wanted = Math.max(8, Math.min(1.55 * this.sr, sound.time * this.sr))
    if (this.timeA === 0) this.timeA = this.timeB = this.wanted
    this.feedback.target = 0.93 * sound.feedback
    this.mix.target = sound.mix
    this.pingPong = sound.pingPong
    if (sound.filter !== this.filterType) {
      this.filterType = sound.filter
      this.filter.reset()
      if (sound.filter === DelayFilter.LP) this.filter.lowpass(this.sr, 1800, 0.707)
      else if (sound.filter === DelayFilter.HP) this.filter.highpass(this.sr, 700, 0.707)
      else if (sound.filter === DelayFilter.BP) this.filter.bandpass(this.sr, 1200, 0.8)
    }
  }

  protected reset(): void {
    this.lineL.reset()
    this.lineR.reset()
    this.filter.reset()
    this.timeA = this.timeB = this.wanted
    this.fade = 1
    this.feedback.snap(this.feedback.target)
    this.mix.snap(this.mix.target)
  }

  protected run(left: Float32Array, right: Float32Array, frames: number): void {
    // A tempo change crossfades to a second read tap, so repeats never change pitch.
    if (this.fade >= 1 && Math.abs(this.wanted - this.timeB) > 0.5) {
      this.timeA = this.timeB
      this.timeB = this.wanted
      this.fade = 0
    }
    const fadeStep = 1 / (0.05 * this.sr)
    const feedback = this.feedback.next()
    const mix = this.mix.next()
    const dry = Math.cos((mix * Math.PI) / 2)
    const wet = Math.sin((mix * Math.PI) / 2)
    const filtered = this.filterType !== DelayFilter.Off
    const { lineL, lineR, filter, timeA, timeB } = this
    let fade = this.fade
    for (let i = 0; i < frames; i += 1) {
      let tapL = lineL.read(timeB)
      let tapR = lineR.read(timeB)
      if (fade < 1) {
        tapL = lineL.read(timeA) * (1 - fade) + tapL * fade
        tapR = lineR.read(timeA) * (1 - fade) + tapR * fade
        fade = Math.min(1, fade + fadeStep)
      }
      // The filter sits in the feedback loop, on the way into the line: the first repeat has
      // been through it once, the second twice, and the dry signal never.
      let inL: number
      let inR: number
      if (this.pingPong) {
        inL = 0.5 * (left[i] + right[i]) + feedback * tapR
        inR = feedback * tapL
      } else {
        inL = left[i] + feedback * tapL
        inR = right[i] + feedback * tapR
      }
      if (filtered) {
        inL = filter.left(inL)
        inR = filter.right(inR)
      }
      lineL.write(inL)
      lineR.write(inR)
      left[i] = dry * left[i] + wet * tapL
      right[i] = dry * right[i] + wet * tapR
    }
    this.fade = fade
  }
}

// ── Amp Sim / EQ ──────────────────────────────────────────────────────────────

export class AmpEq extends Unit {
  private type = -1
  private readonly drive: Glide
  private readonly bass: Glide
  private readonly mid: Glide
  private readonly freq: Glide
  private readonly treble: Glide
  private readonly eqBass = new Biquad()
  private readonly eqMid = new Biquad()
  private readonly eqTreble = new Biquad()
  private readonly pre1 = new Biquad()
  private readonly pre2 = new Biquad()
  private readonly cabLow = new Biquad()
  private readonly cabHigh = new Biquad()
  private readonly pole1 = new Biquad()
  private readonly pole2 = new Biquad()
  private readonly last = new Float64Array(4).fill(NaN)

  constructor(sr: number) {
    super(sr)
    this.drive = new Glide(0, sr)
    this.bass = new Glide(0, sr)
    this.mid = new Glide(0, sr)
    this.freq = new Glide(0.5, sr)
    this.treble = new Glide(0, sr)
  }

  configure(sound: AmpSound): void {
    if (sound.type !== this.type) {
      if (this.type !== -1 && this.engaged) this.refade()
      this.type = sound.type
      this.clearFilters()
      this.voice()
    }
    this.drive.target = sound.drive
    this.bass.target = sound.bass
    this.mid.target = sound.mid
    this.freq.target = sound.freq
    this.treble.target = sound.treble
  }

  /** Fixed tone shaping of the three amplifier models. A documented approximation, not a circuit model. */
  private voice(): void {
    const sr = this.sr
    switch (this.type) {
      case AmpType.Twin:
        // Scooped mids, glassy top, wide open cabinet.
        this.pre1.peaking(sr, 500, 0.7, -5)
        this.pre2.highShelf(sr, 2200, 6)
        this.cabLow.highpass(sr, 70, 0.707)
        this.cabHigh.lowpass(sr, 5200, 0.8)
        break
      case AmpType.JC:
        // Clean and bright: a big treble lift, a small low-mid dip, an extended cabinet.
        this.pre1.peaking(sr, 800, 0.8, -3)
        this.pre2.highShelf(sr, 3000, 8)
        this.cabLow.highpass(sr, 90, 0.707)
        this.cabHigh.lowpass(sr, 7500, 0.707)
        break
      case AmpType.Small:
        // A small built-in speaker: no bass, no top, a honk around 1.1 kHz.
        this.pre1.peaking(sr, 1100, 1.4, 7)
        this.pre2.highShelf(sr, 2500, -2)
        this.cabLow.highpass(sr, 220, 0.8)
        this.cabHigh.lowpass(sr, 3400, 0.9)
        break
      default:
    }
  }

  private clearFilters(): void {
    for (const filter of [this.eqBass, this.eqMid, this.eqTreble, this.pre1, this.pre2, this.cabLow, this.cabHigh, this.pole1, this.pole2]) {
      filter.reset()
    }
    this.last.fill(NaN)
  }

  protected reset(): void {
    this.clearFilters()
    for (const glide of [this.drive, this.bass, this.mid, this.freq, this.treble]) glide.snap(glide.target)
  }

  protected run(left: Float32Array, right: Float32Array, frames: number): void {
    const sr = this.sr
    const drive = this.drive.next()
    const bass = this.bass.next()
    const mid = this.mid.next()
    const freq = this.freq.next()
    const treble = this.treble.next()
    const type = this.type
    const isFilter = type === AmpType.LP24 || type === AmpType.HP24
    const isAmp = type === AmpType.Twin || type === AmpType.JC || type === AmpType.Small

    const last = this.last
    if (last[0] !== bass || last[1] !== mid || last[2] !== freq || last[3] !== treble) {
      last[0] = bass
      last[1] = mid
      last[2] = freq
      last[3] = treble
      this.eqBass.lowShelf(sr, 100, bass)
      this.eqTreble.highShelf(sr, 4000, treble)
      if (isFilter) {
        // 24 dB/octave: two cascaded 12 dB sections; Res raises the second section's Q.
        const cutoff = filterFrequency(freq)
        const resonance = 1.307 + ((mid + 15) / 30) * 7
        if (type === AmpType.LP24) {
          this.pole1.lowpass(sr, cutoff, 0.541)
          this.pole2.lowpass(sr, cutoff, resonance)
        } else {
          this.pole1.highpass(sr, cutoff, 0.541)
          this.pole2.highpass(sr, cutoff, resonance)
        }
      } else {
        this.eqMid.peaking(sr, midFrequency(freq), 0.9, mid)
      }
    }

    // Drive stage. With Drive at zero the plain EQ and the filters stay exactly linear.
    if (isAmp) {
      const gain = type === AmpType.Twin ? 1.5 + 14 * drive : type === AmpType.JC ? 1.2 + 9 * drive : 2 + 18 * drive
      const trim = 1.15 / Math.pow(gain, 0.72)
      this.pre1.process(left, right, frames)
      this.pre2.process(left, right, frames)
      for (let i = 0; i < frames; i += 1) {
        left[i] = shape(left[i] * gain, type) * trim
        right[i] = shape(right[i] * gain, type) * trim
      }
      this.cabLow.process(left, right, frames)
      this.cabHigh.process(left, right, frames)
    } else if (drive > 0.001) {
      const gain = 1 + 9 * drive
      const trim = 1 / Math.pow(gain, 0.8)
      for (let i = 0; i < frames; i += 1) {
        left[i] = Math.tanh(left[i] * gain) * trim
        right[i] = Math.tanh(right[i] * gain) * trim
      }
    }

    this.eqBass.process(left, right, frames)
    if (isFilter) {
      this.pole1.process(left, right, frames)
      this.pole2.process(left, right, frames)
    } else {
      this.eqMid.process(left, right, frames)
    }
    this.eqTreble.process(left, right, frames)
  }
}

function shape(x: number, type: number): number {
  if (type === AmpType.JC) {
    // Solid-state: clean until it runs out of headroom, then a firm knee.
    const limited = x > 1.5 ? 1.5 : x < -1.5 ? -1.5 : x
    return limited - (limited * limited * limited) / 6.75
  }
  if (type === AmpType.Small) return Math.tanh(x + 0.18) - 0.17808
  // Twin: soft, slightly asymmetric tube curve.
  return x >= 0 ? Math.tanh(x) : Math.tanh(x * 0.85) / 0.85
}

// ── Compressor ────────────────────────────────────────────────────────────────

export class Compressor extends Unit {
  private readonly amount: Glide
  private fast = false
  private gainDb = 0
  /** True while the last block was being turned down by more than 1 dB. */
  active = false

  constructor(sr: number) {
    super(sr)
    this.amount = new Glide(0.2, sr)
  }

  configure(sound: CompSound): void {
    this.amount.target = sound.amount
    this.fast = sound.fast
  }

  protected reset(): void {
    this.gainDb = 0
    this.active = false
    this.amount.snap(this.amount.target)
  }

  protected run(left: Float32Array, right: Float32Array, frames: number): void {
    const amount = this.amount.next()
    const threshold = -8 - 30 * amount
    const slope = 1 - 1 / (1.5 + 6.5 * amount)
    const makeup = Math.pow(10, (-threshold * slope * 0.55) / 20)
    const attack = 1 - Math.exp(-1 / (0.004 * this.sr))
    // Fast mode recovers quickly enough to be heard "pumping" at high amounts.
    const release = 1 - Math.exp(-1 / ((this.fast ? 0.045 : 0.32) * this.sr))
    let gainDb = this.gainDb
    let deepest = 0
    for (let i = 0; i < frames; i += 1) {
      const level = Math.max(Math.abs(left[i]), Math.abs(right[i]))
      const levelDb = level > 1e-6 ? 20 * Math.log10(level) : -120
      const over = levelDb - threshold
      const wanted = over > 0 ? -over * slope : 0
      gainDb += (wanted - gainDb) * (wanted < gainDb ? attack : release)
      if (gainDb < deepest) deepest = gainDb
      const gain = Math.pow(10, gainDb / 20) * makeup
      left[i] *= gain
      right[i] *= gain
    }
    this.gainDb = Math.abs(gainDb) < 1e-9 ? 0 : gainDb
    this.active = deepest < -1
  }
}

// ── Reverb ────────────────────────────────────────────────────────────────────

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617] as const
const ALLPASS_TUNING = [556, 441, 341, 225] as const
const STEREO_SPREAD = 23

interface RoomShape {
  /** Seconds for the tail to fall 60 dB. */
  decay: number
  size: number
  preDelayMs: number
  damping: number
}
const ROOMS: Record<number, RoomShape> = {
  [ReverbType.Booth]: { decay: 0.28, size: 0.42, preDelayMs: 2, damping: 0.38 },
  [ReverbType.Room]: { decay: 0.75, size: 0.68, preDelayMs: 8, damping: 0.32 },
  [ReverbType.Stage]: { decay: 1.5, size: 0.9, preDelayMs: 16, damping: 0.3 },
  [ReverbType.Hall]: { decay: 2.8, size: 1.15, preDelayMs: 26, damping: 0.3 },
  [ReverbType.Cathedral]: { decay: 6.5, size: 1.5, preDelayMs: 42, damping: 0.22 },
}
const SPRING = { decay: 2.2, loopsMs: [37, 53], stages: [34, 26], coefficient: [0.62, 0.56] } as const

class Tank {
  readonly combs: Float32Array[] = []
  readonly combIndex = new Int32Array(8)
  readonly combLength = new Int32Array(8)
  readonly combStore = new Float32Array(8)
  readonly combFeedback = new Float32Array(8)
  readonly allpasses: Float32Array[] = []
  readonly allpassIndex = new Int32Array(4)
  readonly allpassLength = new Int32Array(4)

  constructor(sr: number, spread: number) {
    const scale = (sr / 44100) * 1.6
    for (const length of COMB_TUNING) this.combs.push(new Float32Array(Math.ceil((length + spread) * scale) + 2))
    for (const length of ALLPASS_TUNING) this.allpasses.push(new Float32Array(Math.ceil((length + spread) * scale) + 2))
  }

  reset(): void {
    for (const comb of this.combs) comb.fill(0)
    for (const allpass of this.allpasses) allpass.fill(0)
    this.combStore.fill(0)
    this.combIndex.fill(0)
    this.allpassIndex.fill(0)
  }

  shape(sr: number, spread: number, room: RoomShape): number {
    const scale = (sr / 44100) * room.size
    let energy = 0
    for (let k = 0; k < 8; k += 1) {
      const length = Math.max(8, Math.round((COMB_TUNING[k] + spread) * scale))
      this.combLength[k] = length
      const feedback = Math.pow(10, (-3 * length) / (room.decay * sr))
      this.combFeedback[k] = feedback
      energy += 1 / (1 - feedback * feedback)
    }
    for (let k = 0; k < 4; k += 1) {
      this.allpassLength[k] = Math.max(4, Math.round((ALLPASS_TUNING[k] + spread) * scale))
    }
    this.combIndex.fill(0)
    this.allpassIndex.fill(0)
    return 1 / Math.sqrt(energy)
  }

  tick(input: number, damping: number): number {
    let out = 0
    for (let k = 0; k < 8; k += 1) {
      const buffer = this.combs[k]
      const index = this.combIndex[k]
      const y = buffer[index]
      const store = y * (1 - damping) + this.combStore[k] * damping
      this.combStore[k] = store
      buffer[index] = input + store * this.combFeedback[k]
      this.combIndex[k] = index + 1 >= this.combLength[k] ? 0 : index + 1
      out += y
    }
    for (let k = 0; k < 4; k += 1) {
      const buffer = this.allpasses[k]
      const index = this.allpassIndex[k]
      // Schroeder all-pass (unity gain at every frequency): it only smears the echoes in time.
      const delayed = buffer[index]
      const y = delayed - 0.5 * out
      buffer[index] = out + 0.5 * y
      this.allpassIndex[k] = index + 1 >= this.allpassLength[k] ? 0 : index + 1
      out = y
    }
    return out
  }
}

/** One spring: a delay loop whose signal passes a long chain of all-pass stages (the "boing"). */
class SpringLine {
  private readonly line: DelayLine
  private readonly state: Float32Array
  private readonly delay: number
  private readonly coefficient: number
  private damp = 0

  constructor(sr: number, loopMs: number, stages: number, coefficient: number) {
    this.line = new DelayLine(sr * 0.08)
    this.state = new Float32Array(stages)
    this.delay = (loopMs / 1000) * sr
    this.coefficient = coefficient
  }

  reset(): void {
    this.line.reset()
    this.state.fill(0)
    this.damp = 0
  }

  feedbackFor(sr: number, decay: number): number {
    return Math.pow(10, (-3 * this.delay) / (decay * sr))
  }

  tick(input: number, feedback: number, damping: number): number {
    this.damp += (this.line.read(this.delay) - this.damp) * (1 - damping)
    let x = input + feedback * this.damp
    const k = this.coefficient
    const state = this.state
    for (let s = 0; s < state.length; s += 1) {
      const y = -k * x + state[s]
      state[s] = x + k * y
      x = y
    }
    this.line.write(x)
    return x
  }
}

export class Reverb extends Unit {
  private type = -1
  private tone = -1
  private readonly mix: Glide
  private readonly tankL: Tank
  private readonly tankR: Tank
  private readonly springs: SpringLine[]
  private readonly preDelay: DelayLine
  private readonly band = new Biquad()
  private readonly springTop = new Biquad()
  private readonly toneFilter = new Biquad()
  private preDelaySamples = 1
  private damping = 0.3
  private wetGain = 1
  private springFeedback = [0.8, 0.8]

  constructor(sr: number) {
    super(sr)
    this.mix = new Glide(0.3, sr)
    this.tankL = new Tank(sr, 0)
    this.tankR = new Tank(sr, STEREO_SPREAD)
    this.springs = SPRING.loopsMs.map(
      (loopMs, index) => new SpringLine(sr, loopMs, SPRING.stages[index], SPRING.coefficient[index]),
    )
    this.preDelay = new DelayLine(sr * 0.06)
  }

  configure(sound: ReverbSound): void {
    this.mix.target = sound.mix
    if (sound.type === this.type && sound.tone === this.tone) return
    if (this.type !== -1 && this.engaged) this.refade()
    this.type = sound.type
    this.tone = sound.tone
    this.clear()
    const sr = this.sr
    const dark = sound.tone === ReverbTone.Dark
    const bright = sound.tone === ReverbTone.Bright
    if (sound.type === ReverbType.Spring) {
      // A spring passes a limited band: nothing much below 150 Hz or above about 4 kHz.
      this.band.bandpass(sr, 900, 0.35)
      this.springTop.lowpass(sr, 3800, 0.707)
      this.springFeedback = this.springs.map((spring) => spring.feedbackFor(sr, SPRING.decay))
      const feedback = this.springFeedback[0]
      this.wetGain = 4.4 * Math.sqrt((1 - feedback * feedback) / 2)
      this.damping = dark ? 0.75 : bright ? 0.25 : 0.5
      this.preDelaySamples = 1
    } else {
      const room = ROOMS[sound.type] ?? ROOMS[ReverbType.Room]
      const norm = this.tankL.shape(sr, 0, room)
      this.tankR.shape(sr, STEREO_SPREAD, room)
      this.wetGain = norm * 1.6
      this.damping = dark ? Math.min(0.8, room.damping + 0.35) : bright ? room.damping * 0.45 : room.damping
      this.preDelaySamples = Math.max(1, (room.preDelayMs / 1000) * sr)
    }
    // Bright thins the low end of the tail; Dark rolls off its top.
    if (dark) this.toneFilter.lowpass(sr, 2600, 0.707)
    else if (bright) this.toneFilter.highpass(sr, 320, 0.707)
  }

  private clear(): void {
    this.tankL.reset()
    this.tankR.reset()
    for (const spring of this.springs) spring.reset()
    this.preDelay.reset()
    this.band.reset()
    this.springTop.reset()
    this.toneFilter.reset()
  }

  protected reset(): void {
    this.clear()
    this.mix.snap(this.mix.target)
  }

  protected run(left: Float32Array, right: Float32Array, frames: number): void {
    const mix = this.mix.next()
    // Fully wet at the top of the knob.
    const dry = Math.cos((mix * Math.PI) / 2)
    const wet = Math.sin((mix * Math.PI) / 2) * this.wetGain
    const toned = this.tone !== ReverbTone.Off
    const { damping, preDelay, preDelaySamples, toneFilter } = this
    if (this.type === ReverbType.Spring) {
      const [first, second] = this.springs
      const [f1, f2] = this.springFeedback
      for (let i = 0; i < frames; i += 1) {
        const input = this.band.left(0.5 * (left[i] + right[i]))
        const a = first.tick(input, f1, damping)
        const b = second.tick(input, f2, damping)
        let wetL = this.springTop.left(a + 0.5 * b)
        let wetR = this.springTop.right(b + 0.5 * a)
        if (toned) {
          wetL = toneFilter.left(wetL)
          wetR = toneFilter.right(wetR)
        }
        left[i] = dry * left[i] + wet * wetL
        right[i] = dry * right[i] + wet * wetR
      }
      return
    }
    for (let i = 0; i < frames; i += 1) {
      preDelay.write(0.5 * (left[i] + right[i]))
      const input = preDelay.read(preDelaySamples)
      let wetL = this.tankL.tick(input, damping)
      let wetR = this.tankR.tick(input, damping)
      if (toned) {
        wetL = toneFilter.left(wetL)
        wetR = toneFilter.right(wetR)
      }
      left[i] = dry * left[i] + wet * wetL
      right[i] = dry * right[i] + wet * wetR
    }
  }
}

// ── Rotary ────────────────────────────────────────────────────────────────────

const ROTOR_SPEEDS = { hornSlow: 0.83, hornFast: 6.7, drumSlow: 0.7, drumFast: 5.9 } as const

/**
 * The one shared rotor: speed selection, acceleration, and the horn/drum angles. There is a
 * single instance per kernel, so every layer routed To Rotary turns with the same rotor.
 */
export class Rotor {
  private readonly sr: number
  hornSpeed: number = ROTOR_SPEEDS.hornSlow
  drumSpeed: number = ROTOR_SPEEDS.drumSlow
  hornPhase = 0
  drumPhase = 0.3
  private hornTarget: number = ROTOR_SPEEDS.hornSlow
  private drumTarget: number = ROTOR_SPEEDS.drumSlow
  drive = 0

  constructor(sr: number) {
    this.sr = sr
  }

  /**
   * `speed`, when given, is a morphed position between the slow (or stopped) speed at 0 and the
   * fast speed at 1; the rotors still accelerate towards whatever speed that is.
   */
  configure(fast: boolean, stop: boolean, drive: number, speed?: number): void {
    const hornLow = stop ? 0 : ROTOR_SPEEDS.hornSlow
    const drumLow = stop ? 0 : ROTOR_SPEEDS.drumSlow
    const position = speed === undefined ? (fast ? 1 : 0) : Math.min(1, Math.max(0, speed))
    this.hornTarget = position >= 1 ? ROTOR_SPEEDS.hornFast : position <= 0 ? hornLow : hornLow + (ROTOR_SPEEDS.hornFast - hornLow) * position
    this.drumTarget = position >= 1 ? ROTOR_SPEEDS.drumFast : position <= 0 ? drumLow : drumLow + (ROTOR_SPEEDS.drumFast - drumLow) * position
    this.drive = drive
  }

  /** Advance by one block. The light horn reaches speed in about a second; the heavy drum takes several. */
  advance(frames: number): void {
    const seconds = frames / this.sr
    const horn = 1 - Math.exp(-seconds / (this.hornTarget > this.hornSpeed ? 0.7 : 1.0))
    const drum = 1 - Math.exp(-seconds / (this.drumTarget > this.drumSpeed ? 3.5 : 4.5))
    this.hornSpeed += (this.hornTarget - this.hornSpeed) * horn
    this.drumSpeed += (this.drumTarget - this.drumSpeed) * drum
    if (Math.abs(this.hornSpeed) < 1e-4) this.hornSpeed = this.hornTarget === 0 ? 0 : this.hornSpeed
    if (Math.abs(this.drumSpeed) < 1e-4) this.drumSpeed = this.drumTarget === 0 ? 0 : this.drumSpeed
    this.hornPhase = (this.hornPhase + this.hornSpeed * seconds) % 1
    this.drumPhase = (this.drumPhase + this.drumSpeed * seconds) % 1
  }
}

/** One layer's signal path through the shared rotor: drive, crossover, horn and drum. */
export class RotaryPath extends Unit {
  private readonly rotor: Rotor
  private readonly low = new Biquad()
  private readonly high = new Biquad()
  private readonly horn: DelayLine
  private readonly drum: DelayLine
  private readonly drive: Glide

  constructor(sr: number, rotor: Rotor) {
    super(sr)
    this.rotor = rotor
    this.low.lowpass(sr, 800, 0.707)
    this.high.highpass(sr, 800, 0.707)
    this.horn = new DelayLine(sr * 0.01)
    this.drum = new DelayLine(sr * 0.01)
    this.drive = new Glide(0, sr)
  }

  protected reset(): void {
    this.low.reset()
    this.high.reset()
    this.horn.reset()
    this.drum.reset()
    this.drive.snap(this.rotor.drive)
  }

  protected run(left: Float32Array, right: Float32Array, frames: number): void {
    const { rotor, sr } = this
    this.drive.target = rotor.drive
    const drive = this.drive.next()
    const gain = 1 + 11 * drive
    const trim = 1 / Math.pow(gain, 0.65)
    const ms = sr / 1000
    // The rotor has already been advanced to the end of this block; walk back to its start.
    const hornStep = rotor.hornSpeed / sr
    const drumStep = rotor.drumSpeed / sr
    let hornPhase = rotor.hornPhase - hornStep * frames
    let drumPhase = rotor.drumPhase - drumStep * frames
    for (let i = 0; i < frames; i += 1) {
      let input = 0.5 * (left[i] + right[i])
      if (drive > 0.001) input = Math.tanh(input * gain) * trim
      const bass = this.low.left(input)
      const treble = this.high.left(input)
      const hornAngle = TWO_PI * hornPhase
      const drumAngle = TWO_PI * drumPhase
      const hornSin = Math.sin(hornAngle)
      const hornCos = Math.cos(hornAngle)
      const drumCos = Math.cos(drumAngle)
      this.horn.write(treble)
      this.drum.write(bass)
      // Two microphones a quarter turn apart: Doppler from the changing path, level from the horn's aim.
      const hornL = this.horn.read((1.1 + 0.42 * hornSin) * ms) * (1 + 0.5 * hornCos)
      const hornR = this.horn.read((1.1 - 0.42 * hornSin) * ms) * (1 - 0.5 * hornCos)
      const drumL = this.drum.read((1.4 + 0.12 * Math.sin(drumAngle)) * ms) * (1 + 0.32 * drumCos)
      const drumR = this.drum.read((1.4 - 0.12 * Math.sin(drumAngle)) * ms) * (1 - 0.32 * drumCos)
      left[i] = 0.9 * (hornL + drumL)
      right[i] = 0.9 * (hornR + drumR)
      hornPhase += hornStep
      drumPhase += drumStep
    }
  }
}

// ── Piano timbre ──────────────────────────────────────────────────────────────

interface TimbreCurve {
  lowDb: number
  midHz: number
  midQ: number
  midDb: number
  highHz: number
  highDb: number
}
const FLAT: TimbreCurve = { lowDb: 0, midHz: 1000, midQ: 0.8, midDb: 0, highHz: 3000, highDb: 0 }
const ACOUSTIC: Record<number, TimbreCurve> = {
  // Soft: subdued, intimate — less top, a little more low end.
  [Timbre.Soft]: { lowDb: 2.5, midHz: 1000, midQ: 0.8, midDb: 0, highHz: 2200, highDb: -9 },
  // Mid: highs and lows both pulled back, the mid-range pushed forward.
  [Timbre.Mid]: { lowDb: -4, midHz: 1300, midQ: 1, midDb: 6, highHz: 3500, highDb: -6 },
  // Bright: brilliant top.
  [Timbre.Bright]: { lowDb: 0, midHz: 1000, midQ: 0.8, midDb: 0, highHz: 2800, highDb: 8 },
}
const ELECTRIC: Record<number, TimbreCurve> = {
  [Timbre.Soft]: { lowDb: 1, midHz: 700, midQ: 0.9, midDb: 2, highHz: 1800, highDb: -10 },
  [Timbre.Mid]: { lowDb: 0, midHz: 2000, midQ: 0.9, midDb: 6, highHz: 6000, highDb: 0 },
  [Timbre.Bright]: { lowDb: 0, midHz: 2200, midQ: 0.9, midDb: 5, highHz: 4500, highDb: 7 },
  // Dyno: the 70s preamp/EQ modification — the "bell" is pushed hard; Dyno 2 also lifts the bass.
  [Timbre.Dyno1]: { lowDb: -3, midHz: 2800, midQ: 1.1, midDb: 10, highHz: 6500, highDb: 4 },
  [Timbre.Dyno2]: { lowDb: 7, midHz: 3000, midQ: 1.1, midDb: 10, highHz: 6500, highDb: 5 },
}

/** Piano Timbre: a three-band EQ on the layer's source, before the effects. */
export class TimbreEq extends Unit {
  private key = ''
  private readonly low = new Biquad()
  private readonly mid = new Biquad()
  private readonly high = new Biquad()
  private readonly scoop = new Biquad()
  private scooped = false

  /** Returns true when the setting is anything but Off. */
  configure(family: TimbreFamily, timbre: number): boolean {
    const curve = (family === 'electric' ? ELECTRIC : ACOUSTIC)[timbre] ?? FLAT
    const key = `${family}:${timbre}`
    if (key !== this.key) {
      if (this.key !== '' && this.engaged) this.refade()
      this.key = key
      this.low.lowShelf(this.sr, 200, curve.lowDb)
      this.mid.peaking(this.sr, curve.midHz, curve.midQ, curve.midDb)
      this.high.highShelf(this.sr, curve.highHz, curve.highDb)
      // Dyno 2 is "distinctly mid scooped".
      this.scooped = family === 'electric' && timbre === Timbre.Dyno2
      if (this.scooped) this.scoop.peaking(this.sr, 500, 0.8, -6)
      this.clear()
    }
    return curve !== FLAT
  }

  private clear(): void {
    this.low.reset()
    this.mid.reset()
    this.high.reset()
    this.scoop.reset()
  }

  protected reset(): void {
    this.clear()
  }

  protected run(left: Float32Array, right: Float32Array, frames: number): void {
    this.low.process(left, right, frames)
    this.mid.process(left, right, frames)
    this.high.process(left, right, frames)
    if (this.scooped) this.scoop.process(left, right, frames)
  }
}

// ── The chain ─────────────────────────────────────────────────────────────────

export class FxChain {
  readonly mod1: Mod1
  readonly mod2: Mod2
  readonly delay: Delay
  readonly amp: AmpEq
  readonly comp: Compressor
  readonly reverb: Reverb
  private sound: ChainSound | null = null

  constructor(sr: number) {
    this.mod1 = new Mod1(sr)
    this.mod2 = new Mod2(sr)
    this.delay = new Delay(sr)
    this.amp = new AmpEq(sr)
    this.comp = new Compressor(sr)
    this.reverb = new Reverb(sr)
  }

  configure(sound: ChainSound): void {
    this.sound = sound
    this.mod1.configure(sound.mod1)
    this.mod2.configure(sound.mod2)
    this.delay.configure(sound.delay)
    this.amp.configure(sound.amp)
    this.comp.configure(sound.comp)
    this.reverb.configure(sound.reverb)
  }

  /** The layer is routed into the Rotary: its Amp Sim/EQ unit is on and set to To Rotary. */
  routesToRotary(fxOn: boolean): boolean {
    return fxOn && !!this.sound && this.sound.amp.on && this.sound.amp.type === AmpType.ToRotary
  }

  /** True while any unit is on or still fading out, i.e. while the chain can produce a tail. */
  get engaged(): boolean {
    return (
      this.mod1.engaged || this.mod2.engaged || this.delay.engaged || this.amp.engaged || this.comp.engaged || this.reverb.engaged
    )
  }

  /** Put every unit straight into its on/off position (see `Unit.snap`). */
  snap(fxOn: boolean): void {
    const sound = this.sound
    if (!sound) return
    this.mod1.snap(fxOn && sound.mod1.on)
    this.mod2.snap(fxOn && sound.mod2.on)
    this.delay.snap(fxOn && sound.delay.on)
    this.amp.snap(fxOn && sound.amp.on)
    this.comp.snap(fxOn && sound.comp.on)
    this.reverb.snap(fxOn && sound.reverb.on)
  }

  /** `fxOn` false is the Layer Effects master bypass: every unit is switched out at once. */
  process(left: Float32Array, right: Float32Array, frames: number, fxOn: boolean): void {
    const sound = this.sound
    if (!sound) return
    this.mod1.process(left, right, frames, fxOn && sound.mod1.on)
    this.mod2.process(left, right, frames, fxOn && sound.mod2.on)
    this.delay.process(left, right, frames, fxOn && sound.delay.on)
    this.amp.process(left, right, frames, fxOn && sound.amp.on)
    this.comp.process(left, right, frames, fxOn && sound.comp.on)
    this.reverb.process(left, right, frames, fxOn && sound.reverb.on)
  }

  /** Drop every tail and all filter memory. */
  flush(): void {
    this.mod1.hardReset()
    this.mod2.hardReset()
    this.delay.hardReset()
    this.amp.hardReset()
    this.comp.hardReset()
    this.reverb.hardReset()
  }
}

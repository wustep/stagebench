import { divisions, type OrganPatch, type SynthPatch } from './patches'

const tau = 2 * Math.PI
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n))
const sinTable = Float32Array.from({ length: 8192 }, (_, i) =>
  Math.sin((tau * i) / 8192),
)
const sin = (p: number) => sinTable[Math.floor(p * 8192) & 8191]
const frac = (p: number) => p - Math.floor(p)
const seconds = (n: number) => 0.002 + 3 * (n / 100) ** 2
type Env = SynthPatch['ampEnv']
function contour(e: Env, t: number) {
  const attack = seconds(e.attack)
  if (t < attack) return t / attack
  return e.decay === 100 ? 1 : Math.exp((-4 * (t - attack)) / seconds(e.decay))
}
export type ToneKey = {
  id: number
  note: number
  gain: number
  velocity: number
}
const ranks = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8]
// Correct discontinuities over one sample interval to limit high-note aliasing.
function blep(p: number, step: number) {
  if (p < step) {
    const x = p / step
    return 2 * x - x * x - 1
  }
  if (p > 1 - step) {
    const x = (p - 1) / step
    return x * x + 2 * x + 1
  }
  return 0
}
const divided = (rate: number, bpm: number) =>
  bpm / 60 / divisions[Math.round(rate * 0.07)]
export function arpNotes(keys: ToneKey[], p: SynthPatch, step: number) {
  const ordered = [...keys].sort((a, b) => a.note - b.note)
  const n = ordered.length
  if (!n) return []
  const count = (p.arpMode === 2 ? 1 : p.range) * (p.arpMode === 0 ? n : 1)
  let i = step % count
  if (p.direction === 1) i = count - 1 - i
  if (p.direction === 2) {
    const cycle = 2 * Math.max(1, count - 1)
    i = Math.min(count - 1, cycle - (step % cycle), step % cycle)
  }
  if (p.direction === 3) {
    const hash = Math.imul(step + 1, 2654435761)
    i = ((hash ^ (hash >>> 16)) >>> 0) % count
  }
  const octave = Math.floor(i / (p.arpMode === 0 ? n : 1))
  return (p.arpMode === 0 ? [ordered[i % n]] : ordered).map((k) => ({
    ...k,
    note: k.note + 12 * octave,
  }))
}
class Tone {
  percussionOffset = 0
  age = 0
  released = -1
  phase = 0
  increment = 0
  ctrl = 0
  gain = 0
  gainStep = 0
  filterG = 0
  filterD = 0
  filterDen = 1
  phases = new Float64Array(21)
  low = [0, 0]
  band = [0, 0]
  seed: number
  pitch: number
  constructor(
    public key: ToneKey,
    readonly percussion: boolean,
  ) {
    this.pitch = key.note
    this.seed = 1 + key.id * 127
  }
  noise() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
    return this.seed / 2147483648 - 1
  }
  organ(p: OrganPatch, t: number, dt: number, bend: number) {
    if ((this.age - 1) % 16 === 0)
      this.increment = 440 * 2 ** ((this.key.note - 69 + bend) / 12) * dt
    const freq = this.increment / dt
    const phase = this.phase
    this.phase = frac(phase + (freq * dt) / 2) // base phase is the 16-foot rank
    const depth = (1 + (p.vibMode % 3)) * 0.0018
    const drift = p.vibrato ? (depth * sin(t * 6.25) * freq) / 6.25 : 0
    let sum = 0
    for (let i = 0; i < 9; i++) {
      if (p.model === 4 && i !== 0 && i !== 2) continue
      if (p.model === 1 && i >= 7) continue
      const bar = p.bars[i],
        rank = ranks[i]
      if (!bar || freq * rank > 0.45 / dt) continue
      let vol = bar / 8
      const x = phase * 2 * rank
      const wave = (u: number) => {
        const fundamental = sin(u)
        if (p.model === 1)
          return (
            fundamental * (0.65 + p.bars[7] / 12) +
            (0.28 + p.bars[8] / 14) * sin(3 * u) +
            (0.12 + p.bars[8] / 30) * sin(5 * u)
          )
        if (p.model === 2) return (2 * frac(u) - 1) * 0.6 + 0.4 * sin(u * 2)
        if (p.model === 3 || p.model === 5)
          return (
            fundamental +
            0.28 * sin(2 * u) +
            (p.model === 5 ? 0.34 : 0.09) * sin(4 * u)
          )
        return fundamental
      }
      if (p.model === 2) vol = bar > 4 ? 1 : 0
      const wet = wave(x + drift * rank)
      sum += vol * (p.vibrato && p.vibMode < 3 ? (wave(x) + wet) / 2 : wet)
    }
    if ((p.model === 0 || p.model === 4) && p.click && t < 0.014)
      sum += this.noise() * Math.exp(-t * 320) * 0.58
    if (p.model === 0 && p.percussion)
      sum +=
        sin(phase * (p.third ? 6 : 4)) *
        (p.soft ? 0.4 : 1) *
        Math.exp(-(t + this.percussionOffset) * (p.fast ? 16 : 4))
    return sum * 0.12 * Math.min(1, t / (p.model === 3 ? 0.055 : 0.003))
  }
  synth(
    p: SynthPatch,
    t: number,
    dt: number,
    bpm: number,
    wheel: number,
    bend: number,
    clock: number,
  ) {
    // Modulation coefficients run at 1/16 audio rate; oscillator phase and the
    // resonant filters integrate at full rate. Ramp amplitude between updates.
    if ((this.age - 1) % 16 === 0 || this.released === 0) {
      const vel = this.key.velocity / 127
      const env = (e: Env) =>
        contour(e, t) *
        (e.velocity ? vel ** (e.velocity / 2) : 1) *
        (this.released < 0
          ? 1
          : Math.exp((-6 * this.released * dt) / seconds(e.release)))
      const lfoPhase =
        clock *
        (p.lfoSync ? divided(p.lfoRate, bpm) : 0.08 * 2 ** (p.lfoRate / 12))
      const q = frac(lfoPhase)
      const lfo =
        ([
          1 - 4 * Math.abs(q - 0.5),
          1 - 2 * q,
          2 * q - 1,
          q < 0.5 ? 1 : -1,
          2 * frac(Math.sin(Math.floor(lfoPhase) * 452.7) * 931.7) - 1,
        ][p.lfoWave] *
          p.lfoAmt) /
        100
      const oscEnv = ((p.oscAmt - 50) / 50) * env(p.oscEnv)
      this.ctrl = clamp(
        p.ctrl / 100 + (p.toPitch ? 0 : oscEnv) + (p.lfoDest === 2 ? lfo : 0),
        0,
        1,
      )
      const glide = p.mode && p.glide ? p.glide * p.glide * 0.00002 : 0
      this.pitch += clamp(
        this.key.note - this.pitch,
        ((-16 * dt) / (glide || dt)) * 12,
        ((16 * dt) / (glide || dt)) * 12,
      )
      const vibrato =
        sin(clock * p.vibRate) *
        p.vibAmt *
        0.055 *
        (p.vibrato === 1 ? 1 : p.vibrato === 2 ? wheel / 100 : 0)
      this.increment =
        dt *
        440 *
        2 **
          ((this.pitch -
            69 +
            bend +
            p.coarse +
            p.fine / 100 +
            vibrato +
            (p.toPitch ? oscEnv * 24 : 0) +
            (p.lfoDest === 1 ? lfo * 3 : 0)) /
            12)
      this.gainStep = (env(p.ampEnv) - this.gain) / 16
      if (p.filter) {
        const cutoff = clamp(
          30 *
            2 **
              (p.cutoff / 10 +
                ((this.key.note - 60) * p.tracking) / 36 +
                (p.filterAmt / 25) * env(p.filterEnv) +
                (p.lfoDest === 3 ? lfo * 4 : 0)),
          20,
          0.43 / dt,
        )
        this.filterG = Math.tan(Math.PI * cutoff * dt)
        this.filterD = 1.7 - p.resonance / 65
        this.filterDen = 1 + this.filterG * (this.filterG + this.filterD)
      }
    }
    this.gain += this.gainStep
    const ctrl = this.ctrl
    const stack = p.wave >= 9 && p.wave <= 12 ? (p.wave < 11 ? 3 : 7) : 1
    const copies = p.unison ? 3 : 1
    let sum = 0
    for (let j = 0; j < copies; j++)
      for (let k = 0; k < stack; k++) {
        const index = j * stack + k,
          phase = this.phases[index]
        const detune =
          (j === 0 ? 0 : j === 1 ? -1 : 1) * p.unison * 0.002 +
          (k - (stack - 1) / 2) * ctrl * (stack === 3 ? 0.009 : 0.012)
        const inc = clamp(
          this.increment * (1 + detune) * (p.wave === 10 && k === 2 ? 2 : 1),
          0.000001,
          0.49,
        )
        this.phases[index] = frac(phase + inc)
        const x =
          p.wave === 7 || p.wave === 8 ? frac(phase * (1 + ctrl * 7)) : phase
        switch (p.wave) {
          case 0:
            sum += sin(x)
            break
          case 1:
            sum += 1 - 4 * Math.abs(x - 0.5)
            break
          case 3:
          case 4:
          case 5:
          case 8:
          case 12: {
            const duty = p.wave === 4 ? 1 / 3 : p.wave === 5 ? 0.1 : 0.5
            sum +=
              (x < duty ? 1 : -1) + blep(x, inc) - blep(frac(x - duty), inc)
            break
          }
          case 6:
            sum += this.noise()
            break
          case 13:
            sum += sin(x + ctrl * 1.6 * sin(2 * x))
            break
          default:
            sum += 2 * x - 1 - blep(x, inc)
        }
      }
    let signal = sum / (stack * copies)
    if (p.filter) {
      const g = this.filterG,
        d = this.filterD,
        den = this.filterDen
      if (p.drive) signal = Math.tanh(signal * (1 + 2 * p.drive))
      for (let i = 0; i < (p.filterType === 1 ? 2 : 1); i++) {
        const b = (this.band[i] + g * (signal - this.low[i])) / den
        const low = this.low[i] + g * b
        this.band[i] = 2 * b - this.band[i]
        this.low[i] = 2 * low - this.low[i]
        signal =
          p.filterType === 3
            ? b
            : p.filterType === 2
              ? signal - d * b - low
              : low
      }
    }
    return signal * this.gain * 0.25
  }
}
export class Generator {
  voices: Tone[] = []
  keys: ToneKey[] = []
  physical = new Set<number>()
  step = 0
  countdown = 0
  gateLevel = 0
  gate = 0
  clock = 0
  constructor(
    readonly rate: number,
    public organ?: OrganPatch,
    public synth?: SynthPatch,
  ) {}
  bpm = 120
  wheel = 0
  bend = 0
  sync = false
  private percussionStart = 0
  private voice(key: ToneKey) {
    if (this.voices.length >= 32) this.voices.shift()
    const v = new Tone(key, !this.voices.some((v) => v.released < 0))
    if (v.percussion) this.percussionStart = this.clock
    v.percussionOffset = (this.clock - this.percussionStart) / this.rate
    this.voices.push(v)
    return v
  }
  private lead() {
    const p = this.synth!
    const key =
      p.priority === 0
        ? this.keys.at(-1)
        : this.keys.reduce<ToneKey | undefined>(
            (a, k) =>
              !a || (p.priority === 1 ? k.note < a.note : k.note > a.note)
                ? k
                : a,
            undefined,
          )
    const old = this.voices.find((v) => v.released < 0)
    if (old?.key.id === key?.id) return
    if (old && key && p.mode === 2) {
      old.key = key
      return
    }
    if (old) old.released = 0
    if (key) {
      const v = this.voice(key)
      if (old && p.glide) v.pitch = old.pitch
    }
  }
  on(k: ToneKey) {
    if (this.synth?.hold && !this.physical.size) {
      this.keys = []
      for (const v of this.voices) if (v.released < 0) v.released = 0
    }
    this.physical.add(k.id)
    if (!this.keys.length) {
      this.step = 0
      this.countdown = 0
      if (this.sync) this.clock = 0
    }
    this.keys.push(k)
    if (this.synth?.arp) {
      if (this.synth.arpMode === 2) this.voice(k)
      return
    }
    if (this.synth?.mode) this.lead()
    else this.voice(k)
  }
  off(id: number, fast = false) {
    this.physical.delete(id)
    if (this.synth?.hold && !fast) return
    this.keys = this.keys.filter((k) => k.id !== id)
    if (this.synth?.arp && this.keys.length && this.synth.arpMode !== 2) return
    if (this.synth?.mode && !this.synth.arp) this.lead()
    else
      for (const v of this.voices)
        if (v.key.id === id || (this.synth?.arp && this.synth.arpMode !== 2)) {
          if (v.released < 0) v.released = 0
        }
  }
  setPatch(patch: SynthPatch) {
    const previous = this.synth
    this.synth = patch
    if (!previous) return
    if (previous.hold && !patch.hold) {
      for (const key of this.keys)
        if (!this.physical.has(key.id)) this.off(key.id)
    }
    if (
      previous.arp !== patch.arp ||
      previous.arpMode !== patch.arpMode ||
      previous.mode !== patch.mode
    ) {
      for (const v of this.voices) if (v.released < 0) v.released = 0
      this.countdown = 0
      this.step = 0
      if (!patch.arp && patch.mode) this.lead()
      else if (!patch.arp || patch.arpMode === 2)
        for (const key of this.keys) this.voice(key)
    } else if (patch.mode && !patch.arp && previous.priority !== patch.priority)
      this.lead()
  }
  clear() {
    this.gateLevel = 0
    this.physical.clear()
    this.keys = []
    this.voices = []
    this.step = 0
    this.countdown = 0
  }
  render(out: Float32Array) {
    const dt = 1 / this.rate,
      p = this.synth
    if (!this.voices.length && !this.keys.length) {
      this.clock += out.length
      return
    }
    for (let i = 0; i < out.length; i++, this.clock++) {
      if (p?.arp && this.keys.length) {
        if (this.countdown-- <= 0) {
          const hz = p.arpSync
            ? divided(p.arpRate, this.bpm)
            : (30 + p.arpRate * 5) / 60
          this.countdown += this.rate / hz
          this.gate =
            this.countdown * (p.arpMode === 2 ? 1 - p.range * 0.16 : 0.72)
          if (p.arpMode !== 2) {
            for (const v of this.voices) if (v.released < 0) v.released = 0
            for (const k of arpNotes(this.keys, p, this.step)) this.voice(k)
          }
          this.step++
        }
        this.gate--
        if (p.arpMode === 2) {
          const target = Number(this.gate > 0),
            slew = dt / (0.004 + (4 - p.range) * 0.014)
          this.gateLevel += clamp(target - this.gateLevel, -slew, slew)
        } else if (this.gate <= 0)
          for (const v of this.voices) if (v.released < 0) v.released = 0
      }
      let sum = 0
      for (let j = this.voices.length - 1; j >= 0; j--) {
        const v = this.voices[j],
          t = v.age++ * dt
        let sample = this.organ
          ? v.organ(this.organ, t, dt, this.bend)
          : v.synth(p!, t, dt, this.bpm, this.wheel, this.bend, this.clock * dt)
        if (v.released >= 0) {
          const released = v.released++ * dt,
            release = p ? seconds(p.ampEnv.release) : 0.045
          if (!p) sample *= Math.exp((-7 * released) / release)
          if (released >= release) {
            this.voices.splice(j, 1)
            continue
          }
        }
        sum += sample * v.key.gain
      }
      out[i] = p?.arp && p.arpMode === 2 ? sum * this.gateLevel : sum
    }
  }
}

import { VoiceState, midiToFrequency, type VoiceStateValue } from './kernel'
import { KbTouch, type RecipeId, type SampleLayer, type SampleSet, type SampleZone } from './params'
import { MAX_PARTIALS, buildPartials, createPartialSpec } from './recipes'

/**
 * The voices of one piano layer. A voice is either a recorded sample played back at the
 * right pitch, or a bank of synthesized partials (see recipes.ts). Both kinds share one
 * lifecycle — held, pedal-sustained, released, stolen — and one polyphony limit, and every
 * voice belongs to exactly one layer: a layer's note-off, pedal, octave shift, and
 * "all notes off" can only ever touch its own voices.
 *
 * Sympathetic string resonance is simulated here too (see `excite`).
 */

/** Most frames `render` is ever asked for at once. */
export const VOICE_BLOCK = 128
export const LAYER_MAX_VOICES = 48

const SAMPLE_LEVEL = 2.2
/** Per-set trims that put the three recorded instruments at a comparable loudness. */
const SET_TRIM: Record<string, number> = { grand: 1, upright: 1.45, electric: 2.3 }
const PARTIAL_LEVEL = 0.9
/** Loudness follows velocity^1.7, about 40 dB between the softest and hardest strike. */
const VELOCITY_EXPONENT = 1.7
/** Dyn Comp shrinks that exponent: soft strikes come up, the hardest strike stays where it was. */
const DYN_COMP_SCALE = [1, 0.72, 0.48, 0.27] as const
const TOUCH_EXPONENT: Record<number, number> = { [KbTouch.Heavy]: 1.45, [KbTouch.Medium]: 1, [KbTouch.Light]: 0.62 }
const SOFT_RELEASE_STRETCH = 2.8

interface UnisonVoice {
  cents: number
  /** -1..1, or null for the note's natural position. */
  pan: number | null
  /** Semitones away the borrowed recording sits ("transposed voices from neighbouring keys"). */
  borrow: number
}
const UNISON: ReadonlyArray<readonly UnisonVoice[]> = [
  [{ cents: 0, pan: null, borrow: 0 }],
  [
    { cents: -4, pan: -0.7, borrow: -3 },
    { cents: 4, pan: 0.7, borrow: 3 },
  ],
  [
    { cents: -9, pan: -0.9, borrow: -3 },
    { cents: 9, pan: 0.9, borrow: 3 },
  ],
  [
    { cents: 0, pan: null, borrow: 0 },
    { cents: -17, pan: -1, borrow: -3 },
    { cents: 17, pan: 1, borrow: 3 },
  ],
]

const STEAL_FADE = 0.004
const RESTRIKE_FADE = 0.03
const STOP_FADE = 0.02
const RELEASE_FLOOR = 2e-4
const SILENCE = 2e-5
const PRUNE_POWER = 1e-12

const RES_POOL = 32
const RES_PER_STRIKE = 6
const RES_LEVEL = 0.03
/** With the pedal down every string is free; these are the ones a struck note excites most. */
const PEDAL_RELATIVES = [-12, 12, -19, 19, -24, 7, -7, 24, -5, 5] as const

class Voice {
  state: VoiceStateValue = VoiceState.Free
  /** Key on the keybed that owns this voice. */
  key = 0
  /** Sounding pitch (key plus the layer's octave shift). */
  note = 0
  order = 0
  velocity = 0
  sampled = false
  data: Int16Array | null = null
  pos = 0
  inc = 0
  end = 0
  amp = 0
  lp = 0
  lpCoef = 1
  count = 0
  readonly re = new Float64Array(MAX_PARTIALS)
  readonly im = new Float64Array(MAX_PARTIALS)
  readonly kr = new Float64Array(MAX_PARTIALS)
  readonly ki = new Float64Array(MAX_PARTIALS)
  readonly omega = new Float64Array(MAX_PARTIALS)
  readonly decay = new Float64Array(MAX_PARTIALS)
  noiseAmp = 0
  noiseDecay = 0
  noiseLp = 0
  noiseCoef = 0
  rng = 1
  attack = 0
  attackCoef = 1
  release = 1
  releaseCoef = 1
  damperCoef = 1
  softCoef = 1
  gainL = 0
  gainR = 0
}

class Resonance {
  active = false
  /** The undamped string that is ringing. */
  string = 0
  re = 0
  im = 0
  kr = 0
  ki = 0
  env = 0
  attackCoef = 0
  released = false
  rel = 1
  relCoef = 1
}

export interface LayerVoiceInfo {
  key: number
  note: number
  state: VoiceStateValue
  order: number
  velocity: number
  sampled: boolean
}

export class LayerVoices {
  readonly sampleRate: number
  readonly maxVoices: number

  /** Recorded samples to play; null means "synthesize `recipe` instead". */
  set: SampleSet | null = null
  recipe: RecipeId = 'basic'
  octave = 0
  kbTouch: number = KbTouch.Medium
  dynComp = 0
  unison = 0
  softRelease = false
  stringRes = false

  private sustainEnabled = true
  private pedal = false
  private bendRatio = 1
  private order = 0
  private readonly voices: Voice[]
  private readonly resonances: Resonance[]
  private readonly spec = createPartialSpec()
  private readonly scratch = new Float64Array(VOICE_BLOCK)
  /** Strings whose key is down (by sounding pitch): they stay undamped even after their note has died away. */
  private readonly stringHeld = new Uint8Array(128)
  /** Sounding pitch each key was struck at, so a later octave shift cannot strand a held string. */
  private readonly keyString = new Int16Array(128).fill(-1)

  constructor(sampleRate: number, maxVoices = LAYER_MAX_VOICES) {
    this.sampleRate = sampleRate
    this.maxVoices = Math.max(1, maxVoices)
    this.voices = Array.from({ length: this.maxVoices + 24 }, () => new Voice())
    this.resonances = Array.from({ length: RES_POOL }, () => new Resonance())
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  noteOn(key: number, velocity: number): void {
    if (!(velocity > 0)) {
      this.noteOff(key)
      return
    }
    const touched = Math.pow(Math.min(1, velocity), TOUCH_EXPONENT[this.kbTouch] ?? 1)
    const gain = Math.pow(touched, VELOCITY_EXPONENT * (DYN_COMP_SCALE[this.dynComp] ?? 1))
    const note = Math.min(127, Math.max(0, key + 12 * this.octave))

    // Re-striking a string that is still ringing replaces the old vibration.
    for (const voice of this.voices) {
      if (voice.key === key && (voice.state === VoiceState.Held || voice.state === VoiceState.Sustained)) {
        this.fade(voice, VoiceState.Released, RESTRIKE_FADE)
      }
    }

    if (this.stringRes) this.excite(note, gain)
    this.liftDamper(key, note)

    const plan = UNISON[this.unison] ?? UNISON[0]
    const share = 1 / Math.sqrt(plan.length)
    for (const part of plan) {
      if (this.soundingCount() >= this.maxVoices) this.steal()
      const voice =
        this.voices.find((candidate) => candidate.state === VoiceState.Free) ??
        this.oldest(VoiceState.Killed) ??
        this.oldest(VoiceState.Released) ??
        this.voices[0]
      this.strike(voice, key, note, touched, gain * share, part)
    }
  }

  noteOff(key: number): void {
    for (const voice of this.voices) {
      if (voice.key !== key || voice.state !== VoiceState.Held) continue
      if (this.pedalActive) voice.state = VoiceState.Sustained
      else this.damp(voice)
    }
    this.dropDamper(key)
    this.dampResonances()
  }

  private liftDamper(key: number, note: number): void {
    this.dropDamper(key)
    if (key < 0 || key > 127) return
    this.keyString[key] = note
    this.stringHeld[note] += 1
  }

  private dropDamper(key: number): void {
    if (key < 0 || key > 127) return
    const note = this.keyString[key]
    if (note < 0) return
    this.keyString[key] = -1
    if (this.stringHeld[note] > 0) this.stringHeld[note] -= 1
  }

  /** Sustain pedal position, as delivered to every layer. */
  setPedal(down: boolean): void {
    if (this.pedal === down) return
    this.pedal = down
    this.pedalChanged()
  }

  /** SUSTPED: whether this layer listens to the pedal at all. */
  setSustainEnabled(enabled: boolean): void {
    if (this.sustainEnabled === enabled) return
    this.sustainEnabled = enabled
    this.pedalChanged()
  }

  /** Pitch-stick bend in semitones. */
  setBend(semitones: number): void {
    const ratio = Math.pow(2, semitones / 12)
    if (ratio === this.bendRatio) return
    this.bendRatio = ratio
    for (const voice of this.voices) {
      if (voice.state === VoiceState.Free || voice.sampled) continue
      for (let p = 0; p < voice.count; p += 1) {
        voice.kr[p] = Math.cos(voice.omega[p] * ratio) * voice.decay[p]
        voice.ki[p] = Math.sin(voice.omega[p] * ratio) * voice.decay[p]
      }
    }
  }

  /** Let every key go as if lifted, ignoring the pedal (layer or section switched off). */
  releaseAll(): void {
    for (const voice of this.voices) {
      if (voice.state === VoiceState.Held || voice.state === VoiceState.Sustained) this.damp(voice)
    }
    this.stringHeld.fill(0)
    this.keyString.fill(-1)
    this.dampResonances()
  }

  /** Stop everything within a few tens of milliseconds. */
  allNotesOff(): void {
    this.pedal = false
    this.stringHeld.fill(0)
    this.keyString.fill(-1)
    for (const voice of this.voices) {
      if (voice.state !== VoiceState.Free && voice.state !== VoiceState.Killed) this.fade(voice, VoiceState.Killed, STOP_FADE)
    }
    for (const resonance of this.resonances) {
      if (resonance.active) this.releaseResonance(resonance, STOP_FADE)
    }
  }

  // ── Inspection ──────────────────────────────────────────────────────────────

  get pedalActive(): boolean {
    return this.pedal && this.sustainEnabled
  }

  get voiceCount(): number {
    let count = 0
    for (const voice of this.voices) if (voice.state !== VoiceState.Free) count += 1
    return count
  }

  soundingCount(): number {
    let count = 0
    for (const voice of this.voices) {
      if (voice.state !== VoiceState.Free && voice.state !== VoiceState.Killed) count += 1
    }
    return count
  }

  get resonanceCount(): number {
    let count = 0
    for (const resonance of this.resonances) if (resonance.active) count += 1
    return count
  }

  /** True while anything in this layer can still produce signal. */
  get busy(): boolean {
    return this.voiceCount > 0 || this.resonanceCount > 0
  }

  describe(): LayerVoiceInfo[] {
    return this.voices
      .filter((voice) => voice.state !== VoiceState.Free)
      .map((voice) => ({
        key: voice.key,
        note: voice.note,
        state: voice.state,
        order: voice.order,
        velocity: voice.velocity,
        sampled: voice.sampled,
      }))
      .sort((a, b) => a.order - b.order)
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  /** Add this layer's voices into `left`/`right` (at most VOICE_BLOCK frames). */
  render(left: Float32Array, right: Float32Array, frames: number): void {
    for (const voice of this.voices) {
      if (voice.state === VoiceState.Free) continue
      if (voice.sampled) this.renderSample(voice, left, right, frames)
      else this.renderPartials(voice, left, right, frames)
    }
    for (const resonance of this.resonances) {
      if (resonance.active) this.renderResonance(resonance, left, right, frames)
    }
  }

  private renderSample(voice: Voice, left: Float32Array, right: Float32Array, frames: number): void {
    const data = voice.data
    if (!data) {
      voice.state = VoiceState.Free
      return
    }
    const inc = voice.inc * this.bendRatio
    const { end, amp, lpCoef, attackCoef, releaseCoef, gainL, gainR } = voice
    const fading = voice.state === VoiceState.Released || voice.state === VoiceState.Killed
    let pos = voice.pos
    let lp = voice.lp
    let attack = voice.attack
    let release = voice.release
    let finished = false
    for (let i = 0; i < frames; i += 1) {
      const index = pos | 0
      if (index >= end) {
        finished = true
        break
      }
      const t = pos - index
      // Four-point Hermite interpolation.
      const xm = data[index > 0 ? index - 1 : 0]
      const x0 = data[index]
      const x1 = data[index + 1]
      const x2 = data[index + 2]
      const c = (x1 - xm) * 0.5
      const v = x0 - x1
      const w = c + v
      const a = w + v + (x2 - x0) * 0.5
      let sample = ((a * t - (w + a)) * t + c) * t + x0
      lp += (sample - lp) * lpCoef
      sample = lp
      attack += (1 - attack) * attackCoef
      if (fading) release *= releaseCoef
      sample *= attack * release * amp
      left[i] += sample * gainL
      right[i] += sample * gainR
      pos += inc
    }
    voice.pos = pos
    voice.lp = lp
    voice.attack = attack
    voice.release = release
    if (finished || (fading && release < RELEASE_FLOOR)) {
      voice.state = VoiceState.Free
      voice.data = null
    }
  }

  private renderPartials(voice: Voice, left: Float32Array, right: Float32Array, frames: number): void {
    const scratch = this.scratch
    scratch.fill(0, 0, frames)
    const { re, im, kr, ki } = voice
    for (let p = 0; p < voice.count; p += 1) {
      let a = re[p]
      let b = im[p]
      const cr = kr[p]
      const ci = ki[p]
      for (let i = 0; i < frames; i += 1) {
        const t = a * cr - b * ci
        b = a * ci + b * cr
        a = t
        scratch[i] += b
      }
      re[p] = a
      im[p] = b
    }

    let attack = voice.attack
    let release = voice.release
    let noiseAmp = voice.noiseAmp
    let noiseLp = voice.noiseLp
    let rng = voice.rng
    const { attackCoef, releaseCoef, noiseDecay, noiseCoef, gainL, gainR } = voice
    const fading = voice.state === VoiceState.Released || voice.state === VoiceState.Killed
    for (let i = 0; i < frames; i += 1) {
      attack += (1 - attack) * attackCoef
      if (fading) release *= releaseCoef
      let sample = scratch[i]
      if (noiseAmp > 1e-6) {
        rng ^= rng << 13
        rng ^= rng >>> 17
        rng ^= rng << 5
        noiseLp += ((rng | 0) / 2147483648 - noiseLp) * noiseCoef
        sample += noiseLp * noiseAmp
        noiseAmp *= noiseDecay
      }
      sample *= attack * release
      left[i] += sample * gainL
      right[i] += sample * gainR
    }
    voice.attack = attack
    voice.release = release
    voice.noiseAmp = noiseAmp
    voice.noiseLp = noiseLp
    voice.rng = rng

    while (voice.count > 0) {
      const last = voice.count - 1
      if (re[last] * re[last] + im[last] * im[last] > PRUNE_POWER) break
      voice.count -= 1
    }
    let power = 0
    const probe = voice.count < 4 ? voice.count : 4
    for (let p = 0; p < probe; p += 1) power += re[p] * re[p] + im[p] * im[p]
    if ((Math.sqrt(power) + noiseAmp) * release < SILENCE) voice.state = VoiceState.Free
  }

  private renderResonance(resonance: Resonance, left: Float32Array, right: Float32Array, frames: number): void {
    let a = resonance.re
    let b = resonance.im
    let env = resonance.env
    let rel = resonance.rel
    const { kr, ki, attackCoef, relCoef, released } = resonance
    for (let i = 0; i < frames; i += 1) {
      const t = a * kr - b * ki
      b = a * ki + b * kr
      a = t
      env += (1 - env) * attackCoef
      if (released) rel *= relCoef
      const sample = b * env * rel * 0.7071
      left[i] += sample
      right[i] += sample
    }
    resonance.re = a
    resonance.im = b
    resonance.env = env
    resonance.rel = rel
    if (Math.sqrt(a * a + b * b) * rel < 1e-5) resonance.active = false
  }

  // ── Strikes ─────────────────────────────────────────────────────────────────

  private strike(voice: Voice, key: number, note: number, touched: number, gain: number, part: UnisonVoice): void {
    const sr = this.sampleRate
    this.order += 1
    voice.state = VoiceState.Held
    voice.key = key
    voice.note = note
    voice.order = this.order
    voice.velocity = touched
    voice.release = 1
    voice.releaseCoef = 1
    voice.attack = 0
    const damperTime = 0.025 + 0.1 * Math.pow(2, -(note - 28) / 24)

    const zone = this.set ? pickZone(this.set, touched, note + part.borrow) : null
    if (zone) {
      const { layer, lower } = zone
      const target = zone.zone
      voice.sampled = true
      voice.data = target.data
      voice.pos = 0
      voice.end = target.data.length - 3
      voice.inc = (target.rate / sr) * Math.pow(2, (note - target.root) / 12 + (target.tune + part.cents) / 1200)
      voice.amp = (gain * target.gain * SAMPLE_LEVEL * (SET_TRIM[this.set?.id ?? ''] ?? 1)) / 32768
      // Within one velocity layer the softer end is gently darker, so layers meet smoothly.
      const span = Math.max(0.05, layer.maxVelocity - lower)
      const position = Math.min(1, Math.max(0, (touched - lower) / span))
      const cutoff = 3500 + 12500 * position
      voice.lp = 0
      voice.lpCoef = cutoff >= 15500 ? 1 : 1 - Math.exp((-2 * Math.PI * cutoff) / sr)
      voice.attackCoef = 1 - Math.exp(-1 / (0.0005 * sr))
      voice.damperCoef = Math.exp(-1 / (damperTime * sr))
      voice.softCoef = Math.exp(-1 / (damperTime * SOFT_RELEASE_STRETCH * sr))
      voice.count = 0
      voice.noiseAmp = 0
    } else {
      const spec = this.spec
      buildPartials(this.recipe, note, touched, sr, spec)
      const detune = Math.pow(2, part.cents / 1200)
      const level = gain * PARTIAL_LEVEL * spec.level
      voice.sampled = false
      voice.data = null
      voice.count = spec.count
      for (let p = 0; p < spec.count; p += 1) {
        const omega = spec.omega[p] * detune
        const decay = Math.exp(-spec.rate[p])
        voice.omega[p] = omega
        voice.decay[p] = decay
        voice.re[p] = spec.amp[p] * level
        voice.im[p] = 0
        voice.kr[p] = Math.cos(omega * this.bendRatio) * decay
        voice.ki[p] = Math.sin(omega * this.bendRatio) * decay
      }
      voice.attackCoef = 1 - Math.exp(-1 / (spec.attackTime * sr))
      voice.damperCoef = Math.exp(-1 / (spec.damperTime * sr))
      voice.softCoef = Math.exp(-1 / (spec.damperTime * SOFT_RELEASE_STRETCH * sr))
      voice.noiseAmp = spec.noiseAmp * level
      voice.noiseDecay = Math.exp(-1 / (spec.noiseTime * sr))
      voice.noiseLp = 0
      voice.noiseCoef = 1 - Math.exp((-2 * Math.PI * spec.noiseCutoff) / sr)
      // Deterministic per strike, so identical input renders identical output.
      voice.rng = (Math.imul(note + 1, 2654435761) ^ Math.imul(this.order, 40503)) | 1
    }

    const natural = Math.max(-0.35, Math.min(0.35, ((note - 64) / 36) * 0.35))
    const angle = (((part.pan ?? natural) + 1) * Math.PI) / 4
    voice.gainL = Math.cos(angle)
    voice.gainR = Math.sin(angle)
  }

  /**
   * Sympathetic resonance. When a note is struck, every undamped string that shares a
   * partial with it starts to ring at that shared frequency: slowly, quietly, and for as
   * long as that string stays undamped (its key is held, or the pedal is down).
   */
  private excite(note: number, gain: number): void {
    const candidates: number[] = []
    if (this.pedalActive) {
      for (const offset of PEDAL_RELATIVES) candidates.push(note + offset)
    } else {
      for (let string = 21; string <= 108; string += 1) {
        if (this.stringHeld[string] > 0 && string !== note) candidates.push(string)
      }
    }
    const struck = midiToFrequency(note)
    const found: Array<{ string: number; frequency: number; weight: number }> = []
    for (const string of candidates) {
      if (string < 21 || string > 108) continue
      const free = midiToFrequency(string)
      let best = 0
      let frequency = 0
      for (let i = 1; i <= 6; i += 1) {
        for (let j = 1; j <= 6; j += 1) {
          const cents = 1200 * Math.log2((i * free) / (j * struck))
          const weight = 1 / (i * j)
          if (Math.abs(cents) < 12 && weight > best) {
            best = weight
            frequency = j * struck
          }
        }
      }
      if (best > 0 && frequency < this.sampleRate * 0.4) found.push({ string, frequency, weight: best })
    }
    found.sort((a, b) => b.weight - a.weight)
    for (const item of found.slice(0, RES_PER_STRIKE)) {
      const resonance = this.resonances.find((candidate) => !candidate.active) ?? this.quietestResonance()
      const omega = (2 * Math.PI * item.frequency) / this.sampleRate
      const t60 = item.frequency < 500 ? 3.5 : item.frequency < 1500 ? 2.2 : 1.1
      const decay = Math.exp(-6.9078 / (t60 * this.sampleRate))
      resonance.active = true
      resonance.string = item.string
      resonance.re = RES_LEVEL * gain * Math.pow(item.weight, 0.6)
      resonance.im = 0
      resonance.kr = Math.cos(omega) * decay
      resonance.ki = Math.sin(omega) * decay
      resonance.env = 0
      resonance.attackCoef = 1 - Math.exp(-1 / (0.04 * this.sampleRate))
      resonance.released = false
      resonance.rel = 1
      resonance.relCoef = 1
    }
  }

  private quietestResonance(): Resonance {
    let quietest = this.resonances[0]
    let level = Infinity
    for (const resonance of this.resonances) {
      const power = (resonance.re * resonance.re + resonance.im * resonance.im) * resonance.rel
      if (power < level) {
        level = power
        quietest = resonance
      }
    }
    return quietest
  }

  private dampResonances(): void {
    if (this.pedalActive) return
    for (const resonance of this.resonances) {
      if (!resonance.active || resonance.released) continue
      if (this.stringHeld[resonance.string] === 0) this.releaseResonance(resonance, 0.06)
    }
  }

  private releaseResonance(resonance: Resonance, seconds: number): void {
    resonance.released = true
    resonance.relCoef = Math.exp(-1 / (seconds * this.sampleRate))
  }

  private pedalChanged(): void {
    if (this.pedalActive) return
    for (const voice of this.voices) {
      if (voice.state === VoiceState.Sustained) this.damp(voice)
    }
    this.dampResonances()
  }

  /** The damper lands: the normal end of a note. */
  private damp(voice: Voice): void {
    voice.state = VoiceState.Released
    voice.releaseCoef = Math.min(voice.releaseCoef, this.softRelease ? voice.softCoef : voice.damperCoef)
  }

  private fade(voice: Voice, state: VoiceStateValue, seconds: number): void {
    voice.state = state
    voice.releaseCoef = Math.min(voice.releaseCoef, Math.exp(-1 / (seconds * this.sampleRate)))
  }

  /** Deterministic stealing: released first, then pedal-held, then held; oldest within a class. */
  private steal(): void {
    const victim =
      this.oldest(VoiceState.Released) ?? this.oldest(VoiceState.Sustained) ?? this.oldest(VoiceState.Held)
    if (victim) this.fade(victim, VoiceState.Killed, STEAL_FADE)
  }

  private oldest(state: VoiceStateValue): Voice | undefined {
    let found: Voice | undefined
    for (const voice of this.voices) {
      if (voice.state === state && (!found || voice.order < found.order)) found = voice
    }
    return found
  }
}

/** The velocity layer for a strike, and within it the recording nearest the wanted pitch. */
function pickZone(
  set: SampleSet,
  velocity: number,
  note: number,
): { layer: SampleLayer; lower: number; zone: SampleZone } | null {
  let lower = 0
  let chosen: SampleLayer | undefined
  for (const layer of set.layers) {
    chosen = layer
    if (velocity <= layer.maxVelocity) break
    lower = layer.maxVelocity
  }
  if (!chosen || chosen.zones.length === 0) return null
  let best = chosen.zones[0]
  let distance = Infinity
  for (const zone of chosen.zones) {
    if (note >= zone.lo && note <= zone.hi) return { layer: chosen, lower, zone }
    const away = Math.abs(zone.root - note)
    if (away < distance) {
      distance = away
      best = zone
    }
  }
  return { layer: chosen, lower, zone: best }
}

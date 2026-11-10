import {
  ArpDirection,
  ArpMode,
  FilterType,
  LfoDest,
  LfoWave,
  NotePriority,
  SynthWave,
  VibratoMode,
  VoiceMode,
  defaultSynthLayer,
  type EnvelopeSound,
  type SynthLayerSound,
} from './params'

/**
 * One Synth layer: a reduced, honest Nord Wave 2-style engine in Analog mode.
 *
 *   oscillator (one of five source categories, steered by Osc Ctrl)
 *     → drive → filter (LP12 / LP24 / HP / BP, tracking, resonance) → amplifier
 *
 * with an oscillator, a filter, and an amplifier envelope, one LFO, vibrato, unison,
 * poly / mono / legato voice modes with note priority and constant-rate glide, and an
 * arpeggiator / gate that runs on the audio clock, so its steps are sample-exact and
 * deterministic.
 *
 * The five source categories are different algorithms, not renamed copies:
 *   Pure   one band-limited oscillator (or white noise); Osc Ctrl does nothing.
 *   Sync   a slave oscillator hard-synced to the note; Osc Ctrl is the slave's pitch.
 *   Multi  three stacked saws; Osc Ctrl is the detune between them.
 *   Super  seven saws (or five squares) spread across the stereo field; Osc Ctrl is detune and width.
 *   FM-H   two sine operators at 1:1; Osc Ctrl is the modulation amount.
 */

export const SYNTH_MAX_VOICES = 12
/** Control-rate block: pitch, filter, and envelope targets are refreshed this often. */
const SUB = 16
const TWO_PI = Math.PI * 2
const VOICE_LEVEL = 0.2
const SILENT = 1e-4

const UNISON_PLAN: ReadonlyArray<ReadonlyArray<{ cents: number; pan: number }>> = [
  [{ cents: 0, pan: 0 }],
  [
    { cents: -6, pan: -0.3 },
    { cents: 6, pan: 0.3 },
  ],
  [
    { cents: -11, pan: -0.75 },
    { cents: 0, pan: 0 },
    { cents: 11, pan: 0.75 },
  ],
  [
    { cents: -17, pan: -1 },
    { cents: -5, pan: -0.4 },
    { cents: 5, pan: 0.4 },
    { cents: 17, pan: 1 },
  ],
]

const SUPER_SAW = [-0.11002313, -0.06288439, -0.01952356, 0, 0.01991221, 0.06216538, 0.10745242] as const
const SUPER_SQUARE = [-0.071, -0.03, 0, 0.031, 0.069] as const
const DRIVE_GAIN = [1, 1.5, 3, 7] as const
const DRIVE_TRIM = [1, 0.85, 0.62, 0.46] as const

/** Polynomial band-limited step: the correction for a discontinuity at phase 0. */
function blep(t: number, dt: number): number {
  if (t < dt) {
    const x = t / dt
    return x + x - x * x - 1
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt
    return x * x + x + x + 1
  }
  return 0
}

const STAGE_IDLE = 0
const STAGE_ATTACK = 1
const STAGE_DECAY = 2
const STAGE_RELEASE = 3

/** Attack / decay / release envelope. With `sustain` the decay stage holds at full level. */
class Envelope {
  stage = STAGE_IDLE
  value = 0

  /** Start (or restart) from wherever the envelope is, so retriggers never click. */
  trigger(): void {
    this.stage = STAGE_ATTACK
  }

  release(): void {
    if (this.stage !== STAGE_IDLE) this.stage = STAGE_RELEASE
  }

  reset(): void {
    this.stage = STAGE_IDLE
    this.value = 0
  }

  /** Advance by `n` samples and return the new value. */
  advance(n: number, shape: EnvelopeSound, sr: number, releaseOverride = 0): number {
    switch (this.stage) {
      case STAGE_ATTACK:
        this.value += n / Math.max(1, shape.attack * sr)
        if (this.value >= 1) {
          this.value = 1
          this.stage = STAGE_DECAY
        }
        break
      case STAGE_DECAY:
        if (!shape.sustain) this.value *= Math.exp((-4.6 * n) / Math.max(1, shape.decay * sr))
        break
      case STAGE_RELEASE:
        this.value *= Math.exp((-4.6 * n) / Math.max(1, (releaseOverride || shape.release) * sr))
        if (this.value < SILENT) {
          this.value = 0
          this.stage = STAGE_IDLE
        }
        break
    }
    return this.value
  }
}

class Voice {
  active = false
  /** Identity of the note this voice plays (a key press, or one arpeggiator step). */
  id = 0
  key = 0
  /** Pitch the voice is heading for, and where it is now (they differ during a glide). */
  target = 60
  pitch = 60
  velocity = 1
  gain = 1
  order = 0
  released = false
  killing = false
  /** Samples since the voice was struck, for delayed vibrato. */
  age = 0
  readonly amp = new Envelope()
  readonly filter = new Envelope()
  readonly osc = new Envelope()
  readonly phases = new Float64Array(32)
  readonly state = new Float64Array(8)
  rng = 1
}

interface PoolNote {
  id: number
  key: number
  note: number
  velocity: number
  gain: number
}

export interface SynthVoiceInfo {
  id: number
  key: number
  /** Target pitch as a MIDI note number. */
  note: number
  /** Where the pitch is right now (differs from `note` during a glide). */
  pitch: number
  released: boolean
  order: number
}

export interface ArpStep {
  /** Sample position of the step on the layer's clock. */
  time: number
  notes: number[]
}

export interface SynthShared {
  sustain: boolean
  bend: number
  hold: boolean
  wheel: number
  pedal: number
}

export class SynthVoices {
  readonly sampleRate: number
  /** Semitones added to every key (program transpose). */
  transpose = 0

  private sound: SynthLayerSound = defaultSynthLayer(false, 1)
  private shared: SynthShared = { sustain: true, bend: 0, hold: false, wheel: 0, pedal: 0 }
  private readonly voices: Voice[] = Array.from({ length: SYNTH_MAX_VOICES }, () => new Voice())
  private order = 0
  private nextId = 1

  /** Keys physically down, keys kept down by KB Hold or the pedal, and both together in press order. */
  private readonly down = new Map<number, PoolNote>()
  private readonly latched = new Map<number, PoolNote>()
  private pool: PoolNote[] = []
  /** Notes the mono/legato voice chooses from. */
  private stack: PoolNote[] = []
  private lastPitch: number | null = null
  private pedal = false

  private lfoPhase = 0
  private lfoHold = 0
  private lfoRng = 0x51f15e
  private vibPhase = 0
  private readonly lfoValues = new Float32Array(9)
  private readonly vibValues = new Float32Array(9)

  private clock = 0
  private arpToStep = 0
  private arpToOff = Infinity
  private arpCount = 0
  private arpRng = 0x9e3779b
  private arpSounding: number[] = []
  private gateTarget = 1
  private gateGain = 1
  private readonly steps: ArpStep[] = []

  private readonly scratchL = new Float32Array(SUB)
  private readonly scratchR = new Float32Array(SUB)
  private readonly mixL = new Float32Array(128)
  private readonly mixR = new Float32Array(128)

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate
  }

  // ── State ───────────────────────────────────────────────────────────────────

  configure(sound: SynthLayerSound, shared: SynthShared): void {
    const previous = this.sound
    const wasEngaged = this.arpEngaged
    const hadLatch = this.latching
    this.sound = sound
    this.shared = shared
    if (previous.on && !sound.on) this.releaseAll()
    if (hadLatch && !this.latching) this.dropLatched()
    if (previous.voice.mode !== sound.voice.mode) {
      this.releaseVoices()
      this.stack = []
      if (!this.arpEngaged) for (const note of this.pool) this.startNote(note)
    }
    if (wasEngaged !== this.arpEngaged) {
      // Handing the held notes between the arpeggiator and the keyboard.
      this.releaseVoices()
      this.stack = []
      this.arpSounding = []
      this.arpToOff = Infinity
      if (this.arpEngaged) {
        this.arpToStep = 0
        this.arpCount = 0
      } else {
        for (const note of this.pool) this.startNote(note)
      }
    }
    if (!sound.arp.run) {
      this.gateTarget = 1
    } else if (!previous.arp.run) {
      this.arpToStep = 0
      this.arpCount = 0
    }
  }

  /** The arpeggiator, not the keyboard, is striking the voices. */
  private get arpEngaged(): boolean {
    return this.sound.arp.run && this.sound.arp.mode !== ArpMode.Gate
  }

  private get latching(): boolean {
    return this.shared.hold || (this.pedal && this.shared.sustain)
  }

  // ── Keys ────────────────────────────────────────────────────────────────────

  noteOn(key: number, velocity: number, gain = 1): void {
    if (!this.sound.on || !(gain > 0)) return
    // KB Hold: a new chord played after every key was lifted replaces the held one.
    if (this.down.size === 0 && this.shared.hold && !(this.pedal && this.shared.sustain)) this.dropLatched()
    const again = this.latched.get(key) ?? this.down.get(key)
    if (again) {
      this.latched.delete(key)
      this.down.delete(key)
      this.removeNote(again)
    }
    const note: PoolNote = {
      id: this.nextId++,
      key,
      note: key + this.transpose + 12 * this.sound.octave,
      velocity: Math.min(1, Math.max(0.02, velocity)),
      gain,
    }
    this.down.set(key, note)
    this.addNote(note)
  }

  noteOff(key: number): void {
    const note = this.down.get(key)
    if (!note) return
    this.down.delete(key)
    if (this.latching) this.latched.set(key, note)
    else this.removeNote(note)
  }

  setPedal(down: boolean): void {
    if (this.pedal === down) return
    const hadLatch = this.latching
    this.pedal = down
    if (hadLatch && !this.latching) this.dropLatched()
  }

  private dropLatched(): void {
    for (const note of Array.from(this.latched.values())) this.removeNote(note)
    this.latched.clear()
  }

  private addNote(note: PoolNote): void {
    const wasEmpty = this.pool.length === 0
    this.pool.push(note)
    if (wasEmpty) {
      this.arpCount = 0
      // The gate starts shut: the first step opens it, with its envelope, like every later one.
      if (this.sound.arp.run && this.sound.arp.mode === ArpMode.Gate) {
        this.gateGain = 0
        this.gateTarget = 0
      }
      if (this.sound.arp.kbSync) {
        // KB Sync: playing from silence restarts the pattern and everything locked to the clock.
        this.arpToStep = 0
        this.lfoPhase = 0
        this.arpRng = 0x9e3779b
      }
    }
    if (!this.arpEngaged) this.startNote(note)
  }

  private removeNote(note: PoolNote): void {
    const index = this.pool.indexOf(note)
    if (index >= 0) this.pool.splice(index, 1)
    if (!this.arpEngaged) this.stopNote(note.id)
  }

  /** Let every key go as if lifted (layer or section switched off). */
  releaseAll(): void {
    this.down.clear()
    this.latched.clear()
    this.pool = []
    this.stack = []
    this.arpSounding = []
    this.arpToOff = Infinity
    this.releaseVoices()
  }

  private releaseVoices(): void {
    for (const voice of this.voices) if (voice.active && !voice.released) this.letGo(voice)
  }

  /** Panic: every voice fades within tens of milliseconds; held and latched keys are forgotten. */
  allNotesOff(): void {
    this.pedal = false
    this.down.clear()
    this.latched.clear()
    this.pool = []
    this.stack = []
    this.arpSounding = []
    this.arpToOff = Infinity
    this.arpCount = 0
    for (const voice of this.voices) {
      if (!voice.active) continue
      this.letGo(voice)
      voice.killing = true
    }
  }

  // ── Voices ──────────────────────────────────────────────────────────────────

  private startNote(note: PoolNote): void {
    if (this.sound.voice.mode === VoiceMode.Poly) {
      this.strike(this.allocate(), note, null)
      return
    }
    this.stack.push(note)
    this.follow()
  }

  private stopNote(id: number): void {
    if (this.sound.voice.mode === VoiceMode.Poly) {
      for (const voice of this.voices) if (voice.active && !voice.released && voice.id === id) this.letGo(voice)
      return
    }
    const index = this.stack.findIndex((note) => note.id === id)
    if (index < 0) return
    this.stack.splice(index, 1)
    this.follow()
  }

  /** The note the single mono/legato voice should be playing, by priority. */
  private chosen(): PoolNote | null {
    const stack = this.stack
    if (stack.length === 0) return null
    const priority = this.sound.voice.priority
    if (priority === NotePriority.Last) return stack[stack.length - 1]
    let best = stack[0]
    for (const note of stack) {
      if (priority === NotePriority.Low ? note.note < best.note : note.note > best.note) best = note
    }
    return best
  }

  /** Mono and Legato: move the one voice to whichever held note the priority picks. */
  private follow(): void {
    const voice = this.voices[0]
    const note = this.chosen()
    const sounding = voice.active && !voice.released
    if (!note) {
      if (sounding) this.letGo(voice)
      return
    }
    if (sounding) {
      if (voice.id === note.id) return
      // Played legato: the pitch glides to the new note. Mono also restarts the envelopes;
      // Legato lets them run on.
      voice.id = note.id
      voice.key = note.key
      voice.target = note.note
      if (this.sound.voice.glide <= 0.001) voice.pitch = note.note
      if (this.sound.voice.mode === VoiceMode.Mono) {
        voice.velocity = note.velocity
        voice.gain = note.gain
        voice.amp.trigger()
        voice.filter.trigger()
        voice.osc.trigger()
        voice.age = 0
      }
      this.lastPitch = note.note
      return
    }
    // A detached note. Mono still glides from the previous pitch; Legato only glides when notes overlap.
    const from = this.sound.voice.mode === VoiceMode.Mono && this.sound.voice.glide > 0.001 ? this.lastPitch : null
    for (const other of this.voices) if (other !== voice && other.active && !other.released) this.letGo(other)
    this.strike(voice, note, from)
  }

  private allocate(): Voice {
    let choice: Voice | null = null
    for (const voice of this.voices) if (!voice.active) return voice
    for (const voice of this.voices) if (voice.released && (!choice || voice.order < choice.order)) choice = voice
    if (choice) return choice
    choice = this.voices[0]
    for (const voice of this.voices) if (voice.order < choice.order) choice = voice
    return choice
  }

  private strike(voice: Voice, note: PoolNote, glideFrom: number | null): void {
    if (!voice.active) {
      // Fixed starting phases: the same note renders the same samples every time.
      for (let i = 0; i < voice.phases.length; i += 1) voice.phases[i] = (i * 0.137) % 1
      voice.state.fill(0)
      voice.amp.reset()
      voice.filter.reset()
      voice.osc.reset()
      voice.rng = 0x2545f491 ^ (note.note * 7919)
    }
    voice.active = true
    voice.released = false
    voice.killing = false
    voice.id = note.id
    voice.key = note.key
    voice.target = note.note
    voice.pitch = glideFrom ?? note.note
    voice.velocity = note.velocity
    voice.gain = note.gain
    voice.order = this.order++
    voice.age = 0
    voice.amp.trigger()
    voice.filter.trigger()
    voice.osc.trigger()
    this.lastPitch = note.note
  }

  private letGo(voice: Voice): void {
    voice.released = true
    voice.amp.release()
    voice.filter.release()
    voice.osc.release()
  }

  // ── Inspection ──────────────────────────────────────────────────────────────

  get voiceCount(): number {
    let count = 0
    for (const voice of this.voices) if (voice.active) count += 1
    return count
  }

  /** Notes the layer is holding: keys down plus keys kept by KB Hold or the pedal. */
  get heldCount(): number {
    return this.pool.length
  }

  get busy(): boolean {
    return this.voiceCount > 0 || (this.sound.arp.run && this.pool.length > 0)
  }

  describe(): SynthVoiceInfo[] {
    return this.voices
      .filter((voice) => voice.active)
      .map((voice) => ({ id: voice.id, key: voice.key, note: voice.target, pitch: voice.pitch, released: voice.released, order: voice.order }))
      .sort((a, b) => a.order - b.order)
  }

  /** Arpeggiator / gate steps taken so far (the most recent 256), with their sample times. */
  get arpSteps(): readonly ArpStep[] {
    return this.steps
  }

  /** Samples this layer has rendered. */
  get time(): number {
    return this.clock
  }

  // ── Arpeggiator / gate ──────────────────────────────────────────────────────

  private random(): number {
    let state = this.arpRng
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    this.arpRng = state
    return (state >>> 0) / 4294967296
  }

  private stepIndex(length: number): number {
    const count = this.arpCount
    switch (this.sound.arp.direction) {
      case ArpDirection.Down:
        return length - 1 - (count % length)
      case ArpDirection.UpDown: {
        const period = Math.max(1, 2 * length - 2)
        const k = count % period
        return k < length ? k : period - k
      }
      case ArpDirection.Random:
        return Math.min(length - 1, Math.floor(this.random() * length))
      default:
        return count % length
    }
  }

  private arpRelease(): void {
    for (const id of this.arpSounding) this.stopNote(id)
    this.arpSounding = []
  }

  private arpStep(): void {
    const { arp } = this.sound
    if (arp.mode === ArpMode.Gate) {
      // Gate: the held notes keep sounding and the step opens the gate.
      this.gateTarget = this.pool.length > 0 ? 1 : 0
      if (this.pool.length > 0) this.log(this.pool.map((note) => note.note))
      return
    }
    this.arpRelease()
    if (this.pool.length === 0) {
      this.arpCount = 0
      return
    }
    const base = [...this.pool].sort((a, b) => a.note - b.note || a.id - b.id)
    const range = Math.min(4, Math.max(1, Math.round(arp.range)))
    const played: PoolNote[] = []
    if (arp.mode === ArpMode.Poly) {
      // Poly: the whole chord on every step, stepping through the octaves of the range.
      const octave = this.stepIndex(range)
      for (const note of base) played.push({ ...note, id: this.nextId++, note: note.note + 12 * octave })
    } else {
      const length = base.length * range
      const index = this.stepIndex(length)
      const note = base[index % base.length]
      played.push({ ...note, id: this.nextId++, note: note.note + 12 * Math.floor(index / base.length) })
    }
    for (const note of played) {
      this.startNote(note)
      this.arpSounding.push(note.id)
    }
    this.log(played.map((note) => note.note))
    this.arpCount += 1
  }

  private log(notes: number[]): void {
    this.steps.push({ time: this.clock, notes })
    if (this.steps.length > 256) this.steps.shift()
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  /** Add this layer's output into `left`/`right` (at most 128 frames). */
  render(left: Float32Array, right: Float32Array, frames: number): void {
    const { arp } = this.sound
    let offset = 0
    while (offset < frames) {
      let n = frames - offset
      if (arp.run) {
        if (this.arpToOff <= 0) {
          this.arpToOff = Infinity
          if (arp.mode === ArpMode.Gate) this.gateTarget = 0
          else this.arpRelease()
          continue
        }
        if (this.arpToStep <= 0) {
          const length = this.sampleRate / Math.max(0.05, arp.rate)
          this.arpStep()
          this.arpToStep += length
          // A step sounds for 60 % of its length; a gate is open for half of it.
          this.arpToOff = length * (arp.mode === ArpMode.Gate ? 0.5 : 0.6)
          continue
        }
        n = Math.max(1, Math.min(n, Math.ceil(this.arpToStep), Math.ceil(this.arpToOff)))
      }
      this.renderSpan(left, right, offset, n)
      if (arp.run) {
        this.arpToStep -= n
        this.arpToOff -= n
      }
      this.clock += n
      offset += n
    }
  }

  private lfoTick(n: number): number {
    const { lfo } = this.sound
    const phase = this.lfoPhase
    let value: number
    switch (lfo.wave) {
      case LfoWave.SawDown:
        value = 1 - 2 * phase
        break
      case LfoWave.SawUp:
        value = 2 * phase - 1
        break
      case LfoWave.Square:
        value = phase < 0.5 ? 1 : -1
        break
      case LfoWave.SampleHold:
        value = this.lfoHold
        break
      default:
        value = phase < 0.25 ? 4 * phase : phase < 0.75 ? 2 - 4 * phase : 4 * phase - 4
    }
    let next = phase + (lfo.rate * n) / this.sampleRate
    if (next >= 1) {
      next -= Math.floor(next)
      // Sample & Hold takes a new value once per cycle.
      let state = this.lfoRng
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      this.lfoRng = state
      this.lfoHold = (state | 0) / 2147483648
    }
    this.lfoPhase = next
    return value
  }

  private renderSpan(left: Float32Array, right: Float32Array, offset: number, n: number): void {
    const { sound, mixL, mixR, sampleRate } = this
    const subs = Math.ceil(n / SUB)
    for (let s = 0; s < subs; s += 1) {
      const length = Math.min(SUB, n - s * SUB)
      this.lfoValues[s] = this.lfoTick(length)
      this.vibValues[s] = Math.sin(TWO_PI * this.vibPhase)
      this.vibPhase = (this.vibPhase + (sound.voice.vibRate * length) / sampleRate) % 1
    }
    mixL.fill(0, 0, n)
    mixR.fill(0, 0, n)
    let any = false
    for (const voice of this.voices) {
      if (!voice.active) continue
      any = true
      this.renderVoice(voice, n)
    }
    const gated = sound.arp.run && sound.arp.mode === ArpMode.Gate
    if (!gated) this.gateGain = 1
    if (!any) return
    if (gated) {
      // Hardness sets how quickly the gate opens and shuts: soft is a swell, hard is a chop.
      const coef = 1 - Math.exp(-1 / ((0.0008 + 0.05 * (1 - sound.arp.hardness)) * sampleRate))
      let gain = this.gateGain
      const target = this.gateTarget
      for (let i = 0; i < n; i += 1) {
        gain += (target - gain) * coef
        left[offset + i] += mixL[i] * gain
        right[offset + i] += mixR[i] * gain
      }
      this.gateGain = gain
    } else {
      for (let i = 0; i < n; i += 1) {
        left[offset + i] += mixL[i]
        right[offset + i] += mixR[i]
      }
    }
  }

  private renderVoice(voice: Voice, n: number): void {
    const { sound, shared, sampleRate: sr, scratchL, scratchR, mixL, mixR } = this
    const plan = UNISON_PLAN[sound.voice.unison] ?? UNISON_PLAN[0]
    const copyGain = 1 / Math.sqrt(plan.length)
    const sens = Math.min(3, Math.max(0, sound.ampEnv.velocity)) / 3
    const level = voice.gain * (1 - sens + sens * Math.pow(voice.velocity, 1.5)) * VOICE_LEVEL
    const glide = sound.voice.glide
    const glideRate = glide <= 0.001 ? Infinity : 1200 * Math.pow(0.002, glide)
    const kill = voice.killing ? 0.02 : 0
    const fine = sound.osc.coarse + sound.osc.fine / 100 + shared.bend

    for (let start = 0, s = 0; start < n; start += SUB, s += 1) {
      const length = Math.min(SUB, n - start)
      const oscEnv = voice.osc.advance(length, sound.oscEnv, sr, kill)
      const filterEnv = voice.filter.advance(length, sound.filterEnv, sr, kill)
      const amp0 = voice.amp.value
      const amp1 = voice.amp.advance(length, sound.ampEnv, sr, kill)
      voice.age += length

      if (voice.pitch !== voice.target) {
        const move = (glideRate * length) / sr
        const delta = voice.target - voice.pitch
        voice.pitch = Math.abs(delta) <= move ? voice.target : voice.pitch + Math.sign(delta) * move
      }
      if (voice.amp.stage === STAGE_IDLE) {
        voice.active = false
        return
      }
      if (amp0 < 1e-6 && amp1 < 1e-6) continue

      // Modulation, once per control block.
      let ctrl = sound.osc.ctrl
      let pitch = voice.pitch + fine
      const oscAmount = sound.oscEnv.amount * oscEnv * (sound.oscEnv.velocity ? voice.velocity : 1)
      if (sound.oscEnv.toPitch) pitch += oscAmount * 24
      else ctrl += oscAmount
      const lfo = this.lfoValues[s] * sound.lfo.amount
      let cutoffOctaves = 0
      if (sound.lfo.dest === LfoDest.Pitch) pitch += lfo * sound.lfo.amount * 12
      else if (sound.lfo.dest === LfoDest.Ctrl) ctrl += lfo * 0.5
      else if (sound.lfo.dest === LfoDest.Filter) cutoffOctaves += lfo * 4
      const vibrato = sound.voice.vibrato
      if (vibrato !== VibratoMode.Off) {
        const depth =
          vibrato === VibratoMode.Wheel
            ? shared.wheel
            : vibrato === VibratoMode.Pedal
              ? shared.pedal
              : vibrato === VibratoMode.Delay
                ? Math.min(1, Math.max(0, (voice.age / sr - 0.5) / 0.5))
                : 1
        pitch += this.vibValues[s] * depth * sound.voice.vibAmount
      }
      ctrl = ctrl < 0 ? 0 : ctrl > 1 ? 1 : ctrl
      const inc = Math.min(0.45, (440 * Math.pow(2, (pitch - 69) / 12)) / sr)

      scratchL.fill(0, 0, length)
      scratchR.fill(0, 0, length)
      for (let copy = 0; copy < plan.length; copy += 1) {
        const part = plan[copy]
        const angle = ((part.pan + 1) * Math.PI) / 4
        this.oscillate(
          voice,
          copy,
          inc * Math.pow(2, part.cents / 1200),
          ctrl,
          length,
          Math.cos(angle) * Math.SQRT2 * copyGain,
          Math.sin(angle) * Math.SQRT2 * copyGain,
        )
      }

      if (sound.filter.on) {
        const { filter } = sound
        cutoffOctaves += filter.track * ((voice.pitch - 60) / 12)
        cutoffOctaves += filter.envAmt * filterEnv * (sound.filterEnv.velocity ? voice.velocity : 1) * 8
        const cutoff = Math.min(sr * 0.45, Math.max(16, 20 * Math.pow(2, 10 * filter.freq + cutoffOctaves)))
        this.filterBlock(voice, length, Math.tan((Math.PI * cutoff) / sr), filter.res, filter.type, filter.drive)
      }

      const step = (amp1 - amp0) / length
      let amp = amp0
      for (let i = 0; i < length; i += 1) {
        amp += step
        mixL[start + i] += scratchL[i] * amp * level
        mixR[start + i] += scratchR[i] * amp * level
      }
    }
  }

  /** One unison copy of the oscillator, added into the scratch buffers. */
  private oscillate(voice: Voice, copy: number, inc: number, ctrl: number, length: number, gainL: number, gainR: number): void {
    const { scratchL, scratchR } = this
    const phases = voice.phases
    const wave = this.sound.osc.wave
    switch (wave) {
      case SynthWave.Sine:
      case SynthWave.Triangle:
      case SynthWave.Saw:
      case SynthWave.Square:
      case SynthWave.Pulse33:
      case SynthWave.Pulse10: {
        // Pure: one oscillator. Osc Ctrl is not read.
        const width = wave === SynthWave.Pulse33 ? 0.33 : wave === SynthWave.Pulse10 ? 0.1 : 0.5
        let phase = phases[copy]
        for (let i = 0; i < length; i += 1) {
          let value: number
          if (wave === SynthWave.Sine) value = Math.sin(TWO_PI * phase)
          else if (wave === SynthWave.Triangle) value = 1 - 4 * Math.abs(phase - 0.5)
          else if (wave === SynthWave.Saw) value = 2 * phase - 1 - blep(phase, inc)
          else {
            const other = phase + 1 - width
            value = (phase < width ? 1 : -1) + blep(phase, inc) - blep(other >= 1 ? other - 1 : other, inc) - (2 * width - 1)
          }
          scratchL[i] += value * gainL
          scratchR[i] += value * gainR
          phase += inc
          if (phase >= 1) phase -= 1
        }
        phases[copy] = phase
        return
      }
      case SynthWave.Noise: {
        let state = voice.rng
        for (let i = 0; i < length; i += 1) {
          state ^= state << 13
          state ^= state >>> 17
          state ^= state << 5
          const value = ((state | 0) / 2147483648) * 0.7
          scratchL[i] += value * gainL
          scratchR[i] += value * gainR
        }
        voice.rng = state
        return
      }
      case SynthWave.SyncSaw:
      case SynthWave.SyncSquare: {
        // Sync: the slave restarts with every cycle of the note. Osc Ctrl raises the slave's
        // pitch by up to three octaves; the note's own pitch never moves.
        const ratio = Math.pow(2, ctrl * 3)
        const slaveInc = Math.min(0.49, inc * ratio)
        const remainder = ratio - Math.floor(ratio)
        const square = wave === SynthWave.SyncSquare
        // Height of the jump when the slave is cut off and restarted.
        const cut = square ? (remainder < 0.5 ? 0 : 1) : remainder
        let phase = phases[copy]
        for (let i = 0; i < length; i += 1) {
          const along = phase * ratio
          const slave = along - Math.floor(along)
          let value: number
          if (square) {
            const half = slave + 0.5
            value = (slave < 0.5 ? 1 : -1) + blep(slave, slaveInc) - blep(half >= 1 ? half - 1 : half, slaveInc) + cut * blep(phase, inc)
          } else {
            value = 2 * slave - 1 - blep(slave, slaveInc) - cut * blep(phase, inc)
          }
          scratchL[i] += value * gainL
          scratchR[i] += value * gainR
          phase += inc
          if (phase >= 1) phase -= 1
        }
        phases[copy] = phase
        return
      }
      case SynthWave.MultiSaw:
      case SynthWave.MultiSawOct: {
        // Multi: three stacked saws. Osc Ctrl is the detune between them, up to 50 cents.
        const spread = Math.pow(2, (ctrl * 50) / 1200)
        const octave = wave === SynthWave.MultiSawOct
        const base = copy * 3
        const incs = [inc, Math.min(0.45, inc * spread * (octave ? 2 : 1)), inc / spread]
        const levels = octave ? [0.6, 0.45, 0.6] : [0.58, 0.58, 0.58]
        for (let saw = 0; saw < 3; saw += 1) {
          const sawInc = incs[saw]
          const level = levels[saw]
          let phase = phases[base + saw]
          for (let i = 0; i < length; i += 1) {
            const value = (2 * phase - 1 - blep(phase, sawInc)) * level
            scratchL[i] += value * gainL
            scratchR[i] += value * gainR
            phase += sawInc
            if (phase >= 1) phase -= 1
          }
          phases[base + saw] = phase
        }
        return
      }
      case SynthWave.SuperSaw:
      case SynthWave.SuperSquare: {
        // Super: a wide stack. Osc Ctrl spreads the pitches, raises the side oscillators,
        // and opens the stereo width.
        const square = wave === SynthWave.SuperSquare
        const offsets: readonly number[] = square ? SUPER_SQUARE : SUPER_SAW
        const spread = 0.04 + 0.96 * ctrl * ctrl
        const side = 0.25 + 0.75 * ctrl
        const width = 0.25 + 0.75 * ctrl
        const norm = 1.25 / Math.sqrt(1 + (offsets.length - 1) * side * side)
        const base = copy * 7
        const centre = (offsets.length - 1) / 2
        for (let k = 0; k < offsets.length; k += 1) {
          const oscInc = Math.min(0.45, inc * (1 + offsets[k] * spread))
          const pan = k === centre ? 0 : (k % 2 === 0 ? -1 : 1) * width * (Math.abs(k - centre) / centre)
          const angle = ((pan + 1) * Math.PI) / 4
          const level = (k === centre ? 1 : side) * norm
          const l = Math.cos(angle) * Math.SQRT2 * level * gainL
          const r = Math.sin(angle) * Math.SQRT2 * level * gainR
          let phase = phases[base + k]
          for (let i = 0; i < length; i += 1) {
            let value: number
            if (square) {
              const half = phase + 0.5
              value = (phase < 0.5 ? 1 : -1) + blep(phase, oscInc) - blep(half >= 1 ? half - 1 : half, oscInc)
            } else {
              value = 2 * phase - 1 - blep(phase, oscInc)
            }
            scratchL[i] += value * l
            scratchR[i] += value * r
            phase += oscInc
            if (phase >= 1) phase -= 1
          }
          phases[base + k] = phase
        }
        return
      }
      default: {
        // FM-H, algorithm A: one sine modulating another at 1:1. Osc Ctrl is the modulation amount.
        const index = ctrl * 9
        const base = copy * 2
        let carrier = phases[base]
        let modulator = phases[base + 1]
        for (let i = 0; i < length; i += 1) {
          const value = Math.sin(TWO_PI * carrier + index * Math.sin(TWO_PI * modulator))
          scratchL[i] += value * gainL
          scratchR[i] += value * gainR
          carrier += inc
          if (carrier >= 1) carrier -= 1
          modulator += inc
          if (modulator >= 1) modulator -= 1
        }
        phases[base] = carrier
        phases[base + 1] = modulator
      }
    }
  }

  /** Drive, then a state-variable filter (two cascaded stages for LP24), on both channels in place. */
  private filterBlock(voice: Voice, length: number, g: number, resonance: number, type: number, drive: number): void {
    const state = voice.state
    const k = 2 * (1 - 0.96 * Math.min(1, Math.max(0, resonance)))
    const d = 1 / (1 + g * (g + k))
    const k2 = Math.SQRT2
    const d2 = 1 / (1 + g * (g + k2))
    const level = Math.min(3, Math.max(0, Math.round(drive)))
    const driveGain = DRIVE_GAIN[level]
    const driveTrim = DRIVE_TRIM[level]
    const bandGain = Math.sqrt(k) * 1.2
    for (let channel = 0; channel < 2; channel += 1) {
      const buffer = channel === 0 ? this.scratchL : this.scratchR
      const at = channel * 4
      let s1 = state[at]
      let s2 = state[at + 1]
      let t1 = state[at + 2]
      let t2 = state[at + 3]
      for (let i = 0; i < length; i += 1) {
        let x = buffer[i]
        if (level > 0) x = Math.tanh(x * driveGain) * driveTrim
        const v1 = (s1 + g * (x - s2)) * d
        const v2 = s2 + g * v1
        s1 = 2 * v1 - s1
        s2 = 2 * v2 - s2
        let y: number
        if (type === FilterType.HP) y = x - k * v1 - v2
        else if (type === FilterType.BP) y = v1 * bandGain
        else if (type === FilterType.LP24) {
          const w1 = (t1 + g * (v2 - t2)) * d2
          const w2 = t2 + g * w1
          t1 = 2 * w1 - t1
          t2 = 2 * w2 - t2
          y = w2
        } else y = v2
        buffer[i] = y
      }
      state[at] = s1
      state[at + 1] = s2
      state[at + 2] = t1
      state[at + 3] = t2
    }
  }
}

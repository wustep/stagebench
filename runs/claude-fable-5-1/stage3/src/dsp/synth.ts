/**
 * SYNTH LAYER ENGINE (specs/nord-stage-4.synth.json, manual p. 27–37). One SynthLayerUnit renders one Synth layer
 * into a stereo block: an "Analog mode only" Nord Wave 2-style engine with the exact required waveform list, the
 * four required filters, three envelopes, one LFO, the voice modes and a deterministic arpeggiator / gate driven by
 * the sample clock. It runs identically inside the AudioWorklet, on the main thread and offline in tests.
 *
 * Public contract:
 *   new SynthLayerUnit(sampleRate)
 *   setParams(p: SynthLayerParams)       full parameter object (the engine always sends the whole object)
 *   handle(e: SynthEvent)                 note on/off (with zone gain), sustain, allOff, clockReset
 *   process(l, r, n) / reset()            StereoProcessor
 *   voiceCount / arpStep / lfoValue       meters
 *   heldNotes()                           keys currently held (tests)
 *   arpLog                                deterministic trace of arpeggiator / gate steps (tests)
 *
 * Design notes:
 *  - Everything advances one sample at a time; control-rate work (pitch, glide, LFO / envelope modulation of the
 *    filter and Osc Ctrl) runs on 16-sample boundaries of the absolute sample counter, so results never depend on the
 *    host block size. Events are applied by the host at block boundaries.
 *  - Oscillators: sine, triangle, polyBLEP saw / square / pulse, seeded white noise (Pure, manual p. 29: Osc Ctrl has
 *    no effect); hard sync with a two-point BLEP correction at the reset (Sync: Osc Ctrl = relative pitch of the
 *    synced oscillator); two detuned saws (Multi: Osc Ctrl = detune); seven-oscillator stacks (Super: Osc Ctrl =
 *    detune / width); a 2-operator harmonic FM pair (FM-H A: Osc Ctrl = modulation amount, manual p. 30).
 *  - Filter: trapezoidal SVF per channel — LP12, LP24 (two cascaded), HP, BP — with keyboard tracking, resonance,
 *    drive (tanh pre-saturation), filter-envelope amount and LFO (manual p. 31–32).
 *  - Envelopes: attack / decay / release, decay at maximum = sustain (manual p. 33); amp velocity Off / 1 / 2 / 3.
 *  - Voice modes: Poly (16 voices, oldest stolen), Mono, Legato, Lo / Hi priority, constant-rate glide, Unison
 *    (manual p. 34–35). Vibrato modes On / Wheel / Delay / Pedal (manual p. 37); Aftertouch is excluded (no aftertouch).
 *  - Arpeggiator / Gate: 1/8 notes at the Rate BPM or a Master Clock subdivision (manual p. 36), Arp / Poly / Gate,
 *    range in octaves, Up / Down / Up-Down / Random (seeded), KB Hold, KB Sync, clock reset — every step logged.
 */
import { clamp, faderToGain, lfoKnobToHz, type StereoProcessor } from './types'
import { Rng, Smoother, Svf, TWO_PI, midiHz } from './util'
import {
  ARP_SUBDIVISIONS,
  ENV_INDEX_MAX,
  FM_PARTIALS,
  LFO_SUBDIVISIONS,
  MAX_SYNTH_VOICES,
  arpKnobToBpm,
  defaultSynthLayerParams,
  envTimeSeconds,
  filterKnobToHz,
  glideKnobToSecondsPerOctave,
  oscCtrlCategory,
  resonanceKnobToQ,
  subdivisionFromKnob,
  subdivisionSeconds,
  vibratoAmountToCents,
  type SynthEvent,
  type SynthLayerParams,
} from './synthTypes'

export interface ArpLogEntry {
  /** Sample index (since reset) at which the step happened. */
  sample: number
  /** Note of the step; −1 for a Gate-mode step (the gate opens / closes instead of playing a note). */
  midi: number
  on: boolean
}

/* ---------- constants ---------- */

const SUB = 16
const SUB_MASK = SUB - 1
const MIN_ATTACK_S = 0.001
const MIN_RELEASE_S = 0.002
const ENV_END = 1e-4
const LN1000 = Math.log(1000)
const ARP_LOG_CAP = 4096
const ARP_GATE_FRACTION = 0.8
const VOICE_PEAK = 0.35
const MAX_COPIES = 6
const SUPER_OSCS = 7
const SUPER_OFFSETS = [-1, -2 / 3, -1 / 3, 0, 1 / 3, 2 / 3, 1]
const SUPER_SPREAD_CENTS = 60
const MULTI_DETUNE_CENTS = 40
const SYNC_RANGE_SEMITONES = 36
const FM_MAX_INDEX = 6
const LFO_PITCH_SEMITONES = 12
const LFO_CTRL_RANGE = 5
const LFO_FILTER_OCTAVES = 4
const FILTER_ENV_OCTAVES = 8
const OSC_ENV_PITCH_SEMITONES = 24
const PITCH_STICK_SEMITONES = 2
const VIBRATO_FADE_S = 0.5
const AMP_VELOCITY_EXPONENT = [0, 0.6, 1.2, 2.0]
const DRIVE_GAIN = [1, 2, 4, 8]
const DRIVE_COMP = [1, 0.7, 0.5, 0.36]

interface UnisonCopy {
  detune: number
  pan: number
}
/** Unison Off / 1 / 2 / 3: detuned copies with growing detune and stereo width (manual p. 35). */
const UNISON_TABLE: readonly (readonly UnisonCopy[])[] = [
  [{ detune: 0, pan: 0 }],
  [
    { detune: -7, pan: -0.35 },
    { detune: 7, pan: 0.35 },
  ],
  [
    { detune: -5, pan: -0.45 },
    { detune: 5, pan: 0.45 },
    { detune: -13, pan: -0.8 },
    { detune: 13, pan: 0.8 },
  ],
  [
    { detune: -4, pan: -0.35 },
    { detune: 4, pan: 0.35 },
    { detune: -10, pan: -0.65 },
    { detune: 10, pan: 0.65 },
    { detune: -18, pan: -0.95 },
    { detune: 18, pan: 0.95 },
  ],
]

/* ---------- helpers ---------- */

/** Standard two-sample polyBLEP residual for a unit discontinuity at phase 0 (t in 0..1, dt = phase increment). */
function polyBlep(t: number, dt: number): number {
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

function sawAt(t: number, dt: number): number {
  return 2 * t - 1 - polyBlep(t, dt)
}

function pulseAt(t: number, dt: number, width: number): number {
  let y = t < width ? 1 : -1
  y += polyBlep(t, dt)
  let u = t - width
  if (u < 0) u += 1
  y -= polyBlep(u, dt)
  return y
}

function triangleAt(t: number): number {
  return 4 * Math.abs(t - 0.5) - 1
}

interface EnvRates {
  incA: number
  mulD: number
  sustain: boolean
  mulR: number
}

/** Attack / decay / release envelope. Attack is linear from the current level (Mono restarts, manual p. 34); decay and
 *  release are exponential and reach −60 dB at the set time; decay at maximum holds (sustain). */
class Env {
  /** 0 idle, 1 attack, 2 decay, 3 sustain, 4 release. */
  stage = 0
  level = 0
  /** Velocity scaling of the envelope amplitude (1 when the envelope's Velocity option is off). */
  vel = 1

  trigger(vel: number, retrigger: boolean) {
    this.vel = vel
    if (retrigger || this.stage === 0 || this.stage === 4) this.stage = 1
  }

  release() {
    if (this.stage !== 0) this.stage = 4
  }

  kill() {
    this.stage = 0
    this.level = 0
  }

  tick(r: EnvRates): number {
    switch (this.stage) {
      case 1:
        this.level += r.incA
        if (this.level >= 1) {
          this.level = 1
          this.stage = r.sustain ? 3 : 2
        }
        break
      case 2:
        this.level *= r.mulD
        if (this.level < ENV_END) {
          this.level = 0
          this.stage = 0
        }
        break
      case 4:
        this.level *= r.mulR
        if (this.level < ENV_END) {
          this.level = 0
          this.stage = 0
        }
        break
      default:
        break
    }
    return this.level
  }
}

interface OscState {
  /** Master / carrier / single-oscillator phase. */
  phase: number
  /** Synced slave / second saw / FM modulator phase. */
  phase2: number
  /** Super stack phases. */
  phases: Float64Array
  /** One-sample output delay for the hard-sync BLEP correction. */
  pending: number
  /** Phase increment for this copy (per sub-block). */
  inc: number
  /** Copy gains into the left / right accumulators. */
  gl: number
  gr: number
  rng: Rng
}

interface Voice {
  slot: number
  active: boolean
  midi: number
  velocity: number
  gain: number
  keyDown: boolean
  sustained: boolean
  fromArp: boolean
  start: number
  age: number
  /** Current pitch in semitones (glide) and its target. */
  pitch: number
  target: number
  amp: Env
  filt: Env
  osc: Env
  oscs: OscState[]
  copies: number
  fL1: Svf
  fL2: Svf
  fR1: Svf
  fR2: Svf
  /** Per-sub-block derived values. */
  ctrl: number
  ampScale: number
  filterOn: boolean
  filterType: number
  driveG: number
  driveComp: number
  oscCat: number
  waveIndex: number
  fmRatio: number
}

interface KeyInfo {
  velocity: number
  gain: number
  sustained: boolean
}

export class SynthLayerUnit implements StereoProcessor {
  private params: SynthLayerParams = defaultSynthLayerParams()
  private readonly voices: Voice[] = []
  private readonly keys = new Map<number, KeyInfo>()
  private readonly arpNotes = new Map<number, KeyInfo>()
  private sustain = false
  private sampleCount = 0
  private lastPitch: number | null = null
  private readonly level: Smoother
  readonly arpLog: ArpLogEntry[] = []

  /* derived from params */
  private ampRates: EnvRates = { incA: 1, mulD: 1, sustain: false, mulR: 1 }
  private filtRates: EnvRates = { incA: 1, mulD: 1, sustain: false, mulR: 1 }
  private oscRates: EnvRates = { incA: 1, mulD: 1, sustain: false, mulR: 1 }
  private glideRate = 0
  private lfoInc = 0
  private vibInc = 0
  private vibDepthCents = 0
  private baseCutoff = 1000
  private q = 0.707
  private stepSamples = 1
  private unison: readonly UnisonCopy[] = UNISON_TABLE[0]

  /* LFO / vibrato */
  private lfoPhase = 0
  private lfoOut = 1
  private shValue = 0
  private readonly shRng = new Rng(7)
  private vibPhase = 0
  private vibOut = 0

  /* arpeggiator / gate */
  private arpCounter = 0
  private arpGateCounter = 0
  private arpIndex = 0
  private arpCurrentStep = 0
  private arpSeq: number[] = []
  private arpChords: number[][] = []
  private arpDirty = true
  private readonly arpRng = new Rng(12345)
  private gateLoggedOff = true

  constructor(readonly sampleRate: number) {
    this.level = new Smoother(sampleRate, 10, faderToGain(this.params.level))
    for (let i = 0; i < MAX_SYNTH_VOICES; i++) this.voices.push(this.makeVoice(i))
    this.derive()
  }

  private makeVoice(slot: number): Voice {
    const oscs: OscState[] = []
    for (let c = 0; c < MAX_COPIES; c++) oscs.push({ phase: 0, phase2: 0, phases: new Float64Array(SUPER_OSCS), pending: 0, inc: 0, gl: 0, gr: 0, rng: new Rng(1000 + slot * 16 + c) })
    return {
      slot,
      active: false,
      midi: 60,
      velocity: 100,
      gain: 1,
      keyDown: false,
      sustained: false,
      fromArp: false,
      start: 0,
      age: 0,
      pitch: 60,
      target: 60,
      amp: new Env(),
      filt: new Env(),
      osc: new Env(),
      oscs,
      copies: 1,
      fL1: new Svf(this.sampleRate),
      fL2: new Svf(this.sampleRate),
      fR1: new Svf(this.sampleRate),
      fR2: new Svf(this.sampleRate),
      ctrl: 0,
      ampScale: 0,
      filterOn: true,
      filterType: 0,
      driveG: 1,
      driveComp: 1,
      oscCat: 0,
      waveIndex: 0,
      fmRatio: 1,
    }
  }

  /* ---------- meters ---------- */

  get current(): SynthLayerParams {
    return this.params
  }

  get voiceCount(): number {
    let n = 0
    for (const v of this.voices) if (v.active) n++
    return n
  }

  get arpStep(): number {
    return this.arpCurrentStep
  }

  get lfoValue(): number {
    return this.lfoOut
  }

  heldNotes(): number[] {
    return [...this.keys.keys()].sort((a, b) => a - b)
  }

  /* ---------- parameters ---------- */

  private envRates(attack: number, decay: number, release: number): EnvRates {
    const sr = this.sampleRate
    const a = Math.max(MIN_ATTACK_S, envTimeSeconds(attack))
    const d = Math.max(MIN_ATTACK_S, envTimeSeconds(decay))
    const r = Math.max(MIN_RELEASE_S, envTimeSeconds(release))
    return { incA: 1 / (a * sr), mulD: Math.exp(-LN1000 / (d * sr)), sustain: Math.round(decay) >= ENV_INDEX_MAX, mulR: Math.exp(-LN1000 / (r * sr)) }
  }

  private derive() {
    const p = this.params
    const sr = this.sampleRate
    this.ampRates = this.envRates(p.ampEnv.attack, p.ampEnv.decay, p.ampEnv.release)
    this.filtRates = this.envRates(p.filterEnv.attack, p.filterEnv.decay, p.filterEnv.release)
    this.oscRates = this.envRates(p.oscEnv.attack, p.oscEnv.decay, p.oscEnv.release)
    const spo = glideKnobToSecondsPerOctave(p.voice.glide)
    this.glideRate = spo > 0 ? 12 / (spo * sr) : 0
    const lfoHz = p.lfo.sync ? 1 / subdivisionSeconds(subdivisionFromKnob(LFO_SUBDIVISIONS, p.lfo.rate), p.bpm) : lfoKnobToHz(p.lfo.rate)
    this.lfoInc = lfoHz / sr
    this.vibInc = clamp(p.vibrato.rate, 2, 8) / sr
    let vibFactor = 0
    switch (Math.round(p.vibrato.mode)) {
      case 1:
        vibFactor = clamp(p.wheel, 0, 1)
        break
      case 2:
      case 3:
        vibFactor = 1
        break
      case 5:
        vibFactor = clamp(p.pedal, 0, 1)
        break
      default:
        vibFactor = 0 // Off, and Aftertouch (no aftertouch source in a browser: behaves as Off)
    }
    this.vibDepthCents = vibratoAmountToCents(p.vibrato.amount) * vibFactor
    this.baseCutoff = filterKnobToHz(p.filter.freq)
    this.q = resonanceKnobToQ(p.filter.res)
    const stepSeconds = p.arp.sync ? subdivisionSeconds(subdivisionFromKnob(ARP_SUBDIVISIONS, p.arp.rate), p.bpm) : 60 / arpKnobToBpm(p.arp.rate) / 2
    this.stepSamples = Math.max(1, Math.round(stepSeconds * sr))
    this.unison = UNISON_TABLE[clamp(Math.round(p.unison), 0, 3)]
    this.level.set(p.on ? faderToGain(p.level) : 0)
    if (this.sampleCount === 0) this.level.snap(this.level.target)
  }

  setParams(p: SynthLayerParams) {
    const prev = this.params
    this.params = p
    this.derive()
    const arpMode = Math.round(p.arp.mode)
    const prevMode = Math.round(prev.arp.mode)
    if (prev.on && !p.on) this.releaseAll()
    if (!prev.arp.run && p.arp.run) {
      this.arpCounter = 0
      this.arpIndex = 0
      this.arpDirty = true
      if (arpMode !== 2) this.releaseVoices(false)
    } else if (prev.arp.run && !p.arp.run) {
      this.releaseVoices(true)
      this.arpIndex = 0
      if (p.on) for (const [midi, k] of this.keys) if (!this.isSounding(midi)) this.keyVoiceOn(midi, k.velocity, k.gain)
    } else if (p.arp.run && arpMode !== prevMode) {
      if (arpMode === 2) {
        this.releaseVoices(true)
        for (const [midi, k] of this.keys) if (!this.isSounding(midi)) this.keyVoiceOn(midi, k.velocity, k.gain)
      } else if (prevMode === 2) {
        this.releaseVoices(false)
        this.arpCounter = 0
        this.arpIndex = 0
      }
      this.arpDirty = true
    }
    if (prev.arp.range !== p.arp.range || prev.arp.direction !== p.arp.direction) this.arpDirty = true
  }

  /* ---------- events ---------- */

  handle(e: SynthEvent) {
    switch (e.type) {
      case 'on':
        this.noteOn(e.midi, e.velocity, e.gain)
        break
      case 'off':
        this.noteOff(e.midi)
        break
      case 'sustain':
        this.setSustain(e.on)
        break
      case 'allOff':
        this.allOff()
        break
      case 'clockReset':
        this.arpCounter = 0
        this.arpIndex = 0
        if (this.params.lfo.sync) this.lfoPhase = 0
        break
      default:
        break
    }
  }

  private get arpRunning(): boolean {
    return this.params.arp.run && Math.round(this.params.arp.mode) !== 2
  }

  private noteOn(midi: number, velocity: number, gain: number) {
    const p = this.params
    if (!p.on) return
    const vel = clamp(Math.round(velocity), 1, 127)
    const g = clamp(gain, 0, 1)
    const noKeys = this.keys.size === 0
    const info: KeyInfo = { velocity: vel, gain: g, sustained: false }
    this.keys.delete(midi)
    this.keys.set(midi, info)
    if (p.arp.kbHold && noKeys) this.arpNotes.clear()
    const wasEmpty = this.arpNotes.size === 0
    this.arpNotes.set(midi, info)
    this.arpDirty = true
    if (this.arpRunning) {
      if (wasEmpty && (p.arp.kbSync || this.arpIndex === 0 && this.arpCounter === 0)) {
        this.arpCounter = 0
        this.arpIndex = 0
      }
      return
    }
    this.keyVoiceOn(midi, vel, g)
  }

  private noteOff(midi: number) {
    const key = this.keys.get(midi)
    if (!key) return
    if (this.sustain && this.params.sustped) {
      key.sustained = true
      for (const v of this.voices) if (v.active && !v.fromArp && v.midi === midi && v.keyDown) v.sustained = true
      return
    }
    this.releaseKey(midi)
  }

  private releaseKey(midi: number) {
    this.keys.delete(midi)
    if (!this.params.arp.kbHold) {
      this.arpNotes.delete(midi)
      this.arpDirty = true
      if (this.arpNotes.size === 0 && this.arpRunning) {
        this.releaseVoices(true)
        this.arpIndex = 0
      }
    }
    if (this.arpRunning) return
    this.keyVoiceOff(midi)
  }

  private setSustain(on: boolean) {
    if (this.sustain === on) return
    this.sustain = on
    if (!on) {
      for (const [midi, k] of Array.from(this.keys)) if (k.sustained) this.releaseKey(midi)
      for (const v of this.voices) if (v.active && v.sustained && !v.keyDown) {
        v.sustained = false
        this.releaseVoice(v)
      }
    }
  }

  private allOff() {
    this.sustain = false
    this.keys.clear()
    this.arpNotes.clear()
    this.arpDirty = true
    this.arpIndex = 0
    this.releaseAll()
  }

  /* ---------- voices ---------- */

  private isSounding(midi: number): boolean {
    for (const v of this.voices) if (v.active && v.midi === midi && v.keyDown) return true
    return false
  }

  private monoMode(): number {
    return clamp(Math.round(this.params.voice.mode), 0, 2)
  }

  /** The key a Mono / Legato voice should play (Off = last note, Low / High priority; manual p. 34–35). */
  private monoNote(): number | null {
    if (this.keys.size === 0) return null
    const priority = clamp(Math.round(this.params.voice.priority), 0, 2)
    let chosen: number | null = null
    for (const midi of this.keys.keys()) {
      if (chosen === null) chosen = midi
      else if (priority === 1) chosen = Math.min(chosen, midi)
      else if (priority === 2) chosen = Math.max(chosen, midi)
      else chosen = midi
    }
    return chosen
  }

  /** A key press that plays directly (arpeggiator not running, or Gate mode). */
  private keyVoiceOn(midi: number, velocity: number, gain: number) {
    const mode = this.monoMode()
    if (mode === 0) {
      this.startVoice(midi, velocity, gain, false, true)
      return
    }
    const chosen = this.monoNote()
    if (chosen === null) return
    const v = this.voices[0]
    const overlap = this.keys.size >= 2
    if (!v.active || v.fromArp) {
      const k = this.keys.get(chosen)!
      this.startVoice(chosen, k.velocity, k.gain, false, true, mode === 1 || (mode === 2 && overlap))
      return
    }
    if (chosen === v.midi) return
    const k = this.keys.get(chosen)!
    v.midi = chosen
    v.velocity = k.velocity
    v.gain = k.gain
    v.keyDown = true
    v.sustained = false
    this.retarget(v, true)
    if (mode === 1) {
      // Mono: the envelopes restart from the level they are at (manual p. 34)
      const velScale = k.velocity / 127
      v.amp.trigger(this.ampVelocity(k.velocity), true)
      v.filt.trigger(this.params.filterEnv.velocity ? velScale : 1, true)
      v.osc.trigger(this.params.oscEnv.velocity ? velScale : 1, true)
    }
    // Legato: the envelopes are left alone while playing legato (no new attack, manual p. 34)
    this.prepareVoice(v)
  }

  private keyVoiceOff(midi: number) {
    const mode = this.monoMode()
    if (mode === 0) {
      for (const v of this.voices) if (v.active && !v.fromArp && v.midi === midi && v.keyDown) this.releaseVoice(v)
      return
    }
    const v = this.voices[0]
    if (!v.active || v.fromArp) return
    if (v.midi !== midi) return
    const next = this.monoNote()
    if (next === null) {
      this.releaseVoice(v)
      return
    }
    const k = this.keys.get(next)!
    v.midi = next
    v.velocity = k.velocity
    v.gain = k.gain
    this.retarget(v, true)
    this.prepareVoice(v)
  }

  private ampVelocity(velocity: number): number {
    const mode = clamp(Math.round(this.params.ampEnv.velocity), 0, 3)
    return mode === 0 ? 1 : Math.pow(clamp(velocity, 1, 127) / 127, AMP_VELOCITY_EXPONENT[mode])
  }

  private basePitch(midi: number): number {
    const p = this.params
    return midi + clamp(Math.round(p.octave), -1, 1) * 12 + clamp(p.pitch.coarse, -24, 24) + clamp(p.pitch.fine, -50, 50) / 100
  }

  /** Sets the voice's pitch target; glides from the previous pitch when the mode calls for it. */
  private retarget(v: Voice, glide: boolean) {
    v.target = this.basePitch(v.midi)
    if (!glide || this.glideRate <= 0 || this.monoMode() === 0) v.pitch = v.target
    this.lastPitch = v.target
  }

  private allocVoice(): Voice {
    for (const v of this.voices) if (!v.active) return v
    let victim: Voice | null = null
    for (const v of this.voices) if (v.amp.stage === 4 && (!victim || v.start < victim.start)) victim = v
    if (!victim) for (const v of this.voices) if (!victim || v.start < victim.start) victim = v
    return victim!
  }

  private startVoice(midi: number, velocity: number, gain: number, fromArp: boolean, retrigger: boolean, glide = false) {
    const mode = this.monoMode()
    let v: Voice
    if (mode !== 0) v = this.voices[0]
    else {
      v = this.voices.find((x) => x.active && x.midi === midi && x.keyDown && !x.fromArp) ?? this.allocVoice()
    }
    const fresh = !v.active
    const previousPitch = this.lastPitch
    v.active = true
    v.midi = midi
    v.velocity = velocity
    v.gain = gain
    v.keyDown = true
    v.sustained = false
    v.fromArp = fromArp
    v.start = this.sampleCount
    v.age = 0
    v.target = this.basePitch(midi)
    if (glide && previousPitch !== null && this.glideRate > 0 && mode !== 0) v.pitch = fresh ? previousPitch : v.pitch
    else v.pitch = v.target
    this.lastPitch = v.target
    const velScale = velocity / 127
    v.amp.trigger(this.ampVelocity(velocity), retrigger)
    v.filt.trigger(this.params.filterEnv.velocity ? velScale : 1, retrigger)
    v.osc.trigger(this.params.oscEnv.velocity ? velScale : 1, retrigger)
    if (fresh) {
      for (const o of v.oscs) {
        o.phase = 0
        o.phase2 = 0
        o.phases.fill(0)
        o.pending = 0
      }
      v.fL1.reset()
      v.fL2.reset()
      v.fR1.reset()
      v.fR2.reset()
    }
    this.prepareVoice(v)
  }

  private releaseVoice(v: Voice) {
    v.keyDown = false
    v.sustained = false
    v.amp.release()
    v.filt.release()
    v.osc.release()
  }

  private releaseVoices(fromArp: boolean) {
    for (const v of this.voices) if (v.active && v.fromArp === fromArp) this.releaseVoice(v)
  }

  private releaseAll() {
    for (const v of this.voices) if (v.active) this.releaseVoice(v)
  }

  private endVoice(v: Voice) {
    v.active = false
    v.keyDown = false
    v.sustained = false
    v.fromArp = false
    v.amp.kill()
    v.filt.kill()
    v.osc.kill()
  }

  /* ---------- arpeggiator ---------- */

  private buildArp() {
    this.arpDirty = false
    const p = this.params
    const notes = [...this.arpNotes.keys()].sort((a, b) => a - b)
    this.arpSeq = []
    this.arpChords = []
    if (notes.length === 0) return
    // Range 0 = the played notes; each whole octave adds a transposition of the chord; a fractional octave adds the
    // notes of the next transposition that lie within that many semitones above the lowest note (manual p. 35).
    const range = clamp(p.arp.range, 0, 4)
    const full = Math.floor(range + 1e-9)
    const extra = Math.round((range - full) * 12)
    const lowest = notes[0]
    for (let o = 0; o <= full + (extra > 0 ? 1 : 0); o++) {
      const chord: number[] = []
      for (const n of notes) {
        if (o > full && n - lowest >= extra) continue
        const t = n + 12 * o
        this.arpSeq.push(t)
        chord.push(t)
      }
      if (chord.length) this.arpChords.push(chord)
    }
  }

  private directedIndex(length: number, step: number): number {
    if (length <= 1) return 0
    switch (clamp(Math.round(this.params.arp.direction), 0, 3)) {
      case 1:
        return length - 1 - (step % length)
      case 2: {
        const period = 2 * length - 2
        const q = step % period
        return q < length ? q : period - q
      }
      case 3:
        return Math.floor(this.arpRng.next() * length)
      default:
        return step % length
    }
  }

  private log(midi: number, on: boolean) {
    if (this.arpLog.length < ARP_LOG_CAP) this.arpLog.push({ sample: this.sampleCount, midi, on })
  }

  private arpTick() {
    if (!this.arpRunning) return
    if (this.arpDirty) this.buildArp()
    if (this.arpSeq.length === 0) return
    for (const v of this.voices) if (v.active && v.fromArp && v.keyDown) {
      this.log(v.midi, false)
      this.releaseVoice(v)
    }
    const poly = Math.round(this.params.arp.mode) === 1
    const step = this.arpIndex++
    if (poly) {
      const idx = this.directedIndex(this.arpChords.length, step)
      this.arpCurrentStep = idx
      for (const midi of this.arpChords[idx]) this.triggerArpNote(midi)
    } else {
      const idx = this.directedIndex(this.arpSeq.length, step)
      this.arpCurrentStep = idx
      this.triggerArpNote(this.arpSeq[idx])
    }
    this.arpGateCounter = Math.max(1, Math.round(this.stepSamples * ARP_GATE_FRACTION))
  }

  private triggerArpNote(midi: number) {
    let base = midi
    let info = this.arpNotes.get(base)
    while (!info && base >= 0) {
      base -= 12
      info = this.arpNotes.get(base)
    }
    const velocity = info?.velocity ?? 100
    const gain = info?.gain ?? 1
    this.startVoice(midi, velocity, gain, true, true)
    this.log(midi, true)
  }

  /** Gate-mode amplitude for a position 0..1 within the step: soft raised cosine → hard rectangle (manual p. 35). */
  private gateValue(position: number): number {
    const hardness = clamp(this.params.arp.range, 0, 4) / 4
    const smooth = 0.5 + 0.5 * Math.cos(TWO_PI * position)
    const edge = Math.max(1 / this.stepSamples, (0.001 * this.sampleRate) / this.stepSamples)
    let rect: number
    if (position < 0.5) rect = position < edge ? position / edge : 1
    else rect = position < 0.5 + edge ? 1 - (position - 0.5) / edge : 0
    return smooth + (rect - smooth) * hardness
  }

  /* ---------- control-rate updates ---------- */

  private lfoShape(): number {
    const p = this.lfoPhase
    switch (clamp(Math.round(this.params.lfo.wave), 0, 4)) {
      case 1:
        return 1 - 2 * p
      case 2:
        return 2 * p - 1
      case 3:
        return p < 0.5 ? 1 : -1
      case 4:
        return this.shValue
      default:
        return p < 0.5 ? 1 - 4 * p : 4 * p - 3
    }
  }

  private prepareVoice(v: Voice) {
    const p = this.params
    const sr = this.sampleRate
    const cat = oscCtrlCategory(p.wave)
    v.oscCat = cat
    v.waveIndex = clamp(Math.round(p.wave.index), 0, 6)
    v.fmRatio = FM_PARTIALS[clamp(Math.round(p.wave.partial), 0, FM_PARTIALS.length - 1)]
    // modulation sources at this control tick
    const lfoDest = clamp(Math.round(p.lfo.destination), 0, 3)
    const lfoDepth = clamp(p.lfo.amount, 0, 10) / 10
    const lfo = this.lfoOut * lfoDepth
    const oscEnv = v.osc.level * v.osc.vel * (clamp(p.oscEnv.amount, -10, 10) / 10)
    const filtEnv = v.filt.level * v.filt.vel * (clamp(p.filter.envAmount, 0, 10) / 10)
    const vibRamp = Math.round(p.vibrato.mode) === 2 ? clamp((v.age / sr - p.vibrato.delay) / VIBRATO_FADE_S, 0, 1) : 1
    const bend = p.pstick ? clamp(p.pitchBend, -1, 1) * PITCH_STICK_SEMITONES : 0
    let semis = v.pitch + bend + (this.vibOut * this.vibDepthCents * vibRamp) / 100
    if (lfoDest === 0) semis += lfo * LFO_PITCH_SEMITONES
    if (p.oscEnv.toPitch) semis += oscEnv * OSC_ENV_PITCH_SEMITONES
    const f = midiHz(clamp(semis, -12, 140))
    let ctrl = clamp(p.oscCtrl, 0, 10)
    if (!p.oscEnv.toPitch) ctrl += oscEnv * 10
    if (lfoDest === 1) ctrl += lfo * LFO_CTRL_RANGE
    v.ctrl = clamp(ctrl, 0, 10)
    // unison copies
    const copies = this.unison
    v.copies = copies.length
    const copyGain = 1 / Math.sqrt(copies.length)
    for (let c = 0; c < copies.length; c++) {
      const o = v.oscs[c]
      o.inc = (f * Math.pow(2, copies[c].detune / 1200)) / sr
      const a = ((copies[c].pan + 1) * Math.PI) / 4
      o.gl = Math.cos(a) * copyGain
      o.gr = Math.sin(a) * copyGain
    }
    v.ampScale = VOICE_PEAK * v.gain
    // filter
    v.filterOn = !!p.filter.on
    v.filterType = clamp(Math.round(p.filter.type), 0, 3)
    const drive = clamp(Math.round(p.filter.drive), 0, 3)
    v.driveG = DRIVE_GAIN[drive]
    v.driveComp = DRIVE_COMP[drive]
    if (v.filterOn) {
      const track = [0, 1 / 3, 2 / 3, 1][clamp(Math.round(p.filter.tracking), 0, 3)]
      let octaves = (track * (v.midi - 60)) / 12 + filtEnv * FILTER_ENV_OCTAVES
      if (lfoDest === 2) octaves += lfo * LFO_FILTER_OCTAVES
      const fc = clamp(this.baseCutoff * Math.pow(2, octaves), 20, sr * 0.45)
      v.fL1.set(fc, this.q)
      v.fR1.copyFrom(v.fL1)
      if (v.filterType === 1) {
        v.fL2.copyFrom(v.fL1)
        v.fR2.copyFrom(v.fL1)
      }
    }
  }

  private controlTick(chunk: number) {
    // LFO and vibrato are advanced per sample in the audio loop; here the voices pick up the current values.
    for (const v of this.voices) {
      if (!v.active) continue
      if (v.pitch !== v.target) {
        const step = this.glideRate * chunk
        if (Math.abs(v.target - v.pitch) <= step) v.pitch = v.target
        else v.pitch += v.target > v.pitch ? step : -step
      }
      this.prepareVoice(v)
    }
  }

  /* ---------- oscillators ---------- */

  private oscSample(v: Voice, o: OscState): number {
    const inc = o.inc
    switch (v.oscCat) {
      case 0:
        return this.pureSample(v.waveIndex, o, inc)
      case 1: {
        // Hard sync: the slave restarts on every master cycle; Osc Ctrl = slave pitch up to +3 octaves (manual p. 29).
        const slaveInc = inc * Math.pow(2, (v.ctrl / 10) * (SYNC_RANGE_SEMITONES / 12))
        const square = v.waveIndex === 1
        o.phase += inc
        let ps = o.phase2 + slaveInc
        if (ps >= 1) ps -= Math.floor(ps)
        let y: number
        const out = o.pending
        if (o.phase >= 1) {
          o.phase -= 1
          const x = o.phase / inc
          const before = square ? pulseAt(ps, slaveInc, 0.5) : sawAt(ps, slaveInc)
          ps = x * slaveInc
          const after = square ? pulseAt(ps, slaveInc, 0.5) : sawAt(ps, slaveInc)
          const h = after - before
          o.pending = out + (h / 2) * x * x
          y = after + (h / 2) * -((1 - x) * (1 - x))
          o.phase2 = ps
          const delayed = o.pending
          o.pending = y
          return delayed
        }
        o.phase2 = ps
        y = square ? pulseAt(ps, slaveInc, 0.5) : sawAt(ps, slaveInc)
        o.pending = y
        return out
      }
      case 2: {
        // Multi Saw / Multi Saw 8ve: two saws, Osc Ctrl = detune between them (manual p. 30).
        const detune = (v.ctrl / 10) * MULTI_DETUNE_CENTS
        const inc2 = inc * Math.pow(2, detune / 1200) * (v.waveIndex === 1 ? 2 : 1)
        o.phase += inc
        if (o.phase >= 1) o.phase -= 1
        o.phase2 += inc2
        if (o.phase2 >= 1) o.phase2 -= 1
        return 0.5 * (sawAt(o.phase, inc) + sawAt(o.phase2, inc2))
      }
      case 3: {
        // Super Saw / Super Square: seven oscillators, Osc Ctrl = detune spread and side level (manual p. 30).
        const width = v.ctrl / 10
        const spread = width * SUPER_SPREAD_CENTS
        const square = v.waveIndex === 1
        const side = width
        let sum = 0
        for (let k = 0; k < SUPER_OSCS; k++) {
          const off = SUPER_OFFSETS[k]
          const incK = off === 0 ? inc : inc * Math.pow(2, (off * spread) / 1200)
          let ph = o.phases[k] + incK
          if (ph >= 1) ph -= 1
          o.phases[k] = ph
          const y = square ? pulseAt(ph, incK, 0.5) : sawAt(ph, incK)
          sum += off === 0 ? y : y * side
        }
        return sum / Math.sqrt(1 + 6 * side * side)
      }
      default: {
        // FM-H algorithm A: 2 operators, modulator at ratio P:1, Osc Ctrl = modulation index (manual p. 30).
        o.phase += inc
        if (o.phase >= 1) o.phase -= 1
        o.phase2 += inc * v.fmRatio
        if (o.phase2 >= 1) o.phase2 -= Math.floor(o.phase2)
        const index = (v.ctrl / 10) * FM_MAX_INDEX
        return Math.sin(TWO_PI * o.phase + index * Math.sin(TWO_PI * o.phase2))
      }
    }
  }

  private pureSample(wave: number, o: OscState, inc: number): number {
    if (wave === 6) return o.rng.next() * 2 - 1
    o.phase += inc
    if (o.phase >= 1) o.phase -= 1
    switch (wave) {
      case 0:
        return Math.sin(TWO_PI * o.phase)
      case 1:
        return triangleAt(o.phase)
      case 2:
        return sawAt(o.phase, inc)
      case 3:
        return pulseAt(o.phase, inc, 0.5)
      case 4:
        return pulseAt(o.phase, inc, 0.33)
      default:
        return pulseAt(o.phase, inc, 0.1)
    }
  }

  /* ---------- audio ---------- */

  process(l: Float32Array, r: Float32Array, n: number) {
    l.fill(0, 0, n)
    r.fill(0, 0, n)
    const p = this.params
    const gateMode = p.arp.run && Math.round(p.arp.mode) === 2
    const lfoInc = this.lfoInc
    const vibInc = this.vibInc
    let i = 0
    while (i < n) {
      const chunk = Math.min(n - i, SUB - (this.sampleCount & SUB_MASK))
      this.controlTick(chunk)
      const end = i + chunk
      for (; i < end; i++) {
        // arpeggiator / gate clock (sample accurate)
        if (p.arp.run) {
          if (this.arpCounter <= 0) {
            this.arpCounter = this.stepSamples
            if (gateMode) {
              this.log(-1, true)
              this.gateLoggedOff = false
            } else this.arpTick()
          }
          if (!gateMode && this.arpGateCounter > 0 && --this.arpGateCounter === 0) {
            for (const v of this.voices) if (v.active && v.fromArp && v.keyDown) {
              this.log(v.midi, false)
              this.releaseVoice(v)
            }
          }
        }
        // LFO / vibrato
        this.lfoPhase += lfoInc
        if (this.lfoPhase >= 1) {
          this.lfoPhase -= Math.floor(this.lfoPhase)
          this.shValue = this.shRng.next() * 2 - 1
        }
        this.lfoOut = this.lfoShape()
        this.vibPhase += vibInc
        if (this.vibPhase >= 1) this.vibPhase -= 1
        this.vibOut = Math.sin(TWO_PI * this.vibPhase)
        // voices
        let outL = 0
        let outR = 0
        for (const v of this.voices) {
          if (!v.active) continue
          const a = v.amp.tick(this.ampRates)
          v.filt.tick(this.filtRates)
          v.osc.tick(this.oscRates)
          v.age++
          if (v.amp.stage === 0) {
            // Mono / Legato keep the voice while a key is held (a legato note after a full decay stays silent, manual p. 34).
            if (!(v.keyDown && !v.fromArp && this.monoMode() !== 0)) {
              this.endVoice(v)
              continue
            }
          }
          let xl = 0
          let xr = 0
          for (let c = 0; c < v.copies; c++) {
            const o = v.oscs[c]
            const y = this.oscSample(v, o)
            xl += y * o.gl
            xr += y * o.gr
          }
          if (v.driveG !== 1) {
            xl = Math.tanh(xl * v.driveG) * v.driveComp
            xr = Math.tanh(xr * v.driveG) * v.driveComp
          }
          if (v.filterOn) {
            v.fL1.process(xl)
            v.fR1.process(xr)
            switch (v.filterType) {
              case 0:
                xl = v.fL1.low
                xr = v.fR1.low
                break
              case 1:
                v.fL2.process(v.fL1.low)
                v.fR2.process(v.fR1.low)
                xl = v.fL2.low
                xr = v.fR2.low
                break
              case 2:
                xl = v.fL1.high
                xr = v.fR1.high
                break
              default:
                xl = v.fL1.band
                xr = v.fR1.band
            }
          }
          const g = a * v.amp.vel * v.ampScale
          outL += xl * g
          outR += xr * g
        }
        let lg = this.level.next()
        if (gateMode) {
          const position = 1 - this.arpCounter / this.stepSamples
          if (position >= 0.5 && !this.gateLoggedOff) {
            this.gateLoggedOff = true
            this.log(-1, false)
          }
          lg *= this.gateValue(position)
        }
        l[i] = outL * lg
        r[i] = outR * lg
        if (p.arp.run) this.arpCounter--
        this.sampleCount++
      }
    }
  }

  reset() {
    for (const v of this.voices) {
      this.endVoice(v)
      for (const o of v.oscs) {
        o.phase = 0
        o.phase2 = 0
        o.phases.fill(0)
        o.pending = 0
        o.rng = new Rng(1000 + v.slot * 16 + v.oscs.indexOf(o))
      }
      v.fL1.reset()
      v.fL2.reset()
      v.fR1.reset()
      v.fR2.reset()
    }
    this.keys.clear()
    this.arpNotes.clear()
    this.arpSeq = []
    this.arpChords = []
    this.arpDirty = true
    this.arpLog.length = 0
    this.arpCounter = 0
    this.arpGateCounter = 0
    this.arpIndex = 0
    this.arpCurrentStep = 0
    this.gateLoggedOff = true
    this.sustain = false
    this.lastPitch = null
    this.sampleCount = 0
    this.lfoPhase = 0
    this.lfoOut = 1
    this.shValue = 0
    this.vibPhase = 0
    this.vibOut = 0
    this.level.snap(this.level.target)
  }
}

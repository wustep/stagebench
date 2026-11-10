/**
 * The sound state: everything the DSP kernel needs to know, as plain serialisable data.
 * The panel's canonical state (src/state) is reduced to this and posted to the audio host;
 * the kernel never sees a control ID, a focus, or a group flag.
 */

export type SampleSetId = 'grand' | 'upright' | 'electric'
export type RecipeId = 'basic' | 'clav-neck' | 'clav-bridge' | 'fm-piano' | 'vibraphone' | 'marimba'

export type SourceSpec = { kind: 'samples'; set: SampleSetId } | { kind: 'partials'; recipe: RecipeId }

/** Which timbre EQ table applies. */
export type TimbreFamily = 'acoustic' | 'electric'

export const Mod1Type = { APan: 0, Tremolo: 1, RingMod: 2, AWah: 3, Wah: 4, Pump: 5 } as const
export const Mod2Type = { Phaser: 0, Flanger: 1, Chorus: 2, Vibe: 3, Ensemble: 4, Spin: 5 } as const
export const AmpType = { Twin: 0, JC: 1, Small: 2, ToRotary: 3, LP24: 4, HP24: 5, EqOnly: 6 } as const
export const DelayFilter = { Off: 0, LP: 1, BP: 2, HP: 3 } as const
export const ReverbType = { Spring: 0, Booth: 1, Room: 2, Stage: 3, Hall: 4, Cathedral: 5 } as const
export const ReverbTone = { Off: 0, Bright: 1, Dark: 2 } as const
export const KbTouch = { Medium: 0, Light: 1, Heavy: 2 } as const
export const Timbre = { Off: 0, Soft: 1, Mid: 2, Bright: 3, Dyno1: 4, Dyno2: 5 } as const

export interface ModSound {
  on: boolean
  type: number
  /** 0..1 knob travel. */
  rate: number
  amount: number
}

export interface DelaySound {
  on: boolean
  /** Seconds between repeats. */
  time: number
  /** 0..1 knob travel. */
  feedback: number
  mix: number
  filter: number
  pingPong: boolean
}

export interface AmpSound {
  on: boolean
  type: number
  /** 0..1 knob travel. */
  drive: number
  /** dB, -15..15. */
  bass: number
  /** dB in EQ modes; resonance (mapped from -15..15) in the two filter modes. */
  mid: number
  /** 0..1 knob travel: 200 Hz..8 kHz as mid frequency, 60 Hz..18 kHz as filter cutoff. */
  freq: number
  treble: number
}

export interface CompSound {
  on: boolean
  amount: number
  fast: boolean
}

export interface ReverbSound {
  on: boolean
  type: number
  tone: number
  mix: number
}

export interface ChainSound {
  mod1: ModSound
  mod2: ModSound
  delay: DelaySound
  amp: AmpSound
  comp: CompSound
  reverb: ReverbSound
}

export interface LayerSound {
  /** The layer sounds: its own button is on and so is the Piano section. */
  on: boolean
  /** Fader travel, 0..1. */
  level: number
  octave: number
  source: SourceSpec
  family: TimbreFamily
  timbre: number
  kbTouch: number
  dynComp: number
  unison: number
  softRelease: boolean
  stringRes: boolean
  /** The sustain pedal reaches this layer (SUSTPED). */
  sustain: boolean
  /** Pitch-stick bend currently applied, semitones. */
  bend: number
  fx: ChainSound
}

export interface RotarySound {
  fast: boolean
  /** Stop Mode: the slow position stops the rotors instead. */
  stop: boolean
  drive: number
}

export interface SoundState {
  /** Master Level knob travel, 0..1. */
  master: number
  /** Layer Effects On: when false every effect unit and the Rotary are bypassed. */
  fxOn: boolean
  layers: [LayerSound, LayerSound]
  rotary: RotarySound
}

export const LAYER_COUNT = 2

/** Delay Tempo knob (0..1) to seconds: 20 ms .. 1.5 s, exponential. */
export const DELAY_MIN_SECONDS = 0.02
export const DELAY_MAX_SECONDS = 1.5
export function delayKnobToSeconds(knob: number): number {
  return DELAY_MIN_SECONDS * Math.pow(DELAY_MAX_SECONDS / DELAY_MIN_SECONDS, Math.min(1, Math.max(0, knob)))
}
export function delaySecondsToKnob(seconds: number): number {
  const clamped = Math.min(DELAY_MAX_SECONDS, Math.max(DELAY_MIN_SECONDS, seconds))
  return Math.log(clamped / DELAY_MIN_SECONDS) / Math.log(DELAY_MAX_SECONDS / DELAY_MIN_SECONDS)
}

/** Mid-band centre frequency for a 0..1 knob: 200 Hz .. 8 kHz, as printed on the panel. */
export function midFrequency(knob: number): number {
  return 200 * Math.pow(40, Math.min(1, Math.max(0, knob)))
}
/** Cutoff of the LP24/HP24 filters for the same knob: 60 Hz .. 18 kHz. */
export function filterFrequency(knob: number): number {
  return 60 * Math.pow(300, Math.min(1, Math.max(0, knob)))
}
/** Mod 1 / Mod 2 LFO rates in Hz for a 0..1 knob. */
export function mod1Rate(knob: number): number {
  return 0.1 * Math.pow(2, 7 * knob)
}
export function mod2Rate(knob: number): number {
  return 0.05 * Math.pow(2, 7.6 * knob)
}
/** Ring-modulator sine pitch in Hz for the Rate knob. */
export function ringFrequency(knob: number): number {
  return 30 * Math.pow(2, 7 * knob)
}
/** Master Level knob travel to linear gain: silent at zero, 0.7 at the reference position 7. */
export function masterGain(knob: number): number {
  const k = Math.min(1, Math.max(0, knob))
  return (k * k * 0.7) / 0.49
}
/** Layer fader travel to linear gain. */
export function layerGain(level: number): number {
  const k = Math.min(1, Math.max(0, level))
  return k * k
}

export function defaultChain(): ChainSound {
  return {
    mod1: { on: false, type: Mod1Type.Pump, rate: 0.32, amount: 0.65 },
    mod2: { on: false, type: Mod2Type.Chorus, rate: 0.63, amount: 0.3 },
    delay: { on: false, time: delayKnobToSeconds(0.3), feedback: 0.65, mix: 0.2, filter: DelayFilter.LP, pingPong: false },
    amp: { on: false, type: AmpType.Twin, drive: 0.32, bass: 6, mid: 8, freq: 0.52, treble: 1 },
    comp: { on: false, amount: 0.22, fast: false },
    reverb: { on: false, type: ReverbType.Cathedral, tone: ReverbTone.Off, mix: 0.65 },
  }
}

export function defaultLayer(on: boolean, level: number): LayerSound {
  return {
    on,
    level,
    octave: 0,
    source: { kind: 'samples', set: 'grand' },
    family: 'acoustic',
    timbre: Timbre.Off,
    kbTouch: KbTouch.Medium,
    dynComp: 0,
    unison: 0,
    softRelease: false,
    stringRes: true,
    sustain: true,
    bend: 0,
    fx: defaultChain(),
  }
}

/** The state the kernel starts in; src/state derives exactly this from its initial panel state. */
export function defaultSoundState(): SoundState {
  return {
    master: 0.7,
    fxOn: true,
    layers: [defaultLayer(true, 1), defaultLayer(false, 0.42)],
    rotary: { fast: false, stop: false, drive: 0.15 },
  }
}

// ── Sample data handed to the kernel ──────────────────────────────────────────

export interface SampleZone {
  lo: number
  hi: number
  root: number
  /** Cents the recording is off its root. */
  tune: number
  /** Linear gain that brings the recording to the library's reference level. */
  gain: number
  rate: number
  data: Int16Array
}

export interface SampleLayer {
  /** Highest velocity (0..1) this layer serves. */
  maxVelocity: number
  zones: SampleZone[]
}

export interface SampleSet {
  id: SampleSetId
  layers: SampleLayer[]
}

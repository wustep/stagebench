/**
 * Canonical engine settings: the normalised, audio-side view of the panel.
 *
 * The panel stores raw control values (0–10 knobs, option indexes). `src/state/settings.ts`
 * maps those to this shape, and the engine applies this shape to real audio nodes. Keeping the
 * mapping pure and separate is what lets a test prove that a panel control, an engine setting
 * and the rendered signal all agree.
 */

import type { OrganModelId, PercussionSettings, VibChorusId } from './organVoice'

export type PianoTypeId = 'grand' | 'upright' | 'electric' | 'clav' | 'digital' | 'misc'
export type TimbreId = 'off' | 'soft' | 'mid' | 'bright' | 'dyno1' | 'dyno2'
export type KbTouchId = 'normal' | 'heavy' | 'medium' | 'light'
export type LayerId = 'a' | 'b'
export type OrganLayerId = 'a' | 'b'
export type SynthLayerId = 'a' | 'b' | 'c'

/**
 * One key per playable layer across the whole instrument. Zones, scenes and morph indicators are
 * all keyed by this, so "which layer" means the same thing everywhere.
 */
export type LayerKey =
  | 'organ.a'
  | 'organ.b'
  | 'piano.a'
  | 'piano.b'
  | 'synth.a'
  | 'synth.b'
  | 'synth.c'

export const LAYER_KEYS: readonly LayerKey[] = [
  'organ.a',
  'organ.b',
  'piano.a',
  'piano.b',
  'synth.a',
  'synth.b',
  'synth.c',
]

export const ORGAN_LAYER_IDS: readonly OrganLayerId[] = ['a', 'b']
export const SYNTH_LAYER_IDS: readonly SynthLayerId[] = ['a', 'b', 'c']

export type Mod1Type = 'apan' | 'tremolo' | 'ringmod' | 'awah' | 'wah' | 'pump'
export type Mod2Type = 'chorus' | 'flanger' | 'phaser' | 'vibe' | 'ensemble' | 'spin'
export type AmpType = 'twin' | 'jc' | 'small' | 'rotary' | 'lp24' | 'hp24'
export type DelayFilterId = 'lp' | 'bp' | 'hp'
export type ReverbType = 'room' | 'booth' | 'spring' | 'stage' | 'hall' | 'cathedral'
export type ReverbToneId = 'normal' | 'bright' | 'dark'
export type RotarySpeedId = 'slow' | 'fast' | 'morph'

export interface Mod1Settings {
  readonly on: boolean
  readonly type: Mod1Type
  /** 0–1. Rate for the LFO types, sensitivity for A-Wah. */
  readonly rate: number
  readonly amount: number
}

export interface Mod2Settings {
  readonly on: boolean
  readonly type: Mod2Type
  readonly rate: number
  readonly amount: number
}

export interface DelaySettings {
  readonly on: boolean
  /** 0–1 knob position; the engine maps it to seconds. */
  readonly tempo: number
  readonly feedback: number
  readonly mix: number
  readonly filter: DelayFilterId
}

export interface AmpSettings {
  readonly on: boolean
  readonly type: AmpType
  readonly drive: number
  /** EQ gains in dB, as printed on the panel. */
  readonly bass: number
  readonly mid: number
  readonly treble: number
  /** Mid frequency in Hz (also the cutoff for the LP24/HP24 filter types). */
  readonly midFrequency: number
}

export interface CompressorSettings {
  readonly on: boolean
  readonly amount: number
}

export interface ReverbSettings {
  readonly on: boolean
  readonly type: ReverbType
  readonly mix: number
  readonly tone: ReverbToneId
}

export interface ChainSettings {
  readonly mod1: Mod1Settings
  readonly mod2: Mod2Settings
  readonly delay: DelaySettings
  readonly amp: AmpSettings
  readonly compressor: CompressorSettings
  readonly reverb: ReverbSettings
}

export interface LayerSettings {
  readonly enabled: boolean
  /** 0–1 fader position. */
  readonly level: number
  /** Octave shift in semitones. */
  readonly octave: number
  readonly sustainPedal: boolean
  readonly pitchStick: boolean
  readonly type: PianoTypeId
  readonly model: number
  readonly timbre: TimbreId
  readonly unison: 0 | 1 | 2 | 3
  readonly kbTouch: KbTouchId
  readonly dynComp: 0 | 1 | 2 | 3
  readonly softRelease: boolean
  readonly stringRes: boolean
  readonly chain: ChainSettings
}

export interface RotarySettings {
  readonly speed: RotarySpeedId
  readonly drive: number
  /**
   * Morph position, 0 (slow) to 1 (fast), used when `speed` is `morph`. Driven by a morph source
   * so the rotor speed can be swept by hand (organ spec, `rotary.morphableSpeed`).
   */
  readonly morph: number
  /** Slow becomes a full stop, with the rotors decelerating (`perf.rotary.stop-mode`). */
  readonly stopMode: boolean
  /** Park the horn off-axis while stopped, which changes the static tone and image. */
  readonly stopAngle: boolean
  /** Close mic perspective: more amplitude modulation and more horn top end. */
  readonly closeMic: boolean
}

/* -------------------------------------------------------------------- organ */

export interface OrganLayerSettings {
  readonly enabled: boolean
  readonly level: number
  readonly octave: number
  readonly sustainPedal: boolean
  readonly model: OrganModelId
  /** Nine drawbar positions, 0–8, in printed panel order. */
  readonly drawbars: readonly number[]
  readonly percussion: PercussionSettings
  /** B3 vibrato/chorus per-layer on/off. Other models take the section setting. */
  readonly vibratoOn: boolean
}

export interface OrganSettings {
  readonly sectionOn: boolean
  readonly vibChorus: VibChorusId
  readonly layers: Readonly<Record<OrganLayerId, OrganLayerSettings>>
  /** Organ layers A and B share one effect chain (organ spec, `layersShareOneEffectChain`). */
  readonly chain: ChainSettings
  /** ORGAN in the Rotary group: route the organ through the shared rotary speaker. */
  readonly toRotary: boolean
}

/* -------------------------------------------------------------------- synth */

export type SynthMode = 'samples' | 'analog' | 'extern'
export type OscCategory = 'pure' | 'sync' | 'multi' | 'super' | 'fmh'
export type SynthFilterType = 'lp12' | 'lp24' | 'lphp' | 'bp' | 'hp' | 'lpm'
export type LfoWaveform = 'triangle' | 'sawdown' | 'sawup' | 'square' | 'sh'
export type LfoDestination = 'off' | 'pitch' | 'ctrl' | 'filter'
export type VoiceMode = 'poly' | 'mono' | 'legato'
export type NotePriority = 'off' | 'low' | 'high'
export type VibratoMode = 'off' | 'wheel' | 'on' | 'aftertouch' | 'pedal'
export type ArpMode = 'poly' | 'arp' | 'gate'
export type ArpDirection = 'up' | 'down' | 'updown' | 'random'

export interface SynthEnvelope {
  readonly attack: number
  readonly decay: number
  readonly release: number
}

export interface SynthLayerSettings {
  readonly enabled: boolean
  readonly level: number
  readonly octave: number
  readonly sustainPedal: boolean
  readonly mode: SynthMode
  readonly category: OscCategory
  /** Index into the category's waveform list. */
  readonly waveform: number
  /** 0–1 Osc Ctrl position; its meaning is category dependent. */
  readonly oscCtrl: number
  readonly oscEnv: SynthEnvelope & {
    /** Bipolar Env Amt, −1…1. */
    readonly amount: number
    readonly velocity: boolean
    /** Env To Pitch: retarget the oscillator envelope from Osc Ctrl to pitch. */
    readonly toPitch: boolean
  }
  readonly filter: {
    readonly on: boolean
    readonly type: SynthFilterType
    readonly freq: number
    readonly res: number
    readonly envAmount: number
    /** Keyboard tracking, 0 / 1⁄3 / 2⁄3 / 1. */
    readonly tracking: number
    /** Drive level 0–3. */
    readonly drive: number
    readonly env: SynthEnvelope & { readonly velocity: boolean }
  }
  readonly amp: SynthEnvelope & { readonly velocity: 0 | 1 | 2 | 3 }
  readonly lfo: {
    readonly waveform: LfoWaveform
    readonly rate: number
    readonly amount: number
    readonly destination: LfoDestination
    readonly clockSync: boolean
  }
  readonly voice: {
    readonly mode: VoiceMode
    readonly priority: NotePriority
    readonly glide: number
    readonly unison: 0 | 1 | 2 | 3
    readonly vibrato: { readonly mode: VibratoMode; readonly rate: number; readonly amount: number }
  }
  readonly arp: {
    readonly mode: ArpMode
    readonly rate: number
    readonly range: number
    readonly direction: ArpDirection
    readonly hold: boolean
    readonly run: boolean
    readonly clockSync: boolean
  }
  readonly chain: ChainSettings
}

export interface SynthSettings {
  readonly sectionOn: boolean
  readonly layers: Readonly<Record<SynthLayerId, SynthLayerSettings>>
}

/* -------------------------------------------------------------------- performance */

export interface ClockSettings {
  readonly bpm: number
  readonly keyboardSync: boolean
}

/** The keyboard range a layer answers to, in MIDI note numbers, with a crossfade half-width. */
export interface ZoneSettings {
  readonly low: number
  readonly high: number
  /** Crossfade half-width in semitones at the low and high edge; 0 is a hard split. */
  readonly fadeLow: number
  readonly fadeHigh: number
}

export interface EngineSettings {
  readonly masterLevel: number
  readonly sectionOn: boolean
  /** Layer Effects ON: false bypasses every effect at once. */
  readonly effectsOn: boolean
  readonly layers: Readonly<Record<LayerId, LayerSettings>>
  readonly rotary: RotarySettings
  readonly organ: OrganSettings
  readonly synth: SynthSettings
  readonly clock: ClockSettings
  /** Master transpose in semitones, −6…+6. */
  readonly transpose: number
  /** Keyboard zone per layer; every layer has one whether or not the split is on. */
  readonly zones: Readonly<Record<LayerKey, ZoneSettings>>
  /** Pitch stick position in semitones, ±2. Bends the Synth section only. */
  readonly pitchBend: number
}

const DEFAULT_CHAIN: ChainSettings = {
  mod1: { on: false, type: 'apan', rate: 0.36, amount: 0.65 },
  mod2: { on: false, type: 'chorus', rate: 0.56, amount: 0.52 },
  delay: { on: false, tempo: 0.35, feedback: 0.7, mix: 0.22, filter: 'lp' },
  amp: { on: false, type: 'twin', drive: 0.24, bass: 2, mid: 3, treble: 2, midFrequency: 1000 },
  compressor: { on: false, amount: 0.22 },
  reverb: { on: false, type: 'spring', mix: 0.64, tone: 'normal' },
}

const DEFAULT_LAYER_A: LayerSettings = {
  enabled: true,
  level: 0.8,
  octave: 0,
  sustainPedal: true,
  pitchStick: false,
  type: 'grand',
  model: 0,
  timbre: 'off',
  unison: 0,
  kbTouch: 'medium',
  dynComp: 0,
  softRelease: false,
  stringRes: true,
  chain: DEFAULT_CHAIN,
}

/**
 * Engine defaults. These mirror the panel's printed initial values (`src/model/controls.ts`);
 * `settings.test.ts` asserts the two stay identical, so the engine can never drift into
 * claiming a state the panel does not show.
 */
const DEFAULT_ORGAN_LAYER: OrganLayerSettings = {
  enabled: true,
  level: 0.75,
  octave: 0,
  sustainPedal: false,
  model: 'b3',
  drawbars: [8, 8, 8, 6, 4, 5, 3, 0, 7],
  percussion: { on: false, soft: false, fast: true, third: true },
  vibratoOn: false,
}

const DEFAULT_SYNTH_LAYER: SynthLayerSettings = {
  enabled: true,
  level: 0.9,
  octave: 0,
  sustainPedal: true,
  mode: 'analog',
  category: 'pure',
  waveform: 2,
  oscCtrl: 0.34,
  oscEnv: { attack: 0, decay: 0.5, release: 0.2, amount: 0, velocity: false, toPitch: false },
  filter: {
    on: true,
    type: 'lp12',
    freq: 0.64,
    res: 0.25,
    envAmount: 0.56,
    tracking: 1,
    drive: 0,
    env: { attack: 0, decay: 0.4, release: 0.2, velocity: false },
  },
  amp: { attack: 0, decay: 1, release: 0.2, velocity: 2 },
  lfo: { waveform: 'triangle', rate: 0.42, amount: 0.62, destination: 'off', clockSync: false },
  voice: {
    mode: 'poly',
    priority: 'off',
    glide: 0,
    unison: 0,
    vibrato: { mode: 'off', rate: 5.5, amount: 0.5 },
  },
  arp: {
    mode: 'poly',
    rate: 0.54,
    range: 2,
    direction: 'up',
    hold: false,
    run: false,
    clockSync: false,
  },
  chain: DEFAULT_CHAIN,
}

/** The keybed runs E1 (28) to E7 (100); a layer with no split assignment answers to all of it. */
export const FULL_ZONE: ZoneSettings = { low: 0, high: 127, fadeLow: 0, fadeHigh: 0 }

function fullZones(): Record<LayerKey, ZoneSettings> {
  const zones = {} as Record<LayerKey, ZoneSettings>
  for (const key of LAYER_KEYS) zones[key] = FULL_ZONE
  return zones
}

export const DEFAULT_SETTINGS: EngineSettings = {
  masterLevel: 0.75,
  sectionOn: true,
  effectsOn: true,
  layers: {
    a: DEFAULT_LAYER_A,
    b: { ...DEFAULT_LAYER_A, enabled: false, level: 0.55 },
  },
  rotary: { speed: 'slow', drive: 0.2, morph: 0, stopMode: false, stopAngle: false, closeMic: false },
  organ: {
    sectionOn: false,
    vibChorus: 'v1',
    layers: {
      a: DEFAULT_ORGAN_LAYER,
      b: { ...DEFAULT_ORGAN_LAYER, enabled: false, level: 0.35 },
    },
    chain: DEFAULT_CHAIN,
    toRotary: true,
  },
  synth: {
    sectionOn: false,
    layers: {
      a: DEFAULT_SYNTH_LAYER,
      b: { ...DEFAULT_SYNTH_LAYER, enabled: false, level: 0.3 },
      c: { ...DEFAULT_SYNTH_LAYER, enabled: false, level: 0.6 },
    },
  },
  clock: { bpm: 120, keyboardSync: false },
  transpose: 0,
  zones: fullZones(),
  pitchBend: 0,
}

export const LAYER_IDS: readonly LayerId[] = ['a', 'b']

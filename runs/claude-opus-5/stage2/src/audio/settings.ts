/**
 * Canonical engine settings: the normalised, audio-side view of the panel.
 *
 * The panel stores raw control values (0–10 knobs, option indexes). `src/state/settings.ts`
 * maps those to this shape, and the engine applies this shape to real audio nodes. Keeping the
 * mapping pure and separate is what lets a test prove that a panel control, an engine setting
 * and the rendered signal all agree.
 */

export type PianoTypeId = 'grand' | 'upright' | 'electric' | 'clav' | 'digital' | 'misc'
export type TimbreId = 'off' | 'soft' | 'mid' | 'bright' | 'dyno1' | 'dyno2'
export type KbTouchId = 'normal' | 'heavy' | 'medium' | 'light'
export type LayerId = 'a' | 'b'

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
}

export interface EngineSettings {
  readonly masterLevel: number
  readonly sectionOn: boolean
  /** Layer Effects ON: false bypasses every effect at once. */
  readonly effectsOn: boolean
  readonly layers: Readonly<Record<LayerId, LayerSettings>>
  readonly rotary: RotarySettings
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
export const DEFAULT_SETTINGS: EngineSettings = {
  masterLevel: 0.75,
  sectionOn: true,
  effectsOn: true,
  layers: {
    a: DEFAULT_LAYER_A,
    b: { ...DEFAULT_LAYER_A, enabled: false, level: 0.55 },
  },
  rotary: { speed: 'slow', drive: 0.2 },
}

export const LAYER_IDS: readonly LayerId[] = ['a', 'b']

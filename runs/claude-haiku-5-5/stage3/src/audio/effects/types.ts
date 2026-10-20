// Effect type lists and settings shapes. The panel's type selectors are indexes into these lists,
// so the order here is the order the panel steps through. Every value is a normalized 0..1 control
// position unless a field says otherwise.

export const MOD1_TYPES = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] as const
export const MOD2_TYPES = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const
export const AMP_TYPES = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary'] as const
export const REVERB_TYPES = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'] as const
export const DELAY_FILTERS = ['Off', 'LP', 'HP', 'BP'] as const

/** Index of the amp type that routes the layer into the shared Rotary. */
export const TO_ROTARY_INDEX = AMP_TYPES.indexOf('To Rotary')

export interface ModSettings {
  on: boolean
  /** Index into MOD1_TYPES or MOD2_TYPES. */
  type: number
  rate: number
  amount: number
}

export interface DelaySettings {
  on: boolean
  /** 0..1 maps to 60..1000 ms. */
  time: number
  feedback: number
  mix: number
  /** Index into DELAY_FILTERS, applied inside the feedback loop. */
  filter: number
}

export interface AmpSettings {
  on: boolean
  /** Index into AMP_TYPES. */
  type: number
  drive: number
  bass: number
  mid: number
  midFreq: number
  treble: number
  level: number
}

export interface CompSettings {
  on: boolean
  amount: number
  fast: boolean
}

export interface ReverbSettings {
  on: boolean
  /** Index into REVERB_TYPES. */
  type: number
  /** Dry/wet: fully wet at 1. */
  mix: number
  /** 0 is dark, 1 is bright. */
  bright: number
}

export interface LayerEffectSettings {
  mod1: ModSettings
  mod2: ModSettings
  delay: DelaySettings
  amp: AmpSettings
  comp: CompSettings
  reverb: ReverbSettings
}

export const DEFAULT_LAYER_EFFECTS: LayerEffectSettings = {
  mod1: { on: false, type: 0, rate: 0.3, amount: 0.4 },
  mod2: { on: false, type: 0, rate: 0.2, amount: 0.5 },
  delay: { on: false, time: 0.4, feedback: 0.3, mix: 0.4, filter: 0 },
  amp: { on: false, type: 0, drive: 0.3, bass: 0.5, mid: 0.5, midFreq: 0.5, treble: 0.5, level: 0.5 },
  comp: { on: false, amount: 0.3, fast: false },
  reverb: { on: false, type: 0, mix: 0.3, bright: 0.5 },
}

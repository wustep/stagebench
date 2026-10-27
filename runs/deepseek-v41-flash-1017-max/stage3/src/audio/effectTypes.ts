/**
 * Effect unit definitions.
 *
 * These describe *what the panel offers and what each setting means*, not how the nodes
 * are wired. `effectGraph.ts` builds the nodes; this file is the single source of truth
 * for type lists, parameter ranges and labels, so the panel and the DSP cannot drift.
 *
 * Order follows `specs/nord-stage-4.effects.json` `signalContract.requiredOrder`:
 *   Layer source -> Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ -> Compressor -> Reverb -> Rotary
 */
export type EffectUnitId = 'mod1' | 'mod2' | 'delay' | 'ampEq' | 'compressor' | 'reverb'
export type RotaryId = 'rotary'

export const MOD1_TYPES = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] as const
export const MOD2_TYPES = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const
export const AMP_MODELS = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary'] as const
export const REVERB_TYPES = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'] as const
export const DELAY_FILTERS = ['OFF', 'LP', 'HP', 'BP'] as const

export type Mod1Type = (typeof MOD1_TYPES)[number]
export type Mod2Type = (typeof MOD2_TYPES)[number]
export type AmpModel = (typeof AMP_MODELS)[number]
export type ReverbType = (typeof REVERB_TYPES)[number]
export type DelayFilter = (typeof DELAY_FILTERS)[number]

/** Units whose on/off state can be promoted to Global (manual p. 48). */
export const GLOBAL_CAPABLE: readonly EffectUnitId[] = ['delay', 'compressor', 'reverb']

/**
 * Reverb type voicings. `decay` is the RT60-ish length of the generated impulse response,
 * `damping` the low-pass applied inside the tail, and `preDelay` the gap before it.
 * Booth is the shortest and Cathedral the longest, exactly as the manual describes, and
 * Spring gets its own short, resonant, two-stage character.
 */
export const REVERB_VOICINGS: Record<ReverbType, {
  decay: number
  damping: number
  preDelay: number
  spring: boolean
  density: number
}> = {
  Booth: { decay: 0.35, damping: 5200, preDelay: 0.004, spring: false, density: 0.92 },
  Room: { decay: 0.85, damping: 4200, preDelay: 0.011, spring: false, density: 0.9 },
  Stage: { decay: 1.6, damping: 3400, preDelay: 0.021, spring: false, density: 0.86 },
  Hall: { decay: 2.6, damping: 2700, preDelay: 0.033, spring: false, density: 0.8 },
  Cathedral: { decay: 4.2, damping: 2100, preDelay: 0.048, spring: false, density: 0.72 },
  Spring: { decay: 1.1, damping: 3000, preDelay: 0.002, spring: true, density: 0.98 },
}

/** Amp/cabinet voicings for the three amplifier models (documented approximations). */
export const AMP_VOICINGS: Record<'Twin' | 'JC' | 'Small', {
  /** Low shelf corner and gain, mid bell and gain, high shelf corner and gain. */
  bass: [number, number]
  mid: [number, number, number]
  treble: [number, number]
  /** Pre-gain into the saturator, and the cabinet low/high-pass corners. */
  drive: number
  cabLow: number
  cabHigh: number
  label: string
}> = {
  Twin: { bass: [110, 2.5], mid: [900, -3.5, 0.9], treble: [3800, 5.0], drive: 1.5, cabLow: 98, cabHigh: 6200, label: 'Twin — tube combo with a treble lift' },
  JC: { bass: [95, 1.0], mid: [1400, 2.5, 1.1], treble: [3200, 3.0], drive: 0.9, cabLow: 88, cabHigh: 7000, label: 'JC — bright solid-state chorus amp' },
  Small: { bass: [160, -2.0], mid: [620, 3.0, 1.3], treble: [2600, -1.0], drive: 2.6, cabLow: 120, cabHigh: 4300, label: 'Small — small boxy tube combo' },
}

/**
 * Per-unit parameter metadata: the range the panel knob drives and how it maps to DSP.
 * `unit` is only for the accessible value text.
 */
export interface UnitMeta {
  id: EffectUnitId
  label: string
  /** Printed types in panel order; the first is the power-on default. */
  types?: readonly string[]
  /** True when the unit offers its own on/off; every required unit does. */
  hasOn: boolean
  globalCapable: boolean
}

export const EFFECT_UNITS: readonly UnitMeta[] = [
  { id: 'mod1', label: 'Mod 1', types: MOD1_TYPES, hasOn: true, globalCapable: false },
  { id: 'mod2', label: 'Mod 2', types: MOD2_TYPES, hasOn: true, globalCapable: false },
  { id: 'delay', label: 'Delay', hasOn: true, globalCapable: true },
  { id: 'ampEq', label: 'Amp Sim / EQ', types: AMP_MODELS, hasOn: true, globalCapable: false },
  { id: 'compressor', label: 'Compressor', hasOn: true, globalCapable: true },
  { id: 'reverb', label: 'Reverb', types: REVERB_TYPES, hasOn: true, globalCapable: true },
]

/** Panel type label <-> spec type name. The panel prints short legends. */
export const MOD1_LABELS: Record<string, Mod1Type> = {
  'A-PAN': 'A-Pan',
  TREM: 'Tremolo',
  RM: 'Ring Mod',
  'A-WAH': 'A-Wah',
  WAH: 'Wah',
  PUMP: 'Pump',
}

export const MOD2_LABELS: Record<string, Mod2Type> = {
  CHOR: 'Chorus',
  FLANG: 'Flanger',
  PHAS: 'Phaser',
  VIBE: 'Vibe',
  ENS: 'Ensemble',
  SPIN: 'Spin',
}

export const AMP_LABELS: Record<string, AmpModel> = {
  SMALL: 'Small',
  JC: 'JC',
  TWIN: 'Twin',
  'TO ROTARY': 'To Rotary',
  'LP FILTER': 'LP24 Filter',
  'HP FILTER': 'HP24 Filter',
}

export const REVERB_LABELS: Record<string, ReverbType> = {
  ROOM: 'Room',
  BOOTH: 'Booth',
  SPRING: 'Spring',
  STAGE: 'Stage',
  HALL: 'Hall',
  CATH: 'Cathedral',
}

export const DELAY_FILTER_LABELS: Record<string, DelayFilter> = {
  HP: 'HP',
  BP: 'BP',
  LP: 'LP',
}

/** Delay tempo knob (0..10) maps to 40..900 ms, exponential like a real tap-tempo knob. */
export function delaySecondsFor(knob: number): number {
  const t = Math.min(10, Math.max(0, knob)) / 10
  // 0 -> 40 ms, 10 -> 900 ms, with a musical resolution in the middle of the range.
  return 0.04 * Math.pow(900 / 40, t)
}

/** Maps the tempo knob so printed tap tempo and the knob agree. */
export function knobForDelaySeconds(seconds: number): number {
  const clamped = Math.min(0.9, Math.max(0.04, seconds))
  return (Math.log(clamped / 0.04) / Math.log(900 / 40)) * 10
}

/** Mod 1 rate knob (0..10) maps to 0.05..12 Hz. */
export function mod1RateHz(knob: number): number {
  const t = Math.min(10, Math.max(0, knob)) / 10
  return 0.05 * Math.pow(12 / 0.05, t)
}

/** Mod 2 rate knob (0..10) maps to 0.05..9 Hz. */
export function mod2RateHz(knob: number): number {
  const t = Math.min(10, Math.max(0, knob)) / 10
  return 0.05 * Math.pow(9 / 0.05, t)
}

/** Rotary speed: slow rotor ≈ 0.8 Hz horn / 0.7 Hz drum, fast ≈ 6.8 / 5.7 Hz (manual p. 53). */
export const ROTARY_SPEEDS = {
  slow: { horn: 0.83, drum: 0.74 },
  fast: { horn: 6.8, drum: 5.7 },
}

/** Amp EQ gains are printed -15..+15 dB and map 1:1. */
export function eqGainDb(knob: number): number {
  return Math.max(-15, Math.min(15, knob))
}

/** Mid/Freq knob 0..10 sweeps 200 Hz .. 8 kHz exponentially (spec `eq.midRangeHz`). */
export function midFreqHz(knob: number): number {
  const t = Math.min(10, Math.max(0, knob)) / 10
  return 200 * Math.pow(8000 / 200, t)
}

/** Compressor amount 0..10 maps to threshold/ratio pairs that audibly narrow dynamics. */
export function compSettingsFor(amount: number, fast: boolean): {
  threshold: number
  ratio: number
  attack: number
  release: number
  makeup: number
} {
  const t = Math.min(10, Math.max(0, amount)) / 10
  return {
    threshold: -6 - t * 30,
    ratio: 1.4 + t * 9,
    attack: fast ? 0.002 : 0.012,
    release: fast ? 0.045 : 0.24,
    // Make-up gain keeps perceived loudness roughly intact so the test measures dynamics,
    // not just a level drop.
    makeup: 1 + t * 1.6,
  }
}

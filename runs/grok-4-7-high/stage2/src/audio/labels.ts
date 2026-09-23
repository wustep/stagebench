/** Panel cycle order. Audio code indexes these the same way the hardware model does. */
export const PIANO_TYPES = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as const
export type PianoType = (typeof PIANO_TYPES)[number]
export type LayerId = 'A' | 'B'
export type SampledType = 'Grand' | 'Upright' | 'Electric'

export const SAMPLED_TYPES: readonly SampledType[] = ['Grand', 'Upright', 'Electric']

export function isSampledType(type: PianoType): type is SampledType {
  return type === 'Grand' || type === 'Upright' || type === 'Electric'
}

export const MOD1_TYPES = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] as const
export type Mod1Type = (typeof MOD1_TYPES)[number]
export const MOD2_TYPES = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const
export type Mod2Type = (typeof MOD2_TYPES)[number]
export const AMP_TYPES = ['EQ', 'Twin', 'JC', 'Small', 'LP24', 'HP24', 'Rotary'] as const
export type AmpType = (typeof AMP_TYPES)[number]
export const REVERB_TYPES = ['Booth', 'Room', 'Spring', 'Stage', 'Hall', 'Cathedral'] as const
export type ReverbType = (typeof REVERB_TYPES)[number]
export const DELAY_FILTERS = ['Off', 'LP', 'HP', 'BP'] as const
export type DelayFilter = (typeof DELAY_FILTERS)[number]
export const TOUCHES = ['Heavy', 'Medium', 'Light'] as const
export type KbTouch = (typeof TOUCHES)[number]
export const TIMBRES = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const
export type Timbre = (typeof TIMBRES)[number]

export const SIGNAL_ORDER = [
  'layer-source',
  'timbre',
  'mod1',
  'mod2',
  'delay',
  'amp',
  'compressor',
  'reverb',
  'layer-level',
  'rotary-when-routed',
  'master',
  'limiter',
  'destination',
] as const

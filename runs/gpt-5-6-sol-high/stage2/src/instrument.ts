export type LayerId = 'A' | 'B'
export type PianoType = 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc'
export type KbTouch = 'Heavy' | 'Medium' | 'Light'
export type Timbre = 'Off' | 'Soft' | 'Mid' | 'Bright' | 'Dyno 1' | 'Dyno 2'
export type FeedbackFilter = 'Off' | 'LP' | 'HP' | 'BP'
export type Mod1Type = 'A-Pan' | 'Tremolo' | 'Ring Mod' | 'A-Wah' | 'Wah' | 'Pump'
export type Mod2Type = 'Chorus' | 'Flanger' | 'Phaser' | 'Vibe' | 'Ensemble' | 'Spin'
export type AmpType = 'EQ only' | 'Twin' | 'JC' | 'Small' | 'LP24 Filter' | 'HP24 Filter' | 'To Rotary'
export type ReverbType = 'Room' | 'Booth' | 'Spring' | 'Stage' | 'Hall' | 'Cathedral'
export type EffectUnitId = 'mod1' | 'mod2' | 'delay' | 'ampEq' | 'compressor' | 'reverb'

export const PIANO_TYPES: PianoType[] = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc']
export const KB_TOUCHES: KbTouch[] = ['Heavy', 'Medium', 'Light']
export const TIMBRES: Timbre[] = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2']
export const MOD1_TYPES: Mod1Type[] = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump']
export const MOD2_TYPES: Mod2Type[] = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin']
export const AMP_TYPES: AmpType[] = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary']
export const REVERB_TYPES: ReverbType[] = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral']
export const FEEDBACK_FILTERS: FeedbackFilter[] = ['Off', 'LP', 'HP', 'BP']

export interface PianoLayerState {
  enabled: boolean
  level: number
  octave: -12 | 0 | 12
  sustped: boolean
  pstick: boolean
  type: PianoType
  model: string
  kbTouch: KbTouch
  dynComp: 0 | 1 | 2 | 3
  timbre: Timbre
  unison: 0 | 1 | 2 | 3
  softRelease: boolean
  stringRes: boolean
}

export interface EffectUnitState {
  on: boolean
  type: string
  rate: number
  amount: number
  mix: number
  feedback: number
  filter: FeedbackFilter
  bright: number
  fast: boolean
  global: boolean
}

export interface EffectChainState {
  allBypass: boolean
  mod1: EffectUnitState
  mod2: EffectUnitState
  delay: EffectUnitState
  ampEq: EffectUnitState
  compressor: EffectUnitState
  reverb: EffectUnitState
}

export interface InstrumentState {
  sectionOn: boolean
  focus: LayerId
  group: boolean
  masterLevel: number
  sustainDown: boolean
  pitchBend: number
  rotaryOn: boolean
  rotaryFast: boolean
  rotaryDrive: number
  layers: Record<LayerId, PianoLayerState>
  effects: Record<LayerId, EffectChainState>
}

const unit = (type: string, overrides: Partial<EffectUnitState> = {}): EffectUnitState => ({
  on: false, type, rate: 0.42, amount: 0.38, mix: 0.28, feedback: 0.32,
  filter: 'Off', bright: 0.55, fast: false, global: false, ...overrides,
})

const chain = (): EffectChainState => ({
  allBypass: false,
  mod1: unit('A-Pan'),
  mod2: unit('Chorus'),
  delay: unit('Digital', { mix: 0.2 }),
  ampEq: unit('EQ only'),
  compressor: unit('Compressor'),
  reverb: unit('Room', { mix: 0.24 }),
})

export const createInitialInstrumentState = (): InstrumentState => ({
  sectionOn: true,
  focus: 'A',
  group: false,
  masterLevel: 0.72,
  sustainDown: false,
  pitchBend: 0,
  rotaryOn: true,
  rotaryFast: false,
  rotaryDrive: 0.25,
  layers: {
    A: { enabled: true, level: 0.78, octave: 0, sustped: true, pstick: false, type: 'Grand', model: 'Studio Grand', kbTouch: 'Medium', dynComp: 0, timbre: 'Off', unison: 0, softRelease: false, stringRes: false },
    B: { enabled: false, level: 0.6, octave: 0, sustped: true, pstick: false, type: 'Upright', model: 'Felt Upright', kbTouch: 'Medium', dynComp: 0, timbre: 'Off', unison: 0, softRelease: false, stringRes: false },
  },
  effects: { A: chain(), B: chain() },
})

export const cycle = <T,>(values: readonly T[], current: T): T => values[(values.indexOf(current) + 1) % values.length]

export function targetsForUnit(state: InstrumentState, unitId: EffectUnitId): LayerId[] {
  if (state.group || state.effects[state.focus][unitId].global) return ['A', 'B']
  return [state.focus]
}

export function updateEffectUnit(
  state: InstrumentState,
  unitId: EffectUnitId,
  update: (unitState: EffectUnitState) => EffectUnitState,
): InstrumentState {
  const effects = { ...state.effects }
  for (const layer of targetsForUnit(state, unitId)) {
    effects[layer] = { ...effects[layer], [unitId]: update(effects[layer][unitId]) }
  }
  return { ...state, effects }
}

export const SAMPLE_BANKS = {
  Grand: { roots: [36, 48, 60, 72, 84, 96], velocities: [0.32, 0.66, 1], source: 'generated-pcm' },
  Upright: { roots: [36, 48, 60, 72, 84, 96], velocities: [0.32, 0.66, 1], source: 'generated-pcm' },
  Electric: { roots: [36, 48, 60, 72, 84, 96], velocities: [0.32, 0.66, 1], source: 'generated-pcm' },
} as const

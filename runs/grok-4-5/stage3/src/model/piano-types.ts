/** Piano / effects types and control enums for Phase 2 */

export type PianoType = 'Grand' | 'Upright' | 'Electric' | 'Clav' | 'Digital' | 'Misc'
export type LayerId = 'A' | 'B'
export type KbTouch = 'Heavy' | 'Medium' | 'Light'
export type DynComp = 'Off' | 1 | 2 | 3
export type Unison = 'Off' | 1 | 2 | 3
export type TimbreAcoustic = 'Off' | 'Soft' | 'Mid' | 'Bright'
export type TimbreElectric = 'Off' | 'Soft' | 'Mid' | 'Bright' | 'Dyno 1' | 'Dyno 2'
export type Timbre = TimbreAcoustic | TimbreElectric

export type Mod1Type = 'A-Pan' | 'Tremolo' | 'Ring Mod' | 'A-Wah' | 'Wah' | 'Pump'
export type Mod2Type = 'Chorus' | 'Flanger' | 'Phaser' | 'Vibe' | 'Ensemble' | 'Spin'
export type AmpType = 'EQ only' | 'Twin' | 'JC' | 'Small' | 'LP24 Filter' | 'HP24 Filter' | 'To Rotary'
export type ReverbType = 'Room' | 'Booth' | 'Spring' | 'Stage' | 'Hall' | 'Cathedral'
export type DelayFilter = 'Off' | 'LP' | 'HP' | 'BP'
export type FxFocusTarget = 'Organ' | 'Piano' | 'Synth'
export type FxLayerFocus = 'OrganA' | 'OrganB' | 'PianoA' | 'PianoB' | 'SynthA' | 'SynthB' | 'SynthC'

export const PIANO_TYPES: PianoType[] = ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc']
export const MOD1_TYPES: Mod1Type[] = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump']
export const MOD2_TYPES: Mod2Type[] = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin']
export const AMP_TYPES: AmpType[] = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary']
export const REVERB_TYPES: ReverbType[] = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral']
export const DELAY_FILTERS: DelayFilter[] = ['Off', 'LP', 'HP', 'BP']

export interface PianoLayerState {
  enabled: boolean
  level: number
  octave: number
  sustped: boolean
  pstick: boolean
  zones: [boolean, boolean, boolean, boolean]
}

export interface PianoSectionState {
  sectionOn: boolean
  focus: LayerId
  type: PianoType
  modelIndex: number
  kbTouch: KbTouch
  dynComp: DynComp
  timbre: Timbre
  unison: Unison
  softRelease: boolean
  stringRes: boolean
  layers: Record<LayerId, PianoLayerState>
}

export interface EffectUnitBase {
  on: boolean
}

export interface Mod1State extends EffectUnitBase {
  type: Mod1Type
  rate: number
  amount: number
}

export interface Mod2State extends EffectUnitBase {
  type: Mod2Type
  rate: number
  amount: number
}

export interface DelayState extends EffectUnitBase {
  tempo: number
  feedback: number
  mix: number
  filter: DelayFilter
  global: boolean
}

export interface AmpEqState extends EffectUnitBase {
  type: AmpType
  drive: number
  bass: number
  mid: number
  midFreq: number
  treble: number
}

export interface CompressorState extends EffectUnitBase {
  amount: number
  fast: boolean
  global: boolean
}

export interface ReverbState extends EffectUnitBase {
  type: ReverbType
  mix: number
  time: number
  bright: boolean
  global: boolean
}

export interface RotaryState extends EffectUnitBase {
  fast: boolean
  drive: number
}

export interface EffectChainState {
  mod1: Mod1State
  mod2: Mod2State
  delay: DelayState
  ampEq: AmpEqState
  compressor: CompressorState
  reverb: ReverbState
}

export type ChainKey = 'Organ' | 'PianoA' | 'PianoB' | 'SynthA' | 'SynthB' | 'SynthC'

export interface EffectsSectionState {
  allBypass: boolean
  focusSection: FxFocusTarget
  layerFocus: FxLayerFocus
  pianoGroup: boolean
  chains: Record<ChainKey, EffectChainState>
  rotary: RotaryState
  /** shared global unit overrides when unit.global */
  globalDelay: DelayState
  globalCompressor: CompressorState
  globalReverb: ReverbState
}

export function defaultLayer(enabled: boolean, level: number): PianoLayerState {
  return {
    enabled,
    level,
    octave: 0,
    sustped: true,
    pstick: false,
    zones: [true, true, true, true],
  }
}

export function defaultPianoState(): PianoSectionState {
  return {
    sectionOn: true,
    focus: 'A',
    type: 'Grand',
    modelIndex: 0,
    kbTouch: 'Medium',
    dynComp: 'Off',
    timbre: 'Off',
    unison: 'Off',
    softRelease: false,
    stringRes: false,
    layers: {
      A: defaultLayer(true, 0.85),
      B: defaultLayer(false, 0),
    },
  }
}

export function defaultChain(): EffectChainState {
  return {
    mod1: { on: false, type: 'Tremolo', rate: 0.4, amount: 0.3 },
    mod2: { on: false, type: 'Chorus', rate: 0.4, amount: 0.3 },
    delay: { on: false, tempo: 0.4, feedback: 0.3, mix: 0.25, filter: 'Off', global: false },
    ampEq: { on: false, type: 'EQ only', drive: 0.2, bass: 0.5, mid: 0.5, midFreq: 0.5, treble: 0.5 },
    compressor: { on: false, amount: 0.3, fast: false, global: false },
    reverb: { on: false, type: 'Hall', mix: 0.3, time: 0.5, bright: true, global: false },
  }
}

export function defaultEffectsState(): EffectsSectionState {
  return {
    allBypass: false,
    focusSection: 'Piano',
    layerFocus: 'PianoA',
    pianoGroup: true,
    chains: {
      Organ: defaultChain(),
      PianoA: defaultChain(),
      PianoB: defaultChain(),
      SynthA: defaultChain(),
      SynthB: defaultChain(),
      SynthC: defaultChain(),
    },
    rotary: { on: false, fast: false, drive: 0.3 },
    globalDelay: { on: false, tempo: 0.4, feedback: 0.3, mix: 0.25, filter: 'Off', global: true },
    globalCompressor: { on: false, amount: 0.3, fast: false, global: true },
    globalReverb: { on: false, type: 'Hall', mix: 0.3, time: 0.5, bright: true, global: true },
  }
}

export function cycleEnum<T>(list: readonly T[], current: T, dir = 1): T {
  const i = list.indexOf(current)
  const next = (i + dir + list.length) % list.length
  return list[next]!
}

export function kbTouchFromKnob(v: number): KbTouch {
  if (v < 0.33) return 'Heavy'
  if (v < 0.66) return 'Medium'
  return 'Light'
}

export function dynCompFromKnob(v: number): DynComp {
  if (v < 0.2) return 'Off'
  if (v < 0.45) return 1
  if (v < 0.7) return 2
  return 3
}

export function unisonFromButton(presses: number): Unison {
  const levels: Unison[] = ['Off', 1, 2, 3]
  return levels[presses % 4]!
}

export function timbreFromKnob(type: PianoType, v: number): Timbre {
  const electric = type === 'Electric' || type === 'Clav'
  if (electric) {
    const opts: TimbreElectric[] = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2']
    const i = Math.min(opts.length - 1, Math.floor(v * opts.length))
    return opts[i]!
  }
  const opts: TimbreAcoustic[] = ['Off', 'Soft', 'Mid', 'Bright']
  const i = Math.min(opts.length - 1, Math.floor(v * opts.length))
  return opts[i]!
}

export function applyKbTouch(velocity: number, touch: KbTouch): number {
  const v = Math.max(0.01, Math.min(1, velocity))
  if (touch === 'Heavy') return Math.pow(v, 1.6)
  if (touch === 'Light') return Math.pow(v, 0.55)
  return v
}

export function applyDynComp(velocity: number, level: DynComp): number {
  if (level === 'Off') return velocity
  const amount = level * 0.22
  return velocity + (1 - velocity) * amount
}

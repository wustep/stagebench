/**
 * Canonical Layer Effects state (Phase 2) — per-chain settings plus routing.
 *
 * Mirrors the panel: the FX focus buttons pick which chain the unit controls
 * edit; Piano group mode makes both piano layers share one chain; Delay /
 * Compressor / Reverb can be global (all layers of all sections, Shift+On).
 * Organ and Synth chains exist in state but carry no audio in Phase 2 (their
 * sections are silent); the Rotary is shared and reached via To Rotary.
 */

export type LayerId = 'pianoA' | 'pianoB'

/** Every chain instance that exists per program (manual p. 48). */
export type ChainId = 'pianoA' | 'pianoB' | 'synthA' | 'synthB' | 'synthC' | 'organ'
export const ALL_CHAINS: readonly ChainId[] = ['pianoA', 'pianoB', 'synthA', 'synthB', 'synthC', 'organ']

export type FocusSection = 'organ' | 'piano' | 'synth'

export const MOD1_TYPES = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump'] as const
export const MOD2_TYPES = ['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'] as const
export const AMP_TYPES = ['EQ only', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary'] as const
export const REVERB_TYPES = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'] as const
export const DELAY_FILTER_TYPES = ['Off', 'LP', 'HP', 'BP'] as const

export interface ModUnitState {
  on: boolean
  type: number
  rate: number // 0..127
  amount: number // 0..127
}

export interface DelayUnitState {
  on: boolean
  global: boolean
  tempoMs: number
  feedback: number // 0..127
  mix: number // 0..127 dry/wet
  filterType: number // index into DELAY_FILTER_TYPES
  pingPong: boolean
}

export interface AmpUnitState {
  on: boolean
  type: number // index into AMP_TYPES; 6 = To Rotary
  drive: number // 0..127
  bass: number // 0..127, 64 = 0 dB
  midGain: number // 0..127, 64 = 0 dB (or resonance for filter types)
  midFreq: number // 0..127 → 200..8000 Hz (or filter cutoff)
  treble: number // 0..127, 64 = 0 dB
}

export interface CompUnitState {
  on: boolean
  global: boolean
  amount: number // 0..127
  fast: boolean
}

export interface ReverbUnitState {
  on: boolean
  global: boolean
  type: number // index into REVERB_TYPES
  amount: number // 0..127 dry/wet; fully wet at max
  bright: boolean
}

export interface ChainState {
  mod1: ModUnitState
  mod2: ModUnitState
  delay: DelayUnitState
  amp: AmpUnitState
  comp: CompUnitState
  reverb: ReverbUnitState
}

export interface RotaryState {
  on: boolean
  fast: boolean
  drive: number // 0..127
}

export interface EffectsState {
  chains: Record<ChainId, ChainState>
  rotary: RotaryState
  /** Master Layer Effects ON: bypasses every effect at once (manual p. 48). */
  allOn: boolean
  focusSection: FocusSection
  /** Within the focused section, which layer the unit controls edit. */
  focusLayer: 'A' | 'B'
  /** Piano chains grouped: both layers share the focus layer's settings. */
  pianoGroup: boolean
  synthGroup: boolean
}

function defaultChain(): ChainState {
  return {
    mod1: { on: false, type: 1, rate: 64, amount: 64 },
    mod2: { on: false, type: 0, rate: 64, amount: 64 },
    delay: { on: false, global: false, tempoMs: 400, feedback: 50, mix: 40, filterType: 0, pingPong: false },
    amp: { on: false, type: 0, drive: 0, bass: 64, midGain: 64, midFreq: 64, treble: 64 },
    comp: { on: false, global: false, amount: 64, fast: false },
    reverb: { on: false, global: false, type: 4, amount: 30, bright: false },
  }
}

export function defaultEffectsState(): EffectsState {
  return {
    chains: {
      pianoA: defaultChain(),
      pianoB: defaultChain(),
      synthA: defaultChain(),
      synthB: defaultChain(),
      synthC: defaultChain(),
      organ: defaultChain(),
    },
    rotary: { on: false, fast: false, drive: 64 },
    allOn: true,
    focusSection: 'piano',
    focusLayer: 'A',
    pianoGroup: false,
    synthGroup: false,
  }
}

/** Which chain the panel unit controls currently edit. */
export function focusedChainId(state: EffectsState): ChainId {
  if (state.focusSection === 'piano') return state.focusLayer === 'A' ? 'pianoA' : 'pianoB'
  if (state.focusSection === 'organ') return 'organ'
  return state.focusLayer === 'A' ? 'synthA' : 'synthB'
}

/**
 * Resolve the chain settings that actually process a sounding piano layer,
 * honoring group mode (layers share the focused chain's settings).
 */
export function chainForLayer(state: EffectsState, layer: LayerId): ChainState {
  if (state.pianoGroup) return state.chains[focusedChainId(state) === 'pianoB' ? 'pianoB' : 'pianoA']
  return state.chains[layer]
}

/** Resolve a possibly-global unit: global units use the focused chain's settings everywhere. */
export function resolveUnit<K extends 'delay' | 'comp' | 'reverb'>(state: EffectsState, layer: LayerId, unit: K): ChainState[K] {
  const own = chainForLayer(state, layer)[unit]
  if (own.global) return own
  const focused = state.chains[focusedChainId(state)][unit]
  return focused.global ? focused : own
}

/**
 * Effect and routing state.
 *
 * One store per instrument holds the per-layer chain settings, the shared Rotary, the FX
 * focus, and the group/global/bypass flags. The panel writes here; the audio graph reads
 * here. Because both sides use the same normalized defaults, the panel can never show
 * something the graph is not doing.
 */
import type { ChainOwner } from './types'
import {
  AMP_MODELS,
  MOD1_TYPES,
  MOD2_TYPES,
  REVERB_TYPES,
  type AmpModel,
  type Mod1Type,
  type Mod2Type,
  type ReverbType,
} from './effectTypes'

/** Section-level FX focus. Organ and Synth keep their Phase 1 decorative behaviour. */
export type FxFocus = 'organ' | 'piano' | 'synth'
/** Which layer the effect edits apply to, once the section is chosen. */
export type FocusedLayer = ChainOwner

export interface Mod1Settings {
  on: boolean
  type: Mod1Type
  /** 0..10 panel units; sensitivity for A-Wah. */
  rate: number
  /** 0..10 panel units. */
  amount: number
}

export interface Mod2Settings {
  on: boolean
  type: Mod2Type
  rate: number
  amount: number
}

export interface DelaySettings {
  on: boolean
  /** 0..10 panel units, mapping exponentially to time. */
  tempo: number
  feedback: number
  /** 0..10; 0 = fully dry, 10 = fully wet. */
  dryWet: number
  filter: 'OFF' | 'LP' | 'HP' | 'BP'
  pingPong: boolean
  /** Explicit delay time set by tap tempo; overrides `tempo` when present. */
  tapSeconds: number | null
  global: boolean
}

export interface AmpEqSettings {
  on: boolean
  model: AmpModel
  drive: number
  bass: number
  /** -15..15 dB */
  mid: number
  /** 0..10, mapping 200 Hz..8 kHz */
  midFreq: number
  treble: number
}

export interface CompSettings {
  on: boolean
  amount: number
  fast: boolean
  global: boolean
}

export interface ReverbSettings {
  on: boolean
  type: ReverbType
  dryWet: number
  tone: 'Bright' | 'Dark'
  global: boolean
}

export interface ChainSettings {
  mod1: Mod1Settings
  mod2: Mod2Settings
  delay: DelaySettings
  ampEq: AmpEqSettings
  compressor: CompSettings
  reverb: ReverbSettings
}

export interface RotarySettings {
  on: boolean
  speed: 'Slow' | 'Fast'
  drive: number
  /** Set by the panel's ORGAN button; Piano/Synth route with To Rotary. */
  organRouted: boolean
}

export interface EffectState {
  /** Layer Effects ON: false bypasses every unit on every chain at once. */
  allOn: boolean
  focus: FxFocus
  /** Which layer's chain the panel is editing while Piano is focused. */
  focusedLayer: FocusedLayer
  /** Piano group mode: both layers share the focused layer's settings. */
  pianoGroup: boolean
  chains: Record<ChainOwner, ChainSettings>
  rotary: RotarySettings
  /** Bumped on every change, so the graph can diff and ramp only what moved. */
  revision: number
}

export function defaultChain(): ChainSettings {
  return {
    mod1: { on: false, type: MOD1_TYPES[1], rate: 4, amount: 3 },
    mod2: { on: false, type: MOD2_TYPES[0], rate: 5, amount: 4 },
    delay: { on: false, tempo: 4, feedback: 3, dryWet: 2, filter: 'OFF', pingPong: false, tapSeconds: null, global: false },
    ampEq: { on: false, model: AMP_MODELS[0], drive: 2, bass: 0, mid: 0, midFreq: 5, treble: 0 },
    compressor: { on: false, amount: 3, fast: false, global: false },
    reverb: { on: false, type: REVERB_TYPES[0], dryWet: 3, tone: 'Bright', global: false },
  }
}

export function defaultEffectState(): EffectState {
  return {
    allOn: true,
    focus: 'piano',
    focusedLayer: 'piano.a',
    pianoGroup: false,
    chains: { 'piano.a': defaultChain(), 'piano.b': defaultChain() },
    rotary: { on: false, speed: 'Slow', drive: 3, organRouted: false },
    revision: 0,
  }
}

export function cloneChain(chain: ChainSettings): ChainSettings {
  return {
    mod1: { ...chain.mod1 },
    mod2: { ...chain.mod2 },
    delay: { ...chain.delay },
    ampEq: { ...chain.ampEq },
    compressor: { ...chain.compressor },
    reverb: { ...chain.reverb },
  }
}

export function cloneState(state: EffectState): EffectState {
  return {
    ...state,
    chains: { 'piano.a': cloneChain(state.chains['piano.a']), 'piano.b': cloneChain(state.chains['piano.b']) },
    rotary: { ...state.rotary },
    revision: state.revision + 1,
  }
}

export interface EffectStore {
  get(): EffectState
  /** Applies a mutation to a deep copy and notifies subscribers. */
  update(mutate: (draft: EffectState) => void): void
  subscribe(listener: (state: EffectState) => void): () => void
}

export function createEffectStore(initial?: EffectState): EffectStore {
  let state = initial ?? defaultEffectState()
  const listeners = new Set<(state: EffectState) => void>()
  return {
    get: () => state,
    update(mutate) {
      const draft = cloneState(state)
      mutate(draft)
      state = draft
      for (const listener of listeners) listener(state)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** Returns the chain a voice on `layer` should actually play through. */
export function chainFor(state: EffectState, layer: ChainOwner): ChainSettings {
  if (state.pianoGroup) return state.chains[state.focusedLayer]
  return state.chains[layer]
}

/**
 * Resolves Global units: a unit promoted to Global takes its settings from the chain that
 * owns it and applies them to every layer. Since a Global Delay/Comp/Reverb is one setting
 * for all layers, the resolved chain substitutes the source chain's unit for that unit.
 */
export function effectiveChain(state: EffectState, layer: ChainOwner): ChainSettings {
  const own = chainFor(state, layer)
  const source = state.chains[state.focusedLayer]
  const resolved = cloneChain(own)
  if (state.chains[state.focusedLayer].delay.global) resolved.delay = { ...source.delay }
  if (state.chains[state.focusedLayer].compressor.global) resolved.compressor = { ...source.compressor }
  if (state.chains[state.focusedLayer].reverb.global) resolved.reverb = { ...source.reverb }
  return resolved
}

/** True when a unit is on and the all-effects switch allows it. */
export function unitActive(state: EffectState, layer: ChainOwner, unit: keyof ChainSettings): boolean {
  if (!state.allOn) return false
  return effectiveChain(state, layer)[unit].on !== false
}

export function focusLayer(state: EffectState, layer: ChainOwner): void {
  state.focusedLayer = layer
  state.focus = 'piano'
}

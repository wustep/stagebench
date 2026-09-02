/**
 * Canonical Phase 2 instrument state: the piano section (two layers, pedals, focus), the layer effect
 * chains (Piano A / B audible; Organ / Synth chains stored but inaudible until Phase 3), the shared rotary,
 * the master level and the panel's Shift latch. Panel controls are mapped onto this state by
 * src/audio/instrumentController.ts, and this state is what the engine and the DSP receive.
 */
import { defaultPianoSettings, type LayerId, type PianoSettings } from '../audio/engine'
import { tempoKnobToSeconds, type ChainParams } from '../dsp/types'
import { createStore, type Store } from './store'

export type FocusSection = 'organ' | 'piano' | 'synth'
export type ChainKey = 'pianoA' | 'pianoB' | 'organ' | 'synth'
export const PIANO_CHAIN_KEYS: Record<LayerId, ChainKey> = { A: 'pianoA', B: 'pianoB' }
export const ALL_CHAIN_KEYS: readonly ChainKey[] = ['pianoA', 'pianoB', 'organ', 'synth']

export interface Mod1Settings {
  on: boolean
  type: number
  rate: number
  amount: number
}
export interface Mod2Settings {
  on: boolean
  type: number
  rate: number
  amount: number
}
export interface DelaySettings {
  on: boolean
  /** Tempo knob position 0..10 (kept in sync with `seconds`). */
  tempo: number
  seconds: number
  feedback: number
  dryWet: number
  filter: number
  pingPong: boolean
}
export interface AmpSettings {
  on: boolean
  model: number
  drive: number
  bass: number
  mid: number
  midFreq: number
  treble: number
}
export interface CompSettings {
  on: boolean
  amount: number
  fast: boolean
}
export interface ReverbSettings {
  on: boolean
  type: number
  dryWet: number
  tone: number
}
export interface ChainSettings {
  mod1: Mod1Settings
  mod2: Mod2Settings
  delay: DelaySettings
  amp: AmpSettings
  comp: CompSettings
  reverb: ReverbSettings
}
export type UnitKey = keyof ChainSettings
export const UNIT_KEYS: readonly UnitKey[] = ['mod1', 'mod2', 'delay', 'amp', 'comp', 'reverb']
export const GLOBAL_CAPABLE: readonly UnitKey[] = ['delay', 'comp', 'reverb']
/** Amp Sim/EQ model index that routes the layer into the shared Rotary (src/dsp/types AMP_MODELS). */
export const AMP_MODEL_TO_ROTARY = 4

export interface EffectsState {
  /** Layer Effects ON: false bypasses every unit of every chain at once. */
  on: boolean
  focus: FocusSection
  pianoGroup: boolean
  global: Record<'delay' | 'comp' | 'reverb', boolean>
  chains: Record<ChainKey, ChainSettings>
}

export interface InstrumentState {
  piano: PianoSettings & { focus: LayerId }
  effects: EffectsState
  rotary: { fast: boolean; drive: number }
  master: { level: number }
  /** Shift latch: the next panel button press gets its Shift function. */
  shiftArmed: boolean
  delayTaps: number[]
}

/** Panel defaults mirror src/hardware/controls.ts initial values. */
export function defaultChainSettings(): ChainSettings {
  return {
    mod1: { on: false, type: 5, rate: 4, amount: 5 },
    mod2: { on: false, type: 0, rate: 3, amount: 6 },
    delay: { on: false, tempo: 5, seconds: tempoKnobToSeconds(5), feedback: 6, dryWet: 4, filter: 3, pingPong: false },
    amp: { on: false, model: 3, drive: 3, bass: 0, mid: 0, midFreq: 5, treble: 0 },
    comp: { on: false, amount: 5, fast: false },
    reverb: { on: true, type: 5, dryWet: 6, tone: 0 },
  }
}

export function initialInstrumentState(library: boolean): InstrumentState {
  return {
    piano: { ...defaultPianoSettings(library), focus: 'A' },
    effects: {
      on: true,
      focus: 'piano',
      pianoGroup: false,
      global: { delay: false, comp: false, reverb: false },
      chains: { pianoA: defaultChainSettings(), pianoB: defaultChainSettings(), organ: defaultChainSettings(), synth: defaultChainSettings() },
    },
    rotary: { fast: false, drive: 2 },
    master: { level: 7 },
    shiftArmed: false,
    delayTaps: [],
  }
}

export type InstrumentStore = Store<InstrumentState>

export function createInstrumentStore(library: boolean): InstrumentStore {
  return createStore(initialInstrumentState(library))
}

/** Which chain the effects panel is showing / editing. */
export function focusedChainKey(state: InstrumentState): ChainKey {
  if (state.effects.focus === 'piano') return PIANO_CHAIN_KEYS[state.piano.focus]
  return state.effects.focus
}

/** Chains an edit of `unit` must reach, honouring global and group modes. */
export function targetChainKeys(state: InstrumentState, unit: UnitKey): ChainKey[] {
  if ((unit === 'delay' || unit === 'comp' || unit === 'reverb') && state.effects.global[unit]) return [...ALL_CHAIN_KEYS]
  if (state.effects.focus === 'piano') return state.effects.pianoGroup ? ['pianoA', 'pianoB'] : [PIANO_CHAIN_KEYS[state.piano.focus]]
  return [state.effects.focus]
}

/** Converts panel chain settings to the DSP chain parameters (Timbre / String Res are set by the engine). */
export function chainParamsFor(chain: ChainSettings, effectsOn: boolean): Omit<ChainParams, 'timbre' | 'stringRes'> {
  return {
    mod1: { on: chain.mod1.on, type: chain.mod1.type, rate: chain.mod1.rate, amount: chain.mod1.amount },
    mod2: { on: chain.mod2.on, type: chain.mod2.type, rate: chain.mod2.rate, amount: chain.mod2.amount },
    delay: { on: chain.delay.on, seconds: chain.delay.seconds, feedback: chain.delay.feedback, dryWet: chain.delay.dryWet, filter: chain.delay.filter, pingPong: chain.delay.pingPong },
    ampEq: { on: chain.amp.on, model: chain.amp.model, drive: chain.amp.drive, bass: chain.amp.bass, mid: chain.amp.mid, midFreq: chain.amp.midFreq, treble: chain.amp.treble },
    compressor: { on: chain.comp.on, amount: chain.comp.amount, fast: chain.comp.fast },
    reverb: { on: chain.reverb.on, type: chain.reverb.type, dryWet: chain.reverb.dryWet, tone: chain.reverb.tone },
    effectsOn,
  }
}

/** The engine's piano settings derived from the state (To Rotary comes from each layer's Amp model). */
export function pianoSettingsFor(state: InstrumentState): PianoSettings {
  const { focus: _focus, ...piano } = state.piano
  return {
    ...piano,
    layers: {
      A: { ...piano.layers.A, toRotary: state.effects.chains.pianoA.amp.on && state.effects.chains.pianoA.amp.model === AMP_MODEL_TO_ROTARY },
      B: { ...piano.layers.B, toRotary: state.effects.chains.pianoB.amp.on && state.effects.chains.pianoB.amp.model === AMP_MODEL_TO_ROTARY },
    },
  }
}

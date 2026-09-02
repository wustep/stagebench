/**
 * Canonical instrument state. The PROGRAM part (src/state/programState.ts: piano, organ, synth, effects, rotary,
 * split, zones, scenes, morph, clock, transpose, name) is what Store writes and Load restores; the rest is runtime
 * (Master Level, Shift latch, the bank of 32 + 8 Live programs, the display view, morph sources, undo). Panel controls
 * are mapped onto this state by src/audio/instrumentController.ts, and the state is what the engine and DSP receive.
 */
import { defaultPianoSettings, type LayerId, type PianoSettings } from '../audio/engine'
import { KEY_CLICK_LEVEL, type OrganParams } from '../dsp/organTypes'
import { LFO_SUBDIVISIONS, subdivisionFromKnob, subdivisionSeconds, type ClockSubdivision, type SynthLayerId, type SynthLayerParams } from '../dsp/synthTypes'
import { clamp, tempoKnobToSeconds, type ChainParams, type RotaryParams } from '../dsp/types'
import { createFactoryBank } from './factoryPrograms'
import { cloneProgram, programOf, programsEqual, type MorphSource, type ProgramState, type SplitPointKey } from './programState'
import { createStore, type Store } from './store'

export type FocusSection = 'organ' | 'piano' | 'synth'
export type ChainKey = 'pianoA' | 'pianoB' | 'organ' | 'synthA' | 'synthB' | 'synthC'
export const PIANO_CHAIN_KEYS: Record<LayerId, ChainKey> = { A: 'pianoA', B: 'pianoB' }
export const SYNTH_CHAIN_KEYS: Record<SynthLayerId, ChainKey> = { A: 'synthA', B: 'synthB', C: 'synthC' }
export const ALL_CHAIN_KEYS: readonly ChainKey[] = ['pianoA', 'pianoB', 'organ', 'synthA', 'synthB', 'synthC']
export const CHAIN_LABEL: Record<ChainKey, string> = { pianoA: 'Piano A', pianoB: 'Piano B', organ: 'Organ', synthA: 'Synth A', synthB: 'Synth B', synthC: 'Synth C' }

export interface Mod1Settings {
  on: boolean
  type: number
  rate: number
  amount: number
  /** Master Clock sync: the Rate knob selects a subdivision (manual p. 49). */
  sync: boolean
}
export interface Mod2Settings {
  on: boolean
  type: number
  rate: number
  amount: number
}
export interface DelaySettings {
  on: boolean
  /** Tempo knob position 0..10 (kept in sync with `seconds` while free-running). */
  tempo: number
  seconds: number
  feedback: number
  dryWet: number
  filter: number
  pingPong: boolean
  /** Master Clock sync: the Tempo knob selects a subdivision (manual p. 51). */
  sync: boolean
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
  synthGroup: boolean
  global: Record<'delay' | 'comp' | 'reverb', boolean>
  chains: Record<ChainKey, ChainSettings>
}

/** Delay Master Clock subdivisions (manual p. 51): 1/2 .. 1/32 with dotted (D) and triplet (T) options. */
export const DELAY_SUBDIVISIONS: readonly ClockSubdivision[] = [
  { label: '1/2', beats: 2 },
  { label: '1/4D', beats: 1.5 },
  { label: '1/4', beats: 1 },
  { label: '1/4T', beats: 2 / 3 },
  { label: '1/8D', beats: 0.75 },
  { label: '1/8', beats: 0.5 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/16D', beats: 0.375 },
  { label: '1/16', beats: 0.25 },
  { label: '1/16T', beats: 1 / 6 },
  { label: '1/32', beats: 0.125 },
]

export type ViewMode = 'program' | 'list' | 'store' | 'storeAs' | 'split' | 'clock' | 'transpose' | 'undo'
/** Which parameter page the Synth display shows (the red-framed buttons open them; manual p. 27). */
export type SynthPage = 'wave' | 'pitch' | 'oscEnv' | 'filterType' | 'filterEnv' | 'ampEnv' | 'lfoWave' | 'arpMenu' | 'vibratoMenu'
export interface ViewState {
  mode: ViewMode
  synthPage: SynthPage
  /** The edited program waiting to be stored while the destination is auditioned (manual p. 40). */
  pending: ProgramState | null
  /** Where the pending program came from (restored on cancel). */
  storeOrigin: { live: boolean; slot: number } | null
  /** List view cursor (0..31). */
  listIndex: number
  /** Store destination while a Store is pending. */
  store: { live: boolean; slot: number } | null
  /** Store As naming buffer. */
  naming: { name: string; cursor: number; charMode: boolean } | null
  /** Keyboard Split page state. */
  splitPoint: SplitPointKey
  splitRow: 'note' | 'xfade'
  /** SET KEY (Shift + Split): the next played key sets the selected split point. */
  setKeyArmed: boolean
  /** Parameter hint shown in the lower half of the Program display after a panel edit. */
  hint: string | null
}
export interface BankState {
  programs: ProgramState[]
  live: ProgramState[]
  /** Loaded program slot 0..31 (page × 8 + button). */
  slot: number
  /** Loaded Live slot 0..7. */
  liveSlot: number
  liveMode: boolean
  /** Page shown on the program buttons 0..3. */
  page: number
}

export interface InstrumentState extends ProgramState {
  master: { level: number }
  /** Shift latch: the next panel button press gets its Shift function. */
  shiftArmed: boolean
  delayTaps: number[]
  clockTaps: number[]
  bank: BankState
  view: ViewState
  /** Live morph source positions (mod wheel, control pedal) 0..1. */
  morphSources: Record<MorphSource, number>
  morphArmed: { source: MorphSource | null; latched: boolean }
  /** The edited program discarded by the last program change (Shift + Solo = UNDO restores it). */
  undo: { program: ProgramState; slot: number; live: boolean } | null
}

/** Panel defaults mirror src/hardware/controls.ts initial values. */
export function defaultChainSettings(): ChainSettings {
  return {
    mod1: { on: false, type: 5, rate: 4, amount: 5, sync: false },
    mod2: { on: false, type: 0, rate: 3, amount: 6 },
    delay: { on: false, tempo: 5, seconds: tempoKnobToSeconds(5), feedback: 6, dryWet: 4, filter: 3, pingPong: false, sync: false },
    amp: { on: false, model: 3, drive: 3, bass: 0, mid: 0, midFreq: 5, treble: 0 },
    comp: { on: false, amount: 5, fast: false },
    reverb: { on: true, type: 5, dryWet: 6, tone: 0 },
  }
}

export function defaultEffectsState(): EffectsState {
  return {
    on: true,
    focus: 'piano',
    pianoGroup: false,
    synthGroup: false,
    global: { delay: false, comp: false, reverb: false },
    chains: { pianoA: defaultChainSettings(), pianoB: defaultChainSettings(), organ: defaultChainSettings(), synthA: defaultChainSettings(), synthB: defaultChainSettings(), synthC: defaultChainSettings() },
  }
}

export function defaultView(): ViewState {
  return { mode: 'program', synthPage: 'wave', pending: null, storeOrigin: null, listIndex: 0, store: null, naming: null, splitPoint: 'mid', splitRow: 'note', setKeyArmed: false, hint: null }
}

export interface InitialStateOptions {
  /** Restored bank (Live persistence); defaults to the factory bank. */
  bank?: { programs: ProgramState[]; live: ProgramState[] }
}

export function initialInstrumentState(library: boolean, options: InitialStateOptions = {}): InstrumentState {
  const factory = createFactoryBank(library)
  const programs = options.bank?.programs ?? factory.programs
  const live = options.bank?.live ?? factory.live
  const program = cloneProgram(programs[0])
  return {
    ...program,
    piano: { ...defaultPianoSettings(library), ...program.piano },
    master: { level: 7 },
    shiftArmed: false,
    delayTaps: [],
    clockTaps: [],
    bank: { programs, live, slot: 0, liveSlot: 0, liveMode: false, page: 0 },
    view: defaultView(),
    morphSources: { wheel: 0, pedal: 0 },
    morphArmed: { source: null, latched: false },
    undo: null,
  }
}

export type InstrumentStore = Store<InstrumentState>

export function createInstrumentStore(library: boolean, options: InitialStateOptions = {}): InstrumentStore {
  return createStore(initialInstrumentState(library, options))
}

/** Replaces every program key at once (edit-discard, manual p. 13) and leaves the runtime untouched. */
export function withProgram(state: InstrumentState, program: ProgramState): InstrumentState {
  return { ...state, ...cloneProgram(program) }
}

/** The stored program the current one is compared against (Live slot or bank slot). */
export function storedProgram(state: InstrumentState): ProgramState {
  return state.bank.liveMode ? state.bank.live[state.bank.liveSlot] : state.bank.programs[state.bank.slot]
}

/** The E indicator: an edited (unstored) program. Live programs auto-store, so they are never dirty. */
export function isDirty(state: InstrumentState): boolean {
  if (state.bank.liveMode) return false
  return !programsEqual(programOf(state), storedProgram(state))
}

/** Which chain the effects panel is showing / editing. */
export function focusedChainKey(state: ProgramState): ChainKey {
  if (state.effects.focus === 'piano') return PIANO_CHAIN_KEYS[state.piano.focus]
  if (state.effects.focus === 'synth') return SYNTH_CHAIN_KEYS[state.synth.focus]
  return 'organ'
}

/** Chains an edit of `unit` must reach, honouring global and group modes. */
export function targetChainKeys(state: ProgramState, unit: UnitKey): ChainKey[] {
  if ((unit === 'delay' || unit === 'comp' || unit === 'reverb') && state.effects.global[unit]) return [...ALL_CHAIN_KEYS]
  if (state.effects.focus === 'piano') return state.effects.pianoGroup ? ['pianoA', 'pianoB'] : [PIANO_CHAIN_KEYS[state.piano.focus]]
  if (state.effects.focus === 'synth') return state.effects.synthGroup ? ['synthA', 'synthB', 'synthC'] : [SYNTH_CHAIN_KEYS[state.synth.focus]]
  return ['organ']
}

/** Delay time in seconds for a chain: the knob mapping, or the Master Clock subdivision when synced. */
export function delaySecondsFor(delay: DelaySettings, bpm: number): number {
  if (!delay.sync) return delay.seconds
  return clamp(subdivisionSeconds(subdivisionFromKnob(DELAY_SUBDIVISIONS, delay.tempo), bpm), 0.02, 1.5)
}

/** Mod 1 LFO rate in Hz when synced to the Master Clock (null = free-running knob mapping). */
export function mod1RateHzFor(mod1: Mod1Settings, bpm: number): number | null {
  if (!mod1.sync) return null
  return 1 / subdivisionSeconds(subdivisionFromKnob(LFO_SUBDIVISIONS, mod1.rate), bpm)
}

/** Converts panel chain settings to the DSP chain parameters (Timbre / String Res are set by the engine). */
export function chainParamsFor(chain: ChainSettings, effectsOn: boolean, bpm = 120): Omit<ChainParams, 'timbre' | 'stringRes'> {
  return {
    mod1: { on: chain.mod1.on, type: chain.mod1.type, rate: chain.mod1.rate, amount: chain.mod1.amount, rateHz: mod1RateHzFor(chain.mod1, bpm) },
    mod2: { on: chain.mod2.on, type: chain.mod2.type, rate: chain.mod2.rate, amount: chain.mod2.amount },
    delay: { on: chain.delay.on, seconds: delaySecondsFor(chain.delay, bpm), feedback: chain.delay.feedback, dryWet: chain.delay.dryWet, filter: chain.delay.filter, pingPong: chain.delay.pingPong },
    ampEq: { on: chain.amp.on, model: chain.amp.model, drive: chain.amp.drive, bass: chain.amp.bass, mid: chain.amp.mid, midFreq: chain.amp.midFreq, treble: chain.amp.treble },
    compressor: { on: chain.comp.on, amount: chain.comp.amount, fast: chain.comp.fast },
    reverb: { on: chain.reverb.on, type: chain.reverb.type, dryWet: chain.reverb.dryWet, tone: chain.reverb.tone },
    effectsOn,
  }
}

/** The engine's piano settings derived from the (effective) program (To Rotary comes from each layer's Amp model). */
export function pianoSettingsFor(state: ProgramState): PianoSettings {
  const { focus: _focus, ...piano } = state.piano
  return {
    ...piano,
    layers: {
      A: { ...piano.layers.A, toRotary: state.effects.chains.pianoA.amp.on && state.effects.chains.pianoA.amp.model === AMP_MODEL_TO_ROTARY },
      B: { ...piano.layers.B, toRotary: state.effects.chains.pianoB.amp.on && state.effects.chains.pianoB.amp.model === AMP_MODEL_TO_ROTARY },
    },
  }
}

/** The organ processor parameters derived from the (effective) program. */
export function organParamsFor(state: ProgramState, pitchBend: number): OrganParams {
  const o = state.organ
  const layer = (id: LayerId) => ({ on: o.layers[id].on, model: o.layers[id].model, drawbars: [...o.layers[id].drawbars], level: o.layers[id].level, octave: o.layers[id].octave, vibrato: o.layers[id].vibrato, sustped: o.layers[id].sustped, pstick: o.layers[id].pstick })
  return { on: o.on, layers: { A: layer('A'), B: layer('B') }, vibratoMode: o.vibratoMode, percussion: { ...o.percussion }, keyClick: KEY_CLICK_LEVEL, pitchBend }
}

/** One synth layer's processor parameters derived from the (effective) program plus the live performance inputs. */
export function synthParamsFor(state: ProgramState, layer: SynthLayerId, live: { wheel: number; pedal: number; pitchBend: number }): SynthLayerParams {
  const l = state.synth.layers[layer]
  return { ...l, on: state.synth.on && l.on, arp: { ...l.arp, kbHold: state.synth.kbHold }, bpm: state.clock.bpm, wheel: live.wheel, pedal: live.pedal, pitchBend: live.pitchBend, sustped: state.synth.sustped }
}

export function rotaryParamsFor(state: ProgramState): RotaryParams {
  return { fast: state.rotary.speed >= 0.5, speed: state.rotary.speed, stop: state.rotary.stop, drive: state.rotary.drive }
}

/** Is a synth layer routed into the shared rotary (To Rotary on its Amp Sim/EQ)? */
export function synthToRotary(state: ProgramState, layer: SynthLayerId): boolean {
  const chain = state.effects.chains[SYNTH_CHAIN_KEYS[layer]]
  return chain.amp.on && chain.amp.model === AMP_MODEL_TO_ROTARY
}

import { useSyncExternalStore } from 'react'
import { INSTRUMENTS, instrumentsOfType, PIANO_TYPES, type PianoType } from '../audio/library'
import {
  activeSplitPoints,
  ARP_DIRECTIONS,
  ARP_MODES,
  chainForFocus,
  CHAIN_IDS,
  CLOCK_BPM_MAX,
  CLOCK_BPM_MIN,
  CROSSFADE_WIDTHS,
  deepClone,
  deepEqual,
  defaultMorphState,
  defaultOrganState,
  defaultSceneState,
  defaultSplitState,
  defaultSynthState,
  defaultZoneAssignments,
  layerLetter,
  layerSection,
  LFO_DESTINATIONS,
  LFO_WAVES,
  morphPathKey,
  ORGAN_MODELS,
  SPLIT_POINT_IDS,
  SPLIT_POSITIONS,
  stepZoneRange,
  SYNTH_CATEGORIES,
  SYNTH_FILTER_TYPES,
  SYNTH_WAVEFORMS,
  VIBRATO_CHORUS_MODES,
  type ChainId,
  type FxFocus,
  type LayerKey,
  type MorphAssignment,
  type MorphPath,
  type MorphSource,
  type MorphState,
  type OrganLayerId,
  type OrganState,
  type SceneId,
  type SceneState,
  type SectionKey,
  type SplitPointId,
  type SplitState,
  type SynthLayerId,
  type SynthState,
  type TransposeState,
  type ZoneAssignments,
} from './program-types'

/**
 * Canonical instrument state (Phase 3): the complete serializable program —
 * Piano, Organ and Synth engines, six effect chains, splits/zones, scenes,
 * morphs, master clock and transpose — plus the program system itself
 * (32 slots, 8 auto-storing Live slots, Store/Store As, dirty tracking).
 *
 * Honesty contract: everything in this store is REAL — the audio engine
 * subscribes to it and every field either audibly changes the signal graph
 * or truthfully reports why it cannot (e.g. "Piano not found").
 */

export type LayerId = 'A' | 'B'

export type Mod1Type = 'A-Pan' | 'Tremolo' | 'Ring Mod' | 'A-Wah' | 'Wah' | 'Pump'
export type Mod2Type = 'Phaser' | 'Flanger' | 'Vibe' | 'Chorus' | 'Ensemble' | 'Spin'
export type AmpType = 'Neutral EQ' | 'Twin' | 'JC' | 'Small' | 'LP24 Filter' | 'HP24 Filter' | 'To Rotary'
export type ReverbType = 'Room' | 'Stage' | 'Booth' | 'Hall' | 'Spring' | 'Cathedral'
export type DelayFilter = 'Off' | 'Low Pass' | 'High Pass' | 'Band Pass'
export type DelayEffect = 'Off' | 'Chorus' | 'Vibe' | 'Ensemble' | 'Flam' | 'Space'
export type RotarySpeed = 'slow' | 'fast' | 'stop'

export const MOD1_TYPES: readonly Mod1Type[] = ['A-Pan', 'Tremolo', 'Ring Mod', 'A-Wah', 'Wah', 'Pump']
export const MOD2_TYPES: readonly Mod2Type[] = ['Phaser', 'Flanger', 'Vibe', 'Chorus', 'Ensemble', 'Spin']
export const AMP_TYPES: readonly AmpType[] = ['Neutral EQ', 'Twin', 'JC', 'Small', 'LP24 Filter', 'HP24 Filter', 'To Rotary']
export const REVERB_TYPES: readonly ReverbType[] = ['Room', 'Stage', 'Booth', 'Hall', 'Spring', 'Cathedral']
export const DELAY_FILTERS: readonly DelayFilter[] = ['Off', 'Low Pass', 'High Pass', 'Band Pass']
export const DELAY_EFFECTS: readonly DelayEffect[] = ['Off', 'Chorus', 'Vibe', 'Ensemble', 'Flam', 'Space']

export interface Mod1State { on: boolean; type: Mod1Type; rate: number; amount: number; clockSync: boolean }
export interface Mod2State { on: boolean; type: Mod2Type; rate: number; amount: number }
export interface DelayState {
  on: boolean
  tempo: number // 0..127 -> 20..1400 ms (or a clock subdivision when clockSync)
  feedback: number // 0..127
  mix: number // 0..127 dry..wet
  filter: DelayFilter
  effect: DelayEffect
  analog: boolean
  clockSync: boolean
}
export interface AmpEqState {
  on: boolean
  type: AmpType
  drive: number
  bass: number
  mid: number
  treble: number
  freq: number // mid frequency / filter cutoff, 0..127
}
export interface CompState { on: boolean; amount: number; fast: boolean }
export interface ReverbState { on: boolean; type: ReverbType; mix: number; bright: boolean }

export interface EffectChainState {
  mod1: Mod1State
  mod2: Mod2State
  delay: DelayState
  ampEq: AmpEqState
  comp: CompState
  reverb: ReverbState
}

export interface PianoLayerState {
  enabled: boolean
  level: number // 0..127
  octave: -1 | 0 | 1
  type: PianoType
  /** Index into instrumentsOfType(type); selection of an unpopulated type keeps the previous audible instrument. */
  model: number
}

export interface PianoSharedState {
  sectionOn: boolean
  kbTouch: 0 | 1 | 2 // Heavy, Mid, Light
  dynComp: 0 | 1 | 2 | 3
  timbre: number // index into the timbre list for the focused layer's family
  unison: 0 | 1 | 2 | 3
  softRelease: boolean
  stringRes: boolean
  pedNoise: boolean
}

export interface RotaryState {
  speed: RotarySpeed
  drive: number
  /** Continuous 0..1 morph override of slow↔fast rotor rate (null = follow `speed`). */
  morph: number | null
}

/* ----------------------------------------------------------- program data -- */

export interface ProgramSlotRef {
  bank: 'program' | 'live'
  index: number
}

export type StoreFlow =
  | { step: 'naming'; name: string; cursor: number; snapshot: ProgramData; origin: ProgramSlotRef }
  | { step: 'destination'; snapshot: ProgramData; origin: ProgramSlotRef; destination: ProgramSlotRef }

export interface ProgramsState {
  slots: ProgramData[] // 32 (4 pages x 8)
  live: ProgramData[] // 8 auto-storing Live slots
  current: ProgramSlotRef
  liveMode: boolean
  page: number // 0..3, program-button page
  storeFlow: StoreFlow | null
  /** Numeric list view cursor (Shift + Program dial), or null when the list is closed. */
  listCursor: number | null
  splitEdit: SplitPointId | null
  clockSet: boolean
  transposeSet: boolean
  undo: { slot: ProgramSlotRef; data: ProgramData } | null
}

/** Everything a program slot stores. Master Level is deliberately excluded (programs spec). */
export interface ProgramData {
  version: 1
  name: string
  piano: PianoSharedState
  pianoLayers: Record<LayerId, PianoLayerState>
  organ: OrganState
  synth: SynthState
  chains: Record<ChainId, EffectChainState>
  fxGroupPiano: boolean
  fxGroupSynth: boolean
  allFxOff: boolean
  fxGlobal: { delay: boolean; comp: boolean; reverb: boolean }
  rotary: { speed: RotarySpeed; drive: number }
  split: SplitState
  zones: ZoneAssignments
  scenes: SceneState
  morphs: MorphState
  clockBpm: number
  transpose: TransposeState
}

export interface InstrumentState {
  masterVolume: number // 0..127 — performance control, NOT program state
  piano: PianoSharedState
  layers: Record<LayerId, PianoLayerState>
  focusedLayer: LayerId
  organ: OrganState
  synth: SynthState
  /** Which section/layer the Layer Effects panel edits. */
  fxFocus: FxFocus
  /** When true (Group mode), effect edits apply to both piano layer chains. */
  fxGroupPiano: boolean
  /** When true, effect edits apply to all three synth chains. */
  fxGroupSynth: boolean
  allFxOff: boolean
  chains: Record<ChainId, EffectChainState>
  fxGlobal: { delay: boolean; comp: boolean; reverb: boolean }
  rotary: RotaryState
  split: SplitState
  zones: ZoneAssignments
  scenes: SceneState
  morphs: MorphState
  /** Live morph source positions 0..1 (wheel; control pedal via UI or MIDI CC11). */
  morphValues: Record<MorphSource, number>
  /** Latched morph-assign capture mode, or null. */
  morphCapture: MorphSource | null
  clockBpm: number
  transpose: TransposeState
  programs: ProgramsState
  programName: string
  /** Solo listen mode: only this section sounds (optional feature; null = off). */
  solo: SectionKey | null
  /** Truthful last-edit readout shown on the Program display. */
  lastEdit: string
  /** Set when a Clav/Digital/Misc type with no bundled model is selected. */
  pianoNotFound: PianoType | null
}

export const ACOUSTIC_TIMBRES = ['Off', 'Soft', 'Mid', 'Bright'] as const
export const ELECTRIC_TIMBRES = ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'] as const

export function timbreListFor(type: PianoType): readonly string[] {
  return type === 'Electric' ? ELECTRIC_TIMBRES : ACOUSTIC_TIMBRES
}

function defaultChain(): EffectChainState {
  // Continuous defaults match the panel's initial knob pose (64 = 12 o'clock).
  return {
    mod1: { on: false, type: 'Tremolo', rate: 64, amount: 64, clockSync: false },
    mod2: { on: false, type: 'Chorus', rate: 64, amount: 64 },
    delay: { on: false, tempo: 64, feedback: 64, mix: 64, filter: 'Off', effect: 'Off', analog: false, clockSync: false },
    ampEq: { on: false, type: 'Neutral EQ', drive: 64, bass: 64, mid: 64, treble: 64, freq: 64 },
    comp: { on: false, amount: 64, fast: false },
    reverb: { on: false, type: 'Hall', mix: 64, bright: true },
  }
}

function defaultChains(): Record<ChainId, EffectChainState> {
  const chains = {} as Record<ChainId, EffectChainState>
  for (const id of CHAIN_IDS) chains[id] = defaultChain()
  return chains
}

/** All non-program state plus program-scoped defaults, without the program slots themselves. */
function baseState(): Omit<InstrumentState, 'programs'> {
  const enables: Record<LayerKey, boolean> = {
    pianoA: true,
    pianoB: false,
    organA: false,
    organB: false,
    synthA: false,
    synthB: false,
    synthC: false,
  }
  return {
    masterVolume: 100,
    piano: {
      sectionOn: true,
      kbTouch: 0,
      dynComp: 0,
      timbre: 0,
      unison: 0,
      softRelease: false,
      stringRes: false,
      pedNoise: false,
    },
    layers: {
      A: { enabled: true, level: 100, octave: 0, type: 'Grand', model: 0 },
      B: { enabled: false, level: 100, octave: 0, type: 'Electric', model: 0 },
    },
    focusedLayer: 'A',
    organ: defaultOrganState(),
    synth: defaultSynthState(),
    fxFocus: { section: 'piano', layer: 'A' },
    fxGroupPiano: false,
    fxGroupSynth: false,
    allFxOff: false,
    chains: defaultChains(),
    fxGlobal: { delay: false, comp: false, reverb: false },
    rotary: { speed: 'slow', drive: 64, morph: null },
    split: defaultSplitState(),
    zones: defaultZoneAssignments(),
    scenes: defaultSceneState(enables),
    morphs: defaultMorphState(),
    morphValues: { wheel: 0, pedal: 0 },
    morphCapture: null,
    clockBpm: 120,
    transpose: { on: false, semitones: 0 },
    programName: 'Royal Grand',
    solo: null,
    lastEdit: '',
    pianoNotFound: null,
  }
}

/* ------------------------------------------------------- (de)serialization -- */

type ProgramScope = Omit<InstrumentState, 'programs'>

/** Serializes the current edit buffer into slot data. Focus fields are normalized out (they are UI state, not program state). */
export function serializeProgram(state: ProgramScope): ProgramData {
  const organ = deepClone(state.organ)
  organ.focusedLayer = 'A'
  const synth = deepClone(state.synth)
  synth.focusedLayer = 'A'
  return {
    version: 1,
    name: state.programName,
    piano: deepClone(state.piano),
    pianoLayers: deepClone(state.layers),
    organ,
    synth,
    chains: deepClone(state.chains),
    fxGroupPiano: state.fxGroupPiano,
    fxGroupSynth: state.fxGroupSynth,
    allFxOff: state.allFxOff,
    fxGlobal: deepClone(state.fxGlobal),
    rotary: { speed: state.rotary.speed, drive: state.rotary.drive },
    split: deepClone(state.split),
    zones: deepClone(state.zones),
    scenes: deepClone(state.scenes),
    morphs: deepClone(state.morphs),
    clockBpm: state.clockBpm,
    transpose: deepClone(state.transpose),
  }
}

/** Loads slot data into the edit buffer, preserving non-program state (master volume, focus, live input). */
export function applyProgram(state: InstrumentState, data: ProgramData): InstrumentState {
  const clone = deepClone(data)
  return {
    ...state,
    piano: clone.piano,
    layers: clone.pianoLayers,
    organ: { ...clone.organ, focusedLayer: state.organ.focusedLayer },
    synth: { ...clone.synth, focusedLayer: state.synth.focusedLayer },
    chains: clone.chains,
    fxGroupPiano: clone.fxGroupPiano,
    fxGroupSynth: clone.fxGroupSynth,
    allFxOff: clone.allFxOff,
    fxGlobal: clone.fxGlobal,
    rotary: { ...clone.rotary, morph: null },
    split: clone.split,
    zones: clone.zones,
    scenes: clone.scenes,
    morphs: clone.morphs,
    clockBpm: clone.clockBpm,
    transpose: clone.transpose,
    programName: clone.name,
    pianoNotFound: null,
  }
}

/* --------------------------------------------------------- factory programs -- */

function tweaked(name: string, tweak: (s: ProgramScope) => void): ProgramData {
  const scratch = baseState()
  scratch.programName = name
  tweak(scratch)
  // Keep scene I in step with the tweaked enable flags.
  const enables = scratch.scenes.enables[scratch.scenes.active]
  enables.pianoA = scratch.layers.A.enabled
  enables.pianoB = scratch.layers.B.enabled
  enables.organA = scratch.organ.layers.A.enabled
  enables.organB = scratch.organ.layers.B.enabled
  enables.synthA = scratch.synth.layers.A.enabled
  enables.synthB = scratch.synth.layers.B.enabled
  enables.synthC = scratch.synth.layers.C.enabled
  return serializeProgram(scratch)
}

/** At least 8 factory programs demonstrating piano, organ, synth, split and layered setups (programs spec, storage.factoryContent). */
export function factoryPrograms(): ProgramData[] {
  const programs: ProgramData[] = [
    tweaked('Royal Grand', () => undefined),
    tweaked('Tine Stack', (s) => {
      s.layers.B.enabled = true
      s.layers.B.level = 88
      s.chains.B.mod2 = { on: true, type: 'Chorus', rate: 48, amount: 72 }
      s.chains.B.reverb = { on: true, type: 'Stage', mix: 52, bright: true }
    }),
    tweaked('Gospel B3', (s) => {
      s.layers.A.enabled = false
      s.organ.layers.A.enabled = true
      s.organ.layers.A.model = 'B3'
      s.organ.layers.A.drawbars = [8, 8, 8, 8, 0, 0, 0, 0, 0]
      s.organ.layers.A.vibratoOn = true
      s.organ.percussion = { on: true, soft: false, fast: false, third: true }
      s.organ.toRotary = true
      s.rotary.drive = 80
    }),
    tweaked('Continental', (s) => {
      s.layers.A.enabled = false
      s.organ.layers.A.enabled = true
      s.organ.layers.A.model = 'Vox'
      s.organ.layers.A.drawbars = [8, 6, 8, 4, 0, 0, 6, 0, 8]
      s.organ.layers.A.vibratoOn = true
      s.organ.vibratoMode = 'V2'
      s.chains.organ.reverb = { on: true, type: 'Room', mix: 40, bright: true }
    }),
    tweaked('Cathedral Pipe', (s) => {
      s.layers.A.enabled = false
      s.organ.layers.A.enabled = true
      s.organ.layers.A.model = 'Pipe 1'
      s.organ.layers.A.drawbars = [8, 0, 8, 6, 0, 4, 0, 0, 2]
      s.chains.organ.reverb = { on: true, type: 'Cathedral', mix: 84, bright: false }
    }),
    tweaked('Super Lead', (s) => {
      s.layers.A.enabled = false
      s.synth.layers.A.enabled = true
      s.synth.layers.A.category = 'Super'
      s.synth.layers.A.wave = 0
      s.synth.layers.A.oscCtrl = 84
      s.synth.layers.A.filter.freq = 104
      s.synth.layers.A.voice = { ...s.synth.layers.A.voice, mode: 'Mono', glide: 40, unison: 2 }
      s.chains.synthA.delay = { on: true, tempo: 58, feedback: 48, mix: 42, filter: 'Off', effect: 'Off', analog: false, clockSync: false }
    }),
    tweaked('FM Keys', (s) => {
      s.synth.layers.A.enabled = true
      s.synth.layers.A.category = 'FM-H'
      s.synth.layers.A.wave = 0
      s.synth.layers.A.oscCtrl = 58
      s.synth.layers.A.level = 84
      s.synth.layers.A.ampEnv = { attack: 0, decay: 88, release: 30, velocity: 2 }
      s.chains.synthA.reverb = { on: true, type: 'Hall', mix: 46, bright: true }
    }),
    tweaked('Split Stage', (s) => {
      s.split.on = true
      s.split.points.mid = { active: true, position: 4, xfade: 6 } // C4, ±6 crossfade
      s.organ.layers.A.enabled = true
      s.organ.layers.A.model = 'B3 Bass'
      s.organ.layers.A.drawbars = [8, 0, 6, 0, 0, 0, 0, 0, 0]
      s.zones.organA = { from: 0, to: 0 }
      s.zones.pianoA = { from: 1, to: 3 }
    }),
    tweaked('Scene Pad', (s) => {
      s.layers.A.enabled = true
      s.synth.layers.B.enabled = true
      s.synth.layers.B.category = 'Multi'
      s.synth.layers.B.wave = 0
      s.synth.layers.B.ampEnv = { attack: 72, decay: 127, release: 84, velocity: 0 }
      s.synth.layers.B.filter.freq = 70
      s.scenes.enables.II = { ...s.scenes.enables.I, pianoA: false, synthB: true }
      s.morphs.wheel = [{ path: { kind: 'synth', layer: 'B', param: 'filterFreq' }, from: 70, to: 120 }]
    }),
  ]
  while (programs.length < 32) programs.push(tweaked('Init', () => undefined))
  return programs
}

function factoryLive(): ProgramData[] {
  return Array.from({ length: 8 }, () => tweaked('Live Init', () => undefined))
}

export function initialInstrumentState(): InstrumentState {
  return {
    ...baseState(),
    programs: {
      slots: factoryPrograms(),
      live: factoryLive(),
      current: { bank: 'program', index: 0 },
      liveMode: false,
      page: 0,
      storeFlow: null,
      listCursor: null,
      splitEdit: null,
      clockSet: false,
      transposeSet: false,
      undo: null,
    },
  }
}

export function selectedInstrumentId(layer: PianoLayerState): string | null {
  const models = instrumentsOfType(layer.type)
  return models[layer.model]?.id ?? null
}

/** True when the edit buffer differs from the stored current slot (the truthful E indicator). */
export function isProgramDirty(state: InstrumentState): boolean {
  const { current } = state.programs
  const stored = current.bank === 'live' ? state.programs.live[current.index] : state.programs.slots[current.index]
  if (!stored) return false
  return !deepEqual(serializeProgram(state), stored)
}

export function slotLabel(ref: ProgramSlotRef): string {
  return ref.bank === 'live' ? `L${ref.index + 1}` : `${Math.floor(ref.index / 8) + 1}.${(ref.index % 8) + 1}`
}

/* ------------------------------------------------------- morph application -- */

function assignmentValue(assignment: MorphAssignment, position: number): number {
  return assignment.from + (assignment.to - assignment.from) * position
}

/**
 * Returns the state with all morph assignments applied at the current source
 * positions. The engine renders from this EFFECTIVE state; base values (what
 * the program stores) stay untouched.
 */
export function morphedState(state: InstrumentState): InstrumentState {
  const anyAssignments = state.morphs.wheel.length > 0 || state.morphs.pedal.length > 0
  if (!anyAssignments) return state
  const next = {
    ...state,
    layers: deepClone(state.layers),
    organ: deepClone(state.organ),
    synth: deepClone(state.synth),
    chains: deepClone(state.chains),
    rotary: { ...state.rotary },
  }
  for (const source of ['wheel', 'pedal'] as const) {
    const position = state.morphValues[source]
    for (const assignment of state.morphs[source]) {
      const value = assignmentValue(assignment, position)
      const path = assignment.path
      switch (path.kind) {
        case 'layerLevel': {
          const section = layerSection(path.layer)
          const letter = layerLetter(path.layer)
          if (section === 'piano') next.layers[letter as LayerId].level = clamp(value)
          else if (section === 'organ') next.organ.layers[letter as OrganLayerId].level = clamp(value)
          else next.synth.layers[letter as SynthLayerId].level = clamp(value)
          break
        }
        case 'drawbar': {
          const drawbars = next.organ.layers[path.layer].drawbars
          drawbars[path.index] = Math.max(0, Math.min(8, Math.round(value)))
          break
        }
        case 'rotarySpeed':
          next.rotary.morph = Math.max(0, Math.min(1, value / 127))
          break
        case 'synth': {
          const layer = next.synth.layers[path.layer]
          if (path.param === 'lfoRate') layer.lfo.rate = clamp(value)
          else if (path.param === 'lfoAmount') layer.lfo.amount = clamp(value)
          else if (path.param === 'oscCtrl') layer.oscCtrl = clamp(value)
          else if (path.param === 'filterFreq') layer.filter.freq = clamp(value)
          else if (path.param === 'filterRes') layer.filter.res = clamp(value)
          else layer.arp.rate = clamp(value)
          break
        }
        case 'fx': {
          const chain = next.chains[path.chain]
          const [unit, param] = path.param.split('.') as [keyof EffectChainState, string]
          ;(chain[unit] as unknown as Record<string, number>)[param] = clamp(value)
          break
        }
      }
    }
  }
  return next
}

/** The effective (post-morph) value of a morphable path — for LED graphs and indicators. */
export function effectiveMorphValue(state: InstrumentState, path: MorphPath): number | null {
  const key = morphPathKey(path)
  for (const source of ['wheel', 'pedal'] as const) {
    const assignment = state.morphs[source].find((a) => morphPathKey(a.path) === key)
    if (assignment) return assignmentValue(assignment, state.morphValues[source])
  }
  return null
}

export function morphAssignmentFor(state: InstrumentState, path: MorphPath): { source: MorphSource; assignment: MorphAssignment } | null {
  const key = morphPathKey(path)
  for (const source of ['wheel', 'pedal'] as const) {
    const assignment = state.morphs[source].find((a) => morphPathKey(a.path) === key)
    if (assignment) return { source, assignment }
  }
  return null
}

/* ---------------------------------------------------------------- storage -- */

/** Injectable persistence for program slots (Live slots must survive reload). */
export interface ProgramStorage {
  load(): string | null
  save(value: string): void
}

export function localProgramStorage(key = 'stagebench.programs.v1'): ProgramStorage {
  return {
    load() {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    },
    save(value: string) {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        /* storage unavailable — programs stay in memory */
      }
    },
  }
}

type Listener = () => void

export interface InstrumentStoreOptions {
  storage?: ProgramStorage
}

export class InstrumentStore {
  private state: InstrumentState
  private listeners = new Set<Listener>()
  private storage: ProgramStorage | null

  constructor(options: InstrumentStoreOptions = {}) {
    this.storage = options.storage ?? null
    this.state = initialInstrumentState()
    this.restorePersisted()
  }

  private restorePersisted(): void {
    if (!this.storage) return
    const raw = this.storage.load()
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { slots?: ProgramData[]; live?: ProgramData[] }
      const slots = Array.isArray(parsed.slots) && parsed.slots.length === 32 ? parsed.slots : this.state.programs.slots
      const live = Array.isArray(parsed.live) && parsed.live.length === 8 ? parsed.live : this.state.programs.live
      this.state = { ...this.state, programs: { ...this.state.programs, slots, live } }
      this.state = applyProgram(this.state, slots[0]!)
    } catch {
      /* corrupt persisted data — keep factory content */
    }
  }

  private persist(): void {
    this.storage?.save(JSON.stringify({ slots: this.state.programs.slots, live: this.state.programs.live }))
  }

  getState = (): InstrumentState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private commit(next: InstrumentState): void {
    // Live Mode stores every edit automatically (programs spec, storage.liveMode).
    if (next.programs.liveMode && next.programs.current.bank === 'live' && !next.programs.storeFlow) {
      const data = serializeProgram(next)
      const existing = next.programs.live[next.programs.current.index]
      if (!existing || !deepEqual(data, existing)) {
        const live = [...next.programs.live]
        live[next.programs.current.index] = data
        next = { ...next, programs: { ...next.programs, live } }
        this.state = next
        this.persist()
        for (const listener of this.listeners) listener()
        return
      }
    }
    this.state = next
    for (const listener of this.listeners) listener()
  }

  private patch(partial: Partial<InstrumentState>, lastEdit?: string): void {
    this.commit({ ...this.state, ...partial, lastEdit: lastEdit ?? this.state.lastEdit })
  }

  setLastEdit(text: string): void {
    this.patch({}, text)
  }

  /* ------------------------------------------------------------ master -- */

  setMasterVolume(value: number): void {
    const clamped = clamp(value)
    this.patch({ masterVolume: clamped }, `Master Level ${clamped}`)
  }

  /* ------------------------------------------------------ layer helpers -- */

  /** Updates a layer's enabled flag and mirrors it into the active scene. */
  private withLayerEnabled(state: InstrumentState, key: LayerKey, enabled: boolean): InstrumentState {
    const scenes = deepClone(state.scenes)
    scenes.enables[scenes.active][key] = enabled
    const letter = layerLetter(key)
    const section = layerSection(key)
    if (section === 'piano') {
      const layers = { ...state.layers, [letter as LayerId]: { ...state.layers[letter as LayerId], enabled } }
      return { ...state, layers, scenes }
    }
    if (section === 'organ') {
      const organLayers = { ...state.organ.layers, [letter as OrganLayerId]: { ...state.organ.layers[letter as OrganLayerId], enabled } }
      return { ...state, organ: { ...state.organ, layers: organLayers }, scenes }
    }
    const synthLayers = { ...state.synth.layers, [letter as SynthLayerId]: { ...state.synth.layers[letter as SynthLayerId], enabled } }
    return { ...state, synth: { ...state.synth, layers: synthLayers }, scenes }
  }

  /* ------------------------------------------------------- piano layers -- */

  setLayerEnabled(layer: LayerId, enabled: boolean): void {
    let next = this.withLayerEnabled(this.state, layer === 'B' ? 'pianoB' : 'pianoA', enabled)
    // Focus follows the layer being switched on; focusing a disabled layer is allowed on hardware.
    if (enabled) next = { ...next, focusedLayer: layer, fxFocus: { section: 'piano', layer } }
    this.commit({ ...next, lastEdit: `Piano ${layer} ${enabled ? 'On' : 'Off'}` })
  }

  toggleLayerEnabled(layer: LayerId): void {
    this.setLayerEnabled(layer, !this.state.layers[layer].enabled)
  }

  setLayerLevel(layer: LayerId, level: number): void {
    const clamped = clamp(level)
    if (this.captureMorph({ kind: 'layerLevel', layer: layer === 'B' ? 'pianoB' : 'pianoA' }, this.state.layers[layer].level, clamped)) return
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], level: clamped } }
    this.patch({ layers }, `Piano ${layer} Level ${clamped}`)
  }

  setFocusedLayer(layer: LayerId): void {
    this.patch({ focusedLayer: layer, fxFocus: { section: 'piano', layer } }, `FX Focus Piano ${layer}`)
  }

  cycleFocusedLayer(): void {
    this.setFocusedLayer(this.state.focusedLayer === 'A' ? 'B' : 'A')
  }

  shiftOctave(layer: LayerId, delta: -1 | 1): void {
    const current = this.state.layers[layer].octave
    const next = Math.max(-1, Math.min(1, current + delta)) as -1 | 0 | 1
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], octave: next } }
    this.patch({ layers }, `Piano ${layer} Octave ${next > 0 ? `+${next}` : next}`)
  }

  setPianoSectionOn(on: boolean): void {
    this.patch({ piano: { ...this.state.piano, sectionOn: on }, fxFocus: { section: 'piano', layer: this.state.focusedLayer } }, `Piano Section ${on ? 'On' : 'Off'}`)
  }

  /* ---------------------------------------------------- piano selection -- */

  cyclePianoType(): void {
    const layer = this.state.focusedLayer
    const current = this.state.layers[layer].type
    const nextType = PIANO_TYPES[(PIANO_TYPES.indexOf(current) + 1) % PIANO_TYPES.length]!
    this.selectPianoType(nextType)
  }

  selectPianoType(type: PianoType): void {
    const layer = this.state.focusedLayer
    const populated = instrumentsOfType(type).length > 0
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], type, model: 0 } }
    this.patch(
      { layers, pianoNotFound: populated ? null : type },
      populated ? `Piano ${layer}: ${instrumentsOfType(type)[0]!.name}` : `Piano not found (${type})`,
    )
  }

  selectPianoModel(model: number): void {
    const layer = this.state.focusedLayer
    const models = instrumentsOfType(this.state.layers[layer].type)
    if (models.length === 0) return
    const clamped = Math.max(0, Math.min(models.length - 1, Math.round(model)))
    const layers = { ...this.state.layers, [layer]: { ...this.state.layers[layer], model: clamped } }
    this.patch({ layers, pianoNotFound: null }, `Piano ${layer}: ${models[clamped]!.name}`)
  }

  /* -------------------------------------------------- piano performance -- */

  cycleKbTouch(): void {
    const next = ((this.state.piano.kbTouch + 1) % 3) as 0 | 1 | 2
    this.patch({ piano: { ...this.state.piano, kbTouch: next } }, `KB Touch ${['Heavy', 'Mid', 'Light'][next]}`)
  }

  cycleDynComp(): void {
    const next = ((this.state.piano.dynComp + 1) % 4) as 0 | 1 | 2 | 3
    this.patch({ piano: { ...this.state.piano, dynComp: next } }, `Dyn Comp ${next === 0 ? 'Off' : next}`)
  }

  cycleTimbre(): void {
    const list = timbreListFor(this.state.layers[this.state.focusedLayer].type)
    const next = (this.state.piano.timbre + 1) % list.length
    this.patch({ piano: { ...this.state.piano, timbre: next } }, `Timbre ${list[next]}`)
  }

  cycleUnison(): void {
    const next = ((this.state.piano.unison + 1) % 4) as 0 | 1 | 2 | 3
    this.patch({ piano: { ...this.state.piano, unison: next } }, `Unison ${next === 0 ? 'Off' : next}`)
  }

  cycleAcoustics(): void {
    // One button steps through: none -> Soft Rel -> +String Res -> +Ped Noise -> none.
    const { softRelease, stringRes, pedNoise } = this.state.piano
    let next: Pick<PianoSharedState, 'softRelease' | 'stringRes' | 'pedNoise'>
    if (!softRelease && !stringRes) next = { softRelease: true, stringRes: false, pedNoise: false }
    else if (softRelease && !stringRes) next = { softRelease: true, stringRes: true, pedNoise: false }
    else if (!pedNoise) next = { softRelease: true, stringRes: true, pedNoise: true }
    else next = { softRelease: false, stringRes: false, pedNoise: false }
    const label = next.pedNoise
      ? 'Acoustics: SoftRel+StringRes+PedNoise'
      : next.stringRes
        ? 'Acoustics: SoftRel+StringRes'
        : next.softRelease
          ? 'Acoustics: Soft Release'
          : 'Acoustics: Off'
    this.patch({ piano: { ...this.state.piano, ...next } }, label)
  }

  /* -------------------------------------------------------------- organ -- */

  setOrganSectionOn(on: boolean): void {
    this.patch(
      { organ: { ...this.state.organ, sectionOn: on }, fxFocus: { section: 'organ', layer: this.state.organ.focusedLayer } },
      `Organ Section ${on ? 'On' : 'Off'}`,
    )
  }

  toggleOrganLayer(layer: OrganLayerId): void {
    const enabled = !this.state.organ.layers[layer].enabled
    let next = this.withLayerEnabled(this.state, layer === 'B' ? 'organB' : 'organA', enabled)
    next = { ...next, organ: { ...next.organ, focusedLayer: layer }, fxFocus: { section: 'organ', layer } }
    this.commit({ ...next, lastEdit: `Organ ${layer} ${enabled ? 'On' : 'Off'}` })
  }

  setOrganLevel(layer: OrganLayerId, level: number): void {
    const clamped = clamp(level)
    if (this.captureMorph({ kind: 'layerLevel', layer: layer === 'B' ? 'organB' : 'organA' }, this.state.organ.layers[layer].level, clamped)) return
    const layers = { ...this.state.organ.layers, [layer]: { ...this.state.organ.layers[layer], level: clamped } }
    this.patch({ organ: { ...this.state.organ, layers } }, `Organ ${layer} Level ${clamped}`)
  }

  cycleOrganModel(): void {
    const layer = this.state.organ.focusedLayer
    const current = this.state.organ.layers[layer].model
    const next = ORGAN_MODELS[(ORGAN_MODELS.indexOf(current) + 1) % ORGAN_MODELS.length]!
    const layers = { ...this.state.organ.layers, [layer]: { ...this.state.organ.layers[layer], model: next } }
    this.patch({ organ: { ...this.state.organ, layers } }, `Organ ${layer}: ${next}`)
  }

  setDrawbar(index: number, value: number): void {
    const layer = this.state.organ.focusedLayer
    const clamped = Math.max(0, Math.min(8, Math.round(value)))
    const current = this.state.organ.layers[layer].drawbars[index] ?? 0
    if (this.captureMorph({ kind: 'drawbar', layer, index }, current, clamped)) return
    const drawbars = [...this.state.organ.layers[layer].drawbars]
    drawbars[index] = clamped
    const layers = { ...this.state.organ.layers, [layer]: { ...this.state.organ.layers[layer], drawbars } }
    this.patch({ organ: { ...this.state.organ, layers } }, `Drawbar ${index + 1} → ${clamped}`)
  }

  cycleVibratoMode(): void {
    const current = this.state.organ.vibratoMode
    const next = VIBRATO_CHORUS_MODES[(VIBRATO_CHORUS_MODES.indexOf(current) + 1) % VIBRATO_CHORUS_MODES.length]!
    this.patch({ organ: { ...this.state.organ, vibratoMode: next } }, `Organ Vib/Chorus ${next}`)
  }

  toggleVibratoOn(): void {
    const layer = this.state.organ.focusedLayer
    const on = !this.state.organ.layers[layer].vibratoOn
    const layers = { ...this.state.organ.layers, [layer]: { ...this.state.organ.layers[layer], vibratoOn: on } }
    this.patch({ organ: { ...this.state.organ, layers } }, `Organ ${layer} Vib/Chorus ${on ? 'On' : 'Off'}`)
  }

  togglePercussion(key: 'on' | 'soft' | 'fast' | 'third'): void {
    const percussion = { ...this.state.organ.percussion, [key]: !this.state.organ.percussion[key] }
    const labels = { on: 'Percussion', soft: 'Perc Volume Soft', fast: 'Perc Decay Fast', third: 'Perc Third Harmonic' }
    this.patch({ organ: { ...this.state.organ, percussion } }, `${labels[key]} ${percussion[key] ? 'On' : 'Off'}`)
  }

  shiftOrganOctave(delta: -1 | 1): void {
    const layer = this.state.organ.focusedLayer
    const next = Math.max(-1, Math.min(1, this.state.organ.layers[layer].octave + delta)) as -1 | 0 | 1
    const layers = { ...this.state.organ.layers, [layer]: { ...this.state.organ.layers[layer], octave: next } }
    this.patch({ organ: { ...this.state.organ, layers } }, `Organ ${layer} Octave ${next > 0 ? `+${next}` : next}`)
  }

  toggleOrganToRotary(): void {
    const toRotary = !this.state.organ.toRotary
    this.patch({ organ: { ...this.state.organ, toRotary } }, `Organ → Rotary ${toRotary ? 'On' : 'Off'}`)
  }

  /* -------------------------------------------------------------- synth -- */

  setSynthSectionOn(on: boolean): void {
    this.patch(
      { synth: { ...this.state.synth, sectionOn: on }, fxFocus: { section: 'synth', layer: this.state.synth.focusedLayer } },
      `Synth Section ${on ? 'On' : 'Off'}`,
    )
  }

  toggleSynthLayer(layer: SynthLayerId): void {
    const enabled = !this.state.synth.layers[layer].enabled
    const key = `synth${layer}` as LayerKey
    let next = this.withLayerEnabled(this.state, key, enabled)
    next = { ...next, synth: { ...next.synth, focusedLayer: layer }, fxFocus: { section: 'synth', layer } }
    this.commit({ ...next, lastEdit: `Synth ${layer} ${enabled ? 'On' : 'Off'}` })
  }

  setSynthLevel(layer: SynthLayerId, level: number): void {
    const clamped = clamp(level)
    if (this.captureMorph({ kind: 'layerLevel', layer: `synth${layer}` as LayerKey }, this.state.synth.layers[layer].level, clamped)) return
    this.patchSynthLayer(layer, { level: clamped }, `Synth ${layer} Level ${clamped}`)
  }

  private patchSynthLayer(layer: SynthLayerId, partial: Partial<SynthState['layers'][SynthLayerId]>, label: string): void {
    const layers = { ...this.state.synth.layers, [layer]: { ...this.state.synth.layers[layer], ...partial } }
    this.patch({ synth: { ...this.state.synth, layers } }, label)
  }

  /** The synth layer that panel edits target. */
  focusedSynthLayer(): SynthLayerId {
    return this.state.synth.focusedLayer
  }

  private editSynth(label: string, edit: (layer: SynthState['layers'][SynthLayerId]) => Partial<SynthState['layers'][SynthLayerId]>): void {
    const id = this.state.synth.focusedLayer
    this.patchSynthLayer(id, edit(this.state.synth.layers[id]), label)
  }

  shiftSynthOctave(delta: -1 | 1): void {
    const id = this.state.synth.focusedLayer
    const next = Math.max(-1, Math.min(1, this.state.synth.layers[id].octave + delta)) as -1 | 0 | 1
    this.patchSynthLayer(id, { octave: next }, `Synth ${id} Octave ${next > 0 ? `+${next}` : next}`)
  }

  cycleSynthCategory(): void {
    this.editSynth('', (layer) => {
      const next = SYNTH_CATEGORIES[(SYNTH_CATEGORIES.indexOf(layer.category) + 1) % SYNTH_CATEGORIES.length]!
      return { category: next, wave: 0 }
    })
    const layer = this.state.synth.layers[this.state.synth.focusedLayer]
    this.setLastEdit(`Synth Wave: ${SYNTH_WAVEFORMS[layer.category][layer.wave]}`)
  }

  selectSynthWave(delta: number): void {
    this.editSynth('', (layer) => {
      const list = SYNTH_WAVEFORMS[layer.category]
      const next = (layer.wave + delta + list.length) % list.length
      return { wave: next }
    })
    const layer = this.state.synth.layers[this.state.synth.focusedLayer]
    this.setLastEdit(`Synth Wave: ${SYNTH_WAVEFORMS[layer.category][layer.wave]}`)
  }

  setOscCtrl(value: number): void {
    const clamped = clamp(value)
    const id = this.state.synth.focusedLayer
    if (this.captureMorph({ kind: 'synth', layer: id, param: 'oscCtrl' }, this.state.synth.layers[id].oscCtrl, clamped)) return
    this.patchSynthLayer(id, { oscCtrl: clamped }, `Osc Ctrl ${clamped}`)
  }

  setOscEnv(partial: Partial<SynthState['layers'][SynthLayerId]['oscEnv']>, label: string): void {
    this.editSynth(label, (layer) => ({ oscEnv: { ...layer.oscEnv, ...partial } }))
  }

  setFilterEnv(partial: Partial<SynthState['layers'][SynthLayerId]['filterEnv']>, label: string): void {
    this.editSynth(label, (layer) => ({ filterEnv: { ...layer.filterEnv, ...partial } }))
  }

  setSynthFilter(partial: Partial<SynthState['layers'][SynthLayerId]['filter']>, label: string): void {
    const id = this.state.synth.focusedLayer
    const filter = this.state.synth.layers[id].filter
    if (partial.freq !== undefined && Object.keys(partial).length === 1) {
      if (this.captureMorph({ kind: 'synth', layer: id, param: 'filterFreq' }, filter.freq, clamp(partial.freq))) return
    }
    if (partial.res !== undefined && Object.keys(partial).length === 1) {
      if (this.captureMorph({ kind: 'synth', layer: id, param: 'filterRes' }, filter.res, clamp(partial.res))) return
    }
    this.patchSynthLayer(id, { filter: { ...filter, ...partial } }, label)
  }

  setAmpEnv(partial: Partial<SynthState['layers'][SynthLayerId]['ampEnv']>, label: string): void {
    this.editSynth(label, (layer) => ({ ampEnv: { ...layer.ampEnv, ...partial } }))
  }

  setSynthLfo(partial: Partial<SynthState['layers'][SynthLayerId]['lfo']>, label: string): void {
    const id = this.state.synth.focusedLayer
    const lfo = this.state.synth.layers[id].lfo
    if (partial.rate !== undefined && Object.keys(partial).length === 1) {
      if (this.captureMorph({ kind: 'synth', layer: id, param: 'lfoRate' }, lfo.rate, clamp(partial.rate))) return
    }
    if (partial.amount !== undefined && Object.keys(partial).length === 1) {
      if (this.captureMorph({ kind: 'synth', layer: id, param: 'lfoAmount' }, lfo.amount, clamp(partial.amount))) return
    }
    this.patchSynthLayer(id, { lfo: { ...lfo, ...partial } }, label)
  }

  cycleLfoWave(): void {
    const lfo = this.state.synth.layers[this.state.synth.focusedLayer].lfo
    const next = LFO_WAVES[(LFO_WAVES.indexOf(lfo.wave) + 1) % LFO_WAVES.length]!
    this.setSynthLfo({ wave: next }, `LFO Wave ${next}`)
  }

  cycleLfoDestination(): void {
    const lfo = this.state.synth.layers[this.state.synth.focusedLayer].lfo
    const order: Array<SynthState['layers']['A']['lfo']['dest']> = [null, ...LFO_DESTINATIONS]
    const next = order[(order.indexOf(lfo.dest) + 1) % order.length]!
    this.setSynthLfo({ dest: next }, `LFO → ${next ?? 'Off'}`)
  }

  setSynthVoice(partial: Partial<SynthState['layers'][SynthLayerId]['voice']>, label: string): void {
    this.editSynth(label, (layer) => ({ voice: { ...layer.voice, ...partial } }))
  }

  cycleVoiceMode(): void {
    const voice = this.state.synth.layers[this.state.synth.focusedLayer].voice
    const order: Array<typeof voice.mode> = ['Poly', 'Mono', 'Legato']
    const next = order[(order.indexOf(voice.mode) + 1) % order.length]!
    this.setSynthVoice({ mode: next }, `Voice ${next}`)
  }

  cycleNotePriority(): void {
    const voice = this.state.synth.layers[this.state.synth.focusedLayer].voice
    const order: Array<typeof voice.priority> = ['Off', 'Low', 'High']
    const next = order[(order.indexOf(voice.priority) + 1) % order.length]!
    this.setSynthVoice({ priority: next }, `Note Priority ${next}`)
  }

  cycleSynthUnison(): void {
    const voice = this.state.synth.layers[this.state.synth.focusedLayer].voice
    const next = ((voice.unison + 1) % 4) as 0 | 1 | 2 | 3
    this.setSynthVoice({ unison: next }, `Synth Unison ${next === 0 ? 'Off' : next}`)
  }

  cycleSynthVibrato(): void {
    const voice = this.state.synth.layers[this.state.synth.focusedLayer].voice
    const order: Array<typeof voice.vibrato> = ['Off', 'On', 'Wheel']
    const next = order[(order.indexOf(voice.vibrato) + 1) % order.length]!
    this.setSynthVoice({ vibrato: next }, `Vibrato ${next}`)
  }

  setSynthArp(partial: Partial<SynthState['layers'][SynthLayerId]['arp']>, label: string): void {
    const id = this.state.synth.focusedLayer
    const arp = this.state.synth.layers[id].arp
    if (partial.rate !== undefined && Object.keys(partial).length === 1) {
      if (this.captureMorph({ kind: 'synth', layer: id, param: 'arpRate' }, arp.rate, clamp(partial.rate))) return
    }
    this.patchSynthLayer(id, { arp: { ...arp, ...partial } }, label)
  }

  cycleArpMode(): void {
    const arp = this.state.synth.layers[this.state.synth.focusedLayer].arp
    const next = ARP_MODES[(ARP_MODES.indexOf(arp.mode) + 1) % ARP_MODES.length]!
    this.setSynthArp({ mode: next }, `Arp Mode ${next}`)
  }

  cycleArpDirection(): void {
    const arp = this.state.synth.layers[this.state.synth.focusedLayer].arp
    const next = ARP_DIRECTIONS[(ARP_DIRECTIONS.indexOf(arp.direction) + 1) % ARP_DIRECTIONS.length]!
    this.setSynthArp({ direction: next }, `Arp Direction ${next}`)
  }

  cycleFilterType(): void {
    const filter = this.state.synth.layers[this.state.synth.focusedLayer].filter
    const next = SYNTH_FILTER_TYPES[(SYNTH_FILTER_TYPES.indexOf(filter.type) + 1) % SYNTH_FILTER_TYPES.length]!
    this.setSynthFilter({ type: next }, `Filter ${next}`)
  }

  cycleFilterTracking(): void {
    const filter = this.state.synth.layers[this.state.synth.focusedLayer].filter
    const next = ((filter.tracking + 1) % 4) as 0 | 1 | 2 | 3
    this.setSynthFilter({ tracking: next }, `KB Track ${['Off', '1/3', '2/3', '1'][next]}`)
  }

  cycleFilterDrive(): void {
    const filter = this.state.synth.layers[this.state.synth.focusedLayer].filter
    const next = ((filter.drive + 1) % 4) as 0 | 1 | 2 | 3
    this.setSynthFilter({ drive: next }, `Filter Drive ${next === 0 ? 'Off' : next}`)
  }

  soundInit(): void {
    const id = this.state.synth.focusedLayer
    const fresh = defaultSynthState().layers.A
    this.patchSynthLayer(id, { ...fresh, enabled: this.state.synth.layers[id].enabled, level: this.state.synth.layers[id].level }, `Synth ${id} Sound Init`)
  }

  /* ------------------------------------------------------------ effects -- */

  /** Chains an effect edit targets: focused chain, or a group/global set. */
  private targetChains(unit: keyof EffectChainState): ChainId[] {
    const global =
      (unit === 'delay' && this.state.fxGlobal.delay) || (unit === 'comp' && this.state.fxGlobal.comp) || (unit === 'reverb' && this.state.fxGlobal.reverb)
    if (global) return [...CHAIN_IDS]
    const focus = this.state.fxFocus
    if (focus.section === 'piano' && this.state.fxGroupPiano) return ['A', 'B']
    if (focus.section === 'synth' && this.state.fxGroupSynth) return ['synthA', 'synthB', 'synthC']
    return [chainForFocus(focus)]
  }

  focusedChain(): ChainId {
    return chainForFocus(this.state.fxFocus)
  }

  setFxFocus(focus: FxFocus): void {
    const next: Partial<InstrumentState> = { fxFocus: focus }
    if (focus.section === 'piano') next.focusedLayer = focus.layer === 'B' ? 'B' : 'A'
    if (focus.section === 'organ') next.organ = { ...this.state.organ, focusedLayer: focus.layer === 'B' ? 'B' : 'A' }
    if (focus.section === 'synth') next.synth = { ...this.state.synth, focusedLayer: focus.layer as SynthLayerId }
    this.patch(next, `FX Focus ${focus.section === 'organ' ? 'Organ' : focus.section === 'piano' ? `Piano ${focus.layer}` : `Synth ${focus.layer}`}`)
  }

  updateUnit<K extends keyof EffectChainState>(unit: K, partial: Partial<EffectChainState[K]>, label?: string): void {
    // Single-value continuous edits are morphable while a morph source is latched.
    const morphParam = fxMorphParam(unit, partial)
    if (morphParam) {
      const chain = chainForFocus(this.state.fxFocus)
      const current = (this.state.chains[chain][unit] as unknown as Record<string, number>)[morphParam.param]!
      if (this.captureMorph({ kind: 'fx', chain, param: morphParam.key }, current, morphParam.value)) return
    }
    const chains = { ...this.state.chains }
    for (const chainId of this.targetChains(unit)) {
      chains[chainId] = { ...chains[chainId], [unit]: { ...chains[chainId][unit], ...partial } }
    }
    this.patch({ chains }, label)
  }

  toggleUnitOn(unit: keyof EffectChainState): void {
    const on = !this.state.chains[this.focusedChain()][unit].on
    this.updateUnit(unit, { on } as never, `${unitLabel(unit)} ${on ? 'On' : 'Off'}`)
  }

  cycleMod1Type(): void {
    const current = this.state.chains[this.focusedChain()].mod1.type
    const next = MOD1_TYPES[(MOD1_TYPES.indexOf(current) + 1) % MOD1_TYPES.length]!
    this.updateUnit('mod1', { type: next }, `Mod 1: ${next}`)
  }

  cycleMod2Type(): void {
    const current = this.state.chains[this.focusedChain()].mod2.type
    const next = MOD2_TYPES[(MOD2_TYPES.indexOf(current) + 1) % MOD2_TYPES.length]!
    this.updateUnit('mod2', { type: next }, `Mod 2: ${next}`)
  }

  cycleAmpType(): void {
    const current = this.state.chains[this.focusedChain()].ampEq.type
    const next = AMP_TYPES[(AMP_TYPES.indexOf(current) + 1) % AMP_TYPES.length]!
    this.updateUnit('ampEq', { type: next }, `Amp Sim/EQ: ${next}`)
  }

  cycleReverbType(): void {
    const current = this.state.chains[this.focusedChain()].reverb.type
    const next = REVERB_TYPES[(REVERB_TYPES.indexOf(current) + 1) % REVERB_TYPES.length]!
    this.updateUnit('reverb', { type: next }, `Reverb: ${next}`)
  }

  cycleDelayFilter(): void {
    const current = this.state.chains[this.focusedChain()].delay.filter
    const next = DELAY_FILTERS[(DELAY_FILTERS.indexOf(current) + 1) % DELAY_FILTERS.length]!
    this.updateUnit('delay', { filter: next }, `Delay Filter: ${next}`)
  }

  cycleDelayEffect(): void {
    const current = this.state.chains[this.focusedChain()].delay.effect
    const next = DELAY_EFFECTS[(DELAY_EFFECTS.indexOf(current) + 1) % DELAY_EFFECTS.length]!
    this.updateUnit('delay', { effect: next }, `Delay FX: ${next}`)
  }

  toggleDelayAnalog(): void {
    const analog = !this.state.chains[this.focusedChain()].delay.analog
    this.updateUnit('delay', { analog }, `Delay Analog ${analog ? 'On' : 'Off'}`)
  }

  toggleReverbBright(): void {
    const bright = !this.state.chains[this.focusedChain()].reverb.bright
    this.updateUnit('reverb', { bright }, `Reverb ${bright ? 'Bright' : 'Dark'}`)
  }

  setDelayTempoMs(ms: number): void {
    // Inverse of delayTempoMs mapping; used by tap tempo.
    const clampedMs = Math.max(20, Math.min(1400, ms))
    const value = clamp(Math.round(((clampedMs - 20) / (1400 - 20)) * 127))
    this.updateUnit('delay', { tempo: value, clockSync: false }, `Delay Tempo ${Math.round(clampedMs)} ms`)
  }

  /** Shift + rate/tempo knob: the knob now selects a master-clock subdivision. */
  setClockSyncedRate(target: 'delay' | 'mod1' | 'lfo' | 'arp', value: number): void {
    const clamped = clamp(value)
    if (target === 'delay') this.updateUnit('delay', { tempo: clamped, clockSync: true }, `Delay ← Mst Clk`)
    else if (target === 'mod1') this.updateUnit('mod1', { rate: clamped, clockSync: true }, `Mod 1 ← Mst Clk`)
    else if (target === 'lfo') this.setSynthLfo({ rate: clamped, clockSync: true }, 'LFO ← Mst Clk')
    else this.setSynthArp({ rate: clamped, clockSync: true }, 'Arp ← Mst Clk')
  }

  toggleFxGroupPiano(): void {
    const fxGroupPiano = !this.state.fxGroupPiano
    if (fxGroupPiano) {
      // Entering group mode applies the focused layer's chain to the group (manual p.48).
      const focused = this.state.chains[this.focusedChain()]
      const chains = { ...this.state.chains, A: deepClone(focused), B: deepClone(focused) }
      this.patch({ fxGroupPiano, chains }, 'Piano FX Group On')
    } else {
      this.patch({ fxGroupPiano }, 'Piano FX Group Off')
    }
  }

  toggleFxGroupSynth(): void {
    const fxGroupSynth = !this.state.fxGroupSynth
    if (fxGroupSynth) {
      const focused = this.state.chains[this.focusedChain()]
      const chains = { ...this.state.chains, synthA: deepClone(focused), synthB: deepClone(focused), synthC: deepClone(focused) }
      this.patch({ fxGroupSynth, chains }, 'Synth FX Group On')
    } else {
      this.patch({ fxGroupSynth }, 'Synth FX Group Off')
    }
  }

  toggleFxGlobal(unit: 'delay' | 'comp' | 'reverb'): void {
    const value = !this.state.fxGlobal[unit]
    const fxGlobal = { ...this.state.fxGlobal, [unit]: value }
    if (value) {
      // Entering global mode mirrors the focused chain's unit settings everywhere.
      const focused = this.state.chains[this.focusedChain()][unit]
      const chains = { ...this.state.chains }
      for (const chainId of CHAIN_IDS) chains[chainId] = { ...chains[chainId], [unit]: { ...focused } }
      this.patch({ fxGlobal, chains }, `${unitLabel(unit)} Global On`)
    } else {
      this.patch({ fxGlobal }, `${unitLabel(unit)} Global Off`)
    }
  }

  toggleAllFxOff(): void {
    const allFxOff = !this.state.allFxOff
    this.patch({ allFxOff }, allFxOff ? 'All FX Off' : 'All FX Restored')
  }

  /* ------------------------------------------------------------- rotary -- */

  toggleRotarySpeed(): void {
    const speed = this.state.rotary.speed === 'fast' ? 'slow' : 'fast'
    this.patch({ rotary: { ...this.state.rotary, speed } }, `Rotary ${speed === 'fast' ? 'Fast' : 'Slow'}`)
  }

  toggleRotaryStop(): void {
    const speed: RotarySpeed = this.state.rotary.speed === 'stop' ? 'slow' : 'stop'
    this.patch({ rotary: { ...this.state.rotary, speed } }, `Rotary ${speed === 'stop' ? 'Stop' : 'Slow'}`)
  }

  setRotaryDrive(value: number): void {
    const clamped = clamp(value)
    this.patch({ rotary: { ...this.state.rotary, drive: clamped } }, `Rotary Drive ${clamped}`)
  }

  /** The Rotary MORPH button: while a morph source is latched, toggles a full slow→fast speed assignment. */
  toggleRotarySpeedMorph(): void {
    const source = this.state.morphCapture
    if (!source) {
      this.setLastEdit('Rotary Morph: latch Wheel or Ctrl Ped first')
      return
    }
    const key = morphPathKey({ kind: 'rotarySpeed' })
    const list = this.state.morphs[source]
    const existing = list.find((a) => morphPathKey(a.path) === key)
    const nextList = existing ? list.filter((a) => a !== existing) : [...list, { path: { kind: 'rotarySpeed' } as MorphPath, from: 0, to: 127 }]
    this.patch({ morphs: { ...this.state.morphs, [source]: nextList } }, existing ? 'Rotary Speed morph cleared' : `Rotary Speed ← ${sourceLabel(source)}`)
  }

  /* -------------------------------------------------------------- morphs -- */

  /** Latch/unlatch morph-assign capture for a source (the accessible equivalent of hold / double-tap latch). */
  toggleMorphCapture(source: MorphSource): void {
    const next = this.state.morphCapture === source ? null : source
    this.patch({ morphCapture: next }, next ? `Morph Assign ${sourceLabel(source)} — move a destination` : 'Morph Assign off')
  }

  clearMorphAssignments(source: MorphSource): void {
    this.patch({ morphs: { ...this.state.morphs, [source]: [] }, morphCapture: this.state.morphCapture === source ? null : this.state.morphCapture }, `${sourceLabel(source)} morphs cleared`)
  }

  /**
   * Intercepts a morphable edit while capture is latched: records/updates the
   * assignment instead of changing the base value. Zeroing back onto the base
   * value removes the single assignment (manual p.39). Returns true when the
   * edit was captured.
   */
  private captureMorph(path: MorphPath, currentBase: number, newValue: number): boolean {
    const source = this.state.morphCapture
    if (!source) return false
    const key = morphPathKey(path)
    const list = this.state.morphs[source]
    const existing = list.find((a) => morphPathKey(a.path) === key)
    let nextList: MorphAssignment[]
    let label: string
    if (newValue === (existing?.from ?? currentBase)) {
      nextList = existing ? list.filter((a) => a !== existing) : list
      label = `Morph cleared (${key})`
    } else if (existing) {
      nextList = list.map((a) => (a === existing ? { ...a, to: newValue } : a))
      label = `Morph ${key}: ${existing.from} → ${newValue}`
    } else {
      nextList = [...list, { path, from: currentBase, to: newValue }]
      label = `Morph ${key}: ${currentBase} → ${newValue}`
    }
    this.patch({ morphs: { ...this.state.morphs, [source]: nextList } }, label)
    return true
  }

  /** Live morph source positions: mod wheel (panel or MIDI CC1) and control pedal (on-screen pedal or MIDI CC11). */
  setMorphValue(source: MorphSource, position: number): void {
    const clamped = Math.max(0, Math.min(1, position))
    if (this.state.morphValues[source] === clamped) return
    this.patch({ morphValues: { ...this.state.morphValues, [source]: clamped } })
  }

  /* -------------------------------------------------------------- splits -- */

  toggleSplit(): void {
    if (this.state.programs.splitEdit) {
      // Inside split editing the button cycles the selected point's crossfade.
      const point = this.state.programs.splitEdit
      const current = this.state.split.points[point]
      const next = CROSSFADE_WIDTHS[(CROSSFADE_WIDTHS.indexOf(current.xfade) + 1) % CROSSFADE_WIDTHS.length]!
      const points = { ...this.state.split.points, [point]: { ...current, xfade: next } }
      this.patch({ split: { ...this.state.split, points } }, `Split ${point} xfade ${next === 0 ? 'Off' : `±${next}`}`)
      return
    }
    const on = !this.state.split.on
    this.patch({ split: { ...this.state.split, on } }, on ? 'Split On' : 'Split Off')
  }

  /** Latched split editing (the pointer/keyboard equivalent of press-and-hold Split ON/SET). */
  toggleSplitEdit(): void {
    const active = this.state.programs.splitEdit
    this.patch(
      { programs: { ...this.state.programs, splitEdit: active ? null : 'mid' }, split: active ? this.state.split : { ...this.state.split, on: true } },
      active ? 'Split edit closed' : 'Split edit: dial = position, ◂▸ = point, Split = xfade',
    )
  }

  selectSplitPoint(point: SplitPointId): void {
    this.patch({ programs: { ...this.state.programs, splitEdit: point } }, `Split edit: ${point}`)
  }

  stepSplitEditPoint(delta: -1 | 1): void {
    const current = this.state.programs.splitEdit ?? 'mid'
    const index = SPLIT_POINT_IDS.indexOf(current)
    const next = SPLIT_POINT_IDS[(index + delta + SPLIT_POINT_IDS.length) % SPLIT_POINT_IDS.length]!
    this.selectSplitPoint(next)
  }

  /** Dial movement inside split editing: position 0 = point off, 1..11 = the documented positions. */
  stepSplitPosition(delta: number): void {
    const point = this.state.programs.splitEdit
    if (!point) return
    const current = this.state.split.points[point]
    const slot = current.active ? current.position + 1 : 0
    const next = Math.max(0, Math.min(SPLIT_POSITIONS.length, slot + delta))
    const updated = next === 0 ? { ...current, active: false } : { ...current, active: true, position: next - 1 }
    const points = { ...this.state.split.points, [point]: updated }
    this.patch(
      { split: { ...this.state.split, points } },
      next === 0 ? `Split ${point}: Off` : `Split ${point}: ${SPLIT_POSITIONS[next - 1]}`,
    )
  }

  /** KB ZONE ◂/▸: steps the focused layer of a section through the contiguous zone ranges. */
  stepZone(section: SectionKey, delta: -1 | 1): void {
    const key = this.focusedLayerKey(section)
    const next = stepZoneRange(this.state.zones[key], delta)
    const zones = { ...this.state.zones, [key]: next }
    this.patch({ zones }, `${sectionLabel(section)} ${layerLetter(key)} zones ${next.from + 1}–${next.to + 1}`)
  }

  setZoneRange(key: LayerKey, range: { from: number; to: number }): void {
    const zones = { ...this.state.zones, [key]: { from: range.from, to: range.to } }
    this.patch({ zones }, `${key} zones ${range.from + 1}–${range.to + 1}`)
  }

  private focusedLayerKey(section: SectionKey): LayerKey {
    if (section === 'piano') return this.state.focusedLayer === 'B' ? 'pianoB' : 'pianoA'
    if (section === 'organ') return this.state.organ.focusedLayer === 'B' ? 'organB' : 'organA'
    return `synth${this.state.synth.focusedLayer}` as LayerKey
  }

  /* -------------------------------------------------------------- scenes -- */

  setScene(scene: SceneId): void {
    if (this.state.scenes.active === scene) return
    const scenes = deepClone(this.state.scenes)
    scenes.active = scene
    let next: InstrumentState = { ...this.state, scenes }
    // Apply the scene's enable configuration to every layer; sound parameters are untouched (manual p.43).
    const enables = scenes.enables[scene]
    next = {
      ...next,
      layers: {
        A: { ...next.layers.A, enabled: enables.pianoA },
        B: { ...next.layers.B, enabled: enables.pianoB },
      },
      organ: {
        ...next.organ,
        layers: {
          A: { ...next.organ.layers.A, enabled: enables.organA },
          B: { ...next.organ.layers.B, enabled: enables.organB },
        },
      },
      synth: {
        ...next.synth,
        layers: {
          A: { ...next.synth.layers.A, enabled: enables.synthA },
          B: { ...next.synth.layers.B, enabled: enables.synthB },
          C: { ...next.synth.layers.C, enabled: enables.synthC },
        },
      },
    }
    this.commit({ ...next, lastEdit: `Layer Scene ${scene}` })
  }

  toggleScene(): void {
    this.setScene(this.state.scenes.active === 'I' ? 'II' : 'I')
  }

  /* ------------------------------------------------------ clock/transpose -- */

  setClockBpm(bpm: number): void {
    const clamped = Math.max(CLOCK_BPM_MIN, Math.min(CLOCK_BPM_MAX, Math.round(bpm)))
    this.patch({ clockBpm: clamped }, `Mst Clk ${clamped} BPM`)
  }

  toggleClockSet(): void {
    const clockSet = !this.state.programs.clockSet
    this.patch({ programs: { ...this.state.programs, clockSet, transposeSet: false } }, clockSet ? 'Mst Clk set: dial = BPM' : `Mst Clk ${this.state.clockBpm} BPM`)
  }

  toggleTranspose(): void {
    const on = !this.state.transpose.on
    this.patch({ transpose: { ...this.state.transpose, on } }, on ? `Transpose On (${signed(this.state.transpose.semitones)})` : 'Transpose Off')
  }

  toggleTransposeSet(): void {
    const transposeSet = !this.state.programs.transposeSet
    this.patch({ programs: { ...this.state.programs, transposeSet, clockSet: false } }, transposeSet ? 'Transpose set: dial = ±6' : `Transpose ${signed(this.state.transpose.semitones)}`)
  }

  setTranspose(semitones: number): void {
    const clamped = Math.max(-6, Math.min(6, Math.round(semitones)))
    this.patch({ transpose: { on: this.state.transpose.on || clamped !== 0, semitones: clamped } }, `Transpose ${signed(clamped)}`)
  }

  /* ------------------------------------------------------------ programs -- */

  private currentSlotData(): ProgramData {
    const { current, slots, live } = this.state.programs
    return current.bank === 'live' ? live[current.index]! : slots[current.index]!
  }

  /**
   * Selects a program slot. Outside a store flow this LOADS the slot,
   * discarding unsaved edits (dirty edits are kept for single-level Undo).
   * During the Store destination step it auditions the destination instead.
   */
  selectSlot(ref: ProgramSlotRef): void {
    const programs = this.state.programs
    if (programs.storeFlow?.step === 'destination') {
      const data = ref.bank === 'live' ? programs.live[ref.index]! : programs.slots[ref.index]!
      const next = applyProgram(this.state, data)
      this.commit({
        ...next,
        programs: {
          ...programs,
          current: ref,
          page: ref.bank === 'program' ? Math.floor(ref.index / 8) : programs.page,
          storeFlow: { ...programs.storeFlow, destination: ref },
        },
        lastEdit: `Store to ${slotLabel(ref)}? STORE confirms, Shift cancels`,
      })
      return
    }
    const dirty = isProgramDirty(this.state)
    const undo = dirty ? { slot: programs.current, data: serializeProgram(this.state) } : programs.undo
    const data = ref.bank === 'live' ? programs.live[ref.index]! : programs.slots[ref.index]!
    const next = applyProgram(this.state, data)
    this.commit({
      ...next,
      programs: {
        ...programs,
        current: ref,
        page: ref.bank === 'program' ? Math.floor(ref.index / 8) : programs.page,
        undo,
        listCursor: null,
      },
      lastEdit: `${slotLabel(ref)} ${data.name}${dirty ? ' (edits discarded — Undo available)' : ''}`,
    })
  }

  selectProgramButton(button: number): void {
    const programs = this.state.programs
    if (programs.liveMode) {
      this.selectSlot({ bank: 'live', index: button })
    } else {
      this.selectSlot({ bank: 'program', index: programs.page * 8 + button })
    }
  }

  stepPage(delta: -1 | 1): void {
    const programs = this.state.programs
    if (programs.storeFlow?.step === 'naming') {
      const cursor = Math.max(0, Math.min(programs.storeFlow.name.length, programs.storeFlow.cursor + delta))
      this.patch({ programs: { ...programs, storeFlow: { ...programs.storeFlow, cursor } } }, `Name cursor ${cursor + 1}`)
      return
    }
    if (programs.splitEdit) {
      this.stepSplitEditPoint(delta)
      return
    }
    const page = Math.max(0, Math.min(3, programs.page + delta))
    this.patch({ programs: { ...programs, page } }, `Page ${page + 1}`)
  }

  /** Program dial movement: routes to the active edit mode (naming, split, clock, transpose, list) or browses programs. */
  turnDial(delta: number, shift = false): void {
    const programs = this.state.programs
    if (programs.storeFlow?.step === 'naming') {
      this.editNameChar(delta)
      return
    }
    if (programs.splitEdit) {
      this.stepSplitPosition(delta)
      return
    }
    if (programs.clockSet) {
      this.setClockBpm(this.state.clockBpm + delta)
      return
    }
    if (programs.transposeSet) {
      this.setTranspose(this.state.transpose.semitones + delta)
      return
    }
    if (shift && !programs.storeFlow) {
      // Shift + dial: numeric list view browsing (loads on Shift release).
      const cursor = Math.max(0, Math.min(31, (programs.listCursor ?? (programs.current.bank === 'program' ? programs.current.index : 0)) + delta))
      this.patch({ programs: { ...programs, listCursor: cursor } }, `List: ${slotLabel({ bank: 'program', index: cursor })} ${programs.slots[cursor]!.name}`)
      return
    }
    const bank = programs.storeFlow?.step === 'destination' ? programs.storeFlow.destination.bank : programs.current.bank
    const index = programs.storeFlow?.step === 'destination' ? programs.storeFlow.destination.index : programs.current.index
    const max = bank === 'live' ? 7 : 31
    const next = Math.max(0, Math.min(max, index + delta))
    if (next !== index) this.selectSlot({ bank, index: next })
  }

  /** PROG VIEW: toggles the numeric list view without loading (Shift+dial browses; closing via Shift release loads). */
  toggleListView(): void {
    const programs = this.state.programs
    if (programs.listCursor !== null) {
      this.patch({ programs: { ...programs, listCursor: null } }, 'List view closed')
      return
    }
    const cursor = programs.current.bank === 'program' ? programs.current.index : 0
    this.patch({ programs: { ...programs, listCursor: cursor } }, `List: ${slotLabel({ bank: 'program', index: cursor })} ${programs.slots[cursor]!.name}`)
  }

  /** Closes the numeric list view; loads the cursor program (called when Shift is released). */
  closeListView(): void {
    const cursor = this.state.programs.listCursor
    if (cursor === null) return
    this.selectSlot({ bank: 'program', index: cursor })
  }

  toggleLiveMode(): void {
    const programs = this.state.programs
    const liveMode = !programs.liveMode
    if (liveMode) {
      const index = Math.min(7, programs.current.bank === 'live' ? programs.current.index : 0)
      this.patch({ programs: { ...programs, liveMode } }, 'Live Mode On')
      this.selectSlot({ bank: 'live', index })
    } else {
      this.patch({ programs: { ...programs, liveMode } }, 'Live Mode Off')
      this.selectSlot({ bank: 'program', index: programs.current.bank === 'program' ? programs.current.index : 0 })
    }
  }

  /** STORE: first press opens the destination step (destination is auditioned); second press confirms; Shift cancels (manual p.13). */
  pressStore(): void {
    const programs = this.state.programs
    if (programs.storeFlow?.step === 'destination') {
      const flow = programs.storeFlow
      const data = { ...flow.snapshot }
      const slots = [...programs.slots]
      const live = [...programs.live]
      if (flow.destination.bank === 'live') live[flow.destination.index] = data
      else slots[flow.destination.index] = data
      const next = applyProgram(this.state, data)
      this.commit({
        ...next,
        programs: { ...programs, slots, live, current: flow.destination, storeFlow: null, undo: null },
        lastEdit: `Stored ${slotLabel(flow.destination)} ${data.name}`,
      })
      this.persist()
      return
    }
    if (programs.storeFlow?.step === 'naming') {
      // STORE from naming advances to the destination step.
      const flow = programs.storeFlow
      const snapshot = { ...flow.snapshot, name: flow.name }
      this.patch(
        { programs: { ...programs, storeFlow: { step: 'destination', snapshot, origin: flow.origin, destination: programs.current } }, programName: flow.name },
        `Store "${flow.name}" to ${slotLabel(programs.current)}? STORE confirms`,
      )
      return
    }
    const snapshot = serializeProgram(this.state)
    this.patch(
      { programs: { ...programs, storeFlow: { step: 'destination', snapshot, origin: programs.current, destination: programs.current } } },
      `Store to ${slotLabel(programs.current)}? STORE confirms, Shift cancels`,
    )
  }

  /** STORE AS: naming first (dial = character, ◂▸ = cursor, Store As adds a space, STORE proceeds), then the destination step (manual p.41). */
  pressStoreAs(): void {
    const programs = this.state.programs
    if (programs.storeFlow?.step === 'naming') {
      // Second press inserts a space at the cursor (character entry helper).
      const flow = programs.storeFlow
      const name = (flow.name.slice(0, flow.cursor) + ' ' + flow.name.slice(flow.cursor)).slice(0, 16)
      this.patch({ programs: { ...programs, storeFlow: { ...flow, name, cursor: Math.min(name.length - 1, flow.cursor + 1) } } }, 'Name: insert space')
      return
    }
    const snapshot = serializeProgram(this.state)
    this.patch(
      { programs: { ...programs, storeFlow: { step: 'naming', name: this.state.programName, cursor: 0, snapshot, origin: programs.current } } },
      'Store As: dial edits characters, ◂▸ moves, STORE proceeds',
    )
  }

  cancelStore(): void {
    const programs = this.state.programs
    if (!programs.storeFlow) return
    const flow = programs.storeFlow
    // Return to the origin slot with the edited buffer intact.
    const next = applyProgram(this.state, flow.snapshot)
    this.commit({
      ...next,
      programs: { ...programs, current: flow.origin, storeFlow: null },
      lastEdit: 'Store cancelled',
    })
  }

  private editNameChar(delta: number): void {
    const programs = this.state.programs
    if (programs.storeFlow?.step !== 'naming') return
    const flow = programs.storeFlow
    const alphabet = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-.'
    const cursor = Math.min(flow.cursor, 15)
    const padded = flow.name.length <= cursor ? flow.name.padEnd(cursor + 1, ' ') : flow.name
    const currentChar = padded[cursor] ?? ' '
    const index = Math.max(0, alphabet.indexOf(currentChar))
    const nextChar = alphabet[(index + delta + alphabet.length * 8) % alphabet.length]!
    const name = (padded.slice(0, cursor) + nextChar + padded.slice(cursor + 1)).slice(0, 16)
    this.patch({ programs: { ...programs, storeFlow: { ...flow, name } } }, `Name: ${name.trimEnd()}`)
  }

  /** Deletes the character before the cursor in the naming step. */
  deleteNameChar(): void {
    const programs = this.state.programs
    if (programs.storeFlow?.step !== 'naming') return
    const flow = programs.storeFlow
    if (flow.cursor === 0) return
    const name = flow.name.slice(0, flow.cursor - 1) + flow.name.slice(flow.cursor)
    this.patch({ programs: { ...programs, storeFlow: { ...flow, name, cursor: flow.cursor - 1 } } }, `Name: ${name.trimEnd()}`)
  }

  /** Single-level undo: returns to the program that was left with unsaved edits and restores those edits. */
  undoProgramChange(): void {
    const undo = this.state.programs.undo
    if (!undo) {
      this.setLastEdit('Nothing to undo')
      return
    }
    const next = applyProgram(this.state, undo.data)
    this.commit({
      ...next,
      programs: { ...this.state.programs, current: undo.slot, undo: null, page: undo.slot.bank === 'program' ? Math.floor(undo.slot.index / 8) : this.state.programs.page },
      lastEdit: `Undo: back to ${slotLabel(undo.slot)} with edits`,
    })
  }

  /** Optional Solo listen mode: only the focused section sounds. */
  toggleSolo(): void {
    const solo = this.state.solo ? null : this.state.fxFocus.section
    this.patch({ solo }, solo ? `Solo ${sectionLabel(solo)}` : 'Solo Off')
  }

  /** Exits transient edit modes (Shift/Exit) and cancels a pending store. */
  exitModes(): void {
    const programs = this.state.programs
    if (programs.storeFlow) {
      this.cancelStore()
      return
    }
    if (programs.splitEdit || programs.clockSet || programs.transposeSet || programs.listCursor !== null) {
      this.patch({ programs: { ...programs, splitEdit: null, clockSet: false, transposeSet: false, listCursor: null } }, 'Exit')
    }
  }
}

/* ----------------------------------------------------------------- utils -- */

function clamp(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value)))
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`
}

function sourceLabel(source: MorphSource): string {
  return source === 'wheel' ? 'Wheel' : 'Ctrl Ped'
}

function sectionLabel(section: SectionKey): string {
  return section === 'piano' ? 'Piano' : section === 'organ' ? 'Organ' : 'Synth'
}

function unitLabel(unit: keyof EffectChainState): string {
  return { mod1: 'Mod 1', mod2: 'Mod 2', delay: 'Delay', ampEq: 'Amp Sim/EQ', comp: 'Comp', reverb: 'Reverb' }[unit]
}

/** Maps a single-value continuous effect edit to its morph path parameter, when morphable. */
function fxMorphParam(
  unit: keyof EffectChainState,
  partial: Record<string, unknown>,
): { param: string; key: import('./program-types').FxMorphParam; value: number } | null {
  const keys = Object.keys(partial)
  if (keys.length !== 1) return null
  const param = keys[0]!
  const value = partial[param]
  if (typeof value !== 'number') return null
  const morphable: Record<string, true> = {
    'mod1.rate': true,
    'mod1.amount': true,
    'mod2.amount': true,
    'delay.tempo': true,
    'delay.feedback': true,
    'delay.mix': true,
    'ampEq.freq': true,
    'ampEq.drive': true,
    'reverb.mix': true,
  }
  const key = `${unit}.${param}`
  if (!morphable[key]) return null
  return { param, key: key as import('./program-types').FxMorphParam, value: Math.max(0, Math.min(127, Math.round(value))) }
}

export function useInstrumentState(store: InstrumentStore): InstrumentState {
  return useSyncExternalStore(store.subscribe, store.getState)
}

/** Mapped physical values used by both the engine and the display readouts. */
export const mappings = {
  /** 0..127 -> gain (squared taper). */
  levelToGain(value: number): number {
    const x = value / 127
    return x * x
  },
  delayTempoMs(value: number): number {
    return 20 + (value / 127) * (1400 - 20)
  },
  lfoRateHz(value: number): number {
    return 0.1 + Math.pow(value / 127, 2) * 9.9
  },
  eqGainDb(value: number): number {
    return ((value - 64) / 63.5) * 15
  },
  midFreqHz(value: number): number {
    return 200 * Math.pow(8000 / 200, value / 127)
  },
  filterFreqHz(value: number): number {
    return 40 * Math.pow(16000 / 40, value / 127)
  },
}

export { INSTRUMENTS, activeSplitPoints }

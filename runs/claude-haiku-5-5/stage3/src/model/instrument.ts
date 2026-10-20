// The instrument's canonical state: panel values, morph assignments, and the program bank, with one
// reducer that every panel action goes through. Panel values are still written only by the hardware
// reducer; this module decides what a program, morph, store, live, or clock action does around it.

import {
  focusedKey,
  initialPresentation,
  layerKey,
  presentationReducer,
  readValue,
  scopeOf,
  type ControlAction,
  type PresentationState,
} from './hardware'
import { assignMorph, clearMorphSource, EMPTY_MORPHS, isMorphDestination, type MorphMap, type MorphSource } from './morph'
import {
  applyProgram,
  captureProgram,
  initialBank,
  isDirty,
  PROGRAM_SLOTS,
  snapshotOf,
  type ProgramBank,
  type ProgramData,
} from './program'

export interface InstrumentState {
  values: PresentationState
  morphs: MorphMap
  bank: ProgramBank
  /** Assign mode: the source is latched, and destination moves become its assignments. */
  assign: { source: MorphSource; starts: Record<string, number> } | null
  /** Store As naming: the name being typed, or null when the dialog is closed. */
  storeAs: { name: string } | null
  /** Times of recent TAP presses, in milliseconds. */
  taps: readonly number[]
  /** Counts Panic presses, so the page can release every sounding note once per press. */
  panics: number
}

export type InstrumentAction =
  | ControlAction
  | { type: 'tap-tempo'; time: number }
  | { type: 'morph-source'; source: MorphSource; clear?: boolean }
  | { type: 'store-as-open' }
  | { type: 'store-as-name'; name: string }
  | { type: 'store-as-confirm' }
  | { type: 'store-as-cancel' }
  | { type: 'store-cancel' }
  | { type: 'panic' }

/** Taps closer together than this belong to one tempo; a longer pause starts a new one. */
export const TAP_WINDOW_MS = 2500
export const TAP_COUNT = 4
export const BPM_MIN = 30
export const BPM_MAX = 300

/** Master clock tempo from the 0..1 panel value: 30 to 300 beats per minute. */
export function bpmFromKnob(value: number): number {
  return BPM_MIN + (BPM_MAX - BPM_MIN) * Math.min(1, Math.max(0, value))
}

export function knobFromBpm(bpm: number): number {
  return (Math.min(BPM_MAX, Math.max(BPM_MIN, bpm)) - BPM_MIN) / (BPM_MAX - BPM_MIN)
}

/** Transpose from the 0..1 panel value: -6 to +6 semitones, with the centre at 0. */
export function transposeFromKnob(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 12) - 6
}

export function createInstrumentState(storedSlots?: { slots: (ProgramData | undefined)[]; live: (ProgramData | undefined)[] }): InstrumentState {
  const base = initialPresentation()
  const bank = initialBank(base, EMPTY_MORPHS)
  const slots = storedSlots ? bank.slots.map((factory, index) => storedSlots.slots[index] ?? factory) : bank.slots
  const live = storedSlots ? storedSlots.live : bank.live
  const first = slots[0] ?? captureProgram(base, EMPTY_MORPHS, 'Init')
  const values = applyProgram(base, first)
  return {
    values,
    morphs: first.morphs,
    bank: { ...bank, slots, live, loaded: snapshotOf(values, first.morphs) },
    assign: null,
    storeAs: null,
    taps: [],
    panics: 0,
  }
}

/** The name the Program display shows for the loaded program. */
export function programName(state: InstrumentState): string {
  const { bank } = state
  if (bank.liveMode) return bank.live[bank.liveSelected]?.name ?? `Live ${bank.liveSelected + 1}`
  return bank.slots[bank.selected]?.name ?? 'Init'
}

export function programEdited(state: InstrumentState): boolean {
  return !state.bank.liveMode && isDirty(state.values, state.morphs, state.bank)
}

/** Loads a program: replaces its keys, morphs, and the dirty baseline. Unsaved edits to the old program are discarded. */
function load(state: InstrumentState, program: ProgramData, selected: number): InstrumentState {
  const values = applyProgram(state.values, program)
  return {
    ...state,
    values,
    morphs: program.morphs,
    assign: null,
    bank: { ...state.bank, selected, page: Math.floor(selected / 8), storeArmed: state.bank.storeArmed, loaded: snapshotOf(values, program.morphs) },
  }
}

function selectRegular(state: InstrumentState, index: number): InstrumentState {
  // While STORE is armed, the program buttons choose the destination only. The edits being stored stay in place.
  if (state.bank.storeArmed && !state.bank.liveMode) {
    return { ...state, bank: { ...state.bank, selected: index, page: Math.floor(index / 8) } }
  }
  const program = state.bank.slots[index] ?? captureProgram(initialPresentation(), EMPTY_MORPHS, 'Init')
  return load({ ...state, bank: { ...state.bank, liveMode: false } }, program, index)
}

function selectLive(state: InstrumentState, index: number): InstrumentState {
  const existing = state.bank.live[index] ?? captureProgram(state.values, state.morphs, `Live ${index + 1}`)
  const bank = { ...state.bank, live: state.bank.live.map((slot, i) => (i === index ? existing : slot)) }
  return load({ ...state, bank: { ...bank, liveMode: true, liveSelected: index } }, existing, state.bank.selected)
}

function store(state: InstrumentState, name: string): InstrumentState {
  const program = captureProgram(state.values, state.morphs, name)
  const slots = state.bank.slots.map((slot, index) => (index === state.bank.selected ? program : slot))
  return { ...state, bank: { ...state.bank, slots, storeArmed: false, loaded: snapshotOf(state.values, state.morphs) } }
}

/** The page's name for a regular slot: the stored name, or a generic one for an empty slot. */
function slotName(state: InstrumentState, index: number): string {
  return state.bank.slots[index]?.name ?? `Program ${index + 1}`
}

/** Scoped controls resolve to the layer the panel is focused on; others keep their own key. */
function keyOf(values: PresentationState, id: string): string {
  const scope = scopeOf(id)
  return scope ? layerKey(id, focusedKey(values, scope)) : id
}

function panelAction(state: InstrumentState, action: ControlAction): InstrumentState {
  const values = presentationReducer(state.values, action)
  if (values === state.values) return state

  let next: InstrumentState = { ...state, values }

  // Assign mode: a destination that moves while its source is latched becomes an assignment.
  if (state.assign && action.type !== 'reset' && isMorphDestination(keyOf(values, action.id))) {
    const key = keyOf(values, action.id)
    const starts = { ...state.assign.starts }
    if (!(key in starts)) starts[key] = readValue(state.values, action.id)
    const end = values[key] ?? 0
    const morphs = assignMorph(state.morphs, state.assign.source, key, starts[key], end)
    next = { ...next, morphs, assign: { source: state.assign.source, starts } }
  }

  // Live Mode: every edit is stored in the loaded Live slot at once.
  if (next.bank.liveMode) {
    const live = next.bank.live.map((slot, index) =>
      index === next.bank.liveSelected ? captureProgram(next.values, next.morphs, slot?.name ?? `Live ${index + 1}`) : slot,
    )
    next = { ...next, bank: { ...next.bank, live } }
  }
  return next
}

/** Program-bank controls: the buttons, page, dial, store, live mode, and morph assign. Returns undefined for other IDs. */
function bankAction(state: InstrumentState, action: ControlAction): InstrumentState | undefined {
  const id = action.id
  if (action.type === 'set' && id === 'program.dial') {
    const index = Math.round(Math.min(1, Math.max(0, action.value)) * (PROGRAM_SLOTS - 1))
    return state.bank.liveMode ? state : selectRegular(state, index)
  }
  if (action.type !== 'toggle') return undefined

  const { bank } = state
  switch (id) {
    case 'program.page-up':
    case 'program.page-down': {
      const page = Math.min(3, Math.max(0, bank.page + (id === 'program.page-up' ? 1 : -1)))
      return { ...state, bank: { ...bank, page } }
    }
    case 'program.live-mode': {
      if (bank.liveMode) return selectRegular(state, bank.selected)
      return selectLive(state, bank.liveSelected)
    }
    case 'program.store': {
      // Shift + STORE opens Store As: naming, then the destination.
      if (action.shiftKey) return { ...state, storeAs: { name: slotName(state, bank.selected) } }
      if (bank.storeArmed) return store(state, slotName(state, bank.selected))
      return { ...state, bank: { ...bank, storeArmed: true } }
    }
    case 'program.panic':
      return panic(state)
    case 'program.morph-1':
      return action.shiftKey ? clearSource(state, 'wheel') : toggleAssign(state, 'wheel')
    case 'program.morph-2':
      return action.shiftKey ? clearSource(state, 'pedal') : toggleAssign(state, 'pedal')
    case 'program.morph-3':
      return state
    default:
      break
  }

  const button = /^program\.button-(\d)$/.exec(id)
  if (button) {
    const n = Number(button[1]) - 1
    if (bank.liveMode) return selectLive(state, n)
    return selectRegular(state, bank.page * 8 + n)
  }
  return undefined
}

/** Shift + a morph source clears every assignment of that source. */
function clearSource(state: InstrumentState, source: MorphSource): InstrumentState {
  return { ...state, morphs: clearMorphSource(state.morphs, source), assign: null }
}

function toggleAssign(state: InstrumentState, source: MorphSource): InstrumentState {
  if (state.assign?.source === source) return { ...state, assign: null }
  return { ...state, assign: { source, starts: {} } }
}

function panic(state: InstrumentState): InstrumentState {
  const values = { ...state.values, 'performance.pitch-stick': 0.5, 'performance.control-pedal': 0 }
  return { ...state, values, assign: null, panics: state.panics + 1 }
}

function tapTempo(state: InstrumentState, time: number): InstrumentState {
  const recent = state.taps.filter((tap) => time - tap <= TAP_WINDOW_MS)
  const taps = [...recent, time].slice(-TAP_COUNT)
  if (taps.length < TAP_COUNT) return { ...state, taps }
  const intervals = taps.slice(1).map((tap, index) => tap - taps[index])
  const average = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length
  const bpm = 60000 / average
  return panelAction({ ...state, taps }, { type: 'set', id: 'program.clock-bpm', value: knobFromBpm(bpm) })
}

export function instrumentReducer(state: InstrumentState, action: InstrumentAction): InstrumentState {
  switch (action.type) {
    case 'tap-tempo':
      return tapTempo(state, action.time)
    case 'morph-source':
      return action.clear ? { ...state, morphs: clearMorphSource(state.morphs, action.source), assign: null } : toggleAssign(state, action.source)
    case 'store-as-open':
      return { ...state, storeAs: { name: slotName(state, state.bank.selected) } }
    case 'store-as-name':
      return state.storeAs ? { ...state, storeAs: { name: action.name.slice(0, 16) } } : state
    case 'store-as-confirm': {
      if (!state.storeAs) return state
      const name = state.storeAs.name.trim() || slotName(state, state.bank.selected)
      return { ...store(state, name), storeAs: null }
    }
    case 'store-as-cancel':
      return { ...state, storeAs: null }
    case 'store-cancel':
      return { ...state, bank: { ...state.bank, storeArmed: false } }
    case 'panic':
      return panic(state)
    default:
      break
  }

  const bank = bankAction(state, action)
  if (bank) return bank
  // Everything else, including split, scene, clock, and transpose, is a panel value.
  return panelAction(state, action)
}

/** The slots the storage boundary keeps: the regular bank and the Live slots. */
export function persistedSlots(state: InstrumentState): { slots: (ProgramData | undefined)[]; live: (ProgramData | undefined)[] } {
  return { slots: state.bank.slots, live: state.bank.live }
}

import {
  ALL_LAYER_ADDRESSES, SPLIT_POSITIONS, type CrossfadeWidth, type InstrumentState,
  type LayerAddress, type MorphDestination, type MorphSource, type SceneId,
  type SplitPosition, type ZoneRange,
} from './instrument'

export interface ProgramSlot {
  id: number
  name: string
  state: InstrumentState
  factory: boolean
}

export interface ProgramMemoryState {
  programs: ProgramSlot[]
  live: ProgramSlot[]
  liveMode: boolean
  selectedProgram: number
  selectedLive: number
  page: number
  listOpen: boolean
  storeTarget: number | null
  naming: boolean
}

export interface ProgramStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const PROGRAM_STORAGE_KEY = 'stagebench.nord-stage-4.programs.v3'

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function normalizeRuntimeState(state: InstrumentState): InstrumentState {
  const captured = clone(state)
  captured.masterLevel = .72
  captured.sustainDown = false
  captured.pitchBend = 0
  captured.morphs.values = { wheel: 0, controlPedal: 0 }
  captured.morphs.editing = null
  return captured
}

export function captureProgram(state: InstrumentState): InstrumentState {
  return normalizeRuntimeState(state)
}

export function restoreProgram(saved: InstrumentState, runtime: InstrumentState): InstrumentState {
  const restored = clone(saved)
  restored.masterLevel = runtime.masterLevel
  restored.sustainDown = false
  restored.pitchBend = 0
  restored.morphs.values = { wheel: 0, controlPedal: 0 }
  restored.morphs.editing = null
  return restored
}

export function programFingerprint(state: InstrumentState): string {
  return JSON.stringify(normalizeRuntimeState(state))
}

export function isProgramDirty(state: InstrumentState, memory: ProgramMemoryState): boolean {
  if (memory.liveMode) return false
  return programFingerprint(state) !== programFingerprint(memory.programs[memory.selectedProgram].state)
}

function setEnabled(state: InstrumentState, address: LayerAddress, enabled: boolean): void {
  const [section, layer] = address.split(':') as ['organ' | 'piano' | 'synth', 'A' | 'B' | 'C']
  if (section === 'organ') state.organ.layers[layer as 'A' | 'B'].enabled = enabled
  else if (section === 'piano') state.layers[layer as 'A' | 'B'].enabled = enabled
  else state.synth.layers[layer].enabled = enabled
  state.scenes.layers[state.scenes.active][address] = enabled
}

function factoryProgram(base: InstrumentState, index: number): ProgramSlot {
  const state = clone(base)
  const names = ['Studio Grand', 'Upright + Air', 'B3 Gospel', 'Vox Continental', 'Farf Scene', 'Pipe Air', 'Super Split', 'FM Motion']
  for (const address of ALL_LAYER_ADDRESSES) setEnabled(state, address, false)
  switch (index) {
    case 0:
      setEnabled(state, 'piano:A', true)
      break
    case 1:
      state.layers.A.type = 'Upright'; state.layers.A.model = 'Felt Upright'; setEnabled(state, 'piano:A', true)
      state.synth.layers.A.waveform = 'Triangle'; state.synth.layers.A.category = 'Pure'; state.synth.layers.A.level = .24; state.synth.layers.A.ampEnvelope.attack = .46
      setEnabled(state, 'synth:A', true)
      break
    case 2:
      state.organ.layers.A.model = 'B3'; state.organ.layers.A.drawbars = [8, 8, 8, 5, 4, 3, 2, 2, 1]; state.organ.layers.A.percussion = true
      setEnabled(state, 'organ:A', true)
      break
    case 3:
      state.organ.layers.A.model = 'Vox'; state.organ.layers.A.drawbars = [8, 7, 4, 6, 5, 3, 2, 8, 0]
      setEnabled(state, 'organ:A', true)
      break
    case 4:
      state.organ.layers.A.model = 'Farf'; state.organ.layers.A.drawbars = [8, 0, 8, 8, 0, 8, 0, 8, 4]
      setEnabled(state, 'organ:A', true)
      state.scenes.layers.II['synth:A'] = true
      break
    case 5:
      state.organ.layers.A.model = 'Pipe 1'; state.organ.layers.A.drawbars = [8, 6, 8, 5, 4, 5, 2, 3, 4]
      setEnabled(state, 'organ:A', true)
      break
    case 6:
      setEnabled(state, 'piano:A', true); setEnabled(state, 'synth:A', true)
      state.splits.enabled = true
      state.splits.points[1] = { enabled: true, position: 'C4', crossfade: 6 }
      state.layers.A.zone = { from: 0, to: 1 }
      state.synth.layers.A.zone = { from: 2, to: 3 }
      state.synth.layers.A.category = 'Super'; state.synth.layers.A.waveform = 'Super Saw'
      break
    case 7:
      setEnabled(state, 'synth:A', true)
      state.synth.layers.A.category = 'FM-H'; state.synth.layers.A.waveform = 'FM 2-op (algorithm A)'; state.synth.layers.A.oscCtrl = .68
      state.synth.layers.A.arpRun = true; state.synth.layers.A.arpRange = 2; state.synth.layers.A.arpDirection = 'Up/Down'
      break
  }
  return { id: index, name: names[index], state: captureProgram(state), factory: true }
}

export function createProgramMemory(initial: InstrumentState): ProgramMemoryState {
  const programs = Array.from({ length: 32 }, (_, index) => index < 8
    ? factoryProgram(initial, index)
    : { id: index, name: `Init ${String(index + 1).padStart(2, '0')}`, state: captureProgram(initial), factory: false })
  const live = Array.from({ length: 8 }, (_, index) => ({ id: index, name: `Live ${index + 1}`, state: captureProgram(initial), factory: false }))
  return { programs, live, liveMode: false, selectedProgram: 0, selectedLive: 0, page: 0, listOpen: false, storeTarget: null, naming: false }
}

export function loadProgramMemory(initial: InstrumentState, storage?: ProgramStorageLike): ProgramMemoryState {
  const factory = createProgramMemory(initial)
  if (!storage) return factory
  try {
    const parsed = JSON.parse(storage.getItem(PROGRAM_STORAGE_KEY) ?? 'null') as { programs?: ProgramSlot[]; live?: ProgramSlot[] } | null
    if (parsed?.programs?.length === 32) factory.programs = parsed.programs
    if (parsed?.live?.length === 8) factory.live = parsed.live
  } catch {
    // Corrupt storage is ignored; factory memory remains playable.
  }
  return factory
}

export function saveProgramMemory(memory: ProgramMemoryState, storage?: ProgramStorageLike): void {
  if (!storage) return
  storage.setItem(PROGRAM_STORAGE_KEY, JSON.stringify({ programs: memory.programs, live: memory.live }))
}

export function selectProgram(memory: ProgramMemoryState, index: number): ProgramMemoryState {
  const selectedProgram = Math.max(0, Math.min(31, index))
  return { ...memory, liveMode: false, selectedProgram, page: Math.floor(selectedProgram / 8), listOpen: false, storeTarget: null, naming: false }
}

export function selectLive(memory: ProgramMemoryState, index: number): ProgramMemoryState {
  return { ...memory, liveMode: true, selectedLive: Math.max(0, Math.min(7, index)), listOpen: false, storeTarget: null, naming: false }
}

export function storeAt(memory: ProgramMemoryState, index: number, state: InstrumentState, name?: string): ProgramMemoryState {
  const programs = memory.programs.slice()
  const current = programs[index]
  programs[index] = { ...current, name: name?.trim() || current.name, state: captureProgram(state), factory: false }
  return { ...memory, programs, selectedProgram: index, page: Math.floor(index / 8), liveMode: false, storeTarget: null, naming: false }
}

export function autoStoreLive(memory: ProgramMemoryState, state: InstrumentState): ProgramMemoryState {
  if (!memory.liveMode) return memory
  const live = memory.live.slice()
  live[memory.selectedLive] = { ...live[memory.selectedLive], state: captureProgram(state) }
  return { ...memory, live }
}

export const currentSlot = (memory: ProgramMemoryState): ProgramSlot => memory.liveMode ? memory.live[memory.selectedLive] : memory.programs[memory.selectedProgram]

export const splitPositionMidi = (position: SplitPosition): number => {
  const octave = Number(position.slice(1))
  return 12 * (octave + 1) + (position.startsWith('F') ? 5 : 0)
}

function zoneForNote(state: InstrumentState, note: number): number {
  if (!state.splits.enabled) return 0
  const boundaries = state.splits.points.filter((point) => point.enabled).map((point) => splitPositionMidi(point.position)).sort((a, b) => a - b)
  return boundaries.reduce((zone, boundary) => zone + Number(note >= boundary), 0)
}

function crossfadeAtBoundary(note: number, boundary: number, width: CrossfadeWidth, entering: boolean): number {
  if (width === 0) return entering ? Number(note >= boundary) : Number(note < boundary)
  const low = boundary - width
  const high = boundary + width
  if (entering) {
    if (note <= low) return 0
    if (note >= high) return 1
    return (note - low) / (width * 2)
  }
  if (note <= low) return 1
  if (note >= high) return 0
  return (high - note) / (width * 2)
}

export function routeLayerGain(state: InstrumentState, range: ZoneRange | undefined, note: number): number {
  if (!state.splits.enabled || !range) return 1
  const active = state.splits.points.filter((point) => point.enabled).sort((a, b) => splitPositionMidi(a.position) - splitPositionMidi(b.position))
  const zone = zoneForNote(state, note)
  if (zone >= range.from && zone <= range.to) {
    let gain = 1
    if (zone === range.from && range.from > 0) {
      const boundary = active[range.from - 1]
      if (boundary) gain = Math.min(gain, crossfadeAtBoundary(note, splitPositionMidi(boundary.position), boundary.crossfade, true))
    }
    if (zone === range.to && range.to < active.length) {
      const boundary = active[range.to]
      if (boundary) gain = Math.min(gain, crossfadeAtBoundary(note, splitPositionMidi(boundary.position), boundary.crossfade, false))
    }
    return gain
  }
  if (zone === range.from - 1 && range.from > 0) {
    const boundary = active[range.from - 1]
    return boundary ? crossfadeAtBoundary(note, splitPositionMidi(boundary.position), boundary.crossfade, true) : 0
  }
  if (zone === range.to + 1 && range.to < active.length) {
    const boundary = active[range.to]
    return boundary ? crossfadeAtBoundary(note, splitPositionMidi(boundary.position), boundary.crossfade, false) : 0
  }
  return 0
}

export function setLayerEnabled(state: InstrumentState, address: LayerAddress, enabled: boolean): InstrumentState {
  const next = clone(state)
  setEnabled(next, address, enabled)
  return next
}

export function switchScene(state: InstrumentState, scene: SceneId): InstrumentState {
  const next = clone(state)
  next.scenes.active = scene
  for (const address of ALL_LAYER_ADDRESSES) setEnabled(next, address, next.scenes.layers[scene][address])
  return next
}

export function assignMorph(state: InstrumentState, source: MorphSource, destination: MorphDestination, start: number, end: number): InstrumentState {
  const assignments = state.morphs.assignments[source].filter((item) => item.destination !== destination)
  if (Math.abs(start - end) > .0001) assignments.push({ destination, start, end })
  return { ...state, morphs: { ...state.morphs, assignments: { ...state.morphs.assignments, [source]: assignments } } }
}

export function clearMorph(state: InstrumentState, source: MorphSource): InstrumentState {
  return { ...state, morphs: { ...state.morphs, assignments: { ...state.morphs.assignments, [source]: [] }, editing: state.morphs.editing === source ? null : state.morphs.editing } }
}

export function morphedValue(state: InstrumentState, destination: MorphDestination, base: number): number {
  let value = base
  for (const source of ['wheel', 'controlPedal'] as MorphSource[]) {
    const assignment = state.morphs.assignments[source].find((item) => item.destination === destination)
    if (assignment) value += (assignment.end - assignment.start) * state.morphs.values[source]
  }
  return Math.max(0, Math.min(1, value))
}

export function tempoFromTaps(taps: number[]): number | null {
  if (taps.length < 4) return null
  const recent = taps.slice(-5)
  const intervals = recent.slice(1).map((value, index) => value - recent[index]).filter((value) => value > 100 && value < 2100)
  if (intervals.length < 3) return null
  const average = intervals.reduce((sum, value) => sum + value, 0) / intervals.length
  return Math.max(30, Math.min(300, Math.round(60_000 / average)))
}

export function arpSequence(notes: number[], direction: 'Up' | 'Down' | 'Up/Down' | 'Random', range: number, steps: number): number[] {
  const sorted = [...new Set(notes)].sort((a, b) => a - b)
  if (sorted.length === 0) return []
  const expanded = Array.from({ length: Math.max(1, range) }, (_, octave) => sorted.map((note) => note + octave * 12)).flat()
  const ordered = direction === 'Down' ? [...expanded].reverse()
    : direction === 'Up/Down' ? [...expanded, ...expanded.slice(1, -1).reverse()]
      : expanded
  let seed = sorted.reduce((sum, note) => sum * 31 + note, 17)
  return Array.from({ length: steps }, (_, index) => {
    if (direction !== 'Random') return ordered[index % ordered.length]
    seed = (seed * 16807) % 2147483647
    return expanded[seed % expanded.length]
  })
}

export function cycleSplitPosition(position: SplitPosition): SplitPosition {
  return SPLIT_POSITIONS[(SPLIT_POSITIONS.indexOf(position) + 1) % SPLIT_POSITIONS.length]
}

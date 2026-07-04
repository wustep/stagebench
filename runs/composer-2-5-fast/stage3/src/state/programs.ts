import {
  createEmptySlot,
  createSerializableState,
  defaultLayerScene,
  defaultOrganLayer,
  defaultOrganState,
  defaultSynthLayer,
  defaultSynthState,
  type LayerSceneConfig,
  type ProgramSlot,
  type ProgramSystemState,
  type SerializableProgramState,
} from '../audio/program-types'
import type { InstrumentAudioState } from '../audio/types'
import { defaultInstrumentState } from '../audio/types'

const STORAGE_KEY = 'stagebench-programs-v1'

export function createProgramSystem(): ProgramSystemState {
  const slots = Array.from({ length: 32 }, (_, i) => createEmptySlot(i))
  const liveSlots = Array.from({ length: 8 }, (_, i) => ({
    name: `Live ${i + 1}`,
    state: createSerializableState(),
  }))
  seedFactoryPrograms(slots)
  return {
    slots,
    liveSlots,
    currentPage: 0,
    currentButton: 0,
    liveMode: false,
    dirty: false,
    activeScene: 'I',
    sceneI: defaultLayerScene(),
    sceneII: { ...defaultLayerScene(), pianoA: false, organA: true, synthA: true },
    split: createSerializableState().split,
    zones: createSerializableState().zones,
    morph: createSerializableState().morph,
    clock: createSerializableState().clock,
    performance: createSerializableState().performance,
    storeMode: 'idle',
    storeAsName: '',
    listViewOpen: false,
  }
}

function seedFactoryPrograms(slots: ProgramSlot[]): void {
  const factories: Array<{ name: string; patch: Partial<SerializableProgramState> }> = [
    { name: 'Grand Solo', patch: { pianoPerf: { ...defaultInstrumentState().pianoPerf, sectionOn: true } } },
    { name: 'B3 Jazz', patch: { organ: { ...defaultOrganState(), layerA: defaultOrganLayer(true, 'B3') } } },
    { name: 'Vox Combo', patch: { organ: { ...defaultOrganState(), layerA: defaultOrganLayer(true, 'Vox') } } },
    { name: 'Super Stack', patch: { synth: { ...defaultSynthState(), layerA: { ...defaultSynthLayer(true), category: 'Super', waveformIndex: 0 } } } },
    { name: 'Piano Organ', patch: { pianoPerf: { ...defaultInstrumentState().pianoPerf, sectionOn: true }, organ: defaultOrganState() } },
    { name: 'Split Stack', patch: { split: { enabled: true, low: { positionIndex: 4, crossfade: 6 }, mid: { positionIndex: 4, crossfade: 6 }, high: { positionIndex: 8, crossfade: 0 } } } },
    { name: 'Pipe Cathedral', patch: { organ: { ...defaultOrganState(), layerA: defaultOrganLayer(true, 'Pipe') } } },
    { name: 'FM Lead', patch: { synth: { ...defaultSynthState(), layerA: { ...defaultSynthLayer(true), category: 'FM-H', waveformIndex: 0 } } } },
  ]
  factories.forEach((f, i) => {
    slots[i] = { name: f.name, state: createSerializableState(f.patch) }
  })
}

export function programIndex(page: number, button: number): number {
  return page * 8 + button
}

export function formatProgramLabel(page: number, button: number, name: string): string {
  return `${page + 1}.${button + 1} ${name}`
}

export function audioToSerializable(audio: InstrumentAudioState): SerializableProgramState {
  const { masterLevel: _ml, ...rest } = audio
  return structuredClone(rest)
}

export function applySerializableToAudio(
  audio: InstrumentAudioState,
  serial: SerializableProgramState,
): InstrumentAudioState {
  return {
    ...structuredClone(serial),
    masterLevel: audio.masterLevel,
  }
}

export function loadCurrentSlot(system: ProgramSystemState): ProgramSlot {
  const idx = programIndex(system.currentPage, system.currentButton)
  return system.liveMode ? system.liveSlots[idx % 8]! : system.slots[idx]!
}

export function saveToSlotIndex(
  system: ProgramSystemState,
  index: number,
  serial: SerializableProgramState,
  name?: string,
): ProgramSystemState {
  const page = Math.floor(index / 8)
  const button = index % 8
  const withSelection = selectProgram(system, page, button, true).system
  return saveToCurrentSlot(withSelection, serial, name)
}

export function saveToCurrentSlot(
  system: ProgramSystemState,
  serial: SerializableProgramState,
  name?: string,
): ProgramSystemState {
  const idx = programIndex(system.currentPage, system.currentButton)
  if (system.liveMode) {
    const live = [...system.liveSlots]
    live[idx % 8] = { name: name ?? live[idx % 8]!.name, state: structuredClone(serial) }
    return { ...system, liveSlots: live, dirty: false }
  }
  const slots = [...system.slots]
  slots[idx] = { name: name ?? slots[idx]!.name, state: structuredClone(serial) }
  return { ...system, slots, dirty: false }
}

export function selectProgram(
  system: ProgramSystemState,
  page: number,
  button: number,
  discardEdits: boolean,
): { system: ProgramSystemState; discarded: boolean } {
  if (system.dirty && !discardEdits) {
    return { system, discarded: false }
  }
  return {
    system: {
      ...system,
      currentPage: page,
      currentButton: button,
      dirty: false,
      listViewOpen: false,
    },
    discarded: system.dirty && discardEdits,
  }
}

export function markDirty(system: ProgramSystemState): ProgramSystemState {
  if (system.dirty) return system
  return { ...system, dirty: true }
}

export function autoStoreLive(
  system: ProgramSystemState,
  serial: SerializableProgramState,
): ProgramSystemState {
  if (!system.liveMode) return system
  return saveToCurrentSlot(system, serial)
}

export function activeSceneLayers(system: ProgramSystemState): LayerSceneConfig {
  return system.activeScene === 'I' ? system.sceneI : system.sceneII
}

export function persistPrograms(system: ProgramSystemState, storage: Storage = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ slots: system.slots, liveSlots: system.liveSlots }))
}

export function restorePrograms(system: ProgramSystemState, storage: Storage = localStorage): ProgramSystemState {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return system
    const parsed = JSON.parse(raw) as { slots?: ProgramSlot[]; liveSlots?: ProgramSlot[] }
    return {
      ...system,
      slots: parsed.slots?.length === 32 ? parsed.slots : system.slots,
      liveSlots: parsed.liveSlots?.length === 8 ? parsed.liveSlots : system.liveSlots,
    }
  } catch {
    return system
  }
}

export function storeAsConfirm(system: ProgramSystemState, name: string): ProgramSystemState {
  return { ...system, storeAsName: name, storeMode: 'select' }
}

export function numericListPrograms(system: ProgramSystemState): string[] {
  return system.slots.map((slot, i) => {
    const page = Math.floor(i / 8)
    const btn = i % 8
    return formatProgramLabel(page, btn, slot.name)
  })
}

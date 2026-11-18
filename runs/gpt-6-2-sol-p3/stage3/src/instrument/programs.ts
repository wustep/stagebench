import { focusLayer, initialSettings, setLayer } from '../piano/settings'
import type { Settings } from '../piano/settings'
import { clamp, layerKeys, splitNotes } from './parameters'
import type { LayerKey, LayerParameters, SplitId, SplitPoint } from './parameters'

export type Program = Omit<Settings, 'master' | 'pitch' | 'performance'>
export interface Slot { name: string; sound: Program }
export type Bank = 'programs' | 'live'
export interface Location { bank: Bank; index: number }
export interface Library { version: 1; programs: Slot[]; live: Slot[] }
export const libraryKey = 'stage-4-73.program-library.v1'
export type ProgramStorage = Pick<Storage, 'getItem' | 'setItem'>

export function capture({ master: _master, pitch: _pitch, performance: _performance, ...program }: Settings): Program {
  return program
}

export function recall(sound: Program, state: Settings): Settings {
  return { ...structuredClone(sound), master: state.master, pitch: state.pitch, performance: state.performance }
}

export function edited(state: Settings, slot: Slot) {
  // Canonical patches may add a previously absent optional field. Compare the
  // serialized sound with sorted keys so editing it back clears the marker.
  const ordered = (_: string, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value
  return JSON.stringify(capture(state), ordered) !== JSON.stringify(slot.sound, ordered)
}

export function address({ bank, index }: Location) {
  return bank === 'live' ? `LIVE ${index + 1}` : `${Math.floor(index / 8) + 1}.${index % 8 + 1}`
}

export function layerAt(state: Settings, key: LayerKey): LayerParameters {
  switch (key) {
    case 'pianoA': case 'pianoB': return state.layers[key === 'pianoA' ? 'A' : 'B']
    case 'organA': case 'organB': return state.organ.layers[key === 'organA' ? 'A' : 'B']
    case 'synthA': return state.synth.layers.A
    case 'synthB': return state.synth.layers.B
    case 'synthC': return state.synth.layers.C
  }
}

export function editLayer(state: Settings, key: LayerKey, patch: Partial<LayerParameters>): Settings {
  switch (key) {
    case 'pianoA': case 'pianoB': return setLayer(state, key === 'pianoA' ? 'A' : 'B', patch)
    case 'organA': case 'organB': {
      const id = key === 'organA' ? 'A' : 'B'
      return { ...state, organ: { ...state.organ, layers: { ...state.organ.layers, [id]: { ...state.organ.layers[id], ...patch } } } }
    }
    default: {
      const id = key === 'synthA' ? 'A' : key === 'synthB' ? 'B' : 'C'
      return { ...state, synth: { ...state.synth, layers: { ...state.synth.layers, [id]: { ...state.synth.layers[id], ...patch } } } }
    }
  }
}

export function switchScene(state: Settings): Settings {
  const otherScene = { ...state.otherScene }
  let next = state
  for (const key of layerKeys) {
    otherScene[key] = layerAt(state, key).on
    next = editLayer(next, key, { on: state.otherScene[key] })
  }
  return { ...next, scene: state.scene === 'I' ? 'II' : 'I', otherScene }
}

export function editSplit(state: Settings, id: SplitId, patch: Partial<SplitPoint>): Settings {
  const point = { ...state.splits[id], ...patch }
  if (point.note !== null && (!splitNotes.some((note) => note === point.note) ||
      Object.entries(state.splits).some(([key, other]) => key !== id && other.note === point.note))) return state
  return { ...state, splits: { ...state.splits, [id]: point } }
}

export function toggleSplit(state: Settings): Settings {
  if (Object.values(state.splits).some(({ note }) => note !== null)) {
    // Retain crossfade values when the split is temporarily turned off.
    let next = state
    for (const id of ['Low', 'Mid', 'High'] as const) next = editSplit(next, id, { note: null })
    return next
  }
  return editSplit(state, 'Mid', { note: 60 })
}

export function editTempo(state: Settings, bpm: number): Settings {
  return { ...state, effects: { ...state.effects, clockBpm: clamp(Math.round(bpm), 30, 300) } }
}

function factorySlots(): Slot[] {
  const state = initialSettings()
  const grand = setLayer(state, 'A', { type: 'Grand' })
  const tine = setLayer(state, 'A', { type: 'Electric', timbre: 'Dyno 1' })
  const soul = {
    ...state, on: false, organ: { ...state.organ, on: true },
    effects: { ...state.effects, focus: 'Organ' as const, rotary: { ...state.effects.rotary, on: true } },
  }
  const farf = structuredClone(soul)
  farf.organ.layers.A.model = 'Farf'
  farf.effects.rotary.on = false
  const pad = { ...state, on: false, synth: { ...state.synth, on: true }, effects: { ...state.effects, focus: 'Synth' as const } }
  const split = editLayer(editLayer(editSplit({ ...soul, on: true }, 'Mid', { note: 60, fade: 6 }),
    'organA', { zone: [0, 0] }), 'pianoA', { zone: [1, 3] })
  const layered = { ...grand, synth: { ...pad.synth, layers: { ...pad.synth.layers, A: { ...pad.synth.layers.A, level: 7 } } } }
  const pulse = structuredClone(pad)
  pulse.synth.layers.A.category = 'FM-H'
  pulse.synth.layers.A.arp = { ...pulse.synth.layers.A.arp, run: true, sync: true, range: 1 }
  const names = ['Studio Upright', 'Concert Grand', 'Tine Stack', 'B3 Soulful', 'Combo Reed', 'Vista Pad', 'Organ / Piano', 'Grand & Strings', 'FM Pulse']
  const sounds = [state, grand, tine, soul, farf, pad, split, layered, pulse]
  return Array.from({ length: 32 }, (_, index) => ({
    name: names[index] ?? `Init ${index + 1}`,
    sound: capture(structuredClone(sounds[index] ?? focusLayer(state, 'A'))),
  }))
}

export function loadLibrary(storage?: ProgramStorage): Library {
  const programs = factorySlots()
  const defaults: Library = {
    version: 1, programs,
    live: Array.from({ length: 8 }, (_, index) => ({ name: `Live ${index + 1}`, sound: structuredClone(programs[0].sound) })),
  }
  try {
    const raw = storage?.getItem(libraryKey)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Library
    if (parsed.version !== defaults.version) return defaults
    for (const bank of ['programs', 'live'] as const) {
      if (!Array.isArray(parsed[bank])) continue
      defaults[bank] = defaults[bank].map((slot, index) => {
        const stored = parsed[bank][index]
        return typeof stored?.name === 'string' && stored.sound?.synth?.layers && stored.sound?.organ?.layers &&
          stored.sound?.effects && stored.sound?.layers ? stored : slot
      })
    }
  } catch {
    return defaults
  }
  return defaults
}

export function saveSlot(library: Library, location: Location, slot: Slot): Library {
  return { ...library, [location.bank]: library[location.bank].map((previous, index) =>
    index === location.index ? { name: slot.name, sound: structuredClone(slot.sound) } : previous) }
}

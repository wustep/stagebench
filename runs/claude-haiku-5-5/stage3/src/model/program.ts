// Programs: one bank of 32 stored slots (4 pages of 8) and 8 Live slots. A program is the canonical
// state of the instrument, serialized as plain JSON, so storing and recalling one restores every
// supported setting, split, scene, morph, clock value, and transpose.
//
// Master Level, the performance inputs, and the bank's own selection are not program state
// (programs.json `programState.excludes`).

import { initialPresentation, isLayerScoped, LAYER_ON_IDS, layerKey, layersOf, sceneKey, scopeOf, type PresentationState } from './hardware'
import { EMPTY_MORPHS, type MorphMap, MORPH_SOURCES, type MorphAssignment } from './morph'

export const PROGRAM_SLOTS = 32
export const PROGRAM_PAGES = 4
export const LIVE_SLOTS = 8

/** Presentation keys that are never saved in a program. */
const EXCLUDED_KEYS = new Set([
  'performance.master-level',
  'performance.mod-wheel',
  'performance.pitch-stick',
  'performance.control-pedal',
  'performance.rotary-brake',
  'program.dial',
  'program.store',
  'program.tap',
  'program.panic',
  'program.live-mode',
  'program.page-up',
  'program.page-down',
  'program.morph-1',
  'program.morph-2',
  'program.morph-3',
])

/** Program-section keys that are part of the program: splits, zones, scenes, clock, and transpose. */
const PROGRAM_KEYS = /^(program\.(split|xfade-|clock-bpm|clock-sync|transpose|layer-scene|scene)|scene\.)/

export function isProgramKey(key: string): boolean {
  if (EXCLUDED_KEYS.has(key)) return false
  if (key.startsWith('program.') || key.startsWith('scene.')) return PROGRAM_KEYS.test(key)
  return true
}

export interface ProgramData {
  name: string
  /** Canonical panel values, restricted to program keys. */
  values: Record<string, number>
  morphs: MorphMap
}

export interface ProgramBank {
  /** Regular slots, index 0 to 31. Undefined means the slot was never stored. */
  slots: (ProgramData | undefined)[]
  live: (ProgramData | undefined)[]
  /** The loaded regular program, 0 to 31. */
  selected: number
  /** The page shown on the Program buttons, 0 to 3. */
  page: number
  liveMode: boolean
  /** The loaded Live slot, 0 to 7, while Live Mode is on. */
  liveSelected: number
  /** STORE was pressed once: the next program button picks the destination, and STORE again confirms. */
  storeArmed: boolean
  /** Snapshot of the loaded program's canonical values, for the dirty indicator. */
  loaded: string
}

/** Canonical values of one state: the program keys only, with a stable key order. */
export function programValues(values: PresentationState): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of Object.keys(values).sort()) {
    if (isProgramKey(key)) out[key] = values[key]
  }
  return out
}

export function captureProgram(values: PresentationState, morphs: MorphMap, name: string): ProgramData {
  return { name, values: programValues(values), morphs }
}

/** Applies a program over the current state. Keys the program does not carry keep their current value. */
export function applyProgram(values: PresentationState, program: ProgramData): PresentationState {
  return { ...values, ...program.values }
}

/** Serialized canonical state, compared against the loaded snapshot to decide whether the program is edited. */
export function snapshotOf(values: PresentationState, morphs: MorphMap): string {
  return JSON.stringify({ values: programValues(values), morphs })
}

export function isDirty(values: PresentationState, morphs: MorphMap, bank: ProgramBank): boolean {
  return snapshotOf(values, morphs) !== bank.loaded
}

/** The Program display's number for a regular slot: page.button, for example 3.2. */
export function slotLabel(index: number): string {
  return `${Math.floor(index / 8) + 1}.${(index % 8) + 1}`
}

/** Factory programs. Each one is the initial panel with the listed overrides, so it stays a valid program. */
const FACTORY_DEFINITIONS: readonly { name: string; overrides: Readonly<Record<string, number>> }[] = [
  { name: 'Grand Piano', overrides: { 'piano.type': 0, 'organ.layer-a-on': 0, 'synth.layer-a-on': 0 } },
  {
    name: 'Upright Layers',
    overrides: { 'piano.type': 1, 'piano.layer-b-on': 1, 'organ.layer-a-on': 0, 'synth.layer-a-on': 0 },
  },
  {
    name: 'Electric Stage',
    overrides: {
      'piano.type': 2,
      'piano.timbre': 0.4,
      'organ.layer-a-on': 0,
      'synth.layer-a-on': 0,
      'effects.mod1-on': 1,
      'effects.mod1-type': 1,
      'effects.reverb-on': 1,
    },
  },
  {
    name: 'B3 Full',
    overrides: {
      'piano.layer-a-on': 0,
      'synth.layer-a-on': 0,
      'organ.drawbar-16': 1,
      'organ.drawbar-5-1-3': 1,
      'organ.drawbar-8': 1,
      'organ.drawbar-4': 1,
      'organ.drawbar-2-2-3': 0.6,
      'organ.drawbar-2': 0.5,
      'organ.drawbar-1-3-5': 0.3,
      'organ.drawbar-1-1-3': 0.2,
      'organ.drawbar-1': 0.2,
      'organ.perc-on': 1,
      'organ.vib-on': 1,
      'organ.vib-type': 3,
      'performance.rotary-organ': 1,
    },
  },
  {
    name: 'Vox and Farf',
    overrides: {
      'piano.layer-a-on': 0,
      'synth.layer-a-on': 0,
      'organ.model-b3@A': 0,
      'organ.model-vox@A': 1,
      'organ.model-b3@B': 0,
      'organ.model-farf@B': 1,
      'organ.layer-b-on': 1,
    },
  },
  {
    name: 'Pipe Church',
    overrides: {
      'piano.layer-a-on': 0,
      'synth.layer-a-on': 0,
      'organ.model-b3': 0,
      'organ.model-pipe-1': 1,
      'organ.drawbar-8': 1,
      'organ.drawbar-4': 0.8,
      'organ.drawbar-2': 0.5,
      'organ.drawbar-1': 0.3,
      'effects.reverb-on': 1,
      'effects.reverb-type': 4,
    },
  },
  {
    name: 'Super Pad',
    overrides: {
      'piano.layer-a-on': 0,
      'organ.layer-a-on': 0,
      'synth.osc-type@A': 11,
      'synth.filter-cutoff@A': 0.5,
      'synth.env-attack@A': 0.4,
      'synth.lfo-to-filter@A': 1,
      'synth.lfo-amount@A': 0.3,
      'effects.reverb-on': 1,
      'effects.reverb-type': 4,
    },
  },
  {
    name: 'Mono Lead',
    overrides: {
      'piano.layer-a-on': 0,
      'organ.layer-a-on': 0,
      'synth.osc-type@A': 2,
      'synth.voice-mode@A': 1,
      'synth.voice-glide@A': 0.5,
      'synth.filter-type@A': 1,
      'synth.filter-cutoff@A': 0.6,
    },
  },
  {
    name: 'Organ and Piano Split',
    overrides: {
      'synth.layer-a-on': 0,
      'program.split': 1,
      'program.split-mid': 5,
      'program.xfade-mid': 2,
      'organ.layer-a-zone': 0,
      'piano.layer-a-zone': 8,
      'organ.layer-a-on': 1,
      'piano.layer-a-on': 1,
    },
  },
]

/** Builds a factory program from the initial panel. Layer-scene records are set to match the layer enable switches. */
function factoryProgram(name: string, overrides: Readonly<Record<string, number>>): ProgramData {
  const values: Record<string, number> = { ...initialPresentation() }
  for (const [key, value] of Object.entries(overrides)) {
    // A scoped control without a layer suffix sets every layer of its scope.
    if (!key.includes('@') && isLayerScoped(key)) {
      for (const layer of layersOf(scopeOf(key)!)) values[layerKey(key, layer)] = value
    } else {
      values[key] = value
    }
  }
  for (const id of LAYER_ON_IDS) {
    values[sceneKey(0, id)] = values[id]
    values[sceneKey(1, id)] = values[id]
  }
  return captureProgram(values, EMPTY_MORPHS, name)
}

export const FACTORY_PROGRAMS: readonly ProgramData[] = FACTORY_DEFINITIONS.map((entry) => factoryProgram(entry.name, entry.overrides))

/** A bank with the factory programs in the first slots and the Live slots empty. */
export function initialBank(values: PresentationState, morphs: MorphMap): ProgramBank {
  const slots: (ProgramData | undefined)[] = Array.from({ length: PROGRAM_SLOTS }, (_, index) => FACTORY_PROGRAMS[index])
  const first = slots[0]!
  return {
    slots,
    live: Array.from({ length: LIVE_SLOTS }, () => undefined),
    selected: 0,
    page: 0,
    liveMode: false,
    liveSelected: 0,
    storeArmed: false,
    loaded: snapshotOf(applyProgram(values, first), morphs),
  }
}

/** Morph assignments that a program carries, sanitized to the two sources. */
export function sourceMorphs(morphs: Partial<Record<string, readonly MorphAssignment[]>> | undefined): MorphMap {
  const out = { wheel: [] as MorphAssignment[], pedal: [] as MorphAssignment[] }
  for (const source of MORPH_SOURCES) {
    const list = morphs?.[source]
    if (Array.isArray(list)) out[source] = list.filter(isAssignment)
  }
  return out
}

function isAssignment(value: unknown): value is MorphAssignment {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.key === 'string' && typeof candidate.start === 'number' && typeof candidate.end === 'number'
}

/** Sanitizes a stored program read back from storage. Anything malformed is dropped rather than loaded. */
export function parseProgram(value: unknown): ProgramData | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as Record<string, unknown>
  if (typeof candidate.name !== 'string' || typeof candidate.values !== 'object' || candidate.values === null) return undefined
  const values: Record<string, number> = {}
  for (const [key, entry] of Object.entries(candidate.values as Record<string, unknown>)) {
    if (typeof entry === 'number' && Number.isFinite(entry) && isProgramKey(key)) values[key] = entry
  }
  return { name: candidate.name, values, morphs: sourceMorphs(candidate.morphs as Record<string, MorphAssignment[]> | undefined) }
}

/**
 * Storage boundary for stored programs. The browser uses localStorage; tests use a map. Every call is
 * guarded, because storage can be blocked, full, or absent, and the instrument must keep working without it.
 */
export interface ProgramStorage {
  read(key: string): string | null
  write(key: string, value: string): void
}

export const PROGRAM_STORAGE_KEY = 'stagebench.stage4.programs.v1'

/** The browser's storage, or a null store when it is blocked or missing. */
export function browserProgramStorage(): ProgramStorage {
  return {
    read(key) {
      try {
        return globalThis.localStorage?.getItem(key) ?? null
      } catch {
        return null
      }
    },
    write(key, value) {
      try {
        globalThis.localStorage?.setItem(key, value)
      } catch {
        // Blocked or full storage: the program stays in memory for this session.
      }
    },
  }
}

/** Reads the stored slots and Live slots. Missing or malformed data gives an empty bank. */
export function loadStoredSlots(storage: ProgramStorage): { slots: (ProgramData | undefined)[]; live: (ProgramData | undefined)[] } | undefined {
  const raw = storage.read(PROGRAM_STORAGE_KEY)
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as { slots?: unknown[]; live?: unknown[] }
    const slots = Array.from({ length: PROGRAM_SLOTS }, (_, index) => parseProgram(parsed.slots?.[index]))
    const live = Array.from({ length: LIVE_SLOTS }, (_, index) => parseProgram(parsed.live?.[index]))
    return { slots, live }
  } catch {
    return undefined
  }
}

export function saveSlots(storage: ProgramStorage, bank: Pick<ProgramBank, 'slots' | 'live'>): void {
  storage.write(PROGRAM_STORAGE_KEY, JSON.stringify({ slots: bank.slots, live: bank.live }))
}

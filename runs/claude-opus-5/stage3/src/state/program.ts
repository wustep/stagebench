import { CONTROLS } from '../model/controls'
import { LAYER_KEYS, type LayerKey } from '../audio/settings'

/**
 * The canonical, serializable program.
 *
 * One `ProgramSnapshot` is the entire instrument minus Master Level, which the programs spec
 * explicitly excludes (`programState.excludes`). Storing is `snapshotOf(deck)`, recalling is
 * `applySnapshot(deck, snapshot)`, and the dirty `E` indicator is literally
 * `!snapshotsEqual(current, stored)` — a computed fact, never a flag someone remembered to set.
 */

export const PROGRAM_SLOTS = 32
export const PROGRAM_PAGES = 4
export const PROGRAMS_PER_PAGE = 8
export const LIVE_SLOTS = 8
export const NAME_LENGTH = 16

/**
 * Controls a program does not store.
 *
 * Master Level is excluded by the programs spec itself (`programState.excludes`). The rest are
 * not sound state at all: live performance inputs (the wheel and the pitch stick), panel-mode
 * selectors (the Program dial position, Live Mode, Prog View, the two SHIFT keys) and every
 * momentary button, which by definition latches nothing.
 */
export const NON_PROGRAM_CONTROL_IDS: readonly string[] = [
  'perf.master-level',
  'perf.mod-wheel',
  'perf.pitch-stick',
  'program.dial',
  'program.live-mode',
  'program.prog-view',
  'program.shift',
  'fx.shift',
]

export type MorphSource = 'wheel' | 'pedal'
export type SceneId = 'I' | 'II'
export type FxSection = 'organ' | 'piano' | 'synth'
/** Which parameter set the three dials under the Synth OLED are editing. */
export type MenuPage = 'osc' | 'oscEnv' | 'filterEnv' | 'ampEnv'

export interface SplitPoint {
  /** MIDI note of the split point; one of `SPLIT_POSITIONS`. */
  readonly note: number
  /** Crossfade half-width in semitones: 0 (hard), 6 or 12 (programs spec). */
  readonly crossfade: 0 | 6 | 12
  /** Whether this point currently divides the keyboard. Three points give up to four zones. */
  readonly enabled: boolean
}

/** The eleven documented split positions (programs spec, `split.possiblePositions`). */
export const SPLIT_POSITIONS: readonly number[] = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96]
export const SPLIT_POSITION_NAMES: readonly string[] = [
  'C2',
  'F2',
  'C3',
  'F3',
  'C4',
  'F4',
  'C5',
  'F5',
  'C6',
  'F6',
  'C7',
]
export const CROSSFADE_WIDTHS: readonly (0 | 6 | 12)[] = [0, 6, 12]

export interface MorphAssignment {
  readonly from: number
  readonly to: number
}

export interface ProgramSnapshot {
  readonly name: string
  readonly values: Readonly<Record<string, number>>
  readonly banks: Readonly<Record<LayerKey, Readonly<Record<string, number>>>>
  readonly octaves: Readonly<Record<LayerKey, number>>
  readonly focus: { readonly organ: 'a' | 'b'; readonly piano: 'a' | 'b'; readonly synth: 'a' | 'b' | 'c' }
  readonly fxSection: FxSection
  readonly group: boolean
  readonly globals: Readonly<Record<string, boolean>>
  readonly menu: Readonly<Record<MenuPage, readonly number[]>>
  readonly menuPage: MenuPage
  readonly synthExtra: Readonly<Record<string, Readonly<Record<string, number>>>>
  readonly split: { readonly on: boolean; readonly points: readonly SplitPoint[] }
  /** Zone index range each layer answers to, 0–3 inclusive. */
  readonly zones: Readonly<Record<LayerKey, { readonly from: number; readonly to: number }>>
  readonly scene: SceneId
  readonly scenes: Readonly<Record<SceneId, Readonly<Record<LayerKey, boolean>>>>
  readonly morphs: Readonly<Record<MorphSource, Readonly<Record<string, MorphAssignment>>>>
  readonly clock: { readonly bpm: number; readonly keyboardSync: boolean }
  readonly transpose: number
}

/** The control ids a program stores. */
export function programControlIds(): readonly string[] {
  return CONTROLS.filter((spec) => !spec.momentary && !NON_PROGRAM_CONTROL_IDS.includes(spec.id)).map(
    (spec) => spec.id,
  )
}

export function emptyZones(): Record<LayerKey, { from: number; to: number }> {
  const zones = {} as Record<LayerKey, { from: number; to: number }>
  for (const key of LAYER_KEYS) zones[key] = { from: 0, to: 3 }
  return zones
}

export function defaultSplitPoints(): SplitPoint[] {
  return [
    { note: 48, crossfade: 0, enabled: false },
    { note: 60, crossfade: 0, enabled: false },
    { note: 72, crossfade: 0, enabled: false },
  ]
}

/** Structural equality, used for the dirty indicator and for round-trip assertions. */
export function snapshotsEqual(a: ProgramSnapshot | null, b: ProgramSnapshot | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return stableString(a) === stableString(b)
}

/** JSON with sorted keys, so equality does not depend on insertion order. */
export function stableString(value: unknown): string {
  return JSON.stringify(sortDeep(value))
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1))
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortDeep(entry)]))
  }
  return value
}

/* ------------------------------------------------------------------ naming */

export const NAME_ALPHABET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-+.'

export function characterAt(index: number): string {
  const size = NAME_ALPHABET.length
  return NAME_ALPHABET[((Math.round(index) % size) + size) % size]
}

export function characterIndex(character: string): number {
  const found = NAME_ALPHABET.indexOf(character)
  return found < 0 ? 0 : found
}

/* ------------------------------------------------------------------ addressing */

export function pageOf(slot: number): number {
  return Math.floor(clampSlot(slot) / PROGRAMS_PER_PAGE)
}

export function buttonOf(slot: number): number {
  return clampSlot(slot) % PROGRAMS_PER_PAGE
}

export function slotLabel(slot: number): string {
  return `${pageOf(slot) + 1}.${buttonOf(slot) + 1}`
}

export function clampSlot(slot: number): number {
  return Math.min(PROGRAM_SLOTS - 1, Math.max(0, Math.round(slot)))
}

/* ------------------------------------------------------------------ persistence */

/** Storage boundary, so the Live-slot round trip is testable without a browser. */
export interface SnapshotStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const LIVE_STORAGE_KEY = 'stagebench.live-slots.v1'

export function readLiveSlots(store: SnapshotStore | null): (ProgramSnapshot | null)[] {
  if (!store) return Array.from<ProgramSnapshot | null>({ length: LIVE_SLOTS }).fill(null)
  try {
    const raw = store.getItem(LIVE_STORAGE_KEY)
    if (!raw) return Array.from<ProgramSnapshot | null>({ length: LIVE_SLOTS }).fill(null)
    const parsed = JSON.parse(raw) as (ProgramSnapshot | null)[]
    if (!Array.isArray(parsed)) return Array.from<ProgramSnapshot | null>({ length: LIVE_SLOTS }).fill(null)
    const slots = Array.from<ProgramSnapshot | null>({ length: LIVE_SLOTS }).fill(null)
    for (let index = 0; index < LIVE_SLOTS; index += 1) slots[index] = parsed[index] ?? null
    return slots
  } catch {
    // Corrupt or unreadable storage is reported by falling back to empty Live slots, never by
    // inventing content.
    return Array.from<ProgramSnapshot | null>({ length: LIVE_SLOTS }).fill(null)
  }
}

export function writeLiveSlots(store: SnapshotStore | null, slots: readonly (ProgramSnapshot | null)[]): void {
  if (!store) return
  try {
    store.setItem(LIVE_STORAGE_KEY, JSON.stringify(slots))
  } catch {
    // A full or blocked quota must not break playing; the slots simply stay in memory.
  }
}

export function browserSnapshotStore(): SnapshotStore | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

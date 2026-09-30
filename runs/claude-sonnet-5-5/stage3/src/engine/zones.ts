/**
 * Splits, keyboard zones and crossfades (programs spec `split`). Pure functions over plain data.
 *
 * Up to three split points (Low, Mid, High) may be active at once, each on one of eleven documented keys, which cuts the
 * keybed into up to four zones. Every layer of every section owns a contiguous zone range; a note reaches a layer when
 * the note's zone is inside the range, faded across `crossfade` semitones on each side of the boundary.
 */
import { noteName } from '../hardware/keybed'

export type SourceKey = 'piano.A' | 'piano.B' | 'organ.A' | 'organ.B' | 'synth.A' | 'synth.B' | 'synth.C'
export const SOURCE_KEYS: readonly SourceKey[] = ['piano.A', 'piano.B', 'organ.A', 'organ.B', 'synth.A', 'synth.B', 'synth.C']

/** the eleven documented split positions */
export const SPLIT_POSITION_NAMES = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'] as const
export const SPLIT_POSITIONS: readonly number[] = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96]
export const DEFAULT_SPLIT_POSITION = 4 // C4
export type SplitPointId = 'low' | 'mid' | 'high'
export const SPLIT_POINT_IDS: readonly SplitPointId[] = ['low', 'mid', 'high']
export const SPLIT_POINT_NAMES: Record<SplitPointId, string> = { low: 'Low', mid: 'Mid', high: 'High' }
export const CROSSFADES = [0, 6, 12] as const
export type Crossfade = (typeof CROSSFADES)[number]
export const MAX_ZONES = 4

export interface SplitPoint {
  active: boolean
  /** index into SPLIT_POSITIONS */
  position: number
  /** semitones faded on each side of the boundary: 0 (Off), 6 or 12 */
  crossfade: Crossfade
}
export type SplitState = Record<SplitPointId, SplitPoint>

export const defaultSplit = (): SplitState => ({
  low: { active: false, position: 2, crossfade: 0 },
  mid: { active: false, position: DEFAULT_SPLIT_POSITION, crossfade: 0 },
  high: { active: false, position: 6, crossfade: 0 },
})

export type ZoneRange = [number, number]
export type ZoneAssignments = Record<SourceKey, ZoneRange>
export const defaultZones = (): ZoneAssignments => Object.fromEntries(SOURCE_KEYS.map((k) => [k, [0, MAX_ZONES - 1] as ZoneRange])) as ZoneAssignments

/** every contiguous range, in the order the KB ZONE arrows step through them */
export const ZONE_RANGES: readonly ZoneRange[] = (() => {
  const out: ZoneRange[] = []
  for (let lo = 0; lo < MAX_ZONES; lo++) for (let hi = lo; hi < MAX_ZONES; hi++) out.push([lo, hi])
  return out
})()
export const zoneRangeIndex = (r: ZoneRange): number => Math.max(0, ZONE_RANGES.findIndex(([lo, hi]) => lo === r[0] && hi === r[1]))
export const stepZoneRange = (r: ZoneRange, direction: 1 | -1): ZoneRange => {
  const i = zoneRangeIndex(r) + direction
  return [...ZONE_RANGES[(i + ZONE_RANGES.length) % ZONE_RANGES.length]] as ZoneRange
}
export const zoneRangeLabel = (r: ZoneRange): string => (r[0] === r[1] ? `zone ${r[0] + 1}` : `zones ${r[0] + 1}-${r[1] + 1}`)

export interface Boundary {
  note: number
  crossfade: Crossfade
  point: SplitPointId
}

/** active split points, lowest key first (ties keep Low, Mid, High order) */
export function boundaries(split: SplitState): Boundary[] {
  return SPLIT_POINT_IDS.filter((id) => split[id].active)
    .map((id) => ({ note: SPLIT_POSITIONS[split[id].position], crossfade: split[id].crossfade, point: id }))
    .sort((a, b) => a.note - b.note)
}
export const zoneCount = (split: SplitState): number => boundaries(split).length + 1
export const splitIsOn = (split: SplitState): boolean => SPLIT_POINT_IDS.some((id) => split[id].active)

/** the zone (0-based) that contains `note` */
export function zoneOf(split: SplitState, note: number): number {
  let z = 0
  for (const b of boundaries(split)) if (note >= b.note) z++
  return z
}

/** the range actually in force: zones that do not exist are folded onto the last one */
export function effectiveRange(split: SplitState, range: ZoneRange): ZoneRange {
  const last = zoneCount(split) - 1
  return [Math.min(range[0], last), Math.min(range[1], last)]
}

const rise = (note: number, b: Boundary): number => {
  if (b.crossfade === 0) return note >= b.note ? 1 : 0
  const t = Math.min(1, Math.max(0, (note - (b.note - b.crossfade)) / (2 * b.crossfade)))
  return Math.sin((t * Math.PI) / 2)
}
const fall = (note: number, b: Boundary): number => {
  if (b.crossfade === 0) return note < b.note ? 1 : 0
  const t = Math.min(1, Math.max(0, (note - (b.note - b.crossfade)) / (2 * b.crossfade)))
  return Math.cos((t * Math.PI) / 2)
}

/** linear gain (0..1, equal-power across a crossfade) with which the key `note` reaches a layer assigned to `range` */
export function zoneGain(split: SplitState, range: ZoneRange, note: number): number {
  const bs = boundaries(split)
  const [lo, hi] = effectiveRange(split, range)
  let g = 1
  if (lo > 0) g *= rise(note, bs[lo - 1])
  if (hi < bs.length) g *= fall(note, bs[hi])
  return g
}

/** SET KEY: the documented position nearest to a pressed key */
export function nearestPosition(note: number): number {
  let best = 0
  for (let i = 1; i < SPLIT_POSITIONS.length; i++) if (Math.abs(SPLIT_POSITIONS[i] - note) < Math.abs(SPLIT_POSITIONS[best] - note)) best = i
  return best
}

export const positionName = (index: number): string => SPLIT_POSITION_NAMES[Math.min(SPLIT_POSITIONS.length - 1, Math.max(0, index))]
export const positionForNoteName = (name: string): number => SPLIT_POSITION_NAMES.indexOf(name as (typeof SPLIT_POSITION_NAMES)[number])

/** one LED per documented position, lit when a split point is active there (LEDs above the keybed) */
export function litPositions(split: SplitState): boolean[] {
  const lit = SPLIT_POSITIONS.map(() => false)
  for (const id of SPLIT_POINT_IDS) if (split[id].active) lit[split[id].position] = true
  return lit
}

export const splitSummary = (split: SplitState): string => {
  const bs = boundaries(split)
  if (bs.length === 0) return 'Split off'
  return bs.map((b) => `${noteName(b.note)}${b.crossfade ? ` ±${b.crossfade}` : ''}`).join(' | ')
}

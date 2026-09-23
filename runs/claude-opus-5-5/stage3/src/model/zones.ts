// Splits and KB zones (programs spec split): up to three split points (Low/Mid/High) at the 11
// documented positions divide the keyboard into up to four zones. Each layer covers a contiguous
// zone range; a point that is Off merges its two neighbouring zones. Crossfades of ±6/±12
// semitones fade the layers on either side of a point across that many semitones each side
// (equal-power); Off switches at the point. With Split off every layer covers the keyboard.
import { SPLIT_POSITIONS, type SplitState } from './sound'
import type { ZoneRange } from './layerCommon'

export interface Edge {
  note: number
  xfade: number
}

/** Active split points in keyboard order (their index 0…2 = Low/Mid/High). */
export function activePoints(split: SplitState): { index: number; note: number; xfade: number }[] {
  if (!split.on) return []
  const out: { index: number; note: number; xfade: number }[] = []
  split.points.forEach((p, index) => {
    if (p.pos !== null) out.push({ index, note: SPLIT_POSITIONS[p.pos], xfade: p.xfade })
  })
  return out
}

/**
 * The edges of a layer's zone range: the nearest active point at or below its lower boundary and
 * at or above its upper boundary (boundary i sits between zone i and zone i + 1).
 */
export function zoneEdges(split: SplitState, zone: ZoneRange): { lower: Edge | null; upper: Edge | null } {
  if (!split.on) return { lower: null, upper: null }
  const [from, to] = zone
  let lower: Edge | null = null
  let upper: Edge | null = null
  for (let i = from - 1; i >= 1; i--) {
    const p = split.points[i - 1]
    if (p.pos !== null) {
      lower = { note: SPLIT_POSITIONS[p.pos], xfade: p.xfade }
      break
    }
  }
  for (let i = to; i <= 3; i++) {
    const p = split.points[i - 1]
    if (p.pos !== null) {
      upper = { note: SPLIT_POSITIONS[p.pos], xfade: p.xfade }
      break
    }
  }
  return { lower, upper }
}

/** Fade-in position 0…1 of the zone above an edge for `note` (0 = fully below). */
function above(edge: Edge, note: number): number {
  if (edge.xfade === 0) return note >= edge.note ? 1 : 0
  const t = (note - (edge.note - edge.xfade)) / (2 * edge.xfade)
  return Math.min(1, Math.max(0, t))
}

/**
 * Gain (0…1) with which a layer covering `zone` plays physical key `note`. 0 = not routed.
 * Crossfades are equal-power: sin/cos of the fade position.
 */
export function zoneGain(split: SplitState, zone: ZoneRange, note: number): number {
  const { lower, upper } = zoneEdges(split, zone)
  let g = 1
  if (lower) g *= Math.sin((above(lower, note) * Math.PI) / 2)
  if (upper) g *= Math.cos((above(upper, note) * Math.PI) / 2)
  return g < 1e-6 ? 0 : g
}

/** The KB zone (1…4) that physical key `note` falls in, counting Off points as merges. */
export function zoneOfNote(split: SplitState, note: number): number {
  let z = 1
  split.points.forEach((p, i) => {
    if (split.on && p.pos !== null && note >= SPLIT_POSITIONS[p.pos]) z = i + 2
  })
  return z
}

/** Every contiguous zone range 1…4, in the order Shift+Octave steps through them. */
export const ZONE_RANGES: readonly ZoneRange[] = (() => {
  const out: ZoneRange[] = [[1, 4]]
  for (let from = 1; from <= 4; from++) for (let to = from; to <= 4; to++) if (!(from === 1 && to === 4)) out.push([from, to])
  return out
})()

export function stepZone(zone: ZoneRange, delta: number): ZoneRange {
  const i = ZONE_RANGES.findIndex((z) => z[0] === zone[0] && z[1] === zone[1])
  const n = ZONE_RANGES.length
  return ZONE_RANGES[(((i < 0 ? 0 : i) + delta) % n + n) % n]
}

/**
 * Set a split point's position, keeping Low < Mid < High: positions already passed by a
 * neighbouring active point are skipped. `pos` null turns the point Off.
 */
export function setSplitPoint(split: SplitState, index: number, pos: number | null): SplitState {
  const points = split.points.map((p) => ({ ...p })) as SplitState['points']
  if (pos !== null) {
    const lowerBound = points.slice(0, index).reduce((m, p) => (p.pos !== null ? Math.max(m, p.pos) : m), -1)
    const upperBound = points.slice(index + 1).reduce((m, p) => (p.pos !== null ? Math.min(m, p.pos) : m), SPLIT_POSITIONS.length)
    if (pos <= lowerBound || pos >= upperBound) return split
  }
  points[index] = { ...points[index], pos }
  return { ...split, points }
}

/** Step a point through Off + the valid positions (dial behaviour in split edit). */
export function stepSplitPoint(split: SplitState, index: number, delta: number): SplitState {
  const choices: (number | null)[] = [null]
  for (let pos = 0; pos < SPLIT_POSITIONS.length; pos++) if (setSplitPoint(split, index, pos) !== split || split.points[index].pos === pos) choices.push(pos)
  const cur = choices.indexOf(split.points[index].pos)
  const next = choices[Math.min(choices.length - 1, Math.max(0, cur + delta))]
  return next === split.points[index].pos ? split : setSplitPoint(split, index, next)
}

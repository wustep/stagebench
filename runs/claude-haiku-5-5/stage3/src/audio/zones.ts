// Keyboard zones: up to three split points make up to four zones, and each layer is assigned a
// contiguous range of zones. A split point with a crossfade of 6 or 12 semitones fades the two zones
// across that many semitones on each side of the point (manual p. 39); a crossfade of Off switches
// at the point. A note's zone weights are gains, so a note inside a crossfade sounds in both zones.

/** MIDI note of each split position: C2 = 36, one octave per C. The 11 documented positions are C2 to C7. */
export const SPLIT_NOTES = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96] as const

/** Crossfade widths in semitones, indexed as the panel's crossfade cycle: Off, ±6, ±12. */
export const CROSSFADE_SEMITONES = [0, 6, 12] as const

/** Layer zone ranges, indexed as the panel's zone cycle. Zones are numbered 1 to 4. */
export const ZONE_RANGE_STEPS: readonly (readonly [number, number])[] = [
  [1, 1],
  [2, 2],
  [3, 3],
  [4, 4],
  [1, 2],
  [2, 3],
  [3, 4],
  [1, 3],
  [2, 4],
  [1, 4],
]

export interface SplitPoint {
  /** MIDI note of the split point. */
  note: number
  /** Crossfade width in semitones: 0, 6, or 12. */
  crossfade: number
}

/**
 * The active split points, in ascending order. `positions` are the panel indexes of Low, Mid, and High
 * (0 means Off). Split ON gates the whole set; with it off the keyboard is one zone.
 */
export function activeSplitPoints(splitOn: boolean, positions: readonly number[], crossfades: readonly number[]): SplitPoint[] {
  if (!splitOn) return []
  const points: SplitPoint[] = []
  positions.forEach((position, index) => {
    if (position <= 0) return
    points.push({ note: SPLIT_NOTES[Math.min(SPLIT_NOTES.length - 1, position - 1)], crossfade: CROSSFADE_SEMITONES[crossfades[index] ?? 0] })
  })
  return points.sort((a, b) => a.note - b.note).slice(0, 3)
}

/** Fraction of a note that lies above a split point: 0 below the fade, 1 above it, linear across the fade. */
function aboveWeight(note: number, point: SplitPoint): number {
  if (point.crossfade === 0) return note >= point.note ? 1 : 0
  const from = point.note - point.crossfade
  const span = 2 * point.crossfade
  return Math.min(1, Math.max(0, (note - from) / span))
}

/**
 * Gain of each zone for one played note. The array has one entry per zone (points + 1). Overlapping
 * crossfades can make the raw weights exceed one in total, so they are normalized: a note keeps its level.
 */
export function zoneWeights(note: number, points: readonly SplitPoint[]): number[] {
  if (points.length === 0) return [1]
  const above = points.map((point) => aboveWeight(note, point))
  const weights: number[] = []
  weights.push(1 - above[0])
  for (let index = 0; index < above.length - 1; index += 1) {
    weights.push(above[index] * (1 - above[index + 1]))
  }
  weights.push(above[above.length - 1])
  const total = weights.reduce((sum, value) => sum + value, 0)
  return total > 0 ? weights.map((value) => value / total) : weights
}

/** Gain a layer gets for one note: the sum of the zone weights in its range. */
export function layerZoneGain(weights: readonly number[], range: readonly [number, number]): number {
  let gain = 0
  for (let zone = range[0]; zone <= range[1]; zone += 1) {
    gain += weights[zone - 1] ?? 0
  }
  return Math.min(1, gain)
}

/** A layer's zone range from its panel cycle index. */
export function zoneRangeOf(index: number): readonly [number, number] {
  return ZONE_RANGE_STEPS[Math.min(ZONE_RANGE_STEPS.length - 1, Math.max(0, index))]
}

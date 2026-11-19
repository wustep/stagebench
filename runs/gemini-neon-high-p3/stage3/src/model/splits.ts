import { STAGE_4_73_VARIANT } from './variant'

export type SplitPositionNote =
  | 'C2'
  | 'F2'
  | 'C3'
  | 'F3'
  | 'C4'
  | 'F4'
  | 'C5'
  | 'F5'
  | 'C6'
  | 'F6'
  | 'C7'

export type SplitPointId = 'low' | 'mid' | 'high'
export type SplitCrossfadeSemitones = 0 | 6 | 12

export const SPLIT_POSITION_NOTES: readonly SplitPositionNote[] = [
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

export const SPLIT_NOTE_TO_MIDI: Readonly<Record<SplitPositionNote, number>> = {
  C2: 36,
  F2: 41,
  C3: 48,
  F3: 53,
  C4: 60,
  F4: 65,
  C5: 72,
  F5: 77,
  C6: 84,
  F6: 89,
  C7: 96,
}

export const SPLIT_CROSSFADE_OPTIONS: readonly SplitCrossfadeSemitones[] = [0, 6, 12]

export interface SplitPointConfig {
  readonly active: boolean
  readonly note: SplitPositionNote
  readonly crossfade: SplitCrossfadeSemitones
}

export interface SplitState {
  readonly enabled: boolean
  readonly points: {
    readonly low: SplitPointConfig
    readonly mid: SplitPointConfig
    readonly high: SplitPointConfig
  }
}

/**
 * Contiguous keyboard zone assignment for any Organ, Piano, or Synth layer.
 * Zone indices are 0..3 corresponding to up to 4 zones (LO, MID-LO, MID-HI, HI).
 * Default full-keyboard assignment is { lowZone: 0, highZone: 3 }.
 */
export interface LayerZoneRange {
  readonly lowZone: number
  readonly highZone: number
}

export const FULL_KEYBOARD_ZONE: LayerZoneRange = { lowZone: 0, highZone: 3 }

export function createDefaultSplitState(): SplitState {
  return {
    enabled: false,
    points: {
      low: { active: false, note: 'C3', crossfade: 0 },
      mid: { active: true, note: 'C4', crossfade: 0 },
      high: { active: false, note: 'C5', crossfade: 0 },
    },
  }
}

export interface ResolvedSplitBoundary {
  readonly id: SplitPointId
  readonly note: SplitPositionNote
  readonly midi: number
  readonly crossfade: SplitCrossfadeSemitones
}

/**
 * Returns active split boundaries in strictly ascending MIDI order (0..3 boundaries => 1..4 zones).
 */
export function getActiveSplitBoundaries(split: SplitState): readonly ResolvedSplitBoundary[] {
  if (!split.enabled) return []
  const candidates: ResolvedSplitBoundary[] = []
  for (const id of ['low', 'mid', 'high'] as const) {
    const pt = split.points[id]
    if (pt.active) {
      candidates.push({
        id,
        note: pt.note,
        midi: SPLIT_NOTE_TO_MIDI[pt.note],
        crossfade: pt.crossfade,
      })
    }
  }
  candidates.sort((a, b) => a.midi - b.midi)
  // Deduplicate identical MIDI split positions keeping the first
  const unique: ResolvedSplitBoundary[] = []
  for (const c of candidates) {
    if (unique.length === 0 || unique[unique.length - 1].midi !== c.midi) {
      unique.push(c)
    }
  }
  return unique
}

export function getActiveZoneCount(split: SplitState): number {
  return getActiveSplitBoundaries(split).length + 1
}

/**
 * Computes the linear gain multiplier (0..1) for a MIDI note given the active SplitState
 * and a layer's contiguous zone assignment.
 *
 * Crossfade behavior (manual p. 39):
 * - crossfade === 0 (Off): hard switch at split point (`midi >= splitMidi` enters upper zone,
 *   `midi < splitMidi` stays in lower zone).
 * - crossfade === 6 or 12: linear crossfade across `±crossfade` semitones around the split point:
 *   at `splitMidi - W`, lower=1.0, upper=0.0; at `splitMidi`, both=0.5; at `splitMidi + W`,
 *   lower=0.0, upper=1.0.
 */
export function computeZoneGain(
  midi: number,
  split: SplitState,
  zone: LayerZoneRange,
): number {
  const boundaries = getActiveSplitBoundaries(split)
  if (boundaries.length === 0) {
    return 1
  }

  const zoneCount = boundaries.length + 1
  const lowIdx = Math.max(0, Math.min(zoneCount - 1, zone.lowZone))
  const highIdx = Math.max(lowIdx, Math.min(zoneCount - 1, zone.highZone))

  let gain = 1

  // Lower boundary (entering lowIdx from below)
  if (lowIdx > 0) {
    const b = boundaries[lowIdx - 1]
    if (b.crossfade === 0) {
      if (midi < b.midi) return 0
    } else {
      const w = b.crossfade
      if (midi <= b.midi - w) return 0
      if (midi < b.midi + w) {
        const t = (midi - (b.midi - w)) / (2 * w)
        gain *= Math.max(0, Math.min(1, t))
      }
    }
  }

  // Upper boundary (exiting highIdx upward)
  if (highIdx < zoneCount - 1) {
    const b = boundaries[highIdx]
    if (b.crossfade === 0) {
      if (midi >= b.midi) return 0
    } else {
      const w = b.crossfade
      if (midi >= b.midi + w) return 0
      if (midi > b.midi - w) {
        const t = ((b.midi + w) - midi) / (2 * w)
        gain *= Math.max(0, Math.min(1, t))
      }
    }
  }

  return gain
}

/**
 * Enumerates all contiguous zone ranges for a given active zone count (1..4),
 * ordered cleanly for KB ZONE button cycling (Full, single zones, then adjacent spans).
 */
export function listContiguousZoneRanges(zoneCount: number): readonly LayerZoneRange[] {
  const clamped = Math.max(1, Math.min(4, zoneCount))
  if (clamped === 1) return [{ lowZone: 0, highZone: 3 }]
  const ranges: LayerZoneRange[] = [{ lowZone: 0, highZone: clamped - 1 }]
  for (let i = 0; i < clamped; i++) {
    ranges.push({ lowZone: i, highZone: i })
  }
  for (let span = 2; span < clamped; span++) {
    for (let start = 0; start + span <= clamped; start++) {
      ranges.push({ lowZone: start, highZone: start + span - 1 })
    }
  }
  return ranges
}

export function cycleLayerZone(
  current: LayerZoneRange,
  split: SplitState,
  delta: 1 | -1 = 1,
): LayerZoneRange {
  const zoneCount = getActiveZoneCount(split)
  if (zoneCount <= 1) return FULL_KEYBOARD_ZONE
  const options = listContiguousZoneRanges(zoneCount)
  const clampedLow = Math.max(0, Math.min(zoneCount - 1, current.lowZone))
  const clampedHigh = Math.max(clampedLow, Math.min(zoneCount - 1, current.highZone))
  const idx = options.findIndex(
    (r) => r.lowZone === clampedLow && r.highZone === clampedHigh,
  )
  const baseIdx = idx === -1 ? 0 : idx
  const nextIdx = (baseIdx + delta + options.length) % options.length
  return options[nextIdx]
}

export function formatZoneRangeLabel(zone: LayerZoneRange, split: SplitState): string {
  const zoneCount = getActiveZoneCount(split)
  if (zoneCount <= 1) return 'FULL'
  const low = Math.max(0, Math.min(zoneCount - 1, zone.lowZone))
  const high = Math.max(low, Math.min(zoneCount - 1, zone.highZone))
  if (low === 0 && high === zoneCount - 1) return 'FULL'
  const names = zoneCount === 2 ? ['LO', 'HI'] : zoneCount === 3 ? ['LO', 'MID', 'HI'] : ['Z1', 'Z2', 'Z3', 'Z4']
  if (low === high) return names[low]
  return `${names[low]}-${names[high]}`
}

/**
 * Computes horizontal percentage position (0..100%) above the Stage 4 73 keybed (E1..E7, MIDI 28..100)
 * for positioning each split-point LED accurately above its key.
 */
export function getSplitLedLeftPercent(note: SplitPositionNote): number {
  const midi = SPLIT_NOTE_TO_MIDI[note]
  const lowMidi = STAGE_4_73_VARIANT.keyboard.firstMidi // 28 (E1)
  const highMidi = STAGE_4_73_VARIANT.keyboard.lastMidi // 100 (E7)
  const frac = Math.max(0.04, Math.min(0.96, (midi - lowMidi) / (highMidi - lowMidi)))
  return Number((frac * 100).toFixed(2))
}

import type { CrossfadeWidth, EngineLayerRef, SplitState, ZoneAssignment } from './program-types'
import { SPLIT_POSITIONS, splitMidiAt } from './program-types'

export function zoneGainForNote(
  midi: number,
  zoneStart: number,
  zoneEnd: number,
  split: SplitState,
): number {
  if (midi < zoneStart || midi > zoneEnd) return 0
  if (!split.enabled) return 1

  const lowSplit = splitMidiAt(split.low.positionIndex)
  const midSplit = splitMidiAt(split.mid.positionIndex)
  const highSplit = splitMidiAt(split.high.positionIndex)

  const boundaries = [
    { midi: lowSplit, crossfade: split.low.crossfade },
    { midi: midSplit, crossfade: split.mid.crossfade },
    { midi: highSplit, crossfade: split.high.crossfade },
  ].sort((a, b) => a.midi - b.midi)

  let gain = 1
  for (const boundary of boundaries) {
    gain *= crossfadeAt(midi, boundary.midi, boundary.crossfade, zoneStart, zoneEnd)
    if (gain <= 0) return 0
  }
  return Math.max(0, Math.min(1, gain))
}

function crossfadeAt(
  midi: number,
  splitMidi: number,
  width: CrossfadeWidth,
  zoneStart: number,
  zoneEnd: number,
): number {
  if (width === 0) {
    if (midi < splitMidi && zoneEnd < splitMidi) return 0
    if (midi >= splitMidi && zoneStart >= splitMidi) return 0
    return 1
  }
  const half = width / 2
  const lowerEdge = splitMidi - half
  const upperEdge = splitMidi + half
  if (zoneEnd < lowerEdge || zoneStart > upperEdge) return 0
  if (midi <= lowerEdge) return zoneEnd < splitMidi ? 1 : 0
  if (midi >= upperEdge) return zoneStart >= splitMidi ? 1 : 0
  const t = (midi - lowerEdge) / width
  return zoneStart < splitMidi ? 1 - t : t
}

export function resolveLayerGain(
  midi: number,
  layer: EngineLayerRef,
  zones: ZoneAssignment[],
  split: SplitState,
): number {
  let total = 0
  for (const zone of zones) {
    if (zone.layer.engine !== layer.engine || zone.layer.layer !== layer.layer) continue
    total += zoneGainForNote(midi, zone.zoneStart, zone.zoneEnd, split)
  }
  return Math.min(1, total)
}

export function splitPositionLabel(index: number): string {
  const names = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7']
  return names[index] ?? 'C4'
}

export function midiForSplitIndex(index: number): number {
  return SPLIT_POSITIONS[index] ?? 60
}

export function activeSplitLedIndices(split: SplitState): number[] {
  if (!split.enabled) return []
  return [split.low.positionIndex, split.mid.positionIndex, split.high.positionIndex]
}

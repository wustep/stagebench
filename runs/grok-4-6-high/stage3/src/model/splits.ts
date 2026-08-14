import {
  SPLIT_NOTE_MIDI,
  SPLIT_NOTE_NAMES,
  type InstrumentState,
  type SplitState,
  type ZoneRange,
} from './instrument-state'

export function midiToSplitName(midi: number): (typeof SPLIT_NOTE_NAMES)[number] {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < SPLIT_NOTE_MIDI.length; i++) {
    const dist = Math.abs(SPLIT_NOTE_MIDI[i] - midi)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return SPLIT_NOTE_NAMES[best]
}

export function cycleSplitMidi(midi: number, dir: number): number {
  const i = SPLIT_NOTE_MIDI.indexOf(midi as (typeof SPLIT_NOTE_MIDI)[number])
  const idx = i < 0 ? 4 : i
  const next = (idx + dir + SPLIT_NOTE_MIDI.length) % SPLIT_NOTE_MIDI.length
  return SPLIT_NOTE_MIDI[next]
}

export function activeSplitPoints(split: SplitState): { midi: number; xfade: number }[] {
  if (!split.on) return []
  const pts: { midi: number; xfade: number }[] = []
  if (split.low.enabled) pts.push({ midi: split.low.midi, xfade: split.low.xfade })
  if (split.mid.enabled) pts.push({ midi: split.mid.midi, xfade: split.mid.xfade })
  if (split.high.enabled) pts.push({ midi: split.high.midi, xfade: split.high.xfade })
  pts.sort((a, b) => a.midi - b.midi)
  return pts
}

export function zoneCount(split: SplitState): number {
  return Math.max(1, activeSplitPoints(split).length + 1)
}

export function zoneIndexForNote(midi: number, split: SplitState): number {
  const pts = activeSplitPoints(split)
  if (pts.length === 0) return 0
  let zone = 0
  for (const pt of pts) {
    if (midi >= pt.midi) zone += 1
  }
  return Math.min(zone, pts.length)
}

export function zoneGain(midi: number, zone: ZoneRange, split: SplitState): number {
  const n = zoneCount(split)
  const lo = Math.max(0, Math.min(zone.lo, n - 1))
  const hi = Math.max(lo, Math.min(zone.hi, n - 1))
  const pts = activeSplitPoints(split)
  if (pts.length === 0) return 1

  let gain = 0
  for (let z = lo; z <= hi; z++) {
    gain = Math.max(gain, singleZoneGain(midi, z, pts))
  }
  return gain
}

function singleZoneGain(midi: number, z: number, pts: { midi: number; xfade: number }[]): number {
  const left = z === 0 ? -Infinity : pts[z - 1].midi
  const right = z >= pts.length ? Infinity : pts[z].midi
  const leftFade = z === 0 ? 0 : pts[z - 1].xfade
  const rightFade = z >= pts.length ? 0 : pts[z].xfade

  if (midi >= left && midi < right) {
    let g = 1
    if (leftFade > 0 && Number.isFinite(left)) {
      const d = midi - left
      if (d < leftFade) g = Math.min(g, d / leftFade)
    }
    if (rightFade > 0 && Number.isFinite(right)) {
      const d = right - midi
      if (d < rightFade) g = Math.min(g, d / rightFade)
    }
    return Math.max(0, g)
  }

  if (leftFade > 0 && midi < left && left - midi < leftFade) {
    return 1 - (left - midi) / leftFade
  }
  if (rightFade > 0 && midi >= right && midi - right < rightFade) {
    return 1 - (midi - right) / rightFade
  }
  return 0
}

export function toggleSplit(state: InstrumentState): void {
  if (!state.split.on) {
    state.split.on = true
    state.split.mid.enabled = true
    state.split.mid.midi = 60
    state.split.mid.xfade = 0
    state.splitEdit = 'mid'
  } else {
    state.split.on = false
    state.split.low.enabled = false
    state.split.mid.enabled = false
    state.split.high.enabled = false
    state.splitEdit = 'off'
  }
}

export function setLayerZone(zone: ZoneRange, index: number, exclusive: boolean): void {
  const z = Math.max(0, Math.min(3, index))
  if (exclusive) {
    zone.lo = z
    zone.hi = z
    return
  }
  if (z < zone.lo) zone.lo = z
  else if (z > zone.hi) zone.hi = z
  else if (z === zone.lo && zone.hi > zone.lo) zone.lo = z + 1
  else if (z === zone.hi && zone.hi > zone.lo) zone.hi = z - 1
  else {
    zone.lo = z
    zone.hi = z
  }
}

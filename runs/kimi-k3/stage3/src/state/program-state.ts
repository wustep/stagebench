/**
 * Canonical serializable program state (Phase 3).
 *
 * One ProgramState captures every supported sound/performance setting —
 * piano, organ, synth, effects, splits, scenes, morphs, clock, transpose —
 * per specs/nord-stage-4.programs.json `programState.includes`. Master Level
 * is deliberately excluded. All continuous values are integers on panel
 * scale so a store/recall round-trip is exact.
 */

import type { PianoPerfState, KbTouch, DynComp, Unison } from './piano-state'
import type { EffectsState } from './effects-state'
import { defaultEffectsState } from './effects-state'
import type { OrganState } from './organ-state'
import { defaultOrganState } from './organ-state'
import type { SynthState } from './synth-state'
import { defaultSynthState } from './synth-state'
import type { MorphState } from './morph'
import { defaultMorphState } from './morph'
import { DEFAULT_PIANO_PERF } from './piano-state'
import type { PianoTypeId } from '../audio/piano-models'
import type { LayerId } from '../audio/engine'

// ---------------------------------------------------------------- piano

export interface PianoLayerProgram {
  enabled: boolean
  level: number // 0..1
  octave: number // −12..+12
  type: PianoTypeId
  sustainPedal: boolean
  pitchStick: boolean
}

export interface PianoProgramState {
  sectionOn: boolean
  focusLayer: LayerId
  layers: Record<LayerId, PianoLayerProgram>
  perf: PianoPerfState
}

// ---------------------------------------------------------------- split

export const SPLIT_POINT_IDS = ['Low', 'Mid', 'High'] as const
export type SplitPointId = (typeof SPLIT_POINT_IDS)[number]

/** The 11 documented split positions (programs spec `split.possiblePositions`). */
export const SPLIT_POSITIONS = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'] as const
export const SPLIT_POSITION_MIDI: Record<string, number> = {
  C2: 36, F2: 41, C3: 48, F3: 53, C4: 60, F4: 65, C5: 72, F5: 77, C6: 84, F6: 89, C7: 96,
}

/** Crossfade widths: index 0 = Off, 1 = ±6 semitones, 2 = ±12 semitones. */
export const CROSSFADE_WIDTHS = [0, 6, 12] as const

export interface SplitPointState {
  enabled: boolean
  /** Index into SPLIT_POSITIONS. */
  position: number
  /** Index into CROSSFADE_WIDTHS. */
  xfade: number
}

/** Zone ranges are indexes 0..3 into the computed zone list (up to 4 zones). */
export interface ZoneRange {
  lo: number
  hi: number
}

/** Every layer of every engine that can own notes. */
export type RoutableLayerId = 'pianoA' | 'pianoB' | 'organA' | 'organB' | 'synthA' | 'synthB' | 'synthC'
export const ROUTABLE_LAYERS: readonly RoutableLayerId[] = ['pianoA', 'pianoB', 'organA', 'organB', 'synthA', 'synthB', 'synthC']

export interface SplitState {
  on: boolean
  points: Record<SplitPointId, SplitPointState>
  /** Per-layer contiguous zone assignment (inclusive indexes into zones). */
  zones: Record<RoutableLayerId, ZoneRange>
}

// ---------------------------------------------------------------- clock

export interface ClockState {
  bpm: number // 30..300
  kbSync: boolean
}

// ---------------------------------------------------------------- program

export interface ProgramState {
  piano: PianoProgramState
  organ: OrganState
  synth: SynthState
  effects: EffectsState
  split: SplitState
  scene: 'I' | 'II'
  morphs: MorphState
  clock: ClockState
  transpose: number // −6..+6 semitones
}

export interface StoredProgram {
  name: string
  state: ProgramState
}

export function defaultSplitState(): SplitState {
  return {
    on: false,
    points: {
      Low: { enabled: false, position: 4, xfade: 0 },
      Mid: { enabled: true, position: 4, xfade: 0 }, // single Mid split at C4
      High: { enabled: false, position: 4, xfade: 0 },
    },
    zones: {
      pianoA: { lo: 0, hi: 3 },
      pianoB: { lo: 0, hi: 3 },
      organA: { lo: 0, hi: 3 },
      organB: { lo: 0, hi: 3 },
      synthA: { lo: 0, hi: 3 },
      synthB: { lo: 0, hi: 3 },
      synthC: { lo: 0, hi: 3 },
    },
  }
}

export function defaultProgramState(): ProgramState {
  return {
    piano: {
      sectionOn: true,
      focusLayer: 'pianoA',
      layers: {
        pianoA: { enabled: true, level: 0.79, octave: 0, type: 'grand', sustainPedal: true, pitchStick: false },
        pianoB: { enabled: false, level: 0.79, octave: 0, type: 'upright', sustainPedal: true, pitchStick: false },
      },
      perf: { ...DEFAULT_PIANO_PERF },
    },
    organ: defaultOrganState(),
    synth: defaultSynthState(),
    effects: defaultEffectsState(),
    split: defaultSplitState(),
    scene: 'I',
    morphs: defaultMorphState(),
    clock: { bpm: 120, kbSync: false },
    transpose: 0,
  }
}

/** Deep structural clone (state contains only plain JSON-safe values). */
export function cloneProgramState(state: ProgramState): ProgramState {
  return JSON.parse(JSON.stringify(state)) as ProgramState
}

/** Canonical serialization used by the dirty check. */
export function serializeProgramState(state: ProgramState): string {
  return JSON.stringify(state)
}

/**
 * Sorted active split boundaries (MIDI), ascending — the zone edges.
 * With k active points there are k+1 zones (max 4).
 */
export function activeSplitMidis(split: SplitState): number[] {
  const midis = SPLIT_POINT_IDS.filter((id) => split.points[id].enabled)
    .map((id) => SPLIT_POSITION_MIDI[SPLIT_POSITIONS[split.points[id].position]])
  return midis.sort((a, b) => a - b)
}

/** Number of zones given the active split points (1..4). */
export function zoneCount(split: SplitState): number {
  return activeSplitMidis(split).length + 1
}

/** Zone index (0..zoneCount-1) containing a MIDI note. */
export function zoneOfNote(split: SplitState, note: number): number {
  const edges = activeSplitMidis(split)
  let zone = 0
  for (const edge of edges) if (note >= edge) zone++
  return zone
}

/**
 * Gain in [0,1] for a layer playing `note` under the split state: zero when
 * the note's zone is outside the layer's assigned range; partial inside a
 * crossfade window (linear across the width on each side of the boundary);
 * full otherwise.
 *
 * Crossfade semantics (programs spec `crossfadeBehavior`): Off switches
 * immediately at the split point; ±6/±12 fade sounds across that many
 * semitones ON EACH SIDE of the boundary. At the boundary note the fading
 * layer is at half gain; it reaches full gain one width inside its own
 * side, and the fade also extends one width across the boundary into the
 * neighboring zone (where the layer would otherwise be gated off).
 */
export function zoneGain(split: SplitState, layer: RoutableLayerId, note: number): number {
  if (!split.on) return 1
  const range = split.zones[layer]
  const zone = zoneOfNote(split, note)
  const inRange = zone >= range.lo && zone <= range.hi
  let gain = inRange ? 1 : 0
  for (const id of SPLIT_POINT_IDS) {
    const p = split.points[id]
    if (!p.enabled || p.xfade === 0) continue
    const width = CROSSFADE_WIDTHS[p.xfade]
    const edge = SPLIT_POSITION_MIDI[SPLIT_POSITIONS[p.position]]
    const lowerZone = zoneOfNote(split, edge - 1)
    const upperZone = lowerZone + 1
    const lowerAssigned = lowerZone >= range.lo && lowerZone <= range.hi
    const upperAssigned = upperZone >= range.lo && upperZone <= range.hi
    if (lowerAssigned === upperAssigned) continue
    const d = note - edge
    if (Math.abs(d) > width) continue
    // Fade curve for a layer assigned to only one side of this boundary:
    // 0.5 at the boundary, rising to 1 one width into its own side, falling
    // to 0 one width across the boundary into the neighboring zone.
    const fade = 0.5 + (upperAssigned ? d : -d) / (2 * width)
    if (inRange) gain = Math.min(gain, fade)
    else gain = Math.max(gain, fade)
  }
  return Math.max(0, Math.min(1, gain))
}

/** Crossfade boundary marker for tests/debugging: version stamp. */
export const ZONE_GAIN_SEMANTICS = 'boundary-0.5-linear-v3'

/** Re-export piano perf types used by the program schema. */
export type { PianoPerfState, KbTouch, DynComp, Unison }

/**
 * Canonical serializable program/performance state for the whole instrument.
 *
 * The Nord Stage 4 behaves as ONE serializable system: a program is a snapshot
 * of every supported control plus the performance state that isn't a single
 * panel control (splits, zones, scenes, morphs, master clock, transpose). Master
 * Level is deliberately EXCLUDED (programs spec `programState.excludes`).
 *
 * `serializeProgram`/`deserializeProgram` round-trip a ProgramState through JSON
 * so Store/Store As/Live persist losslessly and reload identically.
 */

import type { ControlState } from './controlStore';
import { CONTROLS } from '../model/controls';

/** The 11 documented split-point positions (note names). */
export const SPLIT_POSITIONS = ['C2', 'F2', 'C3', 'F3', 'C4', 'F4', 'C5', 'F5', 'C6', 'F6', 'C7'] as const;
export type SplitPosition = (typeof SPLIT_POSITIONS)[number];

/** MIDI note number for each documented split position. */
export const SPLIT_POSITION_MIDI: Record<SplitPosition, number> = {
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
};

export type CrossfadeWidth = 0 | 6 | 12;
export type ZoneIndex = 0 | 1 | 2 | 3;

/** Every routable layer across the three sections. */
export type LayerKey =
  | 'organ-A'
  | 'organ-B'
  | 'piano-A'
  | 'piano-B'
  | 'synth-A'
  | 'synth-B'
  | 'synth-C';

export const LAYER_KEYS: readonly LayerKey[] = [
  'organ-A',
  'organ-B',
  'piano-A',
  'piano-B',
  'synth-A',
  'synth-B',
  'synth-C',
];

export interface SplitState {
  on: boolean;
  /** Three split points (indices into SPLIT_POSITIONS) or null when unused. */
  points: { low: number | null; mid: number | null; high: number | null };
  crossfades: { low: CrossfadeWidth; mid: CrossfadeWidth; high: CrossfadeWidth };
  /** Which zone (0..3) each layer is assigned to. */
  zones: Record<LayerKey, ZoneIndex>;
}

/** Per-scene layer enable state (sound params are shared across scenes). */
export type SceneEnables = Record<LayerKey, boolean>;

export interface MorphAssignment {
  controlId: string;
  from: number;
  to: number;
}

export interface MorphState {
  wheel: MorphAssignment[];
  ctrlPedal: MorphAssignment[];
}

export interface PerformanceState {
  transpose: number; // -6..6
  scene: 'I' | 'II';
  clock: { bpm: number; keyboardSync: boolean };
  split: SplitState;
  scenes: { I: SceneEnables; II: SceneEnables };
  morph: MorphState;
  /** Per-layer octave shifts (not single panel controls). */
  octaves: Record<LayerKey, number>;
}

export interface ProgramState {
  name: string;
  /** Snapshot of every supported panel control (Master Level omitted on store). */
  controls: ControlState;
  performance: PerformanceState;
}

/** Controls excluded from program state (programs spec). */
export const PROGRAM_EXCLUDED_CONTROLS = ['performance-master-level'];

function defaultZones(): Record<LayerKey, ZoneIndex> {
  return {
    'organ-A': 0,
    'organ-B': 0,
    'piano-A': 0,
    'piano-B': 0,
    'synth-A': 0,
    'synth-B': 0,
    'synth-C': 0,
  };
}

/**
 * Default scene enables are all TRUE: a layer's on/off button (its engine
 * `enabled` flag) is the primary gate; the scene overlay only removes layers a
 * program's scene explicitly disables. This keeps Scene I equivalent to the raw
 * panel state until a program stores a different Scene II layout.
 */
export function defaultSceneEnables(): SceneEnables {
  return {
    'organ-A': true,
    'organ-B': true,
    'piano-A': true,
    'piano-B': true,
    'synth-A': true,
    'synth-B': true,
    'synth-C': true,
  };
}

export function defaultPerformanceState(): PerformanceState {
  return {
    transpose: 0,
    scene: 'I',
    clock: { bpm: 120, keyboardSync: false },
    split: {
      on: false,
      points: { low: null, mid: 4, high: null }, // mid defaults to C4
      crossfades: { low: 0, mid: 0, high: 0 },
      zones: defaultZones(),
    },
    scenes: { I: defaultSceneEnables(), II: defaultSceneEnables() },
    morph: { wheel: [], ctrlPedal: [] },
    octaves: {
      'organ-A': 0,
      'organ-B': 0,
      'piano-A': 0,
      'piano-B': 0,
      'synth-A': 0,
      'synth-B': 0,
      'synth-C': 0,
    },
  };
}

/** Build a program from a control snapshot + performance state. */
export function makeProgram(
  name: string,
  controls: ControlState,
  performance: PerformanceState,
): ProgramState {
  const filtered: ControlState = { ...controls };
  for (const id of PROGRAM_EXCLUDED_CONTROLS) delete filtered[id];
  return { name, controls: filtered, performance: structuredCloneCompat(performance) };
}

/** JSON round-trip (deep). */
export function serializeProgram(p: ProgramState): string {
  return JSON.stringify(p);
}

export function deserializeProgram(json: string): ProgramState {
  const raw = JSON.parse(json) as ProgramState;
  return normalizeProgram(raw);
}

/** Ensure a loaded program has every known control key (forward/back compat). */
export function normalizeProgram(p: ProgramState): ProgramState {
  const controls: ControlState = { ...p.controls };
  for (const def of CONTROLS) {
    if (PROGRAM_EXCLUDED_CONTROLS.includes(def.id)) continue;
    if (!(def.id in controls)) {
      controls[def.id] = def.kind === 'button' ? def.default === 1 : (def.default ?? 0);
    }
  }
  return { name: p.name, controls, performance: { ...defaultPerformanceState(), ...p.performance } };
}

/** Structured clone with a fallback for environments without the global. */
export function structuredCloneCompat<T>(v: T): T {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Crossfade gain for a note against a split boundary. Returns 0..1 for the side
 * that owns `low` vs `high`. `width` 0 = hard switch; 6/12 = fade over N semis.
 */
export function crossfadeGain(note: number, boundaryMidi: number, width: CrossfadeWidth, side: 'low' | 'high'): number {
  const d = note - boundaryMidi;
  if (width === 0) {
    if (side === 'low') return d < 0 ? 1 : 0;
    return d >= 0 ? 1 : 0;
  }
  // Linear fade over [-width, +width] around the boundary.
  const t = Math.max(-width, Math.min(width, d)) / width; // -1..1
  const highGain = (t + 1) / 2; // 0 at low edge, 1 at high edge
  return side === 'high' ? highGain : 1 - highGain;
}

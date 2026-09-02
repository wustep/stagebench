/**
 * The canonical, serialisable PROGRAM (specs/nord-stage-4.programs.json `programState`, manual p. 38): every panel
 * setting except Master Level and temporary modes. Organ, Synth, splits, zones, scenes, morphs, Master Clock and
 * Transpose are defined here; the Piano and effects shapes are the Phase 2 ones (src/state/instrumentState.ts).
 * Everything is plain data so a program round-trips through JSON (Store / Live persistence) unchanged.
 */
import type { LayerId, PianoSettings } from '../audio/engine'
import { defaultOrganLayerParams, type OrganPercussionParams } from '../dsp/organTypes'
import { defaultSynthLayerParams, type SynthLayerId, type SynthLayerParams } from '../dsp/synthTypes'
import { clamp } from '../dsp/types'
import type { EffectsState } from './instrumentState'

export type SectionKey = 'organ' | 'piano' | 'synth'
export const SECTION_KEYS: readonly SectionKey[] = ['organ', 'piano', 'synth']
/** Every playable layer of the instrument, in panel order. */
export type LayerKey = 'organA' | 'organB' | 'pianoA' | 'pianoB' | 'synthA' | 'synthB' | 'synthC'
export const LAYER_KEYS: readonly LayerKey[] = ['organA', 'organB', 'pianoA', 'pianoB', 'synthA', 'synthB', 'synthC']
export const LAYER_SECTION: Record<LayerKey, SectionKey> = { organA: 'organ', organB: 'organ', pianoA: 'piano', pianoB: 'piano', synthA: 'synth', synthB: 'synth', synthC: 'synth' }
export const LAYER_LABEL: Record<LayerKey, string> = { organA: 'Organ A', organB: 'Organ B', pianoA: 'Piano A', pianoB: 'Piano B', synthA: 'Synth A', synthB: 'Synth B', synthC: 'Synth C' }

/* ---------- Organ ---------- */

export interface OrganLayerState {
  on: boolean
  level: number
  octave: number
  model: number
  drawbars: number[]
  vibrato: boolean
  sustped: boolean
  pstick: boolean
}
export interface OrganState {
  on: boolean
  focus: LayerId
  vibratoMode: number
  percussion: OrganPercussionParams
  layers: Record<LayerId, OrganLayerState>
}

export function defaultOrganLayerState(overrides: Partial<OrganLayerState> = {}): OrganLayerState {
  const base = defaultOrganLayerParams()
  return { on: base.on, level: base.level, octave: 0, model: 0, drawbars: [7, 3, 8, 4, 5, 3, 2, 2, 3], vibrato: false, sustped: true, pstick: false, ...overrides }
}
export function defaultOrganState(): OrganState {
  return {
    on: false,
    focus: 'A',
    vibratoMode: 5,
    percussion: { on: false, soft: false, fast: true, third: true, poly: false },
    layers: { A: defaultOrganLayerState({ on: true, level: 78 }), B: defaultOrganLayerState({ on: false, level: 55 }) },
  }
}

/* ---------- Synth ---------- */

export type SynthLayerState = Pick<SynthLayerParams, 'on' | 'level' | 'octave' | 'mode' | 'wave' | 'oscCtrl' | 'pitch' | 'oscEnv' | 'filter' | 'filterEnv' | 'ampEnv' | 'lfo' | 'voice' | 'unison' | 'vibrato' | 'arp' | 'pstick'>
export interface SynthState {
  on: boolean
  sustped: boolean
  focus: SynthLayerId
  kbHold: boolean
  layers: Record<SynthLayerId, SynthLayerState>
}

export function defaultSynthLayerState(overrides: Partial<SynthLayerState> = {}): SynthLayerState {
  const p = defaultSynthLayerParams()
  return { on: p.on, level: p.level, octave: p.octave, mode: p.mode, wave: p.wave, oscCtrl: p.oscCtrl, pitch: p.pitch, oscEnv: p.oscEnv, filter: p.filter, filterEnv: p.filterEnv, ampEnv: p.ampEnv, lfo: p.lfo, voice: p.voice, unison: p.unison, vibrato: p.vibrato, arp: p.arp, pstick: p.pstick, ...overrides }
}
export function defaultSynthState(): SynthState {
  return {
    on: true,
    sustped: true,
    focus: 'A',
    kbHold: false,
    layers: { A: defaultSynthLayerState({ on: true, level: 82 }), B: defaultSynthLayerState({ on: false, level: 40 }), C: defaultSynthLayerState({ on: false, level: 66 }) },
  }
}

/* ---------- Rotary, split, zones, scenes, morph, clock, transpose ---------- */

export interface RotaryState {
  /** 0 = slow, 1 = fast (fractional under a morph). */
  speed: number
  stop: boolean
  drive: number
  /** ORGAN button in the Rotary Speaker group: routes the organ through the rotary. */
  organ: boolean
}

export type SplitPointKey = 'low' | 'mid' | 'high'
export const SPLIT_POINT_KEYS: readonly SplitPointKey[] = ['low', 'mid', 'high']
/** The 11 documented split positions C2 .. C7 (manual p. 39). */
export const SPLIT_POSITIONS: readonly number[] = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96]
export const SPLIT_XFADES: readonly number[] = [0, 6, 12]
export interface SplitPoint {
  /** MIDI note from SPLIT_POSITIONS, or null = Off. */
  note: number | null
  /** Crossfade width in semitones on each side: 0 (off), 6 or 12. */
  xfade: number
}
export interface SplitState {
  on: boolean
  points: Record<SplitPointKey, SplitPoint>
}
export interface ZoneRange {
  from: number
  to: number
}
export type ZonesState = Record<LayerKey, ZoneRange>

export interface SceneEnables {
  sections: Record<SectionKey, boolean>
  layers: Record<LayerKey, boolean>
}
export interface ScenesState {
  active: 'I' | 'II'
  /** The enable configuration of the scene that is NOT active (the active scene is the live on-flags). */
  other: SceneEnables
}

export interface MorphAssignment {
  /** Program-relative path of the destination value (see MORPHABLE_PATHS). */
  path: string
  start: number
  end: number
}
export type MorphSource = 'wheel' | 'pedal'
export const MORPH_SOURCES: readonly MorphSource[] = ['wheel', 'pedal']
export type MorphState = Record<MorphSource, MorphAssignment[]>

export interface ClockState {
  bpm: number
  kbSync: boolean
}
export interface TransposeState {
  on: boolean
  semitones: number
}

export const CLOCK_BPM_MIN = 30
export const CLOCK_BPM_MAX = 300
export const TRANSPOSE_RANGE = 6
export const PROGRAM_NAME_MAX = 16

/* ---------- The program ---------- */

export interface ProgramState {
  name: string
  piano: PianoSettings & { focus: LayerId }
  organ: OrganState
  synth: SynthState
  effects: EffectsState
  rotary: RotaryState
  split: SplitState
  zones: ZonesState
  scenes: ScenesState
  morph: MorphState
  clock: ClockState
  transpose: TransposeState
}
export const PROGRAM_KEYS = ['name', 'piano', 'organ', 'synth', 'effects', 'rotary', 'split', 'zones', 'scenes', 'morph', 'clock', 'transpose'] as const

export function defaultZones(): ZonesState {
  const z = {} as ZonesState
  for (const k of LAYER_KEYS) z[k] = { from: 1, to: 4 }
  return z
}
export function defaultSplit(): SplitState {
  return { on: false, points: { low: { note: null, xfade: 0 }, mid: { note: 60, xfade: 0 }, high: { note: null, xfade: 0 } } }
}
export function emptyEnables(): SceneEnables {
  const layers = {} as Record<LayerKey, boolean>
  for (const k of LAYER_KEYS) layers[k] = false
  return { sections: { organ: false, piano: false, synth: false }, layers }
}

/** Projects a program out of a larger object (the instrument state) — keys only, no copying. */
export function programOf<T extends ProgramState>(state: T): ProgramState {
  return { name: state.name, piano: state.piano, organ: state.organ, synth: state.synth, effects: state.effects, rotary: state.rotary, split: state.split, zones: state.zones, scenes: state.scenes, morph: state.morph, clock: state.clock, transpose: state.transpose }
}

/* ---------- scenes ---------- */

/** The enable configuration currently live on the panel (= the active scene). */
export function sceneEnables(p: ProgramState): SceneEnables {
  return {
    sections: { organ: p.organ.on, piano: p.piano.on, synth: p.synth.on },
    layers: { organA: p.organ.layers.A.on, organB: p.organ.layers.B.on, pianoA: p.piano.layers.A.on, pianoB: p.piano.layers.B.on, synthA: p.synth.layers.A.on, synthB: p.synth.layers.B.on, synthC: p.synth.layers.C.on },
  }
}

/** Applies an enable configuration to the live flags; every other parameter is untouched (manual p. 43). */
export function applySceneEnables(p: ProgramState, e: SceneEnables): ProgramState {
  return {
    ...p,
    organ: { ...p.organ, on: e.sections.organ, layers: { A: { ...p.organ.layers.A, on: e.layers.organA }, B: { ...p.organ.layers.B, on: e.layers.organB } } },
    piano: { ...p.piano, on: e.sections.piano, layers: { A: { ...p.piano.layers.A, on: e.layers.pianoA }, B: { ...p.piano.layers.B, on: e.layers.pianoB } } },
    synth: { ...p.synth, on: e.sections.synth, layers: { A: { ...p.synth.layers.A, on: e.layers.synthA }, B: { ...p.synth.layers.B, on: e.layers.synthB }, C: { ...p.synth.layers.C, on: e.layers.synthC } } },
  }
}

/** Toggles Layer Scene I ↔ II: the live enables are parked as the other scene and the other scene becomes live. */
export function toggleScene(p: ProgramState): ProgramState {
  const current = sceneEnables(p)
  const next = applySceneEnables(p, p.scenes.other)
  return { ...next, scenes: { active: p.scenes.active === 'I' ? 'II' : 'I', other: current } }
}

/** Explicit scene I / II enables (serialisation, display). */
export function scenesExplicit(p: ProgramState): { I: SceneEnables; II: SceneEnables } {
  const live = sceneEnables(p)
  return p.scenes.active === 'I' ? { I: live, II: p.scenes.other } : { I: p.scenes.other, II: live }
}

/* ---------- serialisation and equality ---------- */

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as object).sort()) out[key] = stable((value as Record<string, unknown>)[key])
    return out
  }
  return value
}

const serialized = new WeakMap<ProgramState, string>()

/** Canonical JSON of a program (sorted keys, scenes explicit) — what Store writes and what the E indicator compares.
 *  Program objects are immutable once created, so the result is cached per object. */
export function serializeProgram(p: ProgramState): string {
  const cached = serialized.get(p)
  if (cached !== undefined) return cached
  const { scenes: _scenes, ...rest } = p
  const json = JSON.stringify(stable({ ...rest, scenes: { active: p.scenes.active, ...scenesExplicit(p) } }))
  serialized.set(p, json)
  return json
}

export function programsEqual(a: ProgramState, b: ProgramState): boolean {
  return a === b || serializeProgram(a) === serializeProgram(b)
}

export function cloneProgram(p: ProgramState): ProgramState {
  return JSON.parse(JSON.stringify(p)) as ProgramState
}

/** Parses a stored program: the explicit scene form (`{ active, I, II }`) is folded back to `{ active, other }` and the
 *  active scene's enables become the live flags; missing keys come from the fallback; unusable input → null. */
export function parseProgram(json: string | object, fallback: ProgramState): ProgramState | null {
  try {
    const raw = (typeof json === 'string' ? JSON.parse(json) : json) as Partial<ProgramState> & { scenes?: { active?: 'I' | 'II'; I?: Partial<SceneEnables>; II?: Partial<SceneEnables>; other?: Partial<SceneEnables> } }
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string') return null
    const { scenes: rawScenes, ...rest } = raw
    const merged = deepMerge(fallback, rest) as ProgramState
    const active: 'I' | 'II' = rawScenes?.active === 'II' ? 'II' : 'I'
    const normalize = (e: Partial<SceneEnables> | undefined, base: SceneEnables): SceneEnables => ({ sections: { ...base.sections, ...e?.sections }, layers: { ...base.layers, ...e?.layers } })
    const explicit = rawScenes && rawScenes.I && rawScenes.II
    const other = normalize(explicit ? (active === 'I' ? rawScenes.II : rawScenes.I) : rawScenes?.other, fallback.scenes.other)
    const program: ProgramState = { ...merged, scenes: { active, other } }
    if (!explicit) return program
    return applySceneEnables(program, normalize(active === 'I' ? rawScenes.I : rawScenes.II, sceneEnables(program)))
  } catch {
    return null
  }
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (Array.isArray(base)) return Array.isArray(patch) ? patch.map((v, i) => (i < base.length ? deepMerge(base[i], v) : v)) : base
  if (base && typeof base === 'object') {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = k in out ? deepMerge(out[k], v) : v
    return out
  }
  return patch === undefined || patch === null ? base : typeof patch === typeof base ? patch : base
}

/* ---------- morph paths ---------- */

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/** Immutable set along a dotted path (arrays are copied too). */
export function setPath<T>(obj: T, path: string, value: unknown): T {
  const parts = path.split('.')
  const walk = (node: unknown, i: number): unknown => {
    if (i === parts.length) return value
    const key = parts[i]
    if (Array.isArray(node)) {
      const copy = node.slice()
      copy[Number(key)] = walk(node[Number(key)], i + 1)
      return copy
    }
    const rec = (node ?? {}) as Record<string, unknown>
    return { ...rec, [key]: walk(rec[key], i + 1) }
  }
  return walk(obj, 0) as T
}

/** Range of a morphable destination path (start / end are clamped to it). */
export function morphRange(path: string): { min: number; max: number } {
  if (path.endsWith('.level')) return { min: 0, max: 100 }
  if (/\.drawbars\.\d$/.test(path)) return { min: 0, max: 8 }
  if (path === 'rotary.speed') return { min: 0, max: 1 }
  return { min: 0, max: 10 }
}

/** Applies both morph sources to a program: destination = start + (end − start) × source (manual p. 38–39). */
export function applyMorphs(p: ProgramState, sources: Record<MorphSource, number>): ProgramState {
  let out = p
  for (const source of MORPH_SOURCES) {
    const amount = clamp(sources[source], 0, 1)
    for (const a of p.morph[source]) {
      const { min, max } = morphRange(a.path)
      const value = clamp(a.start + (a.end - a.start) * amount, min, max)
      if (getPath(out, a.path) !== value) out = setPath(out, a.path, value)
    }
  }
  return out
}

/* ---------- zones and split crossfades ---------- */

/** Enabled split points in ascending note order with their zone-boundary order (low = 1, mid = 2, high = 3). */
export function enabledSplitPoints(split: SplitState): { key: SplitPointKey; note: number; xfade: number; order: number }[] {
  if (!split.on) return []
  return SPLIT_POINT_KEYS.map((key, i) => ({ key, note: split.points[key].note, xfade: split.points[key].xfade, order: i + 1 }))
    .filter((p): p is { key: SplitPointKey; note: number; xfade: number; order: number } => p.note !== null)
    .sort((a, b) => a.note - b.note)
}

/** Number of keyboard regions (zones actually separated) — 1 with the split off. */
export function regionCount(split: SplitState): number {
  return enabledSplitPoints(split).length + 1
}

/** Region index (0 = lowest) a zone slot 1..4 maps to: zones separated by an inactive point merge (manual p. 39). */
export function regionOfZone(split: SplitState, zone: number): number {
  return enabledSplitPoints(split).filter((p) => p.order < zone).length
}

/** Crossfade gains at a split point (manual p. 39): the lower sound reaches `xfade` notes above the point, the upper
 *  sound `xfade` notes below it; with xfade 0 the switch is immediate. */
export function lowerGainAt(note: number, point: number, xfade: number): number {
  if (note < point) return 1
  if (xfade <= 0) return 0
  return clamp((point + xfade - note) / xfade, 0, 1)
}
export function upperGainAt(note: number, point: number, xfade: number): number {
  if (note >= point) return 1
  if (xfade <= 0) return 0
  return clamp((note - (point - xfade)) / xfade, 0, 1)
}

/** Gain 0..1 with which a layer plays a (transposed) note: 1 with the split off, otherwise its zone coverage. */
export function layerNoteGain(split: SplitState, zone: ZoneRange, midi: number): number {
  const points = enabledSplitPoints(split)
  if (points.length === 0) return 1
  const regions = new Set<number>()
  for (let z = zone.from; z <= zone.to; z++) regions.add(regionOfZone(split, z))
  let gain = 0
  for (const r of regions) {
    const left = r > 0 ? points[r - 1] : null
    const right = r < points.length ? points[r] : null
    const g = (left ? upperGainAt(midi, left.note, left.xfade) : 1) * (right ? lowerGainAt(midi, right.note, right.xfade) : 1)
    if (g > gain) gain = g
  }
  return gain
}

/** All contiguous zone ranges in the order the KB ZONE buttons step through them. */
export const ZONE_RANGES: readonly ZoneRange[] = [
  { from: 1, to: 4 },
  { from: 1, to: 1 },
  { from: 1, to: 2 },
  { from: 1, to: 3 },
  { from: 2, to: 2 },
  { from: 2, to: 3 },
  { from: 2, to: 4 },
  { from: 3, to: 3 },
  { from: 3, to: 4 },
  { from: 4, to: 4 },
]

/** Steps a zone range: ▶ moves the range up (right), ◀ down (left), keeping its width where possible (manual p. 39). */
export function stepZone(zone: ZoneRange, direction: 1 | -1): ZoneRange {
  const width = zone.to - zone.from
  if (direction > 0) {
    if (zone.to < 4) return { from: zone.from + 1, to: zone.to + 1 }
    return width > 0 ? { from: zone.from + 1, to: 4 } : { from: 1, to: 4 }
  }
  if (zone.from > 1) return { from: zone.from - 1, to: zone.to - 1 }
  return width > 0 ? { from: 1, to: zone.to - 1 } : { from: 1, to: 4 }
}

/** Nearest documented split position to a played key. */
export function nearestSplitPosition(midi: number): number {
  let best = SPLIT_POSITIONS[0]
  for (const p of SPLIT_POSITIONS) if (Math.abs(p - midi) < Math.abs(best - midi)) best = p
  return best
}

/* ---------- names and formatting ---------- */

export const NAME_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-+.&/()#'
export function sanitizeName(name: string): string {
  const out = [...name].filter((c) => NAME_CHARS.includes(c)).join('').slice(0, PROGRAM_NAME_MAX)
  return out.trim().length ? out : 'Untitled'
}

/** "1.1" … "4.8" for slot 0..31; "L1" … "L8" for Live slots. */
export function slotLabel(slot: number, live = false): string {
  return live ? `L${slot + 1}` : `${Math.floor(slot / 8) + 1}.${(slot % 8) + 1}`
}

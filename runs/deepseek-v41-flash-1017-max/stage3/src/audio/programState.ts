/**
 * The canonical, serializable program state.
 *
 * One `ProgramState` holds everything a program stores: every section's enable/focus/level/
 * octave state, all three engines' sound parameters, the effect chains and their targeting,
 * splits and zones, both layer scenes, the morph assignments, and the master clock and
 * transpose. It deliberately **excludes** Master Level, exactly as
 * `specs/nord-stage-4.programs.json` says: the master level is a performance control, not
 * part of a stored sound.
 *
 * Every field is plain JSON — no class instances, no functions, no `undefined`. That is what
 * makes "save/load round-trips all supported state" a property that can be tested by
 * `JSON.parse(JSON.stringify(...))` rather than by trusting the setter.
 */
import type { ChainOwner, EngineId, LayerId, OrganLayerId, PianoLayerId, SynthLayerId } from './types'
import { CHAIN_OWNERS } from './types'
import { cloneChain, defaultChain, type ChainSettings, type EffectState } from './effectState'
import { clonePianoState, defaultPianoState, type PianoState } from './pianoState'
import { cloneOrganState, defaultOrganState, type OrganState } from './organState'
import { cloneSynthState, defaultSynthState, type SynthState } from './synthState'

/* ------------------------------------------------------------------ */
/* Splits and zones                                                   */
/* ------------------------------------------------------------------ */

/** The eleven split positions the spec documents, in keyboard order. */
export const SPLIT_POSITIONS = [
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
] as const

export type SplitPosition = (typeof SPLIT_POSITIONS)[number]

/** MIDI note for each documented split point. */
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
}

/** The three crossfade widths: Off, ±6, ±12 semitones. */
export const CROSSFADE_WIDTHS = [0, 6, 12] as const
export type CrossfadeWidth = (typeof CROSSFADE_WIDTHS)[number]

export type SplitPointId = 'Low' | 'Mid' | 'High'
export const SPLIT_POINT_IDS: readonly SplitPointId[] = ['Low', 'Mid', 'High']

export interface SplitPoint {
  /** The documented position this point sits on. */
  position: SplitPosition
  /** Off / ±6 / ±12 semitones of fade across the point. */
  crossfade: CrossfadeWidth
}

export interface SplitState {
  /** SPLIT ON: a split is active. */
  on: boolean
  /** The three split points, which together make up to four zones. */
  points: Record<SplitPointId, SplitPoint>
  /** The zones each layer is assigned to. Zone 0 is the lowest. */
  zones: Record<LayerId, boolean[]>
  revision: number
}

/** One keyboard zone: its boundaries, in MIDI notes, and the crossfade at each boundary. */
export interface ZoneBounds {
  /** Lowest MIDI note of the zone. */
  from: number
  /** Highest MIDI note of the zone. */
  to: number
  /** The split point starting this zone, or null for the lowest zone. */
  startPoint: SplitPosition | null
  /** The split point ending this zone, or null for the highest zone. */
  endPoint: SplitPosition | null
  /** Crossfade width at this zone's lower boundary. */
  crossfadeIn: CrossfadeWidth
  /** Crossfade width at this zone's upper boundary. */
  crossfadeOut: CrossfadeWidth
}

export const ALL_LAYER_IDS: readonly LayerId[] = [
  'piano.a',
  'piano.b',
  'organ.a',
  'organ.b',
  'synth.a',
  'synth.b',
  'synth.c',
]

/**
 * The four zones the three split points create.
 *
 * Zone 0 runs from the lowest key up to the Low point, zone 1 from Low to Mid, zone 2 from
 * Mid to High, and zone 3 from High to the top key. When the split is off there is one zone
 * covering the whole keyboard, which is why an unsplit program sounds everywhere.
 */
export function zoneBounds(split: SplitState, lowestMidi: number, highestMidi: number): ZoneBounds[] {
  if (!split.on) {
    return [
      {
        from: lowestMidi,
        to: highestMidi,
        startPoint: null,
        endPoint: null,
        crossfadeIn: 0,
        crossfadeOut: 0,
      },
    ]
  }
  // Keyboard order, so a Low point set above Mid cannot invert the zones.
  const points = SPLIT_POINT_IDS.map((id) => ({ id, ...split.points[id] })).sort(
    (a, b) => SPLIT_POSITION_MIDI[a.position] - SPLIT_POSITION_MIDI[b.position],
  )
  const bounds: ZoneBounds[] = []
  let from = lowestMidi
  let crossfadeIn: CrossfadeWidth = 0
  let startPoint: SplitPosition | null = null
  for (const point of points) {
    const midi = SPLIT_POSITION_MIDI[point.position]
    if (midi <= from) continue
    bounds.push({
      from,
      to: midi - 1,
      startPoint,
      endPoint: point.position,
      crossfadeIn,
      crossfadeOut: point.crossfade,
    })
    from = midi
    crossfadeIn = point.crossfade
    startPoint = point.position
  }
  bounds.push({
    from,
    to: highestMidi,
    startPoint,
    endPoint: null,
    crossfadeIn,
    crossfadeOut: 0,
  })
  return bounds
}

/**
 * The gain one zone contributes to a note.
 *
 * A crossfade belongs to a *boundary*, not to a zone. For a boundary at note `b` with width
 * `w`, the fade band spans `b − w` to `b + w`: at `b − w` the lower zone is at full level and
 * the upper at zero, at `b` both are at half level, and at `b + w` the upper is full and the
 * lower silent. That is what "fades across that many semitones on each side" means, and it is
 * the same thing as saying the two zones' gains sum to 1 everywhere.
 *
 * A zone's gain is the product of its fade-in at its lower boundary and its fade-out at its
 * upper boundary. The fade-in only constrains notes in or near the band; a note well inside
 * the zone is unaffected. With Off (width 0) a boundary switches immediately, which is the
 * `w = 0` case of the same formula.
 */
export function zoneGainForNote(zone: ZoneBounds, midi: number): number {
  const fadeIn = gainAtLowerBoundary(zone, midi)
  if (fadeIn <= 0) return 0
  const fadeOut = gainAtUpperBoundary(zone, midi)
  if (fadeOut <= 0) return 0
  return Math.min(1, fadeIn * fadeOut)
}

/** The 0..1 gain of a zone across its lower boundary, which is at `zone.from`. */
function gainAtLowerBoundary(zone: ZoneBounds, midi: number): number {
  const boundary = zone.from
  const width = zone.crossfadeIn
  // Off: the zone begins at the split point, exclusive below.
  if (width <= 0) return midi >= boundary ? 1 : 0
  // Outside the band below: silent. At or above the band's top: full.
  if (midi <= boundary - width) return 0
  if (midi >= boundary + width) return 1
  // 0 at boundary−w, 0.5 at the boundary, 1 at boundary+w.
  return (midi - (boundary - width)) / (2 * width)
}

/**
 * The 0..1 gain of a zone across its upper boundary.
 *
 * The zone's last note is one semitone below the next zone's first note, so the boundary the
 * fade centres on is `to + 1`. A note *below* the band (i.e. inside the zone) is unaffected,
 * which is why the guard is on the band, not on the zone's own range.
 */
function gainAtUpperBoundary(zone: ZoneBounds, midi: number): number {
  const boundary = zone.to + 1
  const width = zone.crossfadeOut
  // Off: the zone ends on its own last note.
  if (width <= 0) return midi <= zone.to ? 1 : 0
  // Above the band the zone has faded out completely.
  if (midi >= boundary + width) return 0
  // At or below the band's bottom the zone is at full level.
  if (midi <= boundary - width) return 1
  // 1 at boundary−w, 0.5 at the boundary, 0 at boundary+w.
  return (boundary + width - midi) / (2 * width)
}

/**
 * The gain a layer sounds a note at, `0` when the layer's zones do not cover it.
 *
 * A note inside a crossfade band belongs to two zones at once, so a layer assigned to both
 * hears the sum of the two fades — which is what the manual's crossfade describes.
 */
export function layerGainForNote(
  split: SplitState,
  layer: LayerId,
  midi: number,
  lowestMidi: number,
  highestMidi: number,
): number {
  const assigned = split.zones[layer]
  if (!assigned) return 0
  const bounds = zoneBounds(split, lowestMidi, highestMidi)
  let gain = 0
  for (let index = 0; index < bounds.length; index += 1) {
    if (assigned[index] !== true) continue
    gain += zoneGainForNote(bounds[index], midi)
  }
  return Math.min(1, Math.max(0, gain))
}

/** The zone index a note falls in, used by the note session to pick layers. */
export function zoneIndexForNote(
  split: SplitState,
  midi: number,
  lowestMidi: number,
  highestMidi: number,
): number {
  if (!split.on) return 0
  const bounds = zoneBounds(split, lowestMidi, highestMidi)
  for (let index = 0; index < bounds.length - 1; index += 1) {
    if (midi < bounds[index + 1].from) return index
  }
  return bounds.length - 1
}

/** A fresh split state: off, points at C3/C4/C5, every layer in the first two zones. */
export function defaultSplit(): SplitState {
  const zones = {} as Record<LayerId, boolean[]>
  for (const layer of ALL_LAYER_IDS) zones[layer] = [true, true, false, false]
  return {
    on: false,
    points: {
      Low: { position: 'C3', crossfade: 0 },
      Mid: { position: 'C4', crossfade: 0 },
      High: { position: 'C5', crossfade: 0 },
    },
    zones,
    revision: 0,
  }
}

export function cloneSplit(split: SplitState): SplitState {
  const zones = {} as Record<LayerId, boolean[]>
  for (const [layer, value] of Object.entries(split.zones)) zones[layer as LayerId] = [...value]
  return {
    points: {
      Low: { ...split.points.Low },
      Mid: { ...split.points.Mid },
      High: { ...split.points.High },
    },
    on: split.on,
    zones,
    revision: split.revision,
  }
}

/* ------------------------------------------------------------------ */
/* Layer scenes                                                       */
/* ------------------------------------------------------------------ */

export interface SceneState {
  /** True for Scene II, false for Scene I (manual p. 43). */
  second: boolean
  /** Enable state for Scene I, per layer. */
  sceneI: Record<LayerId, boolean>
  /** Enable state for Scene II, per layer. */
  sceneII: Record<LayerId, boolean>
}

function everyLayer(on: boolean): Record<LayerId, boolean> {
  const out = {} as Record<LayerId, boolean>
  for (const layer of ALL_LAYER_IDS) out[layer] = on
  return out
}

/**
 * A fresh scene pair, seeded from the engines' own defaults so Scene I is what the
 * instrument sounds like at power-on and Scene II starts as a copy the player can edit.
 *
 * A scene stores only enable state; the sound parameters are shared, which is the whole
 * point of the feature (manual p. 43).
 */
export function defaultScenes(piano: PianoState, organ: OrganState, synth: SynthState): SceneState {
  const sceneI = everyLayer(false)
  sceneI['piano.a'] = piano.sectionOn && piano.layers['piano.a'].enabled
  sceneI['piano.b'] = piano.sectionOn && piano.layers['piano.b'].enabled
  sceneI['organ.a'] = organ.sectionOn && organ.layers['organ.a'].enabled
  sceneI['organ.b'] = organ.sectionOn && organ.layers['organ.b'].enabled
  sceneI['synth.a'] = synth.sectionOn && synth.layers['synth.a'].enabled
  sceneI['synth.b'] = synth.sectionOn && synth.layers['synth.b'].enabled
  sceneI['synth.c'] = synth.sectionOn && synth.layers['synth.c'].enabled
  return { second: false, sceneI, sceneII: { ...sceneI } }
}

export function cloneScenes(scenes: SceneState): SceneState {
  return { second: scenes.second, sceneI: { ...scenes.sceneI }, sceneII: { ...scenes.sceneII } }
}

/** The enable map the active scene imposes. */
export function activeScene(scenes: SceneState): Record<LayerId, boolean> {
  return scenes.second ? scenes.sceneII : scenes.sceneI
}

/**
 * Applies a Layer Scene by writing its enable state into the engines' own layer flags.
 *
 * On the hardware the scene *is* the set of layer on/off states, viewed two ways: pressing a
 * layer button changes the active scene, and pressing LAYER SCENE II switches which stored set
 * applies. Modelling it as a second gate on top of the layer flags (which is what "scene
 * enabled" would be) would make a layer button look broken whenever the scene disagreed with
 * it. Writing the flags instead keeps one source of truth, so the LEDs, the routing and the
 * scene readout cannot diverge.
 */
export function applySceneToProgram(state: ProgramState, second: boolean): void {
  const scene = second ? state.scenes.sceneII : state.scenes.sceneI
  state.scenes.second = second
  for (const layer of ALL_LAYER_IDS) {
    const enabled = scene[layer] === true
    if (layer.startsWith('piano')) {
      state.piano.layers[layer as PianoLayerId].enabled = enabled
      if (enabled) state.piano.sectionOn = true
    } else if (layer.startsWith('organ')) {
      state.organ.layers[layer as OrganLayerId].enabled = enabled
      if (enabled) state.organ.sectionOn = true
    } else {
      state.synth.layers[layer as SynthLayerId].enabled = enabled
      if (enabled) state.synth.sectionOn = true
    }
  }
}

/**
 * Records the current layer enable state into the active scene.
 *
 * Called whenever a layer button is pressed, so the active scene always matches what the
 * panel shows and a later scene switch restores the configuration the player built.
 */
export function recordActiveScene(state: ProgramState): void {
  const target = state.scenes.second ? state.scenes.sceneII : state.scenes.sceneI
  for (const layer of ALL_LAYER_IDS) {
    target[layer] = layerIsEnabled(state, layer)
  }
}

/** True when a layer is enabled at both its section and layer level. */
export function layerIsEnabled(state: ProgramState, layer: LayerId): boolean {
  if (layer.startsWith('piano')) {
    return state.piano.sectionOn && state.piano.layers[layer as PianoLayerId].enabled
  }
  if (layer.startsWith('organ')) {
    return state.organ.sectionOn && state.organ.layers[layer as OrganLayerId].enabled
  }
  return state.synth.sectionOn && state.synth.layers[layer as SynthLayerId].enabled
}

/* ------------------------------------------------------------------ */
/* Morphs                                                             */
/* ------------------------------------------------------------------ */

export type MorphSource = 'Wheel' | 'Control Pedal'
export const MORPH_SOURCES: readonly MorphSource[] = ['Wheel', 'Control Pedal']

export interface MorphAssignment {
  /** The stable control id the morph drives. */
  controlId: string
  /** Value at morph source 0. */
  start: number
  /** Value at morph source 1 (max). May be below `start`, so a morph can lower a value. */
  end: number
}

export interface MorphState {
  wheel: MorphAssignment[]
  /** The Control Pedal source, driven by the on-screen pedal and by MIDI CC11. */
  pedal: MorphAssignment[]
  /** The current position of each source, 0..1. */
  wheelPosition: number
  pedalPosition: number
}

export function defaultMorph(): MorphState {
  return { wheel: [], pedal: [], wheelPosition: 0, pedalPosition: 0 }
}

export function cloneMorph(morph: MorphState): MorphState {
  return {
    wheel: morph.wheel.map((assignment) => ({ ...assignment })),
    pedal: morph.pedal.map((assignment) => ({ ...assignment })),
    wheelPosition: morph.wheelPosition,
    pedalPosition: morph.pedalPosition,
  }
}

export function assignmentsFor(morph: MorphState, source: MorphSource): MorphAssignment[] {
  return source === 'Wheel' ? morph.wheel : morph.pedal
}

export function morphPosition(morph: MorphState, source: MorphSource): number {
  return source === 'Wheel' ? morph.wheelPosition : morph.pedalPosition
}

/** The interpolated value of one assignment at a source position. */
export function interpolate(assignment: MorphAssignment, position: number): number {
  const t = Math.min(1, Math.max(0, position))
  return assignment.start + (assignment.end - assignment.start) * t
}

/**
 * Clears one source's assignments (Shift + the source button, manual p. 39) or, when a
 * control id is given, just that one (re-holding the source and zeroing a control).
 */
export function clearMorph(morph: MorphState, source: MorphSource, controlId?: string): void {
  const key = source === 'Wheel' ? 'wheel' : 'pedal'
  morph[key] = controlId ? morph[key].filter((entry) => entry.controlId !== controlId) : []
}

/** Adds or replaces the assignment for one control. */
export function assignMorph(
  morph: MorphState,
  source: MorphSource,
  controlId: string,
  start: number,
  end: number,
): void {
  const key = source === 'Wheel' ? 'wheel' : 'pedal'
  const existing = morph[key].findIndex((entry) => entry.controlId === controlId)
  const assignment: MorphAssignment = { controlId, start, end }
  if (existing >= 0) morph[key][existing] = assignment
  else morph[key].push(assignment)
}

/* ------------------------------------------------------------------ */
/* Master clock and transpose                                         */
/* ------------------------------------------------------------------ */

export interface ClockState {
  /** Beats per minute, 30..300 (spec `masterClock.range`). */
  bpm: number
  /** Keyboard sync: off/on. When on, the clock restarts with the first note. */
  keyboardSync: boolean
  /** Which targets follow the clock (spec `masterClock.syncTargets`). */
  sync: {
    arp: boolean
    lfo: boolean
    delay: boolean
    mod1: boolean
  }
}

export const BPM_RANGE = [30, 300] as const

export function defaultClock(): ClockState {
  return {
    bpm: 120,
    keyboardSync: true,
    sync: { arp: true, lfo: false, delay: false, mod1: false },
  }
}

export function cloneClock(clock: ClockState): ClockState {
  return { ...clock, sync: { ...clock.sync } }
}

/** Transpose range ±6 semitones (spec `transposeRangeSemitones`). */
export const TRANSPOSE_RANGE = [-6, 6] as const

/* ------------------------------------------------------------------ */
/* The program state itself                                           */
/* ------------------------------------------------------------------ */

export interface ProgramState {
  piano: PianoState
  organ: OrganState
  synth: SynthState
  effects: EffectState
  split: SplitState
  scenes: SceneState
  morph: MorphState
  clock: ClockState
  /** Transpose in semitones, -6..6. */
  transpose: number
  /** True when transpose is engaged (TRANSP ON). */
  transposeOn: boolean
}

export interface ProgramMeta {
  /** Slot number 1..32, or 1..8 in Live mode. */
  slot: number
  /** The program's name, as the display prints it. */
  name: string
  /** True for one of the eight Live slots. */
  live: boolean
}

/** A stored program: metadata plus the complete serializable state. */
export interface StoredProgram extends ProgramMeta {
  state: ProgramState
}

/**
 * The instrument's power-on program. Master Level is absent by design, so the master level
 * survives a program change exactly as it does on the hardware.
 */
export function defaultProgramState(): ProgramState {
  const piano = defaultPianoState()
  const organ = defaultOrganState()
  const synth = defaultSynthState()
  return {
    piano,
    organ,
    synth,
    effects: {
      allOn: true,
      focus: 'piano',
      focusedLayer: 'piano.a',
      pianoGroup: false,
      chains: buildChains(),
      rotary: { on: false, speed: 'Slow', drive: 3, organRouted: false },
      revision: 0,
    },
    split: defaultSplit(),
    scenes: defaultScenes(piano, organ, synth),
    morph: defaultMorph(),
    clock: defaultClock(),
    transpose: 0,
    transposeOn: false,
  }
}

function buildChains(): Record<ChainOwner, ChainSettings> {
  const chains = {} as Record<ChainOwner, ChainSettings>
  for (const owner of CHAIN_OWNERS) chains[owner] = defaultChain()
  return chains
}

/**
 * A deep clone that is guaranteed JSON-safe.
 *
 * Serialising is the cheapest proof that no function, class or `undefined` crept into the
 * state: if `JSON.stringify` then `JSON.parse` changes a field, the round-trip test fails.
 */
export function cloneProgramState(state: ProgramState): ProgramState {
  const chains = {} as Record<ChainOwner, ChainSettings>
  for (const owner of CHAIN_OWNERS) chains[owner] = cloneChain(state.effects.chains[owner] ?? defaultChain())
  return {
    piano: clonePianoState(state.piano),
    organ: cloneOrganState(state.organ),
    synth: cloneSynthState(state.synth),
    effects: {
      ...state.effects,
      chains,
      rotary: { ...state.effects.rotary },
      revision: state.effects.revision + 1,
    },
    split: cloneSplit(state.split),
    scenes: cloneScenes(state.scenes),
    morph: cloneMorph(state.morph),
    clock: cloneClock(state.clock),
    transpose: state.transpose,
    transposeOn: state.transposeOn,
  }
}

/** The canonical serialized form of a program state. */
export function serializeProgram(state: ProgramState): string {
  return JSON.stringify(state)
}

/** Reads a serialized program state back. Throws on malformed input rather than guessing. */
export function deserializeProgram(text: string): ProgramState {
  const parsed = JSON.parse(text) as ProgramState
  return cloneProgramState(parsed)
}

/**
 * Structural equality for two program states, used by the dirty indicator.
 *
 * Three properties matter here:
 *
 *  - `revision` counters are ignored. They change on every edit that does not change any
 *    value, and a dirty flag that lit up on those would be a lie about the state.
 *  - Key *order* is ignored. `JSON.stringify` emits keys in insertion order, so a state
 *    rebuilt through a different path can serialise to the same values in a different order;
 *    a naive string comparison would call that "dirty".
 *  - `masterLevel` is ignored, because the Master Level knob is a performance control that a
 *    program does not store (`programState.excludes: ["Master Level"]`).
 */
export function programStatesEqual(a: ProgramState, b: ProgramState): boolean {
  return canonical(a) === canonical(b)
}

/** Keys that are part of the instrument but not part of a stored program. */
const NOT_PROGRAM_STATE = new Set(['revision', 'masterLevel'])

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !NOT_PROGRAM_STATE.has(key))
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
}

/** The layer ids each engine contributes, for routing tests and the UI. */
export const LAYERS_BY_ENGINE: Record<EngineId, readonly LayerId[]> = {
  piano: ['piano.a', 'piano.b'] as readonly PianoLayerId[],
  organ: ['organ.a', 'organ.b'] as readonly OrganLayerId[],
  synth: ['synth.a', 'synth.b', 'synth.c'] as readonly SynthLayerId[],
}

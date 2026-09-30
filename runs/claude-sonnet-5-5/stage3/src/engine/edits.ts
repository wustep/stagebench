/**
 * Pure reducers for the Organ, Synth and Program/performance parts of the canonical state. The panel bindings, the factory
 * programs and the tests all edit state through these.
 */
import { DEFAULT_DRAWBARS, ORGAN_MODELS, VIB_MODES, type OrganLayerState, type OrganModel, type PercussionState, type VibMode } from './organ'
import { emptyMorph, type MorphSource } from './morph'
import { commitScene } from './scenes'
import { LAYER_IDS, otherLayer, type EngineState, type LayerGesture, type LayerId } from './state'
import { SYNTH_LAYER_IDS, type SynthLayerId, type SynthLayerState, type SynthPatch } from './synth'
import {
  CROSSFADES,
  SOURCE_KEYS,
  SPLIT_POINT_IDS,
  SPLIT_POSITIONS,
  defaultSplit,
  nearestPosition,
  splitIsOn,
  stepZoneRange,
  type Crossfade,
  type SourceKey,
  type SplitPointId,
} from './zones'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const clampInt = (v: number, lo: number, hi: number) => clamp(Math.round(v), lo, hi)
const clamp01 = (v: number) => clamp(v, 0, 1)

// --- layer button gestures for any number of layers (manual p. 23) -------------------------------------------
export function layerGesture<L extends string>(enabled: Record<L, boolean>, focus: L, ids: readonly L[], layer: L, gesture: LayerGesture): { enabled: Record<L, boolean>; focus: L } {
  const next = { ...enabled }
  let nextFocus = focus
  const others = ids.filter((id) => id !== layer && next[id])
  switch (gesture) {
    case 'both':
      next[layer] = true
      nextFocus = layer
      break
    case 'shift':
      if (!next[layer]) {
        next[layer] = true
        nextFocus = layer
      } else if (others.length > 0) {
        next[layer] = false
        nextFocus = others[0]
      }
      break
    case 'hold':
      if (next[layer] && others.length > 0) {
        next[layer] = false
        nextFocus = others[0]
      }
      break
    case 'tap':
      if (!next[layer]) {
        if (others.length === 1) next[others[0]] = false
        next[layer] = true
      }
      nextFocus = layer
      break
  }
  return { enabled: next, focus: nextFocus }
}

// --- Organ ---------------------------------------------------------------------------------------------------------
const editOrganLayer = (s: EngineState, id: LayerId, patch: (l: OrganLayerState) => OrganLayerState): EngineState => {
  const before = s.organ.layers[id]
  const after = patch(before)
  return after === before ? s : { ...s, organ: { ...s.organ, layers: { ...s.organ.layers, [id]: after } } }
}
export const editFocusedOrgan = (s: EngineState, patch: (l: OrganLayerState) => OrganLayerState): EngineState => editOrganLayer(s, s.organFocus, patch)

export function pressOrganLayer(s: EngineState, layer: LayerId, gesture: LayerGesture): EngineState {
  const enabled = { A: s.organ.layers.A.enabled, B: s.organ.layers.B.enabled }
  const r = layerGesture(enabled, s.organFocus, LAYER_IDS, layer, gesture)
  let next = s
  for (const id of LAYER_IDS) if (r.enabled[id] !== s.organ.layers[id].enabled) next = editOrganLayer(next, id, (l) => ({ ...l, enabled: r.enabled[id] }))
  // pressing a layer button of a section that is off switches the section on
  const turnedOn = LAYER_IDS.some((id) => r.enabled[id] && !s.organ.layers[id].enabled)
  return { ...next, organFocus: r.focus, fxSection: 'organ', organOn: next.organOn || turnedOn }
}
export const setOrganOn = (s: EngineState, on: boolean): EngineState => (s.organOn === on ? s : { ...s, organOn: on })
export const setOrganLevel = (s: EngineState, id: LayerId, v: number): EngineState => (s.organ.layers[id].level === clamp01(v) ? s : editOrganLayer(s, id, (l) => ({ ...l, level: clamp01(v) })))
export const shiftOrganOctave = (s: EngineState, delta: 1 | -1): EngineState =>
  editFocusedOrgan(s, (l) => (clampInt(l.octave + delta, -1, 1) === l.octave ? l : { ...l, octave: clampInt(l.octave + delta, -1, 1) as -1 | 0 | 1 }))
export const setOrganSustPed = (s: EngineState, on: boolean): EngineState => editFocusedOrgan(s, (l) => (l.sustPed === on ? l : { ...l, sustPed: on }))
export const setOrganPitchStick = (s: EngineState, on: boolean): EngineState => editFocusedOrgan(s, (l) => (l.pitchStick === on ? l : { ...l, pitchStick: on }))
/** selecting a model loads that model's classic registration (the drawbars mean different things per model) */
export const setOrganModel = (s: EngineState, model: OrganModel): EngineState => editFocusedOrgan(s, (l) => (l.model === model ? l : { ...l, model, drawbars: [...DEFAULT_DRAWBARS[model]] }))
export const cycleOrganModel = (s: EngineState): EngineState => setOrganModel(s, ORGAN_MODELS[(ORGAN_MODELS.indexOf(s.organ.layers[s.organFocus].model) + 1) % ORGAN_MODELS.length])
export const setDrawbar = (s: EngineState, index: number, v: number): EngineState =>
  editFocusedOrgan(s, (l) => {
    const value = clampInt(v, 0, 8)
    if (l.drawbars[index] === value) return l
    const drawbars = [...l.drawbars]
    drawbars[index] = value
    return { ...l, drawbars }
  })
export const setVibMode = (s: EngineState, mode: VibMode): EngineState => (s.organ.vibMode === mode ? s : { ...s, organ: { ...s.organ, vibMode: mode } })
export const setVibModeIndex = (s: EngineState, i: number): EngineState => setVibMode(s, VIB_MODES[clampInt(i, 0, VIB_MODES.length - 1)])
export const setVibOn = (s: EngineState, on: boolean): EngineState => editFocusedOrgan(s, (l) => (l.vibOn === on ? l : { ...l, vibOn: on }))
export const setPercussion = (s: EngineState, patch: Partial<PercussionState>): EngineState => {
  const perc = { ...s.organ.perc, ...patch }
  return JSON.stringify(perc) === JSON.stringify(s.organ.perc) ? s : { ...s, organ: { ...s.organ, perc } }
}

// --- Synth -----------------------------------------------------------------------------------------------------------
const editSynthLayer = (s: EngineState, id: SynthLayerId, patch: (l: SynthLayerState) => SynthLayerState): EngineState => {
  const before = s.synth[id]
  const after = patch(before)
  return after === before ? s : { ...s, synth: { ...s.synth, [id]: after } }
}
export const editFocusedSynthLayer = (s: EngineState, patch: (l: SynthLayerState) => SynthLayerState): EngineState => editSynthLayer(s, s.synthFocus, patch)

/** edit the focused synth layer's patch; returns the same state when nothing changed */
export function editSynth(s: EngineState, patch: (p: SynthPatch) => SynthPatch): EngineState {
  return editFocusedSynthLayer(s, (l) => {
    const p = patch(l.patch)
    return JSON.stringify(p) === JSON.stringify(l.patch) ? l : { ...l, patch: p }
  })
}

export function pressSynthLayer(s: EngineState, layer: SynthLayerId, gesture: LayerGesture): EngineState {
  const enabled = { A: s.synth.A.enabled, B: s.synth.B.enabled, C: s.synth.C.enabled }
  const r = layerGesture(enabled, s.synthFocus, SYNTH_LAYER_IDS, layer, gesture)
  let next = s
  for (const id of SYNTH_LAYER_IDS) if (r.enabled[id] !== s.synth[id].enabled) next = editSynthLayer(next, id, (l) => ({ ...l, enabled: r.enabled[id] }))
  const turnedOn = SYNTH_LAYER_IDS.some((id) => r.enabled[id] && !s.synth[id].enabled)
  return { ...next, synthFocus: r.focus, synthFxFocus: r.focus, fxSection: 'synth', synthOn: next.synthOn || turnedOn }
}
export const setSynthOn = (s: EngineState, on: boolean): EngineState => (s.synthOn === on ? s : { ...s, synthOn: on })
export const setSynthLevel = (s: EngineState, id: SynthLayerId, v: number): EngineState => (s.synth[id].level === clamp01(v) ? s : editSynthLayer(s, id, (l) => ({ ...l, level: clamp01(v) })))
export const shiftSynthOctave = (s: EngineState, delta: 1 | -1): EngineState =>
  editFocusedSynthLayer(s, (l) => (clampInt(l.octave + delta, -1, 1) === l.octave ? l : { ...l, octave: clampInt(l.octave + delta, -1, 1) as -1 | 0 | 1 }))
export const setSynthSustPed = (s: EngineState, on: boolean): EngineState => editFocusedSynthLayer(s, (l) => (l.sustPed === on ? l : { ...l, sustPed: on }))
export const setSynthPitchStick = (s: EngineState, on: boolean): EngineState => editFocusedSynthLayer(s, (l) => (l.pitchStick === on ? l : { ...l, pitchStick: on }))

// --- Scenes, splits, zones, transpose, clock -----------------------------------------------------------------------
/** Layer Scene I/II: swaps the enable state only; every sound parameter is shared */
export function setScene(s: EngineState, scene: 0 | 1): EngineState {
  if (s.scene === scene) return s
  const committed = commitScene(s)
  const flags = committed.scenes[scene]
  return {
    ...committed,
    scene,
    pianoOn: flags.sections.piano,
    organOn: flags.sections.organ,
    synthOn: flags.sections.synth,
    layers: { A: { ...committed.layers.A, enabled: flags.layers['piano.A'] }, B: { ...committed.layers.B, enabled: flags.layers['piano.B'] } },
    organ: { ...committed.organ, layers: { A: { ...committed.organ.layers.A, enabled: flags.layers['organ.A'] }, B: { ...committed.organ.layers.B, enabled: flags.layers['organ.B'] } } },
    synth: {
      A: { ...committed.synth.A, enabled: flags.layers['synth.A'] },
      B: { ...committed.synth.B, enabled: flags.layers['synth.B'] },
      C: { ...committed.synth.C, enabled: flags.layers['synth.C'] },
    },
  }
}
export const toggleScene = (s: EngineState): EngineState => setScene(s, s.scene === 0 ? 1 : 0)

/** SPLIT ON/SET: a tap switches the split on (a single Mid split at C4) or off */
export function toggleSplit(s: EngineState): EngineState {
  if (splitIsOn(s.split)) return { ...s, split: Object.fromEntries(SPLIT_POINT_IDS.map((id) => [id, { ...s.split[id], active: false }])) as typeof s.split }
  return { ...s, split: { ...defaultSplit(), mid: { active: true, position: 4, crossfade: s.split.mid.crossfade } } }
}
export function setSplitPoint(s: EngineState, id: SplitPointId, patch: Partial<{ active: boolean; position: number; crossfade: Crossfade }>): EngineState {
  const before = s.split[id]
  const after = { ...before, ...patch, position: clampInt(patch.position ?? before.position, 0, SPLIT_POSITIONS.length - 1) }
  return JSON.stringify(after) === JSON.stringify(before) ? s : { ...s, split: { ...s.split, [id]: after } }
}
export const stepSplitPosition = (s: EngineState, id: SplitPointId, delta: number): EngineState => setSplitPoint(s, id, { position: s.split[id].position + delta })
export const setSplitKey = (s: EngineState, id: SplitPointId, note: number): EngineState => setSplitPoint(s, id, { position: nearestPosition(note), active: true })
export const cycleCrossfade = (s: EngineState, id: SplitPointId): EngineState => setSplitPoint(s, id, { crossfade: CROSSFADES[(CROSSFADES.indexOf(s.split[id].crossfade) + 1) % CROSSFADES.length] })

export const sourceKeyOf = (section: 'piano' | 'organ' | 'synth', layer: string): SourceKey => `${section}.${layer}` as SourceKey
/** KB ZONE arrows: step the focused layer of a section through the contiguous zone ranges */
export function stepZone(s: EngineState, section: 'piano' | 'organ' | 'synth', direction: 1 | -1): EngineState {
  const layer = section === 'piano' ? s.focus : section === 'organ' ? s.organFocus : s.synthFocus
  const key = sourceKeyOf(section, layer)
  return { ...s, zones: { ...s.zones, [key]: stepZoneRange(s.zones[key], direction) } }
}
export const focusedLayerOf = (s: EngineState, section: 'piano' | 'organ' | 'synth'): string => (section === 'piano' ? s.focus : section === 'organ' ? s.organFocus : s.synthFocus)

export const setBpm = (s: EngineState, bpm: number): EngineState => {
  const v = clampInt(bpm, 30, 300)
  return s.clock.bpm === v ? s : { ...s, clock: { bpm: v } }
}
export const setTransposeOn = (s: EngineState, on: boolean): EngineState => (s.transpose.on === on ? s : { ...s, transpose: { ...s.transpose, on } })
export const setTransposeSemitones = (s: EngineState, semitones: number): EngineState => {
  const v = clampInt(semitones, -6, 6)
  return s.transpose.semitones === v ? s : { ...s, transpose: { on: v !== 0 ? true : s.transpose.on, semitones: v } }
}

export const setModWheel = (s: EngineState, v: number): EngineState => (s.modWheel === clamp01(v) ? s : { ...s, modWheel: clamp01(v) })
export const setPedalPos = (s: EngineState, v: number): EngineState => (s.pedalPos === clamp01(v) ? s : { ...s, pedalPos: clamp01(v) })
export const clearMorphSource = (s: EngineState, source: MorphSource): EngineState => (s.morph[source].length === 0 ? s : { ...s, morph: { ...s.morph, [source]: [] } })
export const clearAllMorph = (s: EngineState): EngineState => ({ ...s, morph: emptyMorph() })

/** Panic (Shift + Transpose): performance inputs return to rest; the caller stops the notes */
export const resetPerformanceInputs = (s: EngineState): EngineState => ({ ...s, pitchBend: 0 })

export const allSourceKeys = SOURCE_KEYS
export { otherLayer }

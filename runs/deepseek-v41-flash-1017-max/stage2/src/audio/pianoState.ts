/**
 * Piano section state.
 *
 * The Piano section's own settings — layer enable/focus/level/octave, type and model per
 * layer, and the performance controls — live here. The panel writes to this store and the
 * note session reads it, so a key press always uses exactly what the panel shows.
 *
 * Organ, Synth and Program state deliberately does not live here: those sections stay
 * decorative in Phase 2.
 */
import {
  DYN_COMP_AMOUNTS,
  KB_TOUCH_CURVES,
  UNISON_DETUNE_CENTS,
  defaultModelForType,
  modelById,
  timbreIndexFor,
} from './pianoLibrary'
import type { ChainOwner, PianoModelId, PianoTypeId } from './types'

export type PianoLayerId = ChainOwner

export interface PianoLayerState {
  id: PianoLayerId
  enabled: boolean
  /** Layer level fader, 0..100 as printed on the panel. */
  level: number
  /** Octave shift in semitones: -12, 0 or +12 (manual p. 23). */
  octave: number
  type: PianoTypeId
  model: PianoModelId
  /** SUSTPED: the sustain pedal applies to this layer (manual p. 23). */
  sustPed: boolean
  /** PSTICK: the pitch stick bends this layer (manual p. 23). Never claimed as audible. */
  pitchStick: boolean
}

export interface PianoState {
  /** Piano SECTION on/off. */
  sectionOn: boolean
  /** Focused layer. The FX focus follows this (manual p. 48). */
  focused: PianoLayerId
  layers: Record<PianoLayerId, PianoLayerState>
  /** KB TOUCH index 0..2 (HEAVY / MED / LIGHT). */
  kbTouch: number
  /** DYN COMP index 0..3 (OFF / 1 / 2 / 3). */
  dynComp: number
  /**
   * Timbre position as printed on the panel (0..4: SOFT, MID, BRIGHT, DYNO 1, DYNO 2).
   * `timbreIndexFor` resolves it into the focused type's own voicing list.
   */
  timbre: number
  /** UNISON index 0..3. */
  unison: number
  softRelease: boolean
  stringRes: boolean
  /** Master level knob, 0..100 as printed. */
  masterLevel: number
  revision: number
}

export function defaultPianoState(): PianoState {
  const grand = defaultModelForType('grand')
  return {
    sectionOn: true,
    focused: 'piano.a',
    layers: {
      'piano.a': {
        id: 'piano.a',
        enabled: true,
        level: 80,
        octave: 0,
        type: 'grand',
        model: grand.id,
        sustPed: true,
        pitchStick: false,
      },
      'piano.b': {
        id: 'piano.b',
        enabled: false,
        level: 0,
        octave: 0,
        type: 'grand',
        model: grand.id,
        sustPed: true,
        pitchStick: false,
      },
    },
    kbTouch: 1,
    dynComp: 0,
    timbre: 1,
    unison: 0,
    softRelease: false,
    stringRes: false,
    masterLevel: 78,
    revision: 0,
  }
}

export function clonePianoState(state: PianoState): PianoState {
  return {
    ...state,
    layers: { 'piano.a': { ...state.layers['piano.a'] }, 'piano.b': { ...state.layers['piano.b'] } },
    revision: state.revision + 1,
  }
}

export interface PianoStore {
  get(): PianoState
  update(mutate: (draft: PianoState) => void): void
  subscribe(listener: (state: PianoState) => void): () => void
}

export function createPianoStore(initial?: PianoState): PianoStore {
  let state = initial ?? defaultPianoState()
  const listeners = new Set<(state: PianoState) => void>()
  return {
    get: () => state,
    update(mutate) {
      const draft = clonePianoState(state)
      mutate(draft)
      state = draft
      for (const listener of listeners) listener(state)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** Layers that should sound for a new note, in a stable order. */
export function activeLayers(state: PianoState): PianoLayerId[] {
  if (!state.sectionOn) return []
  return (['piano.a', 'piano.b'] as PianoLayerId[]).filter((id) => state.layers[id].enabled)
}

/** The settings a voice on `layer` should be created with. */
export function voiceParamsFor(state: PianoState, layer: PianoLayerId, velocity: number) {
  const layerState = state.layers[layer]
  return {
    velocity,
    layer,
    octave: layerState.octave,
    model: layerState.model,
    touchExponent: KB_TOUCH_CURVES[Math.max(0, Math.min(2, Math.round(state.kbTouch)))].exponent,
    dynComp: DYN_COMP_AMOUNTS[Math.max(0, Math.min(3, Math.round(state.dynComp)))],
    // Resolved into this layer's family so an acoustic piano never receives a Dyno voicing.
    timbre: timbreIndexFor(layerState.type, state.timbre),
    unison: Math.max(0, Math.min(3, Math.round(state.unison))),
    softRelease: state.softRelease && (modelById(layerState.model)?.softRelease ?? true),
    stringRes: state.stringRes && (modelById(layerState.model)?.stringRes ?? false),
  }
}

/** Unison detune in cents for the current setting, used by the audible test. */
export function unisonCents(unison: number): number {
  return UNISON_DETUNE_CENTS[Math.max(0, Math.min(3, Math.round(unison)))]
}

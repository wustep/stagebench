/**
 * Organ section state.
 *
 * Two layers (A, B), each with its own model, drawbar registration, vibrato/chorus and
 * octave shift. The layers share one effect chain, which is why the state has no per-layer
 * chain settings — that belongs to `effectState`, owned by the single `organ` chain.
 *
 * The panel writes here; the note session reads here at press time; the engine reads here
 * when it builds a voice. One state object, so a drawbar's LED graph and the spectrum it
 * claims to be making cannot disagree.
 */
import type { OrganLayerId } from './types'
import { ORGAN_LAYERS } from './types'
export type { OrganLayerId }
import {
  VIBRATO_CHORUS_PANEL_ORDER,
  organModelFromPanel,
  panelIndexForOrganModel,
  type OrganModelId,
  type VibratoChorusType,
} from './organModel'

export interface OrganLayerState {
  id: OrganLayerId
  enabled: boolean
  /** Layer level fader, 0..100 as printed. */
  level: number
  /** Octave shift in semitones: -12, 0 or +12. */
  octave: number
  model: OrganModelId
  /** Nine drawbar positions, 0..8 (manual p. 19). */
  drawbars: number[]
  /** VIB/CHORUS ON for this layer (B3 supports per-layer on/off, manual p. 19). */
  vibratoOn: boolean
  /** The shared scanner setting. Both layers read the same printed selector. */
  vibratoType: VibratoChorusType
  /** B3 percussion, per layer. */
  percussion: {
    on: boolean
    /** VOLUME SOFT: soft rather than normal level. */
    soft: boolean
    /** DECAY FAST: fast rather than slow decay. */
    fast: boolean
    /** HARMONIC THIRD: 3rd rather than 2nd harmonic. */
    third: boolean
    /** POLY: percussion retriggers on every new stroke (manual p. 20). */
    poly: boolean
  }
  /** Key click level is fixed by the model; this is the panel's on/off. */
  keyClick: boolean
  sustPed: boolean
  pitchStick: boolean
  /** KB ZONE 1..4 assignment (manual p. 39). */
  zones: [boolean, boolean, boolean, boolean]
}

export interface OrganState {
  sectionOn: boolean
  focused: OrganLayerId
  layers: Record<OrganLayerId, OrganLayerState>
  revision: number
}

/**
 * The instrument's power-on registration.
 *
 * These are the positions the panel's nine drawbars are printed in, because a drawbar's
 * physical position *is* its setting (the spec's Drawbar Live concept): a state that
 * disagreed with the printed positions would make the first note play something the panel
 * is not showing.
 */
export const B3_DEFAULT_DRAWBARS: readonly number[] = [8, 0, 8, 6, 3, 0, 0, 0, 0]

/** Farf's registers are on/off, so its default pulls the 8' and 4' flute/string ranks. */
const FARF_DEFAULT_DRAWBARS: readonly number[] = [0, 0, 8, 0, 0, 8, 0, 0, 0]

export function defaultOrganLayer(id: OrganLayerId, enabled: boolean): OrganLayerState {
  return {
    id,
    enabled,
    // A layer's fader is its own volume, so an enabled layer starts audible rather than at
    // zero (a zero fader would make a freshly enabled layer look broken).
    level: 72,
    octave: 0,
    model: 'b3',
    drawbars: [...(enabled ? B3_DEFAULT_DRAWBARS : B3_DEFAULT_DRAWBARS)],
    vibratoOn: false,
    vibratoType: 'C3',
    percussion: { on: false, soft: false, fast: false, third: false, poly: false },
    keyClick: true,
    sustPed: true,
    pitchStick: false,
    zones: [true, true, false, false],
  }
}

export function defaultOrganState(): OrganState {
  return {
    sectionOn: true,
    focused: 'organ.a',
    layers: {
      'organ.a': defaultOrganLayer('organ.a', true),
      'organ.b': { ...defaultOrganLayer('organ.b', false), enabled: false },
    },
    revision: 0,
  }
}

export function cloneOrganState(state: OrganState): OrganState {
  const cloneLayer = (layer: OrganLayerState): OrganLayerState => ({
    ...layer,
    drawbars: [...layer.drawbars],
    percussion: { ...layer.percussion },
    zones: [...layer.zones] as [boolean, boolean, boolean, boolean],
  })
  return {
    ...state,
    layers: { 'organ.a': cloneLayer(state.layers['organ.a']), 'organ.b': cloneLayer(state.layers['organ.b']) },
    revision: state.revision + 1,
  }
}

export interface OrganStore {
  get(): OrganState
  update(mutate: (draft: OrganState) => void): void
  subscribe(listener: (state: OrganState) => void): () => void
}

export function createOrganStore(initial?: OrganState): OrganStore {
  let state = initial ?? defaultOrganState()
  const listeners = new Set<(state: OrganState) => void>()
  return {
    get: () => state,
    update(mutate) {
      const draft = cloneOrganState(state)
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

/** Layers that should sound for a new note in `zone`, in a stable order. */
export function activeOrganLayers(state: OrganState, zone: number): OrganLayerId[] {
  if (!state.sectionOn) return []
  return ORGAN_LAYERS.filter((id) => {
    const layer = state.layers[id]
    return layer.enabled && layer.zones[zone] === true
  })
}

/**
 * The default registration for a model, used when a model is selected so the new model
 * starts with a registration that actually sounds rather than whatever the previous
 * model's drawbar semantics left behind (Farf's registers are on/off, the others are not).
 */
export function defaultDrawbarsFor(model: OrganModelId): number[] {
  if (model === 'farf') return [...FARF_DEFAULT_DRAWBARS]
  if (model === 'b3-bass') return [8, 0, 8, 0, 0, 0, 0, 0, 0]
  if (model === 'vox') return [8, 8, 8, 6, 4, 2, 0, 4, 0]
  if (model === 'pipe1') return [6, 8, 0, 6, 0, 4, 0, 0, 3]
  if (model === 'pipe2') return [4, 8, 0, 8, 0, 6, 0, 4, 5]
  return [...B3_DEFAULT_DRAWBARS]
}

/** The printed panel index of a layer's model, for the selector and the display. */
export function organModelPanelIndex(layer: OrganLayerState): number {
  return panelIndexForOrganModel(layer.model)
}

/** Resolves a printed selector index back to a model. */
export function organModelFromIndex(index: number): OrganModelId {
  return organModelFromPanel(index)
}

/** The printed selector index of a vibrato/chorus type. */
export function vibratoPanelIndex(type: VibratoChorusType): number {
  return VIBRATO_CHORUS_PANEL_ORDER.indexOf(type)
}

export function vibratoFromIndex(index: number): VibratoChorusType {
  const clamped = Math.max(0, Math.min(VIBRATO_CHORUS_PANEL_ORDER.length - 1, Math.round(index)))
  return VIBRATO_CHORUS_PANEL_ORDER[clamped]
}

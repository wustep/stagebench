// Canonical Organ section state (organ spec): two layers that may use different models, nine
// drawbars per layer, B3 percussion, the vibrato/chorus selector (per-layer on/off) and SUSTPED/
// PSTICK/zones shared with the other sections. The Rotary routing button lives in RotaryState.
import { commonDefaults, type CommonLayer } from './layerCommon'

/** Model order of the ORGAN MODEL button's six LEDs (panel states 1…6). */
export const ORGAN_MODELS = ['farf', 'vox', 'b3', 'pipe1', 'pipe2', 'b3bass'] as const
export type OrganModel = (typeof ORGAN_MODELS)[number]

export const ORGAN_MODEL_NAMES: Record<OrganModel, string> = {
  farf: 'Farf',
  vox: 'Vox',
  b3: 'B3',
  pipe1: 'Pipe 1',
  pipe2: 'Pipe 2',
  b3bass: 'B3 Bass',
}

/** VIB/CHORUS button order (panel states 1…6). */
export const VIB_TYPES = ['V1', 'V2', 'V3', 'C1', 'C2', 'C3'] as const
export type VibType = (typeof VIB_TYPES)[number]

export interface Percussion {
  on: boolean
  /** VOLUME SOFT */
  soft: boolean
  /** DECAY FAST */
  fast: boolean
  /** HARMONIC THIRD */
  third: boolean
}

export interface OrganLayerState extends CommonLayer {
  model: OrganModel
  /** Nine drawbars / registers, 0…8. */
  drawbars: number[]
  /** Vibrato/chorus on for this layer. */
  vibOn: boolean
  perc: Percussion
}

export type OrganLayerId = 'A' | 'B'
export const ORGAN_LAYERS: readonly OrganLayerId[] = ['A', 'B']

export interface OrganSection {
  on: boolean
  focus: OrganLayerId
  /** Vibrato/chorus type shared by both layers (each layer switches it on/off). */
  vibType: VibType
  layers: Record<OrganLayerId, OrganLayerState>
}

export function defaultOrganLayer(enabled: boolean, drawbars: number[], level = 100): OrganLayerState {
  return {
    ...commonDefaults(enabled, level, false),
    model: 'b3',
    drawbars: [...drawbars],
    vibOn: false,
    perc: { on: false, soft: false, fast: true, third: true },
  }
}

export function defaultOrgan(): OrganSection {
  return {
    on: false,
    focus: 'A',
    vibType: 'C3',
    // Layer A boots with the registration and levels printed in the reference photo (panel parity).
    layers: { A: defaultOrganLayer(true, [8, 0, 8, 3, 0, 4, 7, 2, 4], 100), B: defaultOrganLayer(false, [8, 8, 8, 0, 0, 0, 0, 0, 0], 64) },
  }
}

/** Farf registers are switches: a drawbar pulled past half is on (organ spec models Farf). */
export const farfRegisterOn = (value: number) => value >= 4

/** Which drawbars a model uses (B3 Bass: 16' and 8' only; Vox: seven partials + the tone-mix bar 9). */
export function activeDrawbars(model: OrganModel): number[] {
  switch (model) {
    case 'b3bass':
      return [0, 2]
    case 'vox':
      return [0, 1, 2, 3, 4, 5, 6, 8]
    default:
      return [0, 1, 2, 3, 4, 5, 6, 7, 8]
  }
}

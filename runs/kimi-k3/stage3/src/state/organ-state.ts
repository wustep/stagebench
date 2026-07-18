/**
 * Canonical organ state (Phase 3, specs/nord-stage-4.organ.json).
 *
 * Two layers (A, B) sharing one effect chain ('organ'). Every field is an
 * integer on panel scale so programs round-trip exactly.
 */

export type OrganLayerId = 'A' | 'B'
export const ORGAN_LAYERS: readonly OrganLayerId[] = ['A', 'B']

export const ORGAN_MODELS = ['B3', 'B3 Bass', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2'] as const
export type OrganModelId = (typeof ORGAN_MODELS)[number]

export const VIBRATO_MODES = ['V1', 'V2', 'V3', 'C1', 'C2', 'C3'] as const

export const B3_FOOTAGES = ["16'", '5 1/3', "8'", "4'", '2 2/3', "2'", '1 3/5', '1 1/3', "1'"] as const

export interface OrganPercussion {
  on: boolean
  soft: boolean
  fast: boolean
  third: boolean
}

export interface OrganLayerState {
  enabled: boolean
  /** Level fader 0..127 (morphable). */
  level: number
  /** Octave shift −12/0/+12. */
  octave: number
  /** Index into ORGAN_MODELS. */
  model: number
  /** Nine drawbar positions 0..8 (morphable). */
  drawbars: number[]
  percussion: OrganPercussion
  /** Vibrato/chorus selector index into VIBRATO_MODES + per-layer on/off (B3). */
  vibratoMode: number
  vibratoOn: boolean
  sustainPedal: boolean
  pitchStick: boolean
}

export interface OrganState {
  sectionOn: boolean
  focusLayer: OrganLayerId
  layers: Record<OrganLayerId, OrganLayerState>
}

export function defaultOrganLayer(enabled: boolean): OrganLayerState {
  return {
    enabled,
    level: 100,
    octave: 0,
    model: 0,
    // Classic B3 888000000 registration on the enabled layer.
    drawbars: enabled ? [8, 8, 8, 0, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0, 0],
    percussion: { on: false, soft: false, fast: false, third: true },
    vibratoMode: 3, // C1
    vibratoOn: false,
    sustainPedal: true,
    pitchStick: false,
  }
}

export function defaultOrganState(): OrganState {
  return {
    sectionOn: false,
    focusLayer: 'A',
    layers: { A: defaultOrganLayer(true), B: defaultOrganLayer(false) },
  }
}

/** Rotary speeds; STOP is the effects-spec optional stop mode (implemented). */
export const ROTARY_SPEEDS = ['Slow', 'Stop', 'Fast'] as const
export type RotarySpeed = (typeof ROTARY_SPEEDS)[number]

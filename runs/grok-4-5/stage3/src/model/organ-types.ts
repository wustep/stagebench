/** Organ section types — Phase 3 */

export type OrganModel = 'B3' | 'B3 Bass' | 'Vox' | 'Farf' | 'Pipe 1' | 'Pipe 2'
export type OrganLayerId = 'A' | 'B'
export type VibratoChorusPos = 'C1' | 'C2' | 'C3' | 'V1' | 'V2' | 'V3'
export type RotarySpeed = 'Slow' | 'Fast' | 'Stop'

export const ORGAN_MODELS: OrganModel[] = ['B3', 'B3 Bass', 'Vox', 'Farf', 'Pipe 1', 'Pipe 2']
export const REQUIRED_ORGAN_MODELS: OrganModel[] = ['B3', 'Vox', 'Farf', 'Pipe 1']
export const VIBRATO_POSITIONS: VibratoChorusPos[] = ['C1', 'C2', 'C3', 'V1', 'V2', 'V3']
export const B3_FOOTAGES = ["16'", "5 1/3'", "8'", "4'", "2 2/3'", "2'", "1 3/5'", "1 1/3'", "1'"]
/** Harmonic multipliers for B3 drawbars relative to fundamental */
export const B3_HARMONICS = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8]

export interface OrganPercussion {
  on: boolean
  soft: boolean
  fast: boolean
  third: boolean
}

export interface OrganLayerState {
  enabled: boolean
  level: number
  octave: number
  sustped: boolean
  pstick: boolean
  model: OrganModel
  drawbars: number[] // 0..1 × 9
  vibratoOn: boolean
  vibratoPos: VibratoChorusPos
  /** Zone assignment: which zones this layer plays (0..3 for up to 4 zones) */
  zones: [boolean, boolean, boolean, boolean]
}

export interface OrganSectionState {
  sectionOn: boolean
  focus: OrganLayerId
  percussion: OrganPercussion
  keyClick: number
  rotarySpeed: RotarySpeed
  rotaryDrive: number
  rotaryOn: boolean
  layers: Record<OrganLayerId, OrganLayerState>
}

export function defaultDrawbars(model: OrganModel = 'B3'): number[] {
  if (model === 'Farf') return [1, 1, 1, 0, 1, 0, 0, 0, 0]
  if (model === 'Vox') return [0.9, 0.7, 0.8, 0.5, 0.4, 0.3, 0.2, 0.5, 0.3]
  if (model === 'Pipe 1' || model === 'Pipe 2') return [0.8, 0.6, 0.9, 0.7, 0.5, 0.4, 0.3, 0.2, 0.2]
  if (model === 'B3 Bass') return [1, 0, 0.9, 0, 0, 0, 0, 0, 0]
  return [0.9, 0.7, 0.8, 0.6, 0.5, 0.3, 0.2, 0.1, 0.1]
}

export function defaultOrganLayer(enabled: boolean, level: number, model: OrganModel = 'B3'): OrganLayerState {
  return {
    enabled,
    level,
    octave: 0,
    sustped: false,
    pstick: false,
    model,
    drawbars: defaultDrawbars(model),
    vibratoOn: false,
    vibratoPos: 'C1',
    zones: [true, true, true, true],
  }
}

export function defaultOrganState(): OrganSectionState {
  return {
    sectionOn: false,
    focus: 'A',
    percussion: { on: false, soft: false, fast: false, third: false },
    keyClick: 0.4,
    rotarySpeed: 'Slow',
    rotaryDrive: 0.3,
    rotaryOn: false,
    layers: {
      A: defaultOrganLayer(true, 0.8, 'B3'),
      B: defaultOrganLayer(false, 0, 'Vox'),
    },
  }
}

/** Spectral fingerprint weights per model (for distinctness tests) */
export function modelHarmonicWeights(model: OrganModel): number[] {
  switch (model) {
    case 'B3':
    case 'B3 Bass':
      return [1, 0.7, 0.9, 0.6, 0.45, 0.3, 0.22, 0.15, 0.1]
    case 'Vox':
      return [0.9, 0.5, 0.8, 0.35, 0.25, 0.15, 0.1, 0.55, 0.2]
    case 'Farf':
      return [1, 1, 1, 0, 0.9, 0, 0, 0, 0]
    case 'Pipe 1':
      return [0.85, 0.4, 1, 0.7, 0.35, 0.25, 0.15, 0.1, 0.08]
    case 'Pipe 2':
      return [0.7, 0.35, 1, 0.85, 0.5, 0.4, 0.3, 0.2, 0.15]
  }
}

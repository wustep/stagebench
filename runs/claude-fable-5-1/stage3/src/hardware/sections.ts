/** Shared control-deck geometry from specs/nord-stage-4.visual.json (v1.4.0). */
export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'

export interface SectionSpec {
  id: SectionId
  label: string
  /** Fraction of the instrument width. */
  fraction: number
  /** Surface treatment per the visual spec. */
  surface: 'exposed red chassis' | 'dark inset plate with red perimeter' | 'red and dark central control area'
}

export const SECTIONS: readonly SectionSpec[] = [
  { id: 'performance', label: 'Performance controls', fraction: 0.14, surface: 'exposed red chassis' },
  { id: 'organ', label: 'Organ', fraction: 0.2, surface: 'dark inset plate with red perimeter' },
  { id: 'piano', label: 'Piano', fraction: 0.085, surface: 'dark inset plate with red perimeter' },
  { id: 'program', label: 'Program and morph', fraction: 0.125, surface: 'red and dark central control area' },
  { id: 'synth', label: 'Synth', fraction: 0.25, surface: 'dark inset plate with red perimeter' },
  { id: 'effects', label: 'Layer effects', fraction: 0.2, surface: 'dark inset plate with red perimeter' },
]

/** Vertical allocation: control deck including the top rail / keybed including the bottom rail. */
export const DECK_FRACTION = 0.54
export const KEYBED_FRACTION = 0.46

/** Measured instrument bounds on the reference photo (specs/nord-stage-4.variants.json). */
export const INSTRUMENT_ASPECT = 9013 / 2912

/** Fraction of the instrument width taken by each wooden side cheek (measured on the photo). */
export const CHEEK_FRACTION = 0.023

export const REFERENCE_COLORS = {
  chassisMid: '#851a25',
  chassisDark: '#5a0c13',
  panelBlueGray: '#3c424d',
  keyBlack: '#0b0b0b',
  keyWhite: '#dcdcdc',
} as const

/** Desktop sizing rule: the instrument must fill 88–97% of a 1440x900 viewport without vertical scroll. */
export function instrumentWidthFor(viewportWidth: number, viewportHeight: number, reservedHeight = 150): number {
  const byWidth = viewportWidth * 0.94
  const byHeight = Math.max(0, viewportHeight - reservedHeight) * INSTRUMENT_ASPECT
  return Math.min(byWidth, byHeight)
}

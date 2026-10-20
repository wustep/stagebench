// Surface layout constants from specs/nord-stage-4.visual.json.

export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'

export interface SectionSpec {
  id: SectionId
  label: string
  /** Fraction of the instrument width, from the visual spec. */
  fraction: number
  /** Surface treatment named by the spec; drives the section's chassis styling. */
  surface: 'exposed-chassis' | 'dark-inset'
}

export const SECTIONS: readonly SectionSpec[] = [
  { id: 'performance', label: 'Performance', fraction: 0.14, surface: 'exposed-chassis' },
  { id: 'organ', label: 'Organ', fraction: 0.2, surface: 'dark-inset' },
  { id: 'piano', label: 'Piano', fraction: 0.085, surface: 'dark-inset' },
  { id: 'program', label: 'Program and morph', fraction: 0.125, surface: 'exposed-chassis' },
  { id: 'synth', label: 'Synth', fraction: 0.25, surface: 'dark-inset' },
  { id: 'effects', label: 'Layer effects', fraction: 0.2, surface: 'dark-inset' },
]

/** Share of the instrument height given to the control deck (top rail included). */
export const DECK_HEIGHT_FRACTION = 0.54

/** Share of the instrument height given to the keybed (bottom rail included). */
export const KEYBED_HEIGHT_FRACTION = 0.46

/** Measured aspect ratio of the instrument in stage-4-73.jpg (variants spec). */
export const INSTRUMENT_ASPECT_RATIO = 3.0951

/**
 * Assigned hardware variant: Nord Stage 4 73.
 * Numbers come from specs/nord-stage-4.variants.json.
 */
export const VARIANT = {
  id: 'stage-4-73',
  fullName: 'Nord Stage 4 73',
  keyAction: 'hammer action',
  aspectRatio: 3.0951,
  keyboard: {
    totalKeys: 73,
    whiteKeys: 43,
    blackKeys: 30,
    /** MIDI note numbers, inclusive: E1 (28) through E7 (100). */
    lowestMidi: 28,
    highestMidi: 100,
    blackKeyHeightFraction: 0.61,
  },
} as const

/** Vertical allocation from specs/nord-stage-4.visual.json. */
export const VERTICAL_ALLOCATION = {
  controlDeck: 0.54,
  keybed: 0.46,
  tolerance: 0.025,
} as const

export interface SectionSpec {
  id: string
  label: string
  fraction: number
}

/** Horizontal section fractions from specs/nord-stage-4.visual.json. */
export const SECTIONS: readonly SectionSpec[] = [
  { id: 'performance', label: 'Performance controls', fraction: 0.14 },
  { id: 'organ', label: 'Organ', fraction: 0.2 },
  { id: 'piano', label: 'Piano', fraction: 0.085 },
  { id: 'program', label: 'Program and morph', fraction: 0.125 },
  { id: 'synth', label: 'Synth', fraction: 0.25 },
  { id: 'effects', label: 'Layer effects', fraction: 0.2 },
] as const

export const REFERENCE_COLORS = {
  chassisMid: '#851a25',
  chassisDark: '#5a0c13',
  panelBlueGray: '#3c424d',
  keyBlack: '#0b0b0b',
  keyWhite: '#dcdcdc',
} as const

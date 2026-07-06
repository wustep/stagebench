/**
 * Measured constants for the assigned hardware variant `stage-4-73`
 * (specs/nord-stage-4.variants.json + specs/nord-stage-4.visual.json).
 */
export const VARIANT = {
  id: 'stage-4-73',
  label: 'Nord Stage 4 73',
  keyAction: 'hammer action',
  aspectRatio: 3.0951,
  keyboard: {
    totalKeys: 73,
    whiteKeys: 43,
    blackKeys: 30,
    firstMidi: 28, // E1
    lastMidi: 100, // E7
    // Photo-apparent 0.64 (user direction, 2026-07-05): slightly longer
    // than the 0.61 spec nominal, still inside the audit's 0.57–0.65 band.
    blackKeyHeightFraction: 0.64,
  },
  vertical: {
    // Within the visual spec's 0.54/0.46 ± 0.025 allocation, biased toward
    // taller keys (user direction, 2026-07-04).
    controlDeck: 0.525,
    keybed: 0.475,
  },
} as const

export interface SectionSpec {
  id: 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'
  label: string
  fraction: number
  /** Dark inset plate vs exposed red chassis. */
  insetPlate: boolean
  /** Whether this section owns a primary OLED display. */
  hasOled: boolean
}

/* Fractions are pixel-measured from reference/nord-stage-4-73.jpg (plate-
   edge and full-red column scans across the plate band, y 0.15-0.46 of the
   chassis; photo is authoritative for visible layout). Boundaries on the
   chassis: performance (red, incl. the Rotary Speaker strip at 0.111-0.136)
   runs to the organ plate at 0.136, piano 0.325, program 0.408, synth
   0.530, effects 0.768 (the section owns the red SHIFT/EXIT strip at
   0.768-0.788 left of its plate), plates end 0.955. The deck's red right
   margin (≈4.5% of the instrument, carrying the HANDMADE print) is
   .control-deck padding, so these normalize the six section extents to the
   remaining content width. */
export const SECTIONS: readonly SectionSpec[] = [
  { id: 'performance', label: 'Performance controls', fraction: 0.14, insetPlate: false, hasOled: false },
  { id: 'organ', label: 'Organ', fraction: 0.1975, insetPlate: true, hasOled: false },
  { id: 'piano', label: 'Piano', fraction: 0.0875, insetPlate: true, hasOled: false },
  { id: 'program', label: 'Program and morph', fraction: 0.1275, insetPlate: false, hasOled: true },
  { id: 'synth', label: 'Synth', fraction: 0.25, insetPlate: true, hasOled: true },
  { id: 'effects', label: 'Layer effects', fraction: 0.1975, insetPlate: true, hasOled: false },
] as const

export type SectionId = SectionSpec['id']

export const COLORS = {
  chassisMid: '#851a25',
  chassisDark: '#5a0c13',
  panelBlueGray: '#3c424d',
  keyBlack: '#0b0b0b',
  keyWhite: '#dcdcdc',
} as const

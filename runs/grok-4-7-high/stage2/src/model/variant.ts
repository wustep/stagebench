/**
 * Stage 4 73 geometry from specs/nord-stage-4.variants.json and
 * specs/nord-stage-4.visual.json (photo-corrected section fractions).
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
    range: 'E to E',
    blackKeyHeightFraction: 0.61,
  },
  vertical: {
    controlDeck: 0.54,
    keybed: 0.46,
  },
} as const

export interface SectionSpec {
  id: 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'
  label: string
  fraction: number
  insetPlate: boolean
  hasOled: boolean
}

export const SECTIONS: readonly SectionSpec[] = [
  { id: 'performance', label: 'Performance controls', fraction: 0.14, insetPlate: false, hasOled: false },
  { id: 'organ', label: 'Organ', fraction: 0.2, insetPlate: true, hasOled: false },
  { id: 'piano', label: 'Piano', fraction: 0.085, insetPlate: true, hasOled: false },
  { id: 'program', label: 'Program and morph', fraction: 0.125, insetPlate: false, hasOled: true },
  { id: 'synth', label: 'Synth', fraction: 0.25, insetPlate: true, hasOled: true },
  { id: 'effects', label: 'Layer effects', fraction: 0.2, insetPlate: true, hasOled: false },
] as const

export type SectionId = SectionSpec['id']

export const COLORS = {
  chassisMid: '#851a25',
  chassisDark: '#5a0c13',
  panelBlueGray: '#3c424d',
  keyBlack: '#0b0b0b',
  keyWhite: '#dcdcdc',
  oledInk: '#9ee7d8',
  oledBg: '#05080c',
} as const

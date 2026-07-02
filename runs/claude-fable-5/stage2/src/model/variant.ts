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
  /** Dark inset plate vs exposed red chassis. */
  insetPlate: boolean
  /** Whether this section owns a primary OLED display. */
  hasOled: boolean
}

export const SECTIONS: readonly SectionSpec[] = [
  { id: 'performance', label: 'Performance controls', fraction: 0.13, insetPlate: false, hasOled: false },
  { id: 'organ', label: 'Organ', fraction: 0.21, insetPlate: true, hasOled: false },
  { id: 'piano', label: 'Piano', fraction: 0.15, insetPlate: true, hasOled: false },
  { id: 'program', label: 'Program and morph', fraction: 0.09, insetPlate: false, hasOled: true },
  { id: 'synth', label: 'Synth', fraction: 0.21, insetPlate: true, hasOled: true },
  { id: 'effects', label: 'Layer effects', fraction: 0.21, insetPlate: true, hasOled: false },
] as const

export type SectionId = SectionSpec['id']

export const COLORS = {
  chassisMid: '#79232c',
  chassisDark: '#721f29',
  panelBlueGray: '#3c424d',
  keyBlack: '#0b0b0b',
  keyWhite: '#dcdcdc',
} as const

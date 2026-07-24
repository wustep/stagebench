/**
 * Surface geometry transcribed from `specs/nord-stage-4.visual.json` v1.2.0.
 *
 * Note on the section fractions: `prompts/stage1.md` quotes the *older* coarse values
 * (performance 13%, organ 21%, piano 15%, program 9%, synth 21%, effects 21%). The visual spec
 * carries an explicit correction dated 2026-07-04 saying those values contradict the photo, and
 * the spec is named as the source of truth for layout fidelity, so the corrected v1.2.0 values
 * below are the ones implemented. They also match my own band scan of the reference render
 * (see evidence/stage1-visual-audit.md).
 */

export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'

export type SectionSurface = 'red' | 'inset' | 'mixed'

export interface SectionLayout {
  readonly id: SectionId
  readonly label: string
  /** Share of the deck width. The six fractions sum to exactly 1. */
  readonly fraction: number
  readonly surface: SectionSurface
  /** True when the section owns one of the two primary OLED displays. */
  readonly primaryOled: boolean
}

export const SECTION_LAYOUT: readonly SectionLayout[] = [
  { id: 'performance', label: 'Performance controls', fraction: 0.14, surface: 'red', primaryOled: false },
  { id: 'organ', label: 'Organ', fraction: 0.2, surface: 'inset', primaryOled: false },
  { id: 'piano', label: 'Piano', fraction: 0.085, surface: 'inset', primaryOled: false },
  { id: 'program', label: 'Program and morph', fraction: 0.125, surface: 'mixed', primaryOled: true },
  { id: 'synth', label: 'Synth', fraction: 0.25, surface: 'inset', primaryOled: true },
  { id: 'effects', label: 'Layer effects', fraction: 0.2, surface: 'inset', primaryOled: false },
]

/** verticalAllocation from the visual spec. */
export const DECK_FRACTION = 0.54
export const KEYBED_FRACTION = 0.46
export const VERTICAL_TOLERANCE = 0.025

/** presentation block from the visual spec. */
export const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const
export const NARROW_VIEWPORT = { width: 390, height: 844 } as const
export const DESKTOP_WIDTH_FRACTION = { minimum: 0.88, maximum: 0.97 } as const

/** referenceColors from the visual spec. */
export const REFERENCE_COLORS = {
  chassisMid: '#851a25',
  chassisDark: '#5a0c13',
  panelBlueGray: '#3c424d',
  keyBlack: '#0b0b0b',
  keyWhite: '#dcdcdc',
} as const

/**
 * Cumulative left edge of each section as a fraction of the deck width.
 */
export function sectionOffsets(): ReadonlyArray<{ id: SectionId; left: number; width: number }> {
  let left = 0
  return SECTION_LAYOUT.map((section) => {
    const entry = { id: section.id, left, width: section.fraction }
    left += section.fraction
    return entry
  })
}

/**
 * Rear-panel legends printed on the top rail, left to right, as seen on the reference photo.
 */
export const TOP_RAIL_LEGENDS: readonly string[] = [
  'MONITOR IN',
  'HEADPHONES',
  'OUT 1',
  'OUT 2',
  'OUT 3',
  'OUT 4',
  'CONTROL PEDAL',
  'ORGAN SWELL',
  'SUSTAIN PEDAL',
  'TRIPLE PEDAL',
  'MIDI IN',
  'MIDI OUT',
  'ROTOR PEDAL',
  'USB',
  'FOOT SWITCH',
  'AC IN',
  'POWER ON/OFF',
]

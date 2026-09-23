// Fixed design space for the whole instrument. Everything is drawn in these
// units and the instrument is scaled as one piece, so ratios never drift.
// Aspect 1600 / 517 = 3.0948 (measured reference: 3.0951, nord-stage-4.variants.json).

export const DESIGN_WIDTH = 1600
export const DESIGN_HEIGHT = 517
export const MEASURED_ASPECT = 3.0951

/** Deck (control panel incl. top rail) vs keybed (incl. bottom rail): 54 / 46. */
export const DECK_FRACTION = 0.54
export const DECK_HEIGHT = Math.round(DESIGN_HEIGHT * DECK_FRACTION) // 279
export const KEYBED_TOP = DECK_HEIGHT
export const KEYBED_HEIGHT = DESIGN_HEIGHT - DECK_HEIGHT // 238

/** Top of the red chassis; the band above it holds rear handles and jack tops. */
export const CHASSIS_TOP = 13
/** End cheeks: narrow on the deck face, wider beside the keys (photo-measured). */
export const DECK_CHEEK_WIDTH = 27
export const KEYBED_CHEEK_WIDTH = 46
/** Key surface inside the keybed band. */
export const KEY_TOP = KEYBED_TOP + 3
export const KEY_BOTTOM = 502
export const KEY_LEFT = KEYBED_CHEEK_WIDTH
export const KEY_RIGHT = DESIGN_WIDTH - KEYBED_CHEEK_WIDTH

export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'

export interface SectionDef {
  id: SectionId
  label: string
  fraction: number
  left: number
  width: number
  /** Photo-measured x-range (design px) that is linearly mapped into this section. */
  photo: readonly [number, number]
  /** Target x-range inside the section for the mapped photo range. */
  target: readonly [number, number]
}

// Fractions from nord-stage-4.visual.json v1.4.0 (photo-measured, corrected 2026-07-04).
const SECTION_SPECS: { id: SectionId; label: string; fraction: number; photo: [number, number]; inset: [number, number] }[] = [
  { id: 'performance', label: 'Performance controls', fraction: 0.14, photo: [27, 214], inset: [27, 3] },
  { id: 'organ', label: 'Organ', fraction: 0.2, photo: [214, 521], inset: [0, 0] },
  { id: 'piano', label: 'Piano', fraction: 0.085, photo: [519, 653], inset: [0, 0] },
  { id: 'program', label: 'Program and morph', fraction: 0.125, photo: [653, 846], inset: [0, 0] },
  { id: 'synth', label: 'Synth', fraction: 0.25, photo: [845, 1226], inset: [0, 0] },
  { id: 'effects', label: 'Layer effects', fraction: 0.2, photo: [1222, 1520], inset: [0, 48] },
]

export const SECTIONS: readonly SectionDef[] = (() => {
  let left = 0
  return SECTION_SPECS.map((spec) => {
    const width = Math.round(spec.fraction * DESIGN_WIDTH)
    const def: SectionDef = {
      id: spec.id,
      label: spec.label,
      fraction: spec.fraction,
      left,
      width,
      photo: spec.photo,
      target: [left + spec.inset[0], left + width - spec.inset[1]],
    }
    left += width
    return def
  })
})()

export function sectionById(id: SectionId): SectionDef {
  const found = SECTIONS.find((s) => s.id === id)
  if (!found) throw new Error(`Unknown section ${id}`)
  return found
}

/** Linear map from photo-measured x (design px) into the section's box. */
export function photoToSectionX(section: SectionDef, photoX: number): number {
  const [a, b] = section.photo
  const [c, d] = section.target
  return c + ((photoX - a) * (d - c)) / (b - a)
}

export function sectionScale(section: SectionDef): number {
  const [a, b] = section.photo
  const [c, d] = section.target
  return (d - c) / (b - a)
}

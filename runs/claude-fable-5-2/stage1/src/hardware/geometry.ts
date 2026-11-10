import type { SectionId } from './types'

/**
 * Geometry constants. Sources:
 *  - specs/nord-stage-4.variants.json  (variant bounds, key model)
 *  - specs/nord-stage-4.visual.json    (v1.4.0: section fractions, vertical split, colours)
 *  - reference/nord-stage-4-73.jpg     (photo-measured section edges and key edges)
 */

export const VARIANT = {
  id: 'stage-4-73',
  label: 'Stage 4 73',
  fullName: 'Nord Stage 4 73',
  keyAction: 'hammer action',
  sourceCanvas: { width: 11600, height: 3866 },
  /** Instrument bounds on the reference photo, px. */
  photoBounds: { x: 1292, y: 410, width: 9013, height: 2912 },
  aspectRatio: 3.0951,
  keyboard: {
    totalKeys: 73,
    whiteKeys: 43,
    blackKeys: 30,
    lowNote: 28, // E1
    highNote: 100, // E7
    range: 'E to E',
    blackKeyHeightFraction: 0.61,
  },
} as const

/** The instrument is drawn in "design px": 1 design px = 1 px of the reference photo. */
export const DESIGN = {
  width: VARIANT.photoBounds.width,
  height: VARIANT.photoBounds.height,
} as const

export const VERTICAL = {
  deckFraction: 0.54,
  keybedFraction: 0.46,
  tolerance: 0.025,
} as const

export const DECK_HEIGHT = DESIGN.height * VERTICAL.deckFraction
export const KEYBED_HEIGHT = DESIGN.height * VERTICAL.keybedFraction

export const PRESENTATION = {
  desktop: { width: 1440, height: 900 },
  narrow: { width: 390, height: 844 },
  /** Fraction of viewport width the instrument takes when fitted. Spec window: 0.88–0.97. */
  fitWidthFraction: 0.94,
  minWidthFraction: 0.88,
  maxWidthFraction: 0.97,
} as const

export const REFERENCE_COLORS = {
  chassisMid: '#851a25',
  chassisDark: '#5a0c13',
  panelBlueGray: '#3c424d',
  keyBlack: '#0b0b0b',
  keyWhite: '#dcdcdc',
} as const

export interface SectionGeometry {
  id: SectionId
  label: string
  /** Spec width as a fraction of instrument width. */
  fraction: number
  /** Photo x range (absolute px) that this section's hardware occupies. */
  photoX0: number
  photoX1: number
  /** Design-space left edge and width. */
  x: number
  width: number
  /** Horizontal scale applied to photo offsets inside this section. */
  scale: number
}

const SECTION_SOURCE: ReadonlyArray<Pick<SectionGeometry, 'id' | 'label' | 'fraction' | 'photoX0' | 'photoX1'>> = [
  { id: 'performance', label: 'Performance controls', fraction: 0.14, photoX0: 1292, photoX1: 2520 },
  { id: 'organ', label: 'Organ', fraction: 0.2, photoX0: 2520, photoX1: 4216 },
  { id: 'piano', label: 'Piano', fraction: 0.085, photoX0: 4216, photoX1: 4958 },
  { id: 'program', label: 'Program and morph', fraction: 0.125, photoX0: 4958, photoX1: 6065 },
  { id: 'synth', label: 'Synth', fraction: 0.25, photoX0: 6065, photoX1: 8222 },
  // The photo has ~270 px of bare chassis right of the effects plate; part of it is
  // absorbed here so the section still ends at the right cheek.
  { id: 'effects', label: 'Layer effects', fraction: 0.2, photoX0: 8222, photoX1: 10100 },
]

export const SECTIONS: readonly SectionGeometry[] = (() => {
  let cursor = 0
  return SECTION_SOURCE.map((source) => {
    const width = source.fraction * DESIGN.width
    const geometry: SectionGeometry = {
      ...source,
      x: cursor,
      width,
      scale: width / (source.photoX1 - source.photoX0),
    }
    cursor += width
    return geometry
  })
})()

export const SECTION_ORDER: readonly SectionId[] = SECTIONS.map((section) => section.id)

export function sectionGeometry(id: SectionId): SectionGeometry {
  const found = SECTIONS.find((section) => section.id === id)
  if (!found) throw new Error(`Unknown section ${id}`)
  return found
}

/** Photo px → design px inside a section. */
export function toSectionX(id: SectionId, photoX: number): number {
  const section = sectionGeometry(id)
  return (photoX - section.photoX0) * section.scale
}

export function toSectionY(photoY: number): number {
  return photoY - VARIANT.photoBounds.y
}

/** Keybed edges, design px from the instrument's left edge (photo: first key at x=1565, last ends at 10043). */
export const KEYBED = {
  left: 273,
  right: 8751,
  /** White key length. The rest of the keybed band is the front rail. */
  whiteKeyLength: 1264,
  blackKeyWidthFraction: 0.645,
} as const

/** End cheeks, design px. */
export const CHEEK_WIDTH = 150

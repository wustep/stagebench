import type { SectionId, SectionSpec } from './types'

/**
 * Coordinates are measured on the reference photograph (11600x3866). The measured instrument
 * bounds are x 1292, y 410, 9013x2912. One instrument unit `u` = 1/1000 of the instrument width.
 */
export const SOURCE = { x: 1292, y: 410, width: 9013, height: 2912 } as const
export const ASPECT_RATIO = SOURCE.width / SOURCE.height
/** height of the instrument in units */
export const HEIGHT_U = 1000 / ASPECT_RATIO
export const DECK_FRACTION = 0.54
export const DECK_HEIGHT_U = HEIGHT_U * DECK_FRACTION
export const KEYBED_HEIGHT_U = HEIGHT_U - DECK_HEIGHT_U

/** A point in native photo pixels. */
export type Pt = readonly [number, number]

/** crop helper: crops were taken at (ox, oy) of the photo and displayed at 1/scale. */
const crop =
  (ox: number, oy: number, scale: number) =>
  (dx: number, dy: number): Pt => [ox + scale * dx, oy + scale * dy]

export const A1 = crop(1250, 380, 1.5)
export const B1 = crop(1250, 1250, 1.5)
export const A2 = crop(4200, 380, 1.5)
export const B2 = crop(4200, 1250, 1.5)
export const A3 = crop(7300, 380, 1.5)
export const B3 = crop(7300, 1250, 1.5)
export const SA = crop(6950, 380, 1)
export const SB = crop(6950, 1180, 1)
export const SC = crop(7050, 1180, 1)

const unit = SOURCE.width / 1000
export const toU = ([nx, ny]: Pt): [number, number] => [(nx - SOURCE.x) / unit, (ny - SOURCE.y) / unit]

/** Photo-measured fractions (visual.json horizontalSections). */
const RAW: Array<{ id: SectionId; label: string; fraction: number; photo: [number, number] }> = [
  { id: 'performance', label: 'Performance controls', fraction: 0.14, photo: [0, 135.5] },
  { id: 'organ', label: 'Organ', fraction: 0.2, photo: [135.5, 323.5] },
  { id: 'piano', label: 'Piano', fraction: 0.085, photo: [325.6, 405.5] },
  { id: 'program', label: 'Program and morph', fraction: 0.125, photo: [405.8, 528.9] },
  { id: 'synth', label: 'Synth', fraction: 0.25, photo: [529.8, 767.8] },
  { id: 'effects', label: 'Layer effects', fraction: 0.2, photo: [770.1, 985] },
]

export const SECTIONS: SectionSpec[] = (() => {
  let left = 0
  return RAW.map((s) => {
    const spec: SectionSpec = { ...s, left, width: s.fraction * 1000 }
    left += spec.width
    return spec
  })
})()

export const sectionById = (id: SectionId): SectionSpec => {
  const s = SECTIONS.find((x) => x.id === id)
  if (!s) throw new Error(`unknown section ${id}`)
  return s
}

/** Map a photo x (instrument units) into section-local units. */
export const fitX = (id: SectionId, photoU: number): number => {
  const s = sectionById(id)
  const [p0, p1] = s.photo
  const abs = s.left + ((photoU - p0) / (p1 - p0)) * s.width
  return abs - s.left
}

/** Convert a photo pixel to section-local instrument units. */
export const local = (id: SectionId, pt: Pt): { x: number; y: number } => {
  const [ux, uy] = toU(pt)
  return { x: round(fitX(id, ux)), y: round(uy) }
}

export const round = (n: number): number => Math.round(n * 100) / 100

// --- keybed geometry -------------------------------------------------------------------------
/** keys span 0.0297..0.9713 of the instrument width in the photo */
export const KEYS_LEFT_U = 29.7
export const KEYS_RIGHT_U = 971.3
export const KEYS_WIDTH_U = KEYS_RIGHT_U - KEYS_LEFT_U

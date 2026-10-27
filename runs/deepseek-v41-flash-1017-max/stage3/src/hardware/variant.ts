/**
 * The single assigned hardware variant (specs/nord-stage-4.variants.json).
 * Everything variant-specific — keybed, silhouette, materials — is derived from here.
 */
export interface Variant {
  id: string
  label: string
  fullName: string
  keyAction: string
  totalKeys: number
  whiteKeys: number
  blackKeys: number
  lowestMidi: number
  highestMidi: number
  rangeLabel: string
  blackKeyHeightFraction: number
  aspectRatio: number
  sourceCanvas: { width: number; height: number }
  measuredInstrumentBounds: { x: number; y: number; width: number; height: number }
}

export const VARIANT: Variant = {
  id: 'stage-4-73',
  label: 'Stage 4 73',
  fullName: 'Nord Stage 4 73',
  keyAction: 'hammer action',
  totalKeys: 73,
  whiteKeys: 43,
  blackKeys: 30,
  lowestMidi: 28,
  highestMidi: 100,
  rangeLabel: 'E to E',
  blackKeyHeightFraction: 0.61,
  aspectRatio: 3.0951,
  sourceCanvas: { width: 11600, height: 3866 },
  measuredInstrumentBounds: { x: 1292, y: 410, width: 9013, height: 2912 },
}

/** Printed on the chassis next to the wordmark, taken from the reference photograph. */
export const KEY_ACTION_LEGEND = `HAMMER ACTION ${VARIANT.totalKeys}`

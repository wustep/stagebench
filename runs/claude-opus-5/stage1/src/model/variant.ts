/**
 * Hardware variant data, transcribed from `specs/nord-stage-4.variants.json`
 * (entry `stage-4-73`) and cross-checked against `reference/nord-stage-4-73.jpg`.
 */

export interface VariantSpec {
  readonly id: string
  readonly label: string
  readonly fullName: string
  readonly keyAction: string
  /** Instrument chassis aspect ratio (width / height), measured on the reference photo. */
  readonly aspectRatio: number
  readonly totalKeys: number
  readonly whiteKeys: number
  readonly blackKeys: number
  /** Human readable range, e.g. "E to E". */
  readonly range: string
  readonly lowestMidi: number
  readonly highestMidi: number
  /** Black key length as a fraction of the white key length. */
  readonly blackKeyHeightFraction: number
}

/**
 * MIDI 28 is E1 with middle C = C4 = 60, which is the numbering Nord uses.
 * 28 + 72 = 100 = E7, giving exactly 73 keys inclusive.
 */
export const VARIANT: VariantSpec = {
  id: 'stage-4-73',
  label: 'Stage 4 73',
  fullName: 'Nord Stage 4 73',
  keyAction: 'hammer action',
  aspectRatio: 3.0951,
  totalKeys: 73,
  whiteKeys: 43,
  blackKeys: 30,
  range: 'E to E',
  lowestMidi: 28,
  highestMidi: 100,
  blackKeyHeightFraction: 0.61,
}

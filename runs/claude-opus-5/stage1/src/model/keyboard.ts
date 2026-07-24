import { VARIANT, type VariantSpec } from './variant'

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/** Pitch classes that are black keys, expressed as semitone offsets inside an octave. */
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

export type KeyColor = 'white' | 'black'

export interface PianoKey {
  /** Stable DOM/id handle, e.g. `key-28`. */
  readonly id: string
  readonly midi: number
  /** Scientific pitch name with middle C = C4, e.g. `E1`, `A#3`. */
  readonly name: string
  readonly pitchClass: (typeof NOTE_NAMES)[number]
  readonly octave: number
  readonly color: KeyColor
  /** Index among the white keys; black keys report the white key immediately to their left. */
  readonly whiteIndex: number
  /** Left edge as a fraction of the full keybed width. */
  readonly x: number
  /** Width as a fraction of the full keybed width. */
  readonly width: number
  /** Height as a fraction of the full white key length. */
  readonly height: number
}

/**
 * Black key width relative to a white key, measured on the reference photo:
 * white pitch 196.8px, black width 128px at the 11600px source scale.
 */
export const BLACK_KEY_WIDTH_RATIO = 0.65

export function midiToName(midi: number): string {
  const pitchClass = NOTE_NAMES[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${pitchClass}${octave}`
}

export function isBlackMidi(midi: number): boolean {
  return BLACK_PITCH_CLASSES.has(((midi % 12) + 12) % 12)
}

/**
 * Frequency in Hz for equal temperament with A4 = 440Hz.
 */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * Builds the keybed geometry for a variant. White keys tile the full width; black keys are
 * centred on the boundary between the white key they follow and the next one, which is what
 * the reference render shows (measured centres sit on the white-key boundaries within ±6px
 * at the 11600px source scale).
 */
export function buildKeybed(variant: VariantSpec = VARIANT): readonly PianoKey[] {
  const keys: PianoKey[] = []
  let whiteIndex = -1

  const whiteCount = countWhiteKeys(variant.lowestMidi, variant.highestMidi)
  const whiteWidth = 1 / whiteCount
  const blackWidth = whiteWidth * BLACK_KEY_WIDTH_RATIO

  for (let midi = variant.lowestMidi; midi <= variant.highestMidi; midi += 1) {
    const black = isBlackMidi(midi)
    if (!black) whiteIndex += 1
    const pitchClass = NOTE_NAMES[((midi % 12) + 12) % 12]
    const octave = Math.floor(midi / 12) - 1
    keys.push({
      id: `key-${midi}`,
      midi,
      name: `${pitchClass}${octave}`,
      pitchClass,
      octave,
      color: black ? 'black' : 'white',
      whiteIndex,
      x: black ? (whiteIndex + 1) * whiteWidth - blackWidth / 2 : whiteIndex * whiteWidth,
      width: black ? blackWidth : whiteWidth,
      height: black ? variant.blackKeyHeightFraction : 1,
    })
  }

  return keys
}

export function countWhiteKeys(lowestMidi: number, highestMidi: number): number {
  let count = 0
  for (let midi = lowestMidi; midi <= highestMidi; midi += 1) {
    if (!isBlackMidi(midi)) count += 1
  }
  return count
}

export const KEYBED: readonly PianoKey[] = buildKeybed()

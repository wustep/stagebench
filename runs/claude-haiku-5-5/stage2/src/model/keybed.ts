// Keybed model for the assigned variant (stage-4-73, see specs/nord-stage-4.variants.json).
// Keys run E to E: MIDI 28 (E1) through MIDI 100 (E7), 73 keys, 43 white and 30 black.

export const KEYBED = {
  variantId: 'stage-4-73',
  totalKeys: 73,
  whiteKeys: 43,
  blackKeys: 30,
  lowestNote: 28,
  highestNote: 100,
  blackKeyHeightFraction: 0.61,
} as const

export type KeyColor = 'white' | 'black'

export interface KeyModel {
  note: number
  color: KeyColor
  /** Index among white keys, counted from the lowest key (black keys sit on the boundary after this index). */
  whiteIndex: number
  /** Left edge as a fraction of the keybed width. */
  left: number
  /** Width as a fraction of the keybed width. */
  width: number
  label: string
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

export function isBlackNote(note: number): boolean {
  return BLACK_PITCH_CLASSES.has(((note % 12) + 12) % 12)
}

export function noteName(note: number): string {
  const octave = Math.floor(note / 12) - 1
  return `${NOTE_NAMES[((note % 12) + 12) % 12]}${octave}`
}

export function isKeyboardNote(note: number): boolean {
  return Number.isInteger(note) && note >= KEYBED.lowestNote && note <= KEYBED.highestNote
}

export function buildKeys(): KeyModel[] {
  const whiteWidth = 1 / KEYBED.whiteKeys
  const blackWidth = whiteWidth * 0.6
  const keys: KeyModel[] = []
  let whiteIndex = 0
  for (let note = KEYBED.lowestNote; note <= KEYBED.highestNote; note += 1) {
    const label = noteName(note)
    if (isBlackNote(note)) {
      // A black key is centred on the boundary between the white keys either side of it.
      const boundary = whiteIndex / KEYBED.whiteKeys
      keys.push({ note, color: 'black', whiteIndex: whiteIndex - 1, left: boundary - blackWidth / 2, width: blackWidth, label })
    } else {
      keys.push({ note, color: 'white', whiteIndex, left: whiteIndex * whiteWidth, width: whiteWidth, label })
      whiteIndex += 1
    }
  }
  return keys
}

export const KEYS: readonly KeyModel[] = buildKeys()

export function keyCounts(keys: readonly KeyModel[] = KEYS): { total: number; white: number; black: number } {
  let white = 0
  let black = 0
  for (const key of keys) {
    if (key.color === 'white') white += 1
    else black += 1
  }
  return { total: keys.length, white, black }
}

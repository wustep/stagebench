import { KEYBED, VARIANT } from './geometry'

export type KeyColor = 'white' | 'black'

export interface KeyDef {
  /** Stable DOM id, e.g. `key-60`. */
  id: string
  /** MIDI note number. */
  note: number
  /** Scientific pitch name, e.g. `C4`, `F#1`. */
  name: string
  /** Spoken name for assistive tech, e.g. `F sharp 1`. */
  spokenName: string
  pitchClass: number
  octave: number
  color: KeyColor
  /** Chromatic index from the lowest key (0-based). */
  index: number
  /** Left edge, design px from the instrument's left edge. */
  x: number
  width: number
  /** Key length, design px from the top of the keybed. */
  length: number
}

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const BLACK_PITCH_CLASSES: ReadonlySet<number> = new Set([1, 3, 6, 8, 10])

export function isBlackNote(note: number): boolean {
  return BLACK_PITCH_CLASSES.has(((note % 12) + 12) % 12)
}

export function noteName(note: number): string {
  const pitchClass = ((note % 12) + 12) % 12
  return `${PITCH_NAMES[pitchClass]}${Math.floor(note / 12) - 1}`
}

export function spokenNoteName(note: number): string {
  return noteName(note).replace('#', ' sharp ')
}

export function noteFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12)
}

export interface KeybedModel {
  keys: readonly KeyDef[]
  whiteKeyWidth: number
  blackKeyWidth: number
  whiteKeyLength: number
  blackKeyLength: number
  lowNote: number
  highNote: number
}

/** Builds the exact keybed for a note range. Black keys sit centred on the white-key joint, as on the photo. */
export function buildKeybed(
  lowNote: number = VARIANT.keyboard.lowNote,
  highNote: number = VARIANT.keyboard.highNote,
): KeybedModel {
  if (isBlackNote(lowNote) || isBlackNote(highNote)) {
    throw new Error('A keybed must start and end on a white key')
  }
  let whiteCount = 0
  for (let note = lowNote; note <= highNote; note += 1) {
    if (!isBlackNote(note)) whiteCount += 1
  }
  const whiteKeyWidth = (KEYBED.right - KEYBED.left) / whiteCount
  const blackKeyWidth = whiteKeyWidth * KEYBED.blackKeyWidthFraction
  const whiteKeyLength = KEYBED.whiteKeyLength
  const blackKeyLength = whiteKeyLength * VARIANT.keyboard.blackKeyHeightFraction

  const keys: KeyDef[] = []
  let whiteIndex = 0
  for (let note = lowNote; note <= highNote; note += 1) {
    const black = isBlackNote(note)
    const pitchClass = note % 12
    const base = {
      id: `key-${note}`,
      note,
      name: noteName(note),
      spokenName: spokenNoteName(note),
      pitchClass,
      octave: Math.floor(note / 12) - 1,
      index: note - lowNote,
    }
    if (black) {
      // A black key straddles the joint between the previous white key and the next one.
      const joint = KEYBED.left + whiteIndex * whiteKeyWidth
      keys.push({ ...base, color: 'black', x: joint - blackKeyWidth / 2, width: blackKeyWidth, length: blackKeyLength })
    } else {
      keys.push({
        ...base,
        color: 'white',
        x: KEYBED.left + whiteIndex * whiteKeyWidth,
        width: whiteKeyWidth,
        length: whiteKeyLength,
      })
      whiteIndex += 1
    }
  }
  return { keys, whiteKeyWidth, blackKeyWidth, whiteKeyLength, blackKeyLength, lowNote, highNote }
}

export const KEYBED_MODEL: KeybedModel = buildKeybed()

/** White-key joints that carry a split-point LED on the deck's front lip (C and F joints, photo-measured). */
export const SPLIT_LED_NOTES: readonly number[] = [36, 41, 48, 53, 60, 65, 72, 77, 84, 89, 96]

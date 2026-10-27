import { VARIANT, type Variant } from './variant'

export type KeyColor = 'white' | 'black'

export interface KeySpec {
  /** Stable ID, e.g. `key.e1` / `key.c#4`. */
  id: string
  /** Zero-based index in the physical left-to-right keybed order. */
  index: number
  midi: number
  name: string
  octave: number
  color: KeyColor
  isC: boolean
  /** Index among white keys, or the number of white keys to its left (black keys). */
  whiteIndex: number
  /** Left edge as a fraction of the keybed width. */
  left: number
  /** Width as a fraction of the keybed width. */
  width: number
  /** Height as a fraction of the white-key length. */
  height: number
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

/** Black key width as a fraction of one white key, measured from the photograph. */
export const BLACK_KEY_WIDTH_RATIO = 0.62

export function midiToName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[pc]}${octave}`
}

export function isBlackMidi(midi: number): boolean {
  return BLACK_PITCH_CLASSES.has(((midi % 12) + 12) % 12)
}

export function keyIdFor(midi: number): string {
  return `key.${midiToName(midi).toLowerCase()}`
}

/**
 * Builds the exact keybed for the assigned variant.
 *
 * The variant fixes 73 keys spanning E to E (MIDI 28..100). The pattern is *derived*
 * from that MIDI range rather than hand-listed, so the white/black counts, the seam
 * positions and the black-key offsets cannot drift from the declared geometry.
 * `assertKeybed` re-derives the counts and throws if they stop matching the variant.
 */
export function buildKeybed(variant: Variant = VARIANT): KeySpec[] {
  const { lowestMidi, highestMidi, blackKeyHeightFraction } = variant
  const midis: number[] = []
  for (let m = lowestMidi; m <= highestMidi; m += 1) midis.push(m)

  const whiteCount = midis.filter((m) => !isBlackMidi(m)).length
  const whiteWidth = 1 / whiteCount
  const blackWidth = whiteWidth * BLACK_KEY_WIDTH_RATIO
  const keys: KeySpec[] = []
  let whiteIndex = 0

  midis.forEach((midi, index) => {
    const color: KeyColor = isBlackMidi(midi) ? 'black' : 'white'
    const name = midiToName(midi)
    if (color === 'white') {
      keys.push({
        id: keyIdFor(midi),
        index,
        midi,
        name,
        octave: Math.floor(midi / 12) - 1,
        color,
        isC: ((midi % 12) + 12) % 12 === 0,
        whiteIndex,
        left: whiteIndex * whiteWidth,
        width: whiteWidth,
        height: 1,
      })
      whiteIndex += 1
    } else {
      // A black key straddles the seam between its two neighbouring white keys, so its
      // left edge sits half a black-key width before that seam.
      keys.push({
        id: keyIdFor(midi),
        index,
        midi,
        name,
        octave: Math.floor(midi / 12) - 1,
        color,
        isC: false,
        whiteIndex,
        left: whiteIndex * whiteWidth - blackWidth / 2,
        width: blackWidth,
        height: blackKeyHeightFraction,
      })
    }
  })

  assertKeybed(keys, variant)
  return keys
}

export function assertKeybed(keys: KeySpec[], variant: Variant = VARIANT): void {
  const white = keys.filter((k) => k.color === 'white')
  const black = keys.filter((k) => k.color === 'black')
  if (keys.length !== variant.totalKeys) {
    throw new Error(`keybed has ${keys.length} keys, variant declares ${variant.totalKeys}`)
  }
  if (white.length !== variant.whiteKeys) {
    throw new Error(`keybed has ${white.length} white keys, variant declares ${variant.whiteKeys}`)
  }
  if (black.length !== variant.blackKeys) {
    throw new Error(`keybed has ${black.length} black keys, variant declares ${variant.blackKeys}`)
  }
  if (keys[0].midi !== variant.lowestMidi || keys[keys.length - 1].midi !== variant.highestMidi) {
    throw new Error('keybed range does not match the variant')
  }
  const ordered = keys.every((k, i) => i === 0 || k.midi === keys[i - 1].midi + 1)
  if (!ordered) throw new Error('keybed is not a contiguous chromatic run')
}

/** "E to E", matching the variant's declared range. */
export function keybedRangeLabel(variant: Variant = VARIANT): string {
  const first = midiToName(variant.lowestMidi).replace(/\d+$/, '')
  const last = midiToName(variant.highestMidi).replace(/\d+$/, '')
  return `${first} to ${last}`
}

/** C keys, used to print the octave markers under the keybed. */
export function cKeys(keys: KeySpec[]): KeySpec[] {
  return keys.filter((k) => k.isC)
}

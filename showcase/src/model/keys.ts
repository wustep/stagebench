import { VARIANT } from './variant'

export interface KeyDef {
  /** Stable control id, e.g. `key-60`. */
  id: string
  midi: number
  /** Note name with octave, e.g. "C4". */
  name: string
  isBlack: boolean
  /** Index among white keys (0-based); for black keys, the white key to the left. */
  whiteIndex: number
  /**
   * Horizontal placement in white-key widths from the keybed's left edge.
   * White keys: left edge = whiteIndex. Black keys: left edge of the black cap.
   */
  x: number
  /** Width in white-key widths (1 for white keys, <1 for black keys). */
  w: number
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

export const BLACK_KEY_WIDTH = 0.57
/** Black keys sit CENTERED on the boundary between their two white
 *  neighbours (product-photo geometry; the acoustic-piano per-pitch-class
 *  offsets read visibly skewed at this render scale). */
const BLACK_OFFSETS: Record<number, number> = {
  1: 0, // C#
  3: 0, // D#
  6: 0, // F#
  8: 0, // G#
  10: 0, // A#
}

export function midiToName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[pc]}${octave}`
}

export function buildKeys(): KeyDef[] {
  const keys: KeyDef[] = []
  let whiteIndex = -1
  for (let midi = VARIANT.keyboard.firstMidi; midi <= VARIANT.keyboard.lastMidi; midi++) {
    const pc = ((midi % 12) + 12) % 12
    const isBlack = BLACK_PITCH_CLASSES.has(pc)
    if (!isBlack) whiteIndex += 1
    const name = midiToName(midi)
    if (isBlack) {
      const boundary = whiteIndex + 1
      const center = boundary + (BLACK_OFFSETS[pc] ?? 0)
      keys.push({ id: `key-${midi}`, midi, name, isBlack, whiteIndex, x: center - BLACK_KEY_WIDTH / 2, w: BLACK_KEY_WIDTH })
    } else {
      keys.push({ id: `key-${midi}`, midi, name, isBlack, whiteIndex, x: whiteIndex, w: 1 })
    }
  }
  return keys
}

export const KEYS: readonly KeyDef[] = buildKeys()
export const WHITE_KEY_COUNT = KEYS.filter((k) => !k.isBlack).length

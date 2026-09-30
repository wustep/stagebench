import { KEYS_LEFT_U, KEYS_WIDTH_U, round } from './geometry'

/** Stage 4 73: hammer action, E to E = MIDI 28 (E1) .. 100 (E7). */
export const LOW_NOTE = 28
export const HIGH_NOTE = 100
export const KEY_COUNT = HIGH_NOTE - LOW_NOTE + 1
export const BLACK_KEY_HEIGHT_FRACTION = 0.61

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const BLACK_PCS = new Set([1, 3, 6, 8, 10])
/** black key centre offset from the boundary between its neighbouring white keys, in white-key widths */
const BLACK_OFFSET: Record<number, number> = { 1: -0.09, 3: 0.09, 6: -0.11, 8: 0, 10: 0.11 }
const BLACK_WIDTH = 0.56

export interface KeySpec {
  note: number
  name: string
  isBlack: boolean
  /** index among all keys, 0-based */
  index: number
  /** left edge and width in instrument units, relative to the instrument's left edge */
  x: number
  w: number
}

export const noteName = (note: number): string => `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`
export const isBlackNote = (note: number): boolean => BLACK_PCS.has(note % 12)

const whiteCount = (() => {
  let n = 0
  for (let note = LOW_NOTE; note <= HIGH_NOTE; note++) if (!isBlackNote(note)) n++
  return n
})()

export const WHITE_KEY_WIDTH = KEYS_WIDTH_U / whiteCount

export const KEYS: KeySpec[] = (() => {
  const keys: KeySpec[] = []
  let white = 0
  for (let note = LOW_NOTE; note <= HIGH_NOTE; note++) {
    const black = isBlackNote(note)
    if (!black) {
      keys.push({ note, name: noteName(note), isBlack: false, index: keys.length, x: round(KEYS_LEFT_U + white * WHITE_KEY_WIDTH), w: round(WHITE_KEY_WIDTH) })
      white++
    } else {
      const boundary = KEYS_LEFT_U + white * WHITE_KEY_WIDTH
      const w = BLACK_WIDTH * WHITE_KEY_WIDTH
      const centre = boundary + BLACK_OFFSET[note % 12] * WHITE_KEY_WIDTH
      keys.push({ note, name: noteName(note), isBlack: true, index: keys.length, x: round(centre - w / 2), w: round(w) })
    }
  }
  return keys
})()

export const WHITE_KEYS = KEYS.filter((k) => !k.isBlack)
export const BLACK_KEYS = KEYS.filter((k) => k.isBlack)
export const KEY_BY_NOTE: ReadonlyMap<number, KeySpec> = new Map(KEYS.map((k) => [k.note, k]))

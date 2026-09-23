import { KEY_BOTTOM, KEY_LEFT, KEY_RIGHT, KEY_TOP } from './geometry'

// Stage 4 73: 73 keys, E to E (MIDI 28 = E1 … MIDI 100 = E7), 43 white + 30 black.
export const VARIANT_ID = 'stage-4-73'
export const LOWEST_NOTE = 28
export const HIGHEST_NOTE = 100
export const KEY_COUNT = HIGHEST_NOTE - LOWEST_NOTE + 1
export const BLACK_KEY_HEIGHT_FRACTION = 0.61
export const BLACK_KEY_WIDTH_FRACTION = 0.58

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const
const ASCII_NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'] as const
const BLACK_PCS = new Set([1, 3, 6, 8, 10])
// Black key offset from the boundary between neighbouring whites, in white-key widths.
const BLACK_OFFSET: Record<number, number> = { 1: -0.09, 3: 0.09, 6: -0.1, 8: 0, 10: 0.1 }

export interface KeyDef {
  id: string
  midi: number
  name: string
  isBlack: boolean
  /** Index among white keys (for white keys), or of the white key to the left (black keys). */
  whiteIndex: number
  x: number
  y: number
  w: number
  h: number
}

export function isBlackNote(midi: number): boolean {
  return BLACK_PCS.has(((midi % 12) + 12) % 12)
}

export function noteName(midi: number): string {
  return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}

export function keyId(midi: number): string {
  return `key-${ASCII_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}

export const WHITE_KEY_COUNT = (() => {
  let n = 0
  for (let m = LOWEST_NOTE; m <= HIGHEST_NOTE; m++) if (!isBlackNote(m)) n++
  return n
})()

export const WHITE_KEY_WIDTH = (KEY_RIGHT - KEY_LEFT) / WHITE_KEY_COUNT
export const KEY_LENGTH = KEY_BOTTOM - KEY_TOP

export const KEYS: readonly KeyDef[] = (() => {
  const keys: KeyDef[] = []
  let white = -1
  for (let midi = LOWEST_NOTE; midi <= HIGHEST_NOTE; midi++) {
    const black = isBlackNote(midi)
    if (!black) {
      white++
      keys.push({
        id: keyId(midi),
        midi,
        name: noteName(midi),
        isBlack: false,
        whiteIndex: white,
        x: KEY_LEFT + white * WHITE_KEY_WIDTH,
        y: KEY_TOP,
        w: WHITE_KEY_WIDTH,
        h: KEY_LENGTH,
      })
    } else {
      const w = WHITE_KEY_WIDTH * BLACK_KEY_WIDTH_FRACTION
      const boundary = KEY_LEFT + (white + 1) * WHITE_KEY_WIDTH
      const centre = boundary + BLACK_OFFSET[midi % 12] * WHITE_KEY_WIDTH
      keys.push({
        id: keyId(midi),
        midi,
        name: noteName(midi),
        isBlack: true,
        whiteIndex: white,
        x: centre - w / 2,
        y: KEY_TOP,
        w,
        h: KEY_LENGTH * BLACK_KEY_HEIGHT_FRACTION,
      })
    }
  }
  return keys
})()

/** Hit-test in design coordinates; black keys sit on top of white keys. */
export function keyAt(x: number, y: number): KeyDef | null {
  for (const key of KEYS) {
    if (key.isBlack && x >= key.x && x < key.x + key.w && y >= key.y && y < key.y + key.h) return key
  }
  for (const key of KEYS) {
    if (!key.isBlack && x >= key.x && x < key.x + key.w && y >= key.y && y < key.y + key.h) return key
  }
  return null
}

/**
 * Pointer velocity: where the key is struck along its length. Near the fallboard is soft,
 * the front edge is loud. Pen pressure (when the device reports it) takes precedence.
 */
export function velocityFromPosition(fractionAlongKey: number, pressure?: number): number {
  if (pressure !== undefined && pressure > 0 && pressure !== 0.5) {
    return clampVelocity(Math.round(20 + pressure * 107))
  }
  const f = Math.min(1, Math.max(0, fractionAlongKey))
  return clampVelocity(Math.round(28 + f * 99))
}

export function clampVelocity(v: number): number {
  return Math.min(127, Math.max(1, Math.round(v)))
}

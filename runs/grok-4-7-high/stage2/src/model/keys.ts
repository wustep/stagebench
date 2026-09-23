import { VARIANT } from './variant'

export interface KeyDef {
  id: string
  midi: number
  name: string
  isBlack: boolean
  whiteIndex: number
  /** Left edge in white-key widths. */
  x: number
  /** Width in white-key widths. */
  w: number
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

export const BLACK_KEY_WIDTH = 0.58

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
      const center = whiteIndex + 1
      keys.push({
        id: `key-${midi}`,
        midi,
        name,
        isBlack,
        whiteIndex,
        x: center - BLACK_KEY_WIDTH / 2,
        w: BLACK_KEY_WIDTH,
      })
    } else {
      keys.push({ id: `key-${midi}`, midi, name, isBlack, whiteIndex, x: whiteIndex, w: 1 })
    }
  }
  return keys
}

export const KEYS: readonly KeyDef[] = buildKeys()
export const WHITE_KEY_COUNT = KEYS.filter((key) => !key.isBlack).length

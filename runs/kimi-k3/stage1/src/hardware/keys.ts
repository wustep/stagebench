import { VARIANT } from './variant'

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export interface KeyDef {
  /** Stable key ID, e.g. `key.e1`. */
  id: string
  midi: number
  /** Human name, e.g. `E1`. */
  name: string
  color: 'white' | 'black'
  /** For white keys: index among white keys (0..42). For black keys: index of the white key it sits after. */
  whiteIndex: number
}

export function midiName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1
  return `${NAMES[midi % 12]}${octave}`
}

function buildKeys(): KeyDef[] {
  const keys: KeyDef[] = []
  let whiteIndex = 0
  for (let midi = VARIANT.keyboard.lowestMidi; midi <= VARIANT.keyboard.highestMidi; midi++) {
    const name = midiName(midi)
    const color = name.includes('#') ? 'black' : 'white'
    if (color === 'white') {
      keys.push({ id: `key.${name.toLowerCase()}`, midi, name, color, whiteIndex })
      whiteIndex++
    } else {
      keys.push({ id: `key.${name.toLowerCase().replace('#', 's')}`, midi, name, color, whiteIndex: whiteIndex - 1 })
    }
  }
  return keys
}

/** All 73 keys in ascending pitch order (E1..E7). */
export const KEYS: readonly KeyDef[] = buildKeys()

export const KEY_BY_MIDI: ReadonlyMap<number, KeyDef> = new Map(KEYS.map((k) => [k.midi, k]))

export const WHITE_KEY_COUNT = KEYS.filter((k) => k.color === 'white').length
export const BLACK_KEY_COUNT = KEYS.filter((k) => k.color === 'black').length

/** Clamp any incoming MIDI note to the playable keybed range. */
export function inRange(midi: number): boolean {
  return midi >= VARIANT.keyboard.lowestMidi && midi <= VARIANT.keyboard.highestMidi
}

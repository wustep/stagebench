/** Stage 4 73 variant keyboard model */

export const VARIANT_ID = 'stage-4-73' as const

export const VARIANT = {
  id: VARIANT_ID,
  label: 'Stage 4 73',
  fullName: 'Nord Stage 4 73',
  keyAction: 'hammer action',
  keyboard: {
    totalKeys: 73,
    whiteKeys: 43,
    blackKeys: 30,
    range: 'E to E' as const,
    lowestMidi: 28, // E1
    highestMidi: 100, // E7
    blackKeyHeightFraction: 0.61,
  },
  aspectRatio: 3.0951,
} as const

export type KeyColor = 'white' | 'black'

export interface KeyDef {
  id: string
  midi: number
  name: string
  color: KeyColor
  /** Index among white keys only (for layout) */
  whiteIndex: number
  /** 0-based index among all keys */
  index: number
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export function midiToName(midi: number): string {
  const name = NOTE_NAMES[midi % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${name}${octave}`
}

export function isBlackMidi(midi: number): boolean {
  const n = midi % 12
  return n === 1 || n === 3 || n === 6 || n === 8 || n === 10
}

/** Build the 73-key E-to-E keybed */
export function buildKeybed(): KeyDef[] {
  const keys: KeyDef[] = []
  let whiteIndex = 0
  for (let midi = VARIANT.keyboard.lowestMidi; midi <= VARIANT.keyboard.highestMidi; midi++) {
    const color: KeyColor = isBlackMidi(midi) ? 'black' : 'white'
    keys.push({
      id: `key-${midi}`,
      midi,
      name: midiToName(midi),
      color,
      whiteIndex: color === 'white' ? whiteIndex : whiteIndex - 1,
      index: keys.length,
    })
    if (color === 'white') whiteIndex++
  }
  return keys
}

export const KEYBED = buildKeybed()

export function whiteKeyCount(): number {
  return KEYBED.filter((k) => k.color === 'white').length
}

export function blackKeyCount(): number {
  return KEYBED.filter((k) => k.color === 'black').length
}

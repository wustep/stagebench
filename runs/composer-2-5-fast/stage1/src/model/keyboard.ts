export const VARIANT_ID = 'stage-4-73' as const

export const KEYBOARD = {
  totalKeys: 73,
  whiteKeys: 43,
  blackKeys: 30,
  range: 'E to E',
  lowMidi: 28,
  highMidi: 100,
  blackKeyHeightFraction: 0.61,
} as const

export type KeyColor = 'white' | 'black'

export interface KeyDefinition {
  id: string
  midi: number
  noteName: string
  color: KeyColor
  whiteIndex: number | null
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[midi % 12]}${octave}`
}

function isBlackKey(midi: number): boolean {
  const pc = midi % 12
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10
}

export function buildKeybed(): KeyDefinition[] {
  const keys: KeyDefinition[] = []
  let whiteIndex = 0
  for (let midi = KEYBOARD.lowMidi; midi <= KEYBOARD.highMidi; midi++) {
    const black = isBlackKey(midi)
    keys.push({
      id: `key-${midi}`,
      midi,
      noteName: midiToNoteName(midi),
      color: black ? 'black' : 'white',
      whiteIndex: black ? null : whiteIndex++,
    })
  }
  return keys
}

export const KEYBED = buildKeybed()

export const COMPUTER_KEY_MAP: Record<string, number> = {
  a: 48,
  w: 49,
  s: 50,
  e: 51,
  d: 52,
  f: 53,
  t: 54,
  g: 55,
  y: 56,
  h: 57,
  u: 58,
  j: 59,
  k: 60,
  o: 61,
  l: 62,
  p: 63,
  ';': 64,
  "'": 65,
  z: 36,
  x: 38,
  c: 40,
  v: 41,
  b: 43,
  n: 45,
  m: 47,
  ',': 48,
  '.': 50,
  '/': 52,
}

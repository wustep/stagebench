import type { KeybedSpec, KeySpec } from './types'

const PITCH_CLASS_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const BLACK_PITCH_CLASSES: Record<number, true> = { 1: true, 3: true, 6: true, 8: true, 10: true } // C#, D#, F#, G#, A#

function pitchClassName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${PITCH_CLASS_NAMES[pc]}${octave}`
}

/**
 * Build the 73-key bed (range E1..E7, 43 white / 30 black) with stable IDs
 * and unit-coordinate geometry. White keys are one unit wide; each black key
 * sits centered over the seam between its two adjacent white keys and is
 * `blackKeyHeightFraction` of the white-key height.
 *
 * The black-key seam is placed after the *lower* white neighbour in pitch
 * (C# sits over the seam between C and D, etc.).
 */
export function buildKeybed(blackKeyHeightFraction = 0.61): KeybedSpec {
  const lowest = 28 // E1 (MIDI 28)
  const total = 73 // E1..E7 inclusive
  const keys: KeySpec[] = []
  const whiteOrder: number[] = [] // indices into white keys in chromatic order

  const whiteKeys: KeySpec[] = []
  const blackKeys: KeySpec[] = []

  for (let i = 0; i < total; i++) {
    const midi = lowest + i
    const isBlack = BLACK_PITCH_CLASSES[((midi % 12) + 12) % 12] === true
    if (!isBlack) {
      whiteKeys.push({
        id: `key-w-${midi}`,
        midi,
        isBlack: false,
        x: whiteKeys.length,
        width: 1,
        name: pitchClassName(midi),
      })
      whiteOrder.push(midi)
    }
  }

  // Rebuild with black key placement now that whites are ordered.
  let whiteIndex = 0
  const placed: KeySpec[] = []
  for (let i = 0; i < total; i++) {
    const midi = lowest + i
    const isBlack = BLACK_PITCH_CLASSES[((midi % 12) + 12) % 12] === true
    if (!isBlack) {
      placed.push(whiteKeys[whiteIndex++])
      continue
    }
    // lower white neighbour in pitch
    const lowerPc = ((midi - 1 + 12) % 12)
    // find the position of the last white key with that pitch class so far
    let seamIndex = -1
    for (let w = 0; w < whiteIndex; w++) {
      if (((whiteKeys[w].midi % 12) + 12) % 12 === lowerPc) seamIndex = w
    }
    const x = (seamIndex + 1) - 0.6 / 2 // centered on seam after white `seamIndex`
    blackKeys.push({
      id: `key-b-${midi}`,
      midi,
      isBlack: true,
      x,
      width: 0.6,
      name: pitchClassName(midi),
    })
    placed.push(blackKeys[blackKeys.length - 1])
  }

  return {
    totalKeys: total,
    whiteKeys: whiteKeys.length,
    blackKeys: blackKeys.length,
    rangeLow: pitchClassName(lowest),
    rangeHigh: pitchClassName(lowest + total - 1),
    blackKeyHeightFraction,
    keys: placed,
  }
}
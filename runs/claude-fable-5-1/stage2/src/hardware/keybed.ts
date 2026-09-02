/**
 * Keybed model for the assigned variant (Nord Stage 4 73: E1–E6, hammer action).
 * Geometry is expressed in percent of the keybed width / height so the model is
 * independent of the rendered size. Every key has a stable id `key-<midi>`.
 */
export type KeyColor = 'white' | 'black'

export interface KeySpec {
  id: string
  midi: number
  /** Scientific pitch name, middle C = C4. */
  name: string
  color: KeyColor
  pitchClass: number
  octave: number
  /** Index among white keys (0-based) or, for black keys, the white key to its left. */
  whiteIndex: number
  /** Left edge in percent of the keybed width. */
  x: number
  /** Width in percent of the keybed width. */
  w: number
  /** Length in percent of the keybed (white key) height. */
  h: number
}

export interface KeybedVariant {
  id: string
  label: string
  keyAction: string
  lowestMidi: number
  highestMidi: number
  totalKeys: number
  whiteKeys: number
  blackKeys: number
  range: string
  blackKeyHeightFraction: number
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])
/** Visual offset of each black key relative to the white key boundary to its right (fraction of black width). */
const BLACK_OFFSETS: Record<number, number> = { 1: 0.62, 3: 0.38, 6: 0.66, 8: 0.5, 10: 0.34 }

export const STAGE_4_73: KeybedVariant = {
  id: 'stage-4-73',
  label: 'Stage 4 73',
  keyAction: 'hammer action',
  lowestMidi: 28, // E1
  highestMidi: 100, // E6
  totalKeys: 73,
  whiteKeys: 43,
  blackKeys: 30,
  range: 'E to E',
  blackKeyHeightFraction: 0.61,
}

export function midiToName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[pc]}${octave}`
}

export function isBlackMidi(midi: number): boolean {
  return BLACK_PITCH_CLASSES.has(((midi % 12) + 12) % 12)
}

export function buildKeybed(variant: KeybedVariant = STAGE_4_73): KeySpec[] {
  const keys: KeySpec[] = []
  let whiteCount = 0
  for (let midi = variant.lowestMidi; midi <= variant.highestMidi; midi++) {
    if (!isBlackMidi(midi)) whiteCount++
  }
  const whitePitch = 100 / whiteCount
  const blackW = whitePitch * 0.58
  let whiteIndex = -1
  for (let midi = variant.lowestMidi; midi <= variant.highestMidi; midi++) {
    const pc = ((midi % 12) + 12) % 12
    const octave = Math.floor(midi / 12) - 1
    const black = BLACK_PITCH_CLASSES.has(pc)
    if (!black) whiteIndex++
    const base = {
      id: `key-${midi}`,
      midi,
      name: midiToName(midi),
      pitchClass: pc,
      octave,
      whiteIndex,
    }
    if (black) {
      const boundary = (whiteIndex + 1) * whitePitch
      const x = boundary - blackW * (BLACK_OFFSETS[pc] ?? 0.5)
      keys.push({ ...base, color: 'black', x, w: blackW, h: variant.blackKeyHeightFraction * 100 })
    } else {
      keys.push({ ...base, color: 'white', x: whiteIndex * whitePitch, w: whitePitch, h: 100 })
    }
  }
  return keys
}

export const KEYBED = buildKeybed()
export const KEY_BY_MIDI = new Map(KEYBED.map((k) => [k.midi, k]))

export function keybedSummary(keys: KeySpec[] = KEYBED) {
  const white = keys.filter((k) => k.color === 'white').length
  return {
    total: keys.length,
    white,
    black: keys.length - white,
    lowest: keys[0]?.name ?? '',
    highest: keys[keys.length - 1]?.name ?? '',
  }
}

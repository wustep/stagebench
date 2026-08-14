export const VARIANT_ID = 'stage-4-73' as const

export const VARIANT = {
  id: VARIANT_ID,
  label: 'Stage 4 73',
  keyAction: 'hammer action',
  totalKeys: 73,
  whiteKeys: 43,
  blackKeys: 30,
  rangeLabel: 'E to E',
  midiMin: 28,
  midiMax: 100,
  blackKeyHeightFraction: 0.61,
  aspectRatio: 3.0951,
} as const

export const VERTICAL_SPLIT = {
  deck: 0.54,
  keybed: 0.46,
  tolerance: 0.025,
} as const

export const SECTION_ORDER = [
  'performance',
  'organ',
  'piano',
  'program',
  'synth',
  'effects',
] as const

export type SectionId = (typeof SECTION_ORDER)[number]

export const SECTION_FRACTIONS: Record<SectionId, number> = {
  performance: 0.14,
  organ: 0.2,
  piano: 0.085,
  program: 0.125,
  synth: 0.25,
  effects: 0.2,
}

export const SECTION_LABELS: Record<SectionId, string> = {
  performance: 'Performance controls',
  organ: 'Organ',
  piano: 'Piano',
  program: 'Program and morph',
  synth: 'Synth',
  effects: 'Layer effects',
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

export function isBlackMidi(midi: number): boolean {
  const n = midi % 12
  return n === 1 || n === 3 || n === 6 || n === 8 || n === 10
}

export function noteName(midi: number): string {
  const name = NOTE_NAMES[midi % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${name}${octave}`
}

export const PRIMARY_OLED_IDS = ['program-oled', 'synth-oled'] as const

export type SectionId = 'performance' | 'organ' | 'piano' | 'program' | 'synth' | 'effects'

export interface HorizontalSectionSpec {
  readonly id: SectionId
  readonly label: string
  readonly fraction: number
}

export interface KeyDefinition {
  readonly id: string
  readonly midi: number
  readonly noteName: string
  readonly pitchClass: string
  readonly octave: number
  readonly isBlack: boolean
  readonly whiteIndex: number
  readonly leftPercent: number
  readonly widthPercent: number
  readonly computerKey?: string
}

export const STAGE_4_73_VARIANT = {
  id: 'stage-4-73',
  label: 'Stage 4 73',
  fullName: 'Nord Stage 4 73',
  keyAction: 'hammer action',
  aspectRatio: 3.0951,
  verticalAllocation: {
    controlDeckIncludingTopRail: 0.54,
    keybedIncludingBottomRail: 0.46,
    tolerance: 0.025,
  },
  keyboard: {
    totalKeys: 73,
    whiteKeys: 43,
    blackKeys: 30,
    firstMidi: 28, // E1
    lastMidi: 100, // E7
    rangeLabel: 'E to E',
    blackKeyHeightFraction: 0.61,
  },
  sections: [
    { id: 'performance', label: 'Performance controls', fraction: 0.14 },
    { id: 'organ', label: 'Organ', fraction: 0.2 },
    { id: 'piano', label: 'Piano', fraction: 0.085 },
    { id: 'program', label: 'Program and morph', fraction: 0.125 },
    { id: 'synth', label: 'Synth', fraction: 0.25 },
    { id: 'effects', label: 'Layer effects', fraction: 0.2 },
  ] as readonly HorizontalSectionSpec[],
} as const

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

// Realistic piano black-key center offsets relative to the left edge of the preceding white key
const BLACK_CENTER_OFFSET: Record<number, number> = {
  1: 0.91, // C#
  3: 1.09, // D#
  6: 0.89, // F#
  8: 1.0, // G#
  10: 1.11, // A#
}

/**
 * Computer keyboard mapping centered around C4 (MIDI 60).
 * Main chromatic row: A W S E D F T G Y H U J K O L P ; -> C4..F5
 * Lower diatonic row: Z X C V B N M -> C3..B3
 */
export const COMPUTER_KEY_TO_MIDI: Readonly<Record<string, number>> = {
  KeyZ: 48, // C3
  KeyX: 50, // D3
  KeyC: 52, // E3
  KeyV: 53, // F3
  KeyB: 55, // G3
  KeyN: 57, // A3
  KeyM: 59, // B3
  KeyA: 60, // C4
  KeyW: 61, // C#4
  KeyS: 62, // D4
  KeyE: 63, // D#4
  KeyD: 64, // E4
  KeyF: 65, // F4
  KeyT: 66, // F#4
  KeyG: 67, // G4
  KeyY: 68, // G#4
  KeyH: 69, // A4
  KeyU: 70, // A#4
  KeyJ: 71, // B4
  KeyK: 72, // C5
  KeyO: 73, // C#5
  KeyL: 74, // D5
  KeyP: 75, // D#5
  Semicolon: 76, // E5
  Quote: 77, // F5
}

const MIDI_TO_COMPUTER_HINT: Record<number, string> = {}
for (const [code, midi] of Object.entries(COMPUTER_KEY_TO_MIDI)) {
  const hint =
    code === 'Semicolon' ? ';' : code === 'Quote' ? "'" : code.replace('Key', '')
  MIDI_TO_COMPUTER_HINT[midi] = hint
}

export function midiToNoteName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12
  const octave = Math.floor(midi / 12) - 1
  return `${PITCH_NAMES[pc]}${octave}`
}

function buildStage473Keys(): readonly KeyDefinition[] {
  const { firstMidi, lastMidi, whiteKeys } = STAGE_4_73_VARIANT.keyboard
  const whiteWidthPercent = 100 / whiteKeys
  const blackWidthPercent = whiteWidthPercent * 0.62
  const keys: KeyDefinition[] = []

  let whiteIndex = 0
  for (let midi = firstMidi; midi <= lastMidi; midi++) {
    const pc = midi % 12
    const octave = Math.floor(midi / 12) - 1
    const pitchClass = PITCH_NAMES[pc]
    const noteName = `${pitchClass}${octave}`
    const isBlack = BLACK_PITCH_CLASSES.has(pc)
    const id = `key-${midi}-${noteName.replace('#', 's')}`

    if (isBlack) {
      const prevWhiteIdx = whiteIndex - 1
      const centerWhiteUnits = prevWhiteIdx + (BLACK_CENTER_OFFSET[pc] ?? 1.0)
      const leftPercent = centerWhiteUnits * whiteWidthPercent - blackWidthPercent / 2
      keys.push({
        id,
        midi,
        noteName,
        pitchClass,
        octave,
        isBlack: true,
        whiteIndex: prevWhiteIdx,
        leftPercent,
        widthPercent: blackWidthPercent,
        computerKey: MIDI_TO_COMPUTER_HINT[midi],
      })
    } else {
      keys.push({
        id,
        midi,
        noteName,
        pitchClass,
        octave,
        isBlack: false,
        whiteIndex,
        leftPercent: whiteIndex * whiteWidthPercent,
        widthPercent: whiteWidthPercent,
        computerKey: MIDI_TO_COMPUTER_HINT[midi],
      })
      whiteIndex++
    }
  }

  return keys
}

export const STAGE_4_73_KEYS: readonly KeyDefinition[] = buildStage473Keys()
export const STAGE_4_73_WHITE_KEYS: readonly KeyDefinition[] = STAGE_4_73_KEYS.filter((k) => !k.isBlack)
export const STAGE_4_73_BLACK_KEYS: readonly KeyDefinition[] = STAGE_4_73_KEYS.filter((k) => k.isBlack)

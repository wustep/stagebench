// Nord Stage 4 73-key hardware model

import type { Control, ControlState, ControlType, Rect, InstrumentLayout } from './types'

// Variant specification for Stage 4 73-key
export const STAGE4_73_SPEC = {
  totalKeys: 73,
  whiteKeys: 43,
  blackKeys: 30,
  keyRange: 'E-E',
  keyAction: 'hammer action',
  aspectRatio: 3.0951,
  blackKeyHeightFraction: 0.61,
} as const

// Horizontal section allocations
const SECTIONS = {
  performance: 0.13,
  organ: 0.21,
  piano: 0.15,
  program: 0.09,
  synth: 0.21,
  effects: 0.21,
} as const

export function calculateLayout(viewportWidth: number, viewportHeight: number): InstrumentLayout {
  // Determine instrument size to fit viewport (88–97% width)
  const maxWidth = viewportWidth * 0.97
  const minWidth = viewportWidth * 0.88

  // Calculate from aspect ratio
  const desiredHeight = viewportHeight * 0.95
  let instrumentWidth = desiredHeight * STAGE4_73_SPEC.aspectRatio

  if (instrumentWidth > maxWidth) {
    instrumentWidth = maxWidth
  } else if (instrumentWidth < minWidth) {
    instrumentWidth = minWidth
  }

  const instrumentHeight = instrumentWidth / STAGE4_73_SPEC.aspectRatio

  // Center instrument on screen
  const instrumentX = (viewportWidth - instrumentWidth) / 2
  const instrumentY = (viewportHeight - instrumentHeight) / 2

  const controlDeckHeight = instrumentHeight * 0.54
  const keybedHeight = instrumentHeight * 0.46

  // Calculate section boundaries
  const sections: Record<string, Rect> = {}
  let xPos = instrumentX
  for (const [name, fraction] of Object.entries(SECTIONS)) {
    const width = instrumentWidth * fraction
    sections[name] = {
      x: xPos,
      y: instrumentY,
      width,
      height: controlDeckHeight,
    }
    xPos += width
  }

  // Calculate key geometry (simplified - uniform key spacing)
  const keybedStartX = instrumentX
  const keybedWidth = instrumentWidth
  const keyWidth = keybedWidth / STAGE4_73_SPEC.whiteKeys
  const whiteKeyHeight = keybedHeight
  const blackKeyHeight = whiteKeyHeight * STAGE4_73_SPEC.blackKeyHeightFraction

  return {
    viewport: { x: 0, y: 0 },
    instrument: {
      x: instrumentX,
      y: instrumentY,
      width: instrumentWidth,
      height: instrumentHeight,
    },
    controlDeck: {
      x: instrumentX,
      y: instrumentY,
      width: instrumentWidth,
      height: controlDeckHeight,
    },
    keybed: {
      x: keybedStartX,
      y: instrumentY + controlDeckHeight,
      width: keybedWidth,
      height: keybedHeight,
    },
    sections,
    keyGeometry: {
      keyWidth,
      keyHeight: whiteKeyHeight,
      blackKeyHeight,
      keySpacing: keyWidth * 0.98, // 2% spacing between keys
    },
  }
}

export function getNoteForKeyIndex(keyIndex: number): number {
  // 73-key E-E: E1 is MIDI 40, last E is MIDI 112
  return 40 + keyIndex
}

export function getKeyIndexForNote(note: number): number {
  return note - 40
}

export function isBlackKey(note: number): boolean {
  const noteInOctave = note % 12
  return [1, 3, 6, 8, 10].includes(noteInOctave)
}

export function createControlState(type: ControlType): ControlState {
  switch (type) {
    case 'key':
      return { pressed: false, enabled: true }
    case 'button':
      return { pressed: false, enabled: true }
    case 'switch':
      return { position: 0, enabled: true }
    case 'knob':
    case 'fader':
    case 'drawbar':
    case 'encoder':
    case 'wheel':
      return { position: 0, enabled: true }
    case 'led':
      return { enabled: false }
    case 'display':
      return { text: '', enabled: true }
    default:
      return { enabled: true }
  }
}

export function createControl(id: string, type: ControlType, section: string, label: string, ariaLabel: string, bounds: Rect): Control {
  return {
    id,
    type,
    section,
    label,
    ariaLabel,
    bounds,
    state: createControlState(type),
  }
}

// Keyboard mapping for computer input
export const KEYBOARD_MAP: Record<string, number> = {
  // Bottom row (white keys on left side)
  z: 40, // E
  x: 42, // F#
  c: 44, // G#
  v: 45, // A
  b: 47, // B
  n: 49, // C#
  m: 50, // D#

  // Number row (white keys)
  '1': 52, // E
  '2': 53, // F
  '3': 55, // G
  '4': 57, // A
  '5': 59, // B
  '6': 60, // C
  '7': 62, // D
  '8': 64, // E
  '9': 65, // F
  '0': 67, // G

  // Q row additions
  q: 69, // A
  w: 71, // B
  e: 72, // C
  r: 74, // D
  t: 76, // E
  y: 77, // F
  u: 79, // G
  i: 81, // A
  o: 83, // B
  p: 84, // C

  // Continue with additional keys
  a: 86, // D
  s: 88, // E
  d: 89, // F
  f: 91, // G
  g: 93, // A
  h: 95, // B
  j: 96, // C
  k: 98, // D
  l: 100, // E
}

// Reverse mapping for accessibility/display
export const NOTE_TO_LETTER: Record<number, string> = {
  40: 'E', 41: 'F', 42: 'F#', 43: 'G', 44: 'G#', 45: 'A', 46: 'A#', 47: 'B',
  48: 'C', 49: 'C#', 50: 'D', 51: 'D#', 52: 'E', 53: 'F', 54: 'F#', 55: 'G',
  56: 'G#', 57: 'A', 58: 'A#', 59: 'B', 60: 'C', 61: 'C#', 62: 'D', 63: 'D#',
  64: 'E', 65: 'F', 66: 'F#', 67: 'G', 68: 'G#', 69: 'A', 70: 'A#', 71: 'B',
  72: 'C', 73: 'C#', 74: 'D', 75: 'D#', 76: 'E', 77: 'F', 78: 'F#', 79: 'G',
  80: 'G#', 81: 'A', 82: 'A#', 83: 'B', 84: 'C', 85: 'C#', 86: 'D', 87: 'D#',
  88: 'E', 89: 'F', 90: 'F#', 91: 'G', 92: 'G#', 93: 'A', 94: 'A#', 95: 'B',
  96: 'C', 97: 'C#', 98: 'D', 99: 'D#', 100: 'E', 101: 'F', 102: 'F#', 103: 'G',
  104: 'G#', 105: 'A', 106: 'A#', 107: 'B', 108: 'C', 109: 'C#', 110: 'D', 111: 'D#', 112: 'E',
}

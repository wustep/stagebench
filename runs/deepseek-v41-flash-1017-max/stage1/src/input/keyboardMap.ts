/**
 * Computer-keyboard mapping.
 *
 * Two rows follow the physical white/black layout of a piano under the QWERTY hand,
 * exactly as printed in the on-screen legend. `code` (physical key) is used rather than
 * `key` so the mapping does not move with the user's keyboard layout, and so a modifier
 * that changes the character cannot silently remap a note.
 */
export interface KeyMapping {
  code: string
  /** Semitone offset from the base note of the mapped octave. */
  offset: number
  /** Printed glyph for the on-screen legend. */
  label: string
}

export const KEYBOARD_BASE_MIDI = 48 // C3 is the lowest mapped key

export const KEY_MAPPINGS: readonly KeyMapping[] = [
  { code: 'KeyZ', offset: 0, label: 'Z' },
  { code: 'KeyS', offset: 1, label: 'S' },
  { code: 'KeyX', offset: 2, label: 'X' },
  { code: 'KeyD', offset: 3, label: 'D' },
  { code: 'KeyC', offset: 4, label: 'C' },
  { code: 'KeyV', offset: 5, label: 'V' },
  { code: 'KeyG', offset: 6, label: 'G' },
  { code: 'KeyB', offset: 7, label: 'B' },
  { code: 'KeyH', offset: 8, label: 'H' },
  { code: 'KeyN', offset: 9, label: 'N' },
  { code: 'KeyJ', offset: 10, label: 'J' },
  { code: 'KeyM', offset: 11, label: 'M' },
  { code: 'Comma', offset: 12, label: ',' },
  { code: 'KeyL', offset: 13, label: 'L' },
  { code: 'Period', offset: 14, label: '.' },
  { code: 'Semicolon', offset: 15, label: ';' },
  { code: 'Slash', offset: 16, label: '/' },
  { code: 'KeyQ', offset: 12, label: 'Q' },
  { code: 'Digit2', offset: 13, label: '2' },
  { code: 'KeyW', offset: 14, label: 'W' },
  { code: 'Digit3', offset: 15, label: '3' },
  { code: 'KeyE', offset: 16, label: 'E' },
  { code: 'KeyR', offset: 17, label: 'R' },
  { code: 'Digit5', offset: 18, label: '5' },
  { code: 'KeyT', offset: 19, label: 'T' },
  { code: 'Digit6', offset: 20, label: '6' },
  { code: 'KeyY', offset: 21, label: 'Y' },
  { code: 'Digit7', offset: 22, label: '7' },
  { code: 'KeyU', offset: 23, label: 'U' },
  { code: 'KeyI', offset: 24, label: 'I' },
  { code: 'Digit9', offset: 25, label: '9' },
  { code: 'KeyO', offset: 26, label: 'O' },
  { code: 'Digit0', offset: 27, label: '0' },
  { code: 'KeyP', offset: 28, label: 'P' },
]

const BY_CODE = new Map(KEY_MAPPINGS.map((m) => [m.code, m]))

export function mappingForCode(code: string): KeyMapping | undefined {
  return BY_CODE.get(code)
}

export function midiForCode(code: string): number | undefined {
  const mapping = BY_CODE.get(code)
  return mapping ? KEYBOARD_BASE_MIDI + mapping.offset : undefined
}

/** The mapped note range, used by the on-screen legend and by the audit. */
export function mappedMidiRange(): { lowest: number; highest: number } {
  const midis = KEY_MAPPINGS.map((m) => KEYBOARD_BASE_MIDI + m.offset)
  return { lowest: Math.min(...midis), highest: Math.max(...midis) }
}

/** Space is the sustain pedal on the computer keyboard, matching the manual's pedal role. */
export const SUSTAIN_KEY_CODE = 'Space'
export const SUSTAIN_KEY_LABEL = 'SPACE'
/** Release velocity for a keyboard note-up; the Nord has no release-velocity sensor. */
export const KEYBOARD_VELOCITY = 0.78

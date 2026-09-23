/**
 * Computer-keyboard note map (KeyboardEvent.code, layout-independent).
 * One and a half octaves from C4. Space is the sustain pedal.
 */
export const KEY_CODE_TO_MIDI: Readonly<Record<string, number>> = {
  KeyA: 60,
  KeyW: 61,
  KeyS: 62,
  KeyE: 63,
  KeyD: 64,
  KeyF: 65,
  KeyT: 66,
  KeyG: 67,
  KeyY: 68,
  KeyH: 69,
  KeyU: 70,
  KeyJ: 71,
  KeyK: 72,
  KeyO: 73,
  KeyL: 74,
  KeyP: 75,
  Semicolon: 76,
}

export const SUSTAIN_KEY_CODE = 'Space'
export const KEYBOARD_VELOCITY = 0.75

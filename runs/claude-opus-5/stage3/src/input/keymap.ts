import { VARIANT } from '../model/variant'

/**
 * Computer keyboard mapping. Keys are matched on `KeyboardEvent.code` so the layout works on
 * non-QWERTY keyboards and is unaffected by modifiers.
 */
export const NOTE_KEYS: Readonly<Record<string, number>> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
  Quote: 17,
}

export const OCTAVE_DOWN_KEY = 'KeyZ'
export const OCTAVE_UP_KEY = 'KeyX'
export const SUSTAIN_KEY = 'Space'

/** C4 = middle C. */
export const DEFAULT_BASE_MIDI = 60

export const MIN_BASE_MIDI = VARIANT.lowestMidi
export const MAX_BASE_MIDI = VARIANT.highestMidi - 17

export function clampBaseMidi(base: number): number {
  return Math.min(MAX_BASE_MIDI, Math.max(MIN_BASE_MIDI, base))
}

/** Returns the MIDI note for a key code, or null when the key is unmapped or out of range. */
export function midiForKeyCode(code: string, baseMidi: number): number | null {
  const offset = NOTE_KEYS[code]
  if (offset === undefined) return null
  const midi = baseMidi + offset
  if (midi < VARIANT.lowestMidi || midi > VARIANT.highestMidi) return null
  return midi
}

/**
 * The sustain key is swallowed only when it would not activate a focused control. Space is the
 * activation key for buttons and sliders, so a focused panel control keeps it.
 */
export function shouldHandleSustainKey(activeElement: Element | null): boolean {
  if (!activeElement) return true
  const tag = activeElement.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return false
  if (activeElement.getAttribute('contenteditable') === 'true') return false
  const role = activeElement.getAttribute('role')
  if (tag === 'button' || role === 'button' || role === 'slider' || role === 'spinbutton') return false
  return true
}

/** True when note keys should be ignored because the user is typing into a field. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target && typeof target === 'object' && 'tagName' in target)) return false
  const element = target as Element
  const tag = element.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return element.getAttribute?.('contenteditable') === 'true'
}

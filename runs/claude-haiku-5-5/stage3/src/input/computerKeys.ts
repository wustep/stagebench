// Computer keyboard mapping. Keys are matched by physical `code`, so the mapping is layout-independent.
// Repeat events are suppressed here, so the note controller never sees auto-repeat.

export const COMPUTER_KEY_NOTES: Readonly<Record<string, number>> = {
  KeyA: 60, // C4
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
  KeyK: 72, // C5
  KeyO: 73,
  KeyL: 74,
  KeyP: 75,
  Semicolon: 76, // E5
}

export const SUSTAIN_KEY_CODES: readonly string[] = ['ShiftLeft', 'ShiftRight']

export const COMPUTER_KEY_VELOCITY = 100

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

export interface ComputerKeyEvent {
  code: string
  repeat: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  target: EventTarget | null
}

export type ComputerKeyIntent =
  | { type: 'note-on'; source: string; note: number; velocity: number }
  | { type: 'note-off'; source: string; note: number }
  | { type: 'sustain'; on: boolean }
  | { type: 'ignore' }

/**
 * Translates one keyboard event into a note intent. Shortcuts with Ctrl, Meta, or Alt are left alone,
 * and so are key events aimed at form fields.
 */
export function translateKeyDown(event: ComputerKeyEvent): ComputerKeyIntent {
  if (event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) return { type: 'ignore' }
  if (SUSTAIN_KEY_CODES.includes(event.code)) return { type: 'sustain', on: true }
  const note = COMPUTER_KEY_NOTES[event.code]
  if (note === undefined) return { type: 'ignore' }
  if (event.repeat) return { type: 'ignore' }
  return { type: 'note-on', source: `key:${event.code}`, note, velocity: COMPUTER_KEY_VELOCITY }
}

export function translateKeyUp(event: Pick<ComputerKeyEvent, 'code'>): ComputerKeyIntent {
  if (SUSTAIN_KEY_CODES.includes(event.code)) return { type: 'sustain', on: false }
  const note = COMPUTER_KEY_NOTES[event.code]
  if (note === undefined) return { type: 'ignore' }
  return { type: 'note-off', source: `key:${event.code}`, note }
}

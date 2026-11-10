import type { EventsBoundary, KeyEventLike, StorageBoundary, Unsubscribe } from '../platform/types'
import type { NoteLifecycle } from './noteLifecycle'

/**
 * Computer-keyboard piano: the home row is white keys, the row above is black keys,
 * laid out like a piano starting on C. Mapped by physical key position (`event.code`),
 * so it works on any keyboard layout.
 */
export const KEY_OFFSETS: Readonly<Record<string, number>> = {
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

export const OCTAVE_DOWN_CODE = 'KeyZ'
export const OCTAVE_UP_CODE = 'KeyX'
export const SUSTAIN_CODE = 'Space'
export const KEYBOARD_VELOCITY = 0.72
export const DEFAULT_BASE_NOTE = 60
const MIN_BASE_NOTE = 36
const MAX_BASE_NOTE = 84
const STORAGE_KEY = 'stage4.keyboard.baseNote'
const SUSTAIN_SOURCE = 'kbd:sustain'

interface TargetLike {
  tagName?: string
  isContentEditable?: boolean
  getAttribute?: (name: string) => string | null
}

const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
const INTERACTIVE_TAGS = new Set(['BUTTON', 'A', 'SUMMARY', ...TEXT_ENTRY_TAGS])
const INTERACTIVE_ROLES = new Set(['button', 'slider', 'link', 'checkbox', 'switch', 'tab', 'menuitem'])

/** Typing into a field must never play notes. */
export function isTextEntryTarget(target: unknown): boolean {
  const element = target as TargetLike | null
  if (!element || typeof element !== 'object') return false
  return Boolean(element.isContentEditable) || TEXT_ENTRY_TAGS.has(String(element.tagName ?? '').toUpperCase())
}

/** Space on a focused control belongs to that control, not to the sustain pedal. */
export function isInteractiveTarget(target: unknown): boolean {
  const element = target as TargetLike | null
  if (!element || typeof element !== 'object') return false
  if (isTextEntryTarget(element)) return true
  if (INTERACTIVE_TAGS.has(String(element.tagName ?? '').toUpperCase())) return true
  const role = element.getAttribute?.('role')
  return role != null && INTERACTIVE_ROLES.has(role)
}

export interface KeyboardOptions {
  /** Called on any key that should wake the audio engine. */
  onGesture?: () => void
  /** Called when the computer's Shift key goes down or up (it doubles as the panel's Shift). */
  onShift?: (down: boolean) => void
}

export class KeyboardInput {
  private readonly events: EventsBoundary
  private readonly lifecycle: NoteLifecycle
  private readonly storage: StorageBoundary
  private readonly onGesture: () => void
  private readonly onShift: (down: boolean) => void
  /** Physical key → the note it struck, so octave changes never strand a held note. */
  private readonly down = new Map<string, number>()
  private subscriptions: Unsubscribe[] = []
  private listeners = new Set<() => void>()
  private base: number

  constructor(events: EventsBoundary, lifecycle: NoteLifecycle, storage: StorageBoundary, options: KeyboardOptions = {}) {
    this.events = events
    this.lifecycle = lifecycle
    this.storage = storage
    this.onGesture = options.onGesture ?? (() => undefined)
    this.onShift = options.onShift ?? (() => undefined)
    this.base = readBaseNote(storage)
  }

  attach(): void {
    if (this.subscriptions.length > 0) return
    this.subscriptions = [
      this.events.onKeyDown((event) => this.handleKeyDown(event)),
      this.events.onKeyUp((event) => this.handleKeyUp(event)),
    ]
  }

  dispose(): void {
    for (const unsubscribe of this.subscriptions) unsubscribe()
    this.subscriptions = []
    this.reset()
    this.listeners.clear()
  }

  /** Forget every held key (used on blur, where key-up events never arrive). */
  reset(): void {
    this.down.clear()
    this.onShift(false)
  }

  getBaseNote = (): number => this.base

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  shiftOctave(direction: -1 | 1): void {
    const next = Math.min(MAX_BASE_NOTE, Math.max(MIN_BASE_NOTE, this.base + direction * 12))
    if (next === this.base) return
    this.base = next
    this.storage.setItem(STORAGE_KEY, String(next))
    for (const listener of this.listeners) listener()
  }

  /** Note a physical key would play right now, or null if it is not a piano key. */
  noteFor(code: string): number | null {
    const offset = KEY_OFFSETS[code]
    return offset === undefined ? null : this.base + offset
  }

  private handleKeyDown(event: KeyEventLike): void {
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      this.onShift(true)
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (isTextEntryTarget(event.target)) return

    if (event.code === SUSTAIN_CODE) {
      if (isInteractiveTarget(event.target)) return
      event.preventDefault()
      if (event.repeat) return
      this.onGesture()
      this.lifecycle.setSustain(SUSTAIN_SOURCE, true)
      return
    }
    if (event.code === OCTAVE_DOWN_CODE || event.code === OCTAVE_UP_CODE) {
      if (!event.repeat) this.shiftOctave(event.code === OCTAVE_UP_CODE ? 1 : -1)
      return
    }
    const note = this.noteFor(event.code)
    if (note === null) return
    // Auto-repeat and duplicate key-downs are suppressed: one physical press, one strike.
    if (event.repeat || this.down.has(event.code)) return
    this.down.set(event.code, note)
    this.onGesture()
    this.lifecycle.press(`kbd:${event.code}`, note, KEYBOARD_VELOCITY)
  }

  private handleKeyUp(event: KeyEventLike): void {
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') {
      this.onShift(false)
      return
    }
    if (event.code === SUSTAIN_CODE) {
      this.lifecycle.setSustain(SUSTAIN_SOURCE, false)
      return
    }
    const note = this.down.get(event.code)
    if (note === undefined) return
    this.down.delete(event.code)
    this.lifecycle.release(`kbd:${event.code}`, note)
  }
}

function readBaseNote(storage: StorageBoundary): number {
  const stored = Number(storage.getItem(STORAGE_KEY))
  if (Number.isInteger(stored) && stored >= MIN_BASE_NOTE && stored <= MAX_BASE_NOTE && stored % 12 === 0) return stored
  return DEFAULT_BASE_NOTE
}

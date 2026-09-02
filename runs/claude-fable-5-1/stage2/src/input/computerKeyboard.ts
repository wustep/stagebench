/**
 * Computer keyboard mapping (physical key codes, layout independent):
 * A W S E D F T G Y H U J K O L P ; ' play C4..C#5 (two octaves incl. the upper C#),
 * Z / X shift the octave down / up, Shift is the sustain pedal. Auto-repeat is suppressed and
 * every held note is released on blur or when the page is hidden.
 */
import type { NoteBus } from './noteBus'

export const KEY_MAP: Readonly<Record<string, number>> = {
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
export const SUSTAIN_CODES: readonly string[] = ['ShiftLeft', 'ShiftRight']
export const OCTAVE_DOWN_CODE = 'KeyZ'
export const OCTAVE_UP_CODE = 'KeyX'
export const DEFAULT_BASE_MIDI = 60
export const KEYBOARD_VELOCITY = 96

export interface KeyboardOptions {
  baseMidi?: number
  lowest: number
  highest: number
  onBaseChange?: (base: number) => void
}

interface KeyLikeEvent {
  code: string
  repeat?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  target?: EventTarget | null
  preventDefault?: () => void
}

type Target = Pick<Window, 'addEventListener' | 'removeEventListener'>

function isEditable(target: EventTarget | null | undefined): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null | undefined
  if (!el || !el.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || !!el.isContentEditable
}

export interface ComputerKeyboard {
  detach(): void
  getBase(): number
  setBase(base: number): void
  /** For tests and the on-screen hint: which midi a code currently maps to. */
  midiFor(code: string): number | null
  heldCodes(): string[]
}

export function attachComputerKeyboard(target: Target | null, bus: NoteBus, options: KeyboardOptions): ComputerKeyboard {
  let base = options.baseMidi ?? DEFAULT_BASE_MIDI
  const held = new Map<string, number>()
  let sustainHeld = false

  const clampBase = (b: number) => {
    const min = Math.ceil(options.lowest / 12) * 12
    const max = Math.floor((options.highest - 12) / 12) * 12
    return Math.min(max, Math.max(min, b))
  }
  base = clampBase(base)

  const midiFor = (code: string) => {
    const offset = KEY_MAP[code]
    if (offset === undefined) return null
    const midi = base + offset
    return bus.inRange(midi) ? midi : null
  }

  const onKeyDown = (e: KeyLikeEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return
    if (SUSTAIN_CODES.includes(e.code)) {
      if (!sustainHeld) {
        sustainHeld = true
        bus.setSustain('keyboard', true)
      }
      return
    }
    if (e.code === OCTAVE_DOWN_CODE || e.code === OCTAVE_UP_CODE) {
      const next = clampBase(base + (e.code === OCTAVE_UP_CODE ? 12 : -12))
      if (next !== base) {
        base = next
        options.onBaseChange?.(base)
      }
      e.preventDefault?.()
      return
    }
    if (held.has(e.code)) return // repeat suppression even without the `repeat` flag
    const midi = midiFor(e.code)
    if (midi === null) return
    held.set(e.code, midi)
    bus.noteOn(midi, KEYBOARD_VELOCITY, 'keyboard')
    e.preventDefault?.()
  }
  const onKeyUp = (e: KeyLikeEvent) => {
    if (SUSTAIN_CODES.includes(e.code)) {
      if (sustainHeld) {
        sustainHeld = false
        bus.setSustain('keyboard', false)
      }
      return
    }
    const midi = held.get(e.code)
    if (midi === undefined) return
    held.delete(e.code)
    bus.noteOff(midi, 'keyboard')
  }
  const releaseEverything = () => {
    held.clear()
    sustainHeld = false
    bus.releaseSource('keyboard')
  }
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') releaseEverything()
  }

  const keydown = onKeyDown as unknown as EventListener
  const keyup = onKeyUp as unknown as EventListener
  target?.addEventListener('keydown', keydown)
  target?.addEventListener('keyup', keyup)
  target?.addEventListener('blur', releaseEverything)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)

  return {
    detach() {
      target?.removeEventListener('keydown', keydown)
      target?.removeEventListener('keyup', keyup)
      target?.removeEventListener('blur', releaseEverything)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
      releaseEverything()
    },
    getBase: () => base,
    setBase(b) {
      base = clampBase(b)
      options.onBaseChange?.(base)
    },
    midiFor,
    heldCodes: () => [...held.keys()],
  }
}

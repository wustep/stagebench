import type { PlayEngine } from '../audio/layeredEngine'
import { HIGHEST_NOTE, LOWEST_NOTE } from '../model/keys'
import type { ListenerTarget, VisibilitySource } from '../runtime'

/**
 * Computer-keyboard mapping by physical key (event.code), so it works on any layout.
 * Home row = white keys from C, top row = black keys:  A W S E D F T G Y H U J K O L P ; '
 */
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

export const KEYBOARD_VELOCITY = 100
export const DEFAULT_BASE_NOTE = 60 // C4
export const MIN_BASE = 36
export const MAX_BASE = 84
export const SUSTAIN_SOURCE = 'kbd:sustain'

const INTERACTIVE_ROLES = new Set(['button', 'slider', 'spinbutton', 'switch', 'checkbox', 'textbox', 'combobox', 'menuitem', 'tab'])

function targetConsumesKey(target: EventTarget | null, code: string): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false
  const el = target as HTMLElement
  if (el.closest('input, textarea, select, [contenteditable="true"]')) return true
  // Space activates focused buttons/keys; let the focused control have it.
  if (code === 'Space') {
    const tag = el.tagName
    if (tag === 'BUTTON' || tag === 'A') return true
    const role = el.getAttribute('role')
    if (role && INTERACTIVE_ROLES.has(role)) return true
  }
  return false
}

export interface KeyboardState {
  baseNote: number
}

export interface ComputerKeyboardOptions {
  engine: () => PlayEngine | null
  target: ListenerTarget
  visibility: VisibilitySource
  onBaseChange?: (base: number) => void
  onUserGesture?: () => void
}

/** Attach global computer-keyboard play, with repeat suppression and blur cleanup. Returns detach. */
export function attachComputerKeyboard(options: ComputerKeyboardOptions): { detach: () => void; state: KeyboardState } {
  const state: KeyboardState = { baseNote: DEFAULT_BASE_NOTE }
  const down = new Map<string, number>()

  const releaseAll = () => {
    const engine = options.engine()
    for (const [code, note] of down) engine?.noteOff(note, `kbd:${code}`)
    down.clear()
    engine?.setSustain(false, SUSTAIN_SOURCE)
  }

  const onKeyDown = (event: Event) => {
    const e = event as KeyboardEvent
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (targetConsumesKey(e.target, e.code)) return
    const engine = options.engine()
    if (e.code === 'Space') {
      e.preventDefault()
      if (e.repeat) return
      options.onUserGesture?.()
      engine?.setSustain(true, SUSTAIN_SOURCE)
      return
    }
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      if (e.repeat) return
      const next = Math.min(MAX_BASE, Math.max(MIN_BASE, state.baseNote + (e.code === 'KeyZ' ? -12 : 12)))
      if (next !== state.baseNote) {
        state.baseNote = next
        options.onBaseChange?.(next)
      }
      return
    }
    const offset = KEY_MAP[e.code]
    if (offset === undefined) return
    e.preventDefault()
    // Repeat suppression: the OS auto-repeat and duplicate keydowns never retrigger.
    if (e.repeat || down.has(e.code)) return
    const note = state.baseNote + offset
    if (note < LOWEST_NOTE || note > HIGHEST_NOTE) return
    down.set(e.code, note)
    options.onUserGesture?.()
    engine?.noteOn(note, KEYBOARD_VELOCITY, `kbd:${e.code}`)
  }

  const onKeyUp = (event: Event) => {
    const e = event as KeyboardEvent
    if (e.code === 'Space') {
      options.engine()?.setSustain(false, SUSTAIN_SOURCE)
      return
    }
    const note = down.get(e.code)
    if (note === undefined) return
    down.delete(e.code)
    options.engine()?.noteOff(note, `kbd:${e.code}`)
  }

  const onBlur = () => releaseAll()
  const onVisibility = () => {
    if (options.visibility.visibilityState === 'hidden') releaseAll()
  }

  options.target.addEventListener('keydown', onKeyDown)
  options.target.addEventListener('keyup', onKeyUp)
  options.target.addEventListener('blur', onBlur)
  options.visibility.addEventListener('visibilitychange', onVisibility)

  return {
    state,
    detach: () => {
      releaseAll()
      options.target.removeEventListener('keydown', onKeyDown)
      options.target.removeEventListener('keyup', onKeyUp)
      options.target.removeEventListener('blur', onBlur)
      options.visibility.removeEventListener('visibilitychange', onVisibility)
    },
  }
}

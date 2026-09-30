import type { NoteLifecycle } from '../audio/lifecycle'
import type { EventTargetLike } from '../audio/types'

/** Two piano rows: lower row starts at C3 (Z), upper row at C4 (Q). */
const LOWER: Array<[string, number]> = [
  ['KeyZ', 48], ['KeyS', 49], ['KeyX', 50], ['KeyD', 51], ['KeyC', 52], ['KeyV', 53], ['KeyG', 54], ['KeyB', 55],
  ['KeyH', 56], ['KeyN', 57], ['KeyJ', 58], ['KeyM', 59], ['Comma', 60], ['KeyL', 61], ['Period', 62], ['Semicolon', 63], ['Slash', 64],
]
const UPPER: Array<[string, number]> = [
  ['KeyQ', 60], ['Digit2', 61], ['KeyW', 62], ['Digit3', 63], ['KeyE', 64], ['KeyR', 65], ['Digit5', 66], ['KeyT', 67],
  ['Digit6', 68], ['KeyY', 69], ['Digit7', 70], ['KeyU', 71], ['KeyI', 72], ['Digit9', 73], ['KeyO', 74], ['Digit0', 75], ['KeyP', 76],
  ['BracketLeft', 77], ['Equal', 78], ['BracketRight', 79],
]

export const KEY_MAP: ReadonlyMap<string, number> = new Map([...LOWER, ...UPPER])
export const KEY_VELOCITY = 96
export const SUSTAIN_CODE = 'Space'

export interface KeyEventLike {
  code: string
  repeat: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  target: unknown
  preventDefault(): void
}

const isEditable = (target: unknown): boolean => {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null
  if (!el || !el.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable === true
}

/** Space sustains only when nothing on the panel would consume it (buttons/sliders use Space themselves). */
const consumesSpace = (target: unknown): boolean => {
  const el = target as { tagName?: string; getAttribute?: (n: string) => string | null } | null
  if (!el || !el.tagName) return false
  if (el.tagName === 'BUTTON' || el.tagName === 'A') return true
  const role = el.getAttribute?.('role')
  return role === 'button' || role === 'slider'
}

/**
 * Attach the mapped computer keyboard to a lifecycle. Repeat events are ignored; blur releases every key.
 * Returns a detach function that removes every listener it added.
 */
export function attachComputerKeyboard(target: EventTargetLike, lifecycle: NoteLifecycle, blurTarget: EventTargetLike = target): () => void {
  const down = new Set<string>()

  const onKeyDown = (e: KeyEventLike) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return
    if (e.code === SUSTAIN_CODE) {
      if (consumesSpace(e.target)) return
      e.preventDefault()
      if (e.repeat || down.has(e.code)) return
      down.add(e.code)
      lifecycle.sustain('key:Space', true)
      return
    }
    const note = KEY_MAP.get(e.code)
    if (note === undefined) return
    e.preventDefault()
    if (e.repeat || down.has(e.code)) return
    down.add(e.code)
    lifecycle.noteOn(`key:${e.code}`, note, KEY_VELOCITY)
  }
  const onKeyUp = (e: KeyEventLike) => {
    if (!down.has(e.code)) return
    down.delete(e.code)
    if (e.code === SUSTAIN_CODE) lifecycle.sustain('key:Space', false)
    else lifecycle.noteOff(`key:${e.code}`)
  }
  const onBlur = () => {
    down.clear()
    lifecycle.releaseSource('key:')
  }

  target.addEventListener('keydown', onKeyDown)
  target.addEventListener('keyup', onKeyUp)
  blurTarget.addEventListener('blur', onBlur)
  return () => {
    target.removeEventListener('keydown', onKeyDown)
    target.removeEventListener('keyup', onKeyUp)
    blurTarget.removeEventListener('blur', onBlur)
    down.clear()
    lifecycle.releaseSource('key:')
  }
}

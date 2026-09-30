import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { BLACK_KEY_HEIGHT_FRACTION, KEYS, LOW_NOTE, HIGH_NOTE, KEY_COUNT, noteName } from '../hardware/keybed'
import { KEYS_LEFT_U, KEYS_RIGHT_U } from '../hardware/geometry'
import { u, useInstrument, useInstrumentSnapshot } from './context'

const DEFAULT_VELOCITY = 96

/** Strike velocity from where along the key the pointer lands: near the front = harder. */
export const velocityFromPosition = (clientY: number, rect: { top: number; height: number }): number => {
  if (!rect || !(rect.height > 0)) return DEFAULT_VELOCITY
  const rel = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
  return Math.round(28 + 99 * rel)
}

const noteFromElement = (el: Element | null): number | null => {
  const key = el?.closest?.('[data-note]')
  if (!key) return null
  const n = Number(key.getAttribute('data-note'))
  return Number.isInteger(n) ? n : null
}

export default function Keybed() {
  const instrument = useInstrument()
  const { pressed } = useInstrumentSnapshot()
  const pointers = useRef(new Map<number, number>())
  const [focusNote, setFocusNote] = useState(LOW_NOTE)

  const lifecycle = instrument?.lifecycle
  const wake = instrument?.wake

  const press = (source: string, note: number, velocity: number) => {
    wake?.()
    lifecycle?.noteOn(source, note, velocity)
  }

  // pointer ups can land outside the keybed (or window): listen globally while mounted
  useEffect(() => {
    if (!lifecycle) return
    const held = pointers.current
    const end = (e: Event) => {
      const id = (e as unknown as globalThis.PointerEvent).pointerId
      if (held.has(id)) {
        held.delete(id)
        lifecycle.noteOff(`pointer:${id}`)
      }
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      for (const id of held.keys()) lifecycle.noteOff(`pointer:${id}`)
      held.clear()
    }
  }, [lifecycle])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== undefined && e.button > 0) return
    const target = e.target as Element
    const note = noteFromElement(target)
    if (note === null) return
    const keyEl = target.closest('[data-note]') as HTMLElement
    const velocity = velocityFromPosition(e.clientY, keyEl.getBoundingClientRect())
    pointers.current.set(e.pointerId, note)
    setFocusNote(note)
    press(`pointer:${e.pointerId}`, note, velocity)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const current = pointers.current.get(e.pointerId)
    if (current === undefined || typeof document.elementFromPoint !== 'function') return
    const under = noteFromElement(document.elementFromPoint(e.clientX, e.clientY))
    if (under === null || under === current) return
    pointers.current.set(e.pointerId, under)
    press(`pointer:${e.pointerId}`, under, DEFAULT_VELOCITY)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const note = noteFromElement(e.target as Element)
    if (note === null) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!e.repeat) {
        setFocusNote(note)
        press(`focus:${note}`, note, DEFAULT_VELOCITY)
      }
      return
    }
    const move = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? LOW_NOTE - note : e.key === 'End' ? HIGH_NOTE - note : 0
    if (move !== 0) {
      e.preventDefault()
      const next = Math.min(HIGH_NOTE, Math.max(LOW_NOTE, note + move))
      setFocusNote(next)
      ;(e.currentTarget.querySelector(`[data-note="${next}"]`) as HTMLElement | null)?.focus()
    }
  }
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    const note = noteFromElement(e.target as Element)
    if (note !== null && (e.key === 'Enter' || e.key === ' ')) lifecycle?.noteOff(`focus:${note}`)
  }
  const onBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const note = noteFromElement(e.target as Element)
    if (note !== null) lifecycle?.noteOff(`focus:${note}`)
  }

  return (
    <>
      <div className="keybed-back" style={{ left: u(KEYS_LEFT_U - 1), width: u(KEYS_RIGHT_U - KEYS_LEFT_U + 2) }} />
      <div
        className="keybed"
        role="group"
        aria-label={`Keybed, ${KEY_COUNT} keys, ${noteName(LOW_NOTE)} to ${noteName(HIGH_NOTE)}`}
        data-key-count={KEY_COUNT}
        data-testid="keybed"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={onBlur}
        onContextMenu={(e) => e.preventDefault()}
      >
        {KEYS.filter((k) => !k.isBlack).map((k) => (
          <KeyView key={k.note} note={k.note} name={k.name} x={k.x} w={k.w} black={false} down={pressed.has(k.note)} tab={k.note === focusNote} />
        ))}
        {KEYS.filter((k) => k.isBlack).map((k) => (
          <KeyView key={k.note} note={k.note} name={k.name} x={k.x} w={k.w} black down={pressed.has(k.note)} tab={k.note === focusNote} />
        ))}
      </div>
    </>
  )
}

function KeyView({ note, name, x, w, black, down, tab }: { note: number; name: string; x: number; w: number; black: boolean; down: boolean; tab: boolean }) {
  return (
    <div
      role="button"
      tabIndex={tab ? 0 : -1}
      aria-label={name}
      aria-pressed={down}
      data-note={note}
      data-key={black ? 'black' : 'white'}
      data-pressed={down ? 'true' : 'false'}
      className={`key key--${black ? 'black' : 'white'}${down ? ' is-down' : ''}`}
      style={{ left: u(x), width: u(w), height: black ? `${BLACK_KEY_HEIGHT_FRACTION * 100}%` : '100%' }}
    />
  )
}

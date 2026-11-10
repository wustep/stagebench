import {
  memo,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import { KEYBED_HEIGHT, VARIANT } from '../hardware/geometry'
import { KEYBED_MODEL, type KeyDef } from '../hardware/keys'
import type { NoteLifecycle } from '../input/noteLifecycle'

interface KeybedProps {
  lifecycle: NoteLifecycle
  /** Called on every gesture that should wake the audio engine. */
  onGesture: () => void
}

const FOCUS_SOURCE = 'focus'
const FOCUS_VELOCITY = 0.72
const DEFAULT_POINTER_VELOCITY = 0.7

function noteOf(target: EventTarget | null): number | null {
  const element = (target as Element | null)?.closest?.('[data-note]')
  if (!element) return null
  const note = Number(element.getAttribute('data-note'))
  return Number.isFinite(note) ? note : null
}

/**
 * Where a key is struck sets how hard: near the front edge is loud, near the back is soft.
 * Deterministic, works for mouse, pen, and touch alike.
 */
export function velocityFromStrike(clientY: number, rect: { top: number; height: number }): number {
  if (!(rect.height > 0)) return DEFAULT_POINTER_VELOCITY
  const along = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
  return 0.3 + 0.65 * along
}

/** The 73-key keybed. Every pointer is tracked on its own, so chords and slides work on touch. */
export function Keybed({ lifecycle, onGesture }: KeybedProps) {
  const pointers = useRef(new Map<number, number>())
  const [tabStop, setTabStop] = useState(60)

  const strike = (pointerId: number, note: number, clientY: number, target: Element | null) => {
    const keyElement = target?.closest?.('[data-note]') ?? null
    const velocity = keyElement
      ? velocityFromStrike(clientY, keyElement.getBoundingClientRect())
      : DEFAULT_POINTER_VELOCITY
    pointers.current.set(pointerId, note)
    lifecycle.press(`pointer:${pointerId}`, note, velocity)
  }

  const letGo = useCallback(
    (pointerId: number) => {
      const note = pointers.current.get(pointerId)
      if (note === undefined) return
      pointers.current.delete(pointerId)
      lifecycle.release(`pointer:${pointerId}`, note)
    },
    [lifecycle],
  )

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const note = noteOf(event.target)
    if (note === null) return
    onGesture()
    // Capture on the keybed so a slide across keys keeps reporting to us.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Capture can fail for synthetic pointers; per-key events still arrive.
    }
    strike(event.pointerId, note, event.clientY, event.target as Element)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = pointers.current.get(event.pointerId)
    if (current === undefined) return
    const doc = event.currentTarget.ownerDocument
    const under = typeof doc.elementFromPoint === 'function' ? doc.elementFromPoint(event.clientX, event.clientY) : null
    const note = noteOf(under)
    if (note === null || note === current) return
    // Glissando: leave the old key, strike the new one.
    letGo(event.pointerId)
    strike(event.pointerId, note, event.clientY, under)
  }

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    // Some browsers only unlock audio on the lift of the first touch, so that counts as a gesture too.
    if (pointers.current.has(event.pointerId)) onGesture()
    letGo(event.pointerId)
  }

  // Keep keyboard focus where it is when playing with a mouse; Tab still reaches the keys.
  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => event.preventDefault()

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const note = noteOf(event.target)
    if (note === null) return
    const move = (next: number) => {
      const clamped = Math.min(VARIANT.keyboard.highNote, Math.max(VARIANT.keyboard.lowNote, next))
      event.preventDefault()
      lifecycle.releaseSource(FOCUS_SOURCE)
      setTabStop(clamped)
      event.currentTarget.querySelector<HTMLElement>(`[data-note="${clamped}"]`)?.focus()
    }
    switch (event.key) {
      case 'ArrowRight':
        return move(note + 1)
      case 'ArrowLeft':
        return move(note - 1)
      case 'PageUp':
        return move(note + 12)
      case 'PageDown':
        return move(note - 12)
      case 'Home':
        return move(VARIANT.keyboard.lowNote)
      case 'End':
        return move(VARIANT.keyboard.highNote)
      case ' ':
      case 'Enter':
        event.preventDefault()
        if (event.repeat) return
        onGesture()
        lifecycle.press(`${FOCUS_SOURCE}:${note}`, note, FOCUS_VELOCITY)
        return
    }
  }

  const onKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    const note = noteOf(event.target)
    if (note !== null) lifecycle.release(`${FOCUS_SOURCE}:${note}`, note)
  }

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const note = noteOf(event.target)
    if (note !== null) setTabStop(note)
  }
  const onBlur = () => lifecycle.releaseSource(FOCUS_SOURCE)

  return (
    <div
      id="keybed"
      className="keybed"
      role="group"
      // Focusable only as the target of the "Skip to keybed" link; Tab then lands on a key.
      tabIndex={-1}
      aria-label={`Keybed, ${VARIANT.keyboard.totalKeys} keys, E1 to E7`}
      data-region="keybed"
      data-key-count={KEYBED_MODEL.keys.length}
      style={{ height: KEYBED_HEIGHT }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <span className="keybed__shadow" aria-hidden="true" />
      {KEYBED_MODEL.keys.map((key) => (
        <Key key={key.id} def={key} lifecycle={lifecycle} tabbable={key.note === tabStop} />
      ))}
      <span className="keybed__rail" aria-hidden="true" />
    </div>
  )
}

const Key = memo(function Key({
  def,
  lifecycle,
  tabbable,
}: {
  def: KeyDef
  lifecycle: NoteLifecycle
  tabbable: boolean
}) {
  const down = useSyncExternalStore(
    lifecycle.subscribe,
    () => lifecycle.isHeld(def.note),
    () => lifecycle.isHeld(def.note),
  )
  return (
    <button
      type="button"
      id={def.id}
      className={`key key--${def.color}${down ? ' is-down' : ''}`}
      style={{ left: def.x, width: def.width, height: def.length }}
      aria-label={def.spokenName}
      aria-pressed={down}
      tabIndex={tabbable ? 0 : -1}
      data-note={def.note}
      data-note-name={def.name}
      data-key-color={def.color}
    />
  )
})

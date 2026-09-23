import { memo, useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { DESIGN_WIDTH, KEYBED_HEIGHT, KEYBED_TOP } from '../model/geometry'
import { HIGHEST_NOTE, KEYS, LOWEST_NOTE, keyAt, velocityFromPosition, type KeyDef } from '../model/keys'

export interface KeybedProps {
  held: readonly number[]
  noteOn: (note: number, velocity: number, source: string) => void
  noteOff: (note: number, source: string) => void
}

const A11Y_SOURCE = 'a11y:key'
const A11Y_VELOCITY = 100
const WHITE = KEYS.filter((k) => !k.isBlack)
const BLACK = KEYS.filter((k) => k.isBlack)

const Key = memo(function Key({ def, down, focusable, onKeyDown, onKeyUp, onBlur }: {
  def: KeyDef
  down: boolean
  focusable: boolean
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>, note: number) => void
  onKeyUp: (e: KeyboardEvent<HTMLDivElement>, note: number) => void
  onBlur: (note: number) => void
}) {
  return (
    <div
      id={def.id}
      role="button"
      tabIndex={focusable ? 0 : -1}
      className={`key ${def.isBlack ? 'key-black' : 'key-white'}${down ? ' is-down' : ''}`}
      data-note={def.midi}
      aria-label={`${def.name} key`}
      aria-pressed={down}
      style={{ left: def.x, top: def.y - KEYBED_TOP, width: def.w, height: def.h }}
      onKeyDown={(e) => onKeyDown(e, def.midi)}
      onKeyUp={(e) => onKeyUp(e, def.midi)}
      onBlur={() => onBlur(def.midi)}
    />
  )
})

/**
 * The 73-key keybed. Pointer and touch use one source per pointerId (independent multi-touch,
 * glissando by sliding); the focused key plays with Space/Enter; arrows move focus.
 */
export const Keybed = memo(function Keybed({ held, noteOn, noteOff }: KeybedProps) {
  const ref = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { note: number; velocity: number }>())
  const a11yNote = useRef<number | null>(null)
  const [focusNote, setFocusNote] = useState(60)
  const heldSet = new Set(held)

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const keyEl = (e.target as Element).closest<HTMLElement>('[data-note]')
      if (!keyEl) return
      const note = Number(keyEl.dataset.note)
      const rect = keyEl.getBoundingClientRect()
      const fraction = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.75
      const velocity = velocityFromPosition(fraction, e.pointerType === 'pen' ? e.pressure : undefined)
      e.preventDefault()
      try {
        ref.current?.setPointerCapture(e.pointerId)
      } catch {
        // Synthetic pointers cannot be captured; release still arrives via pointerup.
      }
      const prev = pointers.current.get(e.pointerId)
      if (prev) noteOff(prev.note, `pointer:${e.pointerId}`)
      pointers.current.set(e.pointerId, { note, velocity })
      noteOn(note, velocity, `pointer:${e.pointerId}`)
    },
    [noteOn, noteOff],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const p = pointers.current.get(e.pointerId)
      const el = ref.current
      if (!p || !el) return
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return
      const scale = rect.width / DESIGN_WIDTH
      const key = keyAt((e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale + KEYBED_TOP)
      if (!key || key.midi === p.note) return
      const source = `pointer:${e.pointerId}`
      noteOff(p.note, source)
      p.note = key.midi
      noteOn(key.midi, p.velocity, source)
    },
    [noteOn, noteOff],
  )

  const onPointerEnd = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const p = pointers.current.get(e.pointerId)
      if (!p) return
      pointers.current.delete(e.pointerId)
      noteOff(p.note, `pointer:${e.pointerId}`)
    },
    [noteOff],
  )

  const releaseA11y = useCallback(() => {
    if (a11yNote.current !== null) {
      noteOff(a11yNote.current, A11Y_SOURCE)
      a11yNote.current = null
    }
  }, [noteOff])

  const moveFocus = useCallback(
    (note: number) => {
      const target = Math.min(HIGHEST_NOTE, Math.max(LOWEST_NOTE, note))
      releaseA11y()
      setFocusNote(target)
      const def = KEYS.find((k) => k.midi === target)
      if (def) document.getElementById(def.id)?.focus()
    },
    [releaseA11y],
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>, note: number) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (e.repeat || a11yNote.current === note) return
        releaseA11y()
        a11yNote.current = note
        noteOn(note, A11Y_VELOCITY, A11Y_SOURCE)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        moveFocus(note + (e.key === 'ArrowRight' ? 1 : -1))
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault()
        moveFocus(e.key === 'Home' ? LOWEST_NOTE : HIGHEST_NOTE)
      }
    },
    [noteOn, moveFocus, releaseA11y],
  )

  const onKeyUp = useCallback(
    (e: KeyboardEvent<HTMLDivElement>, note: number) => {
      if ((e.key === ' ' || e.key === 'Enter') && a11yNote.current === note) releaseA11y()
    },
    [releaseA11y],
  )

  const onKeyBlur = useCallback(
    (note: number) => {
      if (a11yNote.current === note) releaseA11y()
    },
    [releaseA11y],
  )

  const render = (k: KeyDef) => (
    <Key key={k.id} def={k} down={heldSet.has(k.midi)} focusable={k.midi === focusNote} onKeyDown={onKeyDown} onKeyUp={onKeyUp} onBlur={onKeyBlur} />
  )

  return (
    <div
      ref={ref}
      className="keybed"
      role="group"
      aria-label="Keybed: 73 hammer-action keys, E1 to E7. Arrow keys move, Space or Enter plays."
      data-key-count={KEYS.length}
      style={{ top: KEYBED_TOP, height: KEYBED_HEIGHT, width: DESIGN_WIDTH }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
    >
      <span className="key-slot" aria-hidden="true" />
      {WHITE.map(render)}
      {BLACK.map(render)}
      <span className="bottom-rail" aria-hidden="true" />
    </div>
  )
})

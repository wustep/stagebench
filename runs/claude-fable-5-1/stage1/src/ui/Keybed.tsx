import { useCallback, useEffect, useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { KEYBED, STAGE_4_73, type KeySpec } from '../hardware/keybed'
import { useServices } from './context'

function keyFromTarget(target: EventTarget | null): KeySpec | null {
  const el = (target as Element | null)?.closest?.('[data-midi]') as HTMLElement | null
  if (!el) return null
  const midi = Number(el.dataset.midi)
  return KEYBED.find((k) => k.midi === midi) ?? null
}

function velocityFromEvent(e: ReactPointerEvent<HTMLElement> | PointerEvent, target: Element | null): number {
  const rect = target?.getBoundingClientRect?.()
  if (!rect || !rect.height) return 100
  const frac = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
  return Math.round(48 + 79 * frac)
}

/** The 73-key hammer-action keybed. Pointer/touch/keyboard presses all feed the shared NoteBus. */
export function Keybed() {
  const { bus } = useServices()
  const state = useSyncExternalStore(bus.subscribe, bus.getState, bus.getState)
  const pointers = useRef(new Map<number, number>())
  const pointerCounts = useRef(new Map<number, number>())
  const uiHeld = useRef(new Set<number>())

  const pointerOn = useCallback(
    (pointerId: number, midi: number, velocity: number) => {
      pointers.current.set(pointerId, midi)
      pointerCounts.current.set(midi, (pointerCounts.current.get(midi) ?? 0) + 1)
      bus.noteOn(midi, velocity, 'pointer')
    },
    [bus],
  )
  const pointerOff = useCallback(
    (pointerId: number) => {
      const midi = pointers.current.get(pointerId)
      if (midi === undefined) return
      pointers.current.delete(pointerId)
      const count = (pointerCounts.current.get(midi) ?? 1) - 1
      if (count <= 0) {
        pointerCounts.current.delete(midi)
        bus.noteOff(midi, 'pointer')
      } else pointerCounts.current.set(midi, count)
    },
    [bus],
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const key = keyFromTarget(e.target)
    if (!key) return
    e.preventDefault()
    // Release the implicit touch capture so glissando across keys receives pointerover events.
    const el = e.target as Element & { releasePointerCapture?: (id: number) => void; hasPointerCapture?: (id: number) => boolean }
    try {
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture?.(e.pointerId)
    } catch {
      /* ignore */
    }
    pointerOn(e.pointerId, key.midi, velocityFromEvent(e, el))
  }
  const onPointerOver = (e: ReactPointerEvent<HTMLDivElement>) => {
    const current = pointers.current.get(e.pointerId)
    if (current === undefined) return
    const key = keyFromTarget(e.target)
    if (!key || key.midi === current) return
    pointerOff(e.pointerId)
    pointerOn(e.pointerId, key.midi, velocityFromEvent(e, e.target as Element))
  }
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => pointerOff(e.pointerId)

  useEffect(() => {
    // The maps themselves are stable for the component's lifetime; capture them for the cleanup.
    const activePointers = pointers.current
    const heldByKeyboard = uiHeld.current
    const end = (e: PointerEvent) => pointerOff(e.pointerId)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      for (const id of Array.from(activePointers.keys())) pointerOff(id)
      for (const midi of Array.from(heldByKeyboard)) bus.noteOff(midi, 'ui')
      heldByKeyboard.clear()
    }
  }, [bus, pointerOff])

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()
    if (e.repeat) return
    const key = keyFromTarget(e.currentTarget)
    if (!key || uiHeld.current.has(key.midi)) return
    uiHeld.current.add(key.midi)
    bus.noteOn(key.midi, 100, 'ui')
  }
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    const key = keyFromTarget(e.currentTarget)
    if (!key || !uiHeld.current.has(key.midi)) return
    uiHeld.current.delete(key.midi)
    bus.noteOff(key.midi, 'ui')
  }
  const onBlur = (e: React.FocusEvent<HTMLButtonElement>) => {
    const key = keyFromTarget(e.currentTarget)
    if (!key || !uiHeld.current.has(key.midi)) return
    uiHeld.current.delete(key.midi)
    bus.noteOff(key.midi, 'ui')
  }

  return (
    <div
      className="keys"
      id="keys"
      role="group"
      aria-label={`Keybed: ${STAGE_4_73.totalKeys} keys, ${KEYBED[0].name} to ${KEYBED[KEYBED.length - 1].name}, ${STAGE_4_73.keyAction}`}
      data-key-count={STAGE_4_73.totalKeys}
      onPointerDown={onPointerDown}
      onPointerOver={onPointerOver}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {KEYBED.map((key) => {
        const down = state.held.has(key.midi)
        return (
          <button
            key={key.id}
            id={key.id}
            type="button"
            className={`key key-${key.color}${down ? ' is-down' : ''}`}
            style={{ left: `${key.x}%`, width: `${key.w}%`, height: `${key.h}%` }}
            aria-label={`Key ${key.name}`}
            aria-pressed={down}
            data-midi={key.midi}
            data-note={key.name}
            data-color={key.color}
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            onBlur={onBlur}
          />
        )
      })}
    </div>
  )
}

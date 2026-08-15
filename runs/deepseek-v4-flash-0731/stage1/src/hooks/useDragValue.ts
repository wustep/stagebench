import { useCallback, useEffect, useRef } from 'react'

export interface DragValueOptions {
  value: number
  onChange(value: number): void
  /** transform a raw delta (pixels) into a value change in 0..1. */
  sensitivity?: number
  /** vertical drag only (knobs, faders, drawbars, wheels, sticks). */
  axis?: 'y'
  /** keyboard arrows move value by this step. */
  step?: number
  /** when set, keyboard toggles between 0 and 1 (buttons). */
  keyToggle?: boolean
  disabled?: boolean
}

/**
 * Pointer + keyboard interaction for a continuous presentation control.
 * Pointer: vertical drag (with pointer capture across the whole control) maps
 * to a 0..1 value. Keyboard: Up/Down (Right/Left) adjust by `step`, Home/End
 * jump. The change is purely presentation state in the hardware store.
 */
export function useDragValue(options: DragValueOptions) {
  const { value, onChange, sensitivity = 0.004, step = 0.1, disabled = false } = options
  const dragRef = useRef<{ pointerId: number; lastY: number } | null>(null)

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return
      event.preventDefault()
      const el = event.currentTarget as HTMLElement & { setPointerCapture?: (id: number) => void }
      if (el.setPointerCapture) el.setPointerCapture(event.pointerId)
      dragRef.current = { pointerId: event.pointerId, lastY: event.clientY }
    },
    [disabled],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      const dy = event.clientY - drag.lastY
      drag.lastY = event.clientY
      // dragging up increases value (y decreases)
      onChange(Math.max(0, Math.min(1, value - dy * sensitivity)))
    },
    [onChange, sensitivity, value],
  )

  const endDrag = useCallback((_event?: React.PointerEvent) => {
    dragRef.current = null
  }, [])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (disabled) return
      if (options.keyToggle) {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          onChange(value > 0.5 ? 0 : 1)
        }
        return
      }
      const mapping: Record<string, number> = {
        ArrowUp: step,
        ArrowRight: step,
        ArrowDown: -step,
        ArrowLeft: -step,
        Home: 1,
        End: 0,
        PageUp: step * 5,
        PageDown: -step * 5,
      }
      const delta = mapping[event.key]
      if (delta === undefined) return
      event.preventDefault()
      onChange(Math.max(0, Math.min(1, value + delta)))
    },
    [disabled, onChange, options.keyToggle, step, value],
  )

  useEffect(() => {
    return () => {
      dragRef.current = null
    }
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onKeyDown }
}
import { useRef, type PointerEvent as ReactPointerEvent } from 'react'

export interface DragOptions {
  axis: 'x' | 'y'
  /** Pixels of travel that span the full range. */
  travelPx: number
  min: number
  max: number
  getValue(): number
  setValue(v: number): void
  onRelease?(): void
  /** Endless controls: pixels per unit instead of full-range travel. */
  unitsPerPx?: number
}

/**
 * Pointer drag → value. Uses pointer capture so drags keep working outside the element and so
 * several fingers can drag several controls at once.
 */
export function useDrag(options: DragOptions) {
  const state = useRef<{ id: number; start: number; startValue: number } | null>(null)
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    state.current = { id: e.pointerId, start: options.axis === 'y' ? e.clientY : e.clientX, startValue: options.getValue() }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = state.current
    if (!s || s.id !== e.pointerId) return
    const pos = options.axis === 'y' ? e.clientY : e.clientX
    const delta = options.axis === 'y' ? s.start - pos : pos - s.start
    const units = options.unitsPerPx !== undefined ? delta * options.unitsPerPx : (delta / options.travelPx) * (options.max - options.min)
    options.setValue(s.startValue + units)
  }
  const end = (e: ReactPointerEvent<HTMLElement>) => {
    const s = state.current
    if (!s || s.id !== e.pointerId) return
    state.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    options.onRelease?.()
  }
  return { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end }
}

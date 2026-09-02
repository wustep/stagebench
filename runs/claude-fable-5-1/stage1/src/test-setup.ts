import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => cleanup())

// jsdom lacks pointer capture and (in some versions) PointerEvent; the components only need no-ops.
const proto = globalThis.Element?.prototype as (Element & Record<string, unknown>) | undefined
if (proto) {
  if (typeof proto.setPointerCapture !== 'function') proto.setPointerCapture = () => {}
  if (typeof proto.releasePointerCapture !== 'function') proto.releasePointerCapture = () => {}
  if (typeof proto.hasPointerCapture !== 'function') proto.hasPointerCapture = () => false
}
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    pointerType: string
    pressure: number
    isPrimary: boolean
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? 'mouse'
      this.pressure = init.pressure ?? 0
      this.isPrimary = init.isPrimary ?? true
    }
  }
  ;(globalThis as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill
}

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => cleanup())

// jsdom does not implement the Pointer Events API; the app only needs the
// constructor plus capture no-ops for deterministic unit tests. Real pointer
// behavior is additionally verified in a real Chromium browser pass.
if (typeof window !== 'undefined') {
  if (!('PointerEvent' in window)) {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number
      pointerType: string
      constructor(type: string, params: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
        super(type, params)
        this.pointerId = params.pointerId ?? 0
        this.pointerType = params.pointerType ?? 'mouse'
      }
    }
    Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill })
  }
  const proto = window.Element.prototype as Element & {
    setPointerCapture?: (id: number) => void
    releasePointerCapture?: (id: number) => void
    hasPointerCapture?: (id: number) => boolean
  }
  proto.setPointerCapture ??= () => {}
  proto.releasePointerCapture ??= () => {}
  proto.hasPointerCapture ??= () => false
}

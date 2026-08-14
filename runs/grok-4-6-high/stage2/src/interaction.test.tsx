import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { INTERACTIVE_CONTROLS } from './model/controls'

function renderStage() {
  return render(<App deps={{ autoMidi: false }} />)
}

describe('interaction.keys', () => {
  it('presses, releases, and cancels pointer notes independently', () => {
    renderStage()
    const e3 = screen.getByLabelText('E3')
    const f3 = screen.getByLabelText('F3')
    fireEvent.pointerDown(e3, { pointerId: 1, button: 0, clientY: 20 })
    fireEvent.pointerDown(f3, { pointerId: 2, button: 0, clientY: 20 })
    expect(e3).toHaveAttribute('aria-pressed', 'true')
    expect(f3).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerUp(e3, { pointerId: 1 })
    expect(e3).toHaveAttribute('aria-pressed', 'false')
    expect(f3).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerCancel(f3, { pointerId: 2 })
    expect(f3).toHaveAttribute('aria-pressed', 'false')
  })

  it('maps computer keys, suppresses repeat, and clears on blur', () => {
    renderStage()
    const c3 = screen.getByLabelText('C3')
    fireEvent.keyDown(window, { code: 'KeyZ', key: 'z', repeat: false })
    expect(c3).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { code: 'KeyZ', key: 'z', repeat: true })
    expect(c3).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(window, { code: 'KeyZ', key: 'z' })
    expect(c3).toHaveAttribute('aria-pressed', 'false')
    fireEvent.keyDown(window, { code: 'KeyZ', key: 'z', repeat: false })
    fireEvent.blur(window)
    fireEvent(window, new Event('pagehide'))
    expect(c3).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('interaction.decorative-controls', () => {
  it('moves every visible panel control without requiring audio side effects', () => {
    renderStage()
    const skipped = new Set(['program-oled', 'synth-oled'])
    for (const control of INTERACTIVE_CONTROLS) {
      if (skipped.has(control.id)) continue
      const node = document.getElementById(control.id)
      expect(node, control.id).toBeTruthy()
      if (control.kind === 'button') {
        const pressed = node!.getAttribute('aria-pressed') === 'true'
        fireEvent.click(node!)
        expect(node).toHaveAttribute('aria-pressed', pressed ? 'false' : 'true')
      } else {
        fireEvent.keyDown(node!, { key: 'ArrowUp' })
        const now = Number(node!.getAttribute('aria-valuenow'))
        expect(Number.isFinite(now)).toBe(true)
        if (control.defaultValue < control.max) expect(now).toBeGreaterThan(control.defaultValue)
      }
    }
  })
})

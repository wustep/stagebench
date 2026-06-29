import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ButtonControl, KnobControl } from './Controls'

describe('panel buttons and LEDs', () => {
  it('toggles the intended LED and announces the display state', () => {
    render(<ButtonControl id="piano-enable" label="Piano A" initial={false} />)
    const button = screen.getByRole('button', { name: 'Piano A' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('piano-enable-led')).toHaveAttribute('data-lit', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('piano-enable-led')).toHaveAttribute('data-lit', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Piano A on')
  })
})

describe('rotary controls', () => {
  it('supports accessible keyboard input, clamps values, and reflects rotation', () => {
    render(<KnobControl id="master-level" label="Master level" initial={50} />)
    const knob = screen.getByRole('slider', { name: 'Master level' })
    knob.focus()
    fireEvent.keyDown(knob, { key: 'ArrowUp' })
    expect(knob).toHaveAttribute('aria-valuenow', '55')
    fireEvent.keyDown(knob, { key: 'End' })
    fireEvent.keyDown(knob, { key: 'ArrowUp' })
    expect(knob).toHaveAttribute('aria-valuenow', '100')
    expect(knob).toHaveStyle({ '--turn': '135deg' })
  })

  it('changes from vertical pointer movement', () => {
    render(<KnobControl id="drive" label="Drive" initial={40} />)
    const knob = screen.getByRole('slider', { name: 'Drive' })
    fireEvent.pointerDown(knob, { clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(knob, { clientY: 80, pointerId: 1 })
    fireEvent.pointerUp(knob, { pointerId: 1 })
    expect(Number(knob.getAttribute('aria-valuenow'))).toBeGreaterThan(40)
  })
})

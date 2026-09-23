import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'

describe('interaction.decorative-controls', () => {
  it('moves knobs, drawbars, faders, and the spring-loaded pitch stick without starting audio', () => {
    renderApp()
    const status = screen.getByTestId('engine-status')
    expect(status).toHaveAttribute('data-status', 'idle')

    const master = screen.getByRole('slider', { name: 'Master Level' })
    const before = Number(master.getAttribute('aria-valuenow'))
    fireEvent.keyDown(master, { key: 'ArrowUp' })
    expect(Number(master.getAttribute('aria-valuenow'))).toBeGreaterThan(before)
    fireEvent.keyDown(master, { key: 'Home' })
    expect(master).toHaveAttribute('aria-valuenow', '0')
    fireEvent.keyDown(master, { key: 'End' })
    expect(master).toHaveAttribute('aria-valuenow', '127')

    const drawbar = screen.getByRole('slider', { name: 'Drawbar 2 (5⅓′)' })
    expect(drawbar).toHaveAttribute('aria-valuemin', '0')
    expect(drawbar).toHaveAttribute('aria-valuemax', '8')
    fireEvent.pointerDown(drawbar, { pointerId: 4, clientY: 10 })
    fireEvent.pointerMove(drawbar, { pointerId: 4, clientY: 80 })
    fireEvent.pointerUp(drawbar, { pointerId: 4, clientY: 80 })
    expect(Number(drawbar.getAttribute('aria-valuenow'))).toBeGreaterThan(0)

    const fader = screen.getByRole('slider', { name: 'Organ Layer A Level' })
    fireEvent.keyDown(fader, { key: 'PageDown' })
    expect(Number(fader.getAttribute('aria-valuenow'))).toBeLessThan(100)

    const wheel = screen.getByRole('slider', { name: 'Mod Wheel' })
    fireEvent.pointerDown(wheel, { pointerId: 8, clientY: 100 })
    fireEvent.pointerMove(wheel, { pointerId: 8, clientY: 60, shiftKey: true })
    const shifted = Number(wheel.getAttribute('aria-valuenow'))
    expect(shifted).toBeGreaterThan(0)
    expect(shifted).toBeLessThan(20)

    const stick = screen.getByRole('slider', { name: 'Pitch Stick' })
    fireEvent.pointerDown(stick, { pointerId: 9, clientX: 40, clientY: 40 })
    fireEvent.pointerMove(stick, { pointerId: 9, clientX: 90, clientY: 40 })
    expect(Number(stick.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
    fireEvent.pointerUp(stick, { pointerId: 9, clientX: 90, clientY: 40 })
    expect(stick).toHaveAttribute('aria-valuenow', '0')

    const organ = screen.getByRole('button', { name: 'Organ Section On' })
    fireEvent.click(organ)
    expect(organ).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(organ)
    expect(organ).toHaveAttribute('aria-pressed', 'false')

    expect(status).toHaveAttribute('data-status', 'idle')
    expect(status).toHaveAttribute('data-voices', '0')
    expect(status).toHaveTextContent(/decorative|tap a key|IDLE/i)
  })

  it('cycles selector LEDs as presentation only', () => {
    renderApp()
    const type = screen.getByRole('button', { name: 'Piano Type Select' })
    expect(type).toHaveAttribute('data-cycle', '0')
    fireEvent.click(type)
    expect(type).toHaveAttribute('data-cycle', '1')
    expect(screen.getByTestId('engine-status')).toHaveAttribute('data-status', 'idle')
  })
})

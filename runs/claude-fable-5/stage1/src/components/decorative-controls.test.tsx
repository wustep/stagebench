import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HARDWARE_CONTROLS } from '../model/hardware'
import { renderApp } from '../test/renderApp'

function controlElement(id: string): HTMLElement {
  return document.querySelector(`[data-control-id="${id}"]`) as HTMLElement
}

describe('interaction.decorative-controls — movement without side effects', () => {
  it('knobs respond to keyboard arrows and expose the new value', () => {
    renderApp()
    const knob = screen.getByRole('slider', { name: 'Master Level' })
    const before = Number(knob.getAttribute('aria-valuenow'))
    fireEvent.keyDown(knob, { key: 'ArrowUp' })
    const after = Number(knob.getAttribute('aria-valuenow'))
    expect(after).toBeGreaterThan(before)
    fireEvent.keyDown(knob, { key: 'Home' })
    expect(knob).toHaveAttribute('aria-valuenow', '0')
    fireEvent.keyDown(knob, { key: 'End' })
    expect(knob).toHaveAttribute('aria-valuenow', '127')
  })

  it('knobs respond to pointer drag', () => {
    renderApp()
    const knob = screen.getByRole('slider', { name: 'Mod 1 Rate' })
    const before = Number(knob.getAttribute('aria-valuenow'))
    fireEvent.pointerDown(knob, { pointerId: 5, clientY: 100 })
    fireEvent.pointerMove(knob, { pointerId: 5, clientY: 40 })
    fireEvent.pointerUp(knob, { pointerId: 5, clientY: 40 })
    expect(Number(knob.getAttribute('aria-valuenow'))).toBeGreaterThan(before)
  })

  it('drawbars travel between 0 and 8', () => {
    renderApp()
    const drawbar = screen.getByRole('slider', { name: 'Drawbar 1 (16′)' })
    expect(drawbar).toHaveAttribute('aria-valuemin', '0')
    expect(drawbar).toHaveAttribute('aria-valuemax', '8')
    fireEvent.keyDown(drawbar, { key: 'End' })
    expect(drawbar).toHaveAttribute('aria-valuenow', '8')
    fireEvent.keyDown(drawbar, { key: 'ArrowDown' })
    expect(drawbar).toHaveAttribute('aria-valuenow', '7')
  })

  it('dragging a drawbar downward pulls it out (value increases)', () => {
    renderApp()
    const drawbar = screen.getByRole('slider', { name: 'Drawbar 2 (5⅓′)' })
    expect(drawbar).toHaveAttribute('aria-valuenow', '0')
    fireEvent.pointerDown(drawbar, { pointerId: 4, clientY: 10 })
    fireEvent.pointerMove(drawbar, { pointerId: 4, clientY: 100 })
    fireEvent.pointerUp(drawbar, { pointerId: 4, clientY: 100 })
    expect(Number(drawbar.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
  })

  it('faders and the mod wheel move; the pitch stick springs back on release', () => {
    renderApp()
    const fader = screen.getByRole('slider', { name: 'Organ Layer A Level' })
    fireEvent.keyDown(fader, { key: 'PageDown' })
    expect(Number(fader.getAttribute('aria-valuenow'))).toBeLessThan(100)

    const wheel = screen.getByRole('slider', { name: 'Mod Wheel' })
    fireEvent.keyDown(wheel, { key: 'ArrowUp' })
    expect(Number(wheel.getAttribute('aria-valuenow'))).toBeGreaterThan(0)

    const stick = screen.getByRole('slider', { name: 'Pitch Stick' })
    fireEvent.pointerDown(stick, { pointerId: 9, clientY: 50 })
    fireEvent.pointerMove(stick, { pointerId: 9, clientY: 10 })
    expect(Number(stick.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
    fireEvent.pointerUp(stick, { pointerId: 9, clientY: 10 })
    expect(stick).toHaveAttribute('aria-valuenow', '0')
  })

  it('latching buttons toggle their pressed state and light', () => {
    renderApp()
    const button = screen.getByRole('button', { name: 'Mod 1 On' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button.dataset.lit).toBe('true')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  it('every rendered panel control is marked decorative', () => {
    renderApp()
    for (const control of HARDWARE_CONTROLS) {
      expect(controlElement(control.id).dataset.decorative, control.id).toBe('true')
    }
  })

  it('operating panel controls never creates audio or voices (decorative honesty)', () => {
    const { getContext } = renderApp()
    const panic = screen.getByRole('button', { name: 'Panic' })
    fireEvent.click(panic)
    const masterKnob = screen.getByRole('slider', { name: 'Master Level' })
    fireEvent.keyDown(masterKnob, { key: 'ArrowUp' })
    const drawbar = screen.getByRole('slider', { name: 'Drawbar 3 (8′)' })
    fireEvent.keyDown(drawbar, { key: 'End' })
    fireEvent.click(screen.getByRole('button', { name: 'Organ Section On' }))
    fireEvent.click(screen.getByRole('button', { name: 'Store' }))
    fireEvent.click(screen.getByRole('button', { name: 'Live Mode' }))

    // No AudioContext may even have been created by panel interaction.
    expect(getContext()).toBeNull()
  })

  it('panel controls do not silence or alter playing keybed voices', () => {
    const { getContext } = renderApp()
    fireEvent.pointerDown(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
    const context = getContext()!
    const oscCount = context.oscillators().length
    const masterGainValue = context.nodes.find((n) => n.kind === 'gain')

    fireEvent.click(screen.getByRole('button', { name: 'Panic' }))
    fireEvent.click(screen.getByRole('button', { name: 'Piano Section On' }))
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Master Level' }), { key: 'Home' })

    expect(context.oscillators().length).toBe(oscCount)
    expect(context.oscillators().some((o) => o.stopped)).toBe(false)
    expect(context.nodes.find((n) => n.kind === 'gain')).toBe(masterGainValue)
    fireEvent.pointerUp(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
  })

  it('the OLED content does not react to decorative program controls', () => {
    renderApp()
    const oled = screen.getByTestId('oled-program')
    const before = oled.textContent
    fireEvent.click(screen.getByRole('button', { name: 'Program 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Store' }))
    const dial = screen.getByRole('slider', { name: 'Program Dial' })
    fireEvent.keyDown(dial, { key: 'ArrowUp' })
    expect(oled.textContent).toBe(before)
  })
})

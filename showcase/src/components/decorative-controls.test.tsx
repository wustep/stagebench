import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HARDWARE_CONTROLS } from '../model/hardware'
import { renderApp } from '../test/renderApp'

function controlElement(id: string): HTMLElement {
  return document.querySelector(`[data-control-id="${id}"]`) as HTMLElement
}

describe('interaction.decorative-controls — truthful movement and side-effect split', () => {
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

    // The pitch stick moves SIDE TO SIDE like the hardware: right = bend up.
    const stick = screen.getByRole('slider', { name: 'Pitch Stick' })
    fireEvent.pointerDown(stick, { pointerId: 9, clientX: 50, clientY: 50 })
    fireEvent.pointerMove(stick, { pointerId: 9, clientX: 90, clientY: 50 })
    expect(Number(stick.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
    fireEvent.pointerUp(stick, { pointerId: 9, clientX: 90, clientY: 50 })
    expect(stick).toHaveAttribute('aria-valuenow', '0')
  })

  it('Shift-drag makes fine (quarter-gain) adjustments at the 200px full-range resolution', () => {
    renderApp()
    const wheel = screen.getByRole('slider', { name: 'Mod Wheel' })
    expect(wheel).toHaveAttribute('aria-valuenow', '0')
    // 40px of the 200px full-range travel at 0.25 shift gain: 40/200 * 127 * 0.25 ≈ 6.
    fireEvent.pointerDown(wheel, { pointerId: 8, clientY: 100 })
    fireEvent.pointerMove(wheel, { pointerId: 8, clientY: 60, shiftKey: true })
    expect(wheel).toHaveAttribute('aria-valuenow', '6')
    fireEvent.pointerUp(wheel, { pointerId: 8, clientY: 60 })
    // Same 40px without Shift: full gain, 6 + 40/200 * 127 ≈ 31.
    fireEvent.pointerDown(wheel, { pointerId: 8, clientY: 100 })
    fireEvent.pointerMove(wheel, { pointerId: 8, clientY: 60 })
    expect(wheel).toHaveAttribute('aria-valuenow', '31')
    fireEvent.pointerUp(wheel, { pointerId: 8, clientY: 60 })
  })

  it('continuous controls step with the scroll wheel; Shift steps single units', () => {
    renderApp()
    const knob = screen.getByRole('slider', { name: 'Master Level' })
    const start = Number(knob.getAttribute('aria-valuenow'))
    fireEvent.wheel(knob, { deltaY: -120 }) // up = increase, step = round(127/64) = 2
    expect(Number(knob.getAttribute('aria-valuenow'))).toBe(start + 2)
    fireEvent.wheel(knob, { deltaY: -120, shiftKey: true }) // fine: single unit
    expect(Number(knob.getAttribute('aria-valuenow'))).toBe(start + 3)
    fireEvent.wheel(knob, { deltaY: 120 })
    expect(Number(knob.getAttribute('aria-valuenow'))).toBe(start + 1)

    // The spring-loaded pitch stick deliberately ignores the wheel: a wheel
    // tick has no release gesture to spring back from.
    const stick = screen.getByRole('slider', { name: 'Pitch Stick' })
    fireEvent.wheel(stick, { deltaY: -120 })
    expect(stick).toHaveAttribute('aria-valuenow', '0')
  })

  it('holding Enter on a section ON button performs SOLO; a quick key tap still toggles', () => {
    renderApp()
    vi.useFakeTimers()
    try {
      const organOn = screen.getByRole('button', { name: 'Organ Section On' })
      const pianoOn = screen.getByRole('button', { name: 'Piano Section On' })
      expect(pianoOn).toHaveAttribute('aria-pressed', 'true')
      expect(organOn).toHaveAttribute('aria-pressed', 'false')

      // Hold for HOLD_MS: SOLO Organ (manual p. 18) — the other sections turn
      // off and the release does NOT toggle the button back off.
      fireEvent.keyDown(organOn, { key: 'Enter' })
      act(() => vi.advanceTimersByTime(500))
      fireEvent.keyUp(organOn, { key: 'Enter' })
      expect(organOn).toHaveAttribute('aria-pressed', 'true')
      expect(pianoOn).toHaveAttribute('aria-pressed', 'false')

      // Quick Space tap: a plain toggle, no solo (organ stays on).
      fireEvent.keyDown(pianoOn, { key: ' ' })
      fireEvent.keyUp(pianoOn, { key: ' ' })
      expect(pianoOn).toHaveAttribute('aria-pressed', 'true')
      expect(organOn).toHaveAttribute('aria-pressed', 'true')
    } finally {
      vi.useRealTimers()
    }
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

  it('marks each rendered control truthfully as decorative or functional', () => {
    renderApp()
    for (const control of HARDWARE_CONTROLS) {
      expect(controlElement(control.id).dataset.decorative, control.id).toBe(control.decorative ? 'true' : 'false')
    }
  })

  it('operating DECORATIVE panel controls never creates audio or voices (honesty)', () => {
    const { getContext } = renderApp()
    const drawbar = screen.getByRole('slider', { name: 'Drawbar 3 (8′)' })
    fireEvent.keyDown(drawbar, { key: 'End' })
    fireEvent.click(screen.getByRole('button', { name: 'Organ Section On' }))
    fireEvent.click(screen.getByRole('button', { name: 'Store' }))
    fireEvent.click(screen.getByRole('button', { name: 'Live Mode' }))
    // Synth Mode Select is now FUNCTIONAL (spec.scope.optional Samples mode)
    // — see the "functional panel controls" test below for its canonical
    // effect. Preset Library Synth stays decorative (spec exclusion: "Synth
    // preset library... downloads").
    fireEvent.click(screen.getByRole('button', { name: 'Preset Library Synth' }))
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Mod Wheel' }), { key: 'ArrowUp' })

    // No AudioContext may even have been created by decorative interaction.
    expect(getContext()).toBeNull()
  })

  it('functional panel controls write canonical state without starting audio prematurely', () => {
    const { getContext } = renderApp()
    // Functional controls update canonical state, but audio still starts
    // lazily on the first note gesture — turning knobs creates no context.
    const masterKnob = screen.getByRole('slider', { name: 'Master Level' })
    fireEvent.keyDown(masterKnob, { key: 'ArrowDown' })
    expect(Number(masterKnob.getAttribute('aria-valuenow'))).toBeLessThan(100)
    expect(getContext()).toBeNull()
  })

  it('Synth Mode Select is functional: it cycles the focused layer\'s canonical Analog/Samples mode', () => {
    const { getContext } = renderApp()
    const modeButton = screen.getByRole('button', { name: 'Synth Mode Select' })
    expect(modeButton.dataset.decorative).toBe('false')
    // Canonical effect visible through the OLED's mode-dependent readout
    // (spec.scope.optional Samples mode) rather than through internal store
    // access — clicking it swaps the WAVE name list from the Analog
    // waveform list to the SYNTH_SAMPLE_SETS names.
    const before = screen.getByTestId('oled-synth-name-line').textContent
    fireEvent.click(modeButton)
    const after = screen.getByTestId('oled-synth-name-line').textContent
    expect(after).not.toBe(before)
    fireEvent.click(modeButton) // back to Analog
    expect(screen.getByTestId('oled-synth-name-line').textContent).toBe(before)
    // Still no audio started by pressing a panel button on its own.
    expect(getContext()).toBeNull()
  })

  it('Other-section panel controls do not silence or alter playing Piano keybed voices', () => {
    const { getContext } = renderApp()
    fireEvent.pointerDown(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
    const context = getContext()!
    const sourceCount = context.bufferSources().length
    expect(sourceCount).toBeGreaterThan(0)

    // Organ, Store and Synth Layer A are all functional now, but none of
    // them touch the Piano section's already-sounding buffer sources.
    fireEvent.click(screen.getByRole('button', { name: 'Organ Section On' }))
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Drawbar 3 (8′)' }), { key: 'End' })
    fireEvent.click(screen.getByRole('button', { name: 'Store' }))
    fireEvent.click(screen.getByRole('button', { name: 'Synth Layer A On/Off' }))

    expect(context.bufferSources().length).toBe(sourceCount)
    expect(context.bufferSources().some((s) => s.stopped)).toBe(false)
    fireEvent.pointerUp(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
  })

  it('the functional Panic button DOES stop playing voices (Phase 2 behavior)', () => {
    const { getContext } = renderApp()
    fireEvent.pointerDown(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
    const context = getContext()!
    expect(context.bufferSources().some((s) => s.stopped)).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Panic' }))
    expect(context.bufferSources().every((s) => s.stopped)).toBe(true)
    fireEvent.pointerUp(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
  })

  it('the OLED content does not react to decorative program controls', () => {
    // Program buttons, Store, the dial and Prog View (display view modes,
    // manual p. 42) belong to the functional Programs cluster now — the
    // still-decorative controls are the morph-A.T./preset/menu scope.
    // Section Edit is functional only through its LAYER INIT Shift pairing
    // (manual p. 43); its plain press stays truthfully inert.
    renderApp()
    const oled = screen.getByTestId('oled-program')
    const before = oled.textContent
    fireEvent.click(screen.getByRole('button', { name: 'Morph Assign Aftertouch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Preset Library Piano' }))
    fireEvent.click(screen.getByRole('button', { name: 'Section Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Monitor/Copy Paste' }))
    expect(oled.textContent).toBe(before)
  })
})

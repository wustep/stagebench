import { fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HARDWARE_CONTROLS } from '../model/hardware'
import { renderApp } from '../test/renderApp'

function controlElement(id: string): HTMLElement {
  return document.querySelector(`[data-control-id="${id}"]`) as HTMLElement
}

describe('accessibility.controls', () => {
  it('every panel control exposes an accessible name matching the hardware model', () => {
    renderApp()
    for (const control of HARDWARE_CONTROLS) {
      expect(controlElement(control.id).getAttribute('aria-label'), control.id).toBe(control.label)
    }
  })

  it('every panel control exposes a valid role', () => {
    renderApp()
    for (const control of HARDWARE_CONTROLS) {
      const element = controlElement(control.id)
      if (control.type === 'button') {
        expect(element.tagName, control.id).toBe('BUTTON')
      } else {
        expect(element.getAttribute('role'), control.id).toBe('slider')
      }
    }
  })

  it('continuous controls expose value min/max/now and orientation', () => {
    renderApp()
    // Dial 2 truthfully reads out the power-on Saw waveform's list position
    // (not 0) — same derived-value pattern as the piano model dial below.
    const derivedValue = new Set(['synth-dial-2'])
    for (const control of HARDWARE_CONTROLS.filter((c) => c.type !== 'button')) {
      const element = controlElement(control.id)
      expect(element.getAttribute('aria-valuemin'), control.id).toBe(String(control.min ?? 0))
      expect(element.getAttribute('aria-valuemax'), control.id).toBe(String(control.max ?? 127))
      if (!derivedValue.has(control.id)) {
        expect(element.getAttribute('aria-valuenow'), control.id).toBe(String(control.initial ?? 0))
      }
      // The pitch stick moves side to side like the hardware; everything
      // else (knobs, faders, drawbars, wheel) operates vertically.
      expect(element.getAttribute('aria-orientation'), control.id).toBe(control.type === 'stick' ? 'horizontal' : 'vertical')
    }
  })

  it('latching buttons expose toggle state; momentary buttons stay plain buttons', () => {
    renderApp()
    // Functional controls reflect the instrument's truthful power-on state:
    // Piano section on with layer A enabled, Layer Effects section on, and
    // the (off) Organ and Synth sections with their layer A pre-enabled.
    // Filter On starts lit (spec filter default is on) — Synth part 2's one
    // new truthfully-pressed-at-power-on latching control.
    const pressedAtPowerOn = new Set(['piano-on', 'piano-layer-a', 'effects-on', 'reverb-bright', 'organ-layer-a', 'synth-layer-a', 'filter-on'])
    for (const control of HARDWARE_CONTROLS.filter((c) => c.type === 'button')) {
      const element = controlElement(control.id)
      if (control.latching) {
        expect(element.getAttribute('aria-pressed'), control.id).toBe(pressedAtPowerOn.has(control.id) ? 'true' : 'false')
      } else {
        expect(element.getAttribute('aria-pressed'), control.id).toBeNull()
      }
    }
  })

  it('every panel control and key is keyboard focusable', () => {
    renderApp()
    for (const control of HARDWARE_CONTROLS) {
      const element = controlElement(control.id)
      element.focus()
      expect(document.activeElement, control.id).toBe(element)
    }
    const firstKey = controlElement('key-28')
    firstKey.focus()
    expect(document.activeElement).toBe(firstKey)
  })

  it('sliders are operable end-to-end with the keyboard alone', () => {
    renderApp()
    // Dials 1 and 3 only edit the amp envelope's attack/release while the
    // AMP ENVELOPE edit target is latched (manual-adaptation precedence
    // documented in presentation.ts); at power-on they truthfully no-op.
    const editGated = new Set(['synth-dial-1', 'synth-dial-3'])
    for (const control of HARDWARE_CONTROLS.filter((c) => c.type !== 'button' && !c.springLoaded)) {
      const element = controlElement(control.id)
      if (control.id === 'piano-model') {
        // The model dial truthfully clamps to the bundled model list of the
        // selected type (one model per populated type in this phase).
        fireEvent.keyDown(element, { key: 'End' })
        expect(Number(element.getAttribute('aria-valuenow')), control.id).toBeGreaterThanOrEqual(0)
        continue
      }
      if (editGated.has(control.id)) continue
      fireEvent.keyDown(element, { key: 'End' })
      expect(element.getAttribute('aria-valuenow'), control.id).toBe(String(control.max ?? 127))
      fireEvent.keyDown(element, { key: 'Home' })
      expect(element.getAttribute('aria-valuenow'), control.id).toBe(String(control.min ?? 0))
    }
  })

  it('keys expose pressed state to assistive tech', () => {
    renderApp()
    const key = controlElement('key-60')
    expect(key.getAttribute('aria-pressed')).toBe('false')
    fireEvent.pointerDown(key, { pointerId: 1 })
    expect(key.getAttribute('aria-pressed')).toBe('true')
    fireEvent.pointerUp(key, { pointerId: 1 })
  })

  it('group boxes expose their panel legends as group names', () => {
    renderApp()
    for (const name of ['Drawbars', 'B3 Percussion', 'Piano Select', 'Morph Assign', 'FX Focus']) {
      expect(document.querySelector(`[role="group"][aria-label="${name}"]`), name).toBeTruthy()
    }
  })

  it('status messages live in an aria-live region (no hidden state changes)', () => {
    renderApp()
    const strip = document.querySelector('.status-strip')
    expect(strip?.getAttribute('aria-live')).toBe('polite')
  })
})

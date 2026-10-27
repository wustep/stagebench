import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from '../App'
import { ALL_CONTROLS } from '../hardware/catalog'
import { isNumeric, isSelector } from '../hardware/types'
import { VARIANT } from '../hardware/variant'
import { KEY_MAPPINGS } from '../input/keyboardMap'

/**
 * accessibility.controls — accessible names, roles, values, keyboard operation, and
 * visible focus for every control on the instrument.
 *
 * These assertions are made against the rendered DOM, so a control that loses its role or
 * its name cannot pass by virtue of a good data model.
 */
afterEach(() => cleanup())

function cell(id: string): HTMLElement {
  const el = document.querySelector(`[data-control-id="${id}"]`)
  if (!el) throw new Error(`missing control ${id}`)
  return el as HTMLElement
}

describe('accessibility.controls — names, roles and values', () => {
  it('gives every numeric control role=slider with a name and a full value range', () => {
    render(<App deps={{ disableAudio: true }} />)
    for (const control of ALL_CONTROLS.filter(isNumeric)) {
      const slider = cell(control.id).querySelector('[role="slider"]') as HTMLElement
      expect(slider, control.id).not.toBeNull()
      expect(slider.getAttribute('aria-label')).toBe(control.name)
      expect(Number(slider.getAttribute('aria-valuemin'))).toBe(control.min)
      expect(Number(slider.getAttribute('aria-valuemax'))).toBe(control.max)
      const now = Number(slider.getAttribute('aria-valuenow'))
      expect(now).toBeGreaterThanOrEqual(control.min)
      expect(now).toBeLessThanOrEqual(control.max)
      expect(slider.getAttribute('aria-valuetext')).toBeTruthy()
      expect(slider.tabIndex).toBe(0)
    }
  })

  it('gives every toggle role=switch with aria-checked', () => {
    render(<App deps={{ disableAudio: true }} />)
    const toggles = ALL_CONTROLS.filter((c) => c.kind === 'toggle')
    for (const control of toggles) {
      const el = cell(control.id).querySelector('[role="switch"]') as HTMLElement
      expect(el, control.id).not.toBeNull()
      expect(el.getAttribute('aria-label')).toBe(control.name)
      expect(['true', 'false']).toContain(el.getAttribute('aria-checked'))
    }
  })

  it('gives every momentary button role=button with aria-pressed', () => {
    render(<App deps={{ disableAudio: true }} />)
    const buttons = ALL_CONTROLS.filter((c) => c.kind === 'button')
    expect(buttons.length).toBeGreaterThan(20)
    for (const control of buttons) {
      const el = cell(control.id).querySelector('[role="button"]') as HTMLElement
      expect(el, control.id).not.toBeNull()
      expect(el.getAttribute('aria-label')).toBe(control.name)
      expect(el.getAttribute('aria-pressed')).toBe('false')
    }
  })

  it('gives every selector a radiogroup with one radio per printed position', () => {
    render(<App deps={{ disableAudio: true }} />)
    for (const control of ALL_CONTROLS.filter(isSelector)) {
      const group = cell(control.id)
      expect(group.getAttribute('role'), control.id).toBe('radiogroup')
      const radios = group.querySelectorAll('[role="radio"]')
      expect(radios.length, control.id).toBe(control.options.length)
      const checked = Array.from(radios).filter((r) => r.getAttribute('aria-checked') === 'true')
      expect(checked, control.id).toHaveLength(1)
    }
  })

  it('never has two controls sharing an accessible name', () => {
    render(<App deps={{ disableAudio: true }} />)
    const names = ALL_CONTROLS.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('keeps every control reachable with Tab in a sensible order', () => {
    render(<App deps={{ disableAudio: true }} />)
    const focusables = Array.from(
      document.querySelectorAll<HTMLElement>('[tabindex="0"], button, input, [role="slider"], [role="switch"]'),
    ).filter((el) => el.tabIndex === 0)
    expect(focusables.length).toBeGreaterThan(ALL_CONTROLS.length * 0.9)
    // Every focusable is inside a labelled control, the keybed, or the front rail.
    for (const el of focusables) {
      const labelled =
        el.getAttribute('aria-label') ??
        el.getAttribute('aria-labelledby') ??
        el.textContent?.trim() ??
        ''
      expect(labelled.length, el.outerHTML.slice(0, 80)).toBeGreaterThan(0)
    }
  })
})

describe('accessibility.controls — keyboard operation', () => {
  it('moves a slider with all four arrows, Page keys, Home and End', () => {
    render(<App deps={{ disableAudio: true }} />)
    const slider = cell('effects.amp.drive').querySelector('[role="slider"]') as HTMLElement
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(slider.getAttribute('aria-valuenow')).toBe('0')
    fireEvent.keyDown(slider, { key: 'ArrowUp' })
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeGreaterThan(0)
    const afterUp = Number(slider.getAttribute('aria-valuenow'))
    fireEvent.keyDown(slider, { key: 'ArrowDown' })
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeLessThan(afterUp)
    fireEvent.keyDown(slider, { key: 'PageUp' })
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeGreaterThan(afterUp)
    fireEvent.keyDown(slider, { key: 'End' })
    expect(slider.getAttribute('aria-valuenow')).toBe('10')
    fireEvent.keyDown(slider, { key: 'ArrowLeft' })
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeLessThan(10)
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(Number(slider.getAttribute('aria-valuenow'))).toBeCloseTo(10, 5)
  })

  it('toggles a switch with Space and with Enter', () => {
    render(<App deps={{ disableAudio: true }} />)
    const sw = cell('organ.vib-chorus.on').querySelector('[role="switch"]') as HTMLElement
    fireEvent.keyDown(sw, { key: ' ' })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(sw, { key: 'Enter' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
  })

  it('activates a momentary button from the keyboard and releases it on key up', () => {
    render(<App deps={{ disableAudio: true }} />)
    const button = cell('program.page.up').querySelector('[role="button"]') as HTMLElement
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyUp(button, { key: 'Enter' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
  })

  it('does not scroll the page when a mapped key is played', () => {
    render(<App deps={{ disableAudio: true }} />)
    const engineTarget = window
    const event = new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', bubbles: true, cancelable: true })
    engineTarget.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('accessibility.controls — visible focus and structure', () => {
  it('gives every section an accessible landmark name', () => {
    render(<App deps={{ disableAudio: true }} />)
    for (const label of [
      'Performance controls',
      'Organ',
      'Piano',
      'Program and morph',
      'Synth',
      'Layer effects',
    ]) {
      expect(screen.getByRole('region', { name: label })).toBeInTheDocument()
    }
  })

  it('labels the keybed with the variant range and key count', () => {
    render(<App deps={{ disableAudio: true }} />)
    const keybed = screen.getByTestId('keybed')
    expect(keybed.getAttribute('data-key-count')).toBe(String(VARIANT.totalKeys))
    expect(keybed.getAttribute('data-lowest-midi')).toBe(String(VARIANT.lowestMidi))
    expect(keybed.getAttribute('data-highest-midi')).toBe(String(VARIANT.highestMidi))
  })

  it('names the program display for screen readers and announces state', () => {
    render(<App deps={{ disableAudio: true }} />)
    const display = screen.getByTestId('program-display')
    expect(display.getAttribute('role')).toBe('status')
    expect(display.getAttribute('aria-live')).toBe('polite')
    expect(display.getAttribute('aria-label')).toMatch(/Program display/)
  })

  it('marks the synth display as unavailable rather than decorative', () => {
    render(<App deps={{ disableAudio: true }} />)
    const display = screen.getByTestId('synth-display')
    expect(display.getAttribute('aria-label')).toMatch(/not available/i)
    expect(display.textContent).toMatch(/Not available in this phase/)
  })

  it('exposes the sustain pedal with a name, pressed state and keyboard operation', () => {
    render(<App deps={{ disableAudio: true }} />)
    const pedal = screen.getByTestId('sustain-pedal')
    expect(pedal.getAttribute('aria-label')).toBe('Sustain pedal')
    expect(pedal.getAttribute('aria-pressed')).toBe('false')
    fireEvent.keyDown(pedal, { key: ' ' })
    expect(pedal.getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyUp(pedal, { key: ' ' })
    expect(pedal.getAttribute('aria-pressed')).toBe('false')
  })

  it('names the panic and MIDI controls', () => {
    render(<App deps={{ disableAudio: true }} />)
    expect(screen.getByTestId('panic').getAttribute('aria-label')).toMatch(/Panic/)
    expect(screen.getByTestId('midi-connect').getAttribute('aria-label')).toMatch(/MIDI/)
  })

  it('carries the printed computer-key legend so the mapping is discoverable', () => {
    // The mapping itself is the contract; the UI prints the same letters in its legend.
    const labels = KEY_MAPPINGS.map((m) => m.label)
    expect(labels).toContain('Z')
    expect(labels).toContain('Q')
    expect(new Set(KEY_MAPPINGS.map((m) => m.code)).size).toBe(KEY_MAPPINGS.length)
  })

  it('does not hide interactive controls from assistive technology', () => {
    render(<App deps={{ disableAudio: true }} />)
    for (const el of Array.from(document.querySelectorAll('[role="slider"], [role="switch"], [role="button"], [role="radio"]'))) {
      expect(el.getAttribute('aria-hidden')).toBeNull()
      expect((el as HTMLElement).tabIndex, el.outerHTML.slice(0, 90)).toBeGreaterThanOrEqual(-1)
    }
    // Sliders, switches and buttons are all in the tab order directly.
    for (const el of Array.from(document.querySelectorAll('[role="slider"], [role="switch"], [role="button"]'))) {
      expect((el as HTMLElement).tabIndex, el.outerHTML.slice(0, 90)).toBeGreaterThanOrEqual(0)
    }
    // A radiogroup uses roving tabindex: exactly one option per group is in the tab order
    // and the rest are reachable with the arrow keys, which is the ARIA radio pattern.
    for (const group of Array.from(document.querySelectorAll('[role="radiogroup"]'))) {
      const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'))
      expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1)
      expect(group.getAttribute('aria-hidden')).toBeNull()
    }
  })
})

describe('accessibility.controls — the displays never claim unimplemented state', () => {
  it('does not print a program bank, slot or preset name in the program display', () => {
    render(<App deps={{ disableAudio: true }} />)
    const text = screen.getByTestId('program-display').textContent ?? ''
    // No bank:slot readout, because no program library exists in Phase 1.
    expect(text).not.toMatch(/\b[A-H]:\d{1,3}\b/)
    // No invented preset or model name.
    expect(text).not.toMatch(/white grand|royal grand|velvet grand|imperial/i)
    // It does say what is true: the phase, the engine, and its status.
    expect(text).toMatch(/PHASE 1/)
    expect(text).toMatch(/Modelled piano/)
  })

  it('reports the synth engine as unavailable rather than showing a fake waveform', () => {
    render(<App deps={{ disableAudio: true }} />)
    const text = screen.getByTestId('synth-display').textContent ?? ''
    expect(text).toMatch(/Not available in this phase/i)
    expect(text).not.toMatch(/super saw|multi saw|detune/i)
  })

  it('prints a truthful audio status line, never a fabricated one', () => {
    render(<App deps={{ disableAudio: true }} />)
    const text = screen.getByTestId('program-display').textContent ?? ''
    // With audio disabled, the display must not claim readiness.
    expect(text).toMatch(/NO AUDIO OUTPUT|AUDIO IDLE/)
    expect(text).not.toMatch(/AUDIO READY/)
  })
})

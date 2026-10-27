import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from '../App'
import { createRecordingEngine } from '../audio/fakes'
import { PIANO_CONTROL_IDS, EFFECT_CONTROL_IDS, isFunctionalControl } from '../audio/panelBindings'

/**
 * The Phase 2 panel bindings, exercised through the real App.
 *
 * These cases exist because a browser pass found two defects that no unit test had caught:
 * `App` created its own presentation store, so every functional control looked connected
 * while its edits went nowhere; and the effect focus buttons were momentary, so they never
 * changed the focused layer. Both are structural, so they are asserted structurally here.
 */

afterEach(() => cleanup())

function cell(id: string): HTMLElement {
  const el = document.querySelector(`[data-control-id="${id}"]`)
  if (!el) throw new Error(`missing control ${id}`)
  return el as HTMLElement
}

function modelLine(): string {
  return screen.getByTestId('piano-model-line').textContent ?? ''
}

function fxFocus(): string {
  return document.querySelector('[data-testid="fx-focus-line"]')?.textContent ?? ''
}

function activeUnits(): string {
  return document.querySelector('[data-testid="fx-active-line"]')?.textContent ?? ''
}

describe('panel bindings — one store, real state', () => {
  it('writes a functional control into instrument state, not just the panel', () => {
    render(<App deps={{ disableAudio: true }} />)
    // The Type selector is functional: choosing UPRIGHT must change the display's model line.
    expect(modelLine()).toMatch(/GRAND · Salamander Grand/)
    const upright = cell('piano.type').querySelectorAll('[role="radio"]')[1]
    fireEvent.click(upright)
    expect(modelLine()).toMatch(/UPRIGHT · Ivy Upright/)
    // And it is reflected back into the panel's own selected radio.
    expect(upright.getAttribute('aria-checked')).toBe('true')
  })

  it('keeps an unmodified functional control and the panel in agreement', () => {
    render(<App deps={{ disableAudio: true }} />)
    // The catalog's printed default must equal the instrument's state, or the first note
    // would use something the panel is not showing.
    const timbre = cell('piano.timbre')
    const checked = Array.from(timbre.querySelectorAll('[role="radio"]')).findIndex(
      (r) => r.getAttribute('aria-checked') === 'true',
    )
    expect(checked).toBe(1)
    // Layer A reads 80 because its fader prints 80.
    const fader = cell('piano.layer.a.level').querySelector('[role="slider"]')
    expect(fader?.getAttribute('aria-valuenow')).toBe('80')
  })

  it('drives an effect control into the active-unit readout', () => {
    render(<App deps={{ disableAudio: true }} />)
    expect(activeUnits()).toBe('FX OFF')
    fireEvent.click(cell('effects.reverb.on').querySelector('[role="switch"]')!)
    expect(activeUnits()).toBe('REV')
    fireEvent.click(cell('effects.comp.on').querySelector('[role="switch"]')!)
    expect(activeUnits()).toBe('CMP REV')
    // Turning one off removes only that unit.
    fireEvent.click(cell('effects.reverb.on').querySelector('[role="switch"]')!)
    expect(activeUnits()).toBe('CMP')
  })

  it('treats the effect focus buttons as a radio pair that retargets the edits', () => {
    render(<App deps={{ disableAudio: true }} />)
    expect(fxFocus()).toBe('FX PIANO A')
    // Focus B, then engage Reverb: B has it, A does not.
    fireEvent.click(cell('effects.focus.piano-b').querySelector('[role="switch"]')!)
    expect(fxFocus()).toBe('FX PIANO B')
    expect(cell('effects.focus.piano-a').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
    expect(cell('effects.focus.piano-b').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(cell('effects.reverb.on').querySelector('[role="switch"]')!)
    expect(activeUnits()).toBe('REV')
    // Back to A: A's chain is untouched, so no unit is active there.
    fireEvent.click(cell('effects.focus.piano-a').querySelector('[role="switch"]')!)
    expect(fxFocus()).toBe('FX PIANO A')
    expect(activeUnits()).toBe('FX OFF')
    // And the pair is mutually exclusive the other way too.
    expect(cell('effects.focus.piano-a').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
    expect(cell('effects.focus.piano-b').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('focuses the effects for a layer when that layer is switched on', () => {
    render(<App deps={{ disableAudio: true }} />)
    expect(fxFocus()).toBe('FX PIANO A')
    fireEvent.click(cell('piano.layer.b.on').querySelector('[role="switch"]')!)
    // Pressing a layer button focuses that layer's effects, as the manual describes.
    expect(fxFocus()).toBe('FX PIANO B')
    expect(cell('effects.focus.piano-b').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
  })

  it('reports a modelled type as modelled and a recorded type as recorded', () => {
    render(<App deps={{ disableAudio: true }} />)
    const radios = cell('piano.type').querySelectorAll('[role="radio"]')
    fireEvent.click(radios[2]) // ELECTRIC
    expect(modelLine()).toContain('(recorded)')
    fireEvent.click(radios[3]) // CLAV
    expect(modelLine()).toMatch(/Clav/)
    expect(modelLine()).toContain('modelled')
    // It never claims a recording for a synthesised type.
    expect(modelLine()).not.toContain('(recorded)')
  })

  it('never claims the library is ready while audio is unavailable', () => {
    render(<App deps={{ disableAudio: true }} />)
    const display = screen.getByTestId('program-display').textContent ?? ''
    // With no engine there is no library: the display says so rather than printing a
    // loaded-sample count it cannot have measured.
    expect(display).toMatch(/PIANO NOT FOUND|MODELLED/)
    expect(display).not.toMatch(/SAMPLES READY/)
  })

  it('keeps every non-functional control presentation-only even with a live engine', () => {
    // The decorative contract, re-checked now that a functional sink exists: operating an
    // Organ, Synth or Program control must not start audio.
    const engine = createRecordingEngine()
    render(<App deps={{ engine }} />)
    const decorative = [
      'organ.drawbar.16',
      'organ.model.select',
      'synth.filter.freq',
      'synth.lfo.rate',
      'program.dial',
      'program.store',
      'program.split',
      'performance.pitch-stick',
    ]
    for (const id of decorative) {
      expect(isFunctionalControl(id), id).toBe(false)
      const slider = cell(id).querySelector('[role="slider"]')
      const sw = cell(id).querySelector('[role="switch"], [role="button"]')
      const radio = cell(id).querySelectorAll('[role="radio"]')[1] ?? cell(id).querySelector('[role="radio"]')
      if (slider) fireEvent.keyDown(slider, { key: 'End' })
      else if (radio) fireEvent.click(radio)
      else if (sw) fireEvent.click(sw)
    }
    expect(engine.startedVoices).toHaveLength(0)
    expect(engine.started).toBe(0)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('declares exactly the controls this phase claims, and nothing more', () => {
    // A guard against silently functionalising a control that the scope says must stay
    // decorative: the functional set is explicit and its size is asserted elsewhere.
    const total = PIANO_CONTROL_IDS.size + EFFECT_CONTROL_IDS.size
    // Piano section, master level, the rotary block and the effects band; a small minority
    // of the 167 controls, and an explicit list rather than a default.
    expect(total).toBe(51)
    expect(PIANO_CONTROL_IDS.size).toBe(18)
    expect(EFFECT_CONTROL_IDS.size).toBe(33)
    for (const id of [...PIANO_CONTROL_IDS, ...EFFECT_CONTROL_IDS]) {
      expect(document.querySelector(`[data-control-id="${id}"]`), id).toBeNull()
    }
    // The two sets are disjoint, so a control cannot be claimed twice.
    for (const id of PIANO_CONTROL_IDS) expect(EFFECT_CONTROL_IDS.has(id)).toBe(false)
  })
})

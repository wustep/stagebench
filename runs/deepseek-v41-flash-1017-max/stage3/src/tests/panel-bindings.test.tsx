import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from '../App'
import { createMemoryStorage } from '../audio/programStore'
import { createRecordingEngine } from '../audio/fakes'
import {
  PIANO_CONTROL_IDS,
  EFFECT_CONTROL_IDS,
  ORGAN_CONTROL_IDS,
  SYNTH_CONTROL_IDS,
  PROGRAM_CONTROL_IDS,
  UNSUPPORTED_CONTROLS,
  auditControls,
  isFunctionalControl,
} from '../audio/panelBindings'

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
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    // The Type selector is functional: choosing UPRIGHT must change the display's model line.
    expect(modelLine()).toMatch(/GRAND · Salamander Grand/)
    const upright = cell('piano.type').querySelectorAll('[role="radio"]')[1]
    fireEvent.click(upright)
    expect(modelLine()).toMatch(/UPRIGHT · Ivy Upright/)
    // And it is reflected back into the panel's own selected radio.
    expect(upright.getAttribute('aria-checked')).toBe('true')
  })

  it('keeps an unmodified functional control and the panel in agreement', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
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
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
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
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
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
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    expect(fxFocus()).toBe('FX PIANO A')
    fireEvent.click(cell('piano.layer.b.on').querySelector('[role="switch"]')!)
    // Pressing a layer button focuses that layer's effects, as the manual describes.
    expect(fxFocus()).toBe('FX PIANO B')
    expect(cell('effects.focus.piano-b').querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
  })

  it('reports a modelled type as modelled and a recorded type as recorded', () => {
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
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
    render(<App deps={{ disableAudio: true, programStorage: createMemoryStorage() }} />)
    const display = screen.getByTestId('program-display').textContent ?? ''
    // With no engine there is no library: the display says so rather than printing a
    // loaded-sample count it cannot have measured.
    expect(display).toMatch(/PIANO NOT FOUND|MODELLED/)
    expect(display).not.toMatch(/SAMPLES READY/)
  })

  it('keeps every spec-excluded control presentation-only even with a live engine', () => {
    // The decorative contract, re-checked now that the whole surface is bound: operating a
    // control the specs exclude must not start audio and must not change any engine state.
    const engine = createRecordingEngine()
    render(<App deps={{ engine, programStorage: createMemoryStorage() }} />)
    const decorative = [
      'program.preset.organ',
      'program.preset.piano',
      'program.preset.synth',
      'program.morph.at',
      'organ.preset',
      'organ.sync',
      'organ.aux-kb.a',
      'synth.mode',
      'synth.arp.pattern',
      'effects.mod1.variation',
      'effects.reverb.variation',
      'piano.info',
      'piano.ped-noise',
      'performance.monitor-head',
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
    // decorative: the functional set is explicit, and every control is either bound or
    // declared unsupported with a spec reference.
    const audit = auditControls()
    expect(audit.unaccounted).toEqual([])
    expect(audit.phantomBindings).toEqual([])
    // The five groups are disjoint, so no control is claimed by two sections.
    const groups = [
      PIANO_CONTROL_IDS,
      EFFECT_CONTROL_IDS,
      ORGAN_CONTROL_IDS,
      SYNTH_CONTROL_IDS,
      PROGRAM_CONTROL_IDS,
    ]
    const seen = new Set<string>()
    for (const group of groups) {
      for (const id of group) {
        expect(seen.has(id), `${id} is claimed twice`).toBe(false)
        seen.add(id)
      }
    }
    expect(seen.size).toBe(audit.bound)
    // Every unsupported control names its spec and a real reason.
    for (const entry of UNSUPPORTED_CONTROLS) {
      expect(entry.spec.length, entry.id).toBeGreaterThan(10)
      expect(entry.reason.length, entry.id).toBeGreaterThan(20)
      expect(isFunctionalControl(entry.id), entry.id).toBe(false)
    }
  })
})

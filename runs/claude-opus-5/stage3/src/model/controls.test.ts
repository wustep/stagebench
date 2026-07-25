import { describe, expect, it } from 'vitest'
import {
  CONTROLS,
  DRAWBARS,
  UNSUPPORTED_CONTROL_IDS,
  control,
  controlValueText,
  controlsInSection,
} from './controls'
import { SECTION_LAYOUT } from './layout'
import { activatedValue, clampToSpec, initialHardwareValues, nudgeValue } from '../state/hardware'

/** Feature: visual.control-inventory */
describe('control inventory', () => {
  it('gives every control a unique, stable, namespaced id', () => {
    const ids = CONTROLS.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(\.[a-z0-9-]+)+$/)
  })

  it('gives every control a non-empty accessible name', () => {
    for (const entry of CONTROLS) {
      expect(entry.name.trim().length).toBeGreaterThan(0)
    }
    expect(new Set(CONTROLS.map((entry) => entry.name)).size).toBe(CONTROLS.length)
  })

  it('declares exactly the spec-excluded controls decorative and everything else functional', () => {
    // Phase 3 truth, replacing the Phase 2 assertion that Organ/Synth/Program were decorative in
    // their entirety: those sections now have engines. The invariant is unchanged — the
    // `functional` flag and the declared list agree in both directions, for every control.
    const decorative = CONTROLS.filter((entry) => !entry.functional).map((entry) => entry.id).sort()
    expect(decorative).toEqual([...UNSUPPORTED_CONTROL_IDS.keys()].sort())

    // Every decorative control names the spec clause that excludes it.
    for (const [id, reason] of UNSUPPORTED_CONTROL_IDS) {
      expect(control(id).functional, `${id} must stay decorative`).toBe(false)
      expect(reason).toMatch(/spec, scope\.(excluded|optional)/)
    }

    // Everything the phase promises to make audible really is marked functional.
    for (const id of [
      'perf.master-level',
      'perf.rotary.source',
      'perf.rotary.stop-mode',
      'perf.mod-wheel',
      'perf.pitch-stick',
      'piano.type',
      'piano.a.level',
      'piano.kb-touch',
      'organ.model',
      'organ.drawbar.1',
      'organ.perc.on',
      'organ.vibchorus.type',
      'synth.osc.category',
      'synth.filter.freq',
      'synth.arp.mode',
      'program.dial',
      'program.store',
      'program.split',
      'program.layer-scene',
      'program.morph.wheel',
      'fx.mod1.on',
      'fx.focus.organ',
      'fx.focus.synth',
      'fx.reverb.type',
      'fx.section-on',
    ]) {
      expect(control(id).functional, `${id} must be functional`).toBe(true)
    }
  })

  it('covers all six sections with reference-appropriate density', () => {
    for (const section of SECTION_LAYOUT) {
      expect(controlsInSection(section.id).length).toBeGreaterThan(4)
    }
    // The reference deck is dense: well over a hundred physical inputs.
    expect(CONTROLS.length).toBeGreaterThanOrEqual(120)
  })

  it('has exactly nine organ drawbars with the printed footages', () => {
    expect(DRAWBARS).toHaveLength(9)
    expect(DRAWBARS.map((bar) => bar.footage)).toEqual([
      "16'",
      "5 1/3'",
      "8'",
      "4'",
      "2 2/3'",
      "2'",
      "1 3/5'",
      "1 1/3'",
      "1'",
    ])
    const drawbars = CONTROLS.filter((entry) => entry.kind === 'drawbar')
    expect(drawbars).toHaveLength(9)
    for (const bar of drawbars) {
      expect(bar.min).toBe(0)
      expect(bar.max).toBe(8)
    }
  })

  it('models the landmark controls each section requires', () => {
    const ids = new Set(CONTROLS.map((entry) => entry.id))
    for (const id of [
      'perf.master-level',
      'perf.pitch-stick',
      'perf.mod-wheel',
      'organ.model',
      'organ.perc.on',
      'organ.vibchorus.on',
      'piano.type',
      'piano.model',
      'piano.a.level',
      'program.dial',
      'program.store',
      'program.split',
      'program.slot.8',
      'program.morph.wheel',
      'synth.filter.freq',
      'synth.lfo.rate',
      'synth.arp.mode',
      'synth.osc.waveform',
      'fx.mod1.on',
      'fx.mod2.on',
      'fx.amp.on',
      'fx.delay.on',
      'fx.comp.on',
      'fx.reverb.on',
      'fx.focus.piano',
    ]) {
      expect(ids.has(id), `missing control ${id}`).toBe(true)
    }
  })

  it('has one fader per layer in every layered section', () => {
    expect(CONTROLS.filter((entry) => entry.id.startsWith('organ.') && entry.kind === 'fader')).toHaveLength(2)
    expect(CONTROLS.filter((entry) => entry.id.startsWith('piano.') && entry.kind === 'fader')).toHaveLength(2)
    expect(CONTROLS.filter((entry) => entry.id.startsWith('synth.') && entry.kind === 'fader')).toHaveLength(3)
  })

  it('keeps every initial value inside its own range', () => {
    for (const entry of CONTROLS) {
      expect(entry.initial).toBeGreaterThanOrEqual(entry.min)
      expect(entry.initial).toBeLessThanOrEqual(entry.max)
    }
  })

  it('throws on an unknown control id rather than inventing one', () => {
    expect(() => control('nope.nope')).toThrow(/Unknown control id/)
  })
})

/** Feature: interaction.decorative-controls */
describe('presentation state transitions', () => {
  it('starts from the declared initial values', () => {
    const values = initialHardwareValues()
    expect(Object.keys(values)).toHaveLength(CONTROLS.length)
    for (const entry of CONTROLS) expect(values[entry.id]).toBe(entry.initial)
  })

  it('cycles option buttons through their printed indicator options and wraps', () => {
    const spec = control('piano.type')
    expect(spec.options).toEqual(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'])
    let value = spec.initial
    const seen: string[] = []
    for (let step = 0; step < 6; step += 1) {
      seen.push(controlValueText(spec, value))
      value = activatedValue(spec, value)
    }
    expect(seen).toEqual(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'])
    expect(value).toBe(spec.initial)
  })

  it('flips toggle buttons and leaves momentary buttons unlatched', () => {
    const toggle = control('fx.reverb.on')
    expect(activatedValue(toggle, 0)).toBe(1)
    expect(activatedValue(toggle, 1)).toBe(0)
    const momentary = control('program.store')
    expect(activatedValue(momentary, 0)).toBe(0)
  })

  it('clamps and quantises continuous controls to their own step', () => {
    const knob = control('fx.mod1.rate')
    expect(clampToSpec(knob, 99)).toBe(knob.max)
    expect(clampToSpec(knob, -99)).toBe(knob.min)
    expect(clampToSpec(knob, 4.44)).toBeCloseTo(4.4, 6)
    const drawbar = control('organ.drawbar.1')
    expect(clampToSpec(drawbar, 3.4)).toBe(3)
    expect(nudgeValue(drawbar, 3, 1)).toBe(4)
    expect(nudgeValue(drawbar, 8, 1)).toBe(8)
  })

  it('describes values the way the panel prints them', () => {
    expect(controlValueText(control('organ.model'), 1)).toBe('Vox')
    expect(controlValueText(control('fx.reverb.on'), 1)).toBe('On')
    expect(controlValueText(control('fx.reverb.on'), 0)).toBe('Off')
    expect(controlValueText(control('perf.master-level'), 7.5)).toBe('7.5')
  })
})

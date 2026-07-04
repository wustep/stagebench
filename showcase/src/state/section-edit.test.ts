import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'
import { InstrumentStore } from './instrument'

/**
 * programs.section-edit — SECTION EDIT (manual p. 43): while engaged, edits
 * done to a parameter are performed on ALL Layers of that parameter's
 * Section. The hardware's double-tap "sticky" mode maps to our click =
 * sticky latch (declared adaptation, like Mon/Copy); click again or
 * Shift/Exit leaves. Temporary panel state — never stored in programs.
 */

describe('programs.section-edit — parameter fan-out', () => {
  it('a synth filter edit while active lands on all three layers, syncing ONLY the edited field', () => {
    const store = new InstrumentStore()
    // Give layer B a distinct resonance first so the fan-out provably
    // touches freq alone (per-layer nested merge, not a whole-object copy).
    store.setSynthFxFocus('B')
    store.setSynthFilterParam('res', 90)
    store.setSynthFxFocus('A')
    store.setSectionEdit(true)
    store.setSynthFilterParam('freq', 88)
    const s = store.getState()
    expect(s.synth.layers.A.filter.freq).toBe(88)
    expect(s.synth.layers.B.filter.freq).toBe(88)
    expect(s.synth.layers.C.filter.freq).toBe(88)
    expect(s.synth.layers.B.filter.res).toBe(90) // untouched by the fan-out
    // Truthful OLED readout of the fan-out (manual p. 43).
    expect(s.lastEdit).toMatch(/Filter Freq .* — all Synth layers/)
  })

  it('a piano chain unit edit lands on both piano chains', () => {
    const store = new InstrumentStore()
    expect(store.getState().fxSection).toBe('piano')
    store.setSectionEdit(true)
    store.toggleUnitOn('reverb')
    const s = store.getState()
    expect(s.chains.A.reverb.on).toBe(true)
    expect(s.chains.B.reverb.on).toBe(true)
    expect(s.lastEdit).toMatch(/Reverb On — both Piano chains/)
  })

  it('a synth chain unit edit fans to all three synth chains; the shared organ chain is unchanged in shape', () => {
    const store = new InstrumentStore()
    store.setSynthFxFocus('A')
    store.setSectionEdit(true)
    store.toggleUnitOn('delay')
    const s = store.getState()
    expect(s.synthChains.A.delay.on).toBe(true)
    expect(s.synthChains.B.delay.on).toBe(true)
    expect(s.synthChains.C.delay.on).toBe(true)
    expect(s.lastEdit).toMatch(/Delay On — all Synth chains/)
    // Piano chains stay out of a synth-section edit.
    expect(s.chains.A.delay.on).toBe(false)
  })

  it('organ per-layer parameters (model, level, stored drawbars) fan to both layers', () => {
    const store = new InstrumentStore()
    store.setSectionEdit(true)
    store.cycleOrganModel() // B3 -> Vox, computed from focused A
    store.setOrganLayerLevel('A', 77)
    store.setOrganDrawbar(3, 5) // both layers' presetOn is true at boot
    const s = store.getState()
    expect(s.organ.layers.A.model).toBe(s.organ.layers.B.model)
    expect(s.organ.layers.B.level).toBe(77)
    expect(s.organ.layers.A.drawbars[3]).toBe(5)
    expect(s.organ.layers.B.drawbars[3]).toBe(5)
    expect(s.lastEdit).toMatch(/— both Organ layers/)
  })

  it('toggling off restores single-layer writes', () => {
    const store = new InstrumentStore()
    store.setSectionEdit(true)
    store.setSynthFilterParam('freq', 88)
    store.setSectionEdit(false)
    store.setSynthFilterParam('freq', 20) // focused layer A only
    const s = store.getState()
    expect(s.synth.layers.A.filter.freq).toBe(20)
    expect(s.synth.layers.B.filter.freq).toBe(88)
    expect(s.synth.layers.C.filter.freq).toBe(88)
    expect(s.lastEdit).not.toMatch(/all Synth layers/)
    // Piano chains go back to focused-layer targeting too.
    store.toggleUnitOn('mod1')
    expect(store.getState().chains.A.mod1.on).toBe(true)
    expect(store.getState().chains.B.mod1.on).toBe(false)
  })

  it('layer On/Off stays deliberately un-fanned (layer selection, not a parameter edit)', () => {
    const store = new InstrumentStore()
    store.setSectionEdit(true)
    store.toggleSynthLayerEnabled('B')
    const s = store.getState()
    expect(s.synth.layers.B.enabled).toBe(true)
    expect(s.synth.layers.C.enabled).toBe(false)
  })

  it('sectionEdit is temporary panel state: no dirty flag, never in a program snapshot', () => {
    const store = new InstrumentStore()
    store.setSectionEdit(true)
    expect(store.getState().programs.dirty).toBe(false) // the latch itself is not an edit
    store.setSynthFilterParam('freq', 88) // a real (fanned) edit IS one
    expect(store.getState().programs.dirty).toBe(true)
    store.storePress()
    store.storePress() // confirm into the current slot
    const slot = store.getState().programs.bank[store.getState().programs.current]!
    expect('sectionEdit' in slot.snapshot).toBe(false)
    // Loading a program does not resurrect or clear the latch by snapshot.
    store.selectProgram(5)
    expect('sectionEdit' in store.getState().programs.bank[5]!.snapshot).toBe(false)
  })
})

describe('programs.section-edit — panel', () => {
  it('click latches (LED lit), click again leaves; Shift/Exit also leaves', () => {
    renderApp()
    const button = screen.getByRole('button', { name: 'Section Edit' })
    fireEvent.click(button)
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Section Edit — edits apply to all Layers/)
    fireEvent.click(button)
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Section Edit off/)
    // Shift/Exit leaves sticky mode (manual p. 43).
    fireEvent.click(button)
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Section Edit — edits apply to all Layers/)
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Section Edit off/)
  })

  it('Shift + Section Edit still opens Layer Init (iteration 29 pairing intact)', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Section Edit' }))
    expect(screen.getByTestId('oled-layer-init-line').textContent).toMatch(/LAYER INIT/)
    // The shift press opened Layer Init, NOT the sticky latch.
    expect(screen.getByTestId('oled-edit-line').textContent).not.toMatch(/Section Edit — edits apply/)
  })
})

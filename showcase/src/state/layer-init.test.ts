import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'
import { InstrumentStore } from './instrument'

/**
 * programs.layer-init — LAYER INIT (Shift + Section Edit, manual p. 43): a
 * Program-OLED edit mode whose four soft buttons (PROGRAM 1-4) initialize
 * the whole Program (All), both Organ layers (Org AB), or the focused
 * Piano/Synth layer. Each init is one ordinary, program-storable edit.
 */

describe('programs.layer-init — the four soft inits', () => {
  it('All: only Piano A active, no effects turned on, everything else at power-on defaults', () => {
    const store = new InstrumentStore()
    store.setOrganSectionOn(true)
    store.setSynthSectionOn(true)
    store.toggleLayerEnabled('B')
    store.updateUnit('reverb', { on: true } as never, 'test')
    store.toggleOrganRotary()
    store.setMasterClockBpm(200)
    store.layerInitAll()
    const s = store.getState()
    expect(s.piano.sectionOn).toBe(true)
    expect(s.layers.A.enabled).toBe(true)
    expect(s.layers.A.type).toBe('Grand')
    expect(s.layers.B.enabled).toBe(false)
    expect(s.organ.sectionOn).toBe(false)
    expect(s.synth.sectionOn).toBe(false)
    // "with no effects turned on": every unit of every chain is off.
    for (const chain of [s.chains.A, s.chains.B, s.organChain, s.synthChains.A, s.synthChains.B, s.synthChains.C]) {
      for (const unit of Object.values(chain)) expect((unit as { on: boolean }).on).toBe(false)
    }
    expect(s.organ.toRotary).toBe(false)
    expect(s.masterClock.bpm).toBe(120)
    expect(s.programs.dirty).toBe(true)
  })

  it('Org AB: both layers to a default B3 registration, layer A on, chain reset, rotary ON', () => {
    const store = new InstrumentStore()
    store.setOrganSectionOn(true)
    store.toggleOrganLayerEnabled('B') // B on (and focused)
    store.setOrganDrawbar(0, 6)
    store.cycleOrganModel() // focused layer leaves B3
    store.toggleOrganPercussion('on')
    store.setOrganFocusedLayer('A') // FX focus onto the shared organ chain
    store.updateUnit('delay', { on: true } as never, 'test')
    store.setLayerLevel('A', 83) // a Piano edit that must survive the organ init
    store.layerInitOrganAB()
    const s = store.getState()
    expect(s.organ.layers.A.model).toBe('B3')
    expect(s.organ.layers.B.model).toBe('B3')
    expect(s.organ.layers.A.drawbars).toEqual([8, 8, 8, 0, 0, 0, 0, 0, 0])
    expect(s.organ.layers.B.drawbars).toEqual([8, 8, 8, 0, 0, 0, 0, 0, 0])
    expect(s.organ.layers.A.enabled).toBe(true)
    expect(s.organ.layers.B.enabled).toBe(false)
    expect(s.organ.percussion.on).toBe(false)
    expect(s.organChain.delay.on).toBe(false)
    expect(s.organ.toRotary).toBe(true)
    expect(s.organ.sectionOn).toBe(true) // section on/off is not part of the init
    expect(s.layers.A.level).toBe(83)
    expect(s.programs.dirty).toBe(true)
  })

  it('Pno: resets ONLY the focused layer to the default piano sound and its own chain', () => {
    const store = new InstrumentStore()
    store.setLayerEnabled('B', true) // enables and focuses layer B
    store.cyclePianoType() // focused B leaves its default type
    store.cycleKbTouch()
    store.updateUnit('reverb', { on: true } as never, 'test') // chains.B (focused)
    store.toggleFxGroupPiano() // group mode copies B's chain onto A too
    store.layerInitPiano()
    const s = store.getState()
    expect(s.layers.B.type).toBe('Grand')
    expect(s.layers.B.model).toBe(0)
    expect(s.layers.B.level).toBe(100)
    expect(s.layers.B.enabled).toBe(true) // enable state is kept
    expect(s.piano.kbTouch).toBe(0)
    expect(s.chains.B.reverb.on).toBe(false) // focused chain reset…
    expect(s.chains.A.reverb.on).toBe(true) // …the other layer's untouched
    expect(s.fxGroupPiano).toBe(false) // group mode becomes per-layer (manual p. 43)
    expect(s.programs.dirty).toBe(true)
  })

  it('Syn: resets ONLY the focused layer to the init synth and its own chain', () => {
    const store = new InstrumentStore()
    store.toggleSynthLayerEnabled('B') // enables and focuses layer B
    store.setSynthFxFocus('B')
    store.setSynthFilterParam('freq', 10)
    store.setSynthGlide(90)
    store.updateUnit('delay', { on: true } as never, 'test') // synthChains.B
    store.toggleFxGroupSynth() // group mode copies B's chain onto A and C too
    store.layerInitSynth()
    const s = store.getState()
    expect(s.synth.layers.B.filter.freq).toBe(127)
    expect(s.synth.layers.B.voice.glide).toBe(0)
    expect(s.synth.layers.B.enabled).toBe(true) // enable state is kept
    expect(s.synthChains.B.delay.on).toBe(false) // focused chain reset…
    expect(s.synthChains.A.delay.on).toBe(true) // …the others untouched
    expect(s.synthChains.C.delay.on).toBe(true)
    expect(s.fxGroupSynth).toBe(false) // group mode becomes per-layer (manual p. 43)
    expect(s.programs.dirty).toBe(true)
  })

  it('an init is one ordinary edit: dirty flag and store round-trip', () => {
    const store = new InstrumentStore()
    store.setOrganSectionOn(true)
    expect(store.getState().programs.dirty).toBe(true)
    store.layerInitOrganAB()
    store.storePress()
    store.storePress() // confirm into 1.1
    expect(store.getState().programs.dirty).toBe(false)
    store.selectProgram(5)
    store.selectProgram(0)
    expect(store.getState().organ.layers.A.drawbars).toEqual([8, 8, 8, 0, 0, 0, 0, 0, 0])
    expect(store.getState().organ.toRotary).toBe(true)
  })

  it('layerInitEdit is a panel mode, not program state, and excludes split/clock/transpose edits', () => {
    const store = new InstrumentStore()
    store.setLayerInitEdit(true)
    expect(store.getState().programs.dirty).toBe(false) // opening the screen is not an edit
    store.setSplitEdit(true)
    expect(store.getState().layerInitEdit).toBe(false)
    store.setLayerInitEdit(true)
    expect(store.getState().splitEdit).toBeNull()
    store.setClockEdit(true)
    expect(store.getState().layerInitEdit).toBe(false)
    store.setLayerInitEdit(true)
    expect(store.getState().clockEdit).toBe(false)
    store.setTransposeEdit(true)
    expect(store.getState().layerInitEdit).toBe(false)
  })
})

describe('programs.layer-init — panel', () => {
  it('Shift + Section Edit opens the screen; PROGRAM 1-4 are the soft buttons; Shift exits', () => {
    renderApp()
    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    fireEvent.click(shift)
    fireEvent.click(screen.getByRole('button', { name: 'Section Edit' }))
    expect(screen.getByTestId('oled-layer-init-line').textContent).toMatch(/LAYER INIT/)
    fireEvent.click(screen.getByRole('button', { name: 'Program 1' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Layer Init — All/)
    fireEvent.click(screen.getByRole('button', { name: 'Program 2' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Layer Init — Organ AB/)
    fireEvent.click(screen.getByRole('button', { name: 'Program 3' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Layer Init — Piano A/)
    fireEvent.click(screen.getByRole('button', { name: 'Program 4' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Layer Init — Synth A/)
    fireEvent.click(shift)
    expect(screen.queryByTestId('oled-layer-init-line')).toBeNull()
  })

  it('a plain Section Edit press is truthfully inert; the LAYER INIT shift-legend opens the screen', () => {
    renderApp()
    const oled = screen.getByTestId('oled-program')
    const before = oled.textContent
    fireEvent.click(screen.getByRole('button', { name: 'Section Edit' }))
    expect(oled.textContent).toBe(before)
    // The printed LAYER INIT ▽ legend below the button is itself clickable
    // (the panel's hold-to-shift convention, manual p. 44).
    fireEvent.click(screen.getByRole('button', { name: 'Layer Init' }))
    expect(screen.getByTestId('oled-layer-init-line')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Layer Init' }))
    expect(screen.queryByTestId('oled-layer-init-line')).toBeNull()
  })
})

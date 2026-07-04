import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'
import { InstrumentStore } from './instrument'

/**
 * programs.mon-copy — MONITOR / COPY / PASTE (manual p. 43), pointer-first
 * adaptation of the hardware's hold gestures: the Mon/Copy click LATCHES a
 * monitor/copy mode (Shift + Mon/Copy latches Paste). While latched,
 * continuous controls become read-only readouts and the Layer / effect ON /
 * Morph Assign / PROGRAM buttons copy into (or paste from) a deep-cloned
 * non-snapshot clipboard. Same-section layer pastes, same-unit effect
 * pastes, morph pastes onto the pressed source, program pastes into the
 * pressed slot; everything else is truthfully refused.
 */

describe('programs.mon-copy — copy and paste (store)', () => {
  it('copies a synth layer (full state + its own chain) and pastes it within the section', () => {
    const store = new InstrumentStore()
    store.setSynthFxFocus('A') // FX focus onto synth layer A's chain
    store.setSynthGlide(90)
    store.setSynthFilterParam('freq', 33)
    store.updateUnit('delay', { on: true } as never, 'test')
    store.setMonCopyMode('copy')
    store.monCopyLayerPress('synth', 'A')
    expect(store.getState().clipboard?.kind).toBe('synth-layer')
    expect(store.getState().lastEdit).toBe('Copied: Synth A')
    // Deep clone: an edit AFTER the copy must not leak into the clipboard.
    store.setSynthGlide(10)
    store.setMonCopyMode('paste')
    store.monCopyLayerPress('synth', 'B')
    const s = store.getState()
    expect(s.synth.layers.B.voice.glide).toBe(90) // the copied value, not 10
    expect(s.synth.layers.B.filter.freq).toBe(33)
    expect(s.synthChains.B.delay.on).toBe(true)
    expect(s.lastEdit).toBe('Pasted → Synth B')
    expect(s.programs.dirty).toBe(true) // one ordinary edit
  })

  it('an organ layer copy carries — and its paste rewrites — the SHARED organ chain', () => {
    const store = new InstrumentStore()
    store.setOrganSectionOn(true)
    store.setOrganDrawbar(1, 7) // focused layer A registration
    store.setOrganFocusedLayer('A') // FX focus onto the shared organ chain
    store.updateUnit('reverb', { on: true } as never, 'test')
    store.setMonCopyMode('copy')
    store.monCopyLayerPress('organ', 'A')
    store.updateUnit('reverb', { on: false } as never, 'test') // edit after copy
    store.setMonCopyMode('paste')
    store.monCopyLayerPress('organ', 'B')
    const s = store.getState()
    expect(s.organ.layers.B.drawbars).toEqual(s.organ.layers.A.drawbars)
    expect(s.organChain.reverb.on).toBe(true) // shared chain restored from the clipboard
  })

  it('refuses a cross-section layer paste and changes nothing', () => {
    const store = new InstrumentStore()
    store.setMonCopyMode('copy')
    store.monCopyLayerPress('piano', 'A')
    store.setMonCopyMode('paste')
    const before = store.getState().synth
    store.monCopyLayerPress('synth', 'B')
    expect(store.getState().lastEdit).toBe('Cannot paste Piano A here')
    expect(store.getState().synth).toBe(before) // untouched, not even a new object
  })

  it('copies an effect unit from the focused chain and pastes it onto the SAME unit only', () => {
    const store = new InstrumentStore()
    store.updateUnit('mod1', { rate: 111 } as never, 'test') // chains.A (piano focus)
    store.setMonCopyMode('copy')
    store.monCopyEffectPress('mod1')
    expect(store.getState().lastEdit).toBe('Copied: Mod 1')
    store.setFocusedLayer('B') // paste lands on the newly focused chain
    store.setMonCopyMode('paste')
    store.monCopyEffectPress('mod1')
    expect(store.getState().chains.B.mod1.rate).toBe(111)
    expect(store.getState().lastEdit).toBe('Pasted → Mod 1')
    // A different unit's ON button refuses the Mod 1 clipboard.
    const delayBefore = store.getState().chains.B.delay
    store.monCopyEffectPress('delay')
    expect(store.getState().lastEdit).toBe('Cannot paste Mod 1 here')
    expect(store.getState().chains.B.delay).toBe(delayBefore)
  })

  it('copies a morph source and pastes its assignments onto the pressed source', () => {
    const store = new InstrumentStore()
    store.recordMorphEdit('wheel', 'delay-mix', 'A', 64, 127)
    store.setMonCopyMode('copy')
    store.monCopyMorphPress('wheel')
    expect(store.getState().lastEdit).toBe('Copied: Morph Wheel')
    store.setMonCopyMode('paste')
    store.monCopyMorphPress('pedal')
    const s = store.getState()
    expect(s.morph.pedal).toEqual(s.morph.wheel)
    expect(s.morph.pedal).not.toBe(s.morph.wheel) // deep-cloned, no shared list
    expect(s.lastEdit).toBe('Pasted → Morph Ctrl Pedal')
  })

  it('copies a program slot and pastes it into the pressed slot like a confirmed Store', () => {
    const store = new InstrumentStore()
    const source = store.getState().programs.bank[1]!
    store.setMonCopyMode('copy')
    store.monCopyProgramPress(1) // slot 1.2 of the current page
    expect(store.getState().lastEdit).toBe(`Copied: A:12 ${source.name}`)
    store.setMonCopyMode('paste')
    store.monCopyProgramPress(4) // slot 1.5
    const s = store.getState()
    expect(s.programs.bank[4]!.name).toBe(source.name)
    expect(s.programs.bank[4]!.snapshot).toEqual(source.snapshot)
    expect(s.programs.bank[4]!.snapshot).not.toBe(source.snapshot) // its own clone
    expect(s.programs.current).toBe(4) // loaded there, like Store
    expect(s.programs.dirty).toBe(false)
    expect(s.lastEdit).toBe(`Pasted → A:15 ${source.name}`)
  })

  it('a paste press with an empty clipboard is refused truthfully', () => {
    const store = new InstrumentStore()
    store.setMonCopyMode('paste')
    const before = store.getState().layers
    store.monCopyLayerPress('piano', 'B')
    expect(store.getState().lastEdit).toBe('Paste — clipboard empty')
    expect(store.getState().layers).toBe(before)
    expect(store.getState().programs.dirty).toBe(false)
  })

  it('the latch is panel-only state and mutually exclusive with the OLED edit modes and preset browse', () => {
    const store = new InstrumentStore()
    store.setClockEdit(true)
    store.setMonCopyMode('copy')
    expect(store.getState().programs.dirty).toBe(false) // latching is not an edit
    expect(store.getState().clockEdit).toBe(false)
    store.setLayerInitEdit(true)
    expect(store.getState().monCopy).toBeNull()
    store.setMonCopyMode('paste')
    expect(store.getState().layerInitEdit).toBe(false)
    store.enterPresetBrowse('synth', false)
    expect(store.getState().monCopy).toBeNull()
    store.setMonCopyMode('copy')
    expect(store.getState().presetBrowse).toBeNull()
    store.setSplitEdit(true)
    expect(store.getState().monCopy).toBeNull()
    store.setMonCopyMode('copy')
    store.setTransposeEdit(true)
    expect(store.getState().monCopy).toBeNull()
  })
})

/** The MON/COPY latch LED (the tiny-led-row above the push button). */
function monCopyLed(): HTMLElement {
  return document.querySelector('.mon-copy-led') as HTMLElement
}

describe('programs.mon-copy — panel', () => {
  it('the Mon/Copy latch monitors a knob without writing; clicking again exits and restores writes', () => {
    renderApp()
    const monCopy = screen.getByRole('button', { name: 'Monitor/Copy Paste' })
    fireEvent.click(monCopy) // latch copy/monitor mode
    expect(monCopyLed().dataset.on).toBe('true')
    const knob = screen.getByRole('slider', { name: 'Delay Dry/Wet' })
    fireEvent.keyDown(knob, { key: 'End' }) // would write 127 if not monitored
    expect(knob).toHaveAttribute('aria-valuenow', '64') // unchanged
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Delay Dry\/Wet: 64/)
    fireEvent.click(monCopy) // click again leaves
    expect(monCopyLed().dataset.on).toBe('false')
    fireEvent.keyDown(knob, { key: 'End' })
    expect(knob).toHaveAttribute('aria-valuenow', '127') // normal write restored
  })

  it('while latched, a Layer button copies instead of toggling; paste latches via Shift; Shift/Exit leaves', () => {
    renderApp()
    const monCopy = screen.getByRole('button', { name: 'Monitor/Copy Paste' })
    const layerB = screen.getByRole('button', { name: 'Piano Layer B On/Off' })
    expect(layerB).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(monCopy)
    fireEvent.click(screen.getByRole('button', { name: 'Piano Layer A On/Off' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Copied: Piano A/)
    fireEvent.click(monCopy) // leave copy mode
    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    fireEvent.click(shift)
    fireEvent.click(monCopy) // Shift + Mon/Copy latches Paste
    fireEvent.click(layerB)
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Pasted → Piano B/)
    expect(layerB).toHaveAttribute('aria-pressed', 'true') // pasted layer A's enabled state
    fireEvent.click(shift) // Shift/Exit unlatches Paste (Shift itself stays latched)
    expect(monCopyLed().dataset.on).toBe('false')
    fireEvent.click(shift) // …and a second click drops the Shift latch itself
    fireEvent.click(layerB) // back to the normal toggle
    expect(layerB).toHaveAttribute('aria-pressed', 'false')
  })

  it('the printed PASTE ⇕ shift-legend latches Paste mode directly', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
    expect(monCopyLed().dataset.on).toBe('true')
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Paste — press a Layer/)
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
    expect(monCopyLed().dataset.on).toBe('false')
  })
})

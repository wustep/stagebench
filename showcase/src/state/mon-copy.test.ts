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
    fireEvent.click(layerB) // back to the normal press: focuses the active layer
    expect(layerB).toHaveAttribute('aria-pressed', 'true') // stays on (hold = off)
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/FX Focus Piano B/)
  })

  it('the printed PASTE ⇕ shift-legend latches Paste mode directly', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
    expect(monCopyLed().dataset.on).toBe('true')
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Paste — press a target/)
    fireEvent.click(screen.getByRole('button', { name: 'Paste' }))
    expect(monCopyLed().dataset.on).toBe('false')
  })
})

describe('programs.mon-copy — Paste ⇄ Swap (manual p. 43, audit E9)', () => {
  it('Swap interchanges the two layers\' CURRENT states and chains, not the stale clipboard', () => {
    const store = new InstrumentStore()
    store.setLayerLevel('A', 70)
    store.setLayerLevel('B', 40)
    store.updateUnit('mod1', { rate: 111 } as never, 'test') // chains.A (piano focus)
    store.setMonCopyMode('copy')
    store.monCopyLayerPress('piano', 'A')
    store.setLayerLevel('A', 77) // edit AFTER the copy: Swap must exchange 77, not 70
    store.setMonCopyMode('swap')
    store.monCopyLayerPress('piano', 'B')
    const s = store.getState()
    expect(s.layers.A.level).toBe(40)
    expect(s.layers.B.level).toBe(77)
    expect(s.chains.B.mod1.rate).toBe(111) // the chains swapped too
    expect(s.lastEdit).toBe('Swapped Piano A ⇄ B')
    expect(s.programs.dirty).toBe(true)
    // UNDO covers a Swap like it covers a Paste.
    store.setMonCopyMode(null)
    store.undoProgramChange()
    expect(store.getState().layers.A.level).toBe(77)
    expect(store.getState().lastEdit).toContain('Undo Swap')
  })

  it('a synth-layer Swap exchanges the per-layer chains; Organ keeps its one shared chain', () => {
    const store = new InstrumentStore()
    store.setSynthFxFocus('A')
    store.updateUnit('delay', { on: true } as never, 'test')
    store.setMonCopyMode('copy')
    store.monCopyLayerPress('synth', 'A')
    store.setMonCopyMode('swap')
    store.monCopyLayerPress('synth', 'C')
    expect(store.getState().synthChains.C.delay.on).toBe(true)
    expect(store.getState().synthChains.A.delay.on).toBe(false)
    // Organ: swap the registrations, shared chain untouched.
    store.setOrganDrawbar(1, 7) // focused layer A
    const chainBefore = store.getState().organChain
    store.setMonCopyMode('copy')
    store.monCopyLayerPress('organ', 'A')
    store.setMonCopyMode('swap')
    store.monCopyLayerPress('organ', 'B')
    expect(store.getState().organ.layers.B.drawbars[1]).toBe(7)
    expect(store.getState().organChain).toBe(chainBefore)
  })

  it('Swap refuses cross-section pairs, self-swaps, and non-Layer targets truthfully', () => {
    const store = new InstrumentStore()
    store.setMonCopyMode('copy')
    store.monCopyLayerPress('piano', 'A')
    store.setMonCopyMode('swap')
    const before = store.getState().synth
    store.monCopyLayerPress('synth', 'B')
    expect(store.getState().lastEdit).toBe('Cannot swap Piano A with a Synth Layer')
    expect(store.getState().synth).toBe(before)
    store.monCopyLayerPress('piano', 'A')
    expect(store.getState().lastEdit).toContain('no-op')
    store.monCopyEffectPress('mod1')
    expect(store.getState().lastEdit).toContain('Swap is Layer ⇄ Layer only')
    store.monCopyProgramPress(3)
    expect(store.getState().lastEdit).toContain('Organize swaps Programs')
    expect(store.getState().programs.dirty).toBe(false) // nothing wrote anything
  })

  it('panel: with the Paste latch on, a plain Mon/Copy press toggles Paste ⇄ Swap', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Monitor/Copy Paste' })) // Shift + Mon/Copy = Paste
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Paste — press a target/)
    fireEvent.click(screen.getByRole('button', { name: 'Monitor/Copy Paste' })) // repeat presses toggle
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Swap — press the other Layer/)
    fireEvent.click(screen.getByRole('button', { name: 'Monitor/Copy Paste' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Paste — press a target/)
    // Shift/Exit drops the whole latch.
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Mon\/Copy off/)
  })
})

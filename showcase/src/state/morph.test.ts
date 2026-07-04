import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FakePort } from '../test/fakes'
import { renderApp } from '../test/renderApp'
import { InstrumentStore } from './instrument'

/**
 * morph.assignments — Wheel and Control Pedal morph sources: assignment
 * capture (start→end), interpolation across every destination (including
 * opposite directions), single-assignment removal by zeroing, per-source
 * clearing, indicators, program roundtrip, and the CC11 input path.
 */

describe('morph.assignments — capture and interpolation', () => {
  it('an armed source captures start→end and interpolates on movement', () => {
    const store = new InstrumentStore()
    store.toggleMorphArming('wheel')
    // Simulate the panel edit while armed (presentation passes prev + new).
    store.updateUnit('delay', { mix: 127 }, 'Delay Dry/Wet 127')
    store.recordMorphEdit('wheel', 'delay-mix', 'A', 64, 127)
    store.toggleMorphArming('wheel')
    expect(store.getState().morph.wheel).toEqual([{ control: 'delay-mix', layer: 'A', start: 64, end: 127 }])
    store.setMorphSource('wheel', 0)
    expect(store.getState().chains.A.delay.mix).toBe(64)
    store.setMorphSource('wheel', 127)
    expect(store.getState().chains.A.delay.mix).toBe(127)
    store.setMorphSource('wheel', 64)
    expect(store.getState().chains.A.delay.mix).toBe(96) // ≈ halfway
  })

  it('one source can raise one destination while lowering another', () => {
    const store = new InstrumentStore()
    store.recordMorphEdit('wheel', 'piano-level-a', 'A', 100, 20) // down
    store.recordMorphEdit('wheel', 'organ-level-a', 'A', 100, 127) // up
    store.setMorphSource('wheel', 127)
    expect(store.getState().layers.A.level).toBe(20)
    expect(store.getState().organ.layers.A.level).toBe(127)
    store.setMorphSource('wheel', 0)
    expect(store.getState().layers.A.level).toBe(100)
    expect(store.getState().organ.layers.A.level).toBe(100)
  })

  it('morph movement is a performance input: no dirty flag, no Live auto-store churn', () => {
    const store = new InstrumentStore()
    store.recordMorphEdit('wheel', 'delay-mix', 'A', 64, 127)
    store.storePress()
    store.storePress() // store the assignment away so the program is clean
    expect(store.getState().programs.dirty).toBe(false)
    store.setMorphSource('wheel', 90)
    expect(store.getState().programs.dirty).toBe(false)
    expect(store.getState().chains.A.delay.mix).toBeGreaterThan(64)
  })

  it('drawbar morphs bind the captured organ layer and move it live', () => {
    const store = new InstrumentStore()
    store.setOrganSectionOn(true)
    store.recordMorphEdit('pedal', 'organ-drawbar-9', 'A', 0, 8)
    store.setMorphSource('pedal', 127)
    expect(store.getState().organ.layers.A.drawbars[8]).toBe(8)
    expect(store.getState().organ.layers.B.drawbars[8]).toBe(0) // other layer untouched
    store.setMorphSource('pedal', 0)
    expect(store.getState().organ.layers.A.drawbars[8]).toBe(0)
  })

  it('rotary speed morphs slow below half and fast above (spec organ.rotary)', () => {
    const store = new InstrumentStore()
    store.recordMorphEdit('wheel', 'rotary-speed', 'A', 0, 127)
    store.setMorphSource('wheel', 127)
    expect(store.getState().rotary.speed).toBe('fast')
    store.setMorphSource('wheel', 20)
    expect(store.getState().rotary.speed).toBe('slow')
  })

  it('returning a control to its start removes that single assignment', () => {
    const store = new InstrumentStore()
    store.recordMorphEdit('wheel', 'delay-mix', 'A', 64, 127)
    store.recordMorphEdit('wheel', 'mod1-amount', 'A', 64, 10)
    store.recordMorphEdit('wheel', 'delay-mix', 'A', 127, 64) // back to start
    expect(store.getState().morph.wheel.map((a) => a.control)).toEqual(['mod1-amount'])
  })

  it('wheel -> filter-freq interpolates the focused synth layer’s filter.freq start→end', () => {
    const store = new InstrumentStore()
    store.setSynthFocusedLayer('B')
    store.recordMorphEdit('wheel', 'filter-freq', 'SB', 40, 110)
    store.setMorphSource('wheel', 127)
    expect(store.getState().synth.layers.B.filter.freq).toBe(110)
    expect(store.getState().synth.layers.A.filter.freq).not.toBe(110) // other layer untouched
    store.setMorphSource('wheel', 0)
    expect(store.getState().synth.layers.B.filter.freq).toBe(40)
  })

  it('pedal -> synth-level-b start/end round-trips, including through a program snapshot', () => {
    const store = new InstrumentStore()
    store.recordMorphEdit('pedal', 'synth-level-b', 'SA', 50, 100)
    store.setMorphSource('pedal', 127)
    expect(store.getState().synth.layers.B.level).toBe(100)
    store.setMorphSource('pedal', 0)
    expect(store.getState().synth.layers.B.level).toBe(50)
    expect(store.getState().programs.dirty).toBe(true) // assigning IS an edit
    store.storePress()
    store.storePress()
    store.selectProgram(4)
    expect(store.getState().morph.pedal).toHaveLength(0)
    store.selectProgram(0)
    expect(store.getState().morph.pedal).toEqual([{ control: 'synth-level-b', layer: 'SA', start: 50, end: 100 }])
  })

  it('wheel -> arp-rate moves synth.arp.rate', () => {
    const store = new InstrumentStore()
    store.recordMorphEdit('wheel', 'arp-rate', 'SA', 20, 100)
    store.setMorphSource('wheel', 127)
    expect(store.getState().synth.arp.rate).toBe(100)
    store.setMorphSource('wheel', 0)
    expect(store.getState().synth.arp.rate).toBe(20)
  })

  it('assignments are program state and round-trip through Store', () => {
    const store = new InstrumentStore()
    store.recordMorphEdit('pedal', 'reverb-mix', 'A', 64, 120)
    expect(store.getState().programs.dirty).toBe(true) // assigning IS an edit
    store.storePress()
    store.storePress()
    store.selectProgram(4)
    expect(store.getState().morph.pedal).toHaveLength(0)
    store.selectProgram(0)
    expect(store.getState().morph.pedal).toEqual([{ control: 'reverb-mix', layer: 'A', start: 64, end: 120 }])
  })
})

describe('morph.assignments — panel and input paths', () => {
  it('arm via the panel, move a knob, and the assignment + indicator appear', () => {
    renderApp()
    const wheelButton = screen.getByRole('button', { name: 'Morph Assign Wheel' })
    fireEvent.click(wheelButton)
    expect(wheelButton.getAttribute('aria-pressed')).toBe('true')
    const knob = screen.getByRole('slider', { name: 'Delay Dry/Wet' })
    fireEvent.keyDown(knob, { key: 'End' }) // 64 -> 127 while armed
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Morph Wheel → Delay Dry\/Wet 64→127/)
    expect(knob.getAttribute('data-morphed')).toBe('wheel')
    fireEvent.click(wheelButton) // done
    expect(wheelButton.getAttribute('aria-pressed')).toBe('false')
    // The mod wheel now drives the destination.
    const modWheel = screen.getByRole('slider', { name: 'Mod Wheel' })
    fireEvent.keyDown(modWheel, { key: 'End' })
    expect(Number(knob.getAttribute('aria-valuenow'))).toBe(127)
    fireEvent.keyDown(modWheel, { key: 'Home' })
    expect(Number(knob.getAttribute('aria-valuenow'))).toBe(64)
  })

  it('Shift + source button clears all of that source’s assignments', () => {
    renderApp()
    const wheelButton = screen.getByRole('button', { name: 'Morph Assign Wheel' })
    fireEvent.click(wheelButton)
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Delay Dry/Wet' }), { key: 'End' })
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Mod 1 Amount' }), { key: 'Home' })
    fireEvent.click(wheelButton)
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    fireEvent.click(wheelButton)
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Morph Wheel cleared/)
    expect(document.querySelectorAll('[data-morphed]')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' })) // unlatch
  })

  it('an assigned layer fader shows range LEDs on its LED ladder; unassigned shows none', () => {
    renderApp()
    const wheelButton = screen.getByRole('button', { name: 'Morph Assign Wheel' })
    const fader = screen.getByRole('slider', { name: 'Organ Layer A Level' })
    const ladder = fader.parentElement!.querySelector('.led-ladder')!
    expect(ladder.querySelectorAll('[data-range="true"]')).toHaveLength(0) // unassigned: none
    fireEvent.click(wheelButton)
    fireEvent.keyDown(fader, { key: 'End' }) // 100 -> 127 while armed
    fireEvent.click(wheelButton) // done arming
    expect(ladder.querySelectorAll('[data-range="true"]').length).toBeGreaterThan(0)
  })

  it('an assigned drawbar shows range LEDs on its LED ladder; unassigned shows none', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Organ Section On' }))
    const pedalButton = screen.getByRole('button', { name: 'Morph Assign Control Pedal' })
    const drawbar = screen.getByRole('slider', { name: 'Drawbar 9 (1′)' })
    const ladder = drawbar.parentElement!.querySelector('.drawbar-ladder')!
    expect(ladder.querySelectorAll('[data-range="true"]')).toHaveLength(0) // unassigned: none
    fireEvent.click(pedalButton)
    fireEvent.keyDown(drawbar, { key: 'End' }) // 0 -> 8 while armed
    fireEvent.click(pedalButton) // done arming
    expect(ladder.querySelectorAll('[data-range="true"]').length).toBeGreaterThan(0)
  })

  it('the on-screen Control Pedal and MIDI CC11 both drive the pedal source', async () => {
    const rendered = renderApp()
    const pedalButton = screen.getByRole('button', { name: 'Morph Assign Control Pedal' })
    fireEvent.click(pedalButton)
    const knob = screen.getByRole('slider', { name: 'Reverb Dry/Wet' })
    fireEvent.keyDown(knob, { key: 'End' })
    fireEvent.click(pedalButton)
    // On-screen pedal (range input).
    const pedal = screen.getByTestId('ctrl-pedal') as HTMLInputElement
    fireEvent.change(pedal, { target: { value: '127' } })
    expect(Number(knob.getAttribute('aria-valuenow'))).toBe(127)
    fireEvent.change(pedal, { target: { value: '0' } })
    expect(Number(knob.getAttribute('aria-valuenow'))).toBe(64)
    // MIDI CC11 through the real input manager (hot-plugged device).
    const port = new FakePort('p1', 'Morph Dev')
    rendered.midiAccess.addPort(port)
    await waitFor(() => {
      expect(screen.getByTestId('midi-status').getAttribute('data-status')).toBe('connected')
    })
    port.emit([0xb0, 11, 127])
    await waitFor(() => {
      expect(Number(knob.getAttribute('aria-valuenow'))).toBe(127)
      expect(Number(pedal.value)).toBe(127) // the on-screen pedal follows
    })
  })
})

describe('morph.assignments — id-encoded destinations resolve their own layer (audit C1)', () => {
  it('capturing an organ/piano level fader binds the fader’s OWN layer regardless of focus', () => {
    const store = new InstrumentStore()
    store.setOrganSectionOn(true)
    store.setOrganFocusedLayer('A') // focus is on A…
    store.toggleMorphArming('wheel')
    // …but the B-level fader is moved (presentation resolves via morphLayerFor).
    store.recordMorphEdit('wheel', 'organ-level-b', store.morphLayerFor('organ-level-b'), 100, 40)
    store.toggleMorphArming('wheel')
    const assignment = store.getState().morph.wheel[0]!
    expect(assignment.layer).toBe('B') // bound to the fader's layer, not focus
    // Indicators find it no matter which layer is focused.
    expect(store.morphAssignmentFor('organ-level-b')).not.toBeNull()
    expect(store.morphSourcesFor('organ-level-b')).toEqual(['wheel'])
    store.setOrganFocusedLayer('B')
    expect(store.morphAssignmentFor('organ-level-b')).not.toBeNull()
    // A second capture updates the SAME assignment — no focus-keyed duplicate.
    store.toggleMorphArming('wheel')
    store.recordMorphEdit('wheel', 'organ-level-b', store.morphLayerFor('organ-level-b'), 100, 20)
    store.toggleMorphArming('wheel')
    expect(store.getState().morph.wheel).toHaveLength(1)
    expect(store.getState().morph.wheel[0]!.end).toBe(20)
    // Interpolation still moves layer B only.
    store.setMorphSource('wheel', 127)
    expect(store.getState().organ.layers.B.level).toBe(20)
  })

  it('piano level faders resolve by id too', () => {
    const store = new InstrumentStore()
    store.setFocusedLayer('A')
    expect(store.morphLayerFor('piano-level-b')).toBe('B')
    expect(store.morphLayerFor('piano-level-a')).toBe('A')
  })
})

describe('morph.assignments — MIDI CC1 wheel and pitch bend (audit D1)', () => {
  it('MIDI CC1 drives the Wheel morph source and the on-screen wheel follows', async () => {
    const rendered = renderApp()
    const wheelButton = screen.getByRole('button', { name: 'Morph Assign Wheel' })
    fireEvent.click(wheelButton)
    const knob = screen.getByRole('slider', { name: 'Reverb Dry/Wet' })
    fireEvent.keyDown(knob, { key: 'End' })
    fireEvent.click(wheelButton)
    const port = new FakePort('p1', 'Morph Dev')
    rendered.midiAccess.addPort(port)
    await waitFor(() => {
      expect(screen.getByTestId('midi-status').getAttribute('data-status')).toBe('connected')
    })
    port.emit([0xb0, 1, 127])
    await waitFor(() => {
      expect(Number(knob.getAttribute('aria-valuenow'))).toBe(127)
      // The on-screen mod wheel mirrors the device position.
      const wheel = screen.getByRole('slider', { name: 'Mod Wheel' })
      expect(Number(wheel.getAttribute('aria-valuenow'))).toBe(127)
    })
    port.emit([0xb0, 1, 0])
    await waitFor(() => {
      expect(Number(knob.getAttribute('aria-valuenow'))).toBe(64)
    })
  })

  it('MIDI pitch bend moves the on-screen pitch stick', async () => {
    const rendered = renderApp()
    const port = new FakePort('p1', 'Bend Dev')
    rendered.midiAccess.addPort(port)
    await waitFor(() => {
      expect(screen.getByTestId('midi-status').getAttribute('data-status')).toBe('connected')
    })
    const stick = screen.getByRole('slider', { name: 'Pitch Stick' })
    port.emit([0xe0, 0x7f, 0x7f]) // full up
    await waitFor(() => {
      expect(Number(stick.getAttribute('aria-valuenow'))).toBe(100)
    })
    port.emit([0xe0, 0x00, 0x40]) // back to center
    await waitFor(() => {
      expect(Number(stick.getAttribute('aria-valuenow'))).toBe(0)
    })
  })
})

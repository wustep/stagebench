// The displays say what the instrument does: the program number and name, the edit and store states, the
// synth layer and waveform, and the LEDs. None of them claims a feature is not active.
import { describe, expect, it } from 'vitest'
import { createInstrumentState, instrumentReducer, type InstrumentAction } from './instrument'
import { derivedLeds, programDisplayLines, synthDisplayLines } from './displays'
import { bpmFromKnob, knobFromBpm, transposeFromKnob } from './instrument'

const run = (...actions: InstrumentAction[]) => actions.reduce(instrumentReducer, createInstrumentState())

describe('displays', () => {
  it('the Program display shows the number, the name, and the page', () => {
    const lines = programDisplayLines(createInstrumentState())
    expect(lines[0]).toBe('1.1 Grand Piano')
    expect(lines[1]).toBe('Page 1 of 4')
  })

  it('the Program display says STORE, and names the destination, while Store is armed', () => {
    const lines = programDisplayLines(run({ type: 'toggle', id: 'program.store' }))
    expect(lines[0]).toBe('STORE')
    expect(lines[1]).toContain('STORE')
  })

  it('the Synth display names the selected layer, its waveform, and whether it is on', () => {
    // The Grand Piano program has synth layer A off, so the display says so; switching it on changes the line.
    const off = synthDisplayLines(createInstrumentState())
    expect(off[0]).toBe('SYNTH A: Sine')
    expect(off[1]).toContain('Layer off')
    const on = synthDisplayLines(run({ type: 'toggle', id: 'synth.layer-a-on' }))
    expect(on[1]).toContain('Layer on')
  })

  it('no display text says a feature is not active', () => {
    const state = run({ type: 'toggle', id: 'program.store' })
    const all = [...programDisplayLines(createInstrumentState()), ...synthDisplayLines(createInstrumentState()), ...programDisplayLines(state)]
    for (const line of all) expect(line).not.toMatch(/not active|phase 2/i)
  })

  it('the LEDs show the loaded program button and the morph and store lights', () => {
    const leds = derivedLeds(run({ type: 'toggle', id: 'program.button-1' }))
    expect(leds['program.button-1']).toBe(1)
    expect(derivedLeds(run({ type: 'morph-source', source: 'wheel' }))['program.morph-1']).toBe(1)
  })
})

describe('clock and transpose', () => {
  it('the master clock runs 30 to 300 BPM across the dial, and the knob maps back to the same tempo', () => {
    expect(bpmFromKnob(0)).toBe(30)
    expect(bpmFromKnob(1)).toBe(300)
    expect(bpmFromKnob(knobFromBpm(120))).toBeCloseTo(120, 6)
  })

  it('four taps at a steady interval set the tempo; the page says the new BPM through the knob', () => {
    let state = createInstrumentState()
    for (const time of [0, 500, 1000, 1500]) state = instrumentReducer(state, { type: 'tap-tempo', time })
    expect(bpmFromKnob(state.values['program.clock-bpm'])).toBeCloseTo(120, 3)
  })

  it('fewer than four taps leave the tempo alone', () => {
    let state = createInstrumentState()
    const before = state.values['program.clock-bpm']
    for (const time of [0, 500, 1000]) state = instrumentReducer(state, { type: 'tap-tempo', time })
    expect(state.values['program.clock-bpm']).toBe(before)
  })

  it('a long pause starts a new tempo, so old taps do not count', () => {
    let state = createInstrumentState()
    for (const time of [0, 500, 1000]) state = instrumentReducer(state, { type: 'tap-tempo', time })
    state = instrumentReducer(state, { type: 'tap-tempo', time: 10000 })
    expect(state.taps).toEqual([10000])
  })

  it('transpose runs from -6 to +6 semitones, with the centre at zero', () => {
    expect(transposeFromKnob(0)).toBe(-6)
    expect(transposeFromKnob(0.5)).toBe(0)
    expect(transposeFromKnob(1)).toBe(6)
  })
})

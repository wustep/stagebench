// morph.assignments: Wheel and Control Pedal assignment, interpolation, indicators, and clearing.
import { describe, expect, it } from 'vitest'
import { applyMorphs, assignMorph, clearMorphSource, EMPTY_MORPHS, isMorphDestination, sourceAmount } from './morph'
import { instrumentReducer, createInstrumentState, type InstrumentState } from './instrument'
import { initialPresentation } from './hardware'

const run = (state: InstrumentState, ...actions: Parameters<typeof instrumentReducer>[1][]) => actions.reduce(instrumentReducer, state)

describe('morph.assignments', () => {
  it('interpolates a destination from start to end as the source amount moves', () => {
    const morphs = assignMorph(EMPTY_MORPHS, 'wheel', 'effects.delay-time@A', 0.2, 0.8)
    const state = { ...initialPresentation(), 'performance.mod-wheel': 0.5, 'effects.delay-time@A': 0.8 }
    expect(applyMorphs(state, morphs)['effects.delay-time@A']).toBeCloseTo(0.5, 10)
    expect(applyMorphs({ ...state, 'performance.mod-wheel': 0 }, morphs)['effects.delay-time@A']).toBeCloseTo(0.2, 10)
    expect(applyMorphs({ ...state, 'performance.mod-wheel': 1 }, morphs)['effects.delay-time@A']).toBeCloseTo(0.8, 10)
  })

  it('one morph can increase one destination while decreasing another', () => {
    let morphs = assignMorph(EMPTY_MORPHS, 'pedal', 'synth.filter-cutoff@A', 0.2, 0.9)
    morphs = assignMorph(morphs, 'pedal', 'synth.lfo-amount@A', 0.9, 0.1)
    const state = { ...initialPresentation(), 'performance.control-pedal': 1 }
    const moved = applyMorphs(state, morphs)
    expect(moved['synth.filter-cutoff@A']).toBeCloseTo(0.9, 10)
    expect(moved['synth.lfo-amount@A']).toBeCloseTo(0.1, 10)
  })

  it('the Wheel and the Control Pedal are separate sources', () => {
    const state = { ...initialPresentation(), 'performance.mod-wheel': 1, 'performance.control-pedal': 0 }
    expect(sourceAmount(state, 'wheel')).toBe(1)
    expect(sourceAmount(state, 'pedal')).toBe(0)
  })

  it('a destination is a continuous control the spec lists, and nothing else can morph', () => {
    expect(isMorphDestination('organ.drawbar-8@A')).toBe(true)
    expect(isMorphDestination('effects.reverb-level@B')).toBe(true)
    expect(isMorphDestination('synth.osc-type@A')).toBe(false)
    expect(isMorphDestination('piano.kb-touch')).toBe(false)
  })

  it('assign mode records a destination from its start value to the value the player moves it to', () => {
    let state = createInstrumentState()
    const start = state.values['organ.drawbar-8@A']
    state = run(state, { type: 'morph-source', source: 'wheel' }, { type: 'set', id: 'organ.drawbar-8', value: 0.3 })
    expect(state.morphs.wheel).toEqual([{ key: 'organ.drawbar-8@A', start, end: 0.3 }])
  })

  it('moving a destination back to its start removes that single assignment', () => {
    let state = createInstrumentState()
    const start = state.values['organ.drawbar-8@A']
    state = run(state, { type: 'morph-source', source: 'wheel' }, { type: 'set', id: 'organ.drawbar-8', value: 0.3 }, { type: 'set', id: 'organ.drawbar-8', value: start })
    expect(state.morphs.wheel).toEqual([])
  })

  it('Shift with a morph source clears every assignment of that source, and leaves the other source alone', () => {
    let state = createInstrumentState()
    state = run(state, { type: 'morph-source', source: 'wheel' }, { type: 'set', id: 'organ.drawbar-8', value: 0.3 }, { type: 'morph-source', source: 'pedal' }, { type: 'set', id: 'synth.filter-cutoff', value: 0.1 }, { type: 'toggle', id: 'program.morph-1', shiftKey: true })
    expect(state.morphs.wheel).toEqual([])
    expect(state.morphs.pedal).toHaveLength(1)
  })

  it('an assigned destination shows its indicator, and clearing the source removes it', () => {
    const morphs = clearMorphSource(assignMorph(EMPTY_MORPHS, 'wheel', 'organ.drawbar-8@A', 0.8, 0.2), 'wheel')
    expect(morphs.wheel).toEqual([])
  })

  it('the morph destinations reach the audio: a morphed level changes the derived layer level', async () => {
    const { deriveAudioSettings } = await import('./audioSettings')
    let state = createInstrumentState()
    state = run(state, { type: 'morph-source', source: 'wheel' }, { type: 'set', id: 'synth.layer-a-level', value: 0.1 })
    const moved = applyMorphs({ ...state.values, 'performance.mod-wheel': 0 }, state.morphs)
    const low = deriveAudioSettings(moved).graph.layers.SA.level
    const high = deriveAudioSettings(applyMorphs({ ...state.values, 'performance.mod-wheel': 1 }, state.morphs)).graph.layers.SA.level
    expect(low).not.toBe(high)
  })
})

describe('morph.assignments: the Control Pedal source from MIDI', () => {
  it('MIDI CC11 drives the Control Pedal as a 0..1 value', async () => {
    const { createPianoInstrument } = await import('../instrument/pianoInstrument')
    const input: { id: string; state: 'connected'; onmidimessage: ((event: { data: Uint8Array }) => void) | null } = { id: 'pedal-test', state: 'connected', onmidimessage: null }
    const access = { inputs: new Map([[input.id, input]]), onstatechange: null }
    const values: number[] = []
    const instrument = createPianoInstrument({ midiRequest: () => Promise.resolve(access), onControlPedal: (value) => values.push(value) })
    instrument.connectMidi()
    await Promise.resolve()
    await Promise.resolve()
    input.onmidimessage?.({ data: new Uint8Array([0xb0, 11, 127]) })
    input.onmidimessage?.({ data: new Uint8Array([0xb0, 11, 0]) })
    expect(values).toEqual([1, 0])
  })
})

describe('morph.assignments: rotary speed is morphable', () => {
  it('a morph moves the rotary speed between slow and fast, continuously', async () => {
    const { deriveAudioSettings } = await import('./audioSettings')
    let state = createInstrumentState()
    state = run(state, { type: 'morph-source', source: 'wheel' }, { type: 'set', id: 'performance.rotary-speed', value: 1 })
    const at = (wheel: number) => deriveAudioSettings(applyMorphs({ ...state.values, 'performance.mod-wheel': wheel }, state.morphs)).graph.rotary.speed
    expect(at(0)).toBeCloseTo(0, 10)
    expect(at(0.5)).toBeCloseTo(0.5, 10)
    expect(at(1)).toBeCloseTo(1, 10)
  })
})

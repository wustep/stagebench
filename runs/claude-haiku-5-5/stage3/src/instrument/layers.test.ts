// piano.layers: two layers with enable, focus, level, and octave; each voice belongs to the layer that started it.
import { describe, expect, it } from 'vitest'
import { FakeAudioContext, FakeNode, reaches, type FakeOscillator } from '../audio/testing/fakeAudioContext'
import { createPianoInstrument, type PianoInstrument } from './pianoInstrument'
import { deriveAudioSettings } from '../model/audioSettings'
import { initialPresentation, presentationReducer, type ControlAction, type PresentationState } from '../model/hardware'

const failing = { fetchBytes: () => Promise.reject(new Error('no samples in this test')) }

function build(state: PresentationState) {
  const context = new FakeAudioContext()
  const instrument: PianoInstrument = createPianoInstrument({
    audioFactory: () => context,
    sampleLoader: failing,
    midiRequest: undefined,
  })
  instrument.configure(deriveAudioSettings(state))
  return { context, instrument }
}

function withActions(state: PresentationState, actions: ControlAction[]) {
  return actions.reduce((current, action) => presentationReducer(current, action), state)
}

/** The oscillators whose output reaches a given layer input. */
function layerOscillators(context: FakeAudioContext, input: FakeNode): FakeOscillator[] {
  return context.oscillators.filter((oscillator) => reaches(oscillator, input))
}

describe('piano.layers: ownership and routing', () => {
  it('a note sounds only in the layers that are on', () => {
    const { context, instrument } = build(initialPresentation())
    instrument.noteOn('pointer:1', 60, 100)
    const layerA = instrument.engine.audio!.graph.input('A') as unknown as FakeNode
    const layerB = instrument.engine.audio!.graph.input('B') as unknown as FakeNode
    expect(layerOscillators(context, layerA).length).toBe(6)
    expect(layerOscillators(context, layerB).length).toBe(0)
    instrument.teardown()
  })

  it('with both layers on, each layer gets its own voice for the same key', () => {
    const state = withActions(initialPresentation(), [{ type: 'toggle', id: 'piano.layer-b-on' }])
    const { context, instrument } = build(state)
    instrument.noteOn('pointer:1', 60, 100)
    const layerA = instrument.engine.audio!.graph.input('A') as unknown as FakeNode
    const layerB = instrument.engine.audio!.graph.input('B') as unknown as FakeNode
    expect(layerOscillators(context, layerA)).toHaveLength(6)
    expect(layerOscillators(context, layerB)).toHaveLength(6)
    instrument.teardown()
  })

  it('the octave control transposes one layer by a full octave, not the other', () => {
    const state = withActions(initialPresentation(), [
      { type: 'toggle', id: 'piano.layer-b-on' },
      { type: 'set', id: 'piano.layer-b-octave', value: 1 },
    ])
    const { context, instrument } = build(state)
    instrument.noteOn('pointer:1', 60, 100)
    const layerA = instrument.engine.audio!.graph.input('A') as unknown as FakeNode
    const layerB = instrument.engine.audio!.graph.input('B') as unknown as FakeNode
    const fundamental = (node: FakeNode) => layerOscillators(context, node)[0].frequency.events[0].value ?? 0
    expect(fundamental(layerB) / fundamental(layerA)).toBeCloseTo(2, 2)
    instrument.teardown()
  })

  it('switching a layer off releases the voices that layer is playing', () => {
    const state = withActions(initialPresentation(), [{ type: 'toggle', id: 'piano.layer-b-on' }])
    const { context, instrument } = build(state)
    instrument.noteOn('pointer:1', 60, 100)
    const layerB = instrument.engine.audio!.graph.input('B') as unknown as FakeNode
    const releasedBefore = context.gains.filter((gain) => gain.gain.events.some((event) => event.kind === 'target' && event.value === 0)).length
    instrument.configure(deriveAudioSettings(withActions(state, [{ type: 'toggle', id: 'piano.layer-b-on' }])))
    const releasedAfter = context.gains.filter((gain) => gain.gain.events.some((event) => event.kind === 'target' && event.value === 0)).length
    expect(layerOscillators(context, layerB).length).toBe(6)
    expect(releasedAfter).toBeGreaterThan(releasedBefore)
    instrument.teardown()
  })

  it('the piano section ON button silences both layers and starts no voices', () => {
    const state = withActions(initialPresentation(), [{ type: 'toggle', id: 'piano.section-on' }])
    const { context, instrument } = build(state)
    expect(instrument.noteOn('pointer:1', 60, 100)).toBe(false)
    const inputs = (['A', 'B'] as const).map((id) => instrument.engine.audio!.graph.input(id) as unknown as FakeNode)
    expect(inputs.flatMap((input) => layerOscillators(context, input))).toHaveLength(0)
    instrument.teardown()
  })

  it('layer focus is a radio: focusing B clears A, and effect focus follows it', () => {
    const state = withActions(initialPresentation(), [{ type: 'toggle', id: 'piano.layer-b-focus' }])
    expect(state['piano.layer-a-focus']).toBe(0)
    expect(state['piano.layer-b-focus']).toBe(1)
    expect(state['effects.focus-b']).toBe(1)
    expect(state['effects.focus-a']).toBe(0)
    const again = presentationReducer(state, { type: 'toggle', id: 'piano.layer-b-focus' })
    expect(again['piano.layer-b-focus']).toBe(1)
  })

  it('the layer level fader tapers, so the output follows the square of the fader', () => {
    const { instrument } = build(initialPresentation())
    const settings = deriveAudioSettings(initialPresentation())
    expect(settings.graph.layers.A.level).toBeCloseTo(0.75, 10)
    instrument.teardown()
  })
})

// effects.graph: one AudioContext, per-layer buses, ordered effects, master gain and limiter, one destination,
// click-free ramps, and cleanup of every node.
import { describe, expect, it } from 'vitest'
import { FakeAudioContext, FakeNode, reaches, type FakeParam } from '../testing/fakeAudioContext'
import { SignalGraph } from '../signalGraph'
import { createPianoInstrument } from '../../instrument/pianoInstrument'
import { deriveAudioSettings } from '../../model/audioSettings'
import { initialPresentation, presentationReducer, type ControlAction, type PresentationState } from '../../model/hardware'
import { DEFAULT_GRAPH_SETTINGS } from '../signalGraph'
import { createMod1 } from './modulation'
import { ReverbUnit } from './reverb'
import { DelayUnit } from './delay'

const failing = { fetchBytes: () => Promise.reject(new Error('no samples in this test')) }

function withActions(state: PresentationState, actions: ControlAction[]) {
  return actions.reduce((current, action) => presentationReducer(current, action), state)
}

describe('effects.graph: one context, two buses, one destination', () => {
  it('creates exactly one AudioContext however many notes, panel changes, and layers are used', () => {
    let contexts = 0
    const context = new FakeAudioContext()
    const instrument = createPianoInstrument({
      audioFactory: () => {
        contexts += 1
        return context
      },
      sampleLoader: failing,
      midiRequest: undefined,
    })
    let state = withActions(initialPresentation(), [{ type: 'toggle', id: 'piano.layer-b-on' }, { type: 'toggle', id: 'effects.delay-on' }])
    instrument.configure(deriveAudioSettings(state))
    instrument.noteOn('pointer:1', 60, 100)
    state = withActions(state, [{ type: 'toggle', id: 'effects.reverb-on' }, { type: 'toggle', id: 'effects.group' }])
    instrument.configure(deriveAudioSettings(state))
    instrument.noteOn('pointer:2', 64, 100)
    instrument.noteOff('pointer:1', 60)
    expect(contexts).toBe(1)
    instrument.teardown()
  })

  it('feeds each layer bus through its own chain into the one master path and the single destination', () => {
    const context = new FakeAudioContext()
    const graph = new SignalGraph(context)
    expect(reaches(graph.layers.A.input as unknown as FakeNode, context.destination)).toBe(true)
    expect(reaches(graph.layers.B.input as unknown as FakeNode, context.destination)).toBe(true)
    expect(reaches(graph.output as unknown as FakeNode, context.destination)).toBe(true)
    expect(graph.output.ratio.value).toBe(20)
    graph.dispose()
  })

  it('orders the effects as documented: Reverb precedes the Rotary, and the Rotary precedes master', () => {
    const context = new FakeAudioContext()
    const graph = new SignalGraph(context)
    const layer = graph.layers.A
    const reverbOut = layer.reverb.slot.output as unknown as FakeNode
    expect(reaches(layer.input as unknown as FakeNode, layer.mod1.slot.input as unknown as FakeNode)).toBe(true)
    expect(reaches(layer.mod1.slot.input as unknown as FakeNode, layer.delay.slot.input as unknown as FakeNode)).toBe(true)
    expect(reaches(layer.delay.slot.input as unknown as FakeNode, layer.amp.slot.input as unknown as FakeNode)).toBe(true)
    expect(reaches(layer.amp.slot.input as unknown as FakeNode, layer.comp.slot.input as unknown as FakeNode)).toBe(true)
    expect(reaches(layer.comp.slot.input as unknown as FakeNode, layer.reverb.slot.input as unknown as FakeNode)).toBe(true)
    expect(reaches(reverbOut, graph.rotary.input as unknown as FakeNode)).toBe(true)
    expect(reaches(graph.rotary.output as unknown as FakeNode, graph.output as unknown as FakeNode)).toBe(true)
    graph.dispose()
  })

  it('releases every node it made when disposed: only the destination is left', () => {
    const context = new FakeAudioContext()
    const graph = new SignalGraph(context)
    graph.apply(DEFAULT_GRAPH_SETTINGS)
    expect(context.liveNodeCount).toBeGreaterThan(50)
    graph.dispose()
    expect(context.liveNodeCount).toBe(1)
  })
})

describe('effects.graph: click-free bypass and parameter ramps', () => {
  /** Ramp events on a parameter: a target with a positive time constant is a smooth move, a bare set is a jump. */
  const jumps = (param: FakeParam) => param.events.filter((event) => event.kind === 'set' || event.kind === 'linear').length

  it('bypassing a unit ramps its dry and wet gains rather than jumping them', () => {
    const context = new FakeAudioContext()
    const unit = createMod1(context)
    unit.apply({ on: true, type: 0, rate: 0.3, amount: 0.4 })
    unit.apply({ on: false, type: 0, rate: 0.3, amount: 0.4 })
    const gains = context.gains.filter((gain) => gain.gain.events.some((event) => event.kind === 'target' && (event.timeConstant ?? 0) > 0))
    expect(gains.length).toBeGreaterThan(0)
    for (const gain of gains) {
      expect(jumps(gain.gain)).toBeLessThanOrEqual(1)
    }
    unit.dispose()
  })

  it('a delay or reverb unit switched off returns to a pass-through (dry at full, wet at zero)', () => {
    const context = new FakeAudioContext()
    const delay = new DelayUnit(context)
    delay.apply({ on: false, time: 0.4, feedback: 0.3, mix: 0.4, filter: 0 })
    const reverb = new ReverbUnit(context)
    reverb.apply({ on: false, type: 3, mix: 0.3, bright: 0.5 })
    expect(context.gains.some((gain) => gain.gain.events.some((event) => event.kind === 'target' && event.value === 1))).toBe(true)
    delay.dispose()
    reverb.dispose()
  })

  it('builds every listed type of a modulation unit up front, so a type change only moves gains', () => {
    const context = new FakeAudioContext()
    const before = context.liveNodeCount
    const mod1 = createMod1(context)
    const built = context.liveNodeCount - before
    mod1.apply({ on: true, type: 3, rate: 0.5, amount: 0.5 })
    mod1.apply({ on: true, type: 4, rate: 0.5, amount: 0.5 })
    expect(context.liveNodeCount - before).toBe(built)
    expect(built).toBeGreaterThan(30)
    mod1.dispose()
    expect(context.liveNodeCount).toBe(before)
  })
})

// effects.routing: focus follows layer focus, manual focus, group and global modes, per-unit bypass,
// all-effects bypass, the To Rotary route, and the delay feedback loop.
import { describe, expect, it } from 'vitest'
import { deriveAudioSettings } from '../../model/audioSettings'
import { initialPresentation, presentationReducer, readValue, effectFocus, type ControlAction, type PresentationState } from '../../model/hardware'
import { SignalGraph, DEFAULT_GRAPH_SETTINGS } from '../signalGraph'
import { FakeAudioContext, FakeNode, reaches, type FakeParam } from '../testing/fakeAudioContext'
import { DelayUnit } from './delay'

const act = (state: PresentationState, ...actions: ControlAction[]) => actions.reduce((s, a) => presentationReducer(s, a), state)
const toggle = (id: string): ControlAction => ({ type: 'toggle', id })
const set = (id: string, value: number): ControlAction => ({ type: 'set', id, value })

describe('effects.routing: focus', () => {
  it('manual effect focus changes which layer the panel edits, without moving layer focus', () => {
    const state = act(initialPresentation(), toggle('effects.focus-b'))
    expect(effectFocus(state)).toBe('B')
    expect(state['piano.layer-a-focus']).toBe(1)
    expect(state['piano.layer-b-focus']).toBe(0)
  })

  it('layer focus pulls effect focus along with it', () => {
    const state = act(initialPresentation(), toggle('piano.layer-b-focus'))
    expect(effectFocus(state)).toBe('B')
    expect(readValue(state, 'effects.delay-time')).toBe(state['effects.delay-time@B'])
  })

  it('a unit edited on the focused layer leaves the other layer alone', () => {
    const state = act(initialPresentation(), toggle('piano.layer-b-focus'), set('effects.delay-time', 0.9))
    expect(state['effects.delay-time@B']).toBeCloseTo(0.9, 10)
    expect(state['effects.delay-time@A']).toBeCloseTo(0.4, 10)
  })
})

describe('effects.routing: group and global modes', () => {
  it('piano group mode copies the focused settings to both layers, then writes reach both', () => {
    const base = act(initialPresentation(), set('effects.delay-time', 0.8))
    const grouped = act(base, toggle('effects.group'))
    expect(grouped['effects.delay-time@B']).toBeCloseTo(0.8, 10)
    const written = act(grouped, set('effects.delay-feedback', 0.9))
    expect(written['effects.delay-feedback@A']).toBeCloseTo(0.9, 10)
    expect(written['effects.delay-feedback@B']).toBeCloseTo(0.9, 10)
  })

  it('global mode on Delay (Shift + On) applies delay settings to every layer and leaves Compressor alone', () => {
    const base = act(initialPresentation(), set('effects.delay-time', 0.7))
    const global = act(base, { type: 'global', id: 'effects.delay-on' })
    expect(global['effects.delay-global']).toBe(1)
    expect(global['effects.delay-time@B']).toBeCloseTo(0.7, 10)
    const written = act(global, set('effects.delay-time', 0.2))
    expect(written['effects.delay-time@B']).toBeCloseTo(0.2, 10)
    // Compressor is not global: its edit lands on the focused layer only, and layer B keeps its own value.
    const comp = act(written, set('effects.comp-amount', 0.95))
    expect(comp['effects.comp-amount@A']).toBeCloseTo(0.95, 10)
    expect(comp['effects.comp-amount@B']).toBeCloseTo(0.3, 10)
  })

  it('global mode on Compressor and Reverb works the same way, and Shift + On again turns it off', () => {
    const state = act(initialPresentation(), { type: 'global', id: 'effects.reverb-on' })
    expect(state['effects.reverb-global']).toBe(1)
    expect(act(state, { type: 'global', id: 'effects.reverb-on' })['effects.reverb-global']).toBe(0)
    expect(act(initialPresentation(), { type: 'global', id: 'effects.comp-on' })['effects.comp-global']).toBe(1)
  })

  it('Shift + On on a unit that is not global-capable is an ordinary toggle', () => {
    const state = act(initialPresentation(), { type: 'global', id: 'effects.mod1-on' })
    expect(state['effects.mod1-on@A']).toBe(0)
    expect(state).toEqual(initialPresentation())
  })
})

describe('effects.routing: bypass', () => {
  it('per-unit On switches reach the audio settings for that layer only', () => {
    const state = act(initialPresentation(), toggle('effects.delay-on'), toggle('effects.mod2-on'))
    const audio = deriveAudioSettings(state)
    expect(audio.graph.layers.A.effects.delay.on).toBe(true)
    expect(audio.graph.layers.A.effects.mod2.on).toBe(true)
    expect(audio.graph.layers.A.effects.mod1.on).toBe(false)
    expect(audio.graph.layers.B.effects.delay.on).toBe(false)
  })

  it('all-effects bypass (Layer effects on) turns every unit off at the graph', () => {
    const state = act(initialPresentation(), toggle('effects.delay-on'), toggle('effects.all-on'))
    const audio = deriveAudioSettings(state)
    expect(audio.graph.effectsOn).toBe(false)
    expect(deriveAudioSettings(act(state, toggle('effects.all-on'))).graph.effectsOn).toBe(true)
  })

  it('the Amp type To Rotary routes that layer into the shared Rotary, and other types route to master', () => {
    const toRotary = act(initialPresentation(), toggle('effects.amp-on'), ...Array.from({ length: 6 }, () => ({ type: 'advance', id: 'effects.amp-type' }) as const))
    const audio = deriveAudioSettings(toRotary)
    expect(audio.graph.layers.A.toRotary).toBe(true)
    expect(audio.graph.layers.B.toRotary).toBe(false)
    const context = new FakeAudioContext()
    const graph = new SignalGraph(context)
    graph.apply(audio.graph)
    const lastTarget = (param: FakeParam) => [...param.events].reverse().find((e) => e.kind === 'target')?.value
    expect(lastTarget(graph.layers.A.toRotary.gain as unknown as FakeParam)).toBe(1)
    expect(lastTarget(graph.layers.A.toMaster.gain as unknown as FakeParam)).toBe(0)
    expect(reaches(graph.layers.A.toRotary as unknown as FakeNode, graph.rotary.input as unknown as FakeNode)).toBe(true)
    graph.dispose()
  })

  it('the Delay feedback loop returns repeats to the delay line, so it processes its own output', () => {
    const context = new FakeAudioContext()
    const delay = new DelayUnit(context)
    const node = context.delays[0] as unknown as FakeNode
    expect(reaches(node, node)).toBe(true)
    delay.dispose()
  })

  it('default settings start with every unit bypassed and the panel at its declared starting values', () => {
    const audio = deriveAudioSettings(initialPresentation())
    expect(audio.graph.layers.A.on).toBe(true)
    expect(audio.graph.layers.B.on).toBe(false)
    expect(audio.graph.effectsOn).toBe(true)
    for (const unit of ['mod1', 'mod2', 'delay', 'amp', 'comp', 'reverb'] as const) {
      expect(audio.graph.layers.A.effects[unit].on).toBe(false)
    }
    expect(audio.graph.master).toBeCloseTo(DEFAULT_GRAPH_SETTINGS.master, 10)
  })
})

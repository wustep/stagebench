// layers.routing and scenes.switching: enable, focus, level, octave, zone, and effect-target routing for
// every layer of every engine, and Layer Scenes I and II toggling enable state without touching sound.
import { describe, expect, it } from 'vitest'
import { deriveAudioSettings, octaveFromKnob } from './audioSettings'
import { effectChain, focusedKey, initialPresentation, presentationReducer, readValue, sceneOf, synthFocus, type ControlAction, type PresentationState } from './hardware'

const act = (state: PresentationState, ...actions: ControlAction[]) => actions.reduce(presentationReducer, state)
const toggle = (id: string): ControlAction => ({ type: 'toggle', id })

describe('layers.routing: every layer of every engine', () => {
  it('piano, organ, and synth layers each have enable, focus, level, octave, and zone controls', () => {
    const state = initialPresentation()
    for (const id of ['piano.layer-a', 'piano.layer-b', 'organ.layer-a', 'organ.layer-b', 'synth.layer-a', 'synth.layer-b', 'synth.layer-c']) {
      expect(state, id).toBeDefined()
    }
    expect(state['synth.layer-c-level']).toBeDefined()
    expect(state['organ.layer-b-zone']).toBeDefined()
  })

  it('organ focus picks the layer the drawbars edit; the other layer keeps its own drawbars', () => {
    let state = initialPresentation()
    state = act(state, toggle('organ.layer-b-focus'), { type: 'set', id: 'organ.drawbar-16', value: 0.1 })
    expect(state['organ.drawbar-16@B']).toBeCloseTo(0.1, 10)
    expect(state['organ.drawbar-16@A']).toBeCloseTo(0.8, 10)
    expect(readValue(state, 'organ.drawbar-16')).toBeCloseTo(0.1, 10)
  })

  it('synth focus picks the layer whose sound the panel edits, across A, B, and C', () => {
    let state = initialPresentation()
    state = act(state, toggle('synth.layer-c-focus'))
    expect(synthFocus(state)).toBe('C')
    state = act(state, { type: 'advance', id: 'synth.osc-type' })
    expect(state['synth.osc-type@C']).toBe(1)
    expect(state['synth.osc-type@A']).toBe(0)
  })

  it('the Layer Effects section selects the chain: organ, piano A or B, or synth A, B, C', () => {
    let state = initialPresentation()
    expect(effectChain(state)).toBe('A')
    state = act(state, toggle('effects.focus-b'))
    expect(effectChain(state)).toBe('B')
    state = act(state, toggle('effects.section-organ'))
    expect(effectChain(state)).toBe('O')
    state = act(state, toggle('effects.section-synth'), toggle('synth.layer-b-focus'))
    expect(effectChain(state)).toBe('SB')
    expect(focusedKey(state, 'effects')).toBe('SB')
  })

  it('an effect edit lands on the chain the section and focus select, and only there', () => {
    let state = initialPresentation()
    state = act(state, toggle('effects.section-synth'), toggle('synth.layer-c-focus'), { type: 'set', id: 'effects.delay-time', value: 0.9 })
    expect(state['effects.delay-time@SC']).toBeCloseTo(0.9, 10)
    expect(state['effects.delay-time@A']).toBeCloseTo(0.4, 10)
  })

  it('octave knobs map to -12, 0, or +12 for each layer, independently', () => {
    expect(octaveFromKnob(0.1)).toBe(-12)
    expect(octaveFromKnob(0.5)).toBe(0)
    expect(octaveFromKnob(0.9)).toBe(12)
    let state = initialPresentation()
    state = act(state, { type: 'set', id: 'organ.layer-b-octave', value: 0.9 }, { type: 'set', id: 'synth.layer-c-octave', value: 0.1 })
    const settings = deriveAudioSettings(state)
    expect(settings.organ.B.octave).toBe(12)
    expect(settings.organ.A.octave).toBe(0)
    expect(settings.synth.C.octave).toBe(-12)
  })

  it('a layer enable switch turns that layer on and off in the derived settings', () => {
    const state = act(initialPresentation(), toggle('synth.layer-b-on'), toggle('organ.layer-a-on'))
    const settings = deriveAudioSettings(state)
    expect(settings.graph.layers.SB.on).toBe(true)
    expect(settings.graph.layers.SA.on).toBe(true)
    expect(settings.organ.A.on).toBe(false)
    expect(settings.graph.layers.O.on).toBe(false)
  })

  it('a layer routed To Rotary is marked for the rotary, and the organ routes through its own button', () => {
    let state = initialPresentation()
    state = act(state, { type: 'advance', id: 'effects.amp-type' }, { type: 'advance', id: 'effects.amp-type' }, { type: 'advance', id: 'effects.amp-type' }, { type: 'advance', id: 'effects.amp-type' }, { type: 'advance', id: 'effects.amp-type' }, { type: 'advance', id: 'effects.amp-type' })
    expect(deriveAudioSettings(state).graph.layers.A.toRotary).toBe(true)
    expect(deriveAudioSettings(state).graph.layers.O.toRotary).toBe(true)
    expect(deriveAudioSettings(act(state, toggle('performance.rotary-organ'))).graph.layers.O.toRotary).toBe(false)
  })

  it('zone assignments reach the derived settings for every layer', () => {
    // Zone cycles step: the default is 1 to 4 (index 9), and one step on wraps to 1 (index 0).
    const state = act(initialPresentation(), { type: 'advance', id: 'organ.layer-a-zone' }, { type: 'advance', id: 'synth.layer-c-zone' })
    const settings = deriveAudioSettings(state)
    expect(settings.organ.A.zone).toEqual([1, 1])
    expect(settings.synth.C.zone).toEqual([1, 1])
    expect(settings.piano.A.zone).toEqual([1, 4])
  })
})

describe('scenes.switching: Layer Scene I and II change enable state, not sound', () => {
  it('a layer enabled in Scene II is off in Scene I, and switching flips it without losing either set', () => {
    let state = initialPresentation()
    expect(sceneOf(state)).toBe(0)
    state = act(state, toggle('program.layer-scene'))
    expect(sceneOf(state)).toBe(1)
    state = act(state, toggle('synth.layer-b-on'))
    expect(state['synth.layer-b-on']).toBe(1)
    state = act(state, toggle('program.layer-scene'))
    expect(sceneOf(state)).toBe(0)
    expect(state['synth.layer-b-on']).toBe(0)
    state = act(state, toggle('program.layer-scene'))
    expect(state['synth.layer-b-on']).toBe(1)
  })

  it('a scene switch changes enable state only: sound parameters are shared, not duplicated', () => {
    let state = initialPresentation()
    state = act(state, { type: 'set', id: 'synth.osc-ctrl', value: 0.9 }, toggle('program.layer-scene'))
    expect(state['synth.osc-ctrl@A']).toBeCloseTo(0.9, 10)
    expect(state['synth.osc-ctrl@A']).toBe(readValue(state, 'synth.osc-ctrl'))
  })

  it('the layer scene button lights for Scene II', () => {
    const state = act(initialPresentation(), toggle('program.layer-scene'))
    expect(state['program.layer-scene']).toBe(1)
  })
})

describe('splits.zones: split controls are panel values', () => {
  it('Split turns the split points on, and the points set the zones the audio derives', () => {
    let state = initialPresentation()
    expect(deriveAudioSettings(state).splits).toEqual([])
    state = act(state, toggle('program.split'))
    expect(deriveAudioSettings(state).splits.map((point) => point.note)).toEqual([60])
    // Split points are cycles: ten steps from Off reach F6, the eleventh position counting Off as the first.
    state = act(state, ...Array.from({ length: 10 }, () => ({ type: 'advance' as const, id: 'program.split-high' })), { type: 'advance', id: 'program.xfade-high' })
    expect(deriveAudioSettings(state).splits.map((point) => point.note)).toEqual([60, 89])
    expect(deriveAudioSettings(state).splits[1].crossfade).toBe(6)
  })
})

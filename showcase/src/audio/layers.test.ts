import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary } from '../test/fakes'
import { InstrumentStore } from '../state/instrument'
import { PianoEngine } from './engine'

/**
 * piano.layers — two Piano layers with enable/focus/selection/level/octave,
 * correct per-layer voice ownership and cleanup.
 */
function makeSystem() {
  const setup = fakeAudioBoundary()
  const store = new InstrumentStore()
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(store)
  return { ...setup, store, engine }
}

describe('piano.layers', () => {
  it('routes notes only to enabled layers (default: layer A only)', () => {
    const { engine } = makeSystem()
    engine.noteOn(60, 0.8)
    expect(engine.layerVoiceCount('A')).toBe(1)
    expect(engine.layerVoiceCount('B')).toBe(0)
  })

  it('enabling layer B doubles voice ownership per note, each layer owning its own voice', () => {
    const { engine, store } = makeSystem()
    engine.ensureStarted()
    store.setLayerEnabled('B', true)
    engine.noteOn(60, 0.8)
    expect(engine.layerVoiceCount('A')).toBe(1)
    expect(engine.layerVoiceCount('B')).toBe(1)
    expect(engine.heldVoiceCount()).toBe(2)
    engine.noteOff(60)
    expect(engine.heldVoiceCount()).toBe(0)
  })

  it('layer enable follows focus: switching a layer on focuses it', () => {
    const { store } = makeSystem()
    expect(store.getState().focusedLayer).toBe('A')
    store.setLayerEnabled('B', true)
    expect(store.getState().focusedLayer).toBe('B')
    store.setFocusedLayer('A')
    expect(store.getState().focusedLayer).toBe('A')
  })

  it('per-layer selection: layer B can hold a different instrument than layer A', () => {
    const { store } = makeSystem()
    expect(store.getState().layers.A.type).toBe('Grand')
    store.setFocusedLayer('B')
    store.selectPianoType('Electric')
    expect(store.getState().layers.B.type).toBe('Electric')
    expect(store.getState().layers.A.type).toBe('Grand')
  })

  it('per-layer octave shift selects different recorded roots (new zone, not a blind rate change)', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    engine.noteOn(60, 0.8)
    const context = getContext()!
    const buffersAtOctave0 = new Set(context.bufferSources().map((s) => s.buffer))
    engine.noteOff(60)

    store.shiftOctave('A', 1)
    expect(store.getState().layers.A.octave).toBe(1)
    engine.noteOn(60, 0.8)
    const newSources = context.bufferSources().filter((s) => !buffersAtOctave0.has(s.buffer) || !s.stopped)
    // The shifted note must use a different recorded zone buffer.
    const shiftedBuffers = context
      .bufferSources()
      .filter((s) => !s.stopped)
      .map((s) => s.buffer)
    expect(shiftedBuffers.some((b) => !buffersAtOctave0.has(b))).toBe(true)
    expect(newSources.length).toBeGreaterThan(0)
  })

  it('octave shift clamps to ±1 and reports the edit on the display state', () => {
    const { store } = makeSystem()
    store.shiftOctave('A', 1)
    store.shiftOctave('A', 1)
    expect(store.getState().layers.A.octave).toBe(1)
    store.shiftOctave('A', -1)
    store.shiftOctave('A', -1)
    store.shiftOctave('A', -1)
    expect(store.getState().layers.A.octave).toBe(-1)
    expect(store.getState().lastEdit).toMatch(/Octave -1/)
  })

  it('level and enable state are canonical per layer', () => {
    const { store } = makeSystem()
    store.setLayerLevel('A', 40)
    store.setLayerLevel('B', 90)
    expect(store.getState().layers.A.level).toBe(40)
    expect(store.getState().layers.B.level).toBe(90)
    store.toggleLayerEnabled('A')
    expect(store.getState().layers.A.enabled).toBe(false)
  })

  it('all-notes-off cleans voices owned by both layers', () => {
    const { engine, store, timers } = makeSystem()
    engine.ensureStarted()
    store.setLayerEnabled('B', true)
    for (const midi of [55, 60, 65]) engine.noteOn(midi, 0.7)
    expect(engine.heldVoiceCount()).toBe(6)
    engine.allNotesOff('input-cleanup')
    timers.advance(3000)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('piano section off silences new notes for both layers (state truth)', () => {
    const { engine, store } = makeSystem()
    engine.ensureStarted()
    store.setPianoSectionOn(false)
    engine.noteOn(60, 0.8)
    expect(engine.heldVoiceCount()).toBe(0)
  })
})

describe('layer buttons — press vs hold (manual p. 12/18)', () => {
  it('a press focuses an active unfocused layer and enables an off layer', () => {
    const { store } = makeSystem()
    store.setLayerEnabled('B', true) // focus follows the newly-enabled B
    store.pressLayer('A')
    expect(store.getState().layers.A.enabled).toBe(true) // still on
    expect(store.getState().focusedLayer).toBe('A') // press = focus
    store.holdOffLayer('B')
    expect(store.getState().layers.B.enabled).toBe(false) // hold = off
    store.pressLayer('B')
    expect(store.getState().layers.B.enabled).toBe(true) // press re-enables
  })

  it('a press on the focused active layer toggles it off (pointer adaptation of the hold gesture)', () => {
    const { store } = makeSystem()
    store.setLayerEnabled('B', true) // B on + focused
    store.pressLayer('B') // focused press = off
    expect(store.getState().layers.B.enabled).toBe(false)
    expect(store.getState().focusedLayer).toBe('A') // focus moves to the survivor
    store.pressLayer('A') // A is the only active layer: the guard keeps it on
    expect(store.getState().layers.A.enabled).toBe(true)
    expect(store.getState().lastEdit).toMatch(/only active Layer/)
  })

  it('the hold refuses to silence the section: the last active layer stays on', () => {
    const { store } = makeSystem()
    store.holdOffLayer('A')
    expect(store.getState().layers.A.enabled).toBe(true)
    expect(store.getState().lastEdit).toMatch(/only active Layer/)
  })

  it('holding off the focused layer moves focus to a remaining one', () => {
    const { store } = makeSystem()
    store.setLayerEnabled('B', true)
    store.setFocusedLayer('B')
    store.holdOffLayer('B')
    expect(store.getState().focusedLayer).toBe('A')
  })

  it('Organ and Synth layer buttons share the same press/hold semantics', () => {
    const { store } = makeSystem()
    store.pressOrganLayer('B')
    expect(store.getState().organ.layers.B.enabled).toBe(true)
    store.pressOrganLayer('B') // focused press = off (focus moves to A)
    expect(store.getState().organ.layers.B.enabled).toBe(false)
    expect(store.getState().organ.focusedLayer).toBe('A')
    store.pressOrganLayer('B') // press re-enables
    store.holdOffOrganLayer('B') // the hold gesture still turns off
    expect(store.getState().organ.layers.B.enabled).toBe(false)
    expect(store.getState().organ.focusedLayer).toBe('A')

    store.pressSynthLayer('C')
    expect(store.getState().synth.layers.C.enabled).toBe(true)
    store.pressSynthLayer('C') // focused press = off
    expect(store.getState().synth.layers.C.enabled).toBe(false)
    store.holdOffSynthLayer('A') // the only remaining active layer
    expect(store.getState().synth.layers.A.enabled).toBe(true)
  })
})

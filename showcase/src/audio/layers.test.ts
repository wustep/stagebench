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

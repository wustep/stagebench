import { describe, expect, it } from 'vitest'
import { PianoEngine, renderPianoScript, rms } from './audio/piano-engine'
import { createAudioContext } from './audio/software-context'
import { defaultInstrumentState } from './model/instrument-state'

describe('piano.layers', () => {
  it('plays independent layers with level, octave, and voice ownership', async () => {
    const aOnly = await renderPianoScript(0.3, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.enable = true
      state.layers.B.enable = false
      engine.applyState(state, 0)
      engine.noteOn(60, 0.8, 0)
    })
    const both = await renderPianoScript(0.3, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.enable = true
      state.layers.B.enable = true
      engine.applyState(state, 0)
      engine.noteOn(60, 0.8, 0)
    })
    expect(rms(both)).toBeGreaterThan(rms(aOnly) * 1.15)

    const ctx = createAudioContext({ offline: true, durationSec: 0.4 })
    const engine = new PianoEngine({ context: ctx })
    const state = defaultInstrumentState()
    state.layers.A.enable = true
    state.layers.B.enable = true
    engine.applyState(state, 0)
    engine.noteOn(64, 0.7, 0)
    expect(engine.getLayerVoiceCount('A')).toBeGreaterThan(0)
    expect(engine.getLayerVoiceCount('B')).toBeGreaterThan(0)
    engine.noteOff(64, 0.05)
    engine.dispose()
  })

  it('octave shift moves pitch enough to change the waveform', async () => {
    const unison = await renderPianoScript(0.28, (engine) => {
      engine.noteOn(60, 0.8, 0)
    })
    const shifted = await renderPianoScript(0.28, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.octave = 12
      engine.applyState(state, 0)
      engine.noteOn(60, 0.8, 0)
    })
    expect(rms(shifted)).toBeGreaterThan(0.001)
    let diff = 0
    for (let i = 0; i < unison.length; i++) diff += Math.abs(unison[i] - shifted[i])
    expect(diff / unison.length).toBeGreaterThan(0.002)
  })

  it('cleans up per-layer voices on all-notes-off', () => {
    const engine = new PianoEngine({
      context: createAudioContext({ offline: true, durationSec: 0.5 }),
    })
    const state = defaultInstrumentState()
    state.layers.B.enable = true
    engine.applyState(state, 0)
    engine.noteOn(50, 0.7, 0)
    engine.noteOn(54, 0.7, 0)
    expect(engine.getActiveVoiceCount()).toBeGreaterThan(0)
    engine.allNotesOff(0.1)
    expect(engine.getActiveVoiceCount()).toBe(0)
    engine.dispose()
  })
})

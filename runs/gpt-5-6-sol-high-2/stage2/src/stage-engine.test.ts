import { describe, expect, it } from 'vitest'
import { createInitialInstrumentState } from './instrument'
import { StagePianoEngine } from './stage-engine'

describe('two-layer ownership and pedal routing', () => {
  it('owns one voice per enabled layer and cleans a disabled layer without touching the other', () => {
    const state = createInitialInstrumentState()
    state.layers.B.enabled = true
    const engine = new StagePianoEngine(state)
    engine.noteOn(60, .8, 'key')
    expect(engine.snapshot().activeVoiceCount).toBe(2)
    engine.updateState({ ...state, layers: { ...state.layers, B: { ...state.layers.B, enabled: false } } })
    expect(engine.snapshot().activeVoiceCount).toBe(1)
    engine.noteOff('key')
    expect(engine.snapshot().activeVoiceCount).toBe(0)
  })

  it('honors SUSTPED independently and exposes a labeled playable asset fallback', () => {
    const state = createInitialInstrumentState()
    state.layers.B.enabled = true
    state.layers.B.sustped = false
    const engine = new StagePianoEngine(state)
    engine.noteOn(64, .7, 'key')
    engine.setSustain(true)
    engine.noteOff('key')
    expect(engine.snapshot()).toMatchObject({ activeVoiceCount: 1, sustain: true })
    engine.setSustain(false)
    expect(engine.snapshot().activeVoiceCount).toBe(0)
    engine.simulateAssetFailure()
    expect(engine.getStatus()).toEqual({ state: 'fallback', label: 'PCM library failed · synthesized playable fallback active' })
  })

  it('stops all owned voices and returns counts to baseline on dispose', () => {
    const engine = new StagePianoEngine(createInitialInstrumentState())
    engine.noteOn(60, .8, 'one')
    engine.noteOn(64, .8, 'two')
    expect(engine.snapshot().activeVoiceCount).toBe(2)
    engine.dispose()
    expect(engine.snapshot()).toEqual({ activeNotes: [], activeVoiceCount: 0, sustain: false })
  })
})

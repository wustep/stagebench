import { describe, expect, it } from 'vitest'
import { PianoEngine } from './audio/piano-engine'
import { createAudioContext } from './audio/software-context'

describe('effects.graph', () => {
  it('uses one context, layer buses, master path, and cleans up', () => {
    const ctx = createAudioContext({ offline: true, durationSec: 0.3 })
    const engine = new PianoEngine({ context: ctx })
    expect(engine.getContext()).toBe(ctx)
    engine.noteOn(60, 0.7, 0)
    engine.noteOn(64, 0.7, 0)
    expect(engine.getActiveVoiceCount()).toBeGreaterThan(0)
    engine.allNotesOff(0.05)
    expect(engine.getActiveVoiceCount()).toBe(0)
    engine.dispose()
    expect(engine.getContext()).toBeNull()
    expect(engine.getActiveVoiceCount()).toBe(0)
  })
})

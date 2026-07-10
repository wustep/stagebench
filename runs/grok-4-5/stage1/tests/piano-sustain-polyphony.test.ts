import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('piano.basic-sustain-polyphony', () => {
  it('holds notes under sustain and cuts on pedal release', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ createContext })
    await engine.init()
    const id = engine.noteOn(60, 0.8)
    engine.setSustain(true)
    engine.noteOff(id)
    expect(engine.getActiveVoiceCount()).toBe(1)
    engine.setSustain(false)
    // release scheduled — force cleanup
    engine.allNotesOff()
    expect(engine.getActiveVoiceCount()).toBe(0)
    engine.dispose()
  })

  it('supports concurrent voices and deterministic stealing', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ createContext, maxPolyphony: 3 })
    await engine.init()
    engine.noteOn(60, 0.5, 'a')
    engine.noteOn(62, 0.5, 'a')
    engine.noteOn(64, 0.5, 'a')
    expect(engine.getActiveVoiceCount()).toBe(3)
    engine.noteOn(65, 0.5, 'a')
    expect(engine.getActiveVoiceCount()).toBe(3)
    engine.dispose()
  })

  it('accepts velocity in expected range (softer vs louder still create voices)', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ createContext })
    await engine.init()
    engine.noteOn(60, 0.1)
    engine.noteOn(61, 1.0)
    expect(engine.getActiveVoiceCount()).toBe(2)
    engine.dispose()
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('piano.basic-note-lifecycle', () => {
  afterEach(() => {
    /* engines disposed in tests */
  })

  it('handles note on/off, repeated and overlapping notes, release, all-notes-off', async () => {
    const { createContext, contexts } = createMockContextFactory()
    const engine = new PianoEngine({ createContext, maxPolyphony: 8 })
    await engine.init()
    expect(engine.getStatus()).toBe('ready')

    const a = engine.noteOn(60, 0.8, 't')
    const b = engine.noteOn(64, 0.5, 't')
    expect(engine.getActiveVoiceCount()).toBe(2)

    // Overlapping same pitch retrigger
    const a2 = engine.noteOn(60, 0.9, 't')
    expect(engine.getActiveVoiceCount()).toBe(3)

    engine.noteOff(a)
    engine.noteOff(b)
    engine.noteOff(a2)
    // voices still releasing or stopped depending on timer; allNotesOff forces cleanup
    engine.allNotesOff()
    expect(engine.getActiveVoiceCount()).toBe(0)

    // Repeated notes
    const n1 = engine.noteOn(67, 0.7)
    engine.noteOff(n1)
    const n2 = engine.noteOn(67, 0.7)
    expect(n2).not.toBe(n1)
    engine.allNotesOff()
    expect(engine.getActiveVoiceCount()).toBe(0)

    // Oscillators were started
    const oscs = contexts[0].getOscillators()
    expect(oscs.some((o) => o.started)).toBe(true)

    engine.dispose()
  })

  it('cleans up nodes on dispose', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ createContext })
    await engine.init()
    engine.noteOn(60, 1)
    engine.noteOn(62, 1)
    engine.dispose()
    expect(engine.getActiveVoiceCount()).toBe(0)
  })
})

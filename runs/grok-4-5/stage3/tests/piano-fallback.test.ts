import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('piano.fallback', () => {
  it('enters labeled fallback when sample load forced to fail', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({
      createContext,
      useInlineSamples: false,
      sampleLibraryOptions: { forceFail: true },
    })
    await engine.init()
    expect(engine.getStatus()).toBe('fallback')
    expect(engine.getStatusMessage().toLowerCase()).toMatch(/fallback|fail/)
    // still playable
    const id = engine.noteOn(60, 0.9)
    expect(id).toBeTruthy()
    expect(engine.getActiveVoiceCount()).toBeGreaterThan(0)
    // must not claim primary library ready
    expect(engine.getStatus()).not.toBe('ready')
    engine.dispose()
  })

  it('partial family failure reports fallback not ready', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({
      createContext,
      useInlineSamples: false,
      sampleLibraryOptions: { forceFail: ['grand', 'upright', 'electric'] },
    })
    await engine.init()
    expect(['fallback', 'error']).toContain(engine.getStatus())
    if (engine.getStatus() === 'fallback') {
      expect(engine.noteOn(64, 0.7)).toBeTruthy()
    }
    engine.dispose()
  })
})

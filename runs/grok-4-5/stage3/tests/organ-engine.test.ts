import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('organ.engine', () => {
  it('two-layer note lifecycle with levels and cleanup', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setPianoState({ sectionOn: false })
    engine.setOrganState({ sectionOn: true })
    engine.updateOrganLayer('A', { enabled: true, level: 0.9 })
    engine.updateOrganLayer('B', { enabled: false, level: 0 })

    const id = engine.noteOn(60, 0.8, 'org')
    expect(id).toBeTruthy()
    expect(engine.getOrganVoiceCount()).toBe(1)
    engine.noteOff(id)
    engine.allNotesOff()
    expect(engine.getOrganVoiceCount()).toBe(0)

    engine.updateOrganLayer('B', { enabled: true, level: 0.6 })
    engine.noteOn(64, 0.7)
    expect(engine.getOrganVoiceCount()).toBe(2)
    engine.panic()
    expect(engine.getOrganVoiceCount()).toBe(0)
    engine.dispose()
  })

  it('shares one effect chain and single AudioContext', async () => {
    const { createContext, contexts } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    expect(contexts).toHaveLength(1)
    const g = engine.getGraphInfo()
    expect(g.hasChainOrgan).toBe(true)
    expect(g.singleContext).toBe(true)
    engine.setOrganState({ sectionOn: true })
    engine.updateChain('Organ', (c) => ({
      ...c,
      reverb: { ...c.reverb, on: true, mix: 0.5 },
    }))
    expect(engine.getEffectsState().chains.Organ.reverb.on).toBe(true)
    engine.dispose()
  })

  it('focus and octave shift', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setOrganState({ focus: 'B', sectionOn: true })
    engine.updateOrganLayer('A', { enabled: false })
    engine.updateOrganLayer('B', { enabled: true, octave: 1 })
    expect(engine.getOrganState().focus).toBe('B')
    expect(engine.getOrganState().layers.B.octave).toBe(1)
    engine.noteOn(60, 0.8)
    expect(engine.getOrganVoiceCount()).toBe(1)
    engine.dispose()
  })
})

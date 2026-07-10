import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('effects.graph', () => {
  it('uses one AudioContext with layer buses, effects, master, limiter', async () => {
    const { createContext, contexts } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    expect(contexts.length).toBe(1)
    const g = engine.getGraphInfo()
    expect(g.hasContext).toBe(true)
    expect(g.hasMaster).toBe(true)
    expect(g.hasLimiter).toBe(true)
    expect(g.hasLayerA).toBe(true)
    expect(g.hasLayerB).toBe(true)
    expect(g.hasChainA).toBe(true)
    expect(g.hasChainB).toBe(true)
    expect(g.hasRotary).toBe(true)
    engine.dispose()
  })

  it('cleans up voices and closes context on dispose', async () => {
    const { createContext, contexts } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.noteOn(60, 1)
    engine.noteOn(64, 1)
    expect(engine.getActiveVoiceCount()).toBeGreaterThan(0)
    engine.dispose()
    expect(engine.getActiveVoiceCount()).toBe(0)
    expect(contexts[0]!.state).toBe('closed')
  })

  it('master level is part of the graph path', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setMasterLevel(0.55)
    expect(engine.getMasterLevel()).toBeCloseTo(0.55)
    expect(engine.getGraphInfo().masterLevel).toBeCloseTo(0.55)
    engine.dispose()
  })
})

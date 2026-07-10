import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'
import { ProgramStore } from '../src/state/program-store'

describe('system.integration', () => {
  it('all engines share one AudioContext master path and Panic', async () => {
    const { createContext, contexts } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    expect(contexts).toHaveLength(1)
    engine.setPianoState({ sectionOn: true })
    engine.setOrganState({ sectionOn: true })
    engine.setSynthState({ sectionOn: true })
    engine.updateOrganLayer('A', { enabled: true })
    engine.updateSynthLayer('A', { enabled: true })
    engine.noteOn(60, 0.8)
    expect(engine.getTotalVoiceCount()).toBeGreaterThan(1)
    engine.panic()
    expect(engine.getTotalVoiceCount()).toBe(0)
    expect(engine.getGraphInfo().hasMaster).toBe(true)
    expect(engine.getGraphInfo().hasLimiter).toBe(true)
    expect(engine.getGraphInfo().singleContext).toBe(true)
    engine.dispose()
  })

  it('programs scenes zones morphs clock integrate', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    const store = new ProgramStore()
    store.selectProgram(6) // split factory
    engine.applyProgramSound(store.getWorking())
    expect(engine.getProgramSound().split.on).toBe(true)
    store.setScene('II')
    engine.applyProgramSound(store.getWorking())
    store.beginMorphAssign('Wheel')
    store.assignMorph('piano.levelA', 0, 1)
    engine.setProgramExtras({ morph: store.getWorking().morph })
    engine.applyMorphValues('Wheel', 0.5)
    engine.setProgramExtras({ masterClockBpm: 128, transpose: 2 })
    expect(engine.getMasterClockBpm()).toBe(128)
    expect(engine.getTranspose()).toBe(2)
    engine.dispose()
  })
})

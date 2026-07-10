import { beforeEach, describe, expect, it } from 'vitest'
import { ProgramStore } from '../src/state/program-store'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('scenes.switching', () => {
  let store: ProgramStore

  beforeEach(() => {
    store = new ProgramStore()
  })

  it('Scene I/II toggles layer enable without losing sound parameters', () => {
    const w = store.getWorking()
    w.piano.type = 'Clav'
    w.synth.layers.A.waveform = 'FM 2-op (algorithm A)'
    w.synth.layers.A.filterFreq = 0.42
    w.scenes.I = {
      pianoA: true,
      pianoB: false,
      organA: false,
      organB: false,
      synthA: false,
      synthB: false,
      synthC: false,
    }
    w.scenes.II = {
      pianoA: false,
      pianoB: false,
      organA: true,
      organB: false,
      synthA: true,
      synthB: false,
      synthC: false,
    }
    store.replaceWorking(w, false)

    store.setScene('I')
    expect(store.getWorking().piano.layers.A.enabled).toBe(true)
    expect(store.getWorking().synth.layers.A.enabled).toBe(false)
    expect(store.getWorking().piano.type).toBe('Clav')
    expect(store.getWorking().synth.layers.A.waveform).toBe('FM 2-op (algorithm A)')

    store.setScene('II')
    expect(store.getWorking().piano.layers.A.enabled).toBe(false)
    expect(store.getWorking().organ.layers.A.enabled).toBe(true)
    expect(store.getWorking().synth.layers.A.enabled).toBe(true)
    // sound params preserved
    expect(store.getWorking().piano.type).toBe('Clav')
    expect(store.getWorking().synth.layers.A.filterFreq).toBe(0.42)
  })

  it('engine reflects scene enables', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    store.setScene('II')
    engine.applyProgramSound(store.getWorking())
    expect(engine.getOrganState().layers.A.enabled).toBe(true)
    engine.dispose()
  })
})

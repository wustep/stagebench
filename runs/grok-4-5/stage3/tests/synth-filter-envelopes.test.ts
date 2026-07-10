import { describe, expect, it } from 'vitest'
import { filterSignature } from '../src/audio/synth-engine'
import { FILTER_TYPES } from '../src/model/synth-types'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('synth.filter-envelopes', () => {
  it('filter types tracking resonance drive alter state', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setSynthState({ sectionOn: true })
    for (const t of FILTER_TYPES) {
      engine.updateSynthLayer('A', {
        enabled: true,
        filterType: t,
        filterFreq: 0.4,
        filterRes: 0.6,
        filterDrive: 2,
        filterKbTrack: '1',
        filterEnvAmt: 0.7,
      })
      expect(engine.getSynthState().layers.A.filterType).toBe(t)
    }
    const a = filterSignature('LP12', 0.3, 0.1)
    const b = filterSignature('HP', 0.8, 0.5)
    expect(a).not.toBe(b)
    engine.dispose()
  })

  it('amp filter osc envelopes have observable parameters', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setPianoState({ sectionOn: false })
    engine.setSynthState({ sectionOn: true })
    engine.updateSynthLayer('A', {
      enabled: true,
      ampEnv: { attack: 0.5, decay: 0.6, release: 0.4, velocity: 3 },
      filterEnv: { attack: 0.3, decay: 0.5, release: 0.2, velocity: true, amount: 0.8 },
      oscEnv: { attack: 0.1, decay: 0.2, release: 0.3, velocity: false, amount: -0.4 },
    })
    const ls = engine.getSynthState().layers.A
    expect(ls.ampEnv.attack).toBe(0.5)
    expect(ls.filterEnv.velocity).toBe(true)
    expect(ls.oscEnv.amount).toBe(-0.4)
    engine.noteOn(60, 0.9)
    expect(engine.getSynthVoiceCount()).toBe(1)
    engine.allNotesOff()
    engine.dispose()
  })
})

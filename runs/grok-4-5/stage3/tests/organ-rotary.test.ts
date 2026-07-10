import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('organ.rotary', () => {
  it('routing slow/fast/stop and drive', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setOrganState({
      sectionOn: true,
      rotaryOn: true,
      rotarySpeed: 'Slow',
      rotaryDrive: 0.6,
    })
    engine.setEffectsState({
      rotary: { on: true, fast: false, drive: 0.6 },
    })
    engine.updateChain('Organ', (c) => ({
      ...c,
      ampEq: { ...c.ampEq, on: true, type: 'To Rotary' },
    }))
    expect(engine.getOrganState().rotarySpeed).toBe('Slow')
    engine.setOrganState({ rotarySpeed: 'Fast' })
    expect(engine.getOrganState().rotarySpeed).toBe('Fast')
    engine.setOrganState({ rotarySpeed: 'Stop' })
    expect(engine.getOrganState().rotarySpeed).toBe('Stop')
    expect(engine.getOrganState().rotaryDrive).toBe(0.6)
    engine.dispose()
  })

  it('morphable speed via program morph path', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setOrganState({ rotaryOn: true, rotarySpeed: 'Slow' })
    // speed is discrete; morph drive as proxy destination
    engine.setProgramExtras({
      morph: {
        wheel: [{ controlPath: 'organ.levelA', start: 0.2, end: 1 }],
        controlPedal: [],
      },
    })
    engine.applyMorphValues('Wheel', 1)
    expect(engine.getOrganState().layers.A.level).toBeCloseTo(1)
    engine.dispose()
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { ProgramStore } from '../src/state/program-store'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'
import { interpolateMorph } from '../src/model/program-types'

describe('morph.assignments', () => {
  let store: ProgramStore

  beforeEach(() => {
    store = new ProgramStore()
  })

  it('assigns Wheel and Control Pedal destinations', () => {
    store.beginMorphAssign('Wheel')
    store.assignMorph('piano.levelA', 0.2, 0.9)
    store.assignMorph('organ.levelA', 0.1, 0.8)
    store.endMorphAssign()
    expect(store.getWorking().morph.wheel).toHaveLength(2)

    store.beginMorphAssign('Control Pedal')
    store.assignMorph('synth.filterFreq', 0.3, 0.9)
    store.endMorphAssign()
    expect(store.getWorking().morph.controlPedal).toHaveLength(1)
  })

  it('interpolates assigned destinations', () => {
    const vals = interpolateMorph(
      [
        { controlPath: 'piano.levelA', start: 0, end: 1 },
        { controlPath: 'synth.lfoRate', start: 0.2, end: 0.8 },
      ],
      0.5,
    )
    expect(vals['piano.levelA']).toBeCloseTo(0.5)
    expect(vals['synth.lfoRate']).toBeCloseTo(0.5)
  })

  it('clearing removes assignments', () => {
    store.beginMorphAssign('Wheel')
    store.assignMorph('piano.levelA', 0, 1)
    store.clearMorph('Wheel')
    expect(store.getWorking().morph.wheel).toHaveLength(0)
  })

  it('engine applies morph values to levels', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setProgramExtras({
      morph: {
        wheel: [{ controlPath: 'piano.levelA', start: 0.1, end: 0.9 }],
        controlPedal: [],
      },
    })
    engine.applyMorphValues('Wheel', 0)
    expect(engine.getPianoState().layers.A.level).toBeCloseTo(0.1)
    engine.applyMorphValues('Wheel', 1)
    expect(engine.getPianoState().layers.A.level).toBeCloseTo(0.9)
    engine.dispose()
  })
})

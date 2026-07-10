import { beforeEach, describe, expect, it } from 'vitest'
import { ProgramStore } from '../src/state/program-store'
import { cloneProgramSound } from '../src/model/program-types'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('programs.roundtrip', () => {
  let store: ProgramStore

  beforeEach(() => {
    store = new ProgramStore()
  })

  it('save/load restores all supported state across 32 slots', () => {
    expect(store.getState().slots).toHaveLength(32)
    const working = store.getWorking()
    working.piano.type = 'Electric'
    working.organ.sectionOn = true
    working.organ.layers.A.model = 'B3'
    working.organ.layers.A.drawbars = [1, 0.5, 0.8, 0.4, 0.3, 0.2, 0.1, 0.1, 0.1]
    working.synth.sectionOn = true
    working.synth.layers.A.waveform = 'Super Saw'
    working.synth.layers.A.filterFreq = 0.33
    working.effects.chains.PianoA.reverb.on = true
    working.effects.chains.PianoA.reverb.mix = 0.77
    working.split.on = true
    working.split.points.Mid = { enabled: true, note: 'F4', crossfade: 12 }
    working.morph.wheel = [{ controlPath: 'piano.levelA', start: 0.2, end: 0.9 }]
    working.masterClockBpm = 140
    working.transpose = 3
    store.replaceWorking(working, true)
    expect(store.isDirty()).toBe(true)

    store.storePress()
    store.setStoreDest(15)
    store.confirmStore()
    expect(store.isDirty()).toBe(false)

    store.selectProgram(0)
    expect(store.getWorking().piano.type).not.toBe('Electric')

    store.selectProgram(15)
    const loaded = store.getWorking()
    expect(loaded.piano.type).toBe('Electric')
    expect(loaded.organ.layers.A.model).toBe('B3')
    expect(loaded.organ.layers.A.drawbars[0]).toBe(1)
    expect(loaded.synth.layers.A.waveform).toBe('Super Saw')
    expect(loaded.synth.layers.A.filterFreq).toBe(0.33)
    expect(loaded.effects.chains.PianoA.reverb.mix).toBe(0.77)
    expect(loaded.split.points.Mid.note).toBe('F4')
    expect(loaded.split.points.Mid.crossfade).toBe(12)
    expect(loaded.morph.wheel).toHaveLength(1)
    expect(loaded.masterClockBpm).toBe(140)
    expect(loaded.transpose).toBe(3)
  })

  it('dirty indicator is truthful', () => {
    expect(store.isDirty()).toBe(false)
    store.setWorking({ transpose: 2 })
    expect(store.isDirty()).toBe(true)
    expect(store.displayLabel()).toMatch(/E/)
    store.storePress()
    store.confirmStore()
    expect(store.isDirty()).toBe(false)
    expect(store.displayLabel()).not.toMatch(/ E$/)
  })

  it('engine applyProgramSound round-trips with store', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    store.selectProgram(3) // B3 Full factory
    engine.applyProgramSound(store.getWorking())
    expect(engine.getOrganState().sectionOn).toBe(true)
    expect(engine.getOrganState().layers.A.model).toBe('B3')
    const snap = engine.captureProgramSound()
    store.replaceWorking(snap, true)
    store.setStoreDest(20)
    store.storePress()
    store.confirmStore()
    store.selectProgram(20)
    engine.applyProgramSound(store.getWorking())
    expect(engine.getOrganState().layers.A.model).toBe('B3')
    engine.dispose()
  })

  it('clone preserves nested state', () => {
    const a = store.getSlot(5)
    const b = cloneProgramSound(a.state)
    b.synth.layers.A.filterRes = 0.99
    expect(a.state.synth.layers.A.filterRes).not.toBe(0.99)
  })
})

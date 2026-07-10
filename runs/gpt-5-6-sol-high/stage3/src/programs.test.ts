import { describe, expect, it } from 'vitest'
import { createInitialInstrumentState } from './instrument'
import {
  PROGRAM_STORAGE_KEY, arpSequence, assignMorph, autoStoreLive, captureProgram, clearMorph,
  createProgramMemory, isProgramDirty, loadProgramMemory, morphedValue, restoreProgram,
  routeLayerGain, saveProgramMemory, selectLive, selectProgram, setLayerEnabled, storeAt,
  switchScene, tempoFromTaps, type ProgramStorageLike,
} from './programs'

class MemoryStorage implements ProgramStorageLike {
  value = new Map<string, string>()
  getItem(key: string) { return this.value.get(key) ?? null }
  setItem(key: string, value: string) { this.value.set(key, value) }
}

describe('Phase 3 program and performance system', () => {
  it('ships 32 programs, eight distinct factories, eight Live slots, navigation, Store and Store As', () => {
    const initial = createInitialInstrumentState()
    let memory = createProgramMemory(initial)
    expect(memory.programs).toHaveLength(32)
    expect(memory.live).toHaveLength(8)
    expect(new Set(memory.programs.slice(0, 8).map((slot) => slot.name)).size).toBe(8)
    memory = selectProgram(memory, 25)
    expect(memory).toMatchObject({ selectedProgram: 25, page: 3, liveMode: false })
    const edited = { ...initial, transpose: 4, masterClockBpm: 137 }
    memory = storeAt(memory, 25, edited, 'My Split')
    expect(memory.programs[25].name).toBe('My Split')
    expect(restoreProgram(memory.programs[25].state, initial)).toMatchObject({ transpose: 4, masterClockBpm: 137 })
    for (let index = 0; index < 32; index += 1) memory = storeAt(memory, index, { ...initial, transpose: index % 13 - 6 }, `Slot ${index + 1}`)
    for (let index = 0; index < 32; index += 1) expect(memory.programs[index].state.transpose).toBe(index % 13 - 6)
  })

  it('round-trips all supported state, excludes Master Level, tracks dirty truthfully, and discards edits on selection', () => {
    const runtime = createInitialInstrumentState()
    runtime.masterLevel = .21
    runtime.organ.layers.A.enabled = true
    runtime.organ.layers.A.drawbars[4] = 8
    runtime.synth.layers.C.enabled = true
    runtime.synth.layers.C.filterFreq = .23
    runtime.splits.enabled = true
    runtime.transpose = -3
    runtime.morphs.assignments.wheel = [{ destination: 'synth:C:filterFreq', start: .23, end: .9 }]
    const saved = captureProgram(runtime)
    expect(saved.masterLevel).toBe(.72)
    const changed = structuredClone(runtime)
    changed.synth.layers.C.filterFreq = .91
    let memory = createProgramMemory(runtime)
    memory = storeAt(memory, 0, runtime, 'Round Trip')
    expect(isProgramDirty(runtime, memory)).toBe(false)
    expect(isProgramDirty(changed, memory)).toBe(true)
    memory = selectProgram(memory, 0)
    const restored = restoreProgram(memory.programs[0].state, { ...changed, masterLevel: .88 })
    expect(restored.organ.layers.A.drawbars[4]).toBe(8)
    expect(restored.synth.layers.C.filterFreq).toBe(.23)
    expect(restored.morphs.assignments.wheel).toHaveLength(1)
    expect(restored.masterLevel).toBe(.88)
  })

  it('auto-stores Live edits and persists regular and Live memories through the storage boundary', () => {
    const initial = createInitialInstrumentState()
    let memory = selectLive(createProgramMemory(initial), 4)
    memory = autoStoreLive(memory, { ...initial, transpose: 6 })
    expect(memory.live[4].state.transpose).toBe(6)
    for (let index = 0; index < 8; index += 1) {
      memory = autoStoreLive(selectLive(memory, index), { ...initial, transpose: index - 4 })
    }
    for (let index = 0; index < 8; index += 1) expect(memory.live[index].state.transpose).toBe(index - 4)
    memory = storeAt({ ...memory, liveMode: false }, 9, { ...initial, masterClockBpm: 166 }, 'Saved')
    const storage = new MemoryStorage()
    saveProgramMemory(memory, storage)
    expect(storage.getItem(PROGRAM_STORAGE_KEY)).toContain('Saved')
    const loaded = loadProgramMemory(initial, storage)
    expect(loaded.programs[9].state.masterClockBpm).toBe(166)
    expect(loaded.live[4].state.transpose).toBe(0)
  })

  it('routes four zones at editable documented points with Off, ±6, and ±12 crossfades', () => {
    const state = createInitialInstrumentState()
    state.splits.enabled = true
    state.splits.points = [
      { enabled: true, position: 'C3', crossfade: 0 },
      { enabled: true, position: 'C4', crossfade: 6 },
      { enabled: true, position: 'C5', crossfade: 12 },
    ]
    expect(routeLayerGain(state, { from: 0, to: 0 }, 47)).toBe(1)
    expect(routeLayerGain(state, { from: 0, to: 0 }, 48)).toBe(0)
    expect(routeLayerGain(state, { from: 2, to: 2 }, 54)).toBeCloseTo(0)
    expect(routeLayerGain(state, { from: 2, to: 2 }, 60)).toBeCloseTo(.5)
    expect(routeLayerGain(state, { from: 2, to: 2 }, 66)).toBeCloseTo(.75)
    expect(routeLayerGain(state, { from: 2, to: 2 }, 72)).toBeCloseTo(.5)
  })

  it('switches scene enable maps without duplicating sound parameters', () => {
    let state = createInitialInstrumentState()
    state.synth.layers.A.filterFreq = .37
    state = setLayerEnabled(state, 'synth:A', false)
    state.scenes.layers.II['synth:A'] = true
    const sceneII = switchScene(state, 'II')
    expect(sceneII.synth.layers.A.enabled).toBe(true)
    expect(sceneII.synth.layers.A.filterFreq).toBe(.37)
    const sceneI = switchScene(sceneII, 'I')
    expect(sceneI.synth.layers.A.enabled).toBe(false)
    expect(sceneI.synth.layers.A.filterFreq).toBe(.37)
  })

  it('assigns, interpolates, indicates, and clears Wheel and Control Pedal morph destinations', () => {
    let state = createInitialInstrumentState()
    state = assignMorph(state, 'wheel', 'synth:A:filterFreq', .2, .9)
    state = assignMorph(state, 'controlPedal', 'organ:A', .7, .2)
    state.morphs.values.wheel = .5
    state.morphs.values.controlPedal = 1
    expect(morphedValue(state, 'synth:A:filterFreq', .2)).toBeCloseTo(.55)
    expect(morphedValue(state, 'organ:A', .7)).toBeCloseTo(.2)
    state = clearMorph(state, 'wheel')
    expect(state.morphs.assignments.wheel).toHaveLength(0)
  })

  it('derives master tempo from four taps and produces deterministic arp directions and ranges', () => {
    expect(tempoFromTaps([0, 500, 1000, 1500])).toBe(120)
    expect(arpSequence([64, 60, 67], 'Up', 2, 8)).toEqual([60, 64, 67, 72, 76, 79, 60, 64])
    expect(arpSequence([60, 64], 'Down', 1, 4)).toEqual([64, 60, 64, 60])
    expect(arpSequence([60, 64], 'Random', 2, 12)).toEqual(arpSequence([60, 64], 'Random', 2, 12))
  })
})

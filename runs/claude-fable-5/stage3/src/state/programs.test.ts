import { describe, expect, it } from 'vitest'
import {
  applyProgram,
  factoryPrograms,
  initialInstrumentState,
  InstrumentStore,
  isProgramDirty,
  morphedState,
  serializeProgram,
  slotLabel,
  type ProgramStorage,
} from './instrument'

function memoryStorage(): ProgramStorage & { raw: string | null } {
  const box = {
    raw: null as string | null,
    load: () => box.raw,
    save: (value: string) => {
      box.raw = value
    },
  }
  return box
}

describe('program model', () => {
  it('boots with 32 program slots and 8 Live slots', () => {
    const state = initialInstrumentState()
    expect(state.programs.slots).toHaveLength(32)
    expect(state.programs.live).toHaveLength(8)
    expect(state.programs.current).toEqual({ bank: 'program', index: 0 })
    expect(factoryPrograms()).toHaveLength(32)
  })

  it('slot labels follow the page.button convention', () => {
    expect(slotLabel({ bank: 'program', index: 0 })).toBe('1.1')
    expect(slotLabel({ bank: 'program', index: 7 })).toBe('1.8')
    expect(slotLabel({ bank: 'program', index: 8 })).toBe('2.1')
    expect(slotLabel({ bank: 'program', index: 31 })).toBe('4.8')
    expect(slotLabel({ bank: 'live', index: 2 })).toBe('L3')
  })

  it('serialize/apply round-trips every supported program parameter', () => {
    const store = new InstrumentStore()
    // Touch state across every section so the round-trip is meaningful.
    store.setLayerLevel('A', 87)
    store.cyclePianoType()
    store.setDrawbar(4, 6)
    store.cycleOrganModel()
    store.toggleOrganLayer('B')
    store.togglePercussion('on')
    store.setSynthLevel('A', 92)
    store.toggleSynthLayer('A')
    store.cycleSynthCategory()
    store.setSynthFilter({ freq: 55 }, 'f')
    store.setOscCtrl(83)
    store.toggleSplit()
    store.setZoneRange('pianoA', { from: 1, to: 2 })
    store.setClockBpm(147)
    store.setTranspose(3)
    store.toggleMorphCapture('wheel')
    store.setLayerLevel('B', 40) // captured as a morph assignment
    store.toggleMorphCapture('wheel')
    store.toggleUnitOn('reverb')
    const snapshot = serializeProgram(store.getState())
    const restored = applyProgram(initialInstrumentState(), snapshot)
    expect(serializeProgram(restored)).toEqual(snapshot)
    // And the restored state carries the concrete values.
    expect(restored.layers.A.level).toBe(87)
    expect(restored.organ.layers.A.drawbars[4]).toBe(6)
    expect(restored.organ.percussion.on).toBe(true)
    expect(restored.synth.layers.A.enabled).toBe(true)
    expect(restored.synth.layers.A.filter.freq).toBe(55)
    expect(restored.split.on).toBe(true)
    expect(restored.zones.pianoA).toEqual({ from: 1, to: 2 })
    expect(restored.clockBpm).toBe(147)
    expect(restored.transpose.semitones).toBe(3)
    expect(restored.morphs.wheel).toHaveLength(1)
  })
})

describe('program lifecycle (store, dirty, undo, live mode)', () => {
  it('edits mark the program dirty; loading another slot discards them with Undo available', () => {
    const store = new InstrumentStore()
    expect(isProgramDirty(store.getState())).toBe(false)
    store.setLayerLevel('A', 33)
    expect(isProgramDirty(store.getState())).toBe(true)
    store.selectSlot({ bank: 'program', index: 1 })
    // Edits discarded: slot 2 loads its own stored level.
    expect(store.getState().programs.current).toEqual({ bank: 'program', index: 1 })
    expect(isProgramDirty(store.getState())).toBe(false)
    // Undo returns to slot 1 with the edits restored.
    store.undoProgramChange()
    expect(store.getState().programs.current).toEqual({ bank: 'program', index: 0 })
    expect(store.getState().layers.A.level).toBe(33)
    expect(isProgramDirty(store.getState())).toBe(true)
  })

  it('STORE: destination step + confirm writes the edit buffer and clears dirty', () => {
    const store = new InstrumentStore()
    store.setLayerLevel('A', 25)
    store.pressStore()
    expect(store.getState().programs.storeFlow?.step).toBe('destination')
    // Audition a different destination via the program buttons.
    store.selectSlot({ bank: 'program', index: 5 })
    expect(store.getState().programs.storeFlow?.step).toBe('destination')
    store.pressStore() // confirm
    const state = store.getState()
    expect(state.programs.storeFlow).toBeNull()
    expect(state.programs.current).toEqual({ bank: 'program', index: 5 })
    expect(state.programs.slots[5]!.pianoLayers.A.level).toBe(25)
    expect(isProgramDirty(state)).toBe(false)
  })

  it('Shift cancels a pending store and returns to the origin with edits intact', () => {
    const store = new InstrumentStore()
    store.setLayerLevel('A', 25)
    store.pressStore()
    store.selectSlot({ bank: 'program', index: 9 })
    store.exitModes() // Shift/Exit
    const state = store.getState()
    expect(state.programs.storeFlow).toBeNull()
    expect(state.programs.current).toEqual({ bank: 'program', index: 0 })
    expect(state.layers.A.level).toBe(25)
    expect(isProgramDirty(state)).toBe(true)
  })

  it('STORE AS: naming flow edits characters and stores under the new name', () => {
    const store = new InstrumentStore()
    store.pressStoreAs()
    expect(store.getState().programs.storeFlow?.step).toBe('naming')
    store.turnDial(1) // edit first character
    const named = store.getState().programs.storeFlow
    expect(named?.step).toBe('naming')
    store.pressStore() // proceed to destination
    expect(store.getState().programs.storeFlow?.step).toBe('destination')
    store.pressStore() // confirm
    const state = store.getState()
    expect(state.programs.storeFlow).toBeNull()
    expect(state.programs.slots[0]!.name).toBe(state.programName)
  })

  it('Live Mode auto-stores every edit into the active Live slot and persists', () => {
    const storage = memoryStorage()
    const store = new InstrumentStore({ storage })
    store.toggleLiveMode()
    expect(store.getState().programs.current.bank).toBe('live')
    store.setLayerLevel('A', 41)
    const live = store.getState().programs.live[0]!
    expect(live.pianoLayers.A.level).toBe(41)
    expect(storage.raw).toContain('"level":41')
    // A fresh store restores the persisted Live content.
    const reborn = new InstrumentStore({ storage })
    expect(reborn.getState().programs.live[0]!.pianoLayers.A.level).toBe(41)
  })

  it('pages and program buttons address all 32 slots (4 pages × 8 buttons)', () => {
    const store = new InstrumentStore()
    store.stepPage(1)
    expect(store.getState().programs.page).toBe(1)
    store.selectProgramButton(2) // page 2, button 3 → slot index 10
    expect(store.getState().programs.current).toEqual({ bank: 'program', index: 10 })
    store.stepPage(1)
    store.stepPage(1)
    expect(store.getState().programs.page).toBe(3)
    store.stepPage(1) // clamped at the last page
    expect(store.getState().programs.page).toBe(3)
    store.selectProgramButton(7)
    expect(store.getState().programs.current).toEqual({ bank: 'program', index: 31 })
  })

  it('program dial browses; Shift+dial browses the numeric list without loading', () => {
    const store = new InstrumentStore()
    store.turnDial(2)
    expect(store.getState().programs.current.index).toBe(2)
    store.turnDial(3, true)
    expect(store.getState().programs.listCursor).toBe(5)
    expect(store.getState().programs.current.index).toBe(2) // not loaded yet
    store.closeListView()
    expect(store.getState().programs.current.index).toBe(5)
    expect(store.getState().programs.listCursor).toBeNull()
  })
})

describe('splits, scenes, morphs, clock, transpose', () => {
  it('split editing steps points through the 11 documented positions and cycles crossfades', () => {
    const store = new InstrumentStore()
    store.toggleSplitEdit()
    expect(store.getState().split.on).toBe(true)
    expect(store.getState().programs.splitEdit).toBe('mid')
    store.turnDial(3) // dial routes to split position
    expect(store.getState().split.points.mid.active).toBe(true)
    store.stepSplitEditPoint(1)
    expect(store.getState().programs.splitEdit).toBe('high')
    store.stepSplitEditPoint(-1)
    store.toggleSplit() // cycles xfade while editing
    expect(store.getState().split.points.mid.xfade).not.toBe(0)
    store.exitModes()
    expect(store.getState().programs.splitEdit).toBeNull()
  })

  it('layer scenes swap layer enables without touching sound parameters', () => {
    const store = new InstrumentStore()
    store.setDrawbar(4, 7)
    store.toggleOrganLayer('B')
    store.toggleScene()
    const sceneII = store.getState()
    expect(sceneII.scenes.active).toBe('II')
    expect(sceneII.organ.layers.A.drawbars[4]).toBe(7) // sound untouched
    store.toggleScene()
    const back = store.getState()
    expect(back.scenes.active).toBe('I')
    expect(back.organ.layers.B.enabled).toBe(true) // scene I remembered the enable
  })

  it('morph assign records from→to; the wheel interpolates; zeroing clears', () => {
    const store = new InstrumentStore()
    const base = store.getState().layers.A.level
    store.toggleMorphCapture('wheel')
    store.setLayerLevel('A', 20)
    store.toggleMorphCapture('wheel')
    const assignment = store.getState().morphs.wheel[0]!
    expect(assignment.from).toBe(base)
    expect(assignment.to).toBe(20)
    expect(store.getState().layers.A.level).toBe(base) // base unchanged
    // Interpolation at half wheel travel.
    store.setMorphValue('wheel', 0.5)
    const half = morphedState(store.getState())
    expect(half.layers.A.level).toBeCloseTo(base + (20 - base) * 0.5, 0)
    store.setMorphValue('wheel', 1)
    expect(morphedState(store.getState()).layers.A.level).toBe(20)
    // Setting the destination back onto the base clears the assignment.
    store.toggleMorphCapture('wheel')
    store.setLayerLevel('A', assignment.from)
    expect(store.getState().morphs.wheel).toHaveLength(0)
  })

  it('control pedal morphs are independent of the wheel and clearable', () => {
    const store = new InstrumentStore()
    store.toggleMorphCapture('pedal')
    store.setDrawbar(4, 8)
    store.toggleMorphCapture('pedal')
    expect(store.getState().morphs.pedal).toHaveLength(1)
    expect(store.getState().morphs.wheel).toHaveLength(0)
    store.setMorphValue('pedal', 1)
    expect(morphedState(store.getState()).organ.layers.A.drawbars[4]).toBe(8)
    store.clearMorphAssignments('pedal')
    expect(store.getState().morphs.pedal).toHaveLength(0)
  })

  it('master clock: set mode routes the dial to BPM within 30–300', () => {
    const store = new InstrumentStore()
    store.toggleClockSet()
    store.turnDial(60)
    expect(store.getState().clockBpm).toBe(180)
    store.turnDial(500)
    expect(store.getState().clockBpm).toBe(300)
    store.turnDial(-999)
    expect(store.getState().clockBpm).toBe(30)
    store.toggleClockSet()
    expect(store.getState().programs.clockSet).toBe(false)
  })

  it('transpose: ±6 semitones with on/off latch', () => {
    const store = new InstrumentStore()
    store.toggleTransposeSet()
    store.turnDial(4)
    expect(store.getState().transpose.semitones).toBe(4)
    expect(store.getState().transpose.on).toBe(true)
    store.turnDial(9)
    expect(store.getState().transpose.semitones).toBe(6) // clamped
    store.toggleTranspose()
    expect(store.getState().transpose.on).toBe(false)
  })
})

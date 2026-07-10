import { beforeEach, describe, expect, it } from 'vitest'
import { ProgramStore } from '../src/state/program-store'

describe('programs.undo-cancel', () => {
  let store: ProgramStore

  beforeEach(() => {
    store = new ProgramStore()
  })

  it('edit-discard on program change', () => {
    store.selectProgram(0)
    const original = store.getWorking().transpose
    store.setWorking({ transpose: 5 })
    expect(store.isDirty()).toBe(true)
    // change program without store — discards
    store.selectProgram(1)
    store.selectProgram(0)
    expect(store.getWorking().transpose).toBe(original)
    expect(store.isDirty()).toBe(false)
  })

  it('cancel store mode leaves memory unchanged', () => {
    store.selectProgram(2)
    const name = store.currentName()
    store.setWorking({ transpose: 6 })
    store.storePress()
    expect(store.getState().storeMode).toBe('store')
    store.cancelStore()
    expect(store.getState().storeMode).toBe('off')
    // still dirty, not written
    store.selectProgram(3)
    store.selectProgram(2)
    expect(store.getSlot(2).name).toBe(name)
  })
})

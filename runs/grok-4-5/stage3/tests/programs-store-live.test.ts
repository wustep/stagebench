import { beforeEach, describe, expect, it } from 'vitest'
import { ProgramStore } from '../src/state/program-store'

describe('programs.store-live', () => {
  let store: ProgramStore

  beforeEach(() => {
    store = new ProgramStore()
  })

  it('Store writes current working state to destination', () => {
    store.setWorking({ transpose: 4 })
    store.storePress()
    expect(store.getState().storeMode).toBe('store')
    store.setStoreDest(7)
    store.confirmStore()
    store.selectProgram(7)
    expect(store.getWorking().transpose).toBe(4)
  })

  it('Store As with naming', () => {
    store.setWorking({ masterClockBpm: 180 })
    store.storeAsPress()
    store.setStoreName('My Lead')
    store.setStoreDest(10)
    store.confirmStore()
    expect(store.getSlot(10).name).toBe('My Lead')
    store.selectProgram(10)
    expect(store.getWorking().masterClockBpm).toBe(180)
  })

  it('8 Live slots auto-store edits', () => {
    expect(store.getState().liveSlots).toHaveLength(8)
    store.selectLive(2)
    expect(store.getState().liveMode).toBe(true)
    store.setWorking({ transpose: -3 })
    // auto-stored, not dirty
    expect(store.isDirty()).toBe(false)
    store.selectLive(0)
    store.selectLive(2)
    expect(store.getWorking().transpose).toBe(-3)
  })

  it('Live mode toggle restores regular program', () => {
    store.selectProgram(1)
    const name = store.currentName()
    store.setLiveMode(true)
    expect(store.getState().liveMode).toBe(true)
    store.setLiveMode(false)
    expect(store.currentName()).toBe(name)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { ProgramStore } from '../src/state/program-store'

describe('programs.navigation', () => {
  let store: ProgramStore

  beforeEach(() => {
    store = new ProgramStore()
  })

  it('program buttons and pages select slots', () => {
    store.selectProgram(0)
    expect(store.getState().currentSlot).toBe(0)
    store.pageUp()
    expect(store.getState().page).toBe(1)
    expect(store.getState().currentSlot).toBe(8)
    store.pageUp()
    store.pageUp()
    expect(store.getState().page).toBe(3)
    store.pageDown()
    expect(store.getState().page).toBe(2)
  })

  it('dial browses programs', () => {
    store.selectProgram(5)
    store.dialBrowse(1)
    expect(store.getState().currentSlot).toBe(6)
    store.dialBrowse(-3)
    expect(store.getState().currentSlot).toBe(3)
  })

  it('numeric list view', () => {
    store.setListView(true)
    expect(store.getState().listView).toBe(true)
    expect(store.displayLabel()).toMatch(/1:/)
    store.setListView(false)
    expect(store.displayLabel()).toMatch(/^\d\.\d/)
  })

  it('ships at least 8 factory programs with distinct names', () => {
    const names = store.getState().slots.slice(0, 8).map((s) => s.name)
    expect(new Set(names).size).toBeGreaterThanOrEqual(8)
    expect(names[0]).toMatch(/Grand/i)
  })
})

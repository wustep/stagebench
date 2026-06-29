import { describe, expect, it } from 'vitest'
import { MenuController } from './MenuController'

describe('contextual menu navigation', () => {
  it('navigates pages, edits parameters and confirms an edit', () => {
    const menu = new MenuController(['Program', 'Split', 'Effects'])
    menu.open('program-dial')
    menu.next()
    menu.beginEdit(60)
    menu.setDraft(64)
    expect(menu.snapshot()).toMatchObject({ open: true, page: 'Split', draft: 64 })
    expect(menu.confirm()).toBe(64)
    expect(menu.snapshot().editing).toBe(false)
  })

  it('cancels edits and returns focus to the invoking hardware control', () => {
    const menu = new MenuController(['Program', 'Split'])
    menu.open('program-page')
    menu.beginEdit(48)
    menu.setDraft(72)
    expect(menu.cancel()).toBe(48)
    expect(menu.close()).toBe('program-page')
    expect(menu.snapshot().open).toBe(false)
  })
})

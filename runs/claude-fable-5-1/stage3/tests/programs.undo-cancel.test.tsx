import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { isDirty } from '../src/state/instrumentState'
import { programOf, programsEqual } from '../src/state/programState'
import { armShift, click, el, mountApp, turnDial, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

describe('programs.undo-cancel — edit-discard on program change and Undo restores the documented prior state', () => {
  it('selecting another program discards unstored edits; the original slot reloads with its stored settings', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const stored = state.get().bank.programs[0]
    fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'Home' })
    click('piano.layer-b.on')
    expect(isDirty(state.get())).toBe(true)
    click('program.button.2')
    expect(state.get().bank.slot).toBe(1)
    expect(isDirty(state.get())).toBe(false)
    click('program.button.1')
    expect(programsEqual(programOf(state.get()), stored)).toBe(true)
    expect(state.get().piano.layers.B.on).toBe(false)
    expect(Number(el('effects.reverb.dry-wet').getAttribute('aria-valuenow'))).toBe(6)
    expect(el('piano.layer-b.on').getAttribute('aria-pressed')).toBe('false')
  })

  it('UNDO (Shift + Solo) restores the discarded edited program at its slot, marked E again', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'Home' })
    click('organ.on')
    const edited = programOf(state.get())
    turnDial('program.dial', 3)
    expect(state.get().bank.slot).toBe(3)
    expect(state.get().undo).toMatchObject({ slot: 0, live: false })
    armShift()
    click('program.solo')
    expect(state.get().view.mode).toBe('undo')
    expect(el('program.oled').textContent).toMatch(/UNDO program change/)
    click('program.button.1')
    expect(state.get().view.mode).toBe('program')
    expect(state.get().bank.slot).toBe(0)
    expect(programsEqual(programOf(state.get()), edited)).toBe(true)
    expect(isDirty(state.get())).toBe(true)
    expect(state.get().organ.on).toBe(true)
    expect(el('organ.on').getAttribute('aria-pressed')).toBe('true')
    expect(state.get().undo).toBeNull()
  })

  it('Undo can be cancelled with Shift/Exit and reports when there is nothing to undo', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    armShift()
    click('program.solo')
    expect(state.get().view.mode).toBe('program')
    expect(el('program.oled').textContent).toMatch(/nothing to undo/i)
    fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'Home' })
    click('program.button.2')
    armShift()
    click('program.solo')
    expect(state.get().view.mode).toBe('undo')
    click('program.shift')
    expect(state.get().view.mode).toBe('program')
    expect(state.get().bank.slot).toBe(1)
    expect(state.get().undo).not.toBeNull()
  })

  it('a pending Store cancelled with Shift/Exit restores the edited program, and a confirmed Store clears Undo', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'Home' })
    const edited = programOf(state.get())
    click('program.store')
    turnDial('program.dial', 2)
    expect(programsEqual(programOf(state.get()), edited)).toBe(false)
    click('program.shift')
    expect(programsEqual(programOf(state.get()), edited)).toBe(true)
    click('program.store')
    click('program.store')
    expect(state.get().undo).toBeNull()
    expect(isDirty(state.get())).toBe(false)
  })
})

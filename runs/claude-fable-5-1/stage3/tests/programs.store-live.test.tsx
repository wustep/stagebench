import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BANK_STORAGE_KEY } from '../src/state/bankStorage'
import { programOf, programsEqual } from '../src/state/programState'
import { armShift, click, el, memoryStorage, mountApp, turnDial, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

describe('programs.store-live — Store, Store As with naming, and the 8 auto-storing Live slots', () => {
  it('STORE once flashes and shows the destination (auditioned); dial / page / program buttons move it; STORE again confirms', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'Home' })
    const edited = programOf(state.get())
    click('program.store')
    const oled = el('program.oled')
    expect(state.get().view.mode).toBe('store')
    expect(oled.textContent).toMatch(/STORE PROGRAM TO/)
    expect(oled.textContent).toMatch(/1\.1 Init Grand/)
    expect(el('program.store').getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('.led-store-pending')).not.toBeNull()
    // dial → 1.3, which becomes audible for auditioning (its stored settings are live on the panel)
    turnDial('program.dial', 2)
    expect(state.get().view.store).toEqual({ live: false, slot: 2 })
    expect(oled.textContent).toMatch(/1\.3 B3 Soulful/)
    expect(state.get().name).toBe('B3 Soulful')
    expect(state.get().organ.on).toBe(true)
    expect(Number(el('effects.reverb.dry-wet').getAttribute('aria-valuenow'))).toBe(3) // the audition's own settings
    // program button 5 → 1.5, page ▶ → 2.5
    click('program.button.5')
    expect(state.get().view.store!.slot).toBe(4)
    fireEvent.pointerDown(el('program.page-next'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('program.page-next'), { pointerId: 1 })
    expect(state.get().view.store!.slot).toBe(12)
    click('program.store')
    expect(state.get().view.mode).toBe('program')
    expect(state.get().bank.slot).toBe(12)
    expect(programsEqual(state.get().bank.programs[12], edited)).toBe(true)
    expect(programsEqual(programOf(state.get()), edited)).toBe(true)
    expect(el('program.store').getAttribute('aria-pressed')).toBe('false')
    expect(oled.textContent).toMatch(/2\.5 Init Grand/)
  })

  it('Shift/Exit cancels a pending Store: the edited program comes back, nothing is written', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'Home' })
    const edited = programOf(state.get())
    const before = state.get().bank.programs.map((p) => p.name)
    click('program.store')
    turnDial('program.dial', 5)
    expect(state.get().name).toBe('Pipe Chapel')
    click('program.shift')
    expect(state.get().view.mode).toBe('program')
    expect(programsEqual(programOf(state.get()), edited)).toBe(true)
    expect(state.get().bank.slot).toBe(0)
    expect(state.get().bank.programs.map((p) => p.name)).toEqual(before)
    expect(el('program.oled').dataset.dirty).toBe('true')
  })

  it('STORE AS names the program (ABC characters, cursor, Ins, Del) before the destination step', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    armShift()
    click('program.store')
    expect(state.get().view.mode).toBe('storeAs')
    expect(el('program.oled').textContent).toMatch(/STORE PROGRAM AS/)
    expect(state.get().view.naming).toEqual({ name: 'Init Grand', cursor: 0, charMode: false })
    // ABC (soft button 1): the dial changes the character under the cursor
    click('program.button.1')
    expect(state.get().view.naming!.charMode).toBe(true)
    turnDial('program.dial', 1) // 'I' → 'J'
    expect(state.get().view.naming!.name).toBe('Jnit Grand')
    click('program.button.1')
    // cursor with the dial and the page buttons, Ins inserts a space, Del deletes
    turnDial('program.dial', 4)
    expect(state.get().view.naming!.cursor).toBe(4)
    fireEvent.pointerDown(el('program.page-next'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('program.page-next'), { pointerId: 1 })
    expect(state.get().view.naming!.cursor).toBe(5)
    click('program.button.3')
    expect(state.get().view.naming!.name).toBe('Jnit  Grand')
    click('program.button.4')
    expect(state.get().view.naming!.name).toBe('Jnit Grand')
    // STORE → destination step (dial → 1.2), STORE → written with the new name
    click('program.store')
    expect(state.get().view.mode).toBe('store')
    expect(state.get().view.pending!.name).toBe('Jnit Grand')
    turnDial('program.dial', 1)
    click('program.store')
    expect(state.get().bank.programs[1].name).toBe('Jnit Grand')
    expect(state.get().name).toBe('Jnit Grand')
    expect(el('program.oled').textContent).toMatch(/1\.2 Jnit Grand/)
    expect(el('program-status').textContent).toMatch(/1\.2/)
  })

  it('Live Mode: eight slots (factory copies of 1.1–1.8) that store every edit automatically and survive a reload', async () => {
    const storage = memoryStorage()
    mounted = await mountApp({ storage })
    const { state } = mounted.services
    expect(state.get().bank.live.map((p) => p.name)).toEqual(state.get().bank.programs.slice(0, 8).map((p) => p.name))
    click('program.live-mode')
    expect(state.get().bank.liveMode).toBe(true)
    expect(el('program.live-mode').getAttribute('aria-pressed')).toBe('true')
    click('program.button.3')
    expect(state.get().bank.liveSlot).toBe(2)
    expect(el('program.oled').dataset.slot).toBe('L3')
    expect(state.get().name).toBe('B3 Soulful')
    // an edit is stored immediately and never shows E
    fireEvent.keyDown(el('organ.drawbar.4'), { key: 'End' })
    expect(state.get().bank.live[2].organ.layers.A.drawbars[3]).toBe(8)
    expect(el('program.oled').dataset.dirty).toBe('false')
    // persisted (debounced) through the storage boundary
    expect(storage.getItem(BANK_STORAGE_KEY)).toBeNull()
    mounted.world.timers.advance(300)
    expect(storage.getItem(BANK_STORAGE_KEY)).not.toBeNull()
    // leaving and returning to the Live program keeps the edit
    click('program.button.4')
    click('program.button.3')
    expect(state.get().organ.layers.A.drawbars[3]).toBe(8)
    // reload the app with the same storage: the Live edit is back
    mounted.unmount()
    mounted = await mountApp({ storage })
    const s2 = mounted.services.state
    expect(s2.get().bank.live[2].organ.layers.A.drawbars[3]).toBe(8)
    expect(s2.get().bank.live[2].name).toBe('B3 Soulful')
    click('program.live-mode')
    click('program.button.3')
    expect(Number(el('organ.drawbar.4').getAttribute('aria-valuenow'))).toBe(8)
  })

  it('programs copy between Live and regular slots through Store (LIVE MODE picks the Live destinations)', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    // regular 1.6 → Live 2
    click('program.button.6')
    click('program.store')
    click('program.live-mode')
    expect(state.get().view.store).toEqual({ live: true, slot: 0 })
    click('program.button.2')
    expect(state.get().view.store).toEqual({ live: true, slot: 1 })
    click('program.store')
    expect(state.get().bank.live[1].name).toBe('Pipe Chapel')
    expect(state.get().bank.liveMode).toBe(true)
    // Live 2 (edited) → regular 3.1
    fireEvent.keyDown(el('effects.reverb.dry-wet'), { key: 'Home' })
    click('program.store')
    click('program.live-mode')
    expect(state.get().view.store!.live).toBe(false)
    fireEvent.pointerDown(el('program.page-next'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('program.page-next'), { pointerId: 1 })
    fireEvent.pointerDown(el('program.page-next'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('program.page-next'), { pointerId: 1 })
    click('program.button.1')
    expect(state.get().view.store).toEqual({ live: false, slot: 16 })
    click('program.store')
    expect(state.get().bank.programs[16].name).toBe('Pipe Chapel')
    expect(state.get().bank.programs[16].effects.chains.organ.reverb.dryWet).toBe(0)
    expect(state.get().bank.liveMode).toBe(false)
    expect(state.get().bank.slot).toBe(16)
  })
})

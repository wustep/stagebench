import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { slotLabel } from '../src/state/programState'
import { armShift, click, el, mountApp, turnDial, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

function page(direction: 1 | -1) {
  const id = direction > 0 ? 'program.page-next' : 'program.page-prev'
  fireEvent.pointerDown(el(id), { pointerId: 1, button: 0 })
  fireEvent.pointerUp(el(id), { pointerId: 1 })
}

describe('programs.navigation — program buttons, pages, dial, and the numeric list view', () => {
  it('program buttons select within the page and the page buttons move through the four pages of eight', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const oled = el('program.oled')
    click('program.button.3')
    expect(state.get().bank.slot).toBe(2)
    expect(oled.dataset.slot).toBe('1.3')
    expect(oled.textContent).toMatch(/1\.3 B3 Soulful/)
    expect(el('program.button.3').getAttribute('aria-pressed')).toBe('true')
    expect(el('program.button.1').getAttribute('aria-pressed')).toBe('false')
    page(1)
    expect(state.get().bank.page).toBe(1)
    expect(state.get().bank.slot).toBe(10) // same button number on the next page
    expect(oled.dataset.slot).toBe('2.3')
    expect(oled.textContent).toMatch(/2\.3 Arp Pluck/)
    page(1)
    page(1)
    expect(state.get().bank.page).toBe(3)
    page(1)
    expect(state.get().bank.page).toBe(3) // no fifth page: one bank of 32 (banks beyond one are excluded)
    click('program.button.8')
    expect(state.get().bank.slot).toBe(31)
    expect(oled.dataset.slot).toBe('4.8')
    page(-1)
    page(-1)
    page(-1)
    expect(state.get().bank.slot).toBe(7)
    page(-1)
    expect(state.get().bank.page).toBe(0)
  })

  it('the Program dial browses through all 32 programs in order and stops at both ends', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    const seen: string[] = []
    for (let i = 0; i < 40; i++) {
      turnDial('program.dial', 1)
      seen.push(el('program.oled').dataset.slot!)
    }
    expect(seen.slice(0, 31)).toEqual(Array.from({ length: 31 }, (_, i) => slotLabel(i + 1)))
    expect(seen.at(-1)).toBe('4.8')
    expect(state.get().bank.slot).toBe(31)
    expect(state.get().bank.page).toBe(3)
    expect(el('program.button.8').getAttribute('aria-pressed')).toBe('true')
    turnDial('program.dial', -40)
    expect(state.get().bank.slot).toBe(0)
    expect(el('program.oled').textContent).toMatch(/1\.1 Init Grand/)
  })

  it('Shift + Program dial opens the numeric list view; the dial and page buttons move through it and load; Exit closes it', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    armShift()
    turnDial('program.dial', 1)
    expect(state.get().view.mode).toBe('list')
    expect(state.get().shiftArmed).toBe(false)
    const oled = el('program.oled')
    expect(oled.dataset.view).toBe('list')
    expect(oled.textContent).toMatch(/PROGRAM LIST/)
    expect(oled.querySelector('.oled-list-row.is-selected')?.textContent).toMatch(/1\.1 Init Grand/)
    turnDial('program.dial', 2)
    expect(state.get().view.listIndex).toBe(2)
    expect(state.get().bank.slot).toBe(2)
    expect(oled.querySelector('.oled-list-row.is-selected')?.textContent).toMatch(/1\.3 B3 Soulful/)
    expect(oled.querySelectorAll('.oled-list-row')).toHaveLength(4)
    page(1)
    expect(state.get().bank.slot).toBe(10)
    expect(oled.querySelector('.oled-list-row.is-selected')?.textContent).toMatch(/2\.3 Arp Pluck/)
    click('program.shift')
    expect(state.get().view.mode).toBe('program')
    expect(oled.dataset.view).toBe('program')
    expect(state.get().bank.slot).toBe(10)
  })

  it('the Program display shows page.button and the name of every loaded program (manual p. 13)', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    for (let slot = 0; slot < 32; slot++) {
      turnDial('program.dial', slot - state.get().bank.slot)
      const text = el('program.oled').textContent ?? ''
      expect(text).toContain(`${slotLabel(slot)} ${state.get().bank.programs[slot].name}`)
      expect(el('program-status').textContent).toContain(slotLabel(slot))
    }
  })
})

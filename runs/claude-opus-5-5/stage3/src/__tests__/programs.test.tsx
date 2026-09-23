// Phase 3 Program section through the whole app: program buttons, pages, dial and the numeric
// list; Store and Store As with naming and auditioning; the truthful E indicator; edit-discard and
// Undo; Live Mode auto-store that survives a reload; copying between Live and regular slots.
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTestRuntime } from '../testing/fakes'
import { click, controllerOf, el, exit, flashing, lit, mountApp, status, turn, value, withShift } from '../testing/ui'

afterEach(cleanup)

const oled = () => el('program-oled').textContent ?? ''
const dirty = () => screen.queryByTestId('program-dirty') !== null

describe('programs.navigation — program buttons, pages, dial, numeric list', () => {
  it('program buttons select within the page; LEDs and the OLED follow', async () => {
    await mountApp()
    expect(status()).toContain('1.1 Grand Piano')
    expect(oled()).toContain('1.1 Grand Piano')
    expect(lit('program-led-program-1')).toBe(true)
    click('program-slot-3')
    expect(status()).toContain('1.3 Vox Continental')
    expect(oled()).toContain('1.3 Vox Continental')
    expect(lit('program-led-program-3')).toBe(true)
    expect(lit('program-led-program-1')).toBe(false)
    expect(el('program-slot-3')).toHaveAttribute('aria-pressed', 'true')
  })

  it('page buttons move through the 4 pages (keeping the button); the dial steps through all 32', async () => {
    await mountApp()
    click('program-slot-3')
    click('program-page-right')
    expect(status()).toContain('2.3')
    click('program-page-left')
    click('program-page-left')
    expect(status()).toContain('4.3')
    turn('program-dial', 1)
    expect(status()).toContain('4.4')
    turn('program-dial', 5)
    expect(status()).toContain('1.1 Grand Piano') // wraps from 4.8 to 1.1
    turn('program-dial', -1)
    expect(status()).toContain('4.8')
    expect(el('program-dial').getAttribute('aria-valuetext')).toContain('program 4.8')
  })

  it('Shift + dial opens the numeric list of all 32 programs; the dial browses it; Exit leaves it', async () => {
    const { runtime } = await mountApp()
    withShift(() => turn('program-dial', 1))
    expect(oled()).toContain('LIST 1–32')
    expect(oled()).toContain('▸ 1.2 B3 Rock Rotary')
    expect(oled()).toContain('1.1 Grand Piano')
    expect(oled()).toContain('1.3 Vox Continental')
    turn('program-dial', 1)
    expect(oled()).toContain('▸ 1.3 Vox Continental')
    expect(controllerOf(runtime).location.index).toBe(2)
    exit()
    expect(oled()).not.toContain('LIST')
    expect(oled()).toContain('1.3 Vox Continental')
  })
})

describe('programs.store-live — Store, Store As with naming, Live slots', () => {
  it('Store: flashes, auditions the destination, confirms; the stored program round-trips through the UI', async () => {
    const { runtime } = await mountApp()
    click('program-slot-2')
    fireEvent.keyDown(el('organ-drawbar-5'), { key: 'End' })
    expect(dirty()).toBe(true)
    expect(oled()).toContain('1.2 B3 Rock Rotary E')
    const edited = controllerOf(runtime).sound
    click('program-store')
    expect(flashing('program-led-store')).toBe(true)
    expect(oled()).toContain('STORE B3 Rock Rotary')
    expect(oled()).toContain('To 1.2')
    // Choosing a destination makes it audible for auditioning.
    click('program-slot-5')
    expect(oled()).toContain('To 1.5')
    expect(oled()).toContain('now: Pipe Cathedral')
    expect(controllerOf(runtime).sound.organ.layers.A.model).toBe('pipe1')
    click('program-store')
    expect(flashing('program-led-store')).toBe(false)
    expect(status()).toContain('1.5 B3 Rock Rotary')
    expect(dirty()).toBe(false)
    click('program-slot-1')
    click('program-slot-5')
    expect(value('organ-drawbar-5')).toBe(8)
    expect(controllerOf(runtime).sound.organ).toEqual(edited.organ)
    // The source slot keeps its stored (unedited) content.
    click('program-slot-2')
    expect(value('organ-drawbar-5')).toBe(0)
  })

  it('Store As: naming (text field or dial/cursor/insert/delete), then the destination step', async () => {
    const { runtime } = await mountApp()
    withShift(() => click('program-store'))
    const input = screen.getByTestId('program-name-input') as HTMLInputElement
    expect(input.value).toBe('Grand Piano')
    fireEvent.change(input, { target: { value: 'Stage Grand' } })
    expect(oled()).toContain('STORE AS')
    // Panel naming: cursor to the end, insert a space, dial a character.
    for (let i = 0; i < 12; i++) click('program-page-right')
    click('program-slot-1')
    turn('program-dial', 2)
    expect((screen.getByTestId('program-name-input') as HTMLInputElement).value).toBe('Stage GrandB')
    click('program-slot-2')
    expect((screen.getByTestId('program-name-input') as HTMLInputElement).value).toBe('Stage Grand')
    click('program-store')
    click('program-page-left')
    click('program-slot-8')
    expect(oled()).toContain('To 4.8')
    click('program-store')
    expect(status()).toContain('4.8 Stage Grand')
    expect(controllerOf(runtime).location).toEqual({ live: false, index: 31 })
  })

  it('Exit cancels a store: the edited program comes back at its own location, the destination is untouched', async () => {
    const { runtime } = await mountApp()
    fireEvent.keyDown(el('piano-level-a'), { key: 'Home' })
    click('program-store')
    click('program-slot-6')
    expect(controllerOf(runtime).sound.synth.on).toBe(true) // auditioning 1.6 Super Saw Lead
    exit()
    expect(status()).toContain('1.1 Grand Piano')
    expect(dirty()).toBe(true)
    expect(value('piano-level-a')).toBe(0)
    click('program-slot-6')
    expect(status()).toContain('1.6 Super Saw Lead')
  })

  it('Live Mode: 8 slots, edits store automatically (no E), survive a reload, and copy to regular slots via Store', async () => {
    const runtime = makeTestRuntime()
    const first = await mountApp(runtime)
    click('program-live-mode')
    expect(lit('program-led-live-mode')).toBe(true)
    expect(status()).toContain('Live 1 Grand Piano')
    click('piano-type') // Grand → Upright
    expect(dirty()).toBe(false)
    click('program-slot-2')
    expect(status()).toContain('Live 2')
    click('program-slot-1')
    expect(el('piano-type')).toHaveAttribute('data-state', 'UPRIGHT')
    first.unmount()
    cleanup()
    // Reload: a fresh app on the same storage.
    const again = makeTestRuntime({ storage: runtime.storage })
    await mountApp(again)
    click('program-live-mode')
    expect(el('piano-type')).toHaveAttribute('data-state', 'UPRIGHT')
    // Copy Live 1 → regular 2.4 through Store (LIVE MODE toggles the destination bank).
    click('program-store')
    click('program-live-mode')
    click('program-page-right')
    click('program-slot-4')
    expect(oled()).toContain('To 2.4')
    click('program-store')
    expect(status()).toContain('2.4 Grand Piano')
    expect(lit('program-led-live-mode')).toBe(false)
    click('program-slot-1')
    click('program-slot-4')
    expect(el('piano-type')).toHaveAttribute('data-state', 'UPRIGHT')
    // Live Mode again returns to the last Live slot.
    click('program-live-mode')
    expect(status()).toContain('Live 1')
  })
})

describe('programs.undo-cancel — edit-discard on program change, Undo', () => {
  it('changing program discards unstored edits; Shift+Undo (Solo) restores the edited program', async () => {
    const { runtime } = await mountApp()
    fireEvent.keyDown(el('piano-level-a'), { key: 'Home' })
    click('effects-reverb-on')
    expect(dirty()).toBe(true)
    click('program-slot-2')
    click('program-slot-1')
    expect(value('piano-level-a')).toBe(110)
    expect(el('effects-reverb-on')).toHaveAttribute('aria-pressed', 'false')
    expect(dirty()).toBe(false)
    // Undo restores the documented prior state: the edited program before the last change.
    click('program-slot-3')
    click('program-slot-1')
    fireEvent.keyDown(el('piano-level-a'), { key: 'Home' })
    click('program-slot-4')
    expect(status()).toContain('1.4')
    withShift(() => click('program-solo'))
    expect(status()).toContain('1.1 Grand Piano')
    expect(value('piano-level-a')).toBe(0)
    expect(dirty()).toBe(true)
    expect(controllerOf(runtime).canUndo).toBe(false)
  })

  it('reverting an edit by hand clears the E indicator (dirty is a comparison, not a latch)', async () => {
    await mountApp()
    fireEvent.keyDown(el('piano-level-a'), { key: 'ArrowUp' })
    expect(dirty()).toBe(true)
    fireEvent.keyDown(el('piano-level-a'), { key: 'ArrowDown' })
    expect(dirty()).toBe(false)
  })
})

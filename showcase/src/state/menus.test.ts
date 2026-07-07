import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary, fakeStorageBoundary, FakeGain } from '../test/fakes'
import { renderApp } from '../test/renderApp'
import { InstrumentStore } from './instrument'
import { PianoEngine } from '../audio/engine'

/**
 * system.menus — the Shift + PROGRAM 1/2 System and Sound menus (manual
 * p. 57-58): global settings navigated with PAGE, changed with the dial,
 * left with EXIT. Settings are global (never program state, never marking
 * the program edited) and persist to storage.
 */

function makeSystem(storage: ReturnType<typeof fakeStorageBoundary> | null = null) {
  const setup = fakeAudioBoundary()
  const store = new InstrumentStore(storage)
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(store)
  return { ...setup, store, engine }
}

describe('system.menus — panel navigation', () => {
  it('Shift + PROG 1 opens the System menu; PAGE navigates; dial sets; EXIT leaves', () => {
    renderApp()
    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    fireEvent.click(shift)
    fireEvent.click(screen.getByRole('button', { name: 'Program 1' }))
    expect(screen.getByTestId('oled-menu-line').textContent).toMatch(/SYSTEM MENU 1\/3 — Memory Protect/)
    expect(screen.getByTestId('oled-menu-value').textContent).toMatch(/^Off/)
    fireEvent.click(screen.getByRole('button', { name: 'Page/Cat Right' }))
    expect(screen.getByTestId('oled-menu-line').textContent).toMatch(/2\/3 — Global Transpose/)
    const dial = screen.getByRole('slider', { name: 'Program Dial' })
    fireEvent.keyDown(dial, { key: 'End' })
    expect(screen.getByTestId('oled-menu-value').textContent).toMatch(/\+6 st/)
    fireEvent.keyDown(dial, { key: 'Home' })
    expect(screen.getByTestId('oled-menu-value').textContent).toMatch(/-6 st/)
    // PAGE wraps: 3/3 then back around to 1/3.
    fireEvent.click(screen.getByRole('button', { name: 'Page/Cat Right' }))
    expect(screen.getByTestId('oled-menu-line').textContent).toMatch(/3\/3 — Fine Tune/)
    fireEvent.click(screen.getByRole('button', { name: 'Page/Cat Right' }))
    expect(screen.getByTestId('oled-menu-line').textContent).toMatch(/1\/3/)
    // EXIT (Shift) leaves the menu.
    fireEvent.click(shift)
    expect(screen.queryByTestId('oled-menu-line')).toBeNull()
  })

  it('Shift + PROG 2 opens the Sound menu with its seven pages', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Program 2' }))
    expect(screen.getByTestId('oled-menu-line').textContent).toMatch(/SOUND MENU 1\/7 — Piano Pedal Noise Lvl/)
    fireEvent.click(screen.getByRole('button', { name: 'Page/Cat Left' })) // wraps backwards
    expect(screen.getByTestId('oled-menu-line').textContent).toMatch(/7\/7 — Rotary Horn Acc/)
  })

  it('the unimplemented Shift + PROG menus say so instead of pretending', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Program 4' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Aux KB menu — not implemented/)
    expect(screen.queryByTestId('oled-menu-line')).toBeNull()
  })

  it('Memory Protect On refuses STORE from the panel with the System-menu hint', () => {
    renderApp()
    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    fireEvent.click(shift)
    fireEvent.click(screen.getByRole('button', { name: 'Program 1' }))
    const dial = screen.getByRole('slider', { name: 'Program Dial' })
    fireEvent.keyDown(dial, { key: 'Home' }) // option 1 of [On, Off]
    expect(screen.getByTestId('oled-menu-value').textContent).toMatch(/^On/)
    fireEvent.click(shift) // EXIT the menu (the Shift latch stays lit)
    fireEvent.click(shift) // release the latch — a plain Store press next
    fireEvent.click(screen.getByRole('button', { name: 'Store' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Memory Protect On/)
    // Turn it back off: Store works again.
    fireEvent.click(shift)
    fireEvent.click(screen.getByRole('button', { name: 'Program 1' }))
    fireEvent.keyDown(dial, { key: 'End' }) // Off
    fireEvent.click(shift) // EXIT the menu
    fireEvent.click(shift) // release the latch
    fireEvent.click(screen.getByRole('button', { name: 'Store' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/STORE confirms/)
    fireEvent.click(shift) // cancel the pending store
  })
})

describe('system.menus — store gating and state hygiene', () => {
  it('Memory Protect gates bank stores but never the Live slots (manual p. 57)', () => {
    const { store } = makeSystem()
    store.setMemoryProtect(true)
    store.storePress()
    expect(store.getState().programs.storePending).toBeNull()
    expect(store.getState().lastEdit).toMatch(/Memory Protect On/)
    store.storeAsPress()
    expect(store.getState().programs.naming).toBeNull()
    // Live mode: unaffected.
    store.toggleLiveMode()
    store.storePress()
    expect(store.getState().programs.storePending).not.toBeNull()
    store.cancelStoreFlow()
  })

  it('menu edits are global: they never dirty the program and survive program changes', () => {
    const { store } = makeSystem()
    expect(store.getState().programs.dirty).toBe(false)
    store.openMenu('system')
    store.stepMenuPage(1) // Global Transpose
    store.setMenuValueFromDial(127) // +6
    expect(store.getState().globalSettings.globalTranspose).toBe(6)
    expect(store.getState().programs.dirty).toBe(false)
    store.closeMenu()
    store.selectProgram(3)
    expect(store.getState().globalSettings.globalTranspose).toBe(6) // global, not program state
  })

  it('a program change closes an open menu (transient latch)', () => {
    const { store } = makeSystem()
    store.openMenu('sound')
    store.selectProgram(2)
    expect(store.getState().menu).toBeNull()
  })

  it('settings persist to storage and restore in a fresh store', () => {
    const storage = fakeStorageBoundary()
    const first = new InstrumentStore(storage)
    first.setMemoryProtect(true)
    first.openMenu('system')
    first.stepMenuPage(1)
    first.stepMenuPage(1) // Fine Tune
    first.setMenuValueFromDial(127) // +50 cents
    first.flushPersist() // dial-edit persistence is debounced (pagehide flushes)
    const second = new InstrumentStore(storage)
    expect(second.getState().globalSettings.memoryProtect).toBe(true)
    expect(second.getState().globalSettings.fineTune).toBe(50)
  })
})

describe('system.menus — the settings reach the engine', () => {
  it('Global Transpose + Fine Tune shift sounding pitch by semitones and cents', () => {
    const { store, engine, getContext } = makeSystem()
    store.setPianoSectionOn(false)
    store.setOrganSectionOn(true)
    engine.ensureStarted()
    const context = getContext()!

    const lowestNewOsc = (play: () => void) => {
      const before = context.oscillators().length
      play()
      const created = context.oscillators().slice(before)
      return Math.min(...created.map((o) => o.frequency.value))
    }
    const baseline = lowestNewOsc(() => engine.noteOn(60, 0.8))
    engine.noteOff(60)

    store.openMenu('system')
    store.stepMenuPage(1)
    store.setMenuValueFromDial(127) // Global Transpose +6 st
    store.stepMenuPage(1)
    store.setMenuValueFromDial(127) // Fine Tune +50 cents
    const shifted = lowestNewOsc(() => engine.noteOn(60, 0.8))
    expect(shifted / baseline).toBeCloseTo(Math.pow(2, 6.5 / 12), 3)
    engine.noteOff(60)
  })

  it('B3 Click Level High doubles the key-click gain', () => {
    const { store, engine, getContext } = makeSystem()
    store.setPianoSectionOn(false)
    store.setOrganSectionOn(true)
    engine.ensureStarted()
    const context = getContext()!

    const clickGainsFor = (play: () => void) => {
      const before = context.nodes.length
      play()
      return context.nodes
        .slice(before)
        .filter((n): n is FakeGain => n instanceof FakeGain)
        .map((g) => g.gain.value)
    }
    const normal = clickGainsFor(() => engine.noteOn(60, 0.8))
    engine.noteOff(60)
    expect(normal.some((v) => Math.abs(v - 0.06) < 0.001)).toBe(true)

    store.openMenu('sound')
    store.stepMenuPage(1)
    store.stepMenuPage(1) // B3 Organ Click Level
    store.setMenuValueFromDial(127) // High
    const high = clickGainsFor(() => engine.noteOn(62, 0.8))
    engine.noteOff(62)
    expect(high.some((v) => Math.abs(v - 0.12) < 0.001)).toBe(true)
  })

  it('Piano Pedal Noise level trims the generated thump by dB', () => {
    const { store, engine, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.cycleAcoustics() // SoftRel
    store.cycleAcoustics() // +StringRes
    store.cycleAcoustics() // +PedNoise
    expect(store.getState().piano.pedNoise).toBe(true)

    store.openMenu('sound')
    store.setMenuValueFromDial(127) // Pedal Noise +6 dB
    const before = context.nodes.length
    engine.setSustain(1)
    const created = context.nodes.slice(before).filter((n): n is FakeGain => n instanceof FakeGain)
    const expected = 0.06 * Math.pow(10, 6 / 20)
    expect(created.some((g) => Math.abs(g.gain.value - expected) < 0.002)).toBe(true)
    engine.setSustain(0)
  })

  it('Rotary Rotor Speed High raises the rotor LFO rate target', () => {
    const { store, engine, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    // Baseline slow rotor target is 0.7 Hz; High scales it by 1.3.
    expect(context.oscillators().some((o) => Math.abs(o.frequency.value - 0.7) < 0.01)).toBe(true)
    store.openMenu('sound')
    for (let i = 0; i < 3; i++) store.stepMenuPage(1) // Rotary Rotor Speed
    store.setMenuValueFromDial(127) // High
    expect(context.oscillators().some((o) => Math.abs(o.frequency.value - 0.7 * 1.3) < 0.01)).toBe(true)
  })
})

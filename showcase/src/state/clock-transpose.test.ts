import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary } from '../test/fakes'
import { renderApp } from '../test/renderApp'
import { InstrumentStore } from './instrument'
import { PianoEngine } from '../audio/engine'

/**
 * system.clock-transpose — Master Clock (tap 4+ or dial-edit, 30-300 BPM)
 * syncs the Delay time and Mod 1 LFO per chain; Transpose (-6..+6, ON/SET +
 * dial-edit) shifts sounding pitch while keyboard-zone routing keeps
 * following the played key. Both are program state.
 */

function makeSystem() {
  const setup = fakeAudioBoundary()
  const store = new InstrumentStore()
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(store)
  return { ...setup, store, engine }
}

describe('system.clock-transpose — panel', () => {
  it('four taps set the master clock; fewer taps only prompt', () => {
    const { timers } = renderApp()
    const tap = screen.getByRole('button', { name: 'Master Clock Tap/Set' })
    fireEvent.click(tap)
    timers.now += 500
    fireEvent.click(tap)
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/tap 4\+/)
    timers.now += 500
    fireEvent.click(tap)
    timers.now += 500
    fireEvent.click(tap)
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Mst Clk 120 BPM/)
  })

  it('clock edit mode: dial sets BPM 30..300 and PROG 1/2 toggle sync flags', () => {
    renderApp()
    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    fireEvent.click(shift)
    fireEvent.click(screen.getByRole('button', { name: 'Master Clock Tap/Set' }))
    expect(screen.getByTestId('oled-clock-line').textContent).toMatch(/120 BPM/)
    const dial = screen.getByRole('slider', { name: 'Program Dial' })
    fireEvent.keyDown(dial, { key: 'End' })
    expect(screen.getByTestId('oled-clock-line').textContent).toMatch(/300 BPM/)
    fireEvent.keyDown(dial, { key: 'Home' })
    expect(screen.getByTestId('oled-clock-line').textContent).toMatch(/30 BPM/)
    fireEvent.click(screen.getByRole('button', { name: 'Program 1' }))
    expect(screen.getByTestId('oled-clock-line').textContent).toMatch(/DELAY ●/)
    fireEvent.click(screen.getByRole('button', { name: 'Program 2' }))
    expect(screen.getByTestId('oled-clock-line').textContent).toMatch(/MOD1 ●/)
    fireEvent.click(shift)
    expect(screen.queryByTestId('oled-clock-line')).toBeNull()
  })

  it('the TRANSP button toggles and lights; holding opens the editor; Shift+press is PANIC', () => {
    renderApp()
    const button = screen.getByRole('button', { name: 'Transpose On/Set' })
    fireEvent.click(button)
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Transpose On \+0 st/)
    // Press-and-hold opens the dial editor (the hardware's hold-Transp-and-
    // turn-dial Set gesture); the swallowed release must not toggle.
    vi.useFakeTimers()
    try {
      fireEvent.keyDown(button, { key: 'Enter' })
      act(() => vi.advanceTimersByTime(500))
      fireEvent.keyUp(button, { key: 'Enter' })
    } finally {
      vi.useRealTimers()
    }
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('oled-transpose-line')).toBeTruthy()
    const dial = screen.getByRole('slider', { name: 'Program Dial' })
    fireEvent.keyDown(dial, { key: 'End' })
    expect(screen.getByTestId('oled-transpose-line').textContent).toMatch(/\+6 st/)
    const shift = screen.getByRole('button', { name: 'Shift/Exit' })
    fireEvent.click(shift)
    expect(screen.queryByTestId('oled-transpose-line')).toBeNull()
    // PANIC = Shift + Transp (manual p. 40): all-notes-off, transpose state
    // untouched.
    fireEvent.click(shift)
    fireEvent.click(button)
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/PANIC/)
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('system.clock-transpose — engine', () => {
  it('delay sync follows the BPM at the knob-selected subdivision (audit B4)', () => {
    const { store, engine, getContext } = makeSystem()
    // Tempo knob 80 selects the 1/4 subdivision while synced.
    store.updateUnit('delay', { on: true, tempo: 80 } as never)
    store.toggleDelayClockSync()
    engine.ensureStarted()
    const context = getContext()!
    const delayNodes = () => context.nodes.filter((n) => n.kind === 'delay')
    const hasDelayNear = (seconds: number) =>
      delayNodes().some((n) => Math.abs((n as unknown as { delayTime: { value: number } }).delayTime.value - seconds) < 0.02)
    expect(hasDelayNear(0.5)).toBe(true) // 1/4 at 120 BPM
    store.setMasterClockBpm(60)
    expect(hasDelayNear(1.0)).toBe(true) // 1/4 at 60 BPM
    // The knob stays live while synced: 1/8 (value 55) halves the time.
    store.updateUnit('delay', { tempo: 55 } as never)
    expect(hasDelayNear(0.5)).toBe(true) // 1/8 at 60 BPM
  })

  it('mod1 sync follows the BPM at the knob-selected subdivision', () => {
    const { store, engine, getContext } = makeSystem()
    // Rate knob 45 selects the 1/4 subdivision (one cycle per beat).
    store.updateUnit('mod1', { on: true, rate: 45 } as never)
    store.toggleMod1ClockSync()
    engine.ensureStarted()
    const context = getContext()!
    store.setMasterClockBpm(180)
    expect(context.oscillators().some((o) => Math.abs(o.frequency.value - 3.0) < 0.05)).toBe(true)
    // Knob to 1/8 (value 70): two cycles per beat.
    store.updateUnit('mod1', { rate: 70 } as never)
    expect(context.oscillators().some((o) => Math.abs(o.frequency.value - 6.0) < 0.1)).toBe(true)
  })

  it('external MIDI clock locks the tempo and overrides the dial until it stops', () => {
    const { store } = makeSystem()
    store.setExternalClock(140)
    expect(store.getState().masterClock.bpm).toBe(140)
    expect(store.getState().clockExternal).toBe(true)
    store.setMasterClockBpm(90) // dial is overridden while locked
    expect(store.getState().masterClock.bpm).toBe(140)
    expect(store.getState().lastEdit).toMatch(/locked/i)
    store.setExternalClock(null)
    expect(store.getState().clockExternal).toBe(false)
    store.setMasterClockBpm(90)
    expect(store.getState().masterClock.bpm).toBe(90)
  })

  it('transpose shifts sounding pitch but not zone routing', () => {
    const { store, engine, getContext } = makeSystem()
    store.setPianoSectionOn(false)
    store.setOrganSectionOn(true)
    engine.ensureStarted()
    const context = getContext()!

    const beforeCount = context.oscillators().length
    engine.noteOn(60, 0.8)
    const plainOscs = context.oscillators().slice(beforeCount)
    const lowestBefore = Math.min(...plainOscs.map((o) => o.frequency.value))
    engine.noteOff(60)

    store.setTransposeSemitones(6)
    store.toggleTranspose()
    const beforeTransposedCount = context.oscillators().length
    engine.noteOn(60, 0.8)
    const transposedOscs = context.oscillators().slice(beforeTransposedCount)
    const lowestAfter = Math.min(...transposedOscs.map((o) => o.frequency.value))
    expect(lowestAfter / lowestBefore).toBeCloseTo(Math.pow(2, 6 / 12), 3)
    engine.noteOff(60)

    // Split assertion: zone routing keeps following the played key even
    // though the sounding pitch (with +6 transpose) crosses the split.
    store.toggleSplit() // Mid C4, hard switch
    while (store.getState().organ.layers.A.zone.from !== 0 || store.getState().organ.layers.A.zone.to !== 0) {
      store.cycleLayerZone('organ', 'A', -1)
    }
    engine.noteOn(59, 0.8) // played key below the split
    expect(engine.layerVoiceCount('A', 'organ')).toBe(1)
  })

  it('master clock and transpose are program state and round-trip', () => {
    const store = new InstrumentStore()
    store.setMasterClockBpm(90)
    store.setTransposeSemitones(3)
    store.toggleTranspose()
    expect(store.getState().programs.dirty).toBe(true)
    store.storePress()
    store.storePress() // store into 1.1
    store.selectProgram(3)
    expect(store.getState().masterClock.bpm).toBe(120)
    expect(store.getState().transpose.on).toBe(false)
    store.selectProgram(0)
    expect(store.getState().masterClock.bpm).toBe(90)
    expect(store.getState().transpose.on).toBe(true)
    expect(store.getState().transpose.semitones).toBe(3)
  })
})

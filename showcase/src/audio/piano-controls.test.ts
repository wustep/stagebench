import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary, FakeCompressor, FakeFilter, FakeGain } from '../test/fakes'
import { renderApp } from '../test/renderApp'
import { InstrumentStore } from '../state/instrument'
import { PianoEngine } from './engine'

/**
 * piano.velocity-controls — KB Touch, timbre, dynamic compression, unison,
 * release, resonance, master volume and Panic write canonical state AND
 * update the live graph parameters (rendered-audio proof lives in
 * render-piano-controls.test.ts).
 */
function makeSystem() {
  const setup = fakeAudioBoundary()
  const store = new InstrumentStore()
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(store)
  return { ...setup, store, engine }
}

function voicePeak(engine: PianoEngine, context: ReturnType<ReturnType<typeof fakeAudioBoundary>['getContext']>, velocity: number): number {
  const before = context!.nodes.length
  engine.noteOn(60, velocity)
  const gains = context!.nodes.slice(before).filter((n): n is FakeGain => n instanceof FakeGain)
  const peak = Math.max(...gains.map((g) => g.gain.maxScheduled()))
  engine.noteOff(60)
  return peak
}

describe('piano.velocity-controls', () => {
  it('KB Touch curves change how velocity maps to level (Light > Heavy at mid velocity)', () => {
    const peaks: Record<string, number> = {}
    for (const touch of [0, 1, 2]) {
      const { engine, store, getContext } = makeSystem()
      engine.ensureStarted()
      for (let i = 0; i < touch; i++) store.cycleKbTouch()
      peaks[touch] = voicePeak(engine, getContext(), 0.5)
    }
    expect(peaks[2]!).toBeGreaterThan(peaks[1]!)
    expect(peaks[1]!).toBeGreaterThan(peaks[0]!)
  })

  it('timbre steps reconfigure the per-layer voicing filters', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    const timbreFilters = context.nodes.filter(
      (n): n is FakeFilter => n instanceof FakeFilter && (n.frequency.value === 250 || n.frequency.value === 2800),
    )
    expect(timbreFilters.length).toBe(4) // bass+treble per layer
    store.cycleTimbre() // Soft
    expect(store.getState().piano.timbre).toBe(1)
    const gains = timbreFilters.map((f) => f.gain.value)
    expect(gains.some((g) => g !== 0)).toBe(true)
    store.cycleTimbre() // Mid
    store.cycleTimbre() // Bright
    const bright = timbreFilters.filter((f) => f.frequency.value === 2800).map((f) => f.gain.value)
    expect(bright.some((g) => g > 4)).toBe(true)
  })

  it('electric pianos expose the Dyno timbre steps; acoustic list is shorter', () => {
    const { store } = makeSystem()
    for (let i = 0; i < 4; i++) store.cycleTimbre()
    expect(store.getState().lastEdit).toMatch(/Timbre/)
    // Acoustic family wraps after Bright (4 entries)
    expect(store.getState().piano.timbre).toBe(0)
    store.selectPianoType('Electric')
    for (let i = 0; i < 4; i++) store.cycleTimbre()
    expect(store.getState().lastEdit).toBe('Timbre Dyno 1')
  })

  it('dynamic compression levels drive the per-layer compressor parameters', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    // Layer dyn-comp compressors start neutral (threshold 0, ratio 1).
    const layerComps = context.nodes.filter((n): n is FakeCompressor => n instanceof FakeCompressor && n.threshold.value === 0)
    expect(layerComps.length).toBe(2)
    store.cycleDynComp() // level 1
    expect(store.getState().piano.dynComp).toBe(1)
    expect(layerComps.every((c) => c.threshold.value < 0)).toBe(true)
    expect(layerComps.every((c) => c.ratio.value > 1)).toBe(true)
    store.cycleDynComp()
    store.cycleDynComp() // level 3
    expect(layerComps.every((c) => c.threshold.value <= -30)).toBe(true)
  })

  it('unison adds detuned, panned recorded voices per note', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    engine.noteOn(60, 0.8)
    const plain = context.bufferSources().length
    engine.noteOff(60)
    store.cycleUnison() // 1
    engine.noteOn(64, 0.8)
    const withUnison = context.bufferSources().filter((s) => !s.stopped).length
    expect(withUnison).toBeGreaterThan(plain)
    const detuned = context.bufferSources().filter((s) => !s.stopped && s.detune.value !== 0)
    expect(detuned.length).toBe(2)
    expect(context.nodes.some((n) => n.kind === 'panner' && !n.disconnected)).toBe(true)
  })

  it('string resonance send opens only with String Res enabled AND the damper lifted', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    expect(getContext()).toBeTruthy()
    // Resonance send gains, straight from the real graph diagnostics.
    const { channels } = engine.diagnostics()
    const convolverFeeds = [channels!.A.resSend, channels!.B.resSend] as unknown as FakeGain[]
    expect(convolverFeeds.length).toBe(2)
    expect(convolverFeeds.every((g) => g.gain.value <= 0.001)).toBe(true)
    store.cycleAcoustics() // SoftRel
    store.cycleAcoustics() // +StringRes
    expect(store.getState().piano.stringRes).toBe(true)
    expect(convolverFeeds.every((g) => g.gain.value <= 0.001)).toBe(true) // pedal still up
    engine.setSustain(1)
    expect(convolverFeeds.some((g) => g.gain.value > 0.1)).toBe(true)
    engine.setSustain(0)
    expect(convolverFeeds.every((g) => g.gain.value <= 0.001)).toBe(true)
  })

  it('master volume drives the master gain node', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const master = getContext()!.nodes.find((n): n is FakeGain => n instanceof FakeGain)! // first gain = master
    const initial = master.gain.value
    store.setMasterVolume(0)
    expect(master.gain.value).toBeLessThan(initial)
    expect(master.gain.value).toBeLessThanOrEqual(0.001)
    store.setMasterVolume(127)
    expect(master.gain.value).toBeGreaterThan(initial)
  })

  it('Panic through the panel (Shift + Transpose On/Set) stops every voice and resets pedals', () => {
    renderApp()
    fireEvent.pointerDown(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Transpose On/Set' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/PANIC/)
    expect(screen.getByTestId('pedal-status').textContent).toMatch(/sustain up/)
    fireEvent.pointerUp(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
  })

  it('PSTICK routes the pitch stick: off applies no bend, re-enabling reapplies it (manual p. 23)', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    engine.noteOn(60, 0.9)
    const sources = context.bufferSources().filter((s) => s.started && !s.stopped)
    expect(sources.length).toBeGreaterThan(0)
    const baseRates = sources.map((s) => s.playbackRate.value)
    store.togglePianoPstick() // default On -> Off
    engine.setPitchBend(1) // full throw = +2 st on the Piano
    sources.forEach((s, i) => expect(s.playbackRate.value).toBeCloseTo(baseRates[i]!, 5))
    store.togglePianoPstick() // Off -> On: the held bend reapplies to sounding voices
    sources.forEach((s, i) => expect(s.playbackRate.value).toBeCloseTo(baseRates[i]! * Math.pow(2, 2 / 12), 5))
  })

  it('Shift + Piano Model dial shows the model list view for Clav (Clavinet/Harpsichord), spec.scope.optional', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'Piano Type Select' })) // Grand -> Upright
    fireEvent.click(screen.getByRole('button', { name: 'Piano Type Select' })) // Upright -> Electric
    fireEvent.click(screen.getByRole('button', { name: 'Piano Type Select' })) // Electric -> Clav
    expect(screen.getByTestId('oled-piano-line').textContent).toMatch(/Clavinet/)
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    const dial = screen.getByRole('slider', { name: 'Piano Model Dial' })
    fireEvent.keyDown(dial, { key: 'End' }) // dial to the last (second) model — opens the model list view
    expect(screen.getByTestId('oled-model-list-1').textContent).toContain('Harpsichord')
    expect(screen.getByTestId('oled-model-list-0').textContent).toContain('Clavinet')
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' })) // dropping Shift closes the list view
    expect(screen.queryByTestId('oled-model-list-0')).toBeNull()
    expect(screen.getByTestId('oled-piano-line').textContent).toMatch(/Harpsichord/)
  })

  it('panel piano controls update LEDs, display feedback and canonical state together', () => {
    renderApp()
    fireEvent.click(screen.getByRole('button', { name: 'KB Touch Select' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/KB Touch Mid/)
    fireEvent.click(screen.getByRole('button', { name: 'Piano Type Select' })) // Grand -> Misc
    fireEvent.click(screen.getByRole('button', { name: 'Piano Type Select' })) // Misc -> Electric
    fireEvent.click(screen.getByRole('button', { name: 'Piano Type Select' })) // Electric -> Clav
    fireEvent.click(screen.getByRole('button', { name: 'Piano Type Select' })) // Clav -> Upright
    expect(screen.getByTestId('oled-piano-line').textContent).toMatch(/VS Upright/)
    // INFO = Shift + Piano Select (manual p. 25) — the panel has one button.
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Piano Type Select' }))
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/vel layer/)
    // Shift+Piano Select must not have cycled the type.
    expect(screen.getByTestId('oled-piano-line').textContent).toMatch(/VS Upright/)
    fireEvent.click(screen.getByRole('button', { name: 'Shift/Exit' }))
    const fader = screen.getByRole('slider', { name: 'Piano Layer A Level' })
    fireEvent.keyDown(fader, { key: 'PageDown' })
    expect(Number(fader.getAttribute('aria-valuenow'))).toBeLessThan(100)
    expect(screen.getByTestId('oled-edit-line').textContent).toMatch(/Piano A Level/)
  })
})

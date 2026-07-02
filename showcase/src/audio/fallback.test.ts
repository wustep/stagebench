import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary } from '../test/fakes'
import { renderApp } from '../test/renderApp'
import { InstrumentStore } from '../state/instrument'
import { PianoEngine } from './engine'
import { PIANO_TYPES } from './library'

/**
 * piano.fallback — asset failure enters a labeled, playable synthesized
 * fallback without ever reporting the primary library ready. All six piano
 * types now bundle a model, so the missing-model state (spec:
 * selection.missingModelState — flashing type LED, truthful display report)
 * is reached through load failure rather than unpopulated types.
 */
describe('piano.fallback', () => {
  it('total sample failure: labeled fallback, playable, never reported ready', () => {
    const setup = fakeAudioBoundary()
    const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary({ fail: true }) })
    engine.attachStore(new InstrumentStore())
    const statuses: string[] = []
    engine.subscribe((info) => statuses.push(info.status))
    engine.ensureStarted()
    expect(engine.getStatus().status).toBe('fallback')
    expect(engine.getStatus().message).toMatch(/synthesized/i)
    expect(statuses).not.toContain('ready')
    engine.noteOn(60, 0.8)
    expect(engine.heldVoiceCount()).toBe(1)
    expect(setup.getContext()!.oscillators().some((o) => o.started)).toBe(true)
  })

  it('partial failure: only the failed instrument falls back, and the status says which', () => {
    const setup = fakeAudioBoundary()
    const failGrand = fakeAssetBoundary({ fail: (path) => path.startsWith('samples/grand/') })
    const engine = new PianoEngine(setup.boundary, { assets: failGrand })
    engine.attachStore(new InstrumentStore())
    engine.ensureStarted()
    expect(engine.getStatus().status).toBe('fallback')
    expect(engine.getStatus().message).toMatch(/Partial FALLBACK/)
    expect(engine.getStatus().message).toMatch(/Salamander Grand/)
    // Layer A (grand, failed) plays the synth fallback voice.
    engine.noteOn(60, 0.8)
    expect(setup.getContext()!.oscillators().length).toBeGreaterThan(0)
  })

  it('the app status strip and Program display surface the fallback truthfully', async () => {
    const { getContext } = renderApp(undefined, fakeAssetBoundary({ fail: true }))
    fireEvent.pointerDown(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
    expect(getContext()).not.toBeNull()
    await waitFor(() => {
      expect(document.querySelector('[data-testid="engine-status"]')?.getAttribute('data-status')).toBe('fallback')
    })
    expect(screen.getByTestId('oled-status-line').textContent).toMatch(/FALLBACK/)
    fireEvent.pointerUp(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
  })

  it('all six piano types play recorded sample voices (no missing models)', () => {
    const setup = fakeAudioBoundary()
    const store = new InstrumentStore()
    const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
    engine.attachStore(store)
    engine.ensureStarted()
    const context = setup.getContext()!
    let midi = 60
    for (const type of PIANO_TYPES) {
      store.selectPianoType(type)
      const before = context.bufferSources().length
      engine.noteOn(midi, 0.8)
      expect(context.bufferSources().length, type).toBeGreaterThan(before)
      engine.noteOff(midi)
      midi += 1
    }
    expect(store.getState().pianoNotFound).toBeNull()
  })

  it('a type whose samples fail reports FALLBACK on the display and flashes its type LED', async () => {
    const failClav = fakeAssetBoundary({ fail: (path) => path.startsWith('samples/clav/') })
    renderApp(undefined, failClav)
    // Start the engine through a real key gesture so the library loads.
    fireEvent.pointerDown(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
    fireEvent.pointerUp(document.querySelector('[data-control-id="key-60"]')!, { pointerId: 1 })
    const typeButton = screen.getByRole('button', { name: 'Piano Type Select' })
    // Grand -> Upright -> Electric -> Clav (samples fail to load)
    fireEvent.click(typeButton)
    fireEvent.click(typeButton)
    fireEvent.click(typeButton)
    await waitFor(() => {
      expect(screen.getByTestId('oled-piano-line').textContent).toMatch(/Clavinet — FALLBACK/)
    })
    expect(document.querySelector('.led.flash')).toBeTruthy()
  })

  it('recovering selection after a failed type restores recorded samples', () => {
    const setup = fakeAudioBoundary()
    const store = new InstrumentStore()
    const engine = new PianoEngine(setup.boundary, {
      assets: fakeAssetBoundary({ fail: (path) => path.startsWith('samples/misc/') }),
    })
    engine.attachStore(store)
    engine.ensureStarted()
    const context = setup.getContext()!
    store.selectPianoType('Misc')
    const before = context.bufferSources().length
    engine.noteOn(60, 0.8)
    // Failed set: the labeled synthesized fallback sounds instead of samples.
    expect(context.bufferSources().length).toBe(before)
    expect(context.oscillators().some((o) => o.started)).toBe(true)
    expect(engine.getStatus().status).toBe('fallback')
    store.selectPianoType('Grand')
    engine.noteOn(64, 0.8)
    expect(context.bufferSources().length).toBeGreaterThan(before)
  })
})

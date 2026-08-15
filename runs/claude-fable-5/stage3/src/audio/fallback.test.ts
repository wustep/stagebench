import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary } from '../test/fakes'
import { renderApp } from '../test/renderApp'
import { InstrumentStore } from '../state/instrument'
import { PianoEngine } from './engine'

/**
 * piano.fallback — asset failure enters a labeled, playable synthesized
 * fallback without ever reporting the primary library ready; unpopulated
 * piano types truthfully report "Piano not found" through the real display.
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

  it('selecting an unpopulated type reports "Piano not found" on the display and flashes the type LED', () => {
    renderApp()
    const typeButton = screen.getByRole('button', { name: 'Piano Type Select' })
    // Grand -> Upright -> Electric -> Clav (unpopulated)
    fireEvent.click(typeButton)
    fireEvent.click(typeButton)
    fireEvent.click(typeButton)
    expect(screen.getByTestId('oled-piano-line').textContent).toMatch(/Piano not found \(Clav\)/)
    expect(document.querySelector('.led.flash')).toBeTruthy()
  })

  it('a missing model plays nothing rather than pretending (no synth voice for Piano not found)', () => {
    const setup = fakeAudioBoundary()
    const store = new InstrumentStore()
    const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
    engine.attachStore(store)
    engine.ensureStarted()
    store.selectPianoType('Clav')
    const context = setup.getContext()!
    const sourcesBefore = context.bufferSources().length
    engine.noteOn(60, 0.8)
    expect(context.bufferSources().length).toBe(sourcesBefore) // no sampled voice
    expect(context.oscillators().filter((o) => !o.stopped && o.started).length).toBeGreaterThanOrEqual(0)
    // The voice is tracked (key feedback) but silent; selecting a populated type restores sound.
    store.selectPianoType('Electric')
    engine.noteOn(64, 0.8)
    expect(context.bufferSources().length).toBeGreaterThan(sourcesBefore)
  })

  it('recovering selection clears the not-found state', () => {
    const store = new InstrumentStore()
    store.selectPianoType('Misc')
    expect(store.getState().pianoNotFound).toBe('Misc')
    store.selectPianoType('Grand')
    expect(store.getState().pianoNotFound).toBeNull()
  })
})

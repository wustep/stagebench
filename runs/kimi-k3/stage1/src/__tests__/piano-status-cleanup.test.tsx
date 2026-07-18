import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { PianoEngine, type EngineStatus } from '../audio/engine'
import { FakeAudioBackend } from '../audio/fake-backend'
import { FALLBACK_LABEL } from '../state/app-context'

function setup(engine?: PianoEngine) {
  const e = engine ?? new PianoEngine(new FakeAudioBackend())
  const utils = render(<App engine={e} disableMidi />)
  return { engine: e, ...utils }
}

describe('piano.basic-status-cleanup', () => {
  it('reports ready status truthfully once initialized', async () => {
    const { engine } = setup()
    await engine.init()
    await waitFor(() => {
      expect(document.querySelector('[data-status="audio"]')!.textContent).toMatch(/ready/)
      expect(document.querySelector('[data-status="audio"]')!.textContent).toMatch(/synthesized/i)
    })
  })

  it('engine status transitions loading → ready', async () => {
    const seen: EngineStatus[] = []
    const backend = new FakeAudioBackend()
    const engine = new PianoEngine(backend, { onStatus: (s) => seen.push(s) })
    await engine.init()
    expect(seen).toContain('loading')
    expect(seen).toContain('ready')
    expect(engine.getStatus().status).toBe('ready')
  })

  it('error status renders an honest labeled fallback', async () => {
    const backend = new FakeAudioBackend()
    const engine = new PianoEngine(backend)
    engine.fail('Web Audio unavailable in this browser')
    setup(engine)
    await waitFor(() => {
      const el = document.querySelector('[data-status="audio"]')!
      expect(el.textContent).toMatch(new RegExp(FALLBACK_LABEL, 'i'))
      expect(el.textContent).toMatch(/Web Audio unavailable/i)
    })
  })

  it('in error state the surface stays inspectable and notes do not pretend to sound', () => {
    const backend = new FakeAudioBackend()
    const engine = new PianoEngine(backend)
    engine.fail('test error')
    const { container } = setup(engine)
    const key = container.querySelector('[data-key-id="key.c4"]')!
    key.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(backend.startCount).toBe(0) // no fake success
    expect(container.querySelector('[data-section="organ"]')).toBeTruthy()
  })

  it('blur stops every owned voice', () => {
    const backend = new FakeAudioBackend()
    const engine = new PianoEngine(backend)
    const { container } = setup(engine)
    const key = container.querySelector('[data-key-id="key.c4"]')!
    key.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(backend.activeVoiceCount()).toBe(1)
    window.dispatchEvent(new Event('blur'))
    expect(backend.activeVoiceCount()).toBe(0)
    expect(engine.getVoices().length).toBe(0)
  })

  it('unmount disposes the engine and returns voice counts to baseline', () => {
    const backend = new FakeAudioBackend()
    const engine = new PianoEngine(backend)
    const { container, unmount } = setup(engine)
    const key = container.querySelector('[data-key-id="key.c4"]')!
    key.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(backend.activeVoiceCount()).toBe(1)
    unmount()
    expect(backend.activeVoiceCount()).toBe(0)
    expect(engine.getVoices().length).toBe(0)
  })
})

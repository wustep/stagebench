import { act, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { el, keyEl, mountApp, waitUntil, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

describe('piano.fallback — asset failure enters a labelled, playable fallback and never reports the library ready', () => {
  it('a missing manifest flashes the type LED, reports "Piano not found" and plays the generated fallback piano', async () => {
    mounted = await mountApp({ samples: 'missing' })
    const { engine } = mounted.services
    await waitUntil(() => engine.getStatus().layers.A.state === 'fallback')
    const status = engine.getStatus()
    expect(status.layers.A.source).toBe('fallback-generated')
    expect(status.layers.A.message).toMatch(/Piano not found: Salamander C5/)
    expect(status.layers.A.message).toMatch(/fallback/i)
    expect(document.getElementById('program.oled')?.textContent).toMatch(/Piano not found/)
    expect(document.querySelector('.piano-type-leds')?.className).toContain('is-flashing')
    expect(document.getElementById('library-message')?.textContent).toMatch(/FALLBACK generated/)
    // still playable: the audio context starts and a key plays a generated voice
    await act(async () => {
      await engine.start()
      mounted!.world.timers.flush()
    })
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    expect(engine.getStatus().state).toBe('fallback')
    expect(document.getElementById('audio-status')?.dataset.state).toBe('fallback')
    const voice = engine.activeVoices()[0]
    expect(voice).toMatchObject({ midi: 60, kind: 'buffer', source: 'fallback-generated' })
    expect(mounted.world.ctx.sources()[0].reachesDestination()).toBe(true)
    fireEvent.pointerUp(keyEl(60), { pointerId: 1 })
    expect(engine.getStatus().state).not.toBe('ready')
  })

  it('a single broken file fails the set truthfully, and selecting a healthy type recovers to ready', async () => {
    mounted = await mountApp({ samples: 'broken' })
    const { engine, state } = mounted.services
    await waitUntil(() => engine.getStatus().layers.A.state === 'fallback')
    expect(engine.getStatus().layers.A.message).toMatch(/060-l1\.ogg/)
    // Upright has no 060-l1 file: it loads completely
    fireEvent.click(el('piano.type'))
    expect(state.get().piano.layers.A.modelId).toBe('upright-kw')
    await waitUntil(() => engine.getStatus().layers.A.state === 'ready')
    expect(engine.getStatus().layers.A.source).toBe('recorded-samples')
    expect(document.querySelector('.piano-type-leds')?.className).not.toContain('is-flashing')
    expect(document.getElementById('program.oled')?.textContent).toMatch(/Upright · Kawai Upright KW/)
    // and back to the broken set: fallback again, still playable
    for (let i = 0; i < 5; i++) fireEvent.click(el('piano.type'))
    expect(state.get().piano.layers.A.modelId).toBe('grand-salamander')
    await waitUntil(() => engine.getStatus().layers.A.state === 'fallback')
    fireEvent.pointerDown(keyEl(62), { pointerId: 1, button: 0 })
    expect(engine.activeVoices()[0].source).toBe('fallback-generated')
    fireEvent.pointerUp(keyEl(62), { pointerId: 1 })
  })

  it('a healthy library reports loading progress before ready and never shows fallback', async () => {
    mounted = await mountApp({ samples: true })
    const { engine } = mounted.services
    const seen = new Set<string>()
    const stop = engine.subscribe(() => seen.add(engine.getStatus().layers.A.state))
    await waitUntil(() => engine.getStatus().layers.A.state === 'ready')
    stop()
    expect(seen.has('fallback')).toBe(false)
    expect(document.querySelector('.piano-type-leds')?.className).not.toContain('is-flashing')
    expect(engine.getStatus().layers.A.loaded).toBeGreaterThan(0)
    expect(engine.getStatus().layers.A.loaded).toBe(engine.getStatus().layers.A.total)
  })
})

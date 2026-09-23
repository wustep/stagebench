import { fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OfflineAudioContext } from 'node-web-audio-api'
import { ManualTimers, type AudioBoundary, type AudioContextLike } from './boundaries'
import { PianoEngine } from './engine'
import { renderPiano, rms } from '../test/renderAudio'
import { renderApp } from '../test/renderApp'

describe('piano.basic-status-cleanup', () => {
  it('reports fallback instead of ready when the primary voice fails, and error when there is no context', async () => {
    const fallback = await renderPiano((engine) => engine.noteOn(60, 0.8, 0), 0.3, { failPrimary: true })
    expect(fallback.engine.getStatus()).toBe('fallback')
    expect(fallback.engine.getMode()).toBe('fallback')
    expect(fallback.engine.getDetail()).toMatch(/fallback/i)
    expect(rms(fallback.channel, 200, 3000)).toBeGreaterThan(0.002)

    const timers = new ManualTimers()
    const engine = new PianoEngine({
      createContext: () => {
        throw new Error('audio blocked')
      },
      timers,
    })
    const seen: string[] = []
    engine.subscribe(() => seen.push(engine.getStatus()))
    engine.ensureStarted()
    expect(engine.getStatus()).toBe('error')
    expect(engine.getDetail()).toMatch(/audio blocked/)
    expect(seen).toContain('loading')
    expect(() => engine.noteOn(60, 1)).not.toThrow()
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('stops every voice on blur and on unmount', () => {
    const timers = new ManualTimers()
    const context = new OfflineAudioContext(1, 44100, 44100)
    const boundary: AudioBoundary = { createContext: () => context as unknown as AudioContextLike, timers }
    let engine: PianoEngine | null = null
    const view = renderApp({
      audio: boundary,
      onEngine: (created) => {
        engine = created
      },
    })
    fireEvent.keyDown(window, { code: 'KeyA' })
    fireEvent.keyDown(window, { code: 'KeyS' })
    expect(engine!.activeVoiceCount()).toBe(2)
    expect(document.querySelector('[data-testid="engine-status"]')).toHaveAttribute('data-status', 'ready')
    fireEvent.blur(window)
    expect(engine!.activeVoiceCount()).toBe(0)
    expect(engine!.heldVoiceCount()).toBe(0)

    fireEvent.keyDown(window, { code: 'KeyD' })
    expect(engine!.activeVoiceCount()).toBe(1)
    view.unmount()
    expect(engine!.activeVoiceCount()).toBe(0)
  })
})

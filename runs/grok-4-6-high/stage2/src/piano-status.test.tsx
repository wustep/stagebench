import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { PianoEngine } from './audio/piano-engine'
import { createAudioContext } from './audio/software-context'

describe('piano.basic-status-cleanup', () => {
  it('reports truthful loading/ready status and a labeled fallback path', async () => {
    const ready = new PianoEngine({
      context: createAudioContext({ offline: true, durationSec: 0.2 }),
    })
    expect(['ready', 'loading']).toContain(ready.getStatus())
    await ready.init()
    expect(ready.getStatus()).toBe('ready')
    expect(ready.getStatusDetail().toLowerCase()).toMatch(/ready/)
    ready.dispose()

    const broken = new PianoEngine({
      createAudioContext: () => {
        throw new Error('no audio')
      },
    })
    await broken.init()
    expect(broken.getStatus()).toBe('error')
    expect(broken.getStatusDetail().toLowerCase()).toMatch(/fallback|error/)
    broken.noteOn(60, 0.8)
    broken.noteOff(60)
    broken.dispose()
  })

  it('shows status in the UI and stops voices on blur, disconnect, and unmount', async () => {
    const { unmount } = render(<App deps={{ autoMidi: false }} />)
    const status = document.querySelector('[data-audio-status]')
    expect(status).toBeTruthy()
    expect(status?.getAttribute('data-audio-status')).toMatch(/loading|ready|error|fallback/)
    expect(status?.textContent).toMatch(/audio|fallback|ready|error/i)

    fireEvent.pointerDown(screen.getByLabelText('C4'), { pointerId: 3, button: 0 })
    expect(screen.getByLabelText('C4')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.blur(window)
    fireEvent(window, new Event('pagehide'))
    expect(screen.getByLabelText('C4')).toHaveAttribute('aria-pressed', 'false')
    unmount()
    cleanup()
  })

  it('returns voice count to zero after dispose', () => {
    const engine = new PianoEngine({
      context: createAudioContext({ offline: true, durationSec: 1 }),
    })
    engine.noteOn(48, 0.7, 0)
    engine.noteOn(52, 0.7, 0)
    expect(engine.getActiveVoiceCount()).toBeGreaterThan(0)
    engine.dispose()
    expect(engine.getActiveVoiceCount()).toBe(0)
  })
})

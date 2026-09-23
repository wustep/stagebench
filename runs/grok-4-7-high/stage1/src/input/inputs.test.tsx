import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ManualTimers, type AudioBoundary, type AudioContextLike } from '../audio/boundaries'
import type { PianoEngine } from '../audio/engine'
import type { MidiAccessLike, MidiBoundary, MidiMessageEventLike, MidiPortLike } from './midi'
import { renderApp } from '../test/renderApp'
import { OfflineAudioContext } from 'node-web-audio-api'

class FakePort implements MidiPortLike {
  state: 'connected' | 'disconnected' = 'connected'
  private listeners: Record<string, Set<(event: MidiMessageEventLike) => void>> = {}

  addEventListener(type: 'midimessage' | 'statechange', listener: (event: MidiMessageEventLike) => void) {
    this.listeners[type] ??= new Set()
    this.listeners[type].add(listener)
  }

  removeEventListener(type: 'midimessage' | 'statechange', listener: (event: MidiMessageEventLike) => void) {
    this.listeners[type]?.delete(listener)
  }

  emit(bytes: number[]) {
    const event = { data: Uint8Array.from(bytes) }
    this.listeners.midimessage?.forEach((listener) => listener(event))
  }

  disconnect() {
    this.state = 'disconnected'
    this.listeners.statechange?.forEach((listener) => listener({ data: null }))
  }
}

function audioBoundary(): AudioBoundary {
  const timers = new ManualTimers()
  const context = new OfflineAudioContext(1, 44100, 44100)
  return { createContext: () => context as unknown as AudioContextLike, timers }
}

describe('piano.basic-inputs', () => {
  it('maps computer keys, suppresses repeat, and uses Space as sustain', () => {
    let engine: PianoEngine | null = null
    renderApp({
      audio: audioBoundary(),
      onEngine: (created) => {
        engine = created
      },
    })
    fireEvent.keyDown(window, { code: 'KeyA' })
    fireEvent.keyDown(window, { code: 'KeyA', repeat: true })
    fireEvent.keyDown(window, { code: 'KeyD' })
    expect(engine!.heldVoiceCount()).toBe(2)
    expect(document.querySelector('[data-note="C4"]')).toHaveAttribute('data-pressed', 'true')
    expect(document.querySelector('[data-note="E4"]')).toHaveAttribute('data-pressed', 'true')
    fireEvent.keyUp(window, { code: 'KeyA' })
    expect(document.querySelector('[data-note="C4"]')).toHaveAttribute('data-pressed', 'false')
    expect(engine!.isNoteActive(64)).toBe(true)

    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.keyDown(window, { code: 'Space', repeat: true })
    fireEvent.keyUp(window, { code: 'KeyD' })
    expect(engine!.isSustainDown()).toBe(true)
    expect(engine!.isNoteActive(64)).toBe(true)
    fireEvent.keyUp(window, { code: 'Space' })
    expect(engine!.isSustainDown()).toBe(false)
  })

  it('plays MIDI notes with velocity and CC64, and handles denied and disconnected access', async () => {
    const port = new FakePort()
    const access: MidiAccessLike = {
      inputs: [port],
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
    const midi: MidiBoundary = {
      isSupported: () => true,
      requestAccess: async () => access,
    }
    let engine: PianoEngine | null = null
    const view = renderApp({
      audio: audioBoundary(),
      midi,
      onEngine: (created) => {
        engine = created
      },
    })
    await waitFor(() => expect(screen.getByTestId('engine-status')).toHaveAttribute('data-midi', 'ready'))
    port.emit([0x90, 60, 100])
    port.emit([0x90, 60, 100])
    expect(engine!.heldVoiceCount()).toBe(1)
    expect(engine!.activeVoiceCount()).toBeGreaterThanOrEqual(1)
    port.emit([0xb0, 64, 127])
    port.emit([0x80, 60, 0])
    expect(engine!.isSustainDown()).toBe(true)
    expect(engine!.isNoteActive(60)).toBe(true)
    port.emit([0xb0, 64, 0])
    expect(engine!.isSustainDown()).toBe(false)

    port.disconnect()
    await waitFor(() => expect(screen.getByTestId('engine-status')).toHaveAttribute('data-midi', 'disconnected'))
    expect(engine!.activeVoiceCount()).toBe(0)
    view.unmount()

    const denied: MidiBoundary = {
      isSupported: () => true,
      requestAccess: async () => {
        throw new DOMException('denied', 'SecurityError')
      },
    }
    renderApp({ audio: audioBoundary(), midi: denied })
    await waitFor(() => expect(screen.getAllByTestId('engine-status').at(-1)).toHaveAttribute('data-midi', 'denied'))
  })

  it('drives two keys from independent pointers', () => {
    let engine: PianoEngine | null = null
    renderApp({
      audio: audioBoundary(),
      onEngine: (created) => {
        engine = created
      },
    })
    const c4 = document.querySelector<HTMLElement>('[data-note="C4"]')!
    const g4 = document.querySelector<HTMLElement>('[data-note="G4"]')!
    fireEvent.pointerDown(c4, { pointerId: 3, clientY: 20 })
    fireEvent.pointerDown(g4, { pointerId: 4, clientY: 80 })
    expect(engine!.heldVoiceCount()).toBe(2)
    fireEvent.pointerCancel(g4, { pointerId: 4 })
    expect(engine!.isNoteActive(67)).toBe(false)
    expect(engine!.isNoteActive(60)).toBe(true)
  })
})

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type {
  MidiAccessLike,
  MidiInputLike,
  MidiMessageEventLike,
  MidiProvider,
  PianoEngineStatusSnapshot,
  PianoVoiceBackend,
} from '../audio/boundaries'

function createTrackingBackend() {
  const events: Array<{ type: 'on' | 'off' | 'stopAll'; voiceId?: number; midi?: number; velocity?: number; fastSteal?: boolean }> = []
  const status: PianoEngineStatusSnapshot = {
    status: 'ready',
    loadedSamples: 78,
    totalSamples: 78,
    usingFallback: false,
    message: 'Salamander Grand V3 ready (78/78 samples)',
    audioContextState: 'running',
  }
  const backend: PianoVoiceBackend = {
    unlock: vi.fn(async () => undefined),
    triggerNote: (voiceId, midi, velocity) => events.push({ type: 'on', voiceId, midi, velocity }),
    releaseNote: (voiceId, fastSteal) => events.push({ type: 'off', voiceId, fastSteal }),
    stopAllImmediate: () => events.push({ type: 'stopAll' }),
    getActiveNodeCount: () => 0,
    getStatus: () => status,
    subscribeStatus: () => () => undefined,
    dispose: vi.fn(),
  }
  return { backend, events }
}

function createFakeMidiEnvironment() {
  const inputsMap = new Map<string, MidiInputLike>()
  const access: MidiAccessLike = {
    inputs: inputsMap,
    onstatechange: null,
  }
  const port: MidiInputLike = {
    id: 'virtual-port-1',
    name: 'Virtual Stage Controller',
    state: 'connected',
    onmidimessage: null,
  }
  inputsMap.set(port.id, port)

  const provider: MidiProvider = {
    isSupported: () => true,
    requestAccess: async () => access,
  }

  const sendBytes = (bytes: number[]) => {
    const ev: MidiMessageEventLike = { data: new Uint8Array(bytes) }
    port.onmidimessage?.(ev)
  }

  const disconnectPort = () => {
    inputsMap.set(port.id, { ...port, state: 'disconnected' })
    access.onstatechange?.()
  }

  return { provider, sendBytes, disconnectPort }
}

afterEach(() => {
  cleanup()
})

describe('interaction.keys — pointer, multi-touch, keyboard, and blur cleanup', () => {
  it('supports independent multi-touch pointers and pointerCancel without cross-releasing keys', () => {
    const { backend, events } = createTrackingBackend()
    const midi = createFakeMidiEnvironment()
    const { container } = render(<App pianoBackend={backend} midiProvider={midi.provider} />)

    const keyC4 = container.querySelector<HTMLButtonElement>('#key-60-C4')!
    const keyE4 = container.querySelector<HTMLButtonElement>('#key-64-E4')!

    // Finger 1 presses C4, finger 2 presses E4 independently
    fireEvent.pointerDown(keyC4, { pointerId: 1, button: 0, pointerType: 'touch' })
    fireEvent.pointerDown(keyE4, { pointerId: 2, button: 0, pointerType: 'touch' })

    expect(keyC4.getAttribute('aria-pressed')).toBe('true')
    expect(keyE4.getAttribute('aria-pressed')).toBe('true')
    expect(events.filter((e) => e.type === 'on').map((e) => e.midi)).toEqual([60, 64])

    // Canceling finger 1 releases only C4, leaving E4 active
    fireEvent.pointerCancel(keyC4, { pointerId: 1, pointerType: 'touch' })
    expect(keyC4.getAttribute('aria-pressed')).toBe('false')
    expect(keyE4.getAttribute('aria-pressed')).toBe('true')

    // Releasing finger 2 releases E4
    fireEvent.pointerUp(keyE4, { pointerId: 2, pointerType: 'touch' })
    expect(keyE4.getAttribute('aria-pressed')).toBe('false')
    expect(events.filter((e) => e.type === 'off')).toHaveLength(2)
  })

  it('maps computer keyboard keys with repeat suppression and stops all notes on window blur', () => {
    const { backend, events } = createTrackingBackend()
    const midi = createFakeMidiEnvironment()
    const { container } = render(<App pianoBackend={backend} midiProvider={midi.provider} />)

    // KeyA maps to C4 (MIDI 60)
    fireEvent.keyDown(window, { code: 'KeyA', key: 'a', repeat: false })
    fireEvent.keyDown(window, { code: 'KeyA', key: 'a', repeat: true })
    fireEvent.keyDown(window, { code: 'KeyA', key: 'a', repeat: true })

    expect(events.filter((e) => e.type === 'on')).toHaveLength(1)
    expect(container.querySelector('#key-60-C4')?.getAttribute('aria-pressed')).toBe('true')

    // Window blur immediately clears held notes
    fireEvent(window, new Event('blur'))
    expect(container.querySelector('#key-60-C4')?.getAttribute('aria-pressed')).toBe('false')
    expect(events.some((e) => e.type === 'stopAll')).toBe(true)
  })
})

describe('piano.basic-inputs — Web MIDI note, velocity, CC64 sustain, denied & disconnected states', () => {
  it('listens to Web MIDI note-on/off, velocity, sustain CC64, and releases notes on disconnect', async () => {
    const { backend, events } = createTrackingBackend()
    const midi = createFakeMidiEnvironment()
    const { container, getByTestId } = render(
      <App pianoBackend={backend} midiProvider={midi.provider} />,
    )

    await act(async () => {
      await Promise.resolve()
    })
    expect(getByTestId('midi-status').textContent).toMatch(/Virtual Stage Controller/i)

    // Sustain ON (CC64 = 127)
    act(() => {
      midi.sendBytes([0xb0, 64, 127])
      // Note On A4 (69) velocity 112
      midi.sendBytes([0x90, 69, 112])
      // Note Off A4 (velocity 0) while sustain is down -> stays sounding
      midi.sendBytes([0x90, 69, 0])
    })

    const onEvents = events.filter((e) => e.type === 'on')
    expect(onEvents).toHaveLength(1)
    expect(onEvents[0]).toMatchObject({ midi: 69, velocity: 112 })
    expect(events.filter((e) => e.type === 'off')).toHaveLength(0)
    expect(container.querySelector('#key-69-A4')?.classList.contains('is-sustained')).toBe(true)

    // Sustain OFF (CC64 = 0) -> releases sustained A4
    act(() => {
      midi.sendBytes([0xb0, 64, 0])
    })
    expect(events.filter((e) => e.type === 'off')).toHaveLength(1)

    // Hold a new note and disconnect MIDI port -> cleans up note automatically
    act(() => {
      midi.sendBytes([0x90, 72, 90])
    })
    expect(container.querySelector('#key-72-C5')?.getAttribute('aria-pressed')).toBe('true')

    act(() => {
      midi.disconnectPort()
    })
    expect(container.querySelector('#key-72-C5')?.getAttribute('aria-pressed')).toBe('false')
    expect(getByTestId('midi-status').textContent).toMatch(/no input devices/i)
  })

  it('truthfully surfaces Web MIDI permission denied status', async () => {
    const { backend } = createTrackingBackend()
    const deniedProvider: MidiProvider = {
      isSupported: () => true,
      requestAccess: async () => {
        const err = new Error('User denied MIDI access')
        err.name = 'SecurityError'
        throw err
      },
    }
    const { getByTestId } = render(<App pianoBackend={backend} midiProvider={deniedProvider} />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(getByTestId('midi-status').textContent).toMatch(/denied/i)
  })
})

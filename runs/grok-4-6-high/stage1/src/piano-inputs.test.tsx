import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { MidiController, type MidiAccessLike, type MidiInputLike } from './input/midi'

function fakeInput(): MidiInputLike & { emit: (data: number[]) => void } {
  const listeners = new Set<(event: { data: number[] }) => void>()
  const port: MidiInputLike & { emit: (data: number[]) => void } = {
    state: 'connected',
    onmidimessage: null,
    addEventListener(_type, listener) {
      listeners.add(listener)
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener)
    },
    emit(data: number[]) {
      const event = { data }
      for (const listener of listeners) listener(event)
    },
  }
  return port
}

describe('piano.basic-inputs', () => {
  it('plays from pointer, independent multi-touch, and mapped keyboard', () => {
    render(<App deps={{ autoMidi: false }} />)
    const c4 = screen.getByLabelText('C4')
    const e4 = screen.getByLabelText('E4')
    fireEvent.pointerDown(c4, { pointerId: 11, button: 0 })
    fireEvent.pointerDown(e4, { pointerId: 12, button: 0 })
    expect(c4).toHaveAttribute('aria-pressed', 'true')
    expect(e4).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerUp(c4, { pointerId: 11 })
    expect(c4).toHaveAttribute('aria-pressed', 'false')
    expect(e4).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerUp(e4, { pointerId: 12 })

    fireEvent.keyDown(window, { code: 'KeyQ', key: 'q', repeat: false })
    expect(screen.getByLabelText('C4')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { code: 'KeyQ', key: 'q', repeat: true })
    fireEvent.keyUp(window, { code: 'KeyQ', key: 'q' })
    expect(screen.getByLabelText('C4')).toHaveAttribute('aria-pressed', 'false')
  })

  it('handles MIDI note, velocity, sustain, denied, and disconnected states', async () => {
    const input = fakeInput()
    const access: MidiAccessLike = {
      inputs: new Map([['pad', input]]),
      onstatechange: null,
    }
    const notes: number[] = []
    const sustains: boolean[] = []
    const states: string[] = []
    const midi = new MidiController(
      {
        noteOn: (note, velocity) => notes.push(note + velocity),
        noteOff: (note) => notes.push(-note),
        sustain: (down) => sustains.push(down),
        onState: (state) => states.push(state),
      },
      async () => access,
    )
    await midi.connect()
    expect(midi.getState()).toBe('connected')
    input.emit([0x90, 60, 100])
    input.emit([0x80, 60, 0])
    input.emit([0xb0, 64, 127])
    input.emit([0xb0, 64, 0])
    expect(notes[0]).toBeCloseTo(60 + 100 / 127, 5)
    expect(notes[1]).toBe(-60)
    expect(sustains).toEqual([true, false])
    midi.disconnect()
    expect(midi.getState()).toBe('disconnected')
    midi.dispose()

    const denied = new MidiController(
      {
        noteOn() {},
        noteOff() {},
        sustain() {},
        onState: (state) => states.push(state),
      },
      async () => {
        const err = new Error('denied')
        err.name = 'SecurityError'
        throw err
      },
    )
    await denied.connect()
    expect(denied.getState()).toBe('denied')

    const missing = new MidiController(
      {
        noteOn() {},
        noteOff() {},
        sustain() {},
        onState: (state) => states.push(state),
      },
      null,
    )
    await missing.connect()
    expect(missing.getState()).toBe('unavailable')
  })

  it('wires MIDI into the instrument and clears notes on disconnect', async () => {
    const input = fakeInput()
    const access: MidiAccessLike = {
      inputs: new Map([['pad', input]]),
      onstatechange: null,
    }
    render(
      <App
        deps={{
          requestMIDIAccess: async () => access,
        }}
      />,
    )
    await screen.findByText(/MIDI connected/)
    await waitFor(() => {
      expect(document.querySelector('[data-midi-state="connected"]')).toBeTruthy()
    })
    input.emit([0x90, 64, 90])
    await waitFor(() => {
      expect(screen.getByLabelText('E4')).toHaveAttribute('aria-pressed', 'true')
    })
    input.emit([0xb0, 64, 127])
    await waitFor(() => {
      expect(screen.getByLabelText('Sustain pedal')).toHaveAttribute('aria-pressed', 'true')
    })
    access.onstatechange?.({ port: { state: 'disconnected', type: 'input' } })
    await waitFor(() => {
      expect(screen.getByLabelText('E4')).toHaveAttribute('aria-pressed', 'false')
    })
  })
})

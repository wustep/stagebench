import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import App from './App'
import type { MidiAccess, MidiSource } from './piano/midi'
import type { AudioStatus } from './piano/sound'
import type { InstrumentEnvironment } from './piano/useInstrument'

type MidiListener = Parameters<MidiSource['addEventListener']>[1]
afterEach(cleanup)

function outputFixture(status: AudioStatus = 'ready') {
  type FakeVoice = { release: Mock<(seconds?: number) => void>; stop: Mock<() => void> }
  const voices: FakeVoice[] = []
  const audio = {
    prepare: vi.fn(),
    activate: vi.fn(),
    dispose: vi.fn(),
    play: vi.fn((_note: number, _velocity: number, ended: () => void) => {
      const voice = { release: vi.fn(), stop: vi.fn(ended) }
      voices.push(voice)
      return voice
    }),
    stopAll: vi.fn(() => { voices.forEach((voice) => voice.stop()) }),
  }
  const environment: InstrumentEnvironment = {
    createAudio(update) {
      audio.prepare.mockImplementation(() => update(status))
      return audio
    },
    requestMidi: () => undefined,
    document,
    window,
  }
  return { audio, voices, environment }
}

function midiFixture() {
  function input(id: string) {
    const listeners = new Set<MidiListener>()
    const source: MidiSource = {
      id,
      state: 'connected',
      addEventListener: (_name, listener) => { listeners.add(listener) },
      removeEventListener: (_name, listener) => { listeners.delete(listener) },
    }
    return {
      source, listeners,
      send: (...data: number[]) => act(() => listeners.forEach((listener) => listener({ data }))),
    }
  }
  const first = input('first')
  const second = input('second')
  const inputs = new Map([['first', first.source], ['second', second.source]])
  const listeners = new Set<() => void>()
  const access: MidiAccess = {
    inputs,
    addEventListener: (_name, listener) => { listeners.add(listener) },
    removeEventListener: (_name, listener) => { listeners.delete(listener) },
  }
  return {
    first, second, listeners, access,
    refresh: () => act(() => listeners.forEach((listener) => listener())),
  }
}

describe('physical interactions', () => {
  it('plays independent touch pointers and ends each with its own up or cancel', () => {
    const { audio, voices, environment } = outputFixture()
    render(<App environment={environment} />)
    const low = screen.getByRole('button', { name: 'E1' })
    const high = screen.getByRole('button', { name: 'E7' })
    fireEvent.pointerDown(low, { pointerType: 'touch', pointerId: 17, button: 0 })
    fireEvent.pointerDown(high, { pointerType: 'touch', pointerId: 23, button: 0 })
    expect(audio.play.mock.calls.map(([note]) => note)).toEqual([28, 100])
    expect(low).toHaveAttribute('data-held', 'true')
    expect(high).toHaveAttribute('data-held', 'true')
    fireEvent.pointerCancel(low, { pointerId: 17 })
    expect(voices[0].release).toHaveBeenCalledOnce()
    expect(voices[1].release).not.toHaveBeenCalled()
    expect(low).toHaveAttribute('data-held', 'false')
    fireEvent.pointerUp(high, { pointerId: 23 })
    expect(voices[1].release).toHaveBeenCalledOnce()
    expect(high).toHaveAttribute('data-held', 'false')
  })

  it('plays focused keys, suppresses computer-key repeat, and clears sound and display on blur', () => {
    const { audio, voices, environment } = outputFixture()
    render(<App environment={environment} />)
    const c4 = screen.getByRole('button', { name: 'C4' })
    fireEvent.keyDown(window, { code: 'KeyQ' })
    fireEvent.keyDown(window, { code: 'KeyQ', repeat: true })
    expect(c4).toHaveAttribute('data-held', 'true')
    expect(audio.play).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.keyUp(window, { code: 'KeyQ' })
    expect(c4).toHaveAttribute('data-held', 'false')
    expect(c4).toHaveAttribute('data-sustained', 'true')
    expect(voices[0].release).not.toHaveBeenCalled()
    fireEvent.keyUp(window, { code: 'Space' })
    expect(voices[0].release).toHaveBeenCalledOnce()
    fireEvent.keyDown(c4, { key: 'Enter', code: 'Enter' })
    expect(audio.play).toHaveBeenCalledTimes(2)
    fireEvent.blur(window)
    expect(c4).toHaveAttribute('data-held', 'false')
    expect(voices[1].stop).toHaveBeenCalledOnce()
  })

  it('moves the knob and drawbar and lights a button without playing or changing an OLED', () => {
    const { audio, environment } = outputFixture()
    const { container } = render(<App environment={environment} />)
    const program = container.querySelector('#program-oled')?.textContent
    const knob = screen.getByRole('slider', { name: 'Master Level' })
    const drawbar = screen.getByRole('slider', { name: /Organ Drawbar 1 / })
    const store = screen.getByRole('button', { name: 'Store Program' })
    const initialTurn = knob.style.getPropertyValue('--turn')
    fireEvent.keyDown(knob, { key: 'ArrowRight' })
    expect(knob).toHaveAttribute('aria-valuenow', '4')
    expect(knob.style.getPropertyValue('--turn')).not.toBe(initialTurn)
    fireEvent.keyDown(drawbar, { key: 'Home' })
    expect(drawbar).toHaveAttribute('aria-valuenow', '0')
    expect(drawbar.querySelectorAll('.level-graph__lit')).toHaveLength(0)
    fireEvent.click(store)
    expect(store).toHaveAttribute('aria-pressed', 'true')
    expect(store.querySelector('.led--lit')).toBeInTheDocument()
    expect(container.querySelector('#program-oled')?.textContent).toBe(program)
    expect(audio.play).not.toHaveBeenCalled()
  })
})

describe('input boundaries and status', () => {
  it('listens to every MIDI input with velocity, overlapping notes, and channel-scoped CC64', async () => {
    const { audio, voices, environment } = outputFixture()
    const midi = midiFixture()
    environment.requestMidi = () => async () => midi.access
    const app = render(<App environment={environment} />)
    await screen.findByText('MIDI connected')
    midi.first.send(0x92, 60, 107)
    midi.second.send(0x90, 60, 37)
    midi.first.send(0x92, 60, 79)
    expect(audio.play.mock.calls.map(([note, velocity]) => [note, velocity])).toEqual([[60, 107], [60, 37], [60, 79]])
    midi.first.send(0xb2, 64, 127)
    midi.first.send(0x82, 60, 0)
    midi.first.send(0x92, 60, 0)
    midi.second.send(0x90, 60, 0)
    expect(voices[0].release).not.toHaveBeenCalled()
    expect(voices[1].release).toHaveBeenCalledOnce()
    expect(voices[2].release).not.toHaveBeenCalled()
    midi.first.send(0xb2, 64, 63)
    expect(voices[0].release).toHaveBeenCalledOnce()
    expect(voices[2].release).toHaveBeenCalledOnce()
    midi.second.send(0x90, 63, 70)
    midi.first.source.state = 'disconnected'
    midi.refresh()
    expect(midi.first.listeners.size).toBe(0)
    expect(voices[3].stop).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'D♯4' })).toHaveAttribute('data-held', 'false')
    midi.second.source.state = 'disconnected'
    midi.refresh()
    expect(screen.getByText('No MIDI input')).toBeInTheDocument()
    app.unmount()
    expect(midi.second.listeners.size).toBe(0)
    expect(midi.listeners.size).toBe(0)
    expect(audio.dispose).toHaveBeenCalledOnce()
    const count = audio.play.mock.calls.length
    fireEvent.keyDown(window, { code: 'KeyQ' })
    expect(audio.play).toHaveBeenCalledTimes(count)
  })

  it('reports MIDI denial and keeps the fallback playable', async () => {
    const { audio, environment } = outputFixture('fallback')
    environment.requestMidi = () => async () => { throw new DOMException('Denied', 'NotAllowedError') }
    render(<App environment={environment} />)
    expect(await screen.findByText('MIDI permission denied')).toBeInTheDocument()
    expect(screen.getByText('Upright samples unavailable · Synth fallback')).toBeInTheDocument()
    fireEvent.keyDown(window, { code: 'KeyZ' })
    expect(audio.play).toHaveBeenCalledWith(48, 88, expect.any(Function))
  })

  it('moves from loading to ready and reports a later audio error', async () => {
    const { audio, environment } = outputFixture()
    let report: (status: AudioStatus) => void = () => {}
    environment.createAudio = (status) => { report = status; return audio }
    render(<App environment={environment} />)
    expect(screen.getByText('Loading upright piano · Synth fallback')).toBeInTheDocument()
    await act(() => report('ready'))
    await waitFor(() => expect(screen.getByText('Upright Piano KW ready')).toBeInTheDocument())
    act(() => report('error'))
    expect(screen.getByText('Audio unavailable')).toBeInTheDocument()
  })

  it('clears timed accessible key taps and their voices when the page loses focus', () => {
    vi.useFakeTimers()
    try {
      const { voices, environment } = outputFixture()
      render(<App environment={environment} />)
      const c4 = screen.getByRole('button', { name: 'C4' })
      fireEvent.click(c4, { detail: 0 })
      expect(c4).toHaveAttribute('data-held', 'true')
      expect(vi.getTimerCount()).toBe(1)
      fireEvent.blur(window)
      expect(vi.getTimerCount()).toBe(0)
      expect(voices[0].stop).toHaveBeenCalledOnce()
      expect(c4).toHaveAttribute('data-held', 'false')
    } finally {
      vi.useRealTimers()
    }
  })
})

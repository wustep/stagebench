import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { PianoEngine } from '../audio/engine'
import { FakeAudioBackend } from '../audio/fake-backend'
import type { MidiAccessLike, MidiInputLike } from '../input/midi'

class FakeMidiInput implements MidiInputLike {
  onmidimessage: ((e: { data: Uint8Array | number[] | null }) => void) | null = null
  constructor(
    public id: string,
    public state: string = 'connected',
  ) {}
  send(...data: number[]) {
    this.onmidimessage?.({ data })
  }
}

class FakeMidiAccess implements MidiAccessLike {
  inputs = new Map<string, MidiInputLike>()
  onstatechange: (() => void) | null = null
  add(input: FakeMidiInput) {
    this.inputs.set(input.id, input)
    this.onstatechange?.()
  }
  disconnectAll() {
    for (const i of this.inputs.values()) (i as FakeMidiInput).state = 'disconnected'
    this.onstatechange?.()
  }
}

function setup(midiAccess?: MidiAccessLike) {
  const backend = new FakeAudioBackend()
  const engine = new PianoEngine(backend)
  const utils = render(<App engine={engine} midiAccess={midiAccess ?? null} disableMidi={midiAccess === undefined} />)
  return { backend, engine, ...utils }
}

describe('piano.basic-inputs', () => {
  it('independent multi-touch: two pointers hold two notes independently', () => {
    const { container, engine } = setup()
    const c4 = container.querySelector('[data-key-id="key.c4"]')!
    const g4 = container.querySelector('[data-key-id="key.g4"]')!
    fireEvent.pointerDown(c4, { pointerId: 11, clientY: 40 })
    fireEvent.pointerDown(g4, { pointerId: 22, clientY: 40 })
    expect(engine.getVoices().filter((v) => !v.stopped).length).toBe(2)
    fireEvent.pointerUp(c4, { pointerId: 11 })
    // The second touch still holds its note.
    const gVoice = engine.getVoices().find((v) => v.note === 67)!
    expect(gVoice.releasedAt).toBeNull()
    fireEvent.pointerUp(g4, { pointerId: 22 })
    expect(engine.getVoices().find((v) => v.note === 67)!.releasedAt).not.toBeNull()
  })

  it('mapped computer keys play notes with repeat suppression', () => {
    const { engine } = setup()
    fireEvent.keyDown(window, { key: 'z' })
    expect(engine.getVoices().filter((v) => !v.stopped).length).toBe(1)
    fireEvent.keyDown(window, { key: 'z', repeat: true })
    fireEvent.keyDown(window, { key: 'z', repeat: true })
    expect(engine.getVoices().filter((v) => !v.stopped).length).toBe(1) // suppressed
    fireEvent.keyUp(window, { key: 'z' })
    expect(engine.getVoices()[0].releasedAt).not.toBeNull()
  })

  it('spacebar acts as sustain from the computer keyboard', () => {
    const { engine } = setup()
    fireEvent.keyDown(window, { key: 'z' })
    fireEvent.keyDown(window, { key: ' ' })
    expect(engine.isSustainDown()).toBe(true)
    fireEvent.keyUp(window, { key: 'z' })
    expect(engine.getVoices()[0].releasedAt).toBeNull() // sustained
    fireEvent.keyUp(window, { key: ' ' })
    expect(engine.isSustainDown()).toBe(false)
    expect(engine.getVoices()[0].releasedAt).not.toBeNull()
  })

  it('MIDI note on/off with velocity drives the lifecycle', async () => {
    const access = new FakeMidiAccess()
    const input = new FakeMidiInput('in-1')
    access.add(input)
    const { engine } = setup(access)
    await waitFor(() => expect(screen.getByText(/MIDI: ready/)).toBeInTheDocument())
    input.send(0x90, 60, 100)
    expect(engine.getVoices().length).toBe(1)
    expect(engine.getVoices()[0].velocity).toBeCloseTo(100 / 127, 3)
    input.send(0x80, 60, 0)
    expect(engine.getVoices()[0].releasedAt).not.toBeNull()
  })

  it('MIDI CC64 drives sustain', () => {
    const access = new FakeMidiAccess()
    const input = new FakeMidiInput('in-1')
    access.add(input)
    const { engine } = setup(access)
    input.send(0x90, 64, 90)
    input.send(0xb0, 64, 127) // sustain down
    expect(engine.isSustainDown()).toBe(true)
    input.send(0x80, 64, 0)
    expect(engine.getVoices()[0].releasedAt).toBeNull()
    input.send(0xb0, 64, 0) // sustain up
    expect(engine.getVoices()[0].releasedAt).not.toBeNull()
  })

  it('MIDI notes outside the 73-key range are ignored honestly', () => {
    const access = new FakeMidiAccess()
    const input = new FakeMidiInput('in-1')
    access.add(input)
    const { engine } = setup(access)
    input.send(0x90, 21, 100) // A0 — below E1
    input.send(0x90, 108, 100) // above E7
    expect(engine.getVoices().length).toBe(0)
  })

  it('denied MIDI access is reported truthfully', async () => {
    render(<App engine={new PianoEngine(new FakeAudioBackend())} midiAccess={null} />)
    await waitFor(() => {
      const el = document.querySelector('[data-status="midi"]')!
      expect(el.textContent).toMatch(/MIDI: (unsupported|denied)/)
    })
  })

  it('MIDI disconnect stops owned voices and reports disconnected', async () => {
    const access = new FakeMidiAccess()
    const input = new FakeMidiInput('in-1')
    access.add(input)
    const { engine, unmount } = setup(access)
    await waitFor(() => expect(screen.getByText(/MIDI: ready/)).toBeInTheDocument())
    input.send(0x90, 60, 100)
    expect(engine.getVoices().length).toBe(1)
    access.disconnectAll()
    await waitFor(() => expect(screen.getByText(/MIDI: disconnected/)).toBeInTheDocument())
    unmount() // unmount cleanup: all owned voices stop
    expect(engine.getVoices().length).toBe(0)
  })
})

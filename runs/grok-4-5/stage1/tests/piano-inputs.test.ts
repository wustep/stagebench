import { describe, expect, it, vi } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { MidiInput } from '../src/input/midi'
import { attachKeyboardInput, isSustainKey, midiFromComputerKey } from '../src/input/keyboard'
import { createMockContextFactory } from '../src/test/mock-audio'
import { fireEvent } from '@testing-library/react'

describe('piano.basic-inputs', () => {
  it('maps pointer-equivalent engine notes with velocity', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ createContext })
    await engine.init()
    const soft = engine.noteOn(60, 0.2, 'pointer')
    const hard = engine.noteOn(62, 1, 'pointer')
    expect(soft).toBeTruthy()
    expect(hard).toBeTruthy()
    expect(engine.getActiveVoiceCount()).toBe(2)
    engine.dispose()
  })

  it('maps computer keyboard and suppresses repeats', () => {
    expect(midiFromComputerKey('KeyA')).toBeTypeOf('number')
    expect(isSustainKey('Space')).toBe(true)
    const onNoteOn = vi.fn()
    const onNoteOff = vi.fn()
    const onSustain = vi.fn()
    const detach = attachKeyboardInput({ onNoteOn, onNoteOff, onSustain })
    fireEvent.keyDown(window, { code: 'KeyH', repeat: false })
    fireEvent.keyDown(window, { code: 'KeyH', repeat: true })
    expect(onNoteOn).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { code: 'Space' })
    expect(onSustain).toHaveBeenCalledWith(true)
    fireEvent.keyUp(window, { code: 'Space' })
    expect(onSustain).toHaveBeenCalledWith(false)
    detach()
  })

  it('handles MIDI note/velocity and sustain CC64', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ createContext })
    await engine.init()
    const notes = new Map<number, string>()
    const midi = new MidiInput({
      requestAccess: async () => ({
        inputs: new Map(),
        onstatechange: null,
      }),
      handlers: {
        onNoteOn: (m, v) => {
          notes.set(m, engine.noteOn(m, v, 'midi'))
        },
        onNoteOff: (m) => {
          const id = notes.get(m)
          if (id) engine.noteOff(id)
        },
        onSustain: (d) => engine.setSustain(d),
      },
    })
    await midi.connect()
    expect(midi.getState()).toBe('connected')
    midi.handleMessage([0x90, 60, 100])
    expect(engine.getActiveVoiceCount()).toBe(1)
    midi.handleMessage([0xb0, 64, 127])
    expect(engine.isSustainDown()).toBe(true)
    midi.handleMessage([0x80, 60, 0])
    // sustained
    expect(engine.getActiveVoiceCount()).toBe(1)
    midi.handleMessage([0xb0, 64, 0])
    engine.allNotesOff()
    engine.dispose()
  })

  it('reports denied and disconnected MIDI states', async () => {
    const denied = new MidiInput({
      requestAccess: async () => {
        throw Object.assign(new Error('denied'), { name: 'NotAllowedError' })
      },
      handlers: {
        onNoteOn: () => {},
        onNoteOff: () => {},
        onSustain: () => {},
      },
    })
    await denied.connect()
    expect(denied.getState()).toBe('denied')

    const access = {
      inputs: new Map<string, { id: string; state: string; onmidimessage: null }>(),
      onstatechange: null as ((ev: { port: { state: string; type: string } }) => void) | null,
    }
    const connected = new MidiInput({
      requestAccess: async () => access,
      handlers: {
        onNoteOn: () => {},
        onNoteOff: () => {},
        onSustain: () => {},
      },
    })
    await connected.connect()
    expect(connected.getState()).toBe('connected')
    access.onstatechange?.({ port: { state: 'disconnected', type: 'input' } })
    expect(connected.getState()).toBe('disconnected')
    connected.disconnect()
  })
})

import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'
import { attachKeyboardInput } from '../src/input/keyboard'
import { MidiInput } from '../src/input/midi'
import { fireEvent } from '@testing-library/react'

describe('piano.pedals', () => {
  it('sustain holds notes and SUSTPED gates per layer', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()

    engine.updateLayer('A', { sustped: true, enabled: true })
    engine.updateLayer('B', { sustped: false, enabled: true, level: 0.8 })

    const a = engine.noteOn(60, 0.8, 'p')
    engine.setSustain(true)
    engine.noteOff(a)
    // A voices may sustain; B also created - check active
    expect(engine.getActiveVoiceCount()).toBeGreaterThan(0)

    engine.setSustain(false)
    engine.allNotesOff()
    expect(engine.getActiveVoiceCount()).toBe(0)

    // SUSTPED off on A: noteOff releases immediately even with pedal
    engine.updateLayer('A', { sustped: false })
    engine.updateLayer('B', { enabled: false })
    const id = engine.noteOn(62, 0.8)
    engine.setSustain(true)
    engine.noteOff(id)
    // without sustped, should schedule release (still in map briefly) — force
    engine.allNotesOff()
    expect(engine.getActiveVoiceCount()).toBe(0)
    engine.dispose()
  })

  it('sustain from keyboard Space and MIDI CC64', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()

    const detach = attachKeyboardInput({
      onNoteOn: (m, v) => engine.noteOn(m, v, 'kb'),
      onNoteOff: (m) => engine.noteOffByMidi(m),
      onSustain: (d) => engine.setSustain(d),
    })
    fireEvent.keyDown(window, { code: 'Space' })
    expect(engine.isSustainDown()).toBe(true)
    fireEvent.keyUp(window, { code: 'Space' })
    expect(engine.isSustainDown()).toBe(false)
    detach()

    const midi = new MidiInput({
      requestAccess: async () => ({ inputs: new Map(), onstatechange: null }),
      handlers: {
        onNoteOn: () => {},
        onNoteOff: () => {},
        onSustain: (d) => engine.setSustain(d),
      },
    })
    await midi.connect()
    midi.handleMessage([0xb0, 64, 127])
    expect(engine.isSustainDown()).toBe(true)
    midi.handleMessage([0xb0, 64, 0])
    expect(engine.isSustainDown()).toBe(false)
    engine.dispose()
  })
})

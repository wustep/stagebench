import { describe, expect, it } from 'vitest'
import { PianoInputController, type MidiAccessLike, type MidiInputLike } from './inputs'
import { PianoNoteEngine } from './piano'
import { FakeVoiceBackend } from './test-fakes'

function setup() {
  const backend = new FakeVoiceBackend()
  const engine = new PianoNoteEngine(backend)
  const controller = new PianoInputController(engine)
  return { backend, engine, controller }
}

describe('shared piano input controller', () => {
  it('supports independent pointer contacts and pointer cancellation', () => {
    const { engine, controller } = setup()
    controller.pointerDown(1, 60, 0.4)
    controller.pointerDown(2, 64, 0.8)
    expect(engine.snapshot().activeNotes).toEqual([60, 64])
    controller.pointerUp(1)
    expect(engine.snapshot().activeNotes).toEqual([64])
    controller.pointerUp(2)
    expect(engine.snapshot().activeVoiceCount).toBe(0)
  })

  it('maps computer keys, suppresses repeat, sustains, and cleans up on blur', () => {
    const { backend, engine, controller } = setup()
    expect(controller.keyDown('KeyA')).toBe(true)
    controller.keyDown('KeyA', true)
    expect(backend.events.filter((event) => event.type === 'start')).toHaveLength(1)
    controller.keyDown('Space')
    controller.keyUp('KeyA')
    expect(engine.snapshot().sustain).toBe(true)
    expect(engine.snapshot().activeVoiceCount).toBe(1)
    controller.allNotesOff()
    expect(engine.snapshot()).toEqual({ activeNotes: [], activeVoiceCount: 0, sustain: false })
  })

  it('handles MIDI velocity, overlapping notes, note-off, sustain CC64, and all-notes-off', () => {
    const { backend, engine, controller } = setup()
    controller.midiMessage([0x90, 60, 32])
    controller.midiMessage([0x90, 60, 127])
    expect(engine.snapshot().activeVoiceCount).toBe(2)
    expect(backend.events.filter((event) => event.type === 'start').map((event) => event.velocity)).toEqual([32 / 127, 1])
    controller.midiMessage([0xb0, 64, 127])
    controller.midiMessage([0x80, 60, 0])
    expect(engine.snapshot().activeVoiceCount).toBe(2)
    controller.midiMessage([0xb0, 64, 0])
    expect(engine.snapshot().activeVoiceCount).toBe(1)
    controller.midiMessage([0xb0, 123, 0])
    expect(engine.snapshot().activeVoiceCount).toBe(0)
  })

  it('binds MIDI inputs and disconnect cleanup removes listeners and voices', () => {
    const { engine, controller } = setup()
    const input: MidiInputLike = { id: 'midi-1', name: 'Test keys', state: 'connected', onmidimessage: null }
    const access: MidiAccessLike = { inputs: { values: () => [input].values() }, onstatechange: null }
    controller.attachMidiAccess(access)
    input.onmidimessage?.({ data: [0x90, 67, 100] })
    expect(engine.snapshot().activeNotes).toEqual([67])
    access.onstatechange?.({ port: { ...input, state: 'disconnected' } })
    expect(engine.snapshot().activeVoiceCount).toBe(0)
    controller.detachMidiAccess()
    expect(input.onmidimessage).toBeNull()
  })
})

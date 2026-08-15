import { describe, expect, it, vi } from 'vitest'
import { PianoEngine } from '../src/audio/engine'
import { NoteLifecycle } from '../src/piano/lifecycle'
import { ComputerKeyboard, KEY_TO_MIDI, MidiInputBinding } from '../src/piano/inputs'
import type { MidiAccess, MidiInput, MidiInputStateEvent, MidiMessageEvent } from '../src/piano/inputs'

function makeLifecycle(): NoteLifecycle {
  return new NoteLifecycle({ engine: new PianoEngine({ sampleRate: 8000 }) })
}

function keyboardEvent(type: 'keydown' | 'keyup', key: string): KeyboardEvent {
  const event = new KeyboardEvent(type, { key, bubbles: true })
  return event
}

describe('piano.basic-inputs: computer keyboard', () => {
  it('maps keys to notes with the documented map', () => {
    expect(KEY_TO_MIDI.z).toBe(60) // C4
    expect(KEY_TO_MIDI.s).toBe(61) // C#4
    expect(KEY_TO_MIDI.u).toBe(83) // B5
  })

  it('note on/off via keydown/keyup', () => {
    const lc = makeLifecycle()
    const kb = new ComputerKeyboard({ lifecycle: lc })
    kb.attach(window)
    window.dispatchEvent(keyboardEvent('keydown', 'z'))
    expect(lc.status.activeNotes.get(60)).toBe(1)
    window.dispatchEvent(keyboardEvent('keyup', 'z'))
    expect(lc.status.activeNotes.has(60)).toBe(false)
    kb.detach()
  })

  it('suppresses key auto-repeat while a key is held', () => {
    const lc = makeLifecycle()
    const kb = new ComputerKeyboard({ lifecycle: lc })
    kb.attach(window)
    window.dispatchEvent(keyboardEvent('keydown', 'n'))
    window.dispatchEvent(keyboardEvent('keydown', 'n')) // repeat
    window.dispatchEvent(keyboardEvent('keydown', 'n'))
    // single voice for the note, count reflects one held source
    expect(lc.status.activeNotes.get(69)).toBe(1)
    window.dispatchEvent(keyboardEvent('keyup', 'n'))
    expect(lc.status.activeNotes.has(69)).toBe(false)
    kb.detach()
  })

  it('sustain key toggles sustain (Space)', () => {
    const lc = makeLifecycle()
    const kb = new ComputerKeyboard({ lifecycle: lc })
    kb.attach(window)
    window.dispatchEvent(keyboardEvent('keydown', ' '))
    expect(lc.status.sustain).toBe(true)
    window.dispatchEvent(keyboardEvent('keyup', ' '))
    expect(lc.status.sustain).toBe(false)
    kb.detach()
  })

  it('releases every held note on window blur (all-notes-off cleanup)', () => {
    const lc = makeLifecycle()
    const kb = new ComputerKeyboard({ lifecycle: lc })
    kb.attach(window)
    window.dispatchEvent(keyboardEvent('keydown', 'z'))
    window.dispatchEvent(keyboardEvent('keydown', 'x'))
    window.dispatchEvent(keyboardEvent('keydown', ' ')) // sustain
    window.dispatchEvent(new Event('blur'))
    expect(lc.status.activeNotes.size).toBe(0)
    expect(lc.status.sustain).toBe(false)
    expect(lc.status.voiceCount).toBe(0)
    kb.detach()
  })
})

function fakeMidiAccess(): MidiAccess {
  const handled: ((event: MidiMessageEvent) => void)[] = []
  const input: MidiInput = {
    get onmidimessage() { return handled[0] },
    set onmidimessage(fn) { handled[0] = fn },
  }
  const access: MidiAccess = {
    onstatechange: null,
    inputs: () => [input],
  }
  return access
}

describe('piano.basic-inputs: MIDI', () => {
  it('handles MIDI note on/off with velocity and sustain CC64', async () => {
    const lc = makeLifecycle()
    const access = fakeMidiAccess()
    const midi = new MidiInputBinding({ lifecycle: lc, requestAccess: async () => access })
    expect(await midi.connect()).toBe('granted')
    const input = access.inputs()[0]
    // note on C4 velocity 100
    input.onmidimessage?.({ data: [0x90, 60, 100] })
    expect(lc.status.activeNotes.get(60)).toBe(1)
    // sustain on (CC64 value 127)
    input.onmidimessage?.({ data: [0xb0, 64, 127] })
    expect(lc.status.sustain).toBe(true)
    // note off
    input.onmidimessage?.({ data: [0x80, 60, 0] })
    expect(lc.status.activeNotes.has(60)).toBe(false)
    midi.dispose()
  })

  it('MIDI note-off with zero velocity counts as release', async () => {
    const lc = makeLifecycle()
    const access = fakeMidiAccess()
    const midi = new MidiInputBinding({ lifecycle: lc, requestAccess: async () => access })
    await midi.connect()
    const input = access.inputs()[0]
    input.onmidimessage?.({ data: [0x90, 64, 90] })
    expect(lc.status.activeNotes.get(64)).toBe(1)
    input.onmidimessage?.({ data: [0x90, 64, 0] }) // note on velocity 0 = release
    expect(lc.status.activeNotes.has(64)).toBe(false)
    midi.dispose()
  })

  it('reports denied/unavailable MIDI truthfully', async () => {
    const lc = makeLifecycle()
    const denied = new MidiInputBinding({ lifecycle: lc, requestAccess: async () => 'unsupported' })
    expect(await denied.connect()).toBe('denied')
    expect(denied.permission).toBe('denied')
    denied.dispose()
  })

  it('fires forceRelease when a MIDI input disconnects', async () => {
    const lc = makeLifecycle()
    const access = fakeMidiAccess()
    const midi = new MidiInputBinding({ lifecycle: lc, requestAccess: async () => access })
    await midi.connect()
    const input = access.inputs()[0]
    input.onmidimessage?.({ data: [0x90, 60, 100] })
    input.onmidimessage?.({ data: [0x90, 64, 100] })
    expect(lc.status.activeNotes.size).toBe(2)
    // simulate disconnect
    access.onstatechange?.({ port: { connection: 'closed' } } as MidiInputStateEvent)
    expect(lc.status.activeNotes.size).toBe(0)
    expect(lc.status.voiceCount).toBe(0)
    midi.dispose()
  })
})
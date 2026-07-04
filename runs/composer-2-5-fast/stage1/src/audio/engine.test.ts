import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../audio/engine'
import { NoteLifecycle } from '../input/note-lifecycle'
import { attachMidiHandlers, createMockMidiPort } from '../input/midi'

describe('piano.basic-note-lifecycle', () => {
  it('starts and releases notes with cleanup', () => {
    const engine = new PianoEngine()
    const lc = new NoteLifecycle(engine)
    lc.pointerDown(60, 100)
    expect(engine.getActiveVoiceCount()).toBe(1)
    lc.pointerUp(60)
    expect(engine.getActiveVoiceCount()).toBe(0)
    lc.dispose()
  })

  it('supports repeated and overlapping notes on same key', () => {
    const engine = new PianoEngine()
    const lc = new NoteLifecycle(engine)
    lc.pointerDown(64, 90)
    lc.pointerDown(64, 70)
    expect(engine.getActiveVoiceCount()).toBeGreaterThanOrEqual(1)
    lc.pointerUp(64)
    expect(engine.getActiveVoiceCount()).toBe(0)
    lc.dispose()
  })

  it('all-notes-off clears every voice', () => {
    const engine = new PianoEngine()
    const lc = new NoteLifecycle(engine)
    lc.pointerDown(48, 100)
    lc.pointerDown(52, 100)
    lc.pointerDown(55, 100)
    engine.allNotesOff()
    expect(engine.getActiveVoiceCount()).toBe(0)
    lc.dispose()
  })
})

describe('piano.basic-inputs', () => {
  it('maps computer keys with repeat suppression', () => {
    const engine = new PianoEngine()
    const lc = new NoteLifecycle(engine)
    lc.computerKeyDown('KeyA', 48)
    lc.computerKeyDown('KeyA', 48)
    expect(lc.getPressedCount()).toBe(1)
    lc.computerKeyUp('KeyA', 48)
    expect(lc.getPressedCount()).toBe(0)
    lc.dispose()
  })

  it('handles MIDI note on/off and sustain CC64', () => {
    const engine = new PianoEngine()
    const lc = new NoteLifecycle(engine)
    const port = createMockMidiPort('connected')
    attachMidiHandlers(port, {
      onNoteOn: (n, v) => lc.midiNoteOn(n, v),
      onNoteOff: (n) => lc.midiNoteOff(n),
      onSustain: (on) => lc.setSustain(on),
    })
    port.simulateEvent({ type: 'noteon', note: 67, velocity: 100 })
    expect(lc.isPressed(67)).toBe(true)
    port.simulateEvent({ type: 'cc', controller: 64, value: 127 })
    port.simulateEvent({ type: 'noteoff', note: 67 })
    expect(engine.getActiveVoiceCount()).toBeGreaterThan(0)
    port.simulateEvent({ type: 'cc', controller: 64, value: 0 })
    expect(engine.getActiveVoiceCount()).toBe(0)
    lc.dispose()
  })

  it('ignores events when MIDI port is disconnected or denied', () => {
    const engine = new PianoEngine()
    const lc = new NoteLifecycle(engine)
    for (const state of ['disconnected', 'denied'] as const) {
      const port = createMockMidiPort(state)
      attachMidiHandlers(port, {
        onNoteOn: (n, v) => lc.midiNoteOn(n, v),
        onNoteOff: (n) => lc.midiNoteOff(n),
        onSustain: (on) => lc.setSustain(on),
      })
      port.simulateEvent({ type: 'noteon', note: 60, velocity: 100 })
      expect(lc.isPressed(60)).toBe(false)
    }
    lc.dispose()
  })
})

describe('piano.basic-sustain-polyphony', () => {
  it('holds notes while sustain is engaged', () => {
    const engine = new PianoEngine()
    const lc = new NoteLifecycle(engine)
    lc.pointerDown(60, 100)
    lc.setSustain(true)
    lc.pointerUp(60)
    expect(engine.getActiveVoiceCount()).toBe(1)
    lc.setSustain(false)
    expect(engine.getActiveVoiceCount()).toBe(0)
    lc.dispose()
  })

  it('steals oldest voice deterministically at polyphony limit', () => {
    const engine = new PianoEngine({ polyphony: 2 })
    const lc = new NoteLifecycle(engine)
    lc.pointerDown(60, 100)
    lc.pointerDown(62, 100)
    lc.pointerDown(64, 100)
    expect(engine.getActiveVoiceCount()).toBeLessThanOrEqual(2)
    lc.dispose()
  })

  it('velocity changes output level', () => {
    const engine = new PianoEngine()
    expect(engine.velocityToGain(127)).toBeGreaterThan(engine.velocityToGain(20))
    expect(engine.velocityToGain(20)).toBeGreaterThan(0)
    engine.dispose()
  })
})

describe('piano.basic-status-cleanup', () => {
  it('reports ready status and cleans up on blur', () => {
    const engine = new PianoEngine()
    const lc = new NoteLifecycle(engine)
    expect(engine.getStatus()).toBe('ready')
    lc.pointerDown(72, 100)
    lc.blurCleanup()
    expect(engine.getActiveVoiceCount()).toBe(0)
    lc.dispose()
    expect(engine.getActiveVoiceCount()).toBe(0)
  })

  it('reports error status when forced', () => {
    const engine = new PianoEngine({ forceError: true })
    expect(engine.getStatus()).toBe('error')
    expect(engine.noteOn(60, 100)).toBe(-1)
    engine.dispose()
  })
})

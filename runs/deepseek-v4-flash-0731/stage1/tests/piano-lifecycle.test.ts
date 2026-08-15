import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/engine'
import { NoteLifecycle } from '../src/piano/lifecycle'

function makeLifecycle(): NoteLifecycle {
  return new NoteLifecycle({ engine: new PianoEngine({ sampleRate: 8000 }) })
}

describe('piano.basic-note-lifecycle', () => {
  it('noteOn starts a voice and noteOff releases it', () => {
    const lc = makeLifecycle()
    lc.noteOn(60, 0.8, 'test')
    expect(lc.status.voiceCount).toBeGreaterThan(0)
    lc.noteOff(60, 'test')
    // release begins; voice still present until its tail elapses
    expect(lc.status.activeNotes.size).toBe(0)
  })

  it('repeated notes and overlapping notes from different sources', () => {
    const lc = makeLifecycle()
    lc.noteOn(60, 0.8, 'a')
    // a second, independent source on the same note must not double the voice
    lc.noteOn(60, 0.8, 'b')
    expect(lc.status.activeNotes.get(60)).toBe(2)
    lc.noteOff(60, 'a')
    // still held by b
    expect(lc.status.activeNotes.get(60)).toBe(1)
    lc.noteOff(60, 'b')
    expect(lc.status.activeNotes.has(60)).toBe(false)
  })

  it('overlapping notes on different pitches each get a voice', () => {
    const lc = makeLifecycle()
    lc.noteOn(60, 0.8, 'k')
    lc.noteOn(64, 0.8, 'k')
    expect(lc.status.activeNotes.size).toBe(2)
    lc.noteOff(60, 'k')
    lc.noteOff(64, 'k')
  })

  it('all-notes-off silences active presses and voices', () => {
    const lc = makeLifecycle()
    lc.noteOn(60, 0.8, 'k')
    lc.noteOn(64, 0.9, 'm')
    lc.allNotesOff()
    expect(lc.status.activeNotes.size).toBe(0)
    expect(lc.status.voiceCount).toBe(0)
  })

  it('clearSource releases everything that source held', () => {
    const lc = makeLifecycle()
    lc.noteOn(60, 0.8, 'touch')
    lc.noteOn(67, 0.8, 'touch')
    lc.clearSource('touch')
    expect(lc.status.activeNotes.size).toBe(0)
  })

  it('dispose releases every owned voice and stops accepting input', () => {
    const lc = makeLifecycle()
    lc.noteOn(60, 0.8, 'k')
    lc.dispose()
    expect(lc.status.voiceCount).toBe(0)
    expect(lc.isDisposed).toBe(true)
    lc.noteOn(72, 0.8, 'k') // ignored
    expect(lc.status.voiceCount).toBe(0)
  })
})

describe('piano.basic-sustain-polyphony (lifecycle side)', () => {
  it('sustain set/clear reflects in status', () => {
    const lc = makeLifecycle()
    expect(lc.status.sustain).toBe(false)
    lc.setSustain(true)
    expect(lc.status.sustain).toBe(true)
    lc.setSustain(false)
    expect(lc.status.sustain).toBe(false)
  })
})
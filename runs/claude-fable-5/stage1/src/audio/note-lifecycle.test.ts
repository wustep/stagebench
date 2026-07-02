import { describe, expect, it } from 'vitest'
import { fakeAudioBoundary } from '../test/fakes'
import { PianoEngine } from './engine'

describe('piano.basic-note-lifecycle', () => {
  it('starts lazily and reports ready with a real signal path to the destination', () => {
    const { boundary, getContext } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    expect(engine.getStatus().status).toBe('idle')
    engine.noteOn(60, 0.8)
    expect(engine.getStatus().status).toBe('ready')
    const context = getContext()!
    expect(context.oscillators().length).toBeGreaterThan(0)
    for (const osc of context.oscillators()) {
      expect(osc.started).toBe(true)
      expect(osc.reachesDestination()).toBe(true)
    }
  })

  it('noteOn creates a voice, noteOff releases it and nodes are cleaned up', () => {
    const { boundary, timers, getContext } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    engine.noteOn(60, 0.8)
    expect(engine.heldVoiceCount()).toBe(1)
    expect(engine.isNoteActive(60)).toBe(true)

    engine.noteOff(60)
    expect(engine.heldVoiceCount()).toBe(0)
    expect(engine.activeVoiceCount()).toBe(1) // still releasing

    timers.advance(2000)
    expect(engine.activeVoiceCount()).toBe(0)
    const context = getContext()!
    for (const osc of context.oscillators()) {
      expect(osc.stopped).toBe(true)
      expect(osc.disconnected).toBe(true)
    }
    // Only the master graph (gain + limiter) may remain connected.
    expect(context.liveNodes().every((n) => n.kind === 'gain' || n.kind === 'compressor')).toBe(true)
  })

  it('noteOff for a note that is not playing is a safe no-op', () => {
    const { boundary } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    expect(() => engine.noteOff(60)).not.toThrow()
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('repeated notes retrigger: old voice quick-releases, new voice starts', () => {
    const { boundary, timers, getContext } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    engine.noteOn(64, 0.7)
    const oscsAfterFirst = getContext()!.oscillators().length
    engine.noteOn(64, 0.7)
    expect(engine.heldVoiceCount()).toBe(1)
    expect(engine.activeVoiceCount()).toBe(2)
    expect(getContext()!.oscillators().length).toBe(oscsAfterFirst * 2)
    engine.noteOff(64)
    timers.advance(2000)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('overlapping notes each own an independent voice', () => {
    const { boundary, timers } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    engine.noteOn(60, 0.9)
    engine.noteOn(64, 0.9)
    engine.noteOn(67, 0.9)
    expect(engine.heldVoiceCount()).toBe(3)
    engine.noteOff(64)
    expect(engine.isNoteActive(60)).toBe(true)
    expect(engine.isNoteActive(64)).toBe(false)
    expect(engine.isNoteActive(67)).toBe(true)
    engine.noteOff(60)
    engine.noteOff(67)
    timers.advance(2000)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('allNotesOff releases everything, including sustained notes', () => {
    const { boundary, timers } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    engine.setSustain(true)
    engine.noteOn(60, 0.8)
    engine.noteOn(65, 0.8)
    engine.noteOff(65) // held by sustain
    expect(engine.activeVoiceCount()).toBe(2)
    engine.allNotesOff('input-cleanup')
    expect(engine.heldVoiceCount()).toBe(0)
    expect(engine.isSustainDown()).toBe(false)
    timers.advance(2000)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('leaves no pending cleanup timers once all voices are gone', () => {
    const { boundary, timers } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    for (const midi of [40, 52, 64, 76]) engine.noteOn(midi, 0.6)
    for (const midi of [40, 52, 64, 76]) engine.noteOff(midi)
    timers.advance(5000)
    expect(engine.activeVoiceCount()).toBe(0)
    expect(timers.pendingCount()).toBe(0)
  })
})

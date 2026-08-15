import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary } from '../test/fakes'
import { PianoEngine } from './engine'

/**
 * Phase 1 note-lifecycle semantics, preserved against the Phase 2 sampler
 * engine: lazy start, real signal path, retrigger, overlap, all-notes-off and
 * node/timer cleanup back to the standing graph.
 */
function makeEngine() {
  const setup = fakeAudioBoundary()
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  return { ...setup, engine }
}

describe('piano.basic-note-lifecycle', () => {
  it('starts lazily and reports ready with a real signal path to the destination', () => {
    const { engine, getContext } = makeEngine()
    expect(engine.getStatus().status).toBe('idle')
    engine.noteOn(60, 0.8)
    expect(engine.getStatus().status).toBe('ready')
    const context = getContext()!
    const sources = context.bufferSources()
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(source.started).toBe(true)
      expect(source.reachesDestination()).toBe(true)
    }
  })

  it('noteOn creates a voice, noteOff releases it and voice nodes are cleaned up', () => {
    const { engine, timers, getContext } = makeEngine()
    engine.ensureStarted()
    const context = getContext()!
    context.markStandingGraph()

    engine.noteOn(60, 0.8)
    expect(engine.heldVoiceCount()).toBe(1)
    expect(engine.isNoteActive(60)).toBe(true)
    expect(context.transientLiveNodes().length).toBeGreaterThan(0)

    engine.noteOff(60)
    expect(engine.heldVoiceCount()).toBe(0)
    expect(engine.activeVoiceCount()).toBe(1) // still releasing

    timers.advance(2000)
    expect(engine.activeVoiceCount()).toBe(0)
    for (const source of context.bufferSources()) {
      expect(source.stopped).toBe(true)
      expect(source.disconnected).toBe(true)
    }
    // Every voice-owned node is gone; only the standing graph remains live.
    expect(context.transientLiveNodes()).toHaveLength(0)
  })

  it('noteOff for a note that is not playing is a safe no-op', () => {
    const { engine } = makeEngine()
    expect(() => engine.noteOff(60)).not.toThrow()
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('repeated notes retrigger: old voice quick-releases, new voice starts', () => {
    const { engine, timers, getContext } = makeEngine()
    engine.noteOn(64, 0.7)
    const sourcesAfterFirst = getContext()!.bufferSources().length
    expect(sourcesAfterFirst).toBeGreaterThan(0)
    engine.noteOn(64, 0.7)
    expect(engine.heldVoiceCount()).toBe(1)
    expect(engine.activeVoiceCount()).toBe(2)
    expect(getContext()!.bufferSources().length).toBe(sourcesAfterFirst * 2)
    engine.noteOff(64)
    timers.advance(2000)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('overlapping notes each own an independent voice', () => {
    const { engine, timers } = makeEngine()
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
    const { engine, timers } = makeEngine()
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
    const { engine, timers } = makeEngine()
    for (const midi of [40, 52, 64, 76]) engine.noteOn(midi, 0.6)
    for (const midi of [40, 52, 64, 76]) engine.noteOff(midi)
    timers.advance(5000)
    expect(engine.activeVoiceCount()).toBe(0)
    expect(timers.pendingCount()).toBe(0)
  })
})

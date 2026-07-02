import { describe, expect, it } from 'vitest'
import { fakeAudioBoundary, FakeGain } from '../test/fakes'
import { MAX_POLYPHONY, PianoEngine } from './engine'

describe('piano.basic-sustain-polyphony', () => {
  it('sustain holds released notes until pedal up', () => {
    const { boundary, timers } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    engine.setSustain(true)
    engine.noteOn(60, 0.8)
    engine.noteOff(60)
    // Sustained: the voice must remain sounding.
    expect(engine.activeVoiceCount()).toBe(1)
    timers.advance(5000)
    expect(engine.activeVoiceCount()).toBe(1)

    engine.setSustain(false)
    timers.advance(2000)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('keys still held during pedal up keep sounding', () => {
    const { boundary, timers } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    engine.setSustain(true)
    engine.noteOn(60, 0.8)
    engine.noteOn(62, 0.8)
    engine.noteOff(62)
    engine.setSustain(false)
    timers.advance(2000)
    expect(engine.isNoteActive(60)).toBe(true)
    expect(engine.isNoteActive(62)).toBe(false)
  })

  it('pressing sustain after a release does not resurrect the note', () => {
    const { boundary, timers } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    engine.noteOn(60, 0.8)
    engine.noteOff(60)
    engine.setSustain(true)
    timers.advance(2000)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('supports useful polyphony up to the cap', () => {
    const { boundary } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    expect(MAX_POLYPHONY).toBeGreaterThanOrEqual(16)
    for (let i = 0; i < MAX_POLYPHONY; i++) engine.noteOn(30 + i, 0.7)
    expect(engine.heldVoiceCount()).toBe(MAX_POLYPHONY)
  })

  it('steals the oldest voice deterministically past the cap', () => {
    const { boundary } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    for (let i = 0; i < MAX_POLYPHONY; i++) engine.noteOn(30 + i, 0.7)
    engine.noteOn(29, 0.7)
    expect(engine.heldVoiceCount()).toBe(MAX_POLYPHONY)
    // The first (oldest) note was stolen; the newest note is active.
    expect(engine.isNoteActive(30)).toBe(false)
    expect(engine.isNoteActive(31)).toBe(true)
    expect(engine.isNoteActive(29)).toBe(true)

    // Deterministic: repeating the exact sequence steals the same voice.
    const second = new PianoEngine(fakeAudioBoundary().boundary)
    for (let i = 0; i < MAX_POLYPHONY; i++) second.noteOn(30 + i, 0.7)
    second.noteOn(29, 0.7)
    expect(second.isNoteActive(30)).toBe(false)
    expect(second.isNoteActive(31)).toBe(true)
  })

  it('maps velocity to level monotonically', () => {
    const peaks: number[] = []
    for (const velocity of [0.1, 0.5, 1]) {
      const { boundary, getContext } = fakeAudioBoundary()
      const engine = new PianoEngine(boundary)
      engine.noteOn(60, velocity)
      const context = getContext()!
      // First created gain is the master; the voice envelope gain is created next.
      const voiceGains = context.nodes.filter((n): n is FakeGain => n instanceof FakeGain).slice(1)
      const peak = Math.max(...voiceGains.map((g) => g.gain.maxScheduled()))
      peaks.push(peak)
    }
    expect(peaks[0]!).toBeGreaterThan(0)
    expect(peaks[1]!).toBeGreaterThan(peaks[0]!)
    expect(peaks[2]!).toBeGreaterThan(peaks[1]!)
  })

  it('clamps out-of-range velocity instead of failing', () => {
    const { boundary } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    expect(() => engine.noteOn(60, 4)).not.toThrow()
    expect(() => engine.noteOn(61, -1)).not.toThrow()
    expect(engine.heldVoiceCount()).toBe(2)
  })

  it('cleans every stolen and released voice back to a stable node count', () => {
    const { boundary, timers, getContext } = fakeAudioBoundary()
    const engine = new PianoEngine(boundary)
    for (let i = 0; i < MAX_POLYPHONY + 8; i++) engine.noteOn(30 + i, 0.7)
    engine.allNotesOff('input-cleanup')
    timers.advance(5000)
    expect(engine.activeVoiceCount()).toBe(0)
    expect(timers.pendingCount()).toBe(0)
    const live = getContext()!.liveNodes()
    expect(live.every((n) => n.kind === 'gain' || n.kind === 'compressor')).toBe(true)
    expect(live.length).toBeLessThanOrEqual(2)
  })
})

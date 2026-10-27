import { describe, expect, it, beforeEach } from 'vitest'
import { createPianoSession, type PianoSession } from '../audio/noteSession'
import { createManualClock, type ManualClock } from '../audio/clock'
import { createRecordingEngine, type RecordingEngine } from '../audio/fakes'
import { VARIANT } from '../hardware/variant'

/**
 * piano.basic-note-lifecycle — note on/off, repeated and overlapping notes, release,
 * all-notes-off, node cleanup.
 *
 * The session under test is the real one the app uses; only the audio engine and the
 * clock are fakes, so these tests need no device and no audio output.
 */
function makeSession(maxPolyphony?: number): {
  session: PianoSession
  engine: RecordingEngine
  clock: ManualClock
} {
  const engine = createRecordingEngine()
  const clock = createManualClock()
  const session = createPianoSession({
    engine,
    clock,
    lowestMidi: VARIANT.lowestMidi,
    highestMidi: VARIANT.highestMidi,
    maxPolyphony,
  })
  return { session, engine, clock }
}

describe('piano.basic-note-lifecycle', () => {
  let session: PianoSession
  let engine: RecordingEngine

  beforeEach(() => {
    ;({ session, engine } = makeSession())
  })

  it('starts a voice on press and ends it on release', () => {
    session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'pointer:1' })
    expect(session.snapshot().held).toEqual([60])
    expect(session.snapshot().sounding).toEqual([60])
    expect(engine.activeVoiceCount()).toBe(1)
    expect(engine.startedVoices).toHaveLength(1)
    expect(engine.startedVoices[0].midi).toBe(60)

    session.release('pointer', 'pointer:1', 60)
    expect(session.snapshot().held).toEqual([])
    expect(session.snapshot().sounding).toEqual([])
    expect(engine.activeVoiceCount()).toBe(0)
    expect(engine.endedVoices).toHaveLength(1)
  })

  it('returns every node and listener to baseline after a press/release cycle', () => {
    const baselineNodes = engine.liveNodeCount()
    const baselineVoices = engine.activeVoiceCount()
    for (let i = 0; i < 10; i += 1) {
      session.press({ midi: 48 + i, velocity: 0.5, source: 'pointer', owner: `pointer:${i}` })
    }
    expect(engine.liveNodeCount()).toBeGreaterThan(baselineNodes)
    for (let i = 0; i < 10; i += 1) {
      session.release('pointer', `pointer:${i}`, 48 + i)
    }
    expect(engine.liveNodeCount()).toBe(baselineNodes)
    expect(engine.activeVoiceCount()).toBe(baselineVoices)
    expect(session.snapshot().voices).toHaveLength(0)
  })

  it('ignores a release for a note that was never pressed', () => {
    expect(() => session.release('pointer', 'pointer:9', 60)).not.toThrow()
    expect(engine.endedVoices).toHaveLength(0)
    expect(session.snapshot().sounding).toEqual([])
  })

  it('suppresses a repeated press from the same owner', () => {
    session.press({ midi: 60, velocity: 0.6, source: 'keyboard', owner: 'keyboard:KeyZ' })
    session.press({ midi: 60, velocity: 0.6, source: 'keyboard', owner: 'keyboard:KeyZ' })
    expect(engine.startedVoices).toHaveLength(1)
    expect(session.snapshot().held).toEqual([60])
  })

  it('does not strand a note when one of two owners releases it', () => {
    session.press({ midi: 60, velocity: 0.6, source: 'pointer', owner: 'pointer:1' })
    session.press({ midi: 60, velocity: 0.9, source: 'keyboard', owner: 'keyboard:KeyZ' })
    session.release('pointer', 'pointer:1', 60)
    expect(session.snapshot().held).toEqual([60])
    expect(session.snapshot().velocities[60]).toBeCloseTo(0.9, 5)
    session.release('keyboard', 'keyboard:KeyZ', 60)
    expect(session.snapshot().sounding).toEqual([])
  })

  it('re-strikes an overlapping note with a new attack', () => {
    session.press({ midi: 64, velocity: 0.3, source: 'pointer', owner: 'pointer:1' })
    session.press({ midi: 64, velocity: 0.9, source: 'pointer', owner: 'pointer:2' })
    // Two strokes, so the engine saw the first voice end and a louder one begin.
    expect(engine.startedVoices).toHaveLength(2)
    expect(engine.endedVoices).toHaveLength(1)
    expect(session.snapshot().velocities[64]).toBeCloseTo(0.9, 5)
    // Both fingers still own the note.
    session.release('pointer', 'pointer:1', 64)
    session.release('pointer', 'pointer:2', 64)
    expect(session.snapshot().sounding).toEqual([])
  })

  it('plays independent simultaneous notes from different owners', () => {
    session.press({ midi: 48, velocity: 0.5, source: 'pointer', owner: 'pointer:1' })
    session.press({ midi: 72, velocity: 0.5, source: 'pointer', owner: 'pointer:2' })
    session.press({ midi: 60, velocity: 0.5, source: 'keyboard', owner: 'keyboard:KeyC' })
    expect(session.snapshot().held).toEqual([48, 60, 72])
    expect(engine.activeVoiceCount()).toBe(3)
  })

  it('releases only the notes one owner held', () => {
    session.press({ midi: 48, velocity: 0.5, source: 'pointer', owner: 'pointer:1' })
    session.press({ midi: 72, velocity: 0.5, source: 'pointer', owner: 'pointer:2' })
    session.releaseOwner('pointer', 'pointer:1')
    expect(session.snapshot().held).toEqual([72])
    expect(engine.activeVoiceCount()).toBe(1)
  })

  it('rejects notes outside the instrument range', () => {
    session.press({ midi: 27, velocity: 0.5, source: 'pointer', owner: 'pointer:1' })
    session.press({ midi: 101, velocity: 0.5, source: 'pointer', owner: 'pointer:1' })
    expect(engine.startedVoices).toHaveLength(0)
    expect(session.snapshot().sounding).toEqual([])
  })

  it('accepts the first and last key of the range', () => {
    session.press({ midi: 28, velocity: 0.5, source: 'pointer', owner: 'p:1' })
    session.press({ midi: 100, velocity: 0.5, source: 'pointer', owner: 'p:2' })
    expect(session.snapshot().held).toEqual([28, 100])
  })

  it('stops every voice on all-notes-off and records why', () => {
    for (let i = 0; i < 6; i += 1) {
      session.press({ midi: 50 + i, velocity: 0.6, source: 'pointer', owner: `pointer:${i}` })
    }
    expect(engine.activeVoiceCount()).toBe(6)
    session.allNotesOff('blur')
    expect(engine.activeVoiceCount()).toBe(0)
    expect(engine.liveNodeCount()).toBe(0)
    expect(engine.stopAllCalls).toBeGreaterThan(0)
    expect(session.snapshot().sounding).toEqual([])
    expect(session.snapshot().sustainPedal).toBe(false)
    expect(session.lastAllNotesOffReason()).toBe('blur')
  })

  it('clears the sustain pedal on all-notes-off', () => {
    session.setSustain(true, 'midi:dev')
    expect(session.snapshot().sustainPedal).toBe(true)
    session.allNotesOff('panic')
    expect(session.snapshot().sustainPedal).toBe(false)
  })

  it('notifies subscribers, and stops after they unsubscribe', () => {
    const seen: number[] = []
    const unsubscribe = session.subscribe((snap) => seen.push(snap.sounding.length))
    session.press({ midi: 60, velocity: 0.5, source: 'pointer', owner: 'p:1' })
    session.release('pointer', 'p:1', 60)
    const countBefore = seen.length
    unsubscribe()
    session.press({ midi: 62, velocity: 0.5, source: 'pointer', owner: 'p:2' })
    expect(seen.length).toBe(countBefore)
    expect(countBefore).toBeGreaterThanOrEqual(3)
  })

  it('goes inert after dispose and releases everything it owned', () => {
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    session.dispose()
    expect(engine.activeVoiceCount()).toBe(0)
    expect(session.snapshot().sounding).toEqual([])
    expect(session.lastAllNotesOffReason()).toBe('unmount')
    session.press({ midi: 62, velocity: 0.7, source: 'pointer', owner: 'p:2' })
    expect(engine.startedVoices).toHaveLength(1)
  })
})

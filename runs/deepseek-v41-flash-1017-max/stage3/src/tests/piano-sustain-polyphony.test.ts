import { describe, expect, it } from 'vitest'
import { createPianoSession, MAX_POLYPHONY, type PianoSession } from '../audio/noteSession'
import { createManualClock } from '../audio/clock'
import { createRecordingEngine, type RecordingEngine } from '../audio/fakes'
import { VARIANT } from '../hardware/variant'

/**
 * piano.basic-sustain-polyphony — sustain transitions, concurrent voices, deterministic
 * stealing, and velocity response at the session boundary.
 *
 * The audible half of these claims (that velocity really changes the sound, that sustain
 * really lengthens it) is measured on real samples in `piano-model.test.ts`; here the
 * assertions are about which voices the one lifecycle starts and keeps.
 */
function makeSession(maxPolyphony?: number): { session: PianoSession; engine: RecordingEngine } {
  const engine = createRecordingEngine()
  const session = createPianoSession({
    engine,
    clock: createManualClock(),
    lowestMidi: VARIANT.lowestMidi,
    highestMidi: VARIANT.highestMidi,
    maxPolyphony,
  })
  return { session, engine }
}

describe('piano.basic-sustain-polyphony — sustain', () => {
  it('keeps a released note sounding while the pedal is down', () => {
    const { session, engine } = makeSession()
    session.setSustain(true, 'ui:sustain')
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    session.release('pointer', 'p:1', 60)
    expect(session.snapshot().held).toEqual([])
    expect(session.snapshot().sustained).toEqual([60])
    expect(session.snapshot().sounding).toEqual([60])
    expect(engine.activeVoiceCount()).toBe(1)
  })

  it('damps every sustained note when the pedal lifts', () => {
    const { session, engine } = makeSession()
    session.setSustain(true, 'ui:sustain')
    for (const midi of [48, 52, 55]) {
      session.press({ midi, velocity: 0.6, source: 'pointer', owner: `p:${midi}` })
      session.release('pointer', `p:${midi}`, midi)
    }
    expect(engine.activeVoiceCount()).toBe(3)
    session.setSustain(false, 'ui:sustain')
    expect(engine.activeVoiceCount()).toBe(0)
    expect(session.snapshot().sustained).toEqual([])
  })

  it('keeps a note held by a finger through a pedal lift', () => {
    const { session, engine } = makeSession()
    session.setSustain(true, 'ui:sustain')
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'p:1' })
    session.press({ midi: 64, velocity: 0.7, source: 'pointer', owner: 'p:2' })
    session.release('pointer', 'p:2', 64)
    session.setSustain(false, 'ui:sustain')
    // 64 was only sounding through the pedal, so it stops; 60 is still held.
    expect(session.snapshot().sounding).toEqual([60])
    expect(engine.activeVoiceCount()).toBe(1)
  })

  it('allows a note struck after the pedal is down to sustain too', () => {
    const { session, engine } = makeSession()
    session.setSustain(true, 'ui:sustain')
    session.press({ midi: 72, velocity: 0.7, source: 'keyboard', owner: 'keyboard:KeyI' })
    session.release('keyboard', 'keyboard:KeyI', 72)
    expect(engine.activeVoiceCount()).toBe(1)
    expect(session.snapshot().sustained).toEqual([72])
  })

  it('handles repeated pedal transitions without leaking voices', () => {
    const { session, engine } = makeSession()
    for (let cycle = 0; cycle < 5; cycle += 1) {
      session.setSustain(true, 'ui:sustain')
      session.press({ midi: 60, velocity: 0.5, source: 'pointer', owner: `p:${cycle}` })
      session.release('pointer', `p:${cycle}`, 60)
      session.setSustain(false, 'ui:sustain')
    }
    expect(engine.activeVoiceCount()).toBe(0)
    expect(engine.liveNodeCount()).toBe(0)
    expect(engine.startedVoices).toHaveLength(5)
    expect(engine.endedVoices).toHaveLength(5)
  })

  it('tracks two pedal owners independently', () => {
    const { session } = makeSession()
    session.setSustain(true, 'ui:sustain')
    session.setSustain(true, 'midi:dev')
    session.setSustain(false, 'ui:sustain')
    // The MIDI pedal is still down, so sustain remains active.
    expect(session.snapshot().sustainPedal).toBe(true)
    session.setSustain(false, 'midi:dev')
    expect(session.snapshot().sustainPedal).toBe(false)
  })
})

describe('piano.basic-sustain-polyphony — polyphony and stealing', () => {
  it('allows up to the declared polyphony at once', () => {
    const { session, engine } = makeSession()
    for (let i = 0; i < MAX_POLYPHONY; i += 1) {
      session.press({ midi: 40 + i, velocity: 0.5, source: 'pointer', owner: `p:${i}` })
    }
    expect(engine.activeVoiceCount()).toBe(MAX_POLYPHONY)
    expect(session.snapshot().stolen).toBe(0)
  })

  it('steals the oldest voice when polyphony is exceeded, deterministically', () => {
    const { session, engine } = makeSession(4)
    for (const midi of [48, 50, 52, 53]) {
      session.press({ midi, velocity: 0.5, source: 'pointer', owner: `p:${midi}` })
    }
    expect(engine.activeVoiceCount()).toBe(4)
    // A fifth note steals the first.
    session.press({ midi: 55, velocity: 0.5, source: 'pointer', owner: 'p:55' })
    expect(engine.activeVoiceCount()).toBe(4)
    expect(session.snapshot().sounding).toEqual([50, 52, 53, 55])
    expect(session.snapshot().stolen).toBe(1)
    // The stolen voice was the engine's first one.
    expect(engine.endedVoices).toContain(engine.startedVoices[0].id)
  })

  it('always steals the longest-held voice, not an arbitrary one', () => {
    const { session } = makeSession(3)
    session.press({ midi: 60, velocity: 0.5, source: 'pointer', owner: 'p:60' })
    session.press({ midi: 62, velocity: 0.5, source: 'pointer', owner: 'p:62' })
    session.press({ midi: 64, velocity: 0.5, source: 'pointer', owner: 'p:64' })
    session.press({ midi: 65, velocity: 0.5, source: 'pointer', owner: 'p:65' })
    expect(session.snapshot().sounding).toEqual([62, 64, 65])
    session.press({ midi: 67, velocity: 0.5, source: 'pointer', owner: 'p:67' })
    expect(session.snapshot().sounding).toEqual([64, 65, 67])
  })

  it('never exceeds the cap over a long run of presses', () => {
    const { session, engine } = makeSession(8)
    let peakVoices = 0
    for (let i = 0; i < 60; i += 1) {
      session.press({ midi: 30 + (i % 60), velocity: 0.5, source: 'pointer', owner: `p:${i}` })
      peakVoices = Math.max(peakVoices, engine.activeVoiceCount())
    }
    expect(peakVoices).toBeLessThanOrEqual(8)
    expect(session.snapshot().stolen).toBeGreaterThan(0)
  })

  it('carries velocity into the engine for every voice', () => {
    const { session, engine } = makeSession()
    session.press({ midi: 60, velocity: 0.25, source: 'pointer', owner: 'p:1' })
    session.press({ midi: 64, velocity: 0.95, source: 'pointer', owner: 'p:2' })
    expect(engine.startedVoices[0].velocity).toBeCloseTo(0.25, 5)
    expect(engine.startedVoices[1].velocity).toBeCloseTo(0.95, 5)
    expect(session.snapshot().velocities[60]).toBeCloseTo(0.25, 5)
    expect(session.snapshot().velocities[64]).toBeCloseTo(0.95, 5)
  })

  it('clamps out-of-range velocity rather than sending it to the engine', () => {
    const { session, engine } = makeSession()
    session.press({ midi: 60, velocity: 4, source: 'pointer', owner: 'p:1' })
    session.press({ midi: 62, velocity: -2, source: 'pointer', owner: 'p:2' })
    expect(engine.startedVoices[0].velocity).toBe(1)
    expect(engine.startedVoices[1].velocity).toBe(0)
  })

  it('returns to baseline after a dense polyphonic passage', () => {
    const { session, engine } = makeSession()
    const baselineNodes = engine.liveNodeCount()
    for (let i = 0; i < 40; i += 1) {
      const midi = 36 + (i % 40)
      session.press({ midi, velocity: 0.5, source: 'pointer', owner: `p:${i}` })
      if (i % 2 === 0) session.release('pointer', `p:${i}`, midi)
    }
    session.allNotesOff('test')
    expect(engine.activeVoiceCount()).toBe(0)
    expect(engine.liveNodeCount()).toBe(baselineNodes)
    expect(session.snapshot().voices).toHaveLength(0)
  })
})

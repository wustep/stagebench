import { describe, expect, it } from 'vitest'
import { PianoNoteEngine } from './piano'
import { FakeVoiceBackend } from './test-fakes'

describe('deterministic basic piano lifecycle', () => {
  it('preserves velocity and independently releases overlapping notes', () => {
    const backend = new FakeVoiceBackend()
    const engine = new PianoNoteEngine(backend)
    engine.noteOn(60, 0.2, 'left')
    engine.noteOn(60, 0.9, 'right')
    expect(engine.snapshot()).toMatchObject({ activeNotes: [60], activeVoiceCount: 2 })
    expect(backend.events.filter((event) => event.type === 'start').map((event) => event.velocity)).toEqual([0.2, 0.9])
    engine.noteOff('left')
    expect(engine.snapshot().activeVoiceCount).toBe(1)
    engine.noteOff('right')
    expect(engine.snapshot().activeVoiceCount).toBe(0)
    expect(backend.events.filter((event) => event.type === 'release')).toHaveLength(2)
  })

  it('holds released voices under sustain and releases them on pedal up', () => {
    const backend = new FakeVoiceBackend()
    const engine = new PianoNoteEngine(backend)
    engine.noteOn(64, 0.7, 'one')
    engine.setSustain(true)
    engine.noteOff('one')
    expect(engine.snapshot()).toEqual({ activeNotes: [64], activeVoiceCount: 1, sustain: true })
    expect(backend.events.some((event) => event.type === 'release')).toBe(false)
    engine.setSustain(false)
    expect(engine.snapshot()).toEqual({ activeNotes: [], activeVoiceCount: 0, sustain: false })
    expect(backend.events.at(-1)?.type).toBe('release')
  })

  it('steals the oldest voice deterministically and cleans up every owned voice', () => {
    const backend = new FakeVoiceBackend()
    let now = 0
    const engine = new PianoNoteEngine(backend, 2, { now: () => now++ })
    engine.noteOn(60, 0.6, 'first')
    engine.noteOn(62, 0.6, 'second')
    engine.noteOn(64, 0.6, 'third')
    expect(backend.events.find((event) => event.type === 'stop')).toMatchObject({ note: 60 })
    expect(engine.snapshot().activeNotes).toEqual([62, 64])
    engine.allNotesOff()
    expect(engine.snapshot()).toEqual({ activeNotes: [], activeVoiceCount: 0, sustain: false })
    expect(backend.stopAllCalls).toBe(1)
  })

  it('reports a truthful backend status and disposes nodes on unmount', () => {
    const backend = new FakeVoiceBackend()
    const engine = new PianoNoteEngine(backend)
    expect(engine.getStatus()).toEqual({ state: 'ready', label: 'Test piano ready' })
    engine.noteOn(72, 1, 'owned')
    engine.dispose()
    expect(backend.disposed).toBe(true)
    expect(engine.snapshot().activeVoiceCount).toBe(0)
  })
})

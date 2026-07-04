import { describe, expect, it } from 'vitest'
import { GeneratedPianoEngine, NullAudioAdapter } from './pianoEngine'

describe('GeneratedPianoEngine', () => {
  it('runs a deterministic note lifecycle with velocity and release', () => {
    const adapter = new NullAudioAdapter()
    const engine = new GeneratedPianoEngine(adapter, 8)

    const first = engine.noteOn(60, 0.31, 'pointer-1')
    const overlap = engine.noteOn(60, 0.92, 'pointer-2')
    expect(first).not.toEqual(overlap)
    expect(engine.snapshot().voices).toEqual([
      expect.objectContaining({ note: 60, velocity: 0.31, state: 'held' }),
      expect.objectContaining({ note: 60, velocity: 0.92, state: 'held' }),
    ])

    engine.noteOff(60, 'pointer-1')
    expect(engine.snapshot().voices).toEqual([
      expect.objectContaining({ source: 'pointer-1', state: 'released' }),
      expect.objectContaining({ source: 'pointer-2', state: 'held' }),
    ])
    expect(adapter.released).toContain(first)
  })

  it('keeps sustained voices until sustain is released', () => {
    const adapter = new NullAudioAdapter()
    const engine = new GeneratedPianoEngine(adapter)

    engine.noteOn(64, 0.8, 'midi-64')
    engine.setSustain(true)
    engine.noteOff(64, 'midi-64')
    expect(engine.snapshot().voices[0]).toEqual(expect.objectContaining({ state: 'sustained' }))
    expect(adapter.released).toEqual([])

    engine.setSustain(false)
    expect(engine.snapshot().voices[0]).toEqual(expect.objectContaining({ state: 'released' }))
    expect(adapter.released).toEqual([1])
  })

  it('suppresses repeated sources, steals voices deterministically, and cleans up', () => {
    const adapter = new NullAudioAdapter()
    const engine = new GeneratedPianoEngine(adapter, 3)

    expect(engine.noteOn(60, 0.6, 'computer-a')).toBe(1)
    expect(engine.noteOn(60, 0.9, 'computer-a')).toBe(1)
    engine.noteOn(62, 0.6, 'computer-s')
    engine.noteOn(64, 0.6, 'computer-d')
    engine.noteOn(65, 0.6, 'computer-f')

    const snapshot = engine.snapshot()
    expect(snapshot.voices).toHaveLength(3)
    expect(snapshot.voices.map((voice) => voice.note)).toEqual([62, 64, 65])
    expect(adapter.stopped).toEqual([1])

    engine.allNotesOff()
    expect(engine.snapshot().voices).toEqual([])
    expect(engine.snapshot().sustain).toBe(false)
  })
})


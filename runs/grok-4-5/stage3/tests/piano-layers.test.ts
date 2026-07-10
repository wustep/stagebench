import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('piano.layers', () => {
  it('enables A/B independently with correct voice ownership', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()

    engine.setPianoState({
      layers: {
        A: { enabled: true, level: 0.9, octave: 0, sustped: true, pstick: false, zones: [true, true, true, true] },
        B: { enabled: false, level: 0, octave: 0, sustped: true, pstick: false, zones: [true, true, true, true] },
      },
    })
    engine.noteOn(60, 0.8, 'a')
    expect(engine.getLayerVoiceCount('A')).toBe(1)
    expect(engine.getLayerVoiceCount('B')).toBe(0)
    engine.allNotesOff()

    engine.updateLayer('B', { enabled: true, level: 0.7 })
    engine.noteOn(64, 0.8, 'b')
    expect(engine.getLayerVoiceCount('A')).toBe(1)
    expect(engine.getLayerVoiceCount('B')).toBe(1)
    engine.allNotesOff()
    expect(engine.getActiveVoiceCount()).toBe(0)
    engine.dispose()
  })

  it('applies per-layer level and octave shift', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.updateLayer('A', { octave: 1, level: 0.5 })
    const id = engine.noteOn(60, 0.8)
    const notes = engine.getActiveNotes()
    expect(notes.some((n) => n.midi === 72)).toBe(true) // 60 + 12
    engine.noteOff(id)
    engine.allNotesOff()

    const eLow = await engine.measureEnergy({
      velocity: 0.8,
      setup: () => engine.updateLayer('A', { level: 0.2, octave: 0 }),
    })
    const eHigh = await engine.measureEnergy({
      velocity: 0.8,
      setup: () => engine.updateLayer('A', { level: 1, octave: 0 }),
    })
    // analytic path uses layer level
    expect(eHigh).toBeGreaterThan(eLow)
    engine.dispose()
  })

  it('focus state is tracked and section off silences', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    engine.setPianoState({ focus: 'B' })
    expect(engine.getPianoState().focus).toBe('B')
    engine.setPianoState({ sectionOn: false })
    expect(engine.noteOn(60, 1)).toBe('')
    engine.setPianoState({ sectionOn: true })
    expect(engine.noteOn(60, 1)).toBeTruthy()
    engine.dispose()
  })
})

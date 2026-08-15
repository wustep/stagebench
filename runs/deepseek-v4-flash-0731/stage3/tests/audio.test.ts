import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/engine'

const SR = 8000

function rms(samples: Float32Array): number {
  let sum = 0
  for (const x of samples) sum += x * x
  return Math.sqrt(sum / samples.length)
}

function noteRms(velocity: number, midi = 60): number {
  const engine = new PianoEngine({ sampleRate: SR })
  engine.noteOn(midi, velocity)
  return rms(engine.render(SR).samples)
}

describe('basic piano audio backbone', () => {
  it('output differs from silence', () => {
    const silent = new PianoEngine({ sampleRate: SR })
    expect(rms(silent.render(SR).samples)).toBeLessThan(1e-6)
    const withNote = new PianoEngine({ sampleRate: SR })
    withNote.noteOn(60, 0.8)
    expect(rms(withNote.render(SR).samples)).toBeGreaterThan(1e-3)
  })

  it('velocity moves output loudness in the expected direction', () => {
    const soft = noteRms(0.08)
    const loud = noteRms(1.0)
    expect(loud).toBeGreaterThan(soft)
    expect(soft).toBeLessThan(0.2)
  })

  it('pitch changes output (different notes differ)', () => {
    const low = noteRms(0.9, 40)
    const high = noteRms(0.9, 88)
    // spectral content differs even though total energy may be similar; use a
    // per-sample comparison to prove the signals are not identical
    const a = new PianoEngine({ sampleRate: SR }); a.noteOn(40, 0.9)
    const b = new PianoEngine({ sampleRate: SR }); b.noteOn(88, 0.9)
    const sa = a.render(SR).samples
    const sb = b.render(SR).samples
    let diff = 0
    for (let i = 0; i < sa.length; i++) diff += Math.abs(sa[i] - sb[i])
    expect(diff).toBeGreaterThan(0)
    void low; void high
  })

  it('sustain keeps the note sounding longer than plain release', () => {
    function tailRms(useSustain: boolean): number {
      const engine = new PianoEngine({ sampleRate: SR })
      engine.noteOn(60, 0.7)
      engine.render(SR * 0.4)
      if (useSustain) engine.setSustain(true)
      engine.noteOff(60)
      return rms(engine.render(SR).samples)
    }
    const released = tailRms(false)
    const sustained = tailRms(true)
    expect(sustained).toBeGreaterThan(released)
  })

  it('polyphony is bounded by deterministic voice stealing', () => {
    const engine = new PianoEngine({ sampleRate: SR })
    for (let i = 0; i < 50; i++) engine.noteOn(40 + (i % 20), 0.8)
    expect(engine.voiceCount).toBe(engine.maxVoices)
    expect(engine.voiceCount).toBe(32)
  })

  it('all-notes-off silences every voice immediately', () => {
    const engine = new PianoEngine({ sampleRate: SR })
    for (let i = 0; i < 5; i++) engine.noteOn(40 + i, 0.9)
    engine.allNotesOff()
    expect(engine.voiceCount).toBe(0)
    expect(rms(engine.render(SR).samples)).toBeLessThan(1e-6)
  })

  it('released voices prune themselves and return to baseline', () => {
    const engine = new PianoEngine({ sampleRate: SR })
    engine.noteOn(60, 0.8)
    engine.render(SR * 0.1)
    engine.noteOff(60)
    engine.render(SR * 8) // release tail elapses
    expect(engine.voiceCount).toBe(0)
  })
})
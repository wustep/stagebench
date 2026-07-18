import { describe, expect, it } from 'vitest'
import { MAX_VOICES, PianoEngine } from '../audio/engine'
import { FakeAudioBackend, rms, windowEnergy } from '../audio/fake-backend'

function makeEngine() {
  const backend = new FakeAudioBackend()
  const engine = new PianoEngine(backend)
  return { backend, engine }
}

describe('piano.basic-note-lifecycle', () => {
  it('noteOn starts a voice, noteOff releases it, all-notes-off stops everything', async () => {
    const { backend, engine } = makeEngine()
    await engine.init()
    engine.noteOn(60, 0.8)
    expect(backend.activeVoiceCount()).toBe(1)
    engine.noteOff(60)
    const v = engine.getVoices()[0]
    expect(v.releasedAt).not.toBeNull()
    engine.allNotesOff()
    expect(backend.activeVoiceCount()).toBe(0)
    expect(engine.getVoices().length).toBe(0)
  })

  it('repeated notes on the same key stack as independent voices', () => {
    const { backend, engine } = makeEngine()
    engine.noteOn(64, 0.7)
    engine.noteOn(64, 0.7)
    engine.noteOn(64, 0.7)
    expect(backend.activeVoiceCount()).toBe(3)
  })

  it('overlapping holds release only when the last hold lifts', () => {
    const { engine } = makeEngine()
    engine.noteOn(64, 0.7) // pointer
    engine.noteOn(64, 0.7) // MIDI overlapping the same note
    engine.noteOff(64)
    // One hold remains: nothing released yet.
    expect(engine.getVoices().every((v) => v.releasedAt === null)).toBe(true)
    engine.noteOff(64)
    expect(engine.getVoices().some((v) => v.releasedAt !== null)).toBe(true)
  })

  it('released voices decay to silence (per-note release is audible in the signal)', () => {
    const backend = new FakeAudioBackend()
    const held = backend.renderNote(60, 0.9, 2.0, null)
    const released = backend.renderNote(60, 0.9, 2.0, 0.25)
    // Both sound at the start.
    expect(rms(held)).toBeGreaterThan(0.001)
    // After release, the released note is much quieter in the tail than the held note.
    const sr = backend.sampleRate
    const heldTail = windowEnergy(held, sr * 1, sr * 2)
    const relTail = windowEnergy(released, sr * 1, sr * 2)
    expect(relTail).toBeLessThan(heldTail * 0.2)
  })

  it('voice/node counts return to baseline after cleanup', () => {
    const { backend, engine } = makeEngine()
    const baseStart = backend.startCount
    for (let i = 0; i < 10; i++) engine.noteOn(48 + i, 0.6)
    engine.allNotesOff()
    expect(backend.activeVoiceCount()).toBe(0)
    expect(backend.stopCount - (backend.startCount - baseStart)).toBeGreaterThanOrEqual(0)
    expect(engine.getVoices().length).toBe(0)
  })

  it('polyphony is bounded and deterministic', () => {
    const { backend, engine } = makeEngine()
    for (let i = 0; i < MAX_VOICES + 8; i++) {
      backend.advance(0.01)
      engine.noteOn(36 + (i % 40), 0.7)
    }
    expect(backend.activeVoiceCount()).toBeLessThanOrEqual(MAX_VOICES)
  })
})

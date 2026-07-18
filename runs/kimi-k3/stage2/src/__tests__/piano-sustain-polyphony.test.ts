import { describe, expect, it } from 'vitest'
import { MAX_VOICES, PianoEngine } from '../audio/engine'
import { FakeAudioBackend, rms, windowEnergy } from '../audio/fake-backend'

function makeEngine() {
  const backend = new FakeAudioBackend()
  const engine = new PianoEngine(backend)
  return { backend, engine }
}

describe('piano.basic-sustain-polyphony', () => {
  it('velocity response: harder strikes render louder (tolerant relationship)', () => {
    const backend = new FakeAudioBackend()
    const soft = backend.renderNote(60, 0.25, 1.0)
    const loud = backend.renderNote(60, 1.0, 1.0)
    expect(rms(soft)).toBeGreaterThan(0.0005) // not silence
    expect(rms(loud)).toBeGreaterThan(rms(soft) * 2)
  })

  it('output differs from silence for any in-range note', () => {
    const backend = new FakeAudioBackend()
    for (const note of [28, 60, 100]) {
      expect(rms(backend.renderNote(note, 0.8, 0.5))).toBeGreaterThan(0.001)
    }
  })

  it('sustain holds released notes; lifting sustain releases them (audibly longer duration)', () => {
    const { backend, engine } = makeEngine()
    backend.advance(1)
    engine.noteOn(60, 0.9)
    backend.advance(0.2)
    engine.setSustain(true)
    engine.noteOff(60)
    backend.advance(1.0)
    // Still held by the damper: not released.
    expect(engine.getVoices()[0].releasedAt).toBeNull()
    engine.setSustain(false)
    expect(engine.getVoices()[0].releasedAt).not.toBeNull()
    // Signal-level: sustained render has more energy in the tail than released render.
    const b2 = new FakeAudioBackend()
    const sustained = b2.renderNote(60, 0.9, 1.5, null)
    const released = b2.renderNote(60, 0.9, 1.5, 0.2)
    const sr = b2.sampleRate
    const susTail = windowEnergy(sustained, sr * 0.6, sr * 1.5)
    const relTail = windowEnergy(released, sr * 0.6, sr * 1.5)
    expect(susTail).toBeGreaterThan(relTail * 5)
  })

  it('sustain only defers notes released while the pedal is down', () => {
    const { engine } = makeEngine()
    engine.noteOn(60, 0.8)
    engine.noteOff(60) // released before pedal
    expect(engine.getVoices()[0].releasedAt).not.toBeNull()
    engine.setSustain(true)
    engine.noteOn(64, 0.8)
    engine.noteOff(64)
    expect(engine.getVoices()[1].releasedAt).toBeNull()
    engine.setSustain(false)
    expect(engine.getVoices()[1].releasedAt).not.toBeNull()
  })

  it('concurrent voices: a chord renders all notes simultaneously', () => {
    const { backend, engine } = makeEngine()
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    engine.noteOn(67, 0.8)
    expect(backend.activeVoiceCount()).toBe(3)
    const mix = backend.renderMix(0.5)
    expect(rms(mix)).toBeGreaterThan(0.001)
  })

  it('voice stealing is deterministic: oldest released voice first, then oldest held', () => {
    const { backend, engine } = makeEngine()
    // Fill to capacity.
    for (let i = 0; i < MAX_VOICES; i++) {
      backend.advance(0.01)
      engine.noteOn(36 + i, 0.7)
    }
    expect(backend.activeVoiceCount()).toBe(MAX_VOICES)
    // Release note 40 — it becomes the preferred steal victim.
    engine.noteOff(40)
    backend.advance(0.01)
    engine.noteOn(90, 0.7) // steals the released 40
    const notes = backend.liveVoices().map((v) => v.note)
    expect(notes).not.toContain(40)
    expect(notes).toContain(90)
    expect(notes).toContain(36) // oldest held survives while a released voice existed
    // No released voices left: next steal takes the oldest held voice (36).
    backend.advance(0.01)
    engine.noteOn(91, 0.7)
    const notes2 = backend.liveVoices().map((v) => v.note)
    expect(notes2).not.toContain(36)
    expect(notes2).toContain(91)
  })
})

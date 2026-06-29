import { describe, expect, it } from 'vitest'
import { PianoEngine, velocityToGain, type PianoAudioBackend, type VoiceHandle } from './PianoEngine'

class FakeBackend implements PianoAudioBackend {
  voices: VoiceHandle[] = []
  releases: Array<{ voice: VoiceHandle; release: number }> = []
  volume = -1
  reverb = -1
  sampleMode: 'sampled' | 'fallback' = 'sampled'

  async prepare() { return this.sampleMode }
  startVoice(midi: number, gain: number): VoiceHandle {
    const voice = { id: `voice-${this.voices.length}`, midi, gain }
    this.voices.push(voice)
    return voice
  }
  releaseVoice(voice: VoiceHandle, release: number) { this.releases.push({ voice, release }) }
  stopVoice(voice: VoiceHandle) { this.releases.push({ voice, release: 0 }) }
  setMasterVolume(value: number) { this.volume = value }
  setReverb(value: number) { this.reverb = value }
  async resume() {}
}

describe('PianoEngine note lifecycle', () => {
  it('starts, releases and retriggers the same note without orphaning voices', () => {
    const audio = new FakeBackend()
    const engine = new PianoEngine(audio)
    engine.noteOn(60, 100)
    engine.noteOn(60, 80)
    expect(audio.voices).toHaveLength(2)
    expect(audio.releases[0]?.voice).toBe(audio.voices[0])
    engine.noteOff(60)
    expect(audio.releases.at(-1)?.voice).toBe(audio.voices[1])
    expect(engine.snapshot().activeNotes).toEqual([])
  })

  it('all-notes-off immediately clears held and sustained notes', () => {
    const audio = new FakeBackend()
    const engine = new PianoEngine(audio)
    engine.noteOn(60, 100)
    engine.noteOn(64, 100)
    engine.setSustain(true)
    engine.noteOff(60)
    engine.allNotesOff()
    expect(engine.snapshot()).toMatchObject({ activeNotes: [], sustainedNotes: [], sustain: false })
    expect(audio.releases.slice(-2).map(({ release }) => release)).toEqual([0, 0])
  })
})

describe('PianoEngine sustain and polyphony', () => {
  it('holds released notes while the pedal is down and releases them on pedal-up', () => {
    const audio = new FakeBackend()
    const engine = new PianoEngine(audio)
    engine.noteOn(60, 110)
    engine.setSustain(true)
    engine.noteOff(60)
    expect(engine.snapshot().sustainedNotes).toEqual([60])
    expect(audio.releases).toHaveLength(0)
    engine.setSustain(false)
    expect(engine.snapshot().sustainedNotes).toEqual([])
    expect(audio.releases).toHaveLength(1)
  })

  it('steals the oldest voice deterministically at the polyphony limit and cleans up', () => {
    const audio = new FakeBackend()
    const engine = new PianoEngine(audio, { maxPolyphony: 2 })
    engine.noteOn(60, 80)
    engine.noteOn(62, 90)
    engine.noteOn(64, 100)
    expect(audio.releases[0]).toEqual({ voice: audio.voices[0], release: 0 })
    expect(engine.snapshot().activeNotes).toEqual([62, 64])
    engine.noteOff(62)
    engine.noteOff(64)
    expect(engine.snapshot().voiceCount).toBe(0)
  })
})

describe('velocity and effects routing', () => {
  it('maps MIDI velocity to a meaningful clamped nonlinear gain', () => {
    expect(velocityToGain(-1)).toBe(0)
    expect(velocityToGain(0)).toBe(0)
    expect(velocityToGain(1)).toBeGreaterThan(0)
    expect(velocityToGain(64)).toBeGreaterThan(velocityToGain(1))
    expect(velocityToGain(127)).toBe(1)
    expect(velocityToGain(999)).toBe(1)
  })

  it('clamps master volume and reverb before reaching the audio graph', () => {
    const audio = new FakeBackend()
    const engine = new PianoEngine(audio)
    engine.setMasterVolume(2)
    engine.setReverb(-1)
    expect(audio.volume).toBe(1)
    expect(audio.reverb).toBe(0)
    engine.setMasterVolume(0.42)
    engine.setReverb(0.67)
    expect(audio.volume).toBe(0.42)
    expect(audio.reverb).toBe(0.67)
  })
})

describe('sample fallback', () => {
  it('remains playable when sample preparation falls back offline', async () => {
    const audio = new FakeBackend()
    audio.sampleMode = 'fallback'
    const engine = new PianoEngine(audio)
    await expect(engine.prepare()).resolves.toBe('fallback')
    engine.noteOn(60, 100)
    expect(audio.voices).toHaveLength(1)
    expect(engine.snapshot().mode).toBe('fallback')
  })
})

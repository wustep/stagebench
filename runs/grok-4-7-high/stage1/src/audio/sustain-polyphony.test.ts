import { describe, expect, it } from 'vitest'
import { ManualTimers, type AudioBoundary, type AudioContextLike } from './boundaries'
import { PianoEngine } from './engine'
import { OfflineAudioContext } from 'node-web-audio-api'
import { renderPiano, rms } from '../test/renderAudio'

describe('piano.basic-sustain-polyphony', () => {
  it('holds a released note while sustain is down and releases it when the pedal lifts', () => {
    const timers = new ManualTimers()
    const context = new OfflineAudioContext(1, 44100, 44100)
    const boundary: AudioBoundary = { createContext: () => context as unknown as AudioContextLike, timers }
    const engine = new PianoEngine(boundary)
    engine.setSustain(true)
    engine.noteOn(60, 0.85, 0)
    engine.noteOff(60, 0.2)
    expect(engine.isNoteActive(60)).toBe(true)
    expect(engine.heldVoiceCount()).toBe(0)
    expect(engine.activeVoiceCount()).toBe(1)
    engine.setSustain(false, 0.6)
    expect(engine.isNoteActive(60)).toBe(false)
    expect(engine.activeVoiceCount()).toBe(1)
    timers.advance(400)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('steals the oldest voice deterministically at the polyphony cap', () => {
    const timers = new ManualTimers()
    const context = new OfflineAudioContext(1, 22050, 44100)
    const boundary: AudioBoundary = { createContext: () => context as unknown as AudioContextLike, timers }
    const engine = new PianoEngine(boundary, { maxPolyphony: 4 })
    for (const midi of [40, 41, 42, 43, 44]) engine.noteOn(midi, 0.7)
    expect(engine.activeVoiceCount()).toBe(4)
    expect(engine.isNoteActive(40)).toBe(false)
    expect(engine.isNoteActive(41)).toBe(true)
    expect(engine.isNoteActive(44)).toBe(true)
    engine.noteOn(45, 0.7)
    expect(engine.isNoteActive(41)).toBe(false)
    expect(engine.isNoteActive(45)).toBe(true)
    expect(engine.activeVoiceCount()).toBe(4)
  })

  it('renders a louder tone for a higher velocity, a longer tone under sustain, and silence with no note', async () => {
    const quiet = await renderPiano((engine) => engine.noteOn(60, 0.15, 0), 0.4)
    const loud = await renderPiano((engine) => engine.noteOn(60, 1, 0), 0.4)
    const quietRms = rms(quiet.channel, 200, 4000)
    const loudRms = rms(loud.channel, 200, 4000)
    expect(loudRms).toBeGreaterThan(quietRms * 1.8)
    expect(quietRms).toBeGreaterThan(0.002)

    const released = await renderPiano((engine) => {
      engine.noteOn(60, 0.95, 0)
      engine.noteOff(60, 0.12)
    }, 1)
    const sustained = await renderPiano((engine) => {
      engine.setSustain(true)
      engine.noteOn(60, 0.95, 0)
      engine.noteOff(60, 0.12)
    }, 1)
    const releasedTail = rms(released.channel, 22000, 35000)
    const sustainedTail = rms(sustained.channel, 22000, 35000)
    expect(sustainedTail).toBeGreaterThan(releasedTail * 3)
    expect(rms(released.channel, 800, 4000)).toBeGreaterThan(releasedTail * 4)

    const silent = await renderPiano(() => undefined, 0.2)
    expect(rms(silent.channel, 0, silent.channel.length)).toBeLessThan(0.0001)
  })
})

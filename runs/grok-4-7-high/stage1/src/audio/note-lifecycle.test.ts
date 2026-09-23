import { describe, expect, it } from 'vitest'
import { ManualTimers, type AudioBoundary, type AudioContextLike } from './boundaries'
import { PianoEngine } from './engine'
import { OfflineAudioContext } from 'node-web-audio-api'

function makeEngine() {
  const timers = new ManualTimers()
  const context = new OfflineAudioContext(1, 44100, 44100)
  const boundary: AudioBoundary = {
    createContext: () => context as unknown as AudioContextLike,
    timers,
  }
  const engine = new PianoEngine(boundary)
  return { engine, timers }
}

describe('piano.basic-note-lifecycle', () => {
  it('starts lazily and reports ready when the first note opens the context', () => {
    const { engine } = makeEngine()
    const seen: string[] = []
    engine.subscribe(() => seen.push(engine.getStatus()))
    expect(engine.getStatus()).toBe('idle')
    engine.noteOn(60, 0.8)
    expect(engine.getStatus()).toBe('ready')
    expect(seen).toContain('loading')
    expect(engine.heldVoiceCount()).toBe(1)
    expect(engine.isNoteActive(60)).toBe(true)
  })

  it('releases a note and cleans its nodes up after the release timer', () => {
    const { engine, timers } = makeEngine()
    engine.noteOn(60, 0.8)
    engine.noteOff(60)
    expect(engine.heldVoiceCount()).toBe(0)
    expect(engine.activeVoiceCount()).toBe(1)
    timers.advance(400)
    expect(engine.activeVoiceCount()).toBe(0)
    expect(engine.isNoteActive(60)).toBe(false)
  })

  it('ignores noteOff for a note that is not playing', () => {
    const { engine } = makeEngine()
    expect(() => engine.noteOff(60)).not.toThrow()
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('retriggers repeated notes and keeps overlapping notes independent', () => {
    const { engine, timers } = makeEngine()
    engine.noteOn(60, 0.7)
    engine.noteOn(60, 0.9)
    expect(engine.heldVoiceCount()).toBe(1)
    expect(engine.activeVoiceCount()).toBe(2)
    timers.advance(120)
    expect(engine.activeVoiceCount()).toBe(1)

    engine.noteOn(64, 0.8)
    engine.noteOn(67, 0.8)
    expect(engine.heldVoiceCount()).toBe(3)
    engine.noteOff(64)
    expect(engine.isNoteActive(60)).toBe(true)
    expect(engine.isNoteActive(64)).toBe(false)
    expect(engine.isNoteActive(67)).toBe(true)
    engine.noteOff(60)
    engine.noteOff(67)
    timers.advance(400)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('allNotesOff silences held and sustained notes immediately', () => {
    const { engine } = makeEngine()
    engine.setSustain(true)
    engine.noteOn(60, 0.8)
    engine.noteOn(65, 0.8)
    engine.noteOff(65)
    expect(engine.activeVoiceCount()).toBe(2)
    engine.allNotesOff()
    expect(engine.heldVoiceCount()).toBe(0)
    expect(engine.activeVoiceCount()).toBe(0)
    expect(engine.isSustainDown()).toBe(false)
  })
})

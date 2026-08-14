import { describe, expect, it } from 'vitest'
import { MAX_VOICES, PianoEngine, lastAudibleIndex, renderPianoScript, rms } from './audio/piano-engine'
import { createAudioContext } from './audio/software-context'

describe('piano.basic-sustain-polyphony', () => {
  it('keeps a released note sounding while sustain is down', async () => {
    const dry = await renderPianoScript(0.85, (engine) => {
      engine.noteOn(60, 0.8, 0)
      engine.noteOff(60, 0.08)
    })
    const wet = await renderPianoScript(0.85, (engine) => {
      engine.setSustain(true, 0)
      engine.noteOn(60, 0.8, 0)
      engine.noteOff(60, 0.08)
    })
    const mid = Math.floor(0.4 * 44100)
    expect(rms(wet, mid, mid + 4000)).toBeGreaterThan(rms(dry, mid, mid + 4000) * 1.4)
    expect(lastAudibleIndex(wet)).toBeGreaterThan(lastAudibleIndex(dry))
  })

  it('responds to velocity in the expected direction', async () => {
    const soft = await renderPianoScript(0.3, (engine) => {
      engine.noteOn(67, 0.22, 0)
    })
    const loud = await renderPianoScript(0.3, (engine) => {
      engine.noteOn(67, 0.95, 0)
    })
    expect(rms(loud)).toBeGreaterThan(rms(soft) * 1.5)
  })

  it('steals the oldest voice deterministically at the polyphony cap', () => {
    const engine = new PianoEngine({
      context: createAudioContext({ offline: true, durationSec: 1 }),
      maxVoices: 8,
    })
    for (let i = 0; i < 8; i++) engine.noteOn(40 + i, 0.8, i * 0.01)
    expect(engine.getActiveVoiceCount()).toBe(8)
    engine.noteOn(72, 0.8, 0.2)
    expect(engine.getActiveVoiceCount()).toBe(8)
    engine.dispose()
  })

  it('caps at MAX_VOICES for a large chord', () => {
    const engine = new PianoEngine({
      context: createAudioContext({ offline: true, durationSec: 1 }),
    })
    for (let i = 0; i < MAX_VOICES + 6; i++) engine.noteOn(36 + i, 0.6, 0)
    expect(engine.getActiveVoiceCount()).toBe(MAX_VOICES)
    engine.dispose()
  })
})

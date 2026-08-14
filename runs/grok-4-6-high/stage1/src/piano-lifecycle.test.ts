import { describe, expect, it } from 'vitest'
import { PianoEngine, lastAudibleIndex, renderPianoScript, rms } from './audio/piano-engine'
import { createAudioContext } from './audio/software-context'

describe('piano.basic-note-lifecycle', () => {
  it('produces output that differs from silence', async () => {
    const samples = await renderPianoScript(0.4, (engine) => {
      engine.noteOn(60, 0.85, 0)
      engine.noteOff(60, 0.25)
    })
    expect(rms(samples)).toBeGreaterThan(0.002)
  })

  it('restarts a repeated note and overlaps other notes', async () => {
    const single = await renderPianoScript(0.35, (engine) => {
      engine.noteOn(64, 0.7, 0)
    })
    const overlapped = await renderPianoScript(0.35, (engine) => {
      engine.noteOn(64, 0.7, 0)
      engine.noteOn(67, 0.7, 0.02)
      engine.noteOn(71, 0.7, 0.04)
    })
    expect(rms(overlapped)).toBeGreaterThan(rms(single))

    const engine = new PianoEngine({
      context: createAudioContext({ offline: true, durationSec: 0.5 }),
    })
    engine.noteOn(60, 0.8, 0)
    expect(engine.getHeldNoteCount()).toBe(1)
    engine.noteOn(60, 0.8, 0.05)
    expect(engine.getHeldNoteCount()).toBe(1)
    engine.noteOff(60, 0.1)
    expect(engine.getHeldNoteCount()).toBe(0)
    engine.dispose()
  })

  it('releases notes so energy dies sooner than a held note', async () => {
    const held = await renderPianoScript(0.7, (engine) => {
      engine.noteOn(62, 0.8, 0)
    })
    const released = await renderPianoScript(0.7, (engine) => {
      engine.noteOn(62, 0.8, 0)
      engine.noteOff(62, 0.08)
    })
    const tailStart = Math.floor(0.45 * 44100)
    expect(rms(held, tailStart)).toBeGreaterThan(rms(released, tailStart))
    expect(lastAudibleIndex(released)).toBeLessThan(lastAudibleIndex(held))
  })

  it('all-notes-off drops every owned voice', () => {
    const engine = new PianoEngine({
      context: createAudioContext({ offline: true, durationSec: 1 }),
    })
    engine.noteOn(50, 0.7, 0)
    engine.noteOn(54, 0.7, 0)
    engine.noteOn(57, 0.7, 0)
    expect(engine.getActiveVoiceCount()).toBeGreaterThan(0)
    engine.allNotesOff(0.1)
    expect(engine.getActiveVoiceCount()).toBe(0)
    expect(engine.getHeldNoteCount()).toBe(0)
    engine.dispose()
  })
})

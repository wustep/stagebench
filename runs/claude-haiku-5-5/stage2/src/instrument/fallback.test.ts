// @vitest-environment node
// piano.fallback: a failing sample set enters a labelled, playable fallback and is never reported ready.
import { describe, expect, it } from 'vitest'
import { play } from '../audio/testing/scenario'
import { mono, rms } from '../audio/testing/offline'
import { createPianoInstrument } from './pianoInstrument'
import { deriveAudioSettings } from '../model/audioSettings'
import { initialPresentation } from '../model/hardware'
import { FakeAudioContext } from '../audio/testing/fakeAudioContext'

const failing = { fetchBytes: () => Promise.reject(new Error('network is down')) }

describe('piano.fallback', () => {
  it('reports the failed set as failed, not ready, and says the fallback is playing', async () => {
    const played = await play({ seconds: 1.2, notes: [{ note: 60, velocity: 100, off: 0.9 }], loader: failing })
    const status = played.instrument.pianoStatus()
    expect(status.state).toBe('failed')
    expect(status.message).toContain('Playing the labelled live-synthesis fallback')
    expect(status.message).not.toMatch(/recorded samples/i)
  }, 60000)

  it('stays playable: a failed set still sounds through the fallback voice', async () => {
    const played = await play({ seconds: 1.2, notes: [{ note: 60, velocity: 100, off: 0.9 }], loader: failing })
    expect(rms(mono(played.rendered), 44100, 0.05, 0.8)).toBeGreaterThan(0.002)
  }, 60000)

  it('shows loading, not ready, while a set is still arriving', () => {
    const context = new FakeAudioContext()
    const instrument = createPianoInstrument({
      audioFactory: () => context,
      sampleLoader: { fetchBytes: () => new Promise<ArrayBuffer>(() => {}) },
      midiRequest: undefined,
    })
    instrument.configure(deriveAudioSettings(initialPresentation()))
    instrument.noteOn('pointer:0', 60, 100)
    expect(instrument.pianoStatus().state).toBe('loading')
    expect(instrument.pianoStatus().message).toContain('fallback')
    instrument.teardown()
  })

  it('labels the synthesized types as synthesis, never as recordings', () => {
    const state = initialPresentation()
    const instrument = createPianoInstrument({ audioFactory: () => new FakeAudioContext(), midiRequest: undefined })
    instrument.configure(deriveAudioSettings({ ...state, 'piano.type': 3 }))
    expect(instrument.pianoStatus().state).toBe('synthesized')
    expect(instrument.pianoStatus().message).toMatch(/not a recording/)
    instrument.teardown()
  })
})

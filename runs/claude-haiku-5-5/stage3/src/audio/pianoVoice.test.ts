import { describe, expect, it } from 'vitest'
import { FakeAudioContext, FakeGain, reaches } from './testing/fakeAudioContext'
import { PARTIAL_COUNT, PIANO_VOICE_MAX_SECONDS, midiToFrequency, startPianoVoice } from './pianoVoice'

function voiceGainOf(context: FakeAudioContext): FakeGain {
  // The voice gain is the first gain created, before its per-partial gains.
  return context.gains[0]
}

describe('piano voice (live synthesis)', () => {
  it('produces output: partial oscillators start and carry audible gain', () => {
    const context = new FakeAudioContext()
    startPianoVoice(context, context.destination, 60, 100, () => {})

    expect(context.oscillators).toHaveLength(PARTIAL_COUNT)
    for (const oscillator of context.oscillators) {
      expect(oscillator.startedAt).toBeDefined()
    }
    expect(context.gains.some((gain) => gain.gain.peak() > 0)).toBe(true)
  })

  it('tunes the fundamental to equal temperament', () => {
    const context = new FakeAudioContext()
    startPianoVoice(context, context.destination, 69, 100, () => {})
    // Partial 1 carries a small piano stretch, so allow under half a hertz.
    expect(context.oscillators[0].frequency.events[0].value).toBeCloseTo(440, 0)
    expect(midiToFrequency(81)).toBeCloseTo(880, 6)
  })

  it('louder velocity produces a larger peak voice gain', () => {
    const soft = new FakeAudioContext()
    startPianoVoice(soft, soft.destination, 60, 20, () => {})
    const hard = new FakeAudioContext()
    startPianoVoice(hard, hard.destination, 60, 127, () => {})

    expect(voiceGainOf(hard).gain.peak()).toBeGreaterThan(voiceGainOf(soft).gain.peak())
  })

  it('harder velocity raises the upper partials (brighter tone)', () => {
    const soft = new FakeAudioContext()
    startPianoVoice(soft, soft.destination, 60, 20, () => {})
    const hard = new FakeAudioContext()
    startPianoVoice(hard, hard.destination, 60, 127, () => {})

    // Gains are created in order: the voice gain, then one per partial, so partial 2 is index 2.
    const softPartial = soft.gains[2].gain.peak()
    const hardPartial = hard.gains[2].gain.peak()
    expect(hardPartial).toBeGreaterThan(softPartial)
  })

  it('release shortens the sounding tail compared with a note held to its natural decay', () => {
    const context = new FakeAudioContext()
    const voice = startPianoVoice(context, context.destination, 60, 100, () => {})
    const natural = context.oscillators[0].stoppedAt
    expect(natural).toBe(PIANO_VOICE_MAX_SECONDS)

    context.currentTime = 1
    voice.release()
    expect(context.oscillators[0].stoppedAt).toBeLessThan(natural!)
    expect(context.oscillators[0].stoppedAt).toBeGreaterThan(1)
  })

  it('stop() cuts the voice almost immediately', () => {
    const context = new FakeAudioContext()
    const voice = startPianoVoice(context, context.destination, 60, 100, () => {})
    context.currentTime = 2
    voice.stop()
    expect(context.oscillators[0].stoppedAt).toBeLessThan(2.1)
  })

  it('routes every node through the destination it was given (no bypass)', () => {
    const context = new FakeAudioContext()
    startPianoVoice(context, context.destination, 60, 100, () => {})
    for (const oscillator of context.oscillators) {
      expect(reaches(oscillator, context.destination)).toBe(true)
    }
  })

  it('cleans up: ended voices disconnect every node and report the end once', () => {
    const context = new FakeAudioContext()
    const baseline = context.liveNodeCount
    let ends = 0
    startPianoVoice(context, context.destination, 60, 100, () => {
      ends += 1
    })
    expect(context.liveNodeCount).toBeGreaterThan(baseline)

    for (const oscillator of context.oscillators) oscillator.finish()
    expect(ends).toBe(1)
    expect(context.liveNodeCount).toBe(baseline)
  })
})

// piano.basic-status-cleanup and effects.graph: truthful audio status, one context, cleanup back to baseline.
import { describe, expect, it } from 'vitest'
import type { AudioContextLike } from '../audio/audioBoundary'
import { FakeAudioContext, reaches } from '../audio/testing/fakeAudioContext'
import { createPianoInstrument } from '../instrument/pianoInstrument'
import { deriveAudioSettings } from '../model/audioSettings'
import { initialPresentation } from '../model/hardware'
import { PianoEngine, STATUS_MESSAGES, type EngineStatus } from './pianoEngine'

function recorder() {
  const statuses: EngineStatus[] = []
  return { statuses, onStatus: (status: EngineStatus) => statuses.push(status) }
}

const failing = { fetchBytes: () => Promise.reject(new Error('no samples in this test')) }

describe('piano engine status', () => {
  it('starts idle and does not create audio until the first gesture', () => {
    let created = 0
    const engine = new PianoEngine(() => {
      created += 1
      return new FakeAudioContext()
    })
    expect(engine.currentStatus.state).toBe('idle')
    expect(engine.audio).toBeUndefined()
    expect(created).toBe(0)
  })

  it('moves idle, loading, ready once the context resumes, and builds the graph on that one context', async () => {
    const context = new FakeAudioContext()
    context.state = 'suspended'
    const { statuses, onStatus } = recorder()
    let created = 0
    const engine = new PianoEngine(() => {
      created += 1
      return context
    }, onStatus)

    expect(engine.ensureStarted()).toBe(true)
    expect(statuses.map((status) => status.state)).toEqual(['loading'])
    await Promise.resolve()
    await Promise.resolve()
    expect(statuses.at(-1)).toEqual({ state: 'ready', message: STATUS_MESSAGES.ready })
    expect(engine.ensureStarted()).toBe(false)
    expect(created).toBe(1)
    expect(engine.audio?.context).toBe(context)
  })

  it('reports fallback, labelled silent, when Web Audio cannot be created', () => {
    const { statuses, onStatus } = recorder()
    const engine = new PianoEngine(() => {
      throw new Error('no audio here')
    }, onStatus)
    engine.ensureStarted()
    expect(statuses.at(-1)?.state).toBe('fallback')
    expect(statuses.at(-1)?.message).toContain('Silent fallback')
    expect(statuses.at(-1)?.message).toContain('no audio here')
  })

  it('reports error when the context refuses to resume', async () => {
    const context = new FakeAudioContext()
    context.resume = () => Promise.reject(new Error('gesture required'))
    const { statuses, onStatus } = recorder()
    const engine = new PianoEngine(() => context, onStatus)
    engine.ensureStarted()
    await Promise.resolve()
    await Promise.resolve()
    expect(statuses.at(-1)?.state).toBe('error')
    expect(statuses.at(-1)?.message).toContain('gesture required')
  })

  it('dispose closes the context, returns to idle, and a later gesture can start again', () => {
    const first = new FakeAudioContext()
    const second = new FakeAudioContext()
    const contexts: AudioContextLike[] = [first, second]
    const engine = new PianoEngine(() => contexts.shift()!)

    engine.ensureStarted()
    engine.dispose()
    expect(first.closed).toBe(true)
    expect(engine.currentStatus.state).toBe('idle')

    engine.ensureStarted()
    expect(engine.currentStatus.state).toBe('loading')
    expect(engine.audio?.context).toBe(second)
  })
})

describe('piano.basic-status-cleanup: the instrument releases every owned voice', () => {
  it('the fallback keeps notes tracked while silent, and release clears them', () => {
    const context = new FakeAudioContext()
    const instrument = createPianoInstrument({ audioFactory: () => context, sampleLoader: failing, midiRequest: undefined })
    instrument.configure(deriveAudioSettings(initialPresentation()))
    expect(instrument.noteOn('pointer:1', 60, 100)).toBe(true)
    expect(instrument.noteOff('pointer:1', 60)).toBe(true)
    instrument.teardown()
  })

  it('all notes off, then the voices end, leaves the node count at baseline', () => {
    const context = new FakeAudioContext()
    const instrument = createPianoInstrument({ audioFactory: () => context, sampleLoader: failing, midiRequest: undefined })
    instrument.configure(deriveAudioSettings(initialPresentation()))
    instrument.engine.ensureStarted()
    const baseline = context.liveNodeCount

    instrument.noteOn('pointer:1', 60, 100)
    instrument.noteOn('pointer:2', 64, 100)
    instrument.noteOn('pointer:3', 67, 100)
    const inputs = (['A', 'B'] as const).map((id) => instrument.engine.audio!.graph.input(id) as never)
    const voices = context.oscillators.filter((oscillator) => inputs.some((input) => reaches(oscillator, input)))
    expect(voices.length).toBeGreaterThan(0)
    expect(context.liveNodeCount).toBeGreaterThan(baseline)

    instrument.releaseEverything()
    for (const oscillator of voices) oscillator.finish()
    expect(voices.every((oscillator) => oscillator.disconnected)).toBe(true)
    expect(context.liveNodeCount).toBe(baseline)
    instrument.teardown()
  })

  it('teardown stops every voice, leaves only the destination, and closes the context', () => {
    const context = new FakeAudioContext()
    const instrument = createPianoInstrument({ audioFactory: () => context, sampleLoader: failing, midiRequest: undefined })
    instrument.configure(deriveAudioSettings(initialPresentation()))
    instrument.noteOn('pointer:1', 60, 100)
    instrument.teardown()
    for (const oscillator of context.oscillators) oscillator.finish()
    expect(context.closed).toBe(true)
    expect(context.liveNodeCount).toBe(1)
  })

  it('one context feeds both layer buses and the single destination through the limiter', () => {
    const context = new FakeAudioContext()
    const instrument = createPianoInstrument({ audioFactory: () => context, sampleLoader: failing, midiRequest: undefined })
    instrument.configure(deriveAudioSettings(initialPresentation()))
    instrument.noteOn('pointer:1', 60, 100)
    const graph = instrument.engine.audio!.graph
    expect(reaches(graph.input('A') as never, context.destination)).toBe(true)
    expect(reaches(graph.input('B') as never, context.destination)).toBe(true)
    expect(context.liveNodeCount).toBeGreaterThan(1)
    instrument.teardown()
  })
})

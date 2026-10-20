import { describe, expect, it } from 'vitest'
import type { AudioContextLike } from '../audio/audioBoundary'
import { FakeAudioContext, reaches } from '../audio/testing/fakeAudioContext'
import { NoteController } from './noteController'
import { MASTER_LEVEL, PianoEngine, STATUS_MESSAGES, type EngineStatus } from './pianoEngine'

function recorder() {
  const statuses: EngineStatus[] = []
  return { statuses, onStatus: (status: EngineStatus) => statuses.push(status) }
}

describe('piano engine status', () => {
  it('starts idle and does not create audio until the first gesture', () => {
    let created = 0
    const engine = new PianoEngine(() => {
      created += 1
      return new FakeAudioContext()
    })
    expect(engine.currentStatus.state).toBe('idle')
    expect(created).toBe(0)
  })

  it('moves idle, loading, ready once the context resumes, and routes voices through the master path', async () => {
    const context = new FakeAudioContext()
    context.state = 'suspended'
    const { statuses, onStatus } = recorder()
    const engine = new PianoEngine(() => context, onStatus)

    engine.ensureStarted()
    expect(statuses.map((status) => status.state)).toEqual(['loading'])

    await Promise.resolve()
    await Promise.resolve()
    expect(statuses.at(-1)).toEqual({ state: 'ready', message: STATUS_MESSAGES.ready })

    const handle = engine.start(60, 100, () => {})
    handle.release()
    // The master gain is the first gain created; it feeds the destination, and every voice feeds the master.
    const master = context.gains[0]
    expect(master.outputs).toContain(context.destination)
    expect(reaches(context.oscillators[0], master)).toBe(true)
    expect(reaches(context.oscillators[0], context.destination)).toBe(true)
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

  it('keeps notes tracked in fallback so the lifecycle still works', () => {
    const engine = new PianoEngine(() => {
      throw new Error('no audio here')
    })
    const controller = new NoteController(engine)
    engine.ensureStarted()
    controller.noteOn('pointer:1', 60, 100)
    expect(controller.activeVoiceCount).toBe(1)
    controller.noteOff('pointer:1', 60)
    expect(controller.activeVoiceCount).toBe(0)
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
    engine.start(60, 100, () => {}).release()
    expect(second.oscillators).toHaveLength(6)
  })

  it('exposes the master level as a constant the master gain uses', () => {
    const context = new FakeAudioContext()
    const engine = new PianoEngine(() => context)
    engine.ensureStarted()
    expect(context.gains[0].gain.value).toBe(MASTER_LEVEL)
  })

  it('before the context exists, voices are silent but still end on release', () => {
    const engine = new PianoEngine(() => new FakeAudioContext())
    let ended = 0
    const handle = engine.start(60, 100, () => {
      ended += 1
    })
    handle.release()
    handle.release()
    expect(ended).toBe(1)
  })
})

describe('node cleanup back to baseline', () => {
  it('all-notes-off then stop leaves no live voice nodes beyond the destination', () => {
    const context = new FakeAudioContext()
    const engine = new PianoEngine(() => context)
    const controller = new NoteController(engine)
    engine.ensureStarted()
    const baseline = context.liveNodeCount

    controller.noteOn('p:1', 60, 100)
    controller.noteOn('p:2', 64, 100)
    controller.noteOn('p:3', 67, 100)
    expect(context.liveNodeCount).toBeGreaterThan(baseline)

    controller.allNotesOff()
    for (const oscillator of context.oscillators) oscillator.finish()
    expect(context.liveNodeCount).toBe(baseline)
    expect(controller.activeVoiceCount).toBe(0)
  })

  it('stopAll (unmount path) stops voices and dispose closes the context', () => {
    const context = new FakeAudioContext()
    const engine = new PianoEngine(() => context)
    const controller = new NoteController(engine)
    engine.ensureStarted()
    controller.noteOn('p:1', 60, 100)
    controller.stopAll()
    engine.dispose()
    expect(controller.activeVoiceCount).toBe(0)
    expect(context.closed).toBe(true)
  })
})

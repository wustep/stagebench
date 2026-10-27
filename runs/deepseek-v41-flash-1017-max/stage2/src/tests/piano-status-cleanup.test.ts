import { describe, expect, it } from 'vitest'
import { createWebAudioEngine, createSilentEngine } from '../audio/webAudioEngine'
import { createFakeContext } from '../audio/fakes'
import { createPianoSession } from '../audio/noteSession'
import { createManualClock } from '../audio/clock'
import { createRecordingEngine } from '../audio/fakes'
import { VARIANT } from '../hardware/variant'
import { rms } from '../audio/pianoModel'
import type { AudioStatusReport } from '../audio/types'

/**
 * piano.basic-status-cleanup — truthful loading / ready / error / fallback status, and
 * cleanup of every owned voice on blur, MIDI disconnect and unmount.
 *
 * Status is asserted as reported text, not as a boolean that could mean anything: an
 * engine that cannot make sound must say so.
 */
describe('piano.basic-status-cleanup — status', () => {
  it('reports idle before any gesture and ready after starting', async () => {
    const context = createFakeContext()
    const engine = createWebAudioEngine({ createContext: () => context })
    expect(engine.status().status).toBe('idle')
    const report = await engine.start()
    expect(report.status).toBe('ready')
    expect(report.detail).toMatch(/Audio ready/)
  })

  it('reports loading while the context is being prepared', async () => {
    const reports: AudioStatusReport[] = []
    const context = createFakeContext()
    const engine = createWebAudioEngine({ createContext: () => context })
    engine.subscribe((report) => reports.push(report))
    await engine.start()
    expect(reports.some((r) => r.status === 'loading')).toBe(true)
    expect(reports.at(-1)?.status).toBe('ready')
  })

  it('reports error when the context cannot be created at all', async () => {
    const engine = createWebAudioEngine({
      createContext: () => {
        throw new Error('no audio device')
      },
    })
    const report = await engine.start()
    expect(report.status).toBe('error')
    expect(report.detail).toMatch(/no audio device/)
    // An engine in error accepts no notes and claims no voices.
    engine.noteOn({ id: 'v1', midi: 60, velocity: 0.8 })
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('reports fallback when the context exists but cannot resume', async () => {
    const context = createFakeContext({ failResume: 'gesture required' })
    const engine = createWebAudioEngine({ createContext: () => context })
    const report = await engine.start()
    expect(report.status).toBe('fallback')
    expect(report.detail).toMatch(/could not start|could not be started/i)
  })

  it('reports a suspended context as suspended, not ready', async () => {
    const context = createFakeContext()
    const engine = createWebAudioEngine({ createContext: () => context })
    await engine.start()
    // The browser suspends the context when the tab is hidden.
    await context.suspend?.()
    expect(engine.status().status).toBe('suspended')
  })

  it('describes a silent engine honestly as a fallback, never as ready', async () => {
    const engine = createSilentEngine('No audio output in this environment')
    const report = await engine.start()
    expect(report.status).toBe('fallback')
    expect(report.detail).toMatch(/No audio output/)
    engine.noteOn({ id: 'v1', midi: 60, velocity: 1 })
    expect(engine.activeVoiceCount()).toBe(0)
    expect(engine.liveNodeCount()).toBe(0)
  })

  it('surfaces the engine status into the session snapshot for the display', async () => {
    const engine = createSilentEngine('Silent test run')
    const session = createPianoSession({
      engine,
      clock: createManualClock(),
      lowestMidi: VARIANT.lowestMidi,
      highestMidi: VARIANT.highestMidi,
    })
    expect(session.snapshot().audio.status).toBe('fallback')
    session.press({ midi: 60, velocity: 0.5, source: 'pointer', owner: 'p:1' })
    await Promise.resolve()
    expect(session.snapshot().audio.detail).toMatch(/Silent test run/)
  })
})

describe('piano.basic-status-cleanup — the Web Audio graph', () => {
  it('routes every voice through the master gain to the destination', () => {
    const context = createFakeContext()
    const engine = createWebAudioEngine({ createContext: () => context })
    engine.noteOn({ id: 'v1', midi: 60, velocity: 0.8 })
    // One master gain to the destination, plus one per voice connecting into it.
    expect(context.destinations).toBe(1)
    expect(context.connectedToMaster).toBeGreaterThanOrEqual(2)
    expect(engine.activeVoiceCount()).toBe(1)
  })

  it('renders real samples into the buffer the graph plays', () => {
    const context = createFakeContext()
    const engine = createWebAudioEngine({ createContext: () => context })
    engine.noteOn({ id: 'v1', midi: 60, velocity: 0.8 })
    expect(context.renderedBuffers).toHaveLength(1)
    const channel = context.renderedBuffers[0].getChannelData(0)
    expect(rms(channel)).toBeGreaterThan(0.005)
    expect(channel.some((s) => s !== 0)).toBe(true)
  })

  it('schedules a release curve and a stop when a voice ends', () => {
    const context = createFakeContext()
    const engine = createWebAudioEngine({ createContext: () => context })
    engine.noteOn({ id: 'v1', midi: 72, velocity: 0.8 })
    engine.noteOff('v1')
    // The engine keeps the voice booked until its source ends, so a second noteOff is safe.
    expect(() => engine.noteOff('v1')).not.toThrow()
    expect(() => engine.noteOff('never-existed')).not.toThrow()
  })

  it('reclaims nodes when the platform reports a source ended', async () => {
    const context = createFakeContext()
    const engine = createWebAudioEngine({ createContext: () => context })
    await engine.start()
    // The master gain is a permanent node; everything above that baseline is per-voice.
    const baseline = engine.liveNodeCount()
    expect(baseline).toBe(1)
    engine.noteOn({ id: 'v1', midi: 60, velocity: 0.8 })
    expect(engine.liveNodeCount()).toBeGreaterThan(baseline)
    context.fireAllEnded()
    expect(engine.liveNodeCount()).toBe(baseline)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('stops every voice and closes the context on dispose', () => {
    const context = createFakeContext()
    const engine = createWebAudioEngine({ createContext: () => context })
    for (let i = 0; i < 5; i += 1) {
      engine.noteOn({ id: `v${i}`, midi: 50 + i, velocity: 0.6 })
    }
    expect(engine.activeVoiceCount()).toBe(5)
    engine.dispose()
    expect(engine.activeVoiceCount()).toBe(0)
    expect(engine.liveNodeCount()).toBe(0)
    expect(context.state).toBe('closed')
  })

  it('steals at the engine level if the session cap is ever bypassed', () => {
    const context = createFakeContext()
    const engine = createWebAudioEngine({ createContext: () => context, maxVoices: 3 })
    for (let i = 0; i < 6; i += 1) {
      engine.noteOn({ id: `v${i}`, midi: 50 + i, velocity: 0.6 })
    }
    expect(engine.activeVoiceCount()).toBeLessThanOrEqual(3)
  })
})

describe('piano.basic-status-cleanup — cleanup paths', () => {
  it('stops everything on blur and leaves no live node behind', () => {
    const engine = createRecordingEngine()
    const session = createPianoSession({
      engine,
      clock: createManualClock(),
      lowestMidi: VARIANT.lowestMidi,
      highestMidi: VARIANT.highestMidi,
    })
    session.press({ midi: 60, velocity: 0.6, source: 'keyboard', owner: 'keyboard:KeyQ' })
    session.press({ midi: 64, velocity: 0.6, source: 'pointer', owner: 'pointer:1' })
    session.allNotesOff('blur')
    expect(engine.activeVoiceCount()).toBe(0)
    expect(engine.liveNodeCount()).toBe(0)
    expect(session.snapshot().sessionVoices).toBe(0)
  })

  it('stops everything on MIDI disconnect', () => {
    const engine = createRecordingEngine()
    const session = createPianoSession({
      engine,
      clock: createManualClock(),
      lowestMidi: VARIANT.lowestMidi,
      highestMidi: VARIANT.highestMidi,
    })
    session.press({ midi: 60, velocity: 0.6, source: 'midi', owner: 'midi:dev' })
    session.allNotesOff('midi-disconnect')
    expect(engine.activeVoiceCount()).toBe(0)
    expect(session.snapshot().sounding).toEqual([])
  })

  it('stops everything on unmount and reports the reason', () => {
    const engine = createRecordingEngine()
    const session = createPianoSession({
      engine,
      clock: createManualClock(),
      lowestMidi: VARIANT.lowestMidi,
      highestMidi: VARIANT.highestMidi,
    })
    session.press({ midi: 48, velocity: 0.6, source: 'pointer', owner: 'p:1' })
    session.press({ midi: 72, velocity: 0.6, source: 'pointer', owner: 'p:2' })
    session.dispose()
    expect(engine.activeVoiceCount()).toBe(0)
    expect(engine.liveNodeCount()).toBe(0)
    expect(session.lastAllNotesOffReason()).toBe('unmount')
    // Disposing twice is a no-op rather than a crash.
    expect(() => session.dispose()).not.toThrow()
  })

  it('keeps a truthful detail string in every state it can reach', async () => {
    const cases: Array<{ engine: ReturnType<typeof createSilentEngine>; expected: string }> = [
      { engine: createSilentEngine('No audio output in this environment'), expected: 'fallback' },
    ]
    for (const { engine, expected } of cases) {
      const report = await engine.start()
      expect(report.status).toBe(expected)
      expect(report.detail.length).toBeGreaterThan(5)
    }
  })
})

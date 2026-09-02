import { describe, expect, it } from 'vitest'
import { ALL_NOTES_OFF_RELEASE_SECONDS, PianoEngine, RELEASE_SECONDS, RETRIGGER_RELEASE_SECONDS } from '../src/audio/engine'
import { FakeAudioContext, FakeGain, FakeSource, FakeTimers } from '../src/audio/fakeAudio'
import { quickRenderer } from './helpers'

function makeEngine(extra: Partial<ConstructorParameters<typeof PianoEngine>[0]> = {}) {
  const ctx = new FakeAudioContext(48000)
  const timers = new FakeTimers()
  const engine = new PianoEngine({ createContext: () => ctx, timers, renderer: quickRenderer, warmNotes: [60], ...extra })
  return { ctx, timers, engine }
}

describe('piano.basic-note-lifecycle — one deterministic note lifecycle', () => {
  it('note on builds source → gain → master → destination and note off schedules the release', async () => {
    const { ctx, engine } = makeEngine()
    await engine.start()
    expect(engine.noteOn(60, 100)).toBe(true)
    const voices = engine.activeVoices()
    expect(voices).toEqual([{ midi: 60, velocity: 100, keyDown: true, sustained: false, releasing: false, kind: 'buffer' }])
    const source = ctx.sources()[0]
    expect(source.startedAt).toBe(0)
    expect(source.buffer?.length).toBeGreaterThan(0)
    expect(source.reachesDestination()).toBe(true)
    const gains = ctx.gains()
    expect(gains).toHaveLength(2) // master + voice
    const voiceGain = gains[1]
    expect(source.connections).toEqual([voiceGain])
    expect(voiceGain.connections).toEqual([gains[0]])
    expect(gains[0].connections).toEqual([ctx.destination])
    ctx.advance(0.5)
    engine.noteOff(60)
    expect(engine.activeVoices()[0].releasing).toBe(true)
    const ramp = voiceGain.gain.events.find((e) => e.type === 'exponential')!
    expect(ramp.time).toBeCloseTo(0.5 + RELEASE_SECONDS, 6)
    expect(source.stoppedAt).toBeCloseTo(0.5 + RELEASE_SECONDS + 0.005, 6)
  })

  it('a repeated note retriggers: the old voice gets a fast release and a new one starts', async () => {
    const { ctx, engine } = makeEngine()
    await engine.start()
    engine.noteOn(64, 90)
    ctx.advance(0.1)
    engine.noteOn(64, 110)
    const voices = engine.activeVoices()
    expect(voices).toHaveLength(2)
    expect(voices[0]).toMatchObject({ midi: 64, velocity: 90, releasing: true })
    expect(voices[1]).toMatchObject({ midi: 64, velocity: 110, releasing: false })
    expect(ctx.sources()[0].stoppedAt).toBeCloseTo(0.1 + RETRIGGER_RELEASE_SECONDS + 0.005, 6)
    ctx.advance(0.2)
    expect(engine.activeVoices()).toHaveLength(1)
    engine.noteOff(64)
    expect(engine.activeVoices()[0]).toMatchObject({ velocity: 110, releasing: true })
  })

  it('overlapping notes each keep their own voice and release independently', async () => {
    const { ctx, engine } = makeEngine()
    await engine.start()
    engine.noteOn(60, 100)
    engine.noteOn(64, 100)
    engine.noteOn(67, 100)
    expect(engine.activeVoices().map((v) => v.midi)).toEqual([60, 64, 67])
    engine.noteOff(64)
    expect(engine.activeVoices().map((v) => [v.midi, v.releasing])).toEqual([
      [60, false],
      [64, true],
      [67, false],
    ])
    ctx.advance(1)
    expect(engine.activeVoices().map((v) => v.midi)).toEqual([60, 67])
  })

  it('release finishes: voices end, nodes disconnect, and counts return to baseline', async () => {
    const { ctx, timers, engine } = makeEngine()
    await engine.start()
    timers.flush()
    const baseline = engine.metrics()
    expect(baseline.liveNodes).toBe(1) // the master gain
    for (const midi of [60, 62, 64]) engine.noteOn(midi, 100)
    expect(engine.metrics().liveNodes).toBe(7)
    for (const midi of [60, 62, 64]) engine.noteOff(midi)
    ctx.advance(RELEASE_SECONDS + 0.1)
    expect(engine.activeVoices()).toEqual([])
    expect(engine.metrics().liveNodes).toBe(1)
    expect(ctx.liveNodes().filter((n) => n instanceof FakeSource)).toHaveLength(0)
    expect(ctx.liveNodes().filter((n) => n instanceof FakeGain)).toHaveLength(1)
    // no dangling timers either
    timers.flush()
    expect(timers.pending()).toBe(0)
  })

  it('cleanup also happens through the timer fallback when onended never fires', async () => {
    const { ctx, timers, engine } = makeEngine()
    await engine.start()
    engine.noteOn(60, 100)
    engine.noteOff(60)
    for (const s of ctx.sources()) s.onended = null // simulate a host that never fires ended
    timers.advance(RELEASE_SECONDS * 1000 + 100)
    expect(engine.activeVoices()).toEqual([])
    expect(engine.metrics().liveNodes).toBe(1)
  })

  it('all-notes-off releases every voice quickly and clears sustain', async () => {
    const { ctx, engine } = makeEngine()
    await engine.start()
    engine.setSustain(true)
    engine.noteOn(60, 100)
    engine.noteOn(72, 100)
    engine.noteOff(72) // sustained
    engine.allNotesOff()
    expect(engine.isSustain()).toBe(false)
    expect(engine.activeVoices().every((v) => v.releasing && !v.keyDown && !v.sustained)).toBe(true)
    for (const s of ctx.sources()) expect(s.stoppedAt).toBeCloseTo(ALL_NOTES_OFF_RELEASE_SECONDS + 0.005, 6)
    ctx.advance(0.2)
    expect(engine.activeVoices()).toEqual([])
  })

  it('the lifecycle is deterministic: the same events produce the same schedule', async () => {
    const run = async () => {
      const { ctx, engine } = makeEngine()
      await engine.start()
      engine.noteOn(60, 100)
      ctx.advance(0.25)
      engine.noteOn(64, 80)
      ctx.advance(0.25)
      engine.noteOff(60)
      engine.setSustain(true)
      engine.noteOff(64)
      ctx.advance(0.5)
      engine.setSustain(false)
      return ctx.sources().map((s) => [s.startedAt, s.stoppedAt]).concat(ctx.gains().map((g) => g.gain.events.map((e) => [e.type, +e.value.toFixed(6), +e.time.toFixed(6)])) as never)
    }
    expect(await run()).toEqual(await run())
  })
})

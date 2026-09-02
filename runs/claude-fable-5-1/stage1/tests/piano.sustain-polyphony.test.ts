import { describe, expect, it } from 'vitest'
import { PianoEngine, RELEASE_SECONDS, STEAL_RELEASE_SECONDS } from '../src/audio/engine'
import { FakeAudioContext, FakeTimers } from '../src/audio/fakeAudio'
import { renderPianoNote, rms, velocityGain, velocityLayer } from '../src/audio/pianoRenderer'
import { quickRenderer } from './helpers'

function makeEngine(extra: Partial<ConstructorParameters<typeof PianoEngine>[0]> = {}) {
  const ctx = new FakeAudioContext(48000)
  const timers = new FakeTimers()
  const engine = new PianoEngine({ createContext: () => ctx, timers, renderer: quickRenderer, warmNotes: [60], ...extra })
  return { ctx, timers, engine }
}

describe('piano.basic-sustain-polyphony — sustain transitions, concurrent voices, stealing, velocity', () => {
  it('sustain holds released keys until the pedal lifts, then releases exactly those voices', async () => {
    const { ctx, engine } = makeEngine()
    await engine.start()
    engine.setSustain(true)
    engine.noteOn(60, 100)
    engine.noteOn(64, 100)
    engine.noteOff(60)
    expect(engine.activeVoices().map((v) => [v.midi, v.keyDown, v.sustained, v.releasing])).toEqual([
      [60, false, true, false],
      [64, true, false, false],
    ])
    ctx.advance(0.3)
    engine.setSustain(false)
    expect(engine.activeVoices().map((v) => [v.midi, v.releasing])).toEqual([
      [60, true],
      [64, false],
    ])
    expect(ctx.sources()[0].stoppedAt).toBeCloseTo(0.3 + RELEASE_SECONDS + 0.005, 6)
    expect(ctx.sources()[1].stoppedAt).toBeNull()
    // pressing sustain while a key is down, then releasing the key, sustains it
    engine.setSustain(true)
    engine.noteOff(64)
    expect(engine.activeVoices().find((v) => v.midi === 64)).toMatchObject({ sustained: true, releasing: false })
  })

  it('sustain transitions are idempotent and do not retrigger voices', async () => {
    const { ctx, engine } = makeEngine()
    await engine.start()
    engine.noteOn(60, 100)
    engine.setSustain(true)
    engine.setSustain(true)
    engine.setSustain(false)
    engine.setSustain(false)
    expect(ctx.sources()).toHaveLength(1)
    expect(engine.activeVoices()[0].releasing).toBe(false)
  })

  it('plays many concurrent voices, each with its own source and gain', async () => {
    const { ctx, engine } = makeEngine({ maxVoices: 32 })
    await engine.start()
    const notes = Array.from({ length: 16 }, (_, i) => 40 + i * 3)
    for (const midi of notes) engine.noteOn(midi, 100)
    expect(engine.activeVoices().map((v) => v.midi)).toEqual(notes)
    expect(ctx.sources()).toHaveLength(16)
    expect(ctx.sources().every((s) => s.reachesDestination())).toBe(true)
  })

  it('steals the oldest voice deterministically when the polyphony limit is reached', async () => {
    const { ctx, engine } = makeEngine({ maxVoices: 4 })
    await engine.start()
    const order = [60, 62, 64, 65, 67, 69]
    for (const midi of order) {
      engine.noteOn(midi, 100)
      ctx.advance(0.01)
    }
    expect(engine.activeVoices().map((v) => v.midi)).toEqual([64, 65, 67, 69])
    const stolen = ctx.sources().slice(0, 2)
    expect(stolen.map((s) => s.stoppedAt!.toFixed(3))).toEqual([(0.04 + STEAL_RELEASE_SECONDS + 0.005).toFixed(3), (0.05 + STEAL_RELEASE_SECONDS + 0.005).toFixed(3)])
    expect(stolen.every((s) => s.disconnected)).toBe(true)
    // the same sequence always steals the same voices
    const again = makeEngine({ maxVoices: 4 })
    await again.engine.start()
    for (const midi of order) {
      again.engine.noteOn(midi, 100)
      again.ctx.advance(0.01)
    }
    expect(again.engine.activeVoices().map((v) => v.midi)).toEqual([64, 65, 67, 69])
  })

  it('velocity moves level in the expected direction across and within layers', async () => {
    expect(velocityGain(20)).toBeLessThan(velocityGain(60))
    expect(velocityGain(60)).toBeLessThan(velocityGain(100))
    expect(velocityGain(100)).toBeLessThan(velocityGain(127))
    expect([velocityLayer(10), velocityLayer(60), velocityLayer(120)]).toEqual([0, 1, 2])
    // rendered loudness (buffer × per-voice gain) rises with velocity
    const { ctx, engine } = makeEngine()
    await engine.start()
    const loudness = (velocity: number) => {
      engine.noteOn(60, velocity)
      const source = ctx.sources().at(-1)!
      const gain = ctx.gains().at(-1)!
      const level = rms(source.buffer!.getChannelData(0)) * gain.gain.value
      engine.noteOff(60)
      ctx.advance(1)
      return level
    }
    const soft = loudness(30)
    const medium = loudness(75)
    const hard = loudness(120)
    expect(soft).toBeLessThan(medium)
    expect(medium).toBeLessThan(hard)
    // and the timbre differs between layers (not just gain): brighter strokes have more high-frequency energy
    const a = renderPianoNote({ midi: 60, velocity: 30, sampleRate: 8000, maxSeconds: 0.25 })
    const b = renderPianoNote({ midi: 60, velocity: 120, sampleRate: 8000, maxSeconds: 0.25 })
    const highEnergy = (x: Float32Array) => {
      let e = 0
      for (let i = 1; i < x.length; i++) e += (x[i] - x[i - 1]) ** 2
      return Math.sqrt(e / x.length) / (rms(x) || 1)
    }
    expect(highEnergy(b)).toBeGreaterThan(highEnergy(a))
  })
})

import { describe, expect, it } from 'vitest'
import { PianoEngine } from '../src/audio/engine'
import { FakeAudioContext, FakeTimers } from '../src/audio/fakeAudio'
import { audibleSeconds, renderPerformance } from '../src/audio/offlineRender'
import { midiToFrequency, naturalDecaySeconds, renderPianoNote, rms } from '../src/audio/pianoRenderer'

const SR = 11025

describe('piano audio signal — deterministic relationships on real sample data', () => {
  it('renders a non-silent, bounded, deterministic buffer', () => {
    const a = renderPianoNote({ midi: 60, velocity: 100, sampleRate: SR, maxSeconds: 1 })
    const b = renderPianoNote({ midi: 60, velocity: 100, sampleRate: SR, maxSeconds: 1 })
    expect(a.length).toBe(SR)
    expect(rms(a)).toBeGreaterThan(0.02)
    expect(Math.max(...Array.from(a).map(Math.abs))).toBeLessThanOrEqual(1)
    expect(Array.from(a)).toEqual(Array.from(b))
  })

  it('velocity raises the rendered level monotonically', () => {
    const levels = [20, 50, 80, 110, 127].map((v) => rms(renderPianoNote({ midi: 64, velocity: v, sampleRate: SR, maxSeconds: 0.5 })))
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1])
  })

  it('different notes render differently and at the expected pitch', () => {
    const c4 = renderPianoNote({ midi: 60, velocity: 100, sampleRate: SR, maxSeconds: 0.5 })
    const e4 = renderPianoNote({ midi: 64, velocity: 100, sampleRate: SR, maxSeconds: 0.5 })
    let diff = 0
    for (let i = 0; i < c4.length; i++) diff += Math.abs(c4[i] - e4[i])
    expect(diff / c4.length).toBeGreaterThan(0.01)
    // the normalized autocorrelation peaks at the fundamental period (inharmonicity shifts it only slightly)
    const acf = (x: Float32Array, lag: number, from: number, to: number) => {
      let num = 0
      let den = 0
      for (let i = from; i < to; i++) {
        num += x[i] * x[i + lag]
        den += x[i] * x[i]
      }
      return den ? num / den : 0
    }
    const a3 = renderPianoNote({ midi: 57, velocity: 100, sampleRate: SR, maxSeconds: 1 })
    const period = SR / midiToFrequency(57)
    const from = Math.round(SR * 0.3)
    const to = Math.round(SR * 0.8)
    const atPeriod = Math.max(acf(a3, Math.floor(period), from, to), acf(a3, Math.ceil(period), from, to))
    expect(atPeriod).toBeGreaterThan(0.6)
    expect(acf(a3, Math.round(period * 0.7), from, to)).toBeLessThan(atPeriod)
    expect(acf(a3, Math.round(period * 1.3), from, to)).toBeLessThan(atPeriod)
  })

  it('bass notes ring longer than treble notes', () => {
    expect(naturalDecaySeconds(28)).toBeGreaterThan(naturalDecaySeconds(60))
    expect(naturalDecaySeconds(60)).toBeGreaterThan(naturalDecaySeconds(100))
    const low = renderPianoNote({ midi: 36, velocity: 100, sampleRate: SR })
    const high = renderPianoNote({ midi: 96, velocity: 100, sampleRate: SR })
    expect(audibleSeconds(low, SR)).toBeGreaterThan(audibleSeconds(high, SR))
  })

  it('releasing a key shortens the note; sustain lengthens it again', () => {
    const held = renderPerformance([{ time: 0, type: 'on', midi: 60, velocity: 100 }], { sampleRate: SR, seconds: 3 })
    const released = renderPerformance(
      [
        { time: 0, type: 'on', midi: 60, velocity: 100 },
        { time: 0.3, type: 'off', midi: 60 },
      ],
      { sampleRate: SR, seconds: 3 },
    )
    const sustained = renderPerformance(
      [
        { time: 0, type: 'on', midi: 60, velocity: 100 },
        { time: 0.1, type: 'sustain', on: true },
        { time: 0.3, type: 'off', midi: 60 },
        { time: 1.5, type: 'sustain', on: false },
      ],
      { sampleRate: SR, seconds: 3 },
    )
    const tHeld = audibleSeconds(held, SR)
    const tReleased = audibleSeconds(released, SR)
    const tSustained = audibleSeconds(sustained, SR)
    expect(tReleased).toBeLessThan(tHeld)
    expect(tReleased).toBeLessThan(0.3 + 0.35)
    expect(tSustained).toBeGreaterThan(tReleased + 0.8)
    expect(tSustained).toBeLessThanOrEqual(tHeld + 1e-6)
    // energy after the release point is far lower than before it
    const before = rms(released, Math.round(SR * 0.1), Math.round(SR * 0.3))
    const after = rms(released, Math.round(SR * 0.8), Math.round(SR * 1.0))
    expect(after).toBeLessThan(before * 0.05)
  })

  it('repeated and overlapping notes mix rather than replace each other', () => {
    const one = renderPerformance([{ time: 0, type: 'on', midi: 60, velocity: 100 }], { sampleRate: SR, seconds: 1 })
    const two = renderPerformance(
      [
        { time: 0, type: 'on', midi: 60, velocity: 100 },
        { time: 0, type: 'on', midi: 67, velocity: 100 },
      ],
      { sampleRate: SR, seconds: 1 },
    )
    expect(rms(two)).toBeGreaterThan(rms(one) * 1.1)
  })

  it('every voice reaches the destination only through the master gain (nothing bypasses the master path)', async () => {
    const ctx = new FakeAudioContext(SR)
    const engine = new PianoEngine({ createContext: () => ctx, timers: new FakeTimers(), warmNotes: [], renderer: (p) => renderPianoNote({ ...p, maxSeconds: 0.2 }) })
    await engine.start()
    const master = ctx.gains()[0]
    expect(master.gain.value).toBeCloseTo(0.8, 6)
    for (const midi of [48, 60, 72]) engine.noteOn(midi, 100)
    for (const source of ctx.sources()) {
      expect(source.connections.every((c) => c !== ctx.destination)).toBe(true)
      const gain = source.connections[0] as (typeof ctx.gains)[number] extends never ? never : { connections: unknown[] }
      expect(gain.connections).toEqual([master])
      expect(source.reachesDestination()).toBe(true)
    }
    expect(master.connections).toEqual([ctx.destination])
  })
})

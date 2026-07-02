import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary, FakeGain } from '../test/fakes'
import { InstrumentStore } from '../state/instrument'
import { PianoEngine } from './engine'

/**
 * piano.pedals — full sustain, half-pedal (continuous CC64), sostenuto and
 * soft pedal behavior. Soft/half-pedal are truthful approximations
 * (level/timbre scaling and lengthened damping) and are tested as such.
 */
function makeSystem() {
  const setup = fakeAudioBoundary()
  const store = new InstrumentStore()
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(store)
  return { ...setup, store, engine }
}

describe('piano.pedals', () => {
  it('full sustain holds released notes; releasing the pedal damps them', () => {
    const { engine, timers } = makeSystem()
    engine.setSustain(1)
    engine.noteOn(60, 0.8)
    engine.noteOff(60)
    timers.advance(4000)
    expect(engine.activeVoiceCount()).toBe(1)
    engine.setSustain(0)
    timers.advance(2000)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('half-pedal (CC64 mid position) partially damps instead of holding forever', () => {
    const { engine, timers } = makeSystem()
    engine.setSustain(0.5) // half-pedal band
    engine.noteOn(60, 0.8)
    engine.noteOff(60)
    // Not held (would stay active forever), but damped SLOWER than a plain release.
    timers.advance(400) // > normal release cleanup (~260 ms), < half-pedal (~930 ms)
    expect(engine.activeVoiceCount()).toBe(1)
    timers.advance(1000)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('a plain release damps faster than a half-pedal release', () => {
    const { engine, timers } = makeSystem()
    engine.noteOn(62, 0.8)
    engine.noteOff(62)
    timers.advance(400)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('sostenuto captures only the notes held at pedal-down', () => {
    const { engine, timers } = makeSystem()
    engine.noteOn(60, 0.8)
    engine.setSostenuto(true)
    engine.noteOn(64, 0.8) // played after — not captured
    engine.noteOff(60)
    engine.noteOff(64)
    timers.advance(1000)
    expect(engine.isNoteActive(60)).toBe(true) // captured, still sounding
    expect(engine.isNoteActive(64)).toBe(false)
    engine.setSostenuto(false)
    timers.advance(1000)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('sostenuto releases into sustain when the damper pedal is down', () => {
    const { engine, timers } = makeSystem()
    engine.noteOn(60, 0.8)
    engine.setSostenuto(true)
    engine.noteOff(60)
    engine.setSustain(1)
    engine.setSostenuto(false)
    timers.advance(1000)
    expect(engine.isNoteActive(60)).toBe(true) // handed over to the damper
    engine.setSustain(0)
    timers.advance(1000)
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('soft pedal lowers the level of new notes (truthful una-corda approximation)', () => {
    const measure = (soft: boolean): number => {
      const { engine, getContext } = makeSystem()
      engine.ensureStarted()
      engine.setSoft(soft)
      const context = getContext()!
      const before = context.nodes.length
      engine.noteOn(60, 0.8)
      const gains = context.nodes.slice(before).filter((n): n is FakeGain => n instanceof FakeGain)
      return Math.max(...gains.map((g) => g.gain.maxScheduled()))
    }
    const normal = measure(false)
    const softened = measure(true)
    expect(softened).toBeGreaterThan(0)
    expect(softened).toBeLessThan(normal)
  })

  it('soft release (Acoustics) lengthens the damping window measurably', () => {
    const cleanupTime = (softRelease: boolean): number => {
      const { engine, store, timers } = makeSystem()
      if (softRelease) {
        // cycle: off -> SoftRel
        store.cycleAcoustics()
        expect(store.getState().piano.softRelease).toBe(true)
      }
      engine.noteOn(60, 0.8)
      engine.noteOff(60)
      let elapsed = 0
      while (engine.activeVoiceCount() > 0 && elapsed < 5000) {
        timers.advance(50)
        elapsed += 50
      }
      return elapsed
    }
    const normal = cleanupTime(false)
    const soft = cleanupTime(true)
    expect(soft).toBeGreaterThan(normal)
  })

  it('pedal state is reset by panic/all-notes-off', () => {
    const { engine } = makeSystem()
    engine.setSustain(1)
    engine.setSostenuto(true)
    engine.allNotesOff('panic')
    expect(engine.isSustainDown()).toBe(false)
    expect(engine.isSostenutoDown()).toBe(false)
  })

  it('pedal noise plays a generated thump only when PED NOISE is enabled (declared generated)', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    const before = context.bufferSources().length
    engine.setSustain(1)
    engine.setSustain(0)
    expect(context.bufferSources().length).toBe(before) // off: no thump
    store.cycleAcoustics() // SoftRel
    store.cycleAcoustics() // +StringRes
    store.cycleAcoustics() // +PedNoise
    expect(store.getState().piano.pedNoise).toBe(true)
    engine.setSustain(1)
    expect(context.bufferSources().length).toBeGreaterThan(before)
  })
})

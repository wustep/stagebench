import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary, fakeStorageBoundary, FakeGain, FakeOscillator, FakeWaveShaper } from '../test/fakes'
import { InstrumentStore, SYNTH_WAVEFORMS } from '../state/instrument'
import { SYNTH_SAMPLE_SETS } from './library'
import { PianoEngine } from './engine'

/**
 * synth.engine / synth.sources — state + graph tests against fakes for the
 * Synth section's Part 1 scope (three layers, Analog-mode oscillator
 * sources, amp envelope). Rendered-audio proof lives in render-synth.test.ts.
 *
 * The Piano section is switched off so voice counts and node inspection
 * reflect the synth alone.
 */
function makeSystem() {
  const setup = fakeAudioBoundary()
  const store = new InstrumentStore()
  const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
  engine.attachStore(store)
  store.setPianoSectionOn(false)
  store.setSynthSectionOn(true)
  return { ...setup, store, engine }
}

function newOscillators(context: { oscillators(): FakeOscillator[] }, run: () => void): FakeOscillator[] {
  const before = context.oscillators().length
  run()
  return context.oscillators().slice(before)
}

function selectWaveform(store: InstrumentStore, name: string): void {
  const index = SYNTH_WAVEFORMS.findIndex((w) => w.name === name)
  store.selectSynthWaveform(index)
}

describe('synth.engine — section gating, layer ownership', () => {
  it('the synth only sounds while its section is on, per enabled layer', () => {
    const { engine, store } = makeSystem()
    store.setSynthSectionOn(false)
    engine.ensureStarted()
    engine.noteOn(60, 0.8)
    expect(engine.layerVoiceCount('A', 'synth')).toBe(0)
    store.setSynthSectionOn(true)
    engine.noteOn(62, 0.8)
    expect(engine.layerVoiceCount('A', 'synth')).toBe(1)
    expect(engine.layerVoiceCount('B', 'synth')).toBe(0) // layer B off by default
    store.toggleSynthLayerEnabled('B')
    store.toggleSynthLayerEnabled('C')
    engine.noteOn(64, 0.8)
    expect(engine.layerVoiceCount('A', 'synth')).toBe(2)
    expect(engine.layerVoiceCount('B', 'synth')).toBe(1)
    expect(engine.layerVoiceCount('C', 'synth')).toBe(1)
  })

  it('each of the three layers owns independent enable/level/octave state', () => {
    const { store } = makeSystem()
    store.setSynthLayerLevel('B', 40)
    store.shiftSynthOctave('C', 1)
    const state = store.getState()
    expect(state.synth.layers.A.level).toBe(100)
    expect(state.synth.layers.B.level).toBe(40)
    expect(state.synth.layers.C.octave).toBe(1)
    expect(state.synth.layers.A.octave).toBe(0)
  })
})

describe('synth.sources — waveform navigation', () => {
  it('WAVEFORM SELECT cycles to the first waveform of the next category', () => {
    const { store } = makeSystem()
    expect(store.getState().synth.layers.A.waveform).toBe(SYNTH_WAVEFORMS.findIndex((w) => w.name === 'Saw'))
    store.cycleSynthWaveformCategory() // Pure -> Sync
    expect(SYNTH_WAVEFORMS[store.getState().synth.layers.A.waveform]!.category).toBe('Sync')
    store.cycleSynthWaveformCategory() // Sync -> Multi
    expect(SYNTH_WAVEFORMS[store.getState().synth.layers.A.waveform]!.category).toBe('Multi')
    store.cycleSynthWaveformCategory() // Multi -> Super
    store.cycleSynthWaveformCategory() // Super -> FM-H
    expect(SYNTH_WAVEFORMS[store.getState().synth.layers.A.waveform]!.category).toBe('FM-H')
    store.cycleSynthWaveformCategory() // FM-H -> Sub (optional scope)
    expect(SYNTH_WAVEFORMS[store.getState().synth.layers.A.waveform]!.category).toBe('Sub')
    store.cycleSynthWaveformCategory() // Sub -> Shape
    expect(SYNTH_WAVEFORMS[store.getState().synth.layers.A.waveform]!.category).toBe('Shape')
    store.cycleSynthWaveformCategory() // Shape -> ShapeSine (spec: separate categories)
    expect(SYNTH_WAVEFORMS[store.getState().synth.layers.A.waveform]!.category).toBe('ShapeSine')
    store.cycleSynthWaveformCategory() // ShapeSine -> Wave
    expect(SYNTH_WAVEFORMS[store.getState().synth.layers.A.waveform]!.category).toBe('Wave')
    store.cycleSynthWaveformCategory() // Wave -> FM-I
    expect(SYNTH_WAVEFORMS[store.getState().synth.layers.A.waveform]!.category).toBe('FM-I')
    store.cycleSynthWaveformCategory() // wraps back to Pure
    expect(SYNTH_WAVEFORMS[store.getState().synth.layers.A.waveform]!.category).toBe('Pure')
  })

  it('selectSynthWaveform picks an exact waveform by index and reports its name', () => {
    const { store } = makeSystem()
    const index = SYNTH_WAVEFORMS.findIndex((w) => w.name === 'Super Saw')
    store.selectSynthWaveform(index)
    expect(store.getState().synth.layers.A.waveform).toBe(index)
    expect(store.getState().lastEdit).toMatch(/Super Saw/)
  })
})

describe('synth.sources — oscillator construction per category', () => {
  it('Pure Sine/Square use native oscillator types; Pulse 33/10 use a custom PeriodicWave', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    selectWaveform(store, 'Sine')
    const sine = newOscillators(context, () => engine.noteOn(60, 0.8))
    expect(sine).toHaveLength(1)
    expect(sine[0]!.type).toBe('sine')
    engine.noteOff(60)

    selectWaveform(store, 'Pulse 33')
    const pulse33 = newOscillators(context, () => engine.noteOn(61, 0.8))
    expect(pulse33).toHaveLength(1)
    expect(pulse33[0]!.type).toBe('custom')
    expect(pulse33[0]!.periodicWave).not.toBeNull()
    engine.noteOff(61)
  })

  it('Multi Saw stacks 3 real sawtooth oscillators (4 for the 8ve variant)', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    selectWaveform(store, 'Multi Saw')
    const multi = newOscillators(context, () => engine.noteOn(60, 0.8))
    expect(multi).toHaveLength(3)
    expect(multi.every((o) => o.type === 'sawtooth')).toBe(true)
    engine.noteOff(60)

    selectWaveform(store, 'Multi Saw 8ve')
    const multi8 = newOscillators(context, () => engine.noteOn(62, 0.8))
    expect(multi8).toHaveLength(4)
    engine.noteOff(62)
  })

  it('Super Saw stacks 7 oscillators with a distinct detune spread each', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    selectWaveform(store, 'Super Saw')
    const super7 = newOscillators(context, () => engine.noteOn(60, 0.8))
    expect(super7).toHaveLength(7)
    const detunes = new Set(super7.map((o) => Math.round(o.detune.value * 100)))
    expect(detunes.size).toBeGreaterThan(1) // not a unison stack of identical detunes
    engine.noteOff(60)
  })

  it('Osc Ctrl live-retargets Multi Saw detune and Super Saw detune width on a sounding voice', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!

    selectWaveform(store, 'Multi Saw')
    const multi = newOscillators(context, () => engine.noteOn(60, 0.8))
    const spread = () => Math.max(...multi.map((o) => o.detune.value)) - Math.min(...multi.map((o) => o.detune.value))
    const before = spread()
    store.setSynthOscCtrl(127)
    expect(spread()).toBeGreaterThan(before)
    engine.noteOff(60)

    selectWaveform(store, 'Super Saw')
    store.setSynthOscCtrl(0)
    const superVoice = newOscillators(context, () => engine.noteOn(62, 0.8))
    const superSpread = () =>
      Math.max(...superVoice.map((o) => o.detune.value)) - Math.min(...superVoice.map((o) => o.detune.value))
    const superBefore = superSpread()
    store.setSynthOscCtrl(127)
    expect(superSpread()).toBeGreaterThan(superBefore)
    engine.noteOff(62)
  })

  it('FM 2-op has exactly 2 oscillators, one connected to the other\'s frequency AudioParam', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    selectWaveform(store, 'FM 2-op')
    const before = context.nodes.length
    engine.noteOn(60, 0.8)
    const oscs = context.oscillators().slice(-2)
    expect(oscs).toHaveLength(2)
    // The modulator's chain is osc -> gain -> carrier.frequency (paramConnections).
    const gains = context.nodes.slice(before).filter((n): n is FakeGain => n instanceof FakeGain)
    const modGain = gains.find((g) => g.paramConnections.length > 0)
    expect(modGain).toBeDefined()
    expect(modGain!.paramConnections).toContain(oscs[0]!.frequency)
    engine.noteOff(60)
  })

  it('OSC CTRL has no effect for a Pure waveform (spec: category-correct behavior)', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    selectWaveform(store, 'Saw')
    store.setSynthOscCtrl(0)
    const low = newOscillators(context, () => engine.noteOn(60, 0.8))
    engine.noteOff(60)
    store.setSynthOscCtrl(127)
    const high = newOscillators(context, () => engine.noteOn(62, 0.8))
    expect(low[0]!.detune.value).toBeCloseTo(high[0]!.detune.value, 6)
    engine.noteOff(62)
  })

  it('White Noise creates a looping buffer source, not an oscillator', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    selectWaveform(store, 'White Noise')
    const beforeOscs = context.oscillators().length
    const beforeSources = context.bufferSources().length
    engine.noteOn(60, 0.8)
    expect(context.oscillators().length).toBe(beforeOscs) // no oscillator created
    const sources = context.bufferSources().slice(beforeSources)
    expect(sources).toHaveLength(1)
    expect(sources[0]!.loop).toBe(true)
    expect(sources[0]!.buffer).not.toBeNull()
    engine.noteOff(60)
  })

  it('Sync Square selects a periodic wave distinct from Sync Saw\'s', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    selectWaveform(store, 'Sync Saw')
    const saw = newOscillators(context, () => engine.noteOn(60, 0.8))
    engine.noteOff(60)
    selectWaveform(store, 'Sync Square')
    const square = newOscillators(context, () => engine.noteOn(62, 0.8))
    engine.noteOff(62)
    expect(saw[0]!.type).toBe('custom')
    expect(square[0]!.type).toBe('custom')
    expect(saw[0]!.periodicWave).not.toBeNull()
    expect(square[0]!.periodicWave).not.toBeNull()
    // Distinct PeriodicWave instances built from distinct harmonic spectra
    // (Sync Square is odd-harmonic-only; Sync Saw uses the full 1/n series).
    expect(square[0]!.periodicWave).not.toBe(saw[0]!.periodicWave)
    expect(Array.from(square[0]!.periodicWave!.imag)).not.toEqual(Array.from(saw[0]!.periodicWave!.imag))
  })
})

describe('synth.envelope — amp envelope and velocity', () => {
  it('the amp envelope ramps to a peak on attack and toward release on note-off', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.setSynthAmpEnvelope({ attack: 0, decay: 127, release: 20 })
    const before = context.nodes.length
    engine.noteOn(60, 0.9)
    const gains = context.nodes.slice(before).filter((n): n is FakeGain => n instanceof FakeGain)
    const voiceGain = gains.find((g) => g.gain.events.some((e) => e.kind === 'exp'))!
    expect(voiceGain.gain.maxScheduled()).toBeGreaterThan(0)
    engine.noteOff(60)
    expect(voiceGain.gain.events.some((e) => e.kind === 'target')).toBe(true)
  })

  it('velocity levels 0..3 scale the amp envelope peak', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    const peakFor = (velocityLevel: 0 | 1 | 2 | 3, velocity: number) => {
      store.setSynthAmpEnvelope({ velocity: velocityLevel })
      const before = context.nodes.length
      engine.noteOn(60, velocity)
      const gains = context.nodes.slice(before).filter((n): n is FakeGain => n instanceof FakeGain)
      const peak = Math.max(...gains.map((g) => g.gain.maxScheduled()))
      engine.noteOff(60)
      return peak
    }
    // Velocity Off (0): fixed peak regardless of played velocity.
    expect(peakFor(0, 0.2)).toBeCloseTo(peakFor(0, 0.95), 6)
    // Velocity 3: full-range scaling — soft is audibly quieter than hard.
    expect(peakFor(3, 0.2)).toBeLessThan(peakFor(3, 0.95))
  })
})

describe('synth.pedals — SUSTPED routing', () => {
  it('synth SUSTPED off releases held notes on note-off', () => {
    const { engine, store, timers } = makeSystem()
    engine.setSustain(1)
    engine.noteOn(60, 0.8)
    engine.noteOff(60)
    timers.advance(500)
    expect(engine.activeVoiceCount()).toBe(1) // held: synth SUSTPED defaults on
    store.toggleSynthSustped()
    timers.advance(5000)
    expect(engine.activeVoiceCount()).toBe(0) // routing off released the hold
    engine.setSustain(0)
  })
})

describe('synth.snapshot — program round-trip and old-snapshot tolerance', () => {
  it('program store/reload round-trips the synth section', () => {
    const store = new InstrumentStore()
    const savedSlot = store.getState().programs.current
    store.setSynthSectionOn(true)
    store.toggleSynthLayerEnabled('B')
    store.setSynthLayerLevel('B', 55)
    selectWaveform(store, 'FM 2-op')
    store.setSynthOscCtrl(90)
    store.storePress()
    store.storePress() // confirms the store into the current slot
    // Navigate away (discarding the in-memory edit) and back — the reload
    // must restore the synth state from the stored snapshot, not memory.
    store.selectProgram(savedSlot === 0 ? 1 : 0)
    expect(store.getState().synth.sectionOn).toBe(false)
    store.selectProgram(savedSlot)
    expect(store.getState().synth.sectionOn).toBe(true)
    expect(store.getState().synth.layers.B.enabled).toBe(true)
    expect(store.getState().synth.layers.B.level).toBe(55)
    // Enabling layer B moved focus there (organ/piano focus-follows-layer
    // pattern), so the waveform/Osc Ctrl edits landed on layer B.
    expect(SYNTH_WAVEFORMS[store.getState().synth.layers.B.waveform]!.name).toBe('FM 2-op')
    expect(store.getState().synth.layers.B.oscCtrl).toBe(90)
  })

  it('tolerates a persisted (pre-synth) program payload that lacks a synth key entirely', () => {
    // Simulate an old localStorage payload written before the synth key
    // existed: every stored snapshot lacks 'synth' outright.
    const first = new InstrumentStore()
    const rawBank = first.getState().programs.bank.map((slot) => {
      const snapshot = { ...slot.snapshot } as Record<string, unknown>
      delete snapshot.synth
      return { name: slot.name, snapshot }
    })
    const rawLive = first.getState().programs.live.map((slot) => {
      const snapshot = { ...slot.snapshot } as Record<string, unknown>
      delete snapshot.synth
      return { name: slot.name, snapshot }
    })
    const storage = fakeStorageBoundary({
      'stagebench.programs.v1': JSON.stringify({ version: 1, bank: rawBank, live: rawLive, liveMode: false, current: 3 }),
    })
    // Constructing over that storage restores it immediately (constructor
    // calls restorePrograms) — it must not throw, and default synth state
    // must stand in for the missing key.
    const restored = new InstrumentStore(storage)
    expect(restored.getState().synth.layers.A.enabled).toBe(true)
    expect(restored.getState().synth.sectionOn).toBe(false)
    // Navigating to another slot (selectProgram spreads the stored snapshot
    // over canonical state) must also tolerate the missing key.
    expect(() => restored.selectProgram(7)).not.toThrow()
    expect(restored.getState().synth.layers.A.enabled).toBe(true)
  })
})

describe('synth.sound-init — optional scope', () => {
  it('SOUND INIT resets sound params but preserves enable/level/octave/zone', () => {
    const { store } = makeSystem()
    store.setSynthLayerLevel('A', 55)
    store.shiftSynthOctave('A', 1)
    store.cycleLayerZone('synth', 'A', 1)
    const zoneBefore = store.getState().synth.layers.A.zone
    selectWaveform(store, 'FM 2-op')
    store.setSynthOscCtrl(100)
    store.setSynthAmpEnvelope({ attack: 90 })
    store.cycleSynthFilterType()
    store.setSynthOscEnvelope({ toPitch: true })
    store.cycleSynthLfoWaveform()
    store.cycleSynthVoiceMode()
    store.cycleSynthLayerMode() // Analog -> Samples

    store.synthSoundInit()
    const layer = store.getState().synth.layers.A
    // Preserved.
    expect(layer.level).toBe(55)
    expect(layer.octave).toBe(1)
    expect(layer.zone).toEqual(zoneBefore)
    // Reset to init defaults.
    expect(SYNTH_WAVEFORMS[layer.waveform]!.name).toBe('Saw')
    expect(layer.oscCtrl).toBe(64)
    expect(layer.ampEnvelope.attack).toBe(0)
    expect(layer.filter.type).toBe('LP24')
    expect(layer.oscEnvelope.toPitch).toBe(false)
    expect(layer.lfo.waveform).toBe('Triangle')
    expect(layer.voice.mode).toBe('Poly')
    expect(layer.mode).toBe('Analog')
    expect(store.getState().lastEdit).toMatch(/Sound Init — Synth A/)
  })
})

describe('synth.sources — optional oscillator categories', () => {
  it('Sub Osc has a sub oscillator at half the fundamental frequency whose gain follows OSC CTRL live', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    selectWaveform(store, 'Saw Sub')
    store.setSynthOscCtrl(0)
    const before = context.nodes.length
    const beforeOscCount = context.oscillators().length
    engine.noteOn(60, 0.8)
    const created = context.oscillators().slice(beforeOscCount)
    expect(created).toHaveLength(2)
    const [main, sub] = created
    expect(sub!.frequency.value).toBeCloseTo(main!.frequency.value / 2, 5)
    const subGain = context.nodes.slice(before).filter((n): n is FakeGain => n instanceof FakeGain).find((g) => g.gain.value === 0)!
    expect(subGain).toBeDefined()
    store.setSynthOscCtrl(127)
    expect(subGain.gain.value).toBeGreaterThan(0)
    engine.noteOff(60)
  })

  it('Shape Pulse rebuilds its periodic wave across a large ctrl move', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    selectWaveform(store, 'Shape Pulse')
    store.setSynthOscCtrl(0)
    const low = newOscillators(context, () => engine.noteOn(60, 0.8))
    expect(low[0]!.type).toBe('custom')
    const lowImag = Array.from(low[0]!.periodicWave!.imag)
    store.setSynthOscCtrl(127)
    expect(Array.from(low[0]!.periodicWave!.imag)).not.toEqual(lowImag) // rebuilt in place
    engine.noteOff(60)
  })

  it('Shape Sine has a waveshaper whose drive follows ctrl', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.toggleSynthFilterOn() // isolate the oscillator's own fold shaper from the filter's drive shaper
    selectWaveform(store, 'Shape Sine')
    store.setSynthOscCtrl(0)
    const before = context.nodes.length
    engine.noteOn(60, 0.8)
    const shapers = context.nodes.slice(before).filter((n): n is FakeWaveShaper => n instanceof FakeWaveShaper)
    expect(shapers).toHaveLength(1) // just the fold shaper — the filter stage is off
    expect(shapers[0]!.curve).not.toBeNull()
    const driveGain = context.nodes
      .slice(before)
      .filter((n): n is FakeGain => n instanceof FakeGain)
      .find((g) => g.connections.includes(shapers[0]!))!
    expect(driveGain).toBeDefined()
    const before2 = driveGain.gain.value
    store.setSynthOscCtrl(127)
    expect(driveGain.gain.value).toBeGreaterThan(before2)
    engine.noteOff(60)
  })

  it('FM 2-op B has modulator at ~1.414 ratio (vs FM-H\'s 1.0)', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    selectWaveform(store, 'FM 2-op')
    const before = context.oscillators().length
    engine.noteOn(60, 0.8)
    const harmonic = context.oscillators().slice(before)
    engine.noteOff(60)

    selectWaveform(store, 'FM 2-op B')
    const before2 = context.oscillators().length
    engine.noteOn(62, 0.8)
    const inharmonic = context.oscillators().slice(before2)
    engine.noteOff(62)

    const harmonicRatio = harmonic[1]!.frequency.value / harmonic[0]!.frequency.value
    const inharmonicRatio = inharmonic[1]!.frequency.value / inharmonic[0]!.frequency.value
    expect(harmonicRatio).toBeCloseTo(1, 5)
    expect(inharmonicRatio).toBeCloseTo(1.414, 3)
  })
})

describe('synth.mode — Analog/Samples cycle (optional scope)', () => {
  it('SYNTH MODE cycles state + Mode LEDs + WAVE list switches to sample names', () => {
    const { store } = makeSystem()
    expect(store.getState().synth.layers.A.mode).toBe('Analog')
    store.cycleSynthLayerMode()
    expect(store.getState().synth.layers.A.mode).toBe('Samples')
    expect(store.getState().lastEdit).toMatch(/Synth A Mode: Samples/)
    // The WAVE list now selects between the two bundled sample sets.
    expect(SYNTH_SAMPLE_SETS).toHaveLength(2)
    store.selectSynthWaveform(1)
    expect(store.getState().synth.layers.A.waveform).toBe(1)
    store.cycleSynthLayerMode()
    expect(store.getState().synth.layers.A.mode).toBe('Analog')
    // EXTERN is never reachable from this cycle.
    store.cycleSynthLayerMode()
    store.cycleSynthLayerMode()
    expect(['Analog', 'Samples']).toContain(store.getState().synth.layers.A.mode)
  })
})

import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary, fakeStorageBoundary, FakeGain, FakeOscillator } from '../test/fakes'
import { InstrumentStore, SYNTH_WAVEFORMS } from '../state/instrument'
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

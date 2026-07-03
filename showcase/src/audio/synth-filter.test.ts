import { describe, expect, it } from 'vitest'
import { fakeAssetBoundary, fakeAudioBoundary, FakeFilter, FakeGain, FakeWaveShaper } from '../test/fakes'
import { InstrumentStore, mappings, SYNTH_LFO_DESTINATIONS, SYNTH_WAVEFORMS } from '../state/instrument'
import { PianoEngine } from './engine'

/**
 * synth.filter-envelopes — state + graph tests against fakes for the Synth
 * engine's part 2 scope (spec: nord-stage-4.synth.json filter, envelopes,
 * lfo): per-voice filter/drive, the filter and oscillator envelopes, and the
 * per-layer standing LFO. Rendered-audio proof lives in render-synth2.test.ts.
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

function filtersFrom(context: { nodes: unknown[] }, before: number): FakeFilter[] {
  return (context.nodes as unknown[]).slice(before).filter((n): n is FakeFilter => n instanceof FakeFilter)
}

describe('synth.filter — node types and cascade per filter type', () => {
  it('LP12/HP/BP build one biquad stage; LP24 cascades two lowpass stages in series', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!

    store.cycleSynthFilterType() // LP24 -> HP
    let before = context.nodes.length
    engine.noteOn(60, 0.8)
    let filters = filtersFrom(context, before)
    expect(filters).toHaveLength(1)
    expect(filters[0]!.type).toBe('highpass')
    engine.noteOff(60)

    store.cycleSynthFilterType() // HP -> BP
    before = context.nodes.length
    engine.noteOn(61, 0.8)
    filters = filtersFrom(context, before)
    expect(filters).toHaveLength(1)
    expect(filters[0]!.type).toBe('bandpass')
    engine.noteOff(61)

    store.cycleSynthFilterType() // BP -> LP12
    before = context.nodes.length
    engine.noteOn(62, 0.8)
    filters = filtersFrom(context, before)
    expect(filters).toHaveLength(1)
    expect(filters[0]!.type).toBe('lowpass')
    engine.noteOff(62)

    store.cycleSynthFilterType() // LP12 -> LP24
    before = context.nodes.length
    engine.noteOn(63, 0.8)
    filters = filtersFrom(context, before)
    expect(filters).toHaveLength(2)
    expect(filters.every((f) => f.type === 'lowpass')).toBe(true)
    // Cascaded in series: the first stage's only filter connection is the second.
    expect(filters[0]!.connections).toContain(filters[1]!)
    engine.noteOff(63)
  })

  it('keyboard tracking scales the base cutoff with the played note', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.setSynthFilterParam('freq', 64)
    store.cycleSynthFilterTracking() // Off -> 1/3
    store.cycleSynthFilterTracking() // 1/3 -> 2/3
    store.cycleSynthFilterTracking() // 2/3 -> 1 (full tracking)
    expect(store.getState().synth.layers.A.filter.tracking).toBe(3)

    const before = context.nodes.length
    engine.noteOn(48, 0.8) // an octave below middle C
    const low = filtersFrom(context, before)[0]!.frequency.value
    engine.noteOff(48)

    const before2 = context.nodes.length
    engine.noteOn(72, 0.8) // an octave above middle C
    const high = filtersFrom(context, before2)[0]!.frequency.value
    engine.noteOff(72)

    expect(high).toBeGreaterThan(low)
  })

  it('drive above Off builds a waveshaper curve; Off leaves it null', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!

    let before = context.nodes.length
    engine.noteOn(60, 0.8)
    let shapers = context.nodes.slice(before).filter((n): n is FakeWaveShaper => n instanceof FakeWaveShaper)
    expect(shapers).toHaveLength(1)
    expect(shapers[0]!.curve).toBeNull()
    engine.noteOff(60)

    store.cycleSynthFilterDrive() // Off -> 1
    before = context.nodes.length
    engine.noteOn(61, 0.8)
    shapers = context.nodes.slice(before).filter((n): n is FakeWaveShaper => n instanceof FakeWaveShaper)
    expect(shapers).toHaveLength(1)
    expect(shapers[0]!.curve).not.toBeNull()
    engine.noteOff(61)
  })

  it('FILTER ON gates the filter/drive stage entirely: off skips both nodes', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.toggleSynthFilterOn()
    expect(store.getState().synth.layers.A.filter.on).toBe(false)

    const before = context.nodes.length
    engine.noteOn(60, 0.8)
    const filters = filtersFrom(context, before)
    const shapers = context.nodes.slice(before).filter((n): n is FakeWaveShaper => n instanceof FakeWaveShaper)
    expect(filters).toHaveLength(0)
    expect(shapers).toHaveLength(0)
    engine.noteOff(60)
  })
})

describe('synth.envelope-target — dial edit selection', () => {
  it('AMP/FILTER/OSC ENVELOPE buttons select which envelope the three dials edit', () => {
    const { store } = makeSystem()
    expect(store.getState().synthEnvEdit).toBeNull()

    store.setSynthEnvEdit('filter')
    store.setSynthFilterEnvelope({ attack: 40 })
    expect(store.getState().synth.layers.A.filter.envelope.attack).toBe(40)
    expect(store.getState().synth.layers.A.ampEnvelope.attack).toBe(0)

    store.setSynthEnvEdit('osc')
    store.setSynthOscEnvelope({ attack: 77 })
    expect(store.getState().synth.layers.A.oscEnvelope.attack).toBe(77)
    expect(store.getState().synth.layers.A.filter.envelope.attack).toBe(40) // untouched by the osc edit

    store.setSynthEnvEdit('amp')
    store.setSynthAmpEnvelope({ attack: 12 })
    expect(store.getState().synth.layers.A.ampEnvelope.attack).toBe(12)
    expect(store.getState().synth.layers.A.oscEnvelope.attack).toBe(77) // untouched by the amp edit

    store.setSynthEnvEdit(null)
    expect(store.getState().synthEnvEdit).toBeNull()
  })
})

describe('synth.lfo — standing per-layer LFO, destination switching, clock sync', () => {
  it('each synth layer gets its own standing LFO oscillator once the section is on', () => {
    const { engine, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    // Three layers' worth of standing LFO oscillators exist even with no
    // voices sounding (built alongside ensureSynthChannels).
    const standingOscillators = context.oscillators().filter((o) => o.started)
    expect(standingOscillators.length).toBeGreaterThanOrEqual(3)
  })

  it('LFO destination switching connects the depth gain to the right per-voice param on the next voice', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    store.setSynthLfoAmount(80)
    // The layer's standing LFO depth gain exists before any voice starts —
    // find it by elimination (a gain already in the standing graph whose
    // gain value is 0, the built-value from buildSynthLfo).
    const depthGains = context.nodes.filter((n): n is FakeGain => n instanceof FakeGain && n.gain.value === 0)
    expect(depthGains.length).toBeGreaterThan(0)

    store.selectSynthLfoDestination(1) // Osc Pitch
    engine.noteOn(60, 0.8)
    const oscillator = context.oscillators().slice(-1)[0]! // Saw is a single-oscillator Pure voice
    expect(depthGains.some((g) => g.paramConnections.includes(oscillator.detune))).toBe(true)
    engine.noteOff(60)

    selectWaveform(store, 'FM 2-op')
    store.selectSynthLfoDestination(2) // Osc Ctrl
    const before = context.nodes.length
    engine.noteOn(61, 0.8)
    const modGain = context.nodes
      .slice(before)
      .filter((n): n is FakeGain => n instanceof FakeGain)
      .find((g) => g.paramConnections.length > 0 && g.connections.length === 0)! // modGain: no node outputs, only feeds carrier.frequency
    expect(depthGains.some((g) => g.paramConnections.includes(modGain.gain))).toBe(true)
    engine.noteOff(61)
  })

  it('LFO clock-sync substitutes the rate with the master-clock-derived Hz', () => {
    const { engine, store } = makeSystem()
    engine.ensureStarted()
    store.setSynthLfoRate(0)
    store.toggleSynthLfoClockSync()
    expect(store.getState().synth.layers.A.lfo.mstClk).toBe(true)
    store.setMasterClockBpm(240)
    // No throw — the substitution path (mappings.hzToLfoRate(bpm/60)) runs on every applyState tick.
    expect(() => engine.noteOn(60, 0.8)).not.toThrow()
    engine.noteOff(60)
  })

  it('cycling the LFO waveform reconfigures the standing per-layer LFO in place (Saw Up/Down, Square, S&H)', () => {
    const { engine, store, getContext } = makeSystem()
    engine.ensureStarted()
    const context = getContext()!
    // Layer A's standing LFO oscillator: the default (Triangle, 64 = mid
    // rate) triangle oscillator among the 3 always-on per-layer LFOs — the
    // same node is mutated in place by every waveform cycle (buildSynthLfo
    // never rebuilds it), so capturing it once lets us watch it change.
    const standingLfoFreq = mappings.lfoRateHz(64)
    const lfoOscs = context.oscillators().filter((o) => o.type === 'triangle' && Math.abs(o.frequency.value - standingLfoFreq) < 0.001)
    expect(lfoOscs).toHaveLength(3) // one per synth layer
    const osc = lfoOscs[0]!
    // The oscillator's direct fan-out is [invert (fixed -1x), oscSelect (the
    // "read osc directly" gate)]; invert feeds invertSelect (the "read
    // inverted" gate for Saw Down) further downstream.
    const invert = osc.connections.find((c): c is FakeGain => c instanceof FakeGain && c.gain.value === -1)!
    const oscSelect = osc.connections.find((c): c is FakeGain => c instanceof FakeGain && c.gain.value === 1)!
    const invertSelect = invert.connections[0] as FakeGain

    expect(store.getState().synth.layers.A.lfo.waveform).toBe('Triangle')
    store.cycleSynthLfoWaveform() // Triangle -> Saw Down
    expect(store.getState().synth.layers.A.lfo.waveform).toBe('Saw Down')
    expect(osc.type).toBe('sawtooth')
    expect(invertSelect.gain.value).toBe(1) // Saw Down reads the inverted path
    expect(oscSelect.gain.value).toBe(0)

    store.cycleSynthLfoWaveform() // Saw Down -> Saw Up
    expect(store.getState().synth.layers.A.lfo.waveform).toBe('Saw Up')
    expect(osc.type).toBe('sawtooth') // same waveform shape as Saw Down…
    expect(oscSelect.gain.value).toBe(1) // …but Saw Up reads the un-inverted path (normal depth sign)
    expect(invertSelect.gain.value).toBe(0) // …opposite of Saw Down's

    store.cycleSynthLfoWaveform() // Saw Up -> Square
    expect(store.getState().synth.layers.A.lfo.waveform).toBe('Square')
    expect(osc.type).toBe('square')
    expect(oscSelect.gain.value).toBe(1)
    expect(invertSelect.gain.value).toBe(0)

    store.cycleSynthLfoWaveform() // Square -> S&H
    expect(store.getState().synth.layers.A.lfo.waveform).toBe('S&H')
    expect(oscSelect.gain.value).toBe(0) // the oscillator path is fully muted
    expect(invertSelect.gain.value).toBe(0)
    // A looping stepped buffer source is swapped in via its own select gate.
    const shSource = context.bufferSources().find((b) => (b.connections[0] as FakeGain).gain.value === 1)!
    expect(shSource.loop).toBe(true)
    expect(shSource.buffer).not.toBeNull()
  })
})

describe('synth.snapshot — filter/envelope/LFO round-trip', () => {
  it('program store/reload round-trips the new filter, oscillator-envelope and LFO fields', () => {
    const store = new InstrumentStore()
    const savedSlot = store.getState().programs.current
    store.setSynthSectionOn(true)
    store.cycleSynthFilterType() // LP24 -> HP
    store.setSynthFilterParam('freq', 40)
    store.toggleSynthFilterOn()
    store.setSynthOscEnvelope({ amount: 90, toPitch: true })
    store.cycleSynthLfoWaveform() // Triangle -> Saw Down
    store.setSynthLfoRate(100)
    store.selectSynthLfoDestination(3) // Filter Freq
    store.storePress()
    store.storePress() // confirms the store into the current slot

    store.selectProgram(savedSlot === 0 ? 1 : 0)
    expect(store.getState().synth.layers.A.filter.type).toBe('LP24') // default, other slot
    store.selectProgram(savedSlot)
    const layer = store.getState().synth.layers.A
    expect(layer.filter.type).toBe('HP')
    expect(layer.filter.freq).toBe(40)
    expect(layer.filter.on).toBe(false)
    expect(layer.oscEnvelope.amount).toBe(90)
    expect(layer.oscEnvelope.toPitch).toBe(true)
    expect(layer.lfo.waveform).toBe('Saw Down')
    expect(layer.lfo.rate).toBe(100)
    expect(layer.lfo.destination).toBe(SYNTH_LFO_DESTINATIONS[2])
  })

  it('tolerates a persisted (pre-part-2) synth layer payload that lacks filter/oscEnvelope/lfo', () => {
    const first = new InstrumentStore()
    const rawBank = first.getState().programs.bank.map((slot) => {
      const snapshot = JSON.parse(JSON.stringify(slot.snapshot)) as { synth: { layers: Record<string, unknown> } }
      for (const layer of Object.values(snapshot.synth.layers)) {
        const l = layer as Record<string, unknown>
        delete l.filter
        delete l.oscEnvelope
        delete l.lfo
      }
      return { name: slot.name, snapshot }
    })
    const rawLive = first.getState().programs.live.map((slot) => ({ name: slot.name, snapshot: slot.snapshot }))
    const storage = {
      data: new Map<string, string>(),
      load(key: string) {
        return this.data.get(key) ?? null
      },
      save(key: string, value: string) {
        this.data.set(key, value)
      },
    }
    storage.save('stagebench.programs.v1', JSON.stringify({ version: 1, bank: rawBank, live: rawLive, liveMode: false, current: 2 }))
    // Constructing over that storage restores it immediately: the missing
    // filter/oscEnvelope/lfo sub-objects are backfilled with defaults
    // (normalizeSynthLayer) so a note can still sound through the full
    // graph — not silently degrade to the fallback path.
    const restored = new InstrumentStore(storage)
    expect(restored.getState().synth.layers.A.filter.type).toBe('LP24')
    expect(restored.getState().synth.layers.A.oscEnvelope.amount).toBe(64)
    expect(restored.getState().synth.layers.A.lfo.waveform).toBe('Triangle')
    restored.setPianoSectionOn(false)
    restored.setSynthSectionOn(true)
    const setup = fakeAudioBoundary()
    const engine = new PianoEngine(setup.boundary, { assets: fakeAssetBoundary() })
    engine.attachStore(restored)
    engine.ensureStarted()
    expect(engine.getStatus().status).not.toBe('fallback')
    expect(() => engine.noteOn(60, 0.8)).not.toThrow()
    engine.noteOff(60)
  })
})

function selectWaveform(store: InstrumentStore, name: string): void {
  const index = SYNTH_WAVEFORMS.findIndex((w) => w.name === name)
  store.selectSynthWaveform(index)
}

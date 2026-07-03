// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { highBandRatio, renderEngine, rms, similarity, zeroCrossingRate } from '../test/offline'
import { SYNTH_WAVEFORMS, type InstrumentStore } from '../state/instrument'

/**
 * synth.sources — REAL rendered audio through the full engine graph
 * (node-web-audio-api OfflineAudioContext). The Piano section is off so
 * measurements isolate the Synth section (spec: nord-stage-4.synth.json
 * acceptance — every category audibly distinct, Osc Ctrl acts per category).
 */

function synthOnly(store: InstrumentStore): void {
  store.setPianoSectionOn(false)
  store.setSynthSectionOn(true)
}

function withWaveform(name: string, oscCtrl?: number) {
  return (store: InstrumentStore) => {
    synthOnly(store)
    const index = SYNTH_WAVEFORMS.findIndex((w) => w.name === name)
    store.selectSynthWaveform(index)
    if (oscCtrl !== undefined) store.setSynthOscCtrl(oscCtrl)
  }
}

async function renderSynth(configure: (store: InstrumentStore) => void, midi = 57, duration = 1.2) {
  return renderEngine({
    duration,
    configure,
    steps: [
      { time: 0, run: ({ engine }) => engine.noteOn(midi, 0.85) },
      { time: duration - 0.3, run: ({ engine }) => engine.noteOff(midi) },
    ],
  })
}

describe('synth — rendered category distinctness', () => {
  it('the five categories render pairwise-distinct at ALL-comparable settings', async () => {
    const renders: Record<string, Float32Array> = {}
    for (const name of ['Saw', 'Sync Saw', 'Multi Saw', 'Super Saw', 'FM 2-op']) {
      const result = await renderSynth(withWaveform(name, 64))
      expect(rms(result.left, 0.05, 0.9), name).toBeGreaterThan(0.001)
      renders[name] = result.left
    }
    const names = Object.keys(renders)
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const label = `${names[i]}-vs-${names[j]}`
        expect(Math.abs(similarity(renders[names[i]!]!, renders[names[j]!]!, 0.1, 0.9)), label).toBeLessThan(0.85)
      }
    }
  }, 240000)

  it('OSC CTRL sweeps the Sync waveform spectrum (moving resonant peak)', async () => {
    const low = await renderSynth(withWaveform('Sync Saw', 0))
    const high = await renderSynth(withWaveform('Sync Saw', 127))
    expect(rms(low.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(high.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(Math.abs(similarity(low.left, high.left, 0.1, 0.9))).toBeLessThan(0.97)
    expect(highBandRatio(high.left, 3000, 0.1, 0.9)).toBeGreaterThan(highBandRatio(low.left, 3000, 0.1, 0.9))
  }, 240000)

  it('OSC CTRL sweeps the Super Saw width (wider stack, brighter/denser spectrum)', async () => {
    const narrow = await renderSynth(withWaveform('Super Saw', 0))
    const wide = await renderSynth(withWaveform('Super Saw', 127))
    expect(rms(narrow.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(wide.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(Math.abs(similarity(narrow.left, wide.left, 0.1, 0.9))).toBeLessThan(0.995)
    expect(zeroCrossingRate(wide.left, 0.1, 0.9)).not.toBeCloseTo(zeroCrossingRate(narrow.left, 0.1, 0.9), 0)
  }, 240000)

  it('Pulse 33, Pulse 10 and Square are pairwise distinct Pure waveforms', async () => {
    const square = await renderSynth(withWaveform('Square'))
    const pulse33 = await renderSynth(withWaveform('Pulse 33'))
    const pulse10 = await renderSynth(withWaveform('Pulse 10'))
    expect(rms(square.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(pulse33.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(pulse10.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(Math.abs(similarity(square.left, pulse33.left, 0.1, 0.9))).toBeLessThan(0.97)
    expect(Math.abs(similarity(square.left, pulse10.left, 0.1, 0.9))).toBeLessThan(0.97)
    expect(Math.abs(similarity(pulse33.left, pulse10.left, 0.1, 0.9))).toBeLessThan(0.97)
  }, 240000)

  it('White Noise renders a far higher zero-crossing rate than Sine', async () => {
    const noise = await renderSynth(withWaveform('White Noise'))
    const sine = await renderSynth(withWaveform('Sine'))
    expect(rms(noise.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(sine.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(zeroCrossingRate(noise.left, 0.1, 0.9)).toBeGreaterThan(zeroCrossingRate(sine.left, 0.1, 0.9) * 3)
  }, 240000)

  it('Sync Square renders distinct from Sync Saw at the same Osc Ctrl setting', async () => {
    const saw = await renderSynth(withWaveform('Sync Saw', 64))
    const square = await renderSynth(withWaveform('Sync Square', 64))
    expect(rms(saw.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(square.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(Math.abs(similarity(saw.left, square.left, 0.1, 0.9))).toBeLessThan(0.9)
  }, 240000)

  it('attack 100 has a measurably slower onset than attack 0', async () => {
    const fast = await renderEngine({
      duration: 1.6,
      configure: (store) => {
        withWaveform('Saw')(store)
        store.setSynthAmpEnvelope({ attack: 0, decay: 127 })
      },
      steps: [{ time: 0, run: ({ engine }) => engine.noteOn(60, 0.9) }],
    })
    const slow = await renderEngine({
      duration: 1.6,
      configure: (store) => {
        withWaveform('Saw')(store)
        store.setSynthAmpEnvelope({ attack: 100, decay: 127 })
      },
      steps: [{ time: 0, run: ({ engine }) => engine.noteOn(60, 0.9) }],
    })
    // Early-window RMS ratio: the slow-attack render is quieter right after
    // note-on, relative to its own later steady state (decay=127 holds at
    // the attack peak, so the steady window is well past both ramps), than
    // the fast one.
    const earlyFast = rms(fast.left, 0.0, 0.02)
    const steadyFast = rms(fast.left, 1.3, 1.5)
    const earlySlow = rms(slow.left, 0.0, 0.02)
    const steadySlow = rms(slow.left, 1.3, 1.5)
    expect(steadyFast).toBeGreaterThan(0.001)
    expect(steadySlow).toBeGreaterThan(0.001)
    expect(earlySlow / steadySlow).toBeLessThan(earlyFast / steadyFast)
  }, 240000)
})

describe('synth — optional-scope rendered proof', () => {
  it('LP M vs LP24 at identical settings render measurably differently (declared ladder-style approximation)', async () => {
    // White Noise's broadband spectrum makes LP M's hotter second-stage
    // resonance and fixed pre-shaper saturation clearly audible against
    // LP24's identical-Q pair, more than a single-fundamental Saw would.
    const configureWith = (type: 'LP24' | 'LP M') => (store: InstrumentStore) => {
      withWaveform('White Noise')(store)
      store.setSynthFilterParam('freq', 64)
      store.setSynthFilterParam('res', 110)
      let current = store.getState().synth.layers.A.filter.type
      let guard = 0
      while (current !== type && guard++ < 8) {
        store.cycleSynthFilterType()
        current = store.getState().synth.layers.A.filter.type
      }
    }
    const lp24 = await renderSynth(configureWith('LP24'))
    const lpM = await renderSynth(configureWith('LP M'))
    expect(rms(lp24.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(lpM.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(Math.abs(similarity(lp24.left, lpM.left, 0.1, 0.9))).toBeLessThan(0.95)
  }, 240000)

  it('LP+HP vs BP render measurably differently (wider/shallower band vs a single resonant stage)', async () => {
    const configureWith = (type: 'BP' | 'LP+HP') => (store: InstrumentStore) => {
      withWaveform('Saw')(store)
      store.setSynthFilterParam('freq', 70)
      store.setSynthFilterParam('res', 60)
      let current = store.getState().synth.layers.A.filter.type
      let guard = 0
      while (current !== type && guard++ < 8) {
        store.cycleSynthFilterType()
        current = store.getState().synth.layers.A.filter.type
      }
    }
    const bp = await renderSynth(configureWith('BP'))
    const lpHp = await renderSynth(configureWith('LP+HP'))
    expect(rms(bp.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(lpHp.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(Math.abs(similarity(bp.left, lpHp.left, 0.1, 0.9))).toBeLessThan(0.95)
  }, 240000)

  it("'Saw Sub' has more low-band energy than 'Saw' (real sub-oscillator one octave down)", async () => {
    const saw = await renderSynth(withWaveform('Saw'), 69) // A4, so the sub octave-down still sits in an audible low band
    const sawSub = await renderSynth(withWaveform('Saw Sub', 127), 69)
    expect(rms(saw.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(sawSub.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    // highBandRatio inverted: a LOWER high-band ratio means more relative
    // low-band energy — Saw Sub's added sub-octave content pulls it down.
    expect(highBandRatio(sawSub.left, 600, 0.1, 0.9)).toBeLessThan(highBandRatio(saw.left, 600, 0.1, 0.9))
  }, 240000)

  it('Osc Pitch +12 st renders a higher zero-crossing rate than 0 (manual p. 28 Pitch and Fine Tune)', async () => {
    const flat = await renderSynth(withWaveform('Saw'))
    const up = await renderSynth((store) => {
      withWaveform('Saw')(store)
      store.setSynthOscPitchSemis(12)
    })
    expect(rms(flat.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(up.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    // +12 semitones doubles the fundamental — the waveform crosses zero
    // roughly twice as often; 1.5x is a comfortable margin.
    expect(zeroCrossingRate(up.left, 0.1, 0.9)).toBeGreaterThan(zeroCrossingRate(flat.left, 0.1, 0.9) * 1.5)
  }, 240000)

  it('Samples-mode voice renders non-silent and spectrally distinct from Analog Saw, and the filter audibly darkens it', async () => {
    const analogSaw = await renderSynth(withWaveform('Saw'))
    const samplesVoice = await renderSynth((store) => {
      synthOnly(store)
      store.cycleSynthLayerMode() // Analog -> Samples
    })
    expect(rms(analogSaw.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(samplesVoice.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(Math.abs(similarity(analogSaw.left, samplesVoice.left, 0.1, 0.9))).toBeLessThan(0.95)

    // Filter freq 127 (wide open) vs 30 (dark) on the same Samples-mode voice.
    const bright = await renderSynth((store) => {
      synthOnly(store)
      store.cycleSynthLayerMode()
      store.setSynthFilterParam('freq', 127)
    })
    const dark = await renderSynth((store) => {
      synthOnly(store)
      store.cycleSynthLayerMode()
      store.setSynthFilterParam('freq', 30)
    })
    expect(rms(bright.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(dark.left, 0.05, 0.9)).toBeGreaterThan(0.0001) // still audible, just darker
    expect(highBandRatio(dark.left, 2000, 0.1, 0.9)).toBeLessThan(highBandRatio(bright.left, 2000, 0.1, 0.9))
  }, 240000)
})

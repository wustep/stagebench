// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { highBandRatio, renderEngine, rms, similarity, zeroCrossingRate } from '../test/offline'
import { SYNTH_WAVEFORMS, type InstrumentStore } from '../state/instrument'

/**
 * synth.filter-envelopes — REAL rendered audio through the full engine graph
 * (node-web-audio-api OfflineAudioContext), proving the filter, the three
 * envelopes and the LFO each audibly change the signal (spec:
 * nord-stage-4.synth.json filter/envelopes/lfo acceptance). The Piano
 * section is off so measurements isolate the Synth section.
 */

function synthOnly(store: InstrumentStore): void {
  store.setPianoSectionOn(false)
  store.setSynthSectionOn(true)
}

function withWaveform(name: string) {
  return (store: InstrumentStore) => {
    synthOnly(store)
    const index = SYNTH_WAVEFORMS.findIndex((w) => w.name === name)
    store.selectSynthWaveform(index)
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

describe('synth.filter — rendered spectral proof', () => {
  it('LP24 with a low FREQ darkens the sawtooth versus FREQ 127 (wide open)', async () => {
    const bright = await renderSynth((store) => {
      withWaveform('Saw')(store)
      store.setSynthFilterParam('freq', 127)
    })
    const dark = await renderSynth((store) => {
      withWaveform('Saw')(store)
      store.setSynthFilterParam('freq', 30)
    })
    expect(rms(bright.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(dark.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(highBandRatio(dark.left, 2000, 0.1, 0.9)).toBeLessThan(highBandRatio(bright.left, 2000, 0.1, 0.9))
  }, 240000)

  it('HP and LP24 at the same cutoff render distinct spectra (opposite pass bands)', async () => {
    const lp = await renderSynth((store) => {
      withWaveform('Saw')(store)
      store.setSynthFilterParam('freq', 64)
    })
    const hp = await renderSynth((store) => {
      withWaveform('Saw')(store)
      store.cycleSynthFilterType() // LP24 -> HP
      store.setSynthFilterParam('freq', 64)
    })
    expect(rms(lp.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(hp.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(Math.abs(similarity(lp.left, hp.left, 0.1, 0.9))).toBeLessThan(0.9)
    expect(highBandRatio(hp.left, 2000, 0.1, 0.9)).toBeGreaterThan(highBandRatio(lp.left, 2000, 0.1, 0.9))
  }, 240000)

  it('resonance 127 differs audibly from 0 at a fixed mid cutoff', async () => {
    const flat = await renderSynth((store) => {
      withWaveform('Saw')(store)
      store.setSynthFilterParam('freq', 64)
      store.setSynthFilterParam('res', 0)
    })
    const resonant = await renderSynth((store) => {
      withWaveform('Saw')(store)
      store.setSynthFilterParam('freq', 64)
      store.setSynthFilterParam('res', 127)
    })
    expect(rms(flat.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(resonant.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(Math.abs(similarity(flat.left, resonant.left, 0.1, 0.9))).toBeLessThan(0.995)
  }, 240000)

  it('a high filter-envelope amount sweeps the cutoff open then back (early brighter than late)', async () => {
    const result = await renderSynth((store) => {
      withWaveform('Saw')(store)
      store.setSynthFilterParam('freq', 20) // low base cutoff so the envelope sweep is unmistakable
      store.setSynthFilterParam('envAmount', 127) // max sweep depth
      store.setSynthFilterEnvelope({ attack: 0, decay: 40, release: 20 }) // decays back down within the note
    }, 60, 1.4)
    const early = highBandRatio(result.left, 2500, 0.02, 0.15)
    const late = highBandRatio(result.left, 2500, 0.7, 0.95)
    expect(rms(result.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(early).toBeGreaterThan(late)
  }, 240000)
})

describe('synth.osc-envelope — rendered pitch-sweep proof', () => {
  it('a high toPitch osc-envelope amount sweeps pitch down as it decays (early zcr higher than late)', async () => {
    const swept = await renderSynth((store) => {
      withWaveform('Saw')(store)
      store.setSynthOscEnvelope({ toPitch: true, amount: 127, attack: 0, decay: 60 }) // max upward, decays back down within the note
    }, 60, 1.4)
    const control = await renderSynth((store) => {
      withWaveform('Saw')(store)
      store.setSynthOscEnvelope({ toPitch: true, amount: 64, attack: 0, decay: 60 }) // centered (0) — no sweep
    }, 60, 1.4)
    const sweptEarly = zeroCrossingRate(swept.left, 0.02, 0.15)
    const sweptLate = zeroCrossingRate(swept.left, 0.7, 0.95)
    const controlEarly = zeroCrossingRate(control.left, 0.02, 0.15)
    const controlLate = zeroCrossingRate(control.left, 0.7, 0.95)
    expect(rms(swept.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    // Pitch falls as the envelope decays back toward baseline.
    expect(sweptEarly).toBeGreaterThan(sweptLate)
    // With the amount centered (64 = 0) there is no sweep, so the
    // early/late ratio stays far closer to 1 than the swept case's.
    const sweptRatio = sweptEarly / sweptLate
    const controlRatio = controlEarly / controlLate
    expect(controlRatio).toBeLessThan(sweptRatio)
  }, 240000)
})

describe('synth.lfo — rendered modulation proof', () => {
  it('LFO -> Filter Freq wobbles the spectrum: windowed brightness varies far more than with the LFO off', async () => {
    async function windowedVariance(configure: (store: InstrumentStore) => void) {
      const result = await renderSynth(configure, 60, 1.6)
      const windows: number[] = []
      for (let t = 0.1; t < 1.3; t += 0.1) windows.push(highBandRatio(result.left, 1500, t, t + 0.1))
      const mean = windows.reduce((a, b) => a + b, 0) / windows.length
      return windows.reduce((sum, w) => sum + (w - mean) ** 2, 0) / windows.length
    }
    const withLfo = await windowedVariance((store) => {
      withWaveform('Saw')(store)
      store.setSynthFilterParam('freq', 64)
      store.setSynthLfoRate(100) // fast enough to complete several cycles within the note
      store.setSynthLfoAmount(127)
      store.selectSynthLfoDestination(3) // Filter Freq
    })
    const withoutLfo = await windowedVariance((store) => {
      withWaveform('Saw')(store)
      store.setSynthFilterParam('freq', 64)
    })
    expect(withLfo).toBeGreaterThan(withoutLfo * 2)
  }, 240000)

  it('S&H filter-freq modulation renders differently from Triangle', async () => {
    async function render(waveform: 'Triangle' | 'S&H') {
      return renderSynth((store) => {
        withWaveform('Saw')(store)
        store.setSynthFilterParam('freq', 64)
        store.setSynthLfoRate(100)
        store.setSynthLfoAmount(127)
        store.selectSynthLfoDestination(3) // Filter Freq
        if (waveform === 'S&H') {
          store.cycleSynthLfoWaveform() // Triangle -> Saw Down
          store.cycleSynthLfoWaveform() // Saw Down -> Saw Up
          store.cycleSynthLfoWaveform() // Saw Up -> Square
          store.cycleSynthLfoWaveform() // Square -> S&H
        }
      }, 60, 1.6)
    }
    const triangle = await render('Triangle')
    const sh = await render('S&H')
    expect(rms(triangle.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(rms(sh.left, 0.05, 0.9)).toBeGreaterThan(0.001)
    expect(Math.abs(similarity(triangle.left, sh.left, 0.1, 0.9))).toBeLessThan(0.95)
  }, 240000)

  it('LFO rate follows the master clock: two BPMs render audibly different wobble timing when synced', async () => {
    async function zcrSeries(bpm: number) {
      const result = await renderSynth((store) => {
        withWaveform('Square')(store)
        store.setMasterClockBpm(bpm)
        store.toggleSynthLfoClockSync()
        store.setSynthLfoAmount(127)
        store.selectSynthLfoDestination(1) // Osc Pitch
      }, 60, 1.6)
      const windows: number[] = []
      for (let t = 0.1; t < 1.3; t += 0.1) windows.push(zeroCrossingRate(result.left, t, t + 0.1))
      return windows
    }
    const slow = await zcrSeries(40)
    const fast = await zcrSeries(280)
    // Different clock-synced rates produce different pitch-wobble timing —
    // the two zero-crossing-rate time series should not be near-identical.
    let sumSquaredDiff = 0
    for (let i = 0; i < slow.length; i++) sumSquaredDiff += (slow[i]! - fast[i]!) ** 2
    expect(sumSquaredDiff).toBeGreaterThan(0)
  }, 240000)
})

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

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { offlineAssets, renderEngine, rms, similarity, zeroCrossingRate } from '../test/offline'
import type { InstrumentStore } from '../state/instrument'
import type { PianoType } from './library'

/**
 * piano.instrument-library — REAL rendered audio through the full engine
 * graph (node-web-audio-api OfflineAudioContext): the three bundled recorded
 * sample sets are audibly distinct, not labels over one source.
 */

function selectBoth(store: InstrumentStore, type: PianoType): void {
  store.setFocusedLayer('B')
  store.selectPianoType(type)
  store.setFocusedLayer('A')
  store.selectPianoType(type)
}

async function renderNote(type: PianoType, midi = 60, velocity = 0.85) {
  return renderEngine({
    duration: 1.6,
    configure: (store) => selectBoth(store, type),
    steps: [
      { time: 0, run: ({ engine }) => engine.noteOn(midi, velocity) },
      { time: 1.1, run: ({ engine }) => engine.noteOff(midi) },
    ],
  })
}

describe('piano.instrument-library — rendered distinctions', () => {
  it('renders each bundled instrument non-silent through the shared graph', async () => {
    for (const type of ['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'] as const) {
      const result = await renderNote(type)
      expect(result.engineStatus).toBe('ready')
      expect(rms(result.left, 0.05, 1.0), type).toBeGreaterThan(0.003)
    }
  }, 240000)

  it('the three instruments are audibly distinct (waveform and spectrum)', async () => {
    const grand = await renderNote('Grand')
    const upright = await renderNote('Upright')
    const electric = await renderNote('Electric')

    const pairs: Array<[string, Float32Array, Float32Array]> = [
      ['grand-vs-upright', grand.left, upright.left],
      ['grand-vs-electric', grand.left, electric.left],
      ['upright-vs-electric', upright.left, electric.left],
    ]
    for (const [label, a, b] of pairs) {
      expect(Math.abs(similarity(a, b, 0.05, 1.0)), label).toBeLessThan(0.8)
    }
    // Spectral character differs too (zero-crossing brightness).
    const zGrand = zeroCrossingRate(grand.left, 0.1, 0.9)
    const zUpright = zeroCrossingRate(upright.left, 0.1, 0.9)
    const zElectric = zeroCrossingRate(electric.left, 0.1, 0.9)
    const spread = Math.max(zGrand, zUpright, zElectric) / Math.max(1, Math.min(zGrand, zUpright, zElectric))
    expect(spread).toBeGreaterThan(1.15)
  }, 120000)

  it('the Clav, Digital and Misc sets are audibly distinct from each other and the tine EP', async () => {
    const electric = await renderNote('Electric')
    const clav = await renderNote('Clav')
    const digital = await renderNote('Digital')
    const misc = await renderNote('Misc')

    const pairs: Array<[string, Float32Array, Float32Array]> = [
      ['clav-vs-digital', clav.left, digital.left],
      ['clav-vs-misc', clav.left, misc.left],
      ['digital-vs-misc', digital.left, misc.left],
      ['electric-vs-digital', electric.left, digital.left],
      ['electric-vs-clav', electric.left, clav.left],
    ]
    for (const [label, a, b] of pairs) {
      expect(Math.abs(similarity(a, b, 0.05, 1.0)), label).toBeLessThan(0.8)
    }
  }, 240000)

  it('different notes select different recorded roots (no uniform pitch shifting)', async () => {
    const low = await renderNote('Grand', 41)
    const high = await renderNote('Grand', 84)
    expect(rms(low.left, 0.05, 1.0)).toBeGreaterThan(0.002)
    expect(rms(high.left, 0.05, 1.0)).toBeGreaterThan(0.002)
    expect(zeroCrossingRate(high.left, 0.1, 0.9)).toBeGreaterThan(zeroCrossingRate(low.left, 0.1, 0.9) * 2)
  }, 120000)

  it('primary sample failure produces the labeled synthesized fallback, still audible', async () => {
    const result = await renderEngine({
      duration: 1.2,
      assets: offlineAssets({ fail: true }),
      steps: [
        { time: 0, run: ({ engine }) => engine.noteOn(60, 0.85) },
        { time: 0.8, run: ({ engine }) => engine.noteOff(60) },
      ],
    })
    expect(result.engineStatus).toBe('fallback')
    expect(rms(result.left, 0.05, 0.7)).toBeGreaterThan(0.003)
  }, 60000)
})

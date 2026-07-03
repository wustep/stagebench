// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderEngine, rms } from '../test/offline'
import type { InstrumentStore } from '../state/instrument'

/**
 * organ.engine (shared effects chain) — REAL rendered audio proving the
 * organ path actually flows through the shared organ effect chain (manual
 * p. 18), not just that state fields exist.
 */

function organOnly(store: InstrumentStore): void {
  store.setPianoSectionOn(false)
  store.setOrganSectionOn(true)
}

async function renderOrgan(configure: (store: InstrumentStore) => void, duration = 2.2, noteOffAt = 0.9) {
  return renderEngine({
    duration,
    configure,
    steps: [
      { time: 0, run: ({ engine }) => engine.noteOn(60, 0.85) },
      { time: noteOffAt, run: ({ engine }) => engine.noteOff(60) },
    ],
  })
}

/** Amplitude fluctuation: max/min RMS across small windows (tremolo depth). */
function fluctuation(data: Float32Array, from: number, to: number, windowSeconds = 0.05): number {
  const values: number[] = []
  for (let t = from; t + windowSeconds <= to; t += windowSeconds) values.push(rms(data, t, t + windowSeconds))
  return Math.max(...values) / Math.max(1e-9, Math.min(...values))
}

describe('organ-chain — rendered behavior', () => {
  it('the organ through the shared chain Reverb (Hall, mix 100) has a longer post-noteOff tail than dry', async () => {
    const dry = await renderOrgan((store) => {
      organOnly(store)
      store.toggleOrganLayerEnabled('B') // moves FX focus to the shared organ chain
    })
    const wet = await renderOrgan((store) => {
      organOnly(store)
      store.toggleOrganLayerEnabled('B')
      // The chain's default reverb type is already Hall (defaultChain()).
      store.updateUnit('reverb', { mix: 100 })
      store.toggleUnitOn('reverb')
    })
    expect(wet.left).not.toBe(dry.left)
    // Measure a short window right after note-off: the wet render should
    // still be sounding (reverb tail) well past where the dry note has decayed.
    const dryTail = rms(dry.left, 1.1, 1.5)
    const wetTail = rms(wet.left, 1.1, 1.5)
    expect(wetTail).toBeGreaterThan(dryTail * 2)
  }, 240000)

  it('the organ through the shared chain Mod 1 Tremolo (amount 127) modulates the sounding amplitude', async () => {
    const dry = await renderOrgan((store) => {
      organOnly(store)
      store.toggleOrganLayerEnabled('B')
    })
    const wet = await renderOrgan((store) => {
      organOnly(store)
      store.toggleOrganLayerEnabled('B')
      store.updateUnit('mod1', { type: 'Tremolo', rate: 80, amount: 127 })
      store.toggleUnitOn('mod1')
    })
    expect(fluctuation(wet.left, 0.1, 0.8)).toBeGreaterThan(fluctuation(dry.left, 0.1, 0.8) * 1.3)
  }, 240000)
})

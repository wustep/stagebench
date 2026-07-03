// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderEngine, rms, similarity, zeroCrossingRate } from '../test/offline'
import type { InstrumentStore } from '../state/instrument'

/**
 * system.clock-transpose — rendered proof that Transpose audibly shifts
 * sounding pitch and the clock-synced Delay time audibly follows the BPM.
 */
describe('system.clock-transpose — rendered', () => {
  it('transpose audibly shifts pitch up', async () => {
    const render = (transpose: boolean) =>
      renderEngine({
        duration: 1.0,
        configure: (store: InstrumentStore) => {
          store.setPianoSectionOn(false)
          store.setOrganSectionOn(true)
          if (transpose) {
            store.setTransposeSemitones(6)
            store.toggleTranspose()
          }
        },
        steps: [
          { time: 0, run: ({ engine }) => engine.noteOn(60, 0.9) },
          { time: 0.7, run: ({ engine }) => engine.noteOff(60) },
        ],
      })
    const plain = await render(false)
    const transposed = await render(true)
    expect(rms(plain.left, 0.05, 0.7)).toBeGreaterThan(0.003)
    expect(rms(transposed.left, 0.05, 0.7)).toBeGreaterThan(0.003)
    expect(zeroCrossingRate(transposed.left, 0.1, 0.6)).toBeGreaterThan(zeroCrossingRate(plain.left, 0.1, 0.6) * 1.2)
  }, 120000)

  it('clock-synced delay time follows the BPM audibly', async () => {
    const render = (bpm: number) =>
      renderEngine({
        duration: 1.8,
        configure: (store: InstrumentStore) => {
          store.updateUnit('delay', { on: true, mix: 100, feedback: 90 } as never)
          store.toggleDelayClockSync()
          store.setMasterClockBpm(bpm)
        },
        steps: [
          { time: 0, run: ({ engine }) => engine.noteOn(60, 0.9) },
          { time: 0.15, run: ({ engine }) => engine.noteOff(60) },
        ],
      })
    const a = await render(300)
    const b = await render(60)
    expect(rms(a.left, 0.05, 1.6)).toBeGreaterThan(0.0005)
    expect(rms(b.left, 0.05, 1.6)).toBeGreaterThan(0.0005)
    expect(Math.abs(similarity(a.left, b.left, 0.3, 1.6))).toBeLessThan(0.9)
  }, 120000)
})

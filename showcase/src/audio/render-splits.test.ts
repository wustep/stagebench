// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderEngine, rms } from '../test/offline'
import type { InstrumentStore } from '../state/instrument'

/**
 * splits.zones — rendered proof that keyboard zones audibly route notes
 * (spec acceptance: "audibly route notes, not fixed constants").
 */
describe('splits.zones — rendered routing', () => {
  it('a layer zoned to the upper half sounds above the split and stays silent below it', async () => {
    const configure = (store: InstrumentStore) => {
      store.toggleSplit() // single Mid point at C4, hard switch
      // Piano layer A only, assigned to the upper zone.
      while (store.getState().layers.A.zone.from !== 1 || store.getState().layers.A.zone.to !== 1) {
        store.cycleLayerZone('piano', 'A', 1)
      }
    }
    const render = (midi: number) =>
      renderEngine({
        duration: 1.0,
        configure,
        steps: [
          { time: 0, run: ({ engine }) => engine.noteOn(midi, 0.9) },
          { time: 0.7, run: ({ engine }) => engine.noteOff(midi) },
        ],
      })
    const above = await render(72)
    const below = await render(48)
    expect(rms(above.left, 0.05, 0.7)).toBeGreaterThan(0.003)
    expect(rms(below.left, 0.05, 0.7)).toBeLessThan(0.0005)
  }, 120000)

  it('a ±12 crossfade renders the boundary note quieter than the zone center', async () => {
    const configure = (store: InstrumentStore) => {
      store.toggleSplit()
      store.setSplitEdit(true)
      store.cycleSplitXf() // ±6
      store.cycleSplitXf() // ±12
      store.setSplitEdit(false)
      while (store.getState().layers.A.zone.from !== 1 || store.getState().layers.A.zone.to !== 1) {
        store.cycleLayerZone('piano', 'A', 1)
      }
    }
    const render = (midi: number) =>
      renderEngine({
        duration: 1.0,
        configure,
        steps: [
          { time: 0, run: ({ engine }) => engine.noteOn(midi, 0.9) },
          { time: 0.7, run: ({ engine }) => engine.noteOff(midi) },
        ],
      })
    const center = await render(79) // well inside the upper zone
    const boundary = await render(60) // fade midpoint: half level
    expect(rms(boundary.left, 0.05, 0.6)).toBeGreaterThan(0.0005) // still sounds…
    expect(rms(boundary.left, 0.05, 0.6)).toBeLessThan(rms(center.left, 0.05, 0.6) * 0.8) // …but attenuated
  }, 120000)
})

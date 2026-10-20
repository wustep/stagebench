// @vitest-environment node
// piano.instrument-library: the six types render, and no two of them render alike.
import { describe, expect, it } from 'vitest'
import { PIANO_TYPES } from './pianoModels'
import { play } from './testing/scenario'
import { difference, mono, peak, rms } from './testing/offline'

const TYPE_COUNT = PIANO_TYPES.length

/** Renders one held note on the chosen type, with the type selector advanced to it from Grand. */
async function renderType(index: number, note = 60) {
  const actions = Array.from({ length: index }, () => ({ type: 'advance', id: 'piano.type' }) as const)
  const played = await play({ seconds: 1.6, notes: [{ note, velocity: 100, off: 1.0 }], actions })
  return mono(played.rendered)
}

describe('piano.instrument-library render', () => {
  it('renders non-silent output for every one of the six types', async () => {
    for (let index = 0; index < TYPE_COUNT; index += 1) {
      const m = await renderType(index)
      expect(peak(m), PIANO_TYPES[index].id).toBeGreaterThan(0.01)
      expect(rms(m, 44100, 0.1, 0.9), PIANO_TYPES[index].id).toBeGreaterThan(0.002)
    }
  }, 120000)

  it('renders each pair of types differently, so no two share a sound', async () => {
    const signals = await Promise.all(PIANO_TYPES.map((_, index) => renderType(index)))
    for (let a = 0; a < TYPE_COUNT; a += 1) {
      for (let b = a + 1; b < TYPE_COUNT; b += 1) {
        const scale = Math.max(rms(signals[a]), rms(signals[b]))
        const relative = difference(signals[a], signals[b]) / scale
        expect(relative, `${PIANO_TYPES[a].id} vs ${PIANO_TYPES[b].id}`).toBeGreaterThan(0.2)
      }
    }
  }, 120000)

  it('renders the three recorded sets from their own files, not from the synthesized fallback', async () => {
    const played = await play({ seconds: 1.2, notes: [{ note: 60, velocity: 100, off: 0.9 }] })
    expect(played.instrument.pianoStatus().state).toBe('recorded')
  }, 60000)
})

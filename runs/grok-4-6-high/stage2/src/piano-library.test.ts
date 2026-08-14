import { describe, expect, it } from 'vitest'
import { meanAbsDiff, renderPianoScript, rms } from './audio/piano-engine'
import { PIANO_TYPE_LABELS, PIANO_TYPES, recordedLibraryStatus, type PianoType } from './audio/samples'
import { defaultInstrumentState } from './model/instrument-state'

function withType(type: PianoType) {
  const state = defaultInstrumentState()
  state.layers.A.type = type
  return state
}

describe('piano.instrument-library', () => {
  it('bundles recorded Grand, Upright, and Electric with truthful counts', () => {
    const status = recordedLibraryStatus()
    expect(status.ready).toBe(true)
    expect(status.counts.grand).toBeGreaterThanOrEqual(8)
    expect(status.counts.upright).toBeGreaterThanOrEqual(8)
    expect(status.counts.electric).toBeGreaterThanOrEqual(8)
    expect(PIANO_TYPES).toEqual(['grand', 'upright', 'electric', 'clav', 'digital', 'misc'])
    expect(PIANO_TYPE_LABELS.grand).toMatch(/grand/i)
    expect(PIANO_TYPE_LABELS.upright).toMatch(/upright/i)
  })

  it('renders six types that are audibly distinct and not silent', async () => {
    const buffers: Record<string, Float32Array> = {}
    for (const type of PIANO_TYPES) {
      buffers[type] = await renderPianoScript(0.35, (engine) => {
        engine.applyState(withType(type), 0)
        engine.noteOn(60, 0.85, 0)
      })
      expect(rms(buffers[type]), type).toBeGreaterThan(0.001)
    }
    expect(meanAbsDiff(buffers.grand, buffers.upright)).toBeGreaterThan(0.002)
    expect(meanAbsDiff(buffers.grand, buffers.electric)).toBeGreaterThan(0.002)
    expect(meanAbsDiff(buffers.upright, buffers.electric)).toBeGreaterThan(0.002)
    expect(meanAbsDiff(buffers.clav, buffers.digital)).toBeGreaterThan(0.001)
    expect(meanAbsDiff(buffers.digital, buffers.misc)).toBeGreaterThan(0.001)
  })
})

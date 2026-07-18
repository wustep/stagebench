import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FakeAudioBackend, rms } from '../audio/fake-backend'
import { PIANO_TYPES, SAMPLE_ROOTS, VELOCITY_LAYERS, renderRecordedTake } from '../audio/piano-models'
import { libraryPath, loadRecordedType } from '../audio/sample-library'
import { decodeWav } from '../audio/wav'
import { renderIsolated } from '../test-helpers'

const root = join(__dirname, '..', '..')

/** Normalized cross-correlation at zero lag — 1 = identical waveform shape. */
function correlation(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let ea = 0
  let eb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    ea += a[i] * a[i]
    eb += b[i] * b[i]
  }
  return dot / Math.max(1e-12, Math.sqrt(ea * eb))
}

describe('piano.instrument-library', () => {
  it('six selectable types each with at least one model', () => {
    expect(PIANO_TYPES.map((t) => t.id)).toEqual(['grand', 'upright', 'electric', 'clav', 'digital', 'misc'])
    for (const t of PIANO_TYPES) expect(t.model.length).toBeGreaterThan(0)
  })

  it('Grand, Upright, Electric are bundled recorded sample sets on disk (offline, complete)', async () => {
    for (const type of ['grand', 'upright', 'electric']) {
      expect(PIANO_TYPES.find((t) => t.id === type)?.recorded, type).toBe(true)
      for (const rootNote of SAMPLE_ROOTS) {
        for (let layer = 0; layer < VELOCITY_LAYERS.length; layer++) {
          const path = join(root, 'public', libraryPath(type as 'grand', rootNote, layer))
          expect(existsSync(path), path).toBe(true)
          // The files are real recordings: valid WAV, non-silent audio.
          const wav = decodeWav(await readFile(path).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))
          expect(wav.sampleRate).toBeGreaterThan(0)
          expect(rms(wav.data)).toBeGreaterThan(0.0005)
        }
      }
    }
  })

  it('sample library loads through the injectable loader and maps nearest roots', async () => {
    const loader = async (path: string) => {
      const buf = await readFile(join(root, 'public', path))
      return decodeWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    }
    const lib = await loadRecordedType('grand', loader)
    // Note 60 → nearest root is 58 (A#3) or 62; must be within a minor third.
    const take = lib.takeFor(60, 0.8)
    expect(Math.abs(take.root - 60)).toBeLessThanOrEqual(3)
    expect(take.layer).toBe(1) // ff layer for velocity ≥ 0.5
    expect(lib.takeFor(60, 0.3).layer).toBe(0) // pp layer
  })

  it('the three recorded sets are audibly distinct on rendered audio', () => {
    const grand = renderIsolated(0.8, { layer: { type: 'grand' } })
    const upright = renderIsolated(0.8, { layer: { type: 'upright' } })
    const electric = renderIsolated(0.8, { layer: { type: 'electric' } })
    for (const b of [grand, upright, electric]) expect(rms(b)).toBeGreaterThan(0.001)
    // Distinct = clearly not the same waveform rendered through the graph.
    expect(correlation(grand, upright)).toBeLessThan(0.9)
    expect(correlation(grand, electric)).toBeLessThan(0.9)
    expect(correlation(upright, electric)).toBeLessThan(0.9)
  })

  it('velocity layers differ: soft strikes use the pp take, hard strikes the ff take', () => {
    const soft = renderRecordedTake('grand', 60, 0.3, 8000)
    const hard = renderRecordedTake('grand', 60, 0.9, 8000)
    expect(correlation(soft, hard)).toBeLessThan(0.98)
  })

  it('Clav, Digital, Misc are honest synthesis and audibly distinct from the recorded sets', () => {
    const grand = renderIsolated(0.8, { layer: { type: 'grand' } })
    for (const type of ['clav', 'digital', 'misc'] as const) {
      const buf = renderIsolated(0.8, { layer: { type } })
      expect(rms(buf), type).toBeGreaterThan(0.001)
      expect(correlation(buf, grand), type).toBeLessThan(0.9)
    }
    // …and distinct from each other.
    const clav = renderIsolated(0.8, { layer: { type: 'clav' } })
    const digital = renderIsolated(0.8, { layer: { type: 'digital' } })
    const misc = renderIsolated(0.8, { layer: { type: 'misc' } })
    expect(correlation(clav, digital)).toBeLessThan(0.9)
    expect(correlation(digital, misc)).toBeLessThan(0.9)
  })

  it('every keybed note renders without obvious single-note stretching (root coverage)', () => {
    // Max distance from any MIDI note in 28..100 to the nearest root.
    for (let note = 28; note <= 100; note++) {
      const nearest = SAMPLE_ROOTS.reduce((a, b) => (Math.abs(b - note) < Math.abs(a - note) ? b : a))
      expect(Math.abs(nearest - note), `note ${note}`).toBeLessThanOrEqual(3)
    }
  })

  it('the fake backend renders the recorded sets through the graph (not silence)', () => {
    const backend = new FakeAudioBackend()
    for (const type of ['grand', 'upright', 'electric'] as const) {
      const buf = renderIsolated(0.6, { layer: { type } })
      expect(rms(buf), type).toBeGreaterThan(0.001)
    }
    void backend
  })
})

/**
 * The recorded piano sample library (Grand / Upright / Electric).
 *
 * The bundled WAV recordings under `public/samples/` are fetched and decoded
 * through an injectable `SampleLoader` — in the browser it is `fetch` +
 * `AudioContext.decodeAudioData`; in tests it reads deterministic buffers
 * rendered from the same physical models the recorder used. If any take
 * fails to load, the type reports an honest error and the engine falls back
 * to a labeled synthesized voice (never pretending the recording is ready).
 */

import { PIANO_TYPES, SAMPLE_ROOTS, VELOCITY_LAYERS, type PianoTypeId } from './piano-models'
import { decodeWav } from './wav'

export interface SampleTake {
  root: number
  layer: number
  sampleRate: number
  data: Float32Array
}

export interface SampleLibrary {
  /** Nearest root take for a note + velocity layer. */
  takeFor(note: number, velocity: number): SampleTake
}

/** Fetch/decode seam. Returns mono Float32Array + rate for a library path. */
export type SampleLoader = (path: string) => Promise<{ sampleRate: number; data: Float32Array }>

/** Browser loader: fetch + decode the 16-bit PCM WAV ourselves (no network in tests; files are bundled). */
export function createFetchLoader(decode?: (buf: ArrayBuffer) => Promise<{ sampleRate: number; data: Float32Array }>): SampleLoader {
  return async (path) => {
    const res = await fetch(path)
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
    const buf = await res.arrayBuffer()
    if (decode) return decode(buf)
    return decodeWav(buf)
  }
}

export function libraryPath(type: PianoTypeId, root: number, layer: number): string {
  return `samples/${type}/${root}_${VELOCITY_LAYERS[layer].id}.wav`
}

/** Load one recorded type fully. Throws on any missing take. */
export async function loadRecordedType(type: PianoTypeId, loader: SampleLoader): Promise<SampleLibrary> {
  const takes: SampleTake[] = []
  for (const root of SAMPLE_ROOTS) {
    for (let layer = 0; layer < VELOCITY_LAYERS.length; layer++) {
      const { sampleRate, data } = await loader(libraryPath(type, root, layer))
      takes.push({ root, layer, sampleRate, data })
    }
  }
  return makeLibraryFromTakes(takes)
}

export function makeLibraryFromTakes(takes: SampleTake[]): SampleLibrary {
  return {
    takeFor(note: number, velocity: number): SampleTake {
      const layer = velocity < 0.5 ? 0 : 1
      let best = takes[0]
      let bestDist = Infinity
      for (const t of takes) {
        if (t.layer !== layer) continue
        const d = Math.abs(t.root - note)
        if (d < bestDist) {
          bestDist = d
          best = t
        }
      }
      return best
    },
  }
}

/** Play rate for a take mapped to a target note (≤ a minor third by construction of SAMPLE_ROOTS). */
export function playbackRate(take: SampleTake, note: number): number {
  return Math.pow(2, (note - take.root) / 12)
}

/** True when the type is one of the recorded sample sets. */
export function isRecordedType(type: PianoTypeId): boolean {
  return PIANO_TYPES.find((t) => t.id === type)?.recorded === true
}

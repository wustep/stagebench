import type { GraphBuffer, GraphContext } from './graph'
import manifest from './sampleManifest.json'
import { decodeWav } from './wav'

/**
 * The bundled, recorded sample sets.
 *
 * Every file under `public/samples/` is a real recording of a real instrument, produced from a
 * named upstream release by `tools/build-samples.py`; `sampleManifest.json` is that script's
 * output and records the root note, velocity window, length, licence and upstream sample name of
 * every file. Nothing here is generated: the synthesised piano types (Clav, Digital, Misc) and
 * the fallback voice live in `pianoVoice.ts` and are declared as synthesis.
 */

export interface SampleFileSpec {
  readonly file: string
  readonly root: number
  readonly velocityLow: number
  readonly velocityHigh: number
  readonly seconds: number
  readonly pitchClassDriftSemitones: number | null
  readonly sourceSample: string
}

export interface SampleSetSpec {
  readonly id: string
  readonly label: string
  readonly type: string
  readonly source: string
  readonly license: string
  readonly licenseUrl: string
  readonly attribution: string
  readonly url: string
  readonly recorded: boolean
  readonly rootNotes: number
  readonly velocityLayers: number
  readonly maxPitchShiftSemitones: number
  readonly bytes: number
  readonly files: readonly SampleFileSpec[]
}

export interface SampleManifest {
  readonly generatedBy: string
  readonly sampleRate: number
  readonly format: string
  readonly sets: readonly SampleSetSpec[]
}

export const SAMPLE_MANIFEST = manifest as SampleManifest

export type SampleSetId = 'grand' | 'upright' | 'electric'

export const SAMPLE_SET_IDS: readonly SampleSetId[] = ['grand', 'upright', 'electric']

export function sampleSetSpec(id: SampleSetId): SampleSetSpec {
  const found = SAMPLE_MANIFEST.sets.find((set) => set.id === id)
  if (!found) throw new Error(`Unknown sample set: ${id}`)
  return found
}

/** Asset boundary: the browser fetches, tests read the very same files from disk. */
export interface SampleFetcher {
  (url: string): Promise<ArrayBuffer>
}

export const browserSampleFetcher: SampleFetcher = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.arrayBuffer()
}

export interface LoadedSample {
  readonly root: number
  readonly velocityLow: number
  readonly velocityHigh: number
  readonly buffer: GraphBuffer
}

export interface LoadedSet {
  readonly id: SampleSetId
  readonly spec: SampleSetSpec
  readonly samples: readonly LoadedSample[]
}

export interface SampleChoice {
  readonly sample: LoadedSample
  /** Playback rate that transposes the recorded root to the requested note. */
  readonly playbackRate: number
  readonly shiftSemitones: number
}

/**
 * Loads and caches the recorded sets. One instance per audio context; buffers are created on
 * that context so nothing has to be re-decoded when a type is selected twice.
 */
export class SampleLibrary {
  private readonly loaded = new Map<SampleSetId, LoadedSet>()
  private readonly pending = new Map<SampleSetId, Promise<LoadedSet>>()
  private readonly failures = new Map<SampleSetId, string>()

  constructor(
    private readonly context: GraphContext,
    private readonly fetcher: SampleFetcher = browserSampleFetcher,
    private readonly baseUrl = 'samples/',
  ) {}

  get(id: SampleSetId): LoadedSet | null {
    return this.loaded.get(id) ?? null
  }

  failure(id: SampleSetId): string | null {
    return this.failures.get(id) ?? null
  }

  load(id: SampleSetId): Promise<LoadedSet> {
    const ready = this.loaded.get(id)
    if (ready) return Promise.resolve(ready)
    const inFlight = this.pending.get(id)
    if (inFlight) return inFlight
    const spec = sampleSetSpec(id)
    const work = Promise.all(
      spec.files.map(async (file) => {
        const bytes = await this.fetcher(`${this.baseUrl}${id}/${encodeURIComponent(file.file)}`)
        const decoded = decodeWav(bytes)
        const buffer = this.context.createBuffer(
          decoded.channels.length,
          decoded.channels[0].length,
          decoded.sampleRate,
        )
        for (let channel = 0; channel < decoded.channels.length; channel += 1) {
          buffer.getChannelData(channel).set(decoded.channels[channel])
        }
        return {
          root: file.root,
          velocityLow: file.velocityLow,
          velocityHigh: file.velocityHigh,
          buffer,
        } satisfies LoadedSample
      }),
    )
      .then((samples) => {
        const set: LoadedSet = { id, spec, samples }
        this.loaded.set(id, set)
        this.pending.delete(id)
        this.failures.delete(id)
        return set
      })
      .catch((error: unknown) => {
        this.pending.delete(id)
        this.failures.set(id, error instanceof Error ? error.message : String(error))
        throw error
      })
    this.pending.set(id, work)
    return work
  }
}

/**
 * Picks the recorded sample for a note: the velocity layer that covers the stroke, then the
 * closest recorded root inside it, transposed by playback rate.
 */
export function pickSample(set: LoadedSet, midi: number, velocity: number): SampleChoice | null {
  if (set.samples.length === 0) return null
  const midiVelocity = Math.max(1, Math.min(127, Math.round(velocity * 127)))
  const inLayer = set.samples.filter(
    (sample) => midiVelocity >= sample.velocityLow && midiVelocity <= sample.velocityHigh,
  )
  const candidates = inLayer.length > 0 ? inLayer : set.samples
  let best = candidates[0]
  for (const candidate of candidates) {
    if (Math.abs(candidate.root - midi) < Math.abs(best.root - midi)) best = candidate
  }
  const shiftSemitones = midi - best.root
  return { sample: best, playbackRate: Math.pow(2, shiftSemitones / 12), shiftSemitones }
}

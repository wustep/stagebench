// Loads the bundled recorded sample sets and picks the zone for each note and velocity.
//
// Each set is a manifest (public/samples/<set>/manifest.json) listing one file per root note and
// velocity layer. Loading is per set and cached per AudioContext. A failed load is reported as
// `failed`; the caller then plays the labelled synthesized fallback. Nothing here plays audio.

import type { AudioBufferLike, AudioContextLike } from './audioBoundary'
import type { SampleSetId } from './pianoModels'

export interface ManifestZone {
  file: string
  root: number
  cents: number
  lovel: number
  hivel: number
  loopStart: number | null
  loopEnd: number | null
  frames?: number
  sampleRate?: number
  source?: string
}

export interface SampleSetManifest {
  id: SampleSetId
  label: string
  set: string
  license: string
  licenseNotice: string
  licenseFile: string
  zones: ManifestZone[]
}

export interface LoadedZone extends ManifestZone {
  buffer: AudioBufferLike
}

export interface LoadedSampleSet {
  id: SampleSetId
  manifest: SampleSetManifest
  zones: LoadedZone[]
}

export type SampleSetState = 'idle' | 'loading' | 'ready' | 'failed'

export interface SampleSetStatus {
  state: SampleSetState
  message: string
}

export interface SampleLoader {
  /** Fetches a URL relative to the app base and returns its bytes. Rejects on a non-2xx response. */
  fetchBytes(path: string): Promise<ArrayBuffer>
}

/** Default loader: fetch relative to the page, so the build works from any folder (base './'). */
export function browserSampleLoader(): SampleLoader {
  return {
    async fetchBytes(path) {
      const response = await fetch(new URL(path, document.baseURI).toString())
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${path}`)
      }
      return response.arrayBuffer()
    },
  }
}

const MAX_PARALLEL_DECODES = 8

export class SampleLibrary {
  private readonly loader: SampleLoader
  private readonly sets = new Map<SampleSetId, LoadedSampleSet>()
  private readonly pending = new Map<SampleSetId, Promise<LoadedSampleSet>>()
  private readonly statuses = new Map<SampleSetId, SampleSetStatus>()
  private readonly onStatus: (id: SampleSetId, status: SampleSetStatus) => void

  constructor(loader: SampleLoader, onStatus: (id: SampleSetId, status: SampleSetStatus) => void = () => {}) {
    this.loader = loader
    this.onStatus = onStatus
  }

  status(id: SampleSetId): SampleSetStatus {
    return this.statuses.get(id) ?? { state: 'idle', message: 'Not loaded.' }
  }

  /** The loaded set, or undefined until it is ready. */
  get(id: SampleSetId): LoadedSampleSet | undefined {
    return this.sets.get(id)
  }

  /**
   * Loads and decodes a set with the given context. Resolves to the loaded set, or rejects with
   * the reason. Concurrent calls share one load.
   */
  load(context: AudioContextLike, id: SampleSetId): Promise<LoadedSampleSet> {
    const ready = this.sets.get(id)
    if (ready) return Promise.resolve(ready)
    const inFlight = this.pending.get(id)
    if (inFlight) return inFlight

    this.setStatus(id, { state: 'loading', message: `Loading ${id} samples…` })
    const task = this.fetchAndDecode(context, id).then(
      (set) => {
        this.pending.delete(id)
        this.sets.set(id, set)
        this.setStatus(id, { state: 'ready', message: `${set.manifest.label} samples ready.` })
        return set
      },
      (error: unknown) => {
        this.pending.delete(id)
        const reason = error instanceof Error ? error.message : String(error)
        this.setStatus(id, { state: 'failed', message: `${id} samples failed to load (${reason}).` })
        throw error
      },
    )
    this.pending.set(id, task)
    return task
  }

  private setStatus(id: SampleSetId, status: SampleSetStatus) {
    this.statuses.set(id, status)
    this.onStatus(id, status)
  }

  private async fetchAndDecode(context: AudioContextLike, id: SampleSetId): Promise<LoadedSampleSet> {
    const manifestBytes = await this.loader.fetchBytes(`samples/${id}/manifest.json`)
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as SampleSetManifest
    if (manifest.id !== id || manifest.zones.length === 0) {
      throw new Error('manifest is empty or names another set')
    }
    const zones: LoadedZone[] = []
    for (let start = 0; start < manifest.zones.length; start += MAX_PARALLEL_DECODES) {
      const batch = manifest.zones.slice(start, start + MAX_PARALLEL_DECODES)
      const decoded = await Promise.all(
        batch.map(async (zone) => {
          const bytes = await this.loader.fetchBytes(`samples/${zone.file}`)
          return { ...zone, buffer: await context.decodeAudioData(bytes) }
        }),
      )
      zones.push(...decoded)
    }
    return { id, manifest, zones }
  }
}

/** Semitone distance from a note to a zone's root, including the zone's pitch correction. */
export function zonePitchDistance(zone: ManifestZone, note: number): number {
  return note - zone.root - zone.cents / 100
}

/**
 * Chooses the zone that plays `note` at `velocity`. Pitch comes first: a zone's distance from the
 * note in semitones is its cost, and a velocity outside its layer adds 0.05 semitones per step.
 * So a near root with the wrong layer beats a far root with the right one, and the right layer
 * wins among roots at the same distance.
 */
export function selectZone<Z extends ManifestZone>(zones: readonly Z[], note: number, velocity: number): Z | undefined {
  let best: Z | undefined
  let bestScore = Infinity
  for (const zone of zones) {
    const pitch = Math.abs(zonePitchDistance(zone, note))
    const outside = velocity < zone.lovel ? zone.lovel - velocity : velocity > zone.hivel ? velocity - zone.hivel : 0
    const score = pitch + outside * 0.05
    if (score < bestScore) {
      best = zone
      bestScore = score
    }
  }
  return best
}

import type { SampleLayer, SampleSet, SampleSetId } from '../dsp/params'
import { decodeFlac } from './flac'
import manifest from './manifest.json'

/**
 * Loads the bundled piano recordings: fetches each FLAC file through the injected asset
 * boundary, decodes it with the app's own decoder, and checks it against the manifest.
 * A set is all-or-nothing — if any file is missing or wrong, the set has failed and the
 * engine plays its labelled fallback voice instead.
 */

export type LibraryStatus = 'idle' | 'loading' | 'ready' | 'failed'
export type AssetLoader = (path: string) => Promise<ArrayBuffer>

/** The two timer functions the loader needs, so a stalled download can be given up on. */
export interface LoaderTiming {
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** A set that has not arrived after this long has failed. */
export const SAMPLE_LOAD_TIMEOUT_MS = 20000

export const SAMPLE_SET_IDS: readonly SampleSetId[] = ['grand', 'upright', 'electric']
export const SAMPLE_MANIFEST = manifest

/** Path of a sample file relative to the page. */
export function samplePath(file: string): string {
  return `samples/${file}`
}

/**
 * Decoded PCM by source buffer. A browser hands out a fresh ArrayBuffer per fetch, so this
 * holds nothing there; an asset boundary that returns the same buffer again skips the decode.
 */
const decoded = new WeakMap<ArrayBuffer, Int16Array>()

function decodeChecked(bytes: ArrayBuffer, file: string, frames: number): Int16Array {
  let samples = decoded.get(bytes)
  if (!samples) {
    const result = decodeFlac(bytes)
    if (result.sampleRate !== manifest.sampleRate) throw new Error(`${file}: unexpected sample rate ${result.sampleRate}`)
    samples = result.samples
    decoded.set(bytes, samples)
  }
  if (samples.length !== frames) throw new Error(`${file}: ${samples.length} frames, expected ${frames}`)
  return samples
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return typeof error === 'string' && error ? error : 'unknown error'
}

export class SampleLibrary {
  private readonly loadAsset: AssetLoader | null
  private readonly statuses = new Map<SampleSetId, LibraryStatus>()
  private readonly errors = new Map<SampleSetId, string>()
  private readonly pending = new Map<SampleSetId, Promise<SampleSet | null>>()
  private readonly sets = new Map<SampleSetId, SampleSet>()
  private readonly timing: LoaderTiming | null
  private readonly timeoutMs: number
  private readonly timers = new Set<unknown>()

  constructor(loadAsset: AssetLoader | null | undefined, timing: LoaderTiming | null = null, timeoutMs = SAMPLE_LOAD_TIMEOUT_MS) {
    this.loadAsset = loadAsset ?? null
    this.timing = timing
    this.timeoutMs = timeoutMs
  }

  /** Cancel every pending timeout (the owner is going away). */
  dispose(): void {
    for (const timer of this.timers) this.timing?.clearTimeout(timer)
    this.timers.clear()
  }

  status(id: SampleSetId): LibraryStatus {
    return this.statuses.get(id) ?? 'idle'
  }

  /** Why a set failed, in a sentence fragment. */
  error(id: SampleSetId): string | undefined {
    return this.errors.get(id)
  }

  get(id: SampleSetId): SampleSet | null {
    return this.sets.get(id) ?? null
  }

  /** Starts loading a set once; resolves with the set, or null when it failed. Never rejects. */
  load(id: SampleSetId): Promise<SampleSet | null> {
    const existing = this.pending.get(id)
    if (existing) return existing
    this.statuses.set(id, 'loading')
    const promise = new Promise<SampleSet | null>((resolve) => {
      let settled = false
      let timer: unknown = null
      const settle = (set: SampleSet | null, error?: string) => {
        if (settled) return
        settled = true
        if (timer !== null) {
          this.timing?.clearTimeout(timer)
          this.timers.delete(timer)
        }
        if (set) {
          this.sets.set(id, set)
          this.statuses.set(id, 'ready')
        } else {
          this.errors.set(id, error ?? 'unknown error')
          this.statuses.set(id, 'failed')
        }
        resolve(set)
      }
      if (this.timing) {
        timer = this.timing.setTimeout(
          () => settle(null, `the files did not arrive within ${Math.round(this.timeoutMs / 1000)} s`),
          this.timeoutMs,
        )
        this.timers.add(timer)
      }
      this.fetchSet(id).then(
        (set) => settle(set),
        (error: unknown) => settle(null, describe(error)),
      )
    })
    this.pending.set(id, promise)
    return promise
  }

  private async fetchSet(id: SampleSetId): Promise<SampleSet> {
    const loadAsset = this.loadAsset
    if (!loadAsset) throw new Error('this build has no way to load sample files')
    const entry = manifest.sets[id]
    const pcm = new Map<string, Int16Array>()
    await Promise.all(
      entry.files.map(async (file) => {
        const bytes = await loadAsset(samplePath(file.file))
        pcm.set(file.file, decodeChecked(bytes, file.file, file.frames))
      }),
    )
    const layers: SampleLayer[] = entry.layers.map((layer) => ({
      maxVelocity: layer.maxVelocity,
      zones: layer.zones.map((zone) => {
        const data = pcm.get(zone.file)
        if (!data) throw new Error(`${zone.file} is not in the manifest's file list`)
        return { lo: zone.lo, hi: zone.hi, root: zone.root, tune: zone.tune, gain: zone.gain, rate: manifest.sampleRate, data }
      }),
    }))
    return { id, layers }
  }
}

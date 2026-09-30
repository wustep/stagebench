import type { AudioBufferLike, AudioContextLike, SampleLoader } from '../types'
import { recordedById, type ManifestModel } from './catalog'

export interface LoadedSample {
  root: number
  cents: number
  /** RMS of the first 0.5 s of this recording */
  rms: number
  buffer: AudioBufferLike
}
export interface LoadedLayer {
  velocity: number
  samples: LoadedSample[]
}
export interface LoadedModel {
  id: string
  /** velocity layers that are completely decoded so far (playable as soon as one exists) */
  layers: LoadedLayer[]
}

export type LibraryPhase = 'idle' | 'loading' | 'ready' | 'error'
export interface LibraryStatus {
  phase: LibraryPhase
  loaded: number
  total: number
  error?: string
}

interface Entry {
  status: LibraryStatus
  model: LoadedModel
}

const CONCURRENCY = 6

/**
 * Fetches and decodes the bundled recordings of a model. Layers become playable one at a time (middle velocities first),
 * so a model is usable while it is still "loading". Any failed file marks the whole model as errored: the engine then
 * plays a labelled fallback and never reports this model ready.
 */
export class SampleLibrary {
  private readonly entries = new Map<string, Entry>()
  private disposed = false

  constructor(
    private readonly ctx: AudioContextLike,
    private readonly loader: SampleLoader,
    private readonly onChange: () => void,
  ) {}

  status(id: string): LibraryStatus {
    return this.entries.get(id)?.status ?? { phase: 'idle', loaded: 0, total: 0 }
  }

  /** playable data (possibly only some layers), or null if nothing usable exists */
  get(id: string): LoadedModel | null {
    const e = this.entries.get(id)
    if (!e || e.status.phase === 'error' || e.model.layers.length === 0) return null
    return e.model
  }

  request(id: string): void {
    if (this.disposed || this.entries.has(id)) return
    const manifest = recordedById(id)
    if (!manifest) return
    const total = manifest.layers.reduce((n, l) => n + l.samples.length, 0)
    const entry: Entry = { status: { phase: 'loading', loaded: 0, total }, model: { id, layers: [] } }
    this.entries.set(id, entry)
    this.onChange()
    void this.load(manifest, entry)
  }

  private async load(manifest: ManifestModel, entry: Entry) {
    // middle velocities first: they are the most commonly played
    const order = [...manifest.layers].sort((a, b) => Math.abs(a.velocity - 70) - Math.abs(b.velocity - 70))
    try {
      for (const layer of order) {
        const decoded: LoadedSample[] = []
        let next = 0
        const worker = async () => {
          while (next < layer.samples.length) {
            const i = next++
            const s = layer.samples[i]
            const bytes = await this.loader(`samples/${s.file}`)
            if (this.disposed) return
            const buffer = await this.ctx.decodeAudioData(bytes)
            if (this.disposed) return
            decoded[i] = { root: s.root, cents: s.cents, rms: s.rms, buffer }
            entry.status = { ...entry.status, loaded: entry.status.loaded + 1 }
          }
        }
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, layer.samples.length) }, worker))
        if (this.disposed) return
        entry.model.layers.push({ velocity: layer.velocity, samples: decoded })
        this.onChange()
      }
      entry.status = { ...entry.status, phase: 'ready' }
    } catch (error) {
      if (this.disposed) return
      entry.model.layers.length = 0
      entry.status = { ...entry.status, phase: 'error', error: error instanceof Error ? error.message : String(error) }
    }
    this.onChange()
  }

  dispose(): void {
    this.disposed = true
    this.entries.clear()
  }
}

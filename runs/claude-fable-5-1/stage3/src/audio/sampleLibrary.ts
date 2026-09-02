/**
 * Bundled sample library loader. A set is a manifest plus mono Ogg Vorbis one-shots (one file per
 * root note and velocity layer). Files are fetched and decoded through the injected asset boundary,
 * so tests decode the real bundled files from disk and the browser fetches them relative to the page.
 * Decoded sets are cached as Float32Arrays; the engine turns them into AudioBuffers per context.
 */
import type { AssetBoundary } from './boundaries'

export interface SampleLayer {
  index: number
  name: string
  lovel: number
  hivel: number
  velocity: number
}

export interface SampleFile {
  file: string
  root: number
  layer: number
  seconds: number
  peak?: number
  rms?: number
  sourceFile?: string
}

export interface SampleManifest {
  id: string
  type: string
  model: string
  kind: 'recorded' | 'generated'
  source: { name: string; author?: string; url?: string; license: string; licenseUrl?: string; instrument?: string; recording?: string; files?: string }
  format: string
  sampleRate: number
  channels: number
  layers: SampleLayer[]
  range: { lowestRoot: number; highestRoot: number }
  files: SampleFile[]
  processing?: string
  notes?: string[]
}

export interface DecodedSample {
  file: SampleFile
  data: Float32Array
  sampleRate: number
}

export interface LoadedSet {
  id: string
  manifest: SampleManifest
  /** Decoded files keyed by `${root}:${layer}`; only the files that passed the filter. */
  samples: Map<string, DecodedSample>
  /** Roots available per layer (ascending). */
  rootsByLayer: number[][]
}

export interface SetProgress {
  id: string
  loaded: number
  total: number
}

export interface SampleLibraryOptions {
  assets: AssetBoundary
  /** Tests restrict a set to a few files so decoding stays fast; production loads everything. */
  filter?: (file: SampleFile, manifest: SampleManifest) => boolean
  concurrency?: number
}

export const sampleKey = (root: number, layer: number) => `${root}:${layer}`

export function validateManifest(m: unknown, id: string): SampleManifest {
  const x = m as Partial<SampleManifest> | null
  if (!x || typeof x !== 'object') throw new Error(`Manifest ${id} is not an object`)
  if (x.id !== id) throw new Error(`Manifest id mismatch: expected ${id}, got ${String(x.id)}`)
  if (!Array.isArray(x.layers) || x.layers.length === 0) throw new Error(`Manifest ${id} has no velocity layers`)
  if (!Array.isArray(x.files) || x.files.length === 0) throw new Error(`Manifest ${id} lists no files`)
  if (!x.source || typeof x.source.license !== 'string' || !x.source.license) throw new Error(`Manifest ${id} has no licence`)
  if (x.kind !== 'recorded' && x.kind !== 'generated') throw new Error(`Manifest ${id} has no source kind`)
  for (const f of x.files) {
    if (!Number.isInteger(f.root) || !Number.isInteger(f.layer) || typeof f.file !== 'string') throw new Error(`Manifest ${id} has a malformed file entry`)
  }
  return x as SampleManifest
}

/** Velocity layer index for a velocity (1..127) using the manifest ranges. */
export function layerForVelocity(layers: SampleLayer[], velocity: number): number {
  const v = Math.min(127, Math.max(1, Math.round(velocity)))
  for (const l of layers) if (v >= l.lovel && v <= l.hivel) return l.index
  // Gaps or overlaps in a manifest fall back to the nearest layer by representative velocity.
  let best = layers[0]
  for (const l of layers) if (Math.abs(l.velocity - v) < Math.abs(best.velocity - v)) best = l
  return best.index
}

/** Nearest available root for a note (ties prefer the lower root, i.e. shifting up). */
export function nearestRoot(roots: number[], midi: number): number | null {
  if (roots.length === 0) return null
  let best = roots[0]
  for (const r of roots) {
    const d = Math.abs(r - midi)
    const bd = Math.abs(best - midi)
    if (d < bd || (d === bd && r < best)) best = r
  }
  return best
}

export class SampleLibrary {
  private sets = new Map<string, LoadedSet>()
  private pending = new Map<string, Promise<LoadedSet>>()
  private listeners = new Set<() => void>()
  private progressMap = new Map<string, SetProgress>()
  private errors = new Map<string, string>()

  constructor(private readonly options: SampleLibraryOptions) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    this.listeners.forEach((l) => l())
  }

  get(id: string): LoadedSet | undefined {
    return this.sets.get(id)
  }

  loadedIds(): string[] {
    return [...this.sets.keys()]
  }

  progress(id: string): SetProgress | undefined {
    return this.progressMap.get(id)
  }

  error(id: string): string | undefined {
    return this.errors.get(id)
  }

  isLoading(id: string): boolean {
    return this.pending.has(id)
  }

  /** Loads (or returns the cached) set. Rejects with a readable message on any asset failure. */
  load(id: string): Promise<LoadedSet> {
    const cached = this.sets.get(id)
    if (cached) return Promise.resolve(cached)
    const running = this.pending.get(id)
    if (running) return running
    const task = this.loadSet(id).then(
      (set) => {
        this.sets.set(id, set)
        this.pending.delete(id)
        this.errors.delete(id)
        this.emit()
        return set
      },
      (err: unknown) => {
        this.pending.delete(id)
        const message = err instanceof Error ? err.message : String(err)
        this.errors.set(id, message)
        this.emit()
        throw new Error(message)
      },
    )
    this.pending.set(id, task)
    this.emit()
    return task
  }

  private async loadSet(id: string): Promise<LoadedSet> {
    const { assets } = this.options
    const manifestBytes = await assets.fetchBytes(`${id}/manifest.json`)
    const manifest = validateManifest(JSON.parse(new TextDecoder().decode(manifestBytes)), id)
    const files = manifest.files.filter((f) => (this.options.filter ? this.options.filter(f, manifest) : true))
    if (files.length === 0) throw new Error(`No files selected from ${id}`)
    const progress: SetProgress = { id, loaded: 0, total: files.length }
    this.progressMap.set(id, progress)
    const samples = new Map<string, DecodedSample>()
    const queue = [...files]
    const worker = async () => {
      for (;;) {
        const file = queue.shift()
        if (!file) return
        const bytes = await assets.fetchBytes(`${id}/${file.file}`)
        const decoded = await assets.decodeVorbis(bytes)
        const data = decoded.channelData[0]
        if (!data || data.length === 0) throw new Error(`${file.file} decoded to silence`)
        samples.set(sampleKey(file.root, file.layer), { file, data, sampleRate: decoded.sampleRate })
        progress.loaded++
        this.emit()
      }
    }
    const n = Math.max(1, Math.min(this.options.concurrency ?? 4, files.length))
    await Promise.all(Array.from({ length: n }, () => worker()))
    const rootsByLayer: number[][] = manifest.layers.map(() => [])
    for (const s of samples.values()) rootsByLayer[s.file.layer]?.push(s.file.root)
    for (const roots of rootsByLayer) roots.sort((a, b) => a - b)
    return { id, manifest, samples, rootsByLayer }
  }

  /** Drops decoded data for a set (memory); the manifest can be reloaded later. */
  unload(id: string) {
    this.sets.delete(id)
    this.progressMap.delete(id)
    this.emit()
  }

  dispose() {
    this.sets.clear()
    this.pending.clear()
    this.progressMap.clear()
    this.errors.clear()
    this.listeners.clear()
  }
}

/** Largest pitch shift (semitones) accepted before a neighbouring velocity layer's closer root is preferred. */
export const MAX_COMFORTABLE_SHIFT = 3

/**
 * Picks the sample to play for a note: the velocity layer from the manifest, then the nearest root that
 * exists in that layer. Sparse sets (some recorded layers cover only a few roots) fall back to the closest
 * neighbouring layer whose root is within MAX_COMFORTABLE_SHIFT, because a wrong dynamic layer is far
 * less audible than a uniformly pitch-shifted sample.
 */
export function pickSample(set: LoadedSet, midi: number, velocity: number): { sample: DecodedSample; playbackRate: number; layer: number } | null {
  const wanted = layerForVelocity(set.manifest.layers, velocity)
  const candidates = set.rootsByLayer
    .map((roots, layer) => ({ layer, root: nearestRoot(roots, midi) }))
    .filter((c): c is { layer: number; root: number } => c.root !== null)
    .map((c) => ({ ...c, distance: Math.abs(c.root - midi), layerDistance: Math.abs(c.layer - wanted) }))
  if (candidates.length === 0) return null
  const preferred = candidates.find((c) => c.layer === wanted)
  let choice = preferred
  if (!choice || choice.distance > MAX_COMFORTABLE_SHIFT) {
    const close = candidates.filter((c) => c.distance <= MAX_COMFORTABLE_SHIFT).sort((a, b) => a.layerDistance - b.layerDistance || a.distance - b.distance)[0]
    choice = close ?? candidates.sort((a, b) => a.distance - b.distance || a.layerDistance - b.layerDistance)[0]
  }
  const sample = set.samples.get(sampleKey(choice.root, choice.layer))
  if (!sample) return null
  return { sample, playbackRate: Math.pow(2, (midi - choice.root) / 12), layer: choice.layer }
}

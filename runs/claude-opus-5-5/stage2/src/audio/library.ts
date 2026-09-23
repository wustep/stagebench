// The piano library: three bundled recorded sample packs (Grand, Upright, Electric + a second
// recorded Electric model) and the generated (synthesized) models for Clav, Digital and Misc.
// Packs are fetched once and their zones decoded lazily on first use (so load is quick and memory
// stays bounded); generated models are rendered in the background with yields.
import { PIANO_MODELS, type GeneratorId, type PianoModel, type SamplePackId } from './instruments'
import { GENERATORS, generatorRoots } from './synthModels'
import { decodeZone, parsePack, pickZone, type PackZone, type ParsedPack } from './samplePack'
import type { ToneOptions } from './pianoTone'
import type { AudioContextLike, BufferLike } from './webAudioTypes'

export type PackKey = SamplePackId
export const PACK_FILES: Record<PackKey, string> = {
  grand: 'samples/grand.nspk',
  upright: 'samples/upright.nspk',
  electric: 'samples/electric.nspk',
  'electric-rhodes': 'samples/electric-rhodes.nspk',
}

export type SourceStatus = 'pending' | 'loading' | 'ready' | 'failed'

export interface SourceInfo {
  key: string
  label: string
  kind: 'recorded' | 'generated'
  status: SourceStatus
  error?: string
}

export interface PlayableZone {
  buffer: BufferLike
  root: number
  /** Velocity layer label (recorded) or 'gen'. */
  layer: string
}

export interface LibraryOptions {
  fetchAsset: ((path: string) => Promise<ArrayBuffer>) | null
  toneOptions?: ToneOptions
  lowNote: number
  highNote: number
  yieldToEventLoop: () => Promise<void>
  /** Truncate decoded zones (tests render short excerpts). */
  maxZoneSeconds?: number
}

/** Which bundled pack a recorded model plays. */
export function packOf(model: PianoModel): PackKey | null {
  return model.source.kind === 'recorded' ? model.source.pack : null
}

export class PianoLibrary {
  private readonly packs = new Map<PackKey, ParsedPack>()
  private readonly generated = new Map<GeneratorId, Map<number, Float32Array>>()
  private readonly zoneBuffers = new Map<string, BufferLike>()
  private readonly info = new Map<string, SourceInfo>()
  private readonly listeners = new Set<() => void>()
  private disposed = false

  constructor(private readonly options: LibraryOptions) {
    for (const key of Object.keys(PACK_FILES) as PackKey[]) this.info.set(`pack:${key}`, { key, label: labelForPack(key), kind: 'recorded', status: 'pending' })
    for (const id of Object.keys(GENERATORS) as GeneratorId[]) this.info.set(`gen:${id}`, { key: id, label: id, kind: 'generated', status: 'pending' })
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  sources(): SourceInfo[] {
    return [...this.info.values()]
  }

  private set(id: string, patch: Partial<SourceInfo>): void {
    const cur = this.info.get(id)
    if (!cur || this.disposed) return
    this.info.set(id, { ...cur, ...patch })
    this.listeners.forEach((l) => l())
  }

  /** Load every pack, then render every generator. Never throws: failures are recorded per source. */
  async load(): Promise<void> {
    const fetchAsset = this.options.fetchAsset
    for (const key of Object.keys(PACK_FILES) as PackKey[]) {
      if (this.disposed) return
      this.set(`pack:${key}`, { status: 'loading' })
      try {
        if (!fetchAsset) throw new Error('no asset loader')
        const bytes = await fetchAsset(PACK_FILES[key])
        const pack = parsePack(bytes)
        this.packs.set(key, pack)
        this.set(`pack:${key}`, { status: 'ready' })
      } catch (error) {
        this.set(`pack:${key}`, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
      }
      await this.options.yieldToEventLoop()
    }
    for (const id of Object.keys(GENERATORS) as GeneratorId[]) {
      if (this.disposed) return
      this.set(`gen:${id}`, { status: 'loading' })
      try {
        const spec = GENERATORS[id]
        const map = new Map<number, Float32Array>()
        for (const root of generatorRoots(spec.step, this.options.lowNote, this.options.highNote)) {
          if (this.disposed) return
          const pcm = spec.render(root, this.options.toneOptions ?? {})
          if (!(pcm instanceof Float32Array) || pcm.length === 0) throw new Error(`empty tone for ${root}`)
          map.set(root, pcm)
        }
        this.generated.set(id, map)
        this.set(`gen:${id}`, { status: 'ready' })
      } catch (error) {
        this.set(`gen:${id}`, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
      }
      await this.options.yieldToEventLoop()
    }
  }

  modelStatus(model: PianoModel): SourceStatus {
    const pack = packOf(model)
    const id = pack ? `pack:${pack}` : `gen:${(model.source as { generator: GeneratorId }).generator}`
    return this.info.get(id)?.status ?? 'failed'
  }

  pack(key: PackKey): ParsedPack | undefined {
    return this.packs.get(key)
  }

  /** The zone to play for a model/note/velocity, or null when the model's source is unavailable. */
  zoneFor(ctx: AudioContextLike, model: PianoModel, note: number, velocity: number): PlayableZone | null {
    const packKey = packOf(model)
    if (packKey) {
      const pack = this.packs.get(packKey)
      if (!pack) return null
      const zone = pickZone(pack.header.zones, note, velocity)
      return { buffer: this.zoneBuffer(ctx, packKey, pack, zone), root: zone.root, layer: zone.layer }
    }
    const gen = (model.source as { generator: GeneratorId }).generator
    const map = this.generated.get(gen)
    if (!map) return null
    let root = -1
    for (const r of map.keys()) if (root < 0 || Math.abs(r - note) < Math.abs(root - note)) root = r
    const key = `gen:${gen}:${root}`
    let buffer = this.zoneBuffers.get(key)
    if (!buffer) {
      const pcm = map.get(root)!
      const sr = this.options.toneOptions?.sampleRate ?? 32000
      const b = ctx.createBuffer(1, pcm.length, sr)
      b.copyToChannel(pcm, 0)
      buffer = b
      this.zoneBuffers.set(key, buffer)
    }
    return { buffer, root, layer: 'gen' }
  }

  private zoneBuffer(ctx: AudioContextLike, key: PackKey, pack: ParsedPack, zone: PackZone): BufferLike {
    const id = `pack:${key}:${zone.root}:${zone.layer}`
    let buffer = this.zoneBuffers.get(id)
    if (!buffer) {
      const max = this.options.maxZoneSeconds ? this.options.maxZoneSeconds * pack.header.sampleRate : Infinity
      const pcm = decodeZone(pack, zone, max)
      const b = ctx.createBuffer(1, pcm.length, pack.header.sampleRate)
      b.copyToChannel(pcm, 0)
      buffer = b
      this.zoneBuffers.set(id, buffer)
    }
    return buffer
  }

  /** Buffers belong to one AudioContext; drop them when the context goes away. */
  clearBuffers(): void {
    this.zoneBuffers.clear()
  }

  dispose(): void {
    this.disposed = true
    this.zoneBuffers.clear()
    this.packs.clear()
    this.generated.clear()
    this.listeners.clear()
  }
}

function labelForPack(key: PackKey): string {
  return key === 'electric-rhodes' ? 'Electric (Rhodes) samples' : `${key[0].toUpperCase()}${key.slice(1)} samples`
}

/** Every model in the catalog (re-exported for the UI and tests). */
export const ALL_MODELS = PIANO_MODELS

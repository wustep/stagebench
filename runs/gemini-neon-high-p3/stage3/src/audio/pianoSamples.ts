import { GRAND_SAMPLE_MANIFEST, type PianoSampleRegion, type VelocityLayerId } from './grandSampleManifest'
import type { AudioBufferLike, AudioContextLike, SampleFetcher } from './boundaries'

export interface SelectedSample {
  readonly region: PianoSampleRegion
  readonly playbackRate: number
  readonly gain: number
  readonly layerFallback: boolean
}

export const VELOCITY_LAYER_ORDER: readonly VelocityLayerId[] = ['v3', 'v10', 'v16']

const UNIQUE_ROOTS: readonly number[] = Array.from(
  new Set(GRAND_SAMPLE_MANIFEST.map((r) => r.midi)),
).sort((a, b) => a - b)

const REGION_BY_KEY = new Map<string, PianoSampleRegion>()
for (const region of GRAND_SAMPLE_MANIFEST) {
  REGION_BY_KEY.set(`${region.midi}:${region.vel}`, region)
}

export function velocityToLayerAndGain(velocity: number): {
  vel: VelocityLayerId
  gain: number
} {
  const v = Math.max(1, Math.min(127, Math.round(velocity)))
  if (v <= 48) {
    const t = v / 48
    return {
      vel: 'v3',
      gain: 0.24 + 0.76 * Math.pow(t, 1.3),
    }
  }
  if (v <= 96) {
    const t = (v - 48) / 48
    return {
      vel: 'v10',
      gain: 0.48 + 0.52 * Math.pow(t, 1.15),
    }
  }
  const t = (v - 96) / 31
  return {
    vel: 'v16',
    gain: 0.55 + 0.45 * t,
  }
}

export function findNearestRootMidi(midi: number): number {
  let best = UNIQUE_ROOTS[0]
  let bestDist = Math.abs(midi - best)
  for (let i = 1; i < UNIQUE_ROOTS.length; i++) {
    const candidate = UNIQUE_ROOTS[i]
    const dist = Math.abs(midi - candidate)
    if (dist < bestDist) {
      best = candidate
      bestDist = dist
    }
  }
  return best
}

export function computePlaybackRate(targetMidi: number, rootMidi: number, tuneCents: number): number {
  const semitoneDiff = targetMidi - rootMidi
  return Math.pow(2, (semitoneDiff * 100 + tuneCents) / 1200)
}

export function selectSampleForNote(
  midi: number,
  velocity: number,
  isLoaded?: (key: string) => boolean,
): SelectedSample {
  const rootMidi = findNearestRootMidi(midi)
  const { vel, gain } = velocityToLayerAndGain(velocity)
  const primaryKey = `${rootMidi}:${vel}`
  const primaryRegion = REGION_BY_KEY.get(primaryKey)

  if (primaryRegion && (!isLoaded || isLoaded(primaryKey))) {
    return {
      region: primaryRegion,
      playbackRate: computePlaybackRate(midi, rootMidi, primaryRegion.tuneCents),
      gain,
      layerFallback: false,
    }
  }

  // If the target velocity layer is still loading, fall back to any loaded layer of the same root
  if (isLoaded) {
    const fallbackOrder: VelocityLayerId[] =
      vel === 'v3' ? ['v10', 'v16'] : vel === 'v16' ? ['v10', 'v3'] : ['v16', 'v3']
    for (const altVel of fallbackOrder) {
      const altKey = `${rootMidi}:${altVel}`
      const altRegion = REGION_BY_KEY.get(altKey)
      if (altRegion && isLoaded(altKey)) {
        const normalizedVel = Math.max(1, Math.min(127, velocity)) / 127
        const altGain = Math.pow(normalizedVel, 1.6) * (altVel === 'v16' ? 0.85 : altVel === 'v10' ? 0.95 : 1.0)
        return {
          region: altRegion,
          playbackRate: computePlaybackRate(midi, rootMidi, altRegion.tuneCents),
          gain: Math.max(0.06, altGain),
          layerFallback: true,
        }
      }
    }
  }

  const region = primaryRegion ?? GRAND_SAMPLE_MANIFEST[0]
  return {
    region,
    playbackRate: computePlaybackRate(midi, region.midi, region.tuneCents),
    gain,
    layerFallback: false,
  }
}

export type SampleBankState = 'idle' | 'loading' | 'ready' | 'error'

export interface SampleBankSnapshot {
  readonly state: SampleBankState
  readonly loadedCount: number
  readonly totalCount: number
  readonly failedCount: number
  readonly errorMessage: string | null
}

/**
 * Loads and caches raw sample ArrayBuffers and decoded AudioBuffers.
 * Prioritizes middle-register notes (C3–C6, v10 first) so interactive playback
 * transitions to recorded samples as rapidly as possible.
 */
export class PianoSampleBank {
  private readonly rawBuffers = new Map<string, ArrayBuffer>()
  private readonly decodedBuffers = new Map<string, AudioBufferLike>()
  private readonly fetcher: SampleFetcher
  private readonly baseUrl: string
  private readonly listeners = new Set<(snap: SampleBankSnapshot) => void>()

  private state: SampleBankState = 'idle'
  private failedCount = 0
  private errorMessage: string | null = null
  private fetchPromise: Promise<void> | null = null
  private decodeContext: AudioContextLike | null = null
  private disposed = false

  constructor(fetcher: SampleFetcher, baseUrl = './') {
    this.fetcher = fetcher
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  }

  get totalCount(): number {
    return GRAND_SAMPLE_MANIFEST.length
  }

  getBuffer(midi: number, vel: VelocityLayerId): AudioBufferLike | undefined {
    return this.decodedBuffers.get(`${midi}:${vel}`)
  }

  hasDecoded(key: string): boolean {
    return this.decodedBuffers.has(key)
  }

  getDecodedCount(): number {
    return this.decodedBuffers.size
  }

  getSnapshot(): SampleBankSnapshot {
    return {
      state: this.state,
      loadedCount: this.decodedBuffers.size,
      totalCount: GRAND_SAMPLE_MANIFEST.length,
      failedCount: this.failedCount,
      errorMessage: this.errorMessage,
    }
  }

  subscribe(listener: (snap: SampleBankSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    const snap = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(snap)
    }
  }

  private getPrioritizedRegions(): PianoSampleRegion[] {
    return [...GRAND_SAMPLE_MANIFEST].sort((a, b) => {
      const aMid = Math.abs(a.midi - 60)
      const bMid = Math.abs(b.midi - 60)
      const aVelRank = a.vel === 'v10' ? 0 : a.vel === 'v16' ? 1 : 2
      const bVelRank = b.vel === 'v10' ? 0 : b.vel === 'v16' ? 1 : 2
      if (aVelRank !== bVelRank) return aVelRank - bVelRank
      return aMid - bMid
    })
  }

  loadAll(ctx: AudioContextLike | null): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (ctx) {
      this.decodeContext = ctx
    }
    if (this.fetchPromise) {
      if (ctx && this.rawBuffers.size > this.decodedBuffers.size) {
        void this.decodeCachedRaw(ctx)
      }
      return this.fetchPromise
    }

    this.state = 'loading'
    this.failedCount = 0
    this.errorMessage = null
    this.emit()

    const regions = this.getPrioritizedRegions()
    const concurrency = 8

    this.fetchPromise = (async () => {
      let cursor = 0
      const worker = async () => {
        while (!this.disposed) {
          const idx = cursor++
          if (idx >= regions.length) break
          const region = regions[idx]
          const key = `${region.midi}:${region.vel}`
          try {
            const url = `${this.baseUrl}${region.file}`
            const raw = await this.fetcher(url)
            if (this.disposed) return
            this.rawBuffers.set(key, raw)
            if (this.decodeContext) {
              const decoded = await this.decodeContext.decodeAudioData(raw.slice(0))
              if (this.disposed) return
              this.decodedBuffers.set(key, decoded)
              this.emit()
            }
          } catch (err) {
            if (this.disposed) return
            this.failedCount++
            if (!this.errorMessage) {
              this.errorMessage = err instanceof Error ? err.message : String(err)
            }
            this.emit()
          }
        }
      }

      const workers = Array.from({ length: Math.min(concurrency, regions.length) }, () => worker())
      await Promise.all(workers)
      if (this.disposed) return

      if (this.decodedBuffers.size === 0 && this.failedCount > 0) {
        this.state = 'error'
      } else if (this.decodedBuffers.size > 0) {
        this.state = 'ready'
      } else if (this.rawBuffers.size > 0 && !this.decodeContext) {
        this.state = 'loading'
      } else {
        this.state = 'error'
        this.errorMessage = this.errorMessage ?? 'No piano samples loaded.'
      }
      this.emit()
    })()

    return this.fetchPromise
  }

  async decodeCachedRaw(ctx: AudioContextLike): Promise<void> {
    if (this.disposed) return
    this.decodeContext = ctx
    const pending: Array<[string, ArrayBuffer]> = []
    for (const [key, raw] of this.rawBuffers.entries()) {
      if (!this.decodedBuffers.has(key)) {
        pending.push([key, raw])
      }
    }
    if (pending.length === 0) return

    for (const [key, raw] of pending) {
      if (this.disposed) return
      try {
        const decoded = await ctx.decodeAudioData(raw.slice(0))
        if (this.disposed) return
        this.decodedBuffers.set(key, decoded)
        this.emit()
      } catch (err) {
        if (this.disposed) return
        this.failedCount++
        if (!this.errorMessage) {
          this.errorMessage = err instanceof Error ? err.message : String(err)
        }
      }
    }

    if (this.decodedBuffers.size > 0) {
      this.state = 'ready'
    } else if (this.failedCount > 0) {
      this.state = 'error'
    }
    this.emit()
  }

  dispose(): void {
    this.disposed = true
    this.rawBuffers.clear()
    this.decodedBuffers.clear()
    this.listeners.clear()
  }
}

import type { AudioBufferLike, AudioContextLike, SampleFetcher } from './boundaries'
import { GRAND_SAMPLE_MANIFEST } from './grandSampleManifest'
import {
  RHODES_SAMPLE_MANIFEST,
  UPRIGHT_SAMPLE_MANIFEST,
  WURLI_SAMPLE_MANIFEST,
  type GenericSampleRegion,
  type SampleBankId,
} from './sampleManifests'

export interface BankSelectedSample {
  readonly bankId: SampleBankId
  readonly region: GenericSampleRegion
  readonly playbackRate: number
  readonly gain: number
  readonly dynamicFilterHz: number | null
  readonly layerFallback: boolean
}

export type BankLoadState = 'idle' | 'loading' | 'ready' | 'error'

export interface SingleBankStatus {
  readonly bankId: SampleBankId
  readonly state: BankLoadState
  readonly loadedCount: number
  readonly totalCount: number
  readonly failedCount: number
  readonly errorMessage: string | null
}

interface BankDefinition {
  readonly id: SampleBankId
  readonly regions: readonly GenericSampleRegion[]
  readonly velocityLayers: readonly string[]
  readonly singleDynamic: boolean
}

const BANK_DEFINITIONS: Readonly<Record<SampleBankId, BankDefinition>> = {
  grand: {
    id: 'grand',
    regions: GRAND_SAMPLE_MANIFEST,
    velocityLayers: ['v3', 'v10', 'v16'],
    singleDynamic: false,
  },
  upright: {
    id: 'upright',
    regions: UPRIGHT_SAMPLE_MANIFEST,
    velocityLayers: ['vL', 'vH'],
    singleDynamic: false,
  },
  rhodes: {
    id: 'rhodes',
    regions: RHODES_SAMPLE_MANIFEST,
    velocityLayers: ['v1'],
    singleDynamic: true,
  },
  wurli: {
    id: 'wurli',
    regions: WURLI_SAMPLE_MANIFEST,
    velocityLayers: ['mp', 'ff'],
    singleDynamic: false,
  },
}

export function getBankManifest(bankId: SampleBankId): readonly GenericSampleRegion[] {
  return BANK_DEFINITIONS[bankId].regions
}

function velocityMappingForBank(
  bankId: SampleBankId,
  velocity: number,
): { vel: string; gain: number; dynamicFilterHz: number | null } {
  const v = Math.max(1, Math.min(127, Math.round(velocity)))
  const norm = v / 127

  if (bankId === 'grand') {
    if (v <= 48) {
      const t = v / 48
      return { vel: 'v3', gain: 0.24 + 0.76 * Math.pow(t, 1.3), dynamicFilterHz: null }
    }
    if (v <= 96) {
      const t = (v - 48) / 48
      return { vel: 'v10', gain: 0.48 + 0.52 * Math.pow(t, 1.15), dynamicFilterHz: null }
    }
    const t = (v - 96) / 31
    return { vel: 'v16', gain: 0.55 + 0.45 * t, dynamicFilterHz: null }
  }

  if (bankId === 'upright') {
    if (v <= 78) {
      const t = v / 78
      return { vel: 'vL', gain: 0.22 + 0.68 * Math.pow(t, 1.25), dynamicFilterHz: null }
    }
    const t = (v - 78) / 49
    return { vel: 'vH', gain: 0.54 + 0.46 * Math.pow(t, 1.1), dynamicFilterHz: null }
  }

  if (bankId === 'wurli') {
    if (v <= 74) {
      const t = v / 74
      return { vel: 'mp', gain: 0.24 + 0.66 * Math.pow(t, 1.2), dynamicFilterHz: 2200 + t * 4200 }
    }
    const t = (v - 74) / 53
    return { vel: 'ff', gain: 0.58 + 0.42 * Math.pow(t, 1.05), dynamicFilterHz: null }
  }

  // Rhodes Mk I: single dynamic per note — velocity shapes both gain and brightness lowpass filter
  const gain = 0.14 + 0.86 * Math.pow(norm, 1.35)
  const dynamicFilterHz = 900 + Math.pow(norm, 1.5) * 9500
  return { vel: 'v1', gain, dynamicFilterHz }
}

export function selectBankSample(
  bankId: SampleBankId,
  midi: number,
  velocity: number,
  isLoaded?: (key: string) => boolean,
): BankSelectedSample {
  const def = BANK_DEFINITIONS[bankId]
  const { vel, gain, dynamicFilterHz } = velocityMappingForBank(bankId, velocity)

  // Find nearest root within preferred velocity layer first
  const findNearestInLayer = (layerVel: string): GenericSampleRegion | null => {
    let best: GenericSampleRegion | null = null
    let bestDist = Infinity
    for (const r of def.regions) {
      if (r.vel !== layerVel) continue
      const key = `${r.midi}:${r.vel}`
      if (isLoaded && !isLoaded(key)) continue
      const dist = Math.abs(midi - r.midi)
      if (dist < bestDist) {
        best = r
        bestDist = dist
      }
    }
    return best
  }

  const primary = findNearestInLayer(vel)
  if (primary) {
    const rate = Math.pow(2, ((midi - primary.midi) * 100 + primary.tuneCents) / 1200)
    return {
      bankId,
      region: primary,
      playbackRate: rate,
      gain,
      dynamicFilterHz,
      layerFallback: false,
    }
  }

  // Fallback to any loaded velocity layer in the same bank
  for (const altVel of def.velocityLayers) {
    if (altVel === vel) continue
    const alt = findNearestInLayer(altVel)
    if (alt) {
      const norm = Math.max(1, Math.min(127, velocity)) / 127
      const rate = Math.pow(2, ((midi - alt.midi) * 100 + alt.tuneCents) / 1200)
      return {
        bankId,
        region: alt,
        playbackRate: rate,
        gain: Math.max(0.08, Math.pow(norm, 1.45)),
        dynamicFilterHz: dynamicFilterHz ?? (velocity < 60 ? 1800 + norm * 4000 : null),
        layerFallback: true,
      }
    }
  }

  // Fallback descriptor if nothing decoded yet
  const fallbackRegion = def.regions[0]
  const rate = Math.pow(2, ((midi - fallbackRegion.midi) * 100 + fallbackRegion.tuneCents) / 1200)
  return {
    bankId,
    region: fallbackRegion,
    playbackRate: rate,
    gain,
    dynamicFilterHz,
    layerFallback: false,
  }
}

class SingleSampleBank {
  readonly bankId: SampleBankId
  private readonly def: BankDefinition
  private readonly fetcher: SampleFetcher
  private readonly baseUrl: string
  private readonly rawBuffers = new Map<string, ArrayBuffer>()
  private readonly decodedBuffers = new Map<string, AudioBufferLike>()
  private readonly onChange: () => void

  private state: BankLoadState = 'idle'
  private failedCount = 0
  private errorMessage: string | null = null
  private fetchPromise: Promise<void> | null = null
  private decodeContext: AudioContextLike | null = null
  private disposed = false

  constructor(
    bankId: SampleBankId,
    fetcher: SampleFetcher,
    baseUrl: string,
    onChange: () => void,
  ) {
    this.bankId = bankId
    this.def = BANK_DEFINITIONS[bankId]
    this.fetcher = fetcher
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
    this.onChange = onChange
  }

  get totalCount(): number {
    return this.def.regions.length
  }

  hasDecoded(key: string): boolean {
    return this.decodedBuffers.has(key)
  }

  getBuffer(midi: number, vel: string): AudioBufferLike | null {
    return this.decodedBuffers.get(`${midi}:${vel}`) ?? null
  }

  getStatus(): SingleBankStatus {
    return {
      bankId: this.bankId,
      state: this.state,
      loadedCount: this.decodedBuffers.size,
      totalCount: this.def.regions.length,
      failedCount: this.failedCount,
      errorMessage: this.errorMessage,
    }
  }

  private getPrioritizedRegions(): readonly GenericSampleRegion[] {
    return [...this.def.regions].sort((a, b) => {
      const aMid = Math.abs(a.midi - 60)
      const bMid = Math.abs(b.midi - 60)
      return aMid - bMid
    })
  }

  async load(ctx: AudioContextLike | null): Promise<void> {
    if (this.disposed) return
    if (ctx) this.decodeContext = ctx
    if (this.decodedBuffers.size === this.def.regions.length) {
      this.state = 'ready'
      this.onChange()
      return
    }
    if (this.fetchPromise) {
      await this.fetchPromise
      if (ctx && !this.disposed) {
        await this.decodePending(ctx)
      }
      return
    }

    this.state = 'loading'
    this.failedCount = 0
    this.errorMessage = null
    this.onChange()

    const ordered = this.getPrioritizedRegions()
    const concurrency = 6
    let cursor = 0

    const worker = async () => {
      while (cursor < ordered.length && !this.disposed) {
        const region = ordered[cursor++]
        const key = `${region.midi}:${region.vel}`
        if (this.decodedBuffers.has(key)) continue
        try {
          let raw = this.rawBuffers.get(key)
          if (!raw) {
            raw = await this.fetcher(`${this.baseUrl}${region.file}`)
            if (this.disposed) return
            this.rawBuffers.set(key, raw)
          }
          if (this.decodeContext) {
            const decoded = await this.decodeContext.decodeAudioData(raw.slice(0))
            if (this.disposed) return
            this.decodedBuffers.set(key, decoded)
            this.rawBuffers.delete(key)
            if (this.decodedBuffers.size % 6 === 0 || this.decodedBuffers.size === 1) {
              this.onChange()
            }
          }
        } catch (err) {
          this.failedCount += 1
          if (!this.errorMessage) {
            this.errorMessage = err instanceof Error ? err.message : String(err)
          }
        }
      }
    }

    this.fetchPromise = Promise.all(
      Array.from({ length: concurrency }, () => worker()),
    ).then(() => {
      this.fetchPromise = null
      if (this.disposed) return
      if (this.decodedBuffers.size > 0) {
        this.state = 'ready'
      } else if (this.failedCount > 0) {
        this.state = 'error'
      }
      this.onChange()
    })

    await this.fetchPromise
  }

  private async decodePending(ctx: AudioContextLike): Promise<void> {
    if (this.disposed || this.rawBuffers.size === 0) return
    this.decodeContext = ctx
    for (const [key, raw] of Array.from(this.rawBuffers.entries())) {
      if (this.disposed) return
      if (this.decodedBuffers.has(key)) {
        this.rawBuffers.delete(key)
        continue
      }
      try {
        const decoded = await ctx.decodeAudioData(raw.slice(0))
        if (this.disposed) return
        this.decodedBuffers.set(key, decoded)
        this.rawBuffers.delete(key)
      } catch (err) {
        this.failedCount += 1
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
    this.onChange()
  }

  /** Direct buffer injection for deterministic offline rendering / testing */
  injectDecodedBuffer(midi: number, vel: string, buffer: AudioBufferLike): void {
    this.decodedBuffers.set(`${midi}:${vel}`, buffer)
    this.state = 'ready'
    this.onChange()
  }

  dispose(): void {
    this.disposed = true
    this.rawBuffers.clear()
    this.decodedBuffers.clear()
  }
}

export class MultiBankSampleManager {
  private readonly banks: Record<SampleBankId, SingleSampleBank>
  private readonly listeners = new Set<() => void>()

  constructor(fetcher: SampleFetcher, baseUrl = './') {
    const emit = () => this.emit()
    this.banks = {
      grand: new SingleSampleBank('grand', fetcher, baseUrl, emit),
      upright: new SingleSampleBank('upright', fetcher, baseUrl, emit),
      rhodes: new SingleSampleBank('rhodes', fetcher, baseUrl, emit),
      wurli: new SingleSampleBank('wurli', fetcher, baseUrl, emit),
    }
  }

  loadBank(bankId: SampleBankId, ctx: AudioContextLike | null): Promise<void> {
    return this.banks[bankId].load(ctx)
  }

  async loadAllBanks(ctx: AudioContextLike | null): Promise<void> {
    // Prioritize Grand first so initial boot matches Phase 1 latency, then Upright, Rhodes, Wurlitzer
    await this.banks.grand.load(ctx)
    await Promise.all([
      this.banks.upright.load(ctx),
      this.banks.rhodes.load(ctx),
      this.banks.wurli.load(ctx),
    ])
  }

  getBankStatus(bankId: SampleBankId): SingleBankStatus {
    return this.banks[bankId].getStatus()
  }

  getAllStatuses(): Record<SampleBankId, SingleBankStatus> {
    return {
      grand: this.banks.grand.getStatus(),
      upright: this.banks.upright.getStatus(),
      rhodes: this.banks.rhodes.getStatus(),
      wurli: this.banks.wurli.getStatus(),
    }
  }

  getFailedBanks(): SampleBankId[] {
    return (['grand', 'upright', 'rhodes', 'wurli'] as const).filter(
      (id) => this.banks[id].getStatus().state === 'error',
    )
  }

  selectAndGetBuffer(
    bankId: SampleBankId,
    midi: number,
    velocity: number,
  ): { selected: BankSelectedSample; buffer: AudioBufferLike | null } {
    const bank = this.banks[bankId]
    const selected = selectBankSample(bankId, midi, velocity, (key) => bank.hasDecoded(key))
    const buffer = bank.getBuffer(selected.region.midi, selected.region.vel)
    return { selected, buffer }
  }

  injectDecodedBuffer(bankId: SampleBankId, midi: number, vel: string, buffer: AudioBufferLike): void {
    this.banks[bankId].injectDecodedBuffer(midi, vel, buffer)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  dispose(): void {
    this.banks.grand.dispose()
    this.banks.upright.dispose()
    this.banks.rhodes.dispose()
    this.banks.wurli.dispose()
    this.listeners.clear()
  }
}

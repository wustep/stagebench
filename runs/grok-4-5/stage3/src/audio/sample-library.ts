/** Sample library loader for Grand / Upright / Electric multi-sample sets */

import type { PianoType } from '../model/piano-types'

export const SAMPLE_ROOTS = [36, 42, 48, 54, 60, 66, 72, 78, 84] as const
export type SampleFamily = 'grand' | 'upright' | 'electric'

export interface SampleKey {
  family: SampleFamily
  root: number
  velocityLayer: 0 | 1
}

export interface LoadedSample {
  key: SampleKey
  buffer: AudioBuffer
}

export interface SampleLibraryOptions {
  /** Base URL for samples (default ./samples/) */
  baseUrl?: string
  /** Injectable fetch */
  fetchImpl?: typeof fetch
  /** Injectable decode via AudioContext */
  decodeAudioData?: (ctx: AudioContext, data: ArrayBuffer) => Promise<AudioBuffer>
  /** Force failure for fallback testing */
  forceFail?: boolean | SampleFamily[]
}

const FAMILY_MAP: Record<'Grand' | 'Upright' | 'Electric', SampleFamily> = {
  Grand: 'grand',
  Upright: 'upright',
  Electric: 'electric',
}

export function familyForType(type: PianoType): SampleFamily | null {
  if (type === 'Grand' || type === 'Upright' || type === 'Electric') return FAMILY_MAP[type]
  return null
}

export function nearestRoot(midi: number): number {
  let best: number = SAMPLE_ROOTS[0]!
  let bestDist = Math.abs(midi - best)
  for (const r of SAMPLE_ROOTS) {
    const d = Math.abs(midi - r)
    if (d < bestDist) {
      best = r
      bestDist = d
    }
  }
  return best
}

export function velocityLayer(velocity: number): 0 | 1 {
  return velocity < 0.55 ? 0 : 1
}

function sampleUrl(base: string, family: SampleFamily, root: number, vel: 0 | 1): string {
  const b = base.endsWith('/') ? base : `${base}/`
  return `${b}${family}/r${root}_v${vel}.wav`
}

/**
 * Build a short synthetic buffer in-memory (fallback / synth types).
 * Distinct recipes per piano type.
 */
export function synthesizeBuffer(
  ctx: BaseAudioContext,
  type: PianoType,
  midi: number,
  velocity: number,
  duration = 1.2,
): AudioBuffer {
  const sr = ctx.sampleRate
  const n = Math.floor(sr * duration)
  const buf = ctx.createBuffer(1, n, sr)
  const data = buf.getChannelData(0)
  const f0 = 440 * Math.pow(2, (midi - 69) / 12)
  const vel = Math.max(0.05, Math.min(1, velocity))

  const recipes: Record<PianoType, { partials: number[]; decay: number; noise: number; bright: number }> = {
    Grand: { partials: [1, 0.4, 0.18, 0.08, 0.04], decay: 2.6, noise: 0.002, bright: 1 },
    Upright: { partials: [1, 0.55, 0.28, 0.12, 0.06], decay: 1.8, noise: 0.006, bright: 0.8 },
    Electric: { partials: [1, 0.1, 0.35, 0.05, 0.08], decay: 2.1, noise: 0.001, bright: 1.2 },
    Clav: { partials: [1, 0.6, 0.4, 0.25, 0.15], decay: 3.5, noise: 0.01, bright: 1.4 },
    Digital: { partials: [1, 0.3, 0.15, 0.05, 0.02], decay: 2.4, noise: 0.001, bright: 0.95 },
    Misc: { partials: [1, 0.2, 0.5, 0.1, 0.3], decay: 4.5, noise: 0.004, bright: 1.1 },
  }
  const r = recipes[type]
  const attack = type === 'Clav' || type === 'Misc' ? 0.002 : 0.006

  for (let i = 0; i < n; i++) {
    const t = i / sr
    let env = t < attack ? t / attack : Math.exp(-(t - attack) * r.decay * (0.8 + (1 - vel) * 0.4))
    env *= vel
    let s = 0
    for (let p = 0; p < r.partials.length; p++) {
      const mult = p + 1
      const amp = r.partials[p]! * Math.pow(r.bright, p) * Math.exp(-t * r.decay * mult * 0.3)
      const inh = type === 'Misc' ? 1 + mult * 0.01 : 1 + mult * mult * 0.00025
      s += amp * Math.sin(2 * Math.PI * f0 * mult * inh * t)
    }
    if (type === 'Electric') {
      s += 0.2 * vel * Math.exp(-t * 35) * Math.sin(2 * Math.PI * f0 * 12 * t)
    }
    if (type === 'Clav') {
      s = Math.tanh(s * 2.2) * 0.9
      s += (Math.random() * 2 - 1) * 0.02 * Math.exp(-t * 20)
    }
    if (type === 'Misc') {
      // mallet: inharmonic + fast decay of high partials already in recipe
      s += 0.15 * Math.sin(2 * Math.PI * f0 * 2.76 * t) * Math.exp(-t * 8)
    }
    s += (Math.random() * 2 - 1) * r.noise * env
    data[i] = s * env * 0.32
  }
  return buf
}

export class SampleLibrary {
  private buffers = new Map<string, AudioBuffer>()
  private baseUrl: string
  private fetchImpl: typeof fetch
  private forceFail: Set<SampleFamily> | 'all' | null
  private loadError: string | null = null

  constructor(opts: SampleLibraryOptions = {}) {
    this.baseUrl = opts.baseUrl ?? './samples/'
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis)
    if (opts.forceFail === true) this.forceFail = 'all'
    else if (Array.isArray(opts.forceFail)) this.forceFail = new Set(opts.forceFail)
    else this.forceFail = null
  }

  getError(): string | null {
    return this.loadError
  }

  has(family: SampleFamily, root: number, vel: 0 | 1): boolean {
    return this.buffers.has(`${family}:${root}:${vel}`)
  }

  get(family: SampleFamily, root: number, vel: 0 | 1): AudioBuffer | null {
    return this.buffers.get(`${family}:${root}:${vel}`) ?? null
  }

  /** Load all three families into the given context */
  async loadAll(ctx: AudioContext): Promise<{ ok: boolean; failed: SampleFamily[] }> {
    const failed: SampleFamily[] = []
    const families: SampleFamily[] = ['grand', 'upright', 'electric']
    for (const family of families) {
      if (this.forceFail === 'all' || this.forceFail?.has(family)) {
        failed.push(family)
        continue
      }
      try {
        await this.loadFamily(ctx, family)
      } catch (e) {
        failed.push(family)
        this.loadError = e instanceof Error ? e.message : String(e)
      }
    }
    if (failed.length === families.length) {
      this.loadError = this.loadError ?? 'All sample families failed to load'
      return { ok: false, failed }
    }
    if (failed.length) {
      this.loadError = `Partial sample load failure: ${failed.join(',')}`
    }
    return { ok: failed.length === 0, failed }
  }

  async loadFamily(ctx: AudioContext, family: SampleFamily): Promise<void> {
    for (const root of SAMPLE_ROOTS) {
      for (const vel of [0, 1] as const) {
        const url = sampleUrl(this.baseUrl, family, root, vel)
        const res = await this.fetchImpl(url)
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
        const ab = await res.arrayBuffer()
        const buffer = await ctx.decodeAudioData(ab.slice(0))
        this.buffers.set(`${family}:${root}:${vel}`, buffer)
      }
    }
  }

  /**
   * Pick buffer for midi/velocity; returns null if missing.
   * Pitch ratio for playbackRate when root ≠ midi.
   */
  pick(
    family: SampleFamily,
    midi: number,
    velocity: number,
  ): { buffer: AudioBuffer; playbackRate: number; root: number } | null {
    const root = nearestRoot(midi)
    const vel = velocityLayer(velocity)
    let buffer = this.get(family, root, vel)
    if (!buffer) buffer = this.get(family, root, vel === 0 ? 1 : 0)
    if (!buffer) {
      // try any root
      for (const r of SAMPLE_ROOTS) {
        buffer = this.get(family, r, vel) ?? this.get(family, r, 0)
        if (buffer) {
          const rate = Math.pow(2, (midi - r) / 12)
          return { buffer, playbackRate: rate, root: r }
        }
      }
      return null
    }
    const rate = Math.pow(2, (midi - root) / 12)
    return { buffer, playbackRate: rate, root }
  }

  clear(): void {
    this.buffers.clear()
  }
}

/** Create AudioBuffers for tests without fetch (inline bake) */
export function bakeTestLibrary(ctx: BaseAudioContext): SampleLibrary {
  const lib = new SampleLibrary({ forceFail: false })
  const families: SampleFamily[] = ['grand', 'upright', 'electric']
  const types: PianoType[] = ['Grand', 'Upright', 'Electric']
  for (let fi = 0; fi < families.length; fi++) {
    const family = families[fi]!
    const type = types[fi]!
    for (const root of SAMPLE_ROOTS) {
      for (const vel of [0, 1] as const) {
        const buffer = synthesizeBuffer(ctx, type, root, vel === 0 ? 0.4 : 0.9, 0.5)
        ;(lib as unknown as { buffers: Map<string, AudioBuffer> }).buffers.set(
          `${family}:${root}:${vel}`,
          buffer,
        )
      }
    }
  }
  return lib
}

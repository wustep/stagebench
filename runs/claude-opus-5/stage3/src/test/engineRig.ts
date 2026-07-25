import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ManualScheduler } from '../audio/graph'
import { OfflineAudioGraph } from '../audio/offline'
import { PianoEngine } from '../audio/pianoEngine'
import { SampleLibrary, type SampleFetcher } from '../audio/sampleLibrary'
import { DEFAULT_SETTINGS, type EngineSettings } from '../audio/settings'

/**
 * Deterministic rig for the audio tests: the offline renderer, a manual clock, and — when a test
 * asks for it — the *real* bundled sample files, read straight off disk through the same loader
 * boundary the browser uses. No network, no devices, no audio output.
 */

const diskCache = new Map<string, ArrayBuffer>()

/** Loads the shipped sample assets from `public/`, proving they work offline. */
export const diskSampleFetcher: SampleFetcher = async (url) => {
  const cached = diskCache.get(url)
  if (cached) return cached
  const path = resolve(process.cwd(), 'public', url)
  const bytes = readFileSync(path)
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  diskCache.set(url, copy)
  return copy
}

/** A fetcher that always fails, for the labelled-fallback tests. */
export const failingSampleFetcher: SampleFetcher = async (url) => {
  throw new Error(`asset unavailable: ${url}`)
}

export interface EngineRig {
  readonly graph: OfflineAudioGraph
  readonly scheduler: ManualScheduler
  readonly engine: PianoEngine
  readonly library: SampleLibrary | null
  readonly baseline: number
}

export interface EngineRigOptions {
  readonly sampleRate?: number
  readonly settings?: EngineSettings
  readonly maxVoices?: number
  readonly fetcher?: SampleFetcher | null
}

export function engineRig(options: EngineRigOptions = {}): EngineRig {
  const graph = new OfflineAudioGraph(options.sampleRate ?? 16000)
  const scheduler = new ManualScheduler()
  const library = options.fetcher ? new SampleLibrary(graph, options.fetcher, 'samples/') : null
  const engine = new PianoEngine(graph, {
    scheduler,
    library,
    maxVoices: options.maxVoices,
    settings: options.settings ?? DEFAULT_SETTINGS,
  })
  return { graph, scheduler, engine, library, baseline: graph.liveNodeCount }
}

/** Builds a rig whose recorded sets are already loaded, so voices really play the recordings. */
export async function loadedRig(options: EngineRigOptions = {}): Promise<EngineRig> {
  const rig = engineRig({ fetcher: diskSampleFetcher, ...options })
  const settings = options.settings ?? DEFAULT_SETTINGS
  const needed = new Set(
    (['a', 'b'] as const)
      .map((id) => settings.layers[id].type)
      .filter((type) => type === 'grand' || type === 'upright' || type === 'electric'),
  )
  for (const type of needed) await rig.library?.load(type as 'grand' | 'upright' | 'electric')
  rig.engine.applySettings(settings)
  return rig
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K]
}

function merge<T>(base: T, patch: DeepPartial<T>): T {
  const result = { ...base } as Record<string, unknown>
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = result[key]
    if (value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object') {
      result[key] = merge(current, value as DeepPartial<typeof current>)
    } else if (value !== undefined) {
      result[key] = value
    }
  }
  return result as T
}

/** Engine settings with a deep patch applied, so a test can vary exactly one thing. */
export function settingsWith(patch: DeepPartial<EngineSettings>, base: EngineSettings = DEFAULT_SETTINGS): EngineSettings {
  return merge(base, patch)
}

/** Plays one note and returns the rendered mono output. */
export function renderNote(
  rig: EngineRig,
  { midi = 60, velocity = 0.8, seconds = 1, holdSeconds }: { midi?: number; velocity?: number; seconds?: number; holdSeconds?: number } = {},
): Float32Array {
  rig.engine.noteOn('test', midi, velocity)
  if (holdSeconds !== undefined) {
    rig.graph.advanceClock(holdSeconds)
    rig.engine.noteOff('test')
  }
  return rig.graph.render(seconds)
}

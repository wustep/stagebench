/**
 * The Web Audio backend.
 *
 * One `AudioContext`, one destination, and exactly one master path. Every voice reaches
 * the output the same way:
 *
 *   voice -> layer chain (Mod 1 -> Mod 2 -> Delay -> Amp/EQ -> Comp -> Reverb -> Rotary?)
 *         -> layer level -> master gain -> limiter -> destination
 *
 * Nothing bypasses the master gain and limiter; `effects.graph` asserts it structurally
 * (exactly one destination connection) and the audio tests assert it audibly.
 */
import type {
  AudioBufferLike,
  AudioContextFactory,
  AudioContextLike,
  AudioEngine,
  AudioStatusReport,
  ChainOwner,
  CompressorLike,
  GainNodeLike,
  LayerId,
  PianoModelId,
  VoiceHandle,
  VoiceSettings,
} from './types'
import { ramp, safeDisconnect, setNow } from './nodes'
import { releaseSecondsFor } from './pianoModel'
import type { EffectStore } from './effectState'
import { createEffectStore, defaultEffectState } from './effectState'
import { createChain, buildRotary, createRotaryReturn, type ChainNodes, type RotaryUnit } from './effectGraph'
import {
  SampleBank,
  SAMPLE_MODEL_FOR_PIANO_MODEL,
  buildIndex,
  createModelledVoice,
  createSampleVoice,
  type SampleEntry,
  type VoiceNodes,
} from './pianoVoice'
import sampleManifest from './sample-manifest.json'
import sampleGains from './sample-gains.json'

/** Fixed master stage. Every voice passes through it; nothing bypasses it. */
export const MASTER_GAIN = 0.72
/** Limiter ceiling, so a dense passage cannot clip the destination. */
export const LIMITER_CEILING = 0.96
export const MAX_VOICES = 16

export interface WebAudioEngineOptions {
  createContext: AudioContextFactory
  maxVoices?: number
  masterGain?: number
  onVoiceEnded?: (voiceId: string) => void
  /** Where the bundled sample files live. Defaults to `./samples/`. */
  sampleBaseUrl?: string
  fetchBytes?: (url: string) => Promise<ArrayBuffer>
  /** Injection point for tests: provide the manifest instead of shipping JSON imports. */
  sampleEntries?: SampleEntry[]
  sampleLevels?: Record<string, number>
}

interface LiveVoice {
  handle: VoiceHandle
  nodes: VoiceNodes
  layer: ChainOwner
  ended: boolean
  timedStop: ReturnType<typeof setTimeout> | null
}

export interface PianoEngine extends AudioEngine {
  /** Layer level fader, 0..1. */
  setLayerLevel(layer: LayerId, value: number): void
  setLayerEnabled(layer: LayerId, enabled: boolean): void
  setMasterLevel(value: number): void
  /** Effect/routing state, shared with the panel. */
  readonly effects: EffectStore
  /** Applies the current effect state to the graph (called after a panel edit). */
  syncEffects(): void
  /** Loads the samples a model needs. Resolves with the files that failed. */
  preloadModel(modelId: string): Promise<string[]>
  /** Truthful library status for the display. */
  libraryStatus(): LibraryStatus
  /** Layer voice counts, for voice-ownership tests. */
  voicesByLayer(): Record<ChainOwner, number>
  /** Shared rotary, exposed for node accounting. */
  readonly rotary: RotaryUnit | null
  readonly chains: Record<ChainOwner, ChainNodes> | null
  readonly context: AudioContextLike | null
  /** True when a sample failed and the modelled fallback is what is sounding. */
  readonly usingFallback: boolean
  /** False when this backend cannot host the effect graph; the display says so. */
  readonly effectsAvailable: boolean
  /** Why the effect graph could not be built, or null when it was. */
  readonly effectGraphError: string | null
}

export interface LibraryStatus {
  state: 'idle' | 'loading' | 'ready' | 'error' | 'fallback'
  /** Model that failed, when state is error/fallback. */
  model: string | null
  detail: string
  loadedFiles: number
  failedFiles: number
}

const FALLBACK_ENTRIES: SampleEntry[] = sampleManifest as SampleEntry[]
const FALLBACK_GAINS: Record<string, number> = sampleGains as Record<string, number>

export function createWebAudioEngine(options: WebAudioEngineOptions): PianoEngine {
  const { createContext, onVoiceEnded } = options
  const maxVoices = options.maxVoices ?? MAX_VOICES
  const masterLevel = options.masterGain ?? MASTER_GAIN
  const sampleBaseUrl = options.sampleBaseUrl ?? './samples/'
  const entries = options.sampleEntries ?? FALLBACK_ENTRIES
  const levels = options.sampleLevels ?? FALLBACK_GAINS

  let context: AudioContextLike | null = null
  let master: GainNodeLike | null = null
  let limiter: CompressorLike | null = null
  let rotary: RotaryUnit | null = null
  let chains: Record<ChainOwner, ChainNodes> | null = null
  let bank: SampleBank | null = null
  let report: AudioStatusReport = { status: 'idle', detail: 'Audio engine not started' }
  const listeners = new Set<(report: AudioStatusReport) => void>()
  const voices = new Map<string, LiveVoice>()
  let liveNodes = 0
  let disposed = false
  /** Models whose samples failed to load, so the modelled fallback is what sounds. */
  const fallbackModels = new Set<PianoModelId>()
  let effectsAvailable = false
  let effectGraphError: string | null = null
  let library: LibraryStatus = {
    state: 'idle',
    model: null,
    detail: 'Piano library not loaded',
    loadedFiles: 0,
    failedFiles: 0,
  }
  const layerLevels: Record<ChainOwner, number> = { 'piano.a': 0.8, 'piano.b': 0.8 }
  const layerEnabled: Record<ChainOwner, boolean> = { 'piano.a': true, 'piano.b': false }
  let masterLevelValue = masterLevel
  const effects = createEffectStore()
  const preloads = new Map<string, Promise<string[]>>()

  const index = buildIndex(entries)

  function publish(next: AudioStatusReport): void {
    report = next
    for (const listener of listeners) listener(next)
  }

  function publishLibrary(next: LibraryStatus): void {
    library = next
  }

  /**
   * Builds the whole graph once. Returns null when the context cannot be created, so the
   * caller can report an honest fallback instead of pretending to play.
   */
  function buildContext(): AudioContextLike | null {
    if (context) return context
    publish({ status: 'loading', detail: 'Preparing audio engine' })
    try {
      const created = createContext()
      const masterGain = created.createGain()
      masterGain.gain.value = masterLevelValue
      masterGain.gain.setValueAtTime(masterLevelValue, created.currentTime)

      // A limiter sits between the master gain and the destination so the master path is
      // always master gain -> limiter -> destination, with nothing else on the way out.
      let limiterNode: CompressorLike | null = null
      try {
        if (created.createDynamicsCompressor) {
          limiterNode = created.createDynamicsCompressor()
          setNow(limiterNode.threshold, -1.5, created.currentTime)
          setNow(limiterNode.knee, 0, created.currentTime)
          setNow(limiterNode.ratio, 20, created.currentTime)
          setNow(limiterNode.attack, 0.002, created.currentTime)
          setNow(limiterNode.release, 0.12, created.currentTime)
        }
      } catch {
        limiterNode = null
      }

      if (limiterNode) {
        masterGain.connect(limiterNode)
        limiterNode.connect(created.destination)
      } else {
        masterGain.connect(created.destination)
      }

      context = created
      master = masterGain
      limiter = limiterNode
      liveNodes = limiterNode ? 2 : 1

      // Layer buses -> chains -> layer level -> master.
      //
      // A backend that implements only the Phase 1 node set (gain + buffer source) cannot
      // host filters, delays or convolution. Rather than failing or silently pretending,
      // the engine builds a plain layer bus and reports `effectsAvailable: false`, which
      // the display prints as "effects unavailable".
      try {
        const sharedRotary = buildRotary(created)
        rotary = sharedRotary
        liveNodes += sharedRotary.nodeCount()
        const madeChains = {
          'piano.a': createChain(created, 'piano.a', sharedRotary),
          'piano.b': createChain(created, 'piano.b', sharedRotary),
        }
        chains = madeChains
        for (const owner of ['piano.a', 'piano.b'] as ChainOwner[]) {
          const chain = madeChains[owner]
          setNow(chain.level.gain, layerEnabled[owner] ? layerLevels[owner] : 0, created.currentTime)
          chain.output.connect(masterGain)
          liveNodes += chain.nodeCount() + 1
        }
        // One shared rotary return joins the master path, so everything a routed layer
        // sends through the rotary still passes master gain and the limiter.
        createRotaryReturn(created, sharedRotary).connect(masterGain)
        liveNodes += 1
        effectsAvailable = true
      } catch (error) {
        chains = null
        rotary = null
        effectsAvailable = false
        // Never swallow why the effect graph could not be built: the display reports it and
        // the tests can assert on it, instead of the failure hiding behind a bare catch.
        effectGraphError = describeError(error)
        publish({
          status: 'ready',
          detail: `Audio ready without effects: ${effectGraphError}`,
        })
      }

      bank = new SampleBank({
        ctx: created,
        index,
        gains: levels,
        baseUrl: sampleBaseUrl,
        fetchBytes: options.fetchBytes,
      })

      // Push the current effect settings into the fresh graph.
      syncEffects()

      publish({ status: 'idle', detail: 'Audio engine prepared, waiting for a gesture' })
      return context
    } catch (error) {
      publish({
        status: 'error',
        detail: `Audio unavailable: ${describeError(error)}`,
      })
      context = null
      master = null
      limiter = null
      chains = null
      rotary = null
      bank = null
      liveNodes = 0
      return null
    }
  }

  function syncEffects(): void {
    if (!context || !chains) return
    const now = context.currentTime
    const state = effects.get()
    for (const owner of ['piano.a', 'piano.b'] as ChainOwner[]) {
      chains[owner].update(state, now)
      // The layer fader follows the presentation state; the layer's own on/off is a mute
      // of that fader, so a disabled layer still owns a silent bus.
      const target = layerEnabled[owner] ? layerLevels[owner] : 0
      ramp(chains[owner].level.gain, target, now)
    }
    rotary?.apply(state, now)
  }

  function ensureRunning(): AudioStatusReport {
    const ctx = buildContext()
    if (!ctx) {
      return report.status === 'error'
        ? report
        : { status: 'error', detail: 'Audio unavailable in this browser' }
    }
    return { status: 'ready', detail: `Audio ready · ${Math.round(ctx.sampleRate)} Hz` }
  }

  function releaseVoice(voice: LiveVoice): void {
    if (voice.ended) return
    voice.ended = true
    voices.delete(voice.handle.id)
    if (voice.timedStop) clearTimeout(voice.timedStop)
    voice.nodes.stop()
    liveNodes = Math.max(0, liveNodes - voice.nodes.nodes)
    onVoiceEnded?.(voice.handle.id)
  }

  function stopAll(): void {
    for (const voice of Array.from(voices.values())) releaseVoice(voice)
  }

  function voiceFor(settings: VoiceSettings, handle: VoiceHandle, ctx: AudioContextLike): VoiceNodes | null {
    const playedMidi = handle.midi
    const model = settings.model
    const sampleModel = SAMPLE_MODEL_FOR_PIANO_MODEL[model]
    // Recorded models play a real recording. If the recording could not be loaded, the
    // same note is produced by the modelled voice and `usingFallback` records the truth.
    if (sampleModel && bank && ctx.decodeAudioData && !fallbackModels.has(model as PianoModelId)) {
      const resolved = bank.resolve(sampleModel, playedMidi, settings.velocity)
      const buffer = resolved ? bank.bufferFor(resolved.entry.file) : undefined
      if (resolved && buffer) {
        return createSampleVoice(
          ctx,
          bank,
          resolved.entry,
          { ...settings, midi: handle.midi, playedMidi },
          buffer,
        )
      }
      if (resolved && !bank.isLoaded(resolved.entry.file)) {
        // The recording is not resident yet. Rather than silence or a different sound
        // presented as the recording, the same note is produced by the modelled voice and
        // `libraryStatus` keeps reporting `loading` until the real samples arrive.
        return createModelledVoice(ctx, { ...settings, midi: handle.midi, playedMidi })
      }
    }
    return createModelledVoice(ctx, { ...settings, midi: handle.midi, playedMidi })
  }

  return {
    kind: 'webaudio',
    effects,
    get context() {
      return context
    },
    get rotary() {
      return rotary
    },
    get chains() {
      return chains
    },
    get usingFallback() {
      return fallbackModels.size > 0
    },
    get effectsAvailable() {
      return effectsAvailable
    },
    get effectGraphError() {
      return effectGraphError
    },

    status() {
      if (report.status === 'ready' && context && context.state !== 'running') {
        return { status: 'suspended', detail: 'Audio suspended — press a key or click to resume' }
      }
      return report
    },

    async start() {
      if (disposed) return { status: 'error', detail: 'Audio engine disposed' }
      const next = ensureRunning()
      if (next.status !== 'ready' || !context) {
        return report.status === 'error'
          ? report
          : { status: 'fallback', detail: 'No audio output — the keybed is silent in this browser' }
      }
      if (context.state !== 'running') {
        try {
          await context.resume()
        } catch (error) {
          return {
            status: 'fallback',
            detail: `Audio could not start: ${describeError(error)}`,
          }
        }
      }
      publish({ status: 'ready', detail: `Audio ready · ${Math.round(context.sampleRate)} Hz` })
      return report
    },

    noteOn(voice: VoiceHandle) {
      if (disposed || report.status === 'error' || report.status === 'fallback') return
      const ctx = buildContext()
      if (!ctx || !master) return
      const settings = settingsFor(voice)
      const layer: ChainOwner = settings.layer === 'piano.b' ? 'piano.b' : 'piano.a'
      if (!layerEnabled[layer]) return
      if (voices.size >= maxVoices) {
        const oldest = voices.values().next().value as LiveVoice | undefined
        if (oldest) releaseVoice(oldest)
      }
      try {
        const nodes = voiceFor(settings, voice, ctx)
        if (!nodes) return
        const chain = chains?.[layer]
        // Without effect nodes the voice still reaches the master path directly, so the
        // instrument always sounds and never bypasses the master gain.
        nodes.output.connect(chain ? chain.input : master)
        const live: LiveVoice = {
          handle: voice,
          nodes,
          layer,
          ended: false,
          timedStop: null,
        }
        voices.set(voice.id, live)
        liveNodes += nodes.nodes
        // Reclaim the voice when the platform reports its source finished. The last source
        // to end is the one that owns the voice's lifetime.
        const sources = nodes.sources
        sources.forEach((source, sourceIndex) => {
          source.onended = () => {
            if (sourceIndex !== sources.length - 1) return
            const current = voices.get(voice.id)
            if (current && !current.ended) releaseVoice(current)
          }
        })
        nodes.start(ctx.currentTime)
      } catch (error) {
        publish({ status: 'error', detail: `Audio error: ${describeError(error)}` })
        stopAll()
      }
    },

    noteOff(voiceId: string) {
      const voice = voices.get(voiceId)
      if (!voice || !context) return
      const now = context.currentTime
      voice.nodes.release(now)
      // The source stops itself after the release curve; drop the bookkeeping then so a
      // sustained note is not reclaimed early.
      const settings = settingsFor(voice.handle)
      const tail = releaseSecondsFor(voice.handle.midi) * (settings.softRelease ? 1.7 : 1)
      voice.timedStop = setTimeout(() => {
        const current = voices.get(voiceId)
        if (current && !current.ended) releaseVoice(current)
      }, (tail + 0.12) * 1000)
    },

    stopAll,

    activeVoiceCount() {
      return voices.size
    },

    liveNodeCount() {
      return liveNodes
    },

    subscribe(listener) {
      listeners.add(listener)
      listener(report)
      return () => {
        listeners.delete(listener)
      }
    },

    setLayerLevel(layer: LayerId, value: number) {
      const owner: ChainOwner = layer === 'piano.b' ? 'piano.b' : 'piano.a'
      layerLevels[owner] = Math.min(1, Math.max(0, value))
      if (context && chains) {
        const target = layerEnabled[owner] ? layerLevels[owner] : 0
        ramp(chains[owner].level.gain, target, context.currentTime)
      }
    },

    setLayerEnabled(layer: LayerId, enabled: boolean) {
      const owner: ChainOwner = layer === 'piano.b' ? 'piano.b' : 'piano.a'
      layerEnabled[owner] = enabled
      if (!enabled) {
        // A disabled layer must not leave a note ringing on its bus.
        for (const voice of Array.from(voices.values())) {
          if (voice.layer === owner) releaseVoice(voice)
        }
      }
      if (context && chains) {
        ramp(chains[owner].level.gain, enabled ? layerLevels[owner] : 0, context.currentTime)
      }
    },

    setMasterLevel(value: number) {
      masterLevelValue = Math.min(1, Math.max(0, value))
      if (context && master) ramp(master.gain, masterLevelValue, context.currentTime)
    },

    syncEffects,

    async preloadModel(modelId: string) {
      const existing = preloads.get(modelId)
      if (existing) return existing
      const sampleModel = SAMPLE_MODEL_FOR_PIANO_MODEL[modelId as PianoModelId]
      if (!sampleModel) {
        publishLibrary({
          state: 'ready',
          model: null,
          detail: 'Modelled piano — no samples to load',
          loadedFiles: 0,
          failedFiles: 0,
        })
        return []
      }
      const ctx = buildContext()
      if (!ctx || !bank) {
        publishLibrary({
          state: 'error',
          model: modelId,
          detail: 'Piano not found — no audio context to load samples',
          loadedFiles: 0,
          failedFiles: 0,
        })
        return ['no-context']
      }
      publishLibrary({
        state: 'loading',
        model: modelId,
        detail: 'Loading piano samples…',
        loadedFiles: bank.loadedCount,
        failedFiles: 0,
      })
      const sampler = bank
      const task = sampler.preloadModel(sampleModel).then((failures) => {
        if (failures.length > 0) {
          // The spec's missing-model state (manual p. 24): the display reports the failure
          // and the modelled fallback stays playable, so the library is never claimed ready.
          fallbackModels.add(modelId as PianoModelId)
          publishLibrary({
            state: 'fallback',
            model: modelId,
            detail: 'Piano not found — playing the modelled fallback',
            loadedFiles: sampler.loadedCount,
            failedFiles: failures.length,
          })
        } else {
          fallbackModels.delete(modelId as PianoModelId)
          publishLibrary({
            state: 'ready',
            model: modelId,
            detail: `Piano library ready · ${sampler.loadedCount} samples`,
            loadedFiles: sampler.loadedCount,
            failedFiles: 0,
          })
        }
        return failures
      })
      preloads.set(modelId, task)
      return task
    },

    libraryStatus() {
      return library
    },

    voicesByLayer() {
      const counts: Record<ChainOwner, number> = { 'piano.a': 0, 'piano.b': 0 }
      for (const voice of voices.values()) counts[voice.layer] += 1
      return counts
    },

    dispose() {
      if (disposed) return
      stopAll()
      disposed = true
      rotary?.dispose()
      for (const owner of ['piano.a', 'piano.b'] as ChainOwner[]) chains?.[owner].dispose()
      safeDisconnect(master)
      safeDisconnect(limiter)
      const ctx = context
      context = null
      master = null
      limiter = null
      chains = null
      rotary = null
      bank = null
      liveNodes = 0
      if (ctx?.close) void Promise.resolve(ctx.close()).catch(() => undefined)
      listeners.clear()
      report = { status: 'idle', detail: 'Audio engine disposed' }
    },
  }
}

/** Silent engine: honest "fallback" status, no nodes, no output. */
export function createSilentEngine(detail = 'No audio output in this environment'): AudioEngine {
  let report: AudioStatusReport = { status: 'fallback', detail }
  const listeners = new Set<(report: AudioStatusReport) => void>()
  return {
    kind: 'silent',
    status: () => report,
    async start() {
      report = { status: 'fallback', detail }
      for (const l of listeners) l(report)
      return report
    },
    noteOn() {},
    noteOff() {},
    stopAll() {},
    activeVoiceCount: () => 0,
    liveNodeCount: () => 0,
    subscribe(listener) {
      listeners.add(listener)
      listener(report)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      listeners.clear()
      report = { status: 'idle', detail: 'Audio engine disposed' }
    },
  }
}

function settingsFor(handle: VoiceHandle): VoiceSettings {
  return (
    handle.settings ?? {
      velocity: handle.velocity,
      layer: 'piano.a',
      octave: 0,
      model: 'grand.salamander',
      touchExponent: 1,
      dynComp: 0,
      timbre: 0,
      unison: 0,
      softRelease: false,
      stringRes: false,
    }
  )
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

/** Re-exported so the panel and tests share one default state. */
export { defaultEffectState }
export type { AudioBufferLike, VoiceSettings }

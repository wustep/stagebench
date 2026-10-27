/**
 * The Web Audio backend.
 *
 * One `AudioContext`, one destination, and exactly one master path. Every voice reaches the
 * output the same way, whichever engine made it:
 *
 *   voice -> layer chain (Mod 1 -> Mod 2 -> Delay -> Amp/EQ -> Comp -> Reverb -> Rotary?)
 *         -> layer level -> master gain -> limiter -> destination
 *
 * Phase 3 extends the Phase 2 graph from two piano chains to all six the spec documents:
 * Piano A, Piano B, the one shared Organ chain, and Synth A/B/C. Nothing was forked: the
 * organ and synth voices enter the same `createChain` instances the piano already used, so
 * there is still one context, one master gain, one limiter and one destination.
 */
import type {
  AudioContextFactory,
  AudioContextLike,
  AudioEngine,
  AudioStatusReport,
  ChainOwner,
  CompressorLike,
  EngineId,
  GainNodeLike,
  LayerId,
  PianoModelId,
  SynthVoiceRequest,
  VoiceHandle,
  VoiceSettings,
} from './types'
import { CHAIN_OWNERS, chainOwnerFor, engineFor } from './types'
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
import { createOrganVoice, type OrganVoiceNodes, type OrganVoiceSettings } from './organVoice'
import { createSynthVoice, renderSynthNote, type SynthVoiceNodes, type SynthVoiceSettings } from './synthVoice'
import { defaultOrganState, type OrganState } from './organState'
import { defaultSynthState, type SynthLayerId, type SynthState } from './synthState'
import { planArp, stepSecondsFor } from './synthModel'
import { defaultPianoState, type PianoState } from './pianoState'
import sampleManifest from './sample-manifest.json'
import sampleGains from './sample-gains.json'

/** Fixed master stage. Every voice passes through it; nothing bypasses it. */
export const MASTER_GAIN = 0.72
/** Limiter ceiling, so a dense passage cannot clip the destination. */
export const LIMITER_CEILING = 0.96
export const MAX_VOICES = 24

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
  nodes: VoiceNodes | OrganVoiceNodes | SynthVoiceNodes
  layer: LayerId
  owner: ChainOwner
  engine: EngineId
  ended: boolean
  timedStop: ReturnType<typeof setTimeout> | null
}

/** Every engine can be driven through the one shared handle type. */
export interface InstrumentEngine extends AudioEngine {
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
  /** Layer voice counts, by chain owner, for voice-ownership tests. */
  voicesByLayer(): Record<ChainOwner, number>
  /** Voice counts per engine, so a layer's ownership is directly observable. */
  voicesByEngine(): Record<EngineId, number>
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
  /** The organ and synth engines are installed on every backend that can render a voice. */
  setOrganState(state: OrganState): void
  setSynthState(state: SynthState): void
  setPianoState(state: PianoState): void
  /** The master clock, so delay/arp/LFO sync read one tempo. */
  setClock(bpm: number): void
  /** The mod wheel position, which drives the Wheel vibrato source. */
  setModWheel(value: number): void
  /** The current tempo the graph is using. */
  readonly tempo: number
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

/** Kept as an alias so Phase 1/2 imports keep compiling. */
export type PianoEngine = InstrumentEngine

export function createWebAudioEngine(options: WebAudioEngineOptions): InstrumentEngine {
  const { createContext, onVoiceEnded } = options
  const maxVoices = options.maxVoices ?? MAX_VOICES
  const masterLevel = options.masterGain ?? MASTER_GAIN
  const sampleBaseUrl = options.sampleBaseUrl ?? './samples/'
  const entries = options.sampleEntries ?? FALLBACK_ENTRIES
  const levels = options.sampleLevels ?? FALLBACK_GAINS

  let context: AudioContextLike | null = null
  let master: GainNodeLike | null = null
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
  const layerLevels: Record<LayerId, number> = {
    'piano.a': 0.8,
    'piano.b': 0.8,
    'organ.a': 0.72,
    'organ.b': 0,
    'synth.a': 0.66,
    'synth.b': 0,
    'synth.c': 0,
  }
  const layerEnabled: Record<LayerId, boolean> = {
    'piano.a': true,
    'piano.b': false,
    'organ.a': true,
    'organ.b': false,
    'synth.a': true,
    'synth.b': false,
    'synth.c': false,
  }
  let masterLevelValue = masterLevel
  let tempo = 120
  let modWheel = 0
  let organState: OrganState = defaultOrganState()
  let synthState: SynthState = defaultSynthState()
  let pianoState: PianoState = defaultPianoState()
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
        const madeChains = {} as Record<ChainOwner, ChainNodes>
        for (const owner of CHAIN_OWNERS) {
          madeChains[owner] = createChain(created, owner, sharedRotary)
        }
        chains = madeChains
        for (const owner of CHAIN_OWNERS) {
          const chain = madeChains[owner]
          // Both organ layers share this one chain, so its level is their combined gain.
          setNow(chain.level.gain, chainLevelFor(owner), created.currentTime)
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
      chains = null
      rotary = null
      bank = null
      liveNodes = 0
      return null
    }
  }

  /**
   * The gain one chain's level stage should carry.
   *
   * The Organ's two layers share one chain, so their faders have to be combined into that
   * single stage. They **sum** rather than taking the maximum: each layer's voice already
   * arrives at the chain at unit level, so the shared fader is what gives each layer its
   * volume. Summing means a layer at 0 is silent while the other plays, which is exactly
   * what two independent faders into one bus do. A ceiling keeps two layers at full fader
   * from running the master path 2× over.
   */
  function chainLevelFor(owner: ChainOwner): number {
    if (owner === 'organ') {
      let total = 0
      for (const layer of ['organ.a', 'organ.b'] as const) {
        if (layerEnabled[layer]) total += layerLevels[layer]
      }
      return Math.min(1, total)
    }
    return layerEnabled[owner as LayerId] ? layerLevels[owner as LayerId] : 0
  }

  function syncEffects(): void {
    if (!context || !chains) return
    const now = context.currentTime
    const state = effects.get()
    for (const owner of CHAIN_OWNERS) {
      chains[owner].update(state, now)
      // The layer fader follows the presentation state; the layer's own on/off is a mute
      // of that fader, so a disabled layer still owns a silent bus.
      ramp(chains[owner].level.gain, chainLevelFor(owner), now)
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

  function pianoVoiceFor(settings: VoiceSettings, handle: VoiceHandle, ctx: AudioContextLike): VoiceNodes | null {
    const playedMidi = handle.midi
    const model = settings.model
    const sampleModel = SAMPLE_MODEL_FOR_PIANO_MODEL[model]
    // Recorded models play a real recording. If the recording could not be loaded, the
    // same note is produced by the modelled voice and `usingFallback` records the truth.
    if (sampleModel && bank && ctx.decodeAudioData && !fallbackModels.has(model as PianoModelId)) {
      const resolved = bank.resolve(sampleModel, playedMidi, settings.velocity)
      const buffer = resolved ? bank.bufferFor(resolved.entry.file) : undefined
      if (resolved && buffer) {
        return createSampleVoice(ctx, bank, resolved.entry, { ...settings, midi: handle.midi, playedMidi }, buffer)
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

  /**
   * Whether a layer may sound a note, from its section and layer enable state and its split
   * zones. The session makes the same decision before it asks the engine for a voice; the
   * engine checks again so a stale handle can never sound a layer the panel has switched off.
   */
  function layerSounds(layer: LayerId): boolean {
    if (!layerEnabled[layer]) return false
    if (layer.startsWith('piano')) {
      const id = layer as 'piano.a' | 'piano.b'
      return pianoState.sectionOn && pianoState.layers[id].enabled
    }
    if (layer.startsWith('organ')) {
      const id = layer as 'organ.a' | 'organ.b'
      return organState.sectionOn && organState.layers[id].enabled
    }
    const id = layer as 'synth.a' | 'synth.b' | 'synth.c'
    return synthState.sectionOn && synthState.layers[id].enabled
  }

  function organVoiceFor(layerId: 'organ.a' | 'organ.b', handle: VoiceHandle, ctx: AudioContextLike): OrganVoiceNodes | null {
    const layer = organState.layers[layerId]
    if (!layer) return null
    // The session supplies the per-voice payload; a direct `noteOn` (a test or an
    // automation) may omit it, in which case the layer's own state decides. Falling back
    // here is what keeps "the engine reads its own state" true for every caller.
    const request = handle.organSettings ?? {
      vibratoOn: layer.vibratoOn,
      vibratoType: layer.vibratoType,
      percussion: { ...layer.percussion },
      keyClick: layer.keyClick,
      zoneGain: 1,
    }
    // Percussion is single-triggered by default: it retriggers only when no other organ note
    // is sounding, and POLY mode retriggers on every stroke (manual p. 20).
    const otherOrganVoices = Array.from(voices.values()).some(
      (voice) => voice.engine === 'organ' && voice.handle.id !== handle.id,
    )
    const retrigger = request.percussion.poly || !otherOrganVoices
    const voiceSettings: OrganVoiceSettings = {
      model: layer.model,
      drawbars: layer.drawbars,
      midi: handle.midi,
      velocity: handle.velocity,
      level: 1,
      vibratoOn: request.vibratoOn,
      vibratoType: request.vibratoType,
      percussion: { ...request.percussion, retrigger },
      keyClick: request.keyClick,
      zoneGain: request.zoneGain,
    }
    return createOrganVoice(ctx, voiceSettings)
  }

  function synthVoiceFor(handle: VoiceHandle, ctx: AudioContextLike): SynthVoiceNodes | null {
    const layerId = handle.layer as SynthLayerId | undefined
    if (!layerId) return null
    const layer = synthState.layers[layerId]
    if (!layer) return null
    // The session supplies the per-voice payload. A direct `noteOn` (a test or an
    // automation) may omit it, so the layer's own state plus sensible defaults decide —
    // the same fallback the organ voice has, for the same reason.
    const request: SynthVoiceRequest = handle.synthSettings ?? {
      holdSeconds: 2,
      releaseSeconds: Math.max(0.05, layer.ampEnv.release * 0.4),
      glideFrom: null,
      modWheel: modWheel,
      lfoRateHz: 4,
      zoneGain: 1,
    }
    const settings: SynthVoiceSettings = {
      layer,
      midi: handle.midi,
      velocity: handle.velocity,
      level: 1,
      zoneGain: request.zoneGain,
      holdSeconds: request.holdSeconds,
      releaseSeconds: request.releaseSeconds,
      glideFrom: request.glideFrom,
      modWheel: request.modWheel,
      lfoRateHz: request.lfoRateHz,
      arpGate: request.arpGate ?? null,
    }
    return createSynthVoice(ctx, settings)
  }

  function voiceFor(handle: VoiceHandle, ctx: AudioContextLike) {
    const layer: LayerId = handle.layer ?? (handle.settings?.layer as LayerId) ?? 'piano.a'
    if (layer.startsWith('organ')) return organVoiceFor(layer as 'organ.a' | 'organ.b', handle, ctx)
    if (layer.startsWith('synth')) return synthVoiceFor(handle, ctx)
    return pianoVoiceFor(handle.settings ?? settingsFor(handle), handle, ctx)
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
    get tempo() {
      return tempo
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
      const layer: LayerId = voice.layer ?? (voice.settings?.layer as LayerId) ?? 'piano.a'
      if (!layerSounds(layer)) return
      const owner = chainOwnerFor(layer)
      if (voices.size >= maxVoices) {
        const oldest = voices.values().next().value as LiveVoice | undefined
        if (oldest) releaseVoice(oldest)
      }
      try {
        const nodes = voiceFor(voice, ctx)
        if (!nodes) return
        const chain = chains?.[owner]
        // Without effect nodes the voice still reaches the master path directly, so the
        // instrument always sounds and never bypasses the master gain.
        nodes.output.connect(chain ? chain.input : master)
        const live: LiveVoice = {
          handle: voice,
          nodes,
          layer,
          owner,
          engine: engineFor(layer),
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
      const settings = voice.handle.settings
      const soft = settings?.softRelease ?? false
      const engine = voice.engine
      // Organ notes have no decay; synth notes already carry their release in the buffer.
      const tail =
        engine === 'organ'
          ? 0.06
          : engine === 'synth'
            ? Math.min(4, Math.max(0.05, voice.handle.synthSettings?.releaseSeconds ?? 1))
            : releaseSecondsFor(voice.handle.midi) * (soft ? 1.7 : 1)
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
      layerLevels[layer] = Math.min(1, Math.max(0, value))
      if (context && chains) {
        const owner = chainOwnerFor(layer)
        ramp(chains[owner].level.gain, chainLevelFor(owner), context.currentTime)
      }
    },

    setLayerEnabled(layer: LayerId, enabled: boolean) {
      layerEnabled[layer] = enabled
      const owner = chainOwnerFor(layer)
      if (!enabled) {
        // A disabled layer must not leave a note ringing on its bus.
        for (const voice of Array.from(voices.values())) {
          if (voice.layer === layer) releaseVoice(voice)
        }
      }
      if (context && chains) {
        ramp(chains[owner].level.gain, chainLevelFor(owner), context.currentTime)
      }
    },

    setMasterLevel(value: number) {
      masterLevelValue = Math.min(1, Math.max(0, value))
      if (context && master) ramp(master.gain, masterLevelValue, context.currentTime)
    },

    syncEffects,

    setOrganState(state) {
      organState = state
      // The section/layer flags arrive here, so they are the authority: mirroring them into
      // the engine's own enable table keeps the two gates from disagreeing.
      for (const layer of ['organ.a', 'organ.b'] as const) {
        layerEnabled[layer] = state.sectionOn && state.layers[layer].enabled
      }
      syncEffects()
    },

    setSynthState(state) {
      synthState = state
      for (const layer of ['synth.a', 'synth.b', 'synth.c'] as const) {
        layerEnabled[layer] = state.sectionOn && state.layers[layer].enabled
      }
      syncEffects()
    },

    setPianoState(state) {
      pianoState = state
      for (const layer of ['piano.a', 'piano.b'] as const) {
        layerEnabled[layer] = state.sectionOn && state.layers[layer].enabled
      }
      syncEffects()
    },

    setClock(bpm) {
      tempo = Math.min(300, Math.max(30, bpm))
    },

    setModWheel(value) {
      modWheel = Math.min(1, Math.max(0, value))
    },

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
      const counts = {} as Record<ChainOwner, number>
      for (const owner of CHAIN_OWNERS) counts[owner] = 0
      for (const voice of voices.values()) counts[voice.owner] += 1
      return counts
    },

    voicesByEngine() {
      const counts: Record<EngineId, number> = { piano: 0, organ: 0, synth: 0 }
      for (const voice of voices.values()) counts[voice.engine] += 1
      return counts
    },

    dispose() {
      if (disposed) return
      stopAll()
      disposed = true
      rotary?.dispose()
      for (const owner of CHAIN_OWNERS) chains?.[owner].dispose()
      safeDisconnect(master)
      const ctx = context
      context = null
      master = null
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
export type { VoiceSettings }

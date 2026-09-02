/**
 * PianoEngine: one deterministic note lifecycle feeding two piano layers.
 *
 *   voice = AudioBufferSourceNode(s) (recorded sample or generated buffer) [→ StereoPanner for unison sides]
 *           → voice GainNode → layer bus GainNode → LayerChain processor → layer level GainNode
 *           → (shared Rotary processor when routed) → master GainNode → master limiter processor → destination
 *
 * Status is reported exactly as observed: idle / loading / ready / error / fallback, per layer and overall.
 * Without a sample library (Phase 1 tests) the engine behaves exactly like Phase 1: one generated voice.
 */
import type { AudioBufferLike, AudioContextLike, BufferSourceLike, GainNodeLike, OscillatorLike, ProcessorFactory, ProcessorNodeLike, StereoPannerLike, Timers } from './boundaries'
import { midiToFrequency, renderPianoNote, velocityGain, velocityLayer, type PianoRenderParams } from './pianoRenderer'
import { DEFAULT_MODEL_ID, getModel, type PianoModel } from './pianoModels'
import { pickSample, type LoadedSet, type SampleLibrary } from './sampleLibrary'
import { defaultChainParams, faderToGain, masterKnobToGain, type ChainParams, type RotaryParams } from '../dsp/types'
import { createStore, type Store } from '../state/store'

/** Meter values reported by the DSP processors (gain reduction in dB, rotor rates in Hz). */
export type EngineMeters = Partial<Record<'A' | 'B' | 'master' | 'rotary', Record<string, number>>>

export type EngineState = 'idle' | 'loading' | 'ready' | 'error' | 'fallback'
export type VoiceSource = 'generated-buffers' | 'fallback-oscillator' | 'none' | 'recorded-samples' | 'mixed'
export type LayerId = 'A' | 'B'
export const LAYER_IDS: readonly LayerId[] = ['A', 'B']

export interface LayerSettings {
  on: boolean
  /** Level fader 0..100. */
  level: number
  /** Octave shift in octaves (−1, 0, +1). */
  octave: number
  modelId: string
  /** 0 Heavy, 1 Medium, 2 Light. */
  kbTouch: number
  /** 0 Off .. 3. */
  dynComp: number
  /** Timbre setting index (family-dependent). */
  timbre: number
  /** 0 Off .. 3. */
  unison: number
  softRelease: boolean
  stringRes: boolean
  /** Amp Sim/EQ "To Rotary": this layer feeds the shared rotary. */
  toRotary: boolean
}

export interface PianoSettings {
  on: boolean
  /** SUSTPED: the sustain pedal input reaches this section. */
  sustped: boolean
  /** PSTICK: the pitch stick bends this section ±2 semitones. */
  pstick: boolean
  layers: Record<LayerId, LayerSettings>
}

export type LayerSourceKind = 'recorded-samples' | 'generated-buffers' | 'fallback-generated' | 'fallback-oscillator' | 'none'

export interface LayerStatus {
  on: boolean
  modelId: string
  modelName: string
  type: string
  kind: 'recorded' | 'generated'
  source: LayerSourceKind
  state: 'off' | 'idle' | 'loading' | 'ready' | 'fallback'
  loaded: number
  total: number
  message: string
  voices: number
}

export type EffectsHost = 'none' | 'loading' | 'worklet' | 'main-thread' | 'unavailable'

export interface EngineStatus {
  state: EngineState
  message: string
  contextState: 'suspended' | 'running' | 'closed' | null
  sampleRate: number | null
  voiceSource: VoiceSource
  activeVoices: number
  sustain: boolean
  warmed: number
  warmTotal: number
  lastNote: string | null
  layers: Record<LayerId, LayerStatus>
  effects: EffectsHost
  /** Why the DSP host is unavailable, when it is. */
  effectsError: string | null
  /** True when a sample library is wired (production); false in generated-only mode. */
  library: boolean
}

export interface PianoEngineOptions {
  createContext: () => AudioContextLike
  timers: Timers
  renderer?: (params: PianoRenderParams) => Float32Array
  maxVoices?: number
  /** Master gain used when no Master Level has been set yet (Phase 1 compatibility). */
  masterLevel?: number
  warmNotes?: number[]
  releaseSeconds?: number
  retriggerReleaseSeconds?: number
  stealReleaseSeconds?: number
  cacheSize?: number
  maxBufferSeconds?: number
  /** Bundled sample library; omitted = generated voice only. */
  library?: SampleLibrary | null
  /** DSP host; omitted = effects unavailable (layer buses feed the master gain directly). */
  createProcessor?: ProcessorFactory | null
  initialPiano?: Partial<PianoSettings>
}

export const RELEASE_SECONDS = 0.3
export const SOFT_RELEASE_SECONDS = 0.55
export const RETRIGGER_RELEASE_SECONDS = 0.03
export const STEAL_RELEASE_SECONDS = 0.02
export const ALL_NOTES_OFF_RELEASE_SECONDS = 0.08
export const LAYER_VELOCITIES = [32, 72, 112] as const
export const DEFAULT_MAX_VOICES = 32
export const GENERATED_MODEL_ID = 'digital-additive'
/** Unison detune (cents) and side level per Unison setting (Off, 1, 2, 3). */
export const UNISON_CENTS = [0, 5, 11, 20] as const
export const UNISON_SIDE_LEVEL = [0, 0.5, 0.63, 0.75] as const
export const PITCH_STICK_SEMITONES = 2
const GAIN_FLOOR = 0.0005
const PLAYABLE_LOWEST = 21
const PLAYABLE_HIGHEST = 108

/** KB Touch: Heavy needs more force for the same loudness, Light less (manual p. 25). */
export function applyKbTouch(velocity: number, kbTouch: number): number {
  const v = Math.min(127, Math.max(1, velocity)) / 127
  const exponent = kbTouch === 0 ? 1.4 : kbTouch === 2 ? 0.7 : 1
  return Math.min(127, Math.max(1, Math.round(127 * Math.pow(v, exponent))))
}

/** Dyn Comp raises the level of soft strokes without touching the timbre layer (manual p. 25). */
export function dynCompGain(gain: number, level: number): number {
  const exponent = [1, 0.8, 0.6, 0.4][Math.min(3, Math.max(0, Math.round(level)))]
  return Math.pow(Math.max(GAIN_FLOOR, gain), exponent)
}

export function defaultLayerSettings(overrides: Partial<LayerSettings> = {}): LayerSettings {
  return { on: false, level: 45, octave: 0, modelId: DEFAULT_MODEL_ID, kbTouch: 1, dynComp: 0, timbre: 0, unison: 0, softRelease: false, stringRes: true, toRotary: false, ...overrides }
}

export function defaultPianoSettings(library: boolean): PianoSettings {
  return {
    on: true,
    sustped: true,
    pstick: false,
    layers: {
      A: defaultLayerSettings({ on: true, level: 90, modelId: library ? DEFAULT_MODEL_ID : GENERATED_MODEL_ID }),
      B: defaultLayerSettings({ on: false, level: 45, modelId: library ? DEFAULT_MODEL_ID : GENERATED_MODEL_ID }),
    },
  }
}

interface Voice {
  id: number
  layer: LayerId
  midi: number
  playedMidi: number
  velocity: number
  kind: 'buffer' | 'fallback'
  sourceKind: LayerSourceKind
  sources: (BufferSourceLike | OscillatorLike)[]
  baseRates: number[]
  panners: StereoPannerLike[]
  sideGains: GainNodeLike[]
  gain: GainNodeLike
  startedAt: number
  keyDown: boolean
  sustained: boolean
  releasing: boolean
  endsAt: number
  cleanupTimer: unknown
  releaseSeconds: number
}

interface LayerRuntime {
  id: LayerId
  input: GainNodeLike | null
  processor: ProcessorNodeLike | null
  level: GainNodeLike | null
  chain: ChainParams
  /** Loaded set for the current model, when recorded and ready. */
  set: LoadedSet | null
  loadError: string | null
  loadingModel: string | null
  stringsSent: string
}

export class PianoEngine {
  private ctx: AudioContextLike | null = null
  private master: GainNodeLike | null = null
  private masterProcessor: ProcessorNodeLike | null = null
  private rotary: ProcessorNodeLike | null = null
  private rotaryParams: RotaryParams = { fast: false, drive: 2 }
  private masterLevelKnob: number | null = null
  private voices = new Map<number, Voice>()
  private cache = new Map<string, AudioBufferLike>()
  private sampleBuffers = new Map<string, AudioBufferLike>()
  private listeners = new Set<() => void>()
  private nextVoiceId = 1
  private sustain = false
  private pitchBend = 0
  private status: EngineStatus
  private readonly opts: Required<Omit<PianoEngineOptions, 'renderer' | 'library' | 'createProcessor' | 'initialPiano'>> & { renderer: (p: PianoRenderParams) => Float32Array }
  private readonly library: SampleLibrary | null
  private readonly createProcessor: ProcessorFactory | null
  private disposed = false
  private createdNodes = 0
  private cleanedNodes = 0
  private warmQueue: number[] = []
  private warmTimer: unknown = null
  private rendererFailed = false
  private piano: PianoSettings
  private layers: Record<LayerId, LayerRuntime>
  private effectsHost: EffectsHost
  private generation = 0
  private unsubscribeLibrary: (() => void) | null = null
  /** Live meters for panel LEDs (compressor ACTIVE, limiter); updated ~20×/s by the processors. */
  readonly meters: Store<EngineMeters> = createStore<EngineMeters>({})

  constructor(options: PianoEngineOptions) {
    this.opts = {
      createContext: options.createContext,
      timers: options.timers,
      renderer: options.renderer ?? renderPianoNote,
      maxVoices: options.maxVoices ?? DEFAULT_MAX_VOICES,
      masterLevel: options.masterLevel ?? 0.8,
      warmNotes: options.warmNotes ?? [60, 62, 64, 65, 67, 69, 71, 72],
      releaseSeconds: options.releaseSeconds ?? RELEASE_SECONDS,
      retriggerReleaseSeconds: options.retriggerReleaseSeconds ?? RETRIGGER_RELEASE_SECONDS,
      stealReleaseSeconds: options.stealReleaseSeconds ?? STEAL_RELEASE_SECONDS,
      cacheSize: options.cacheSize ?? 64,
      maxBufferSeconds: options.maxBufferSeconds ?? 4,
    }
    this.library = options.library ?? null
    this.createProcessor = options.createProcessor ?? null
    this.effectsHost = this.createProcessor ? 'none' : 'unavailable'
    const defaults = defaultPianoSettings(this.library !== null)
    this.piano = { ...defaults, ...options.initialPiano, layers: { A: { ...defaults.layers.A, ...options.initialPiano?.layers?.A }, B: { ...defaults.layers.B, ...options.initialPiano?.layers?.B } } }
    this.layers = {
      A: { id: 'A', input: null, processor: null, level: null, chain: defaultChainParams(), set: null, loadError: null, loadingModel: null, stringsSent: '' },
      B: { id: 'B', input: null, processor: null, level: null, chain: defaultChainParams(), set: null, loadError: null, loadingModel: null, stringsSent: '' },
    }
    this.status = {
      state: 'idle',
      message: 'Audio idle: play a key or press Start audio to create the audio context.',
      contextState: null,
      sampleRate: null,
      voiceSource: 'none',
      activeVoices: 0,
      sustain: false,
      warmed: 0,
      warmTotal: this.opts.warmNotes.length,
      lastNote: null,
      layers: { A: this.layerStatus('A'), B: this.layerStatus('B') },
      effects: this.effectsHost,
      effectsError: null,
      library: this.library !== null,
    }
    if (this.library) this.unsubscribeLibrary = this.library.subscribe(() => this.onLibraryChange())
    for (const id of LAYER_IDS) this.ensureModelLoaded(id)
  }

  getStatus = (): EngineStatus => this.status

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getPiano(): PianoSettings {
    return this.piano
  }

  /* ---------- status ---------- */

  private modelOf(id: LayerId): PianoModel {
    return getModel(this.piano.layers[id].modelId)
  }

  private usesGenerated(id: LayerId): boolean {
    return !this.library || this.modelOf(id).kind === 'generated'
  }

  private layerStatus(id: LayerId): LayerStatus {
    const settings = this.piano.layers[id]
    const model = getModel(settings.modelId)
    const rt = this.layers[id]
    const voices = [...this.voices.values()].filter((v) => v.layer === id).length
    const base = { on: settings.on, modelId: model.id, modelName: model.name, type: model.type, kind: model.kind, voices }
    if (!settings.on) return { ...base, source: 'none', state: 'off', loaded: 0, total: 0, message: `Layer ${id} off` }
    if (!this.library || model.kind === 'generated') {
      const source: LayerSourceKind = this.rendererFailed ? 'fallback-oscillator' : 'generated-buffers'
      const warming = this.warmQueue.length > 0
      return {
        ...base,
        source,
        state: this.rendererFailed ? 'fallback' : warming ? 'loading' : 'ready',
        loaded: this.status?.warmed ?? 0,
        total: this.opts.warmNotes.length,
        message: this.rendererFailed ? 'Generated piano failed; playing the fallback oscillator tone.' : `${model.name}: generated at runtime (not a recording).`,
      }
    }
    const progress = this.library.progress(model.setId!)
    if (rt.set && rt.set.id === model.setId) {
      return { ...base, source: 'recorded-samples', state: 'ready', loaded: rt.set.samples.size, total: rt.set.samples.size, message: `${model.type} · ${model.name}: recorded samples ready (${model.license}).` }
    }
    if (rt.loadError && rt.loadingModel === null) {
      return { ...base, source: this.rendererFailed ? 'fallback-oscillator' : 'fallback-generated', state: 'fallback', loaded: 0, total: progress?.total ?? 0, message: `Piano not found: ${model.name} (${rt.loadError}); playing the generated fallback piano instead.` }
    }
    return { ...base, source: 'none', state: 'loading', loaded: progress?.loaded ?? 0, total: progress?.total ?? 0, message: `Loading ${model.type} · ${model.name}${progress ? ` (${progress.loaded}/${progress.total})` : ''}…` }
  }

  private update(patch: Partial<EngineStatus>) {
    const layers = { A: this.layerStatus('A'), B: this.layerStatus('B') }
    const enabled = LAYER_IDS.filter((id) => this.piano.layers[id].on).map((id) => layers[id])
    let state: EngineState
    let message = patch.message ?? this.status.message
    if (!this.ctx) {
      state = patch.state === 'error' || (this.status.state === 'error' && !patch.state) ? 'error' : 'idle'
      if (state === 'idle') {
        const loading = enabled.find((l) => l.state === 'loading')
        message = loading ? `Audio idle · ${loading.message} Play a key or press Start audio.` : this.status.contextState === 'closed' ? this.status.message : 'Audio idle: play a key or press Start audio to create the audio context.'
      }
    } else if (enabled.some((l) => l.state === 'loading')) {
      state = 'loading'
      if (this.library) message = enabled.filter((l) => l.state === 'loading').map((l) => l.message).join(' ')
    } else if (enabled.some((l) => l.state === 'fallback')) {
      state = 'fallback'
      message = enabled.filter((l) => l.state === 'fallback').map((l) => l.message).join(' ')
    } else {
      state = 'ready'
      if (this.library) message = enabled.length ? enabled.map((l) => l.message).join(' ') : 'Ready: both piano layers are off.'
    }
    if (this.library === null && patch.message) message = patch.message
    if (this.library === null && !patch.message && this.ctx) message = this.status.message
    const sources = new Set(enabled.map((l) => l.source).filter((s) => s !== 'none'))
    const voiceSource: VoiceSource = !this.ctx ? 'none' : sources.size === 0 ? 'none' : sources.size > 1 ? 'mixed' : sources.has('recorded-samples') ? 'recorded-samples' : sources.has('fallback-oscillator') ? 'fallback-oscillator' : 'generated-buffers'
    this.status = {
      ...this.status,
      ...patch,
      state,
      message,
      voiceSource: this.ctx && this.library === null ? (this.rendererFailed ? 'fallback-oscillator' : 'generated-buffers') : voiceSource,
      activeVoices: this.voices.size,
      sustain: this.sustain,
      contextState: this.ctx?.state ?? this.status.contextState,
      layers,
      effects: this.effectsHost,
      library: this.library !== null,
    }
    this.listeners.forEach((l) => l())
  }

  /* ---------- context, graph and warm-up ---------- */

  /** Creates the context, master path, layer buses and warm-up bank. Idempotent. */
  start(): Promise<void> {
    this.disposed = false
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        return this.ctx.resume().then(
          () => this.update({}),
          (err) => this.update({ message: `Audio context could not resume: ${String(err)}` }),
        )
      }
      return Promise.resolve()
    }
    let ctx: AudioContextLike
    try {
      ctx = this.opts.createContext()
    } catch (err) {
      this.update({ state: 'error', message: `Audio unavailable: ${err instanceof Error ? err.message : String(err)}. Keys still show presses; nothing sounds.`, voiceSource: 'none' })
      return Promise.resolve()
    }
    this.ctx = ctx
    const generation = ++this.generation
    this.master = ctx.createGain()
    this.createdNodes++
    this.master.gain.setValueAtTime(this.masterLevelKnob === null ? this.opts.masterLevel : masterKnobToGain(this.masterLevelKnob), ctx.currentTime)
    this.master.connect(ctx.destination)
    for (const id of LAYER_IDS) {
      const rt = this.layers[id]
      rt.input = ctx.createGain()
      rt.level = ctx.createGain()
      this.createdNodes += 2
      rt.input.gain.setValueAtTime(1, ctx.currentTime)
      rt.level.gain.setValueAtTime(this.piano.layers[id].on ? faderToGain(this.piano.layers[id].level) : 0, ctx.currentTime)
      rt.input.connect(rt.level)
      rt.level.connect(this.master)
    }
    this.update({ state: 'loading', message: 'Rendering the generated piano bank…', sampleRate: ctx.sampleRate, warmed: 0 })
    if (LAYER_IDS.some((id) => this.piano.layers[id].on && this.usesGenerated(id))) {
      this.warmQueue = [...this.opts.warmNotes]
      this.scheduleWarm()
    } else this.update({})
    if (this.createProcessor) void this.buildProcessors(ctx, generation)
    const resumed = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()
    return resumed.then(
      () => this.update({}),
      (err) => this.update({ message: `Audio context could not resume: ${String(err)}` }),
    )
  }

  private async buildProcessors(ctx: AudioContextLike, generation: number) {
    this.effectsHost = 'loading'
    this.update({})
    try {
      const [masterProc, rotaryProc, procA, procB] = await Promise.all([
        this.createProcessor!(ctx, 'master'),
        this.createProcessor!(ctx, 'rotary'),
        this.createProcessor!(ctx, 'layer'),
        this.createProcessor!(ctx, 'layer'),
      ])
      if (generation !== this.generation || this.ctx !== ctx || !this.master) {
        for (const p of [masterProc, rotaryProc, procA, procB]) p.dispose()
        return
      }
      this.createdNodes += 4
      masterProc.onMeter = (m) => this.meters.set((prev) => ({ ...prev, master: m }))
      rotaryProc.onMeter = (m) => this.meters.set((prev) => ({ ...prev, rotary: m }))
      procA.onMeter = (m) => this.meters.set((prev) => ({ ...prev, A: m }))
      procB.onMeter = (m) => this.meters.set((prev) => ({ ...prev, B: m }))
      this.masterProcessor = masterProc
      masterProc.setParams({ level: 10 })
      this.master.disconnect()
      this.master.connect(masterProc)
      masterProc.connect(ctx.destination)
      this.rotary = rotaryProc
      rotaryProc.setParams(this.rotaryParams)
      rotaryProc.connect(this.master)
      const procs: Record<LayerId, ProcessorNodeLike> = { A: procA, B: procB }
      for (const id of LAYER_IDS) {
        const rt = this.layers[id]
        rt.processor = procs[id]
        rt.processor.setParams(rt.chain)
        rt.input!.disconnect()
        rt.input!.connect(rt.processor)
        rt.processor.connect(rt.level!)
        this.wireLayerOutput(id)
      }
      this.effectsHost = masterProc.mode === 'worklet' ? 'worklet' : masterProc.mode === 'main-thread' ? 'main-thread' : 'worklet'
      if (masterProc.mode === 'fake') this.effectsHost = 'worklet'
    } catch (err) {
      if (generation !== this.generation) return
      this.effectsHost = 'unavailable'
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      this.update({ effectsError: reason, message: `Effects unavailable (${reason}); layers feed the master gain directly.` })
      return
    }
    this.update({ effectsError: null })
  }

  private wireLayerOutput(id: LayerId) {
    const rt = this.layers[id]
    if (!rt.level || !this.master) return
    rt.level.disconnect()
    if (this.piano.layers[id].toRotary && this.rotary) rt.level.connect(this.rotary)
    else rt.level.connect(this.master)
  }

  private scheduleWarm() {
    if (this.warmTimer !== null) return
    this.warmTimer = this.opts.timers.setTimeout(() => {
      this.warmTimer = null
      this.warmStep()
    }, 0)
  }

  private warmStep() {
    if (!this.ctx || this.disposed) return
    const midi = this.warmQueue.shift()
    if (midi !== undefined) {
      try {
        this.bufferFor(midi, LAYER_VELOCITIES[1])
      } catch (err) {
        this.enterFallback(err)
        return
      }
      this.update({ warmed: this.status.warmed + 1 })
    }
    if (this.warmQueue.length) this.scheduleWarm()
    else if (!this.rendererFailed) this.update({ state: 'ready', message: 'Ready: generated additive piano voice (not a recording).' })
  }

  private enterFallback(err: unknown) {
    this.rendererFailed = true
    this.warmQueue = []
    this.update({
      state: 'fallback',
      voiceSource: 'fallback-oscillator',
      message: `Piano bank failed (${err instanceof Error ? err.message : String(err)}); playing a labeled fallback triangle tone instead.`,
    })
  }

  /* ---------- sample library ---------- */

  private ensureModelLoaded(id: LayerId) {
    const rt = this.layers[id]
    const model = getModel(this.piano.layers[id].modelId)
    if (!this.library || model.kind === 'generated' || !model.setId) {
      rt.set = null
      rt.loadError = null
      rt.loadingModel = null
      return
    }
    const setId = model.setId
    const cached = this.library.get(setId)
    if (cached) {
      rt.set = cached
      rt.loadError = null
      rt.loadingModel = null
      return
    }
    if (rt.loadingModel === setId) return
    rt.set = null
    rt.loadError = null
    rt.loadingModel = setId
    this.library.load(setId).then(
      (set) => {
        if (rt.loadingModel !== setId) return
        rt.loadingModel = null
        if (getModel(this.piano.layers[id].modelId).setId === setId) {
          rt.set = set
          rt.loadError = null
        }
        this.update({})
      },
      (err: unknown) => {
        if (rt.loadingModel !== setId) return
        rt.loadingModel = null
        rt.set = null
        rt.loadError = err instanceof Error ? err.message : String(err)
        this.update({})
      },
    )
    this.update({})
  }

  private onLibraryChange() {
    this.update({})
  }

  /** Drops decoded sets no layer references any more (memory: a set is ~100 MB of Float32 data). */
  private evictUnusedSets() {
    if (!this.library) return
    const used = new Set<string>()
    for (const id of LAYER_IDS) {
      const model = getModel(this.piano.layers[id].modelId)
      if (model.setId) used.add(model.setId)
      const loading = this.layers[id].loadingModel
      if (loading) used.add(loading)
    }
    for (const setId of this.library.loadedIds()) {
      if (used.has(setId)) continue
      this.library.unload(setId)
      for (const key of Array.from(this.sampleBuffers.keys())) if (key.startsWith(`${setId}/`)) this.sampleBuffers.delete(key)
    }
  }

  /* ---------- settings ---------- */

  /** Applies canonical piano-section settings (layers, pedals, models); diffs and ramps internally. */
  setPiano(next: PianoSettings) {
    const prev = this.piano
    this.piano = { ...next, layers: { A: { ...next.layers.A }, B: { ...next.layers.B } } }
    const t = this.now()
    for (const id of LAYER_IDS) {
      const before = prev.layers[id]
      const after = this.piano.layers[id]
      const rt = this.layers[id]
      if (before.modelId !== after.modelId || before.on !== after.on) this.ensureModelLoaded(id)
      if (rt.level && (before.level !== after.level || before.on !== after.on || prev.on !== this.piano.on)) {
        const target = after.on && this.piano.on ? faderToGain(after.level) : 0
        rt.level.gain.cancelScheduledValues(t)
        rt.level.gain.setTargetAtTime(target, t, 0.01)
      }
      if (before.on && !after.on) this.releaseLayer(id, this.opts.releaseSeconds)
      if (before.toRotary !== after.toRotary) this.wireLayerOutput(id)
      if (before.modelId !== after.modelId || before.timbre !== after.timbre || before.stringRes !== after.stringRes) {
        const model = getModel(after.modelId)
        this.setChain(id, { timbre: { family: model.family, setting: after.timbre }, stringRes: { ...rt.chain.stringRes, on: after.stringRes } })
      }
    }
    if (prev.on && !this.piano.on) this.releaseAllPiano(this.opts.releaseSeconds)
    if (prev.pstick !== this.piano.pstick) this.applyPitchBend()
    if (LAYER_IDS.some((id) => prev.layers[id].modelId !== this.piano.layers[id].modelId)) this.evictUnusedSets()
    if (this.ctx && LAYER_IDS.some((id) => this.piano.layers[id].on && this.usesGenerated(id)) && !this.rendererFailed && this.warmQueue.length === 0 && this.status.warmed === 0) {
      this.warmQueue = [...this.opts.warmNotes]
      this.scheduleWarm()
    }
    this.pushStrings()
    this.update({})
  }

  /** Merges effect chain parameters for one layer (Timbre / String Res are set by setPiano). */
  setChain(id: LayerId, patch: Partial<ChainParams>) {
    const rt = this.layers[id]
    const merged: Record<string, unknown> = { ...rt.chain }
    for (const [key, value] of Object.entries(patch)) {
      const current = merged[key]
      merged[key] = value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' ? { ...(current as object), ...(value as object) } : value
    }
    rt.chain = merged as unknown as ChainParams
    rt.processor?.setParams(patch)
  }

  getChain(id: LayerId): ChainParams {
    return this.layers[id].chain
  }

  setRotary(params: RotaryParams) {
    this.rotaryParams = { ...params }
    this.rotary?.setParams(this.rotaryParams)
  }

  getRotary(): RotaryParams {
    return this.rotaryParams
  }

  /** Master Level knob (0..10) → master gain with a short ramp. */
  setMasterLevel(knob: number) {
    this.masterLevelKnob = knob
    if (this.master && this.ctx) {
      const t = this.now()
      this.master.gain.cancelScheduledValues(t)
      this.master.gain.setTargetAtTime(masterKnobToGain(knob), t, 0.015)
    }
  }

  getMasterGain(): number {
    return this.masterLevelKnob === null ? this.opts.masterLevel : masterKnobToGain(this.masterLevelKnob)
  }

  /** Pitch stick position −1..1 → ±2 semitones on layers when PSTICK is on. */
  setPitchBend(position: number) {
    this.pitchBend = Math.min(1, Math.max(-1, position))
    this.applyPitchBend()
  }

  private applyPitchBend() {
    if (!this.ctx) return
    const t = this.now()
    const ratio = this.piano.pstick ? Math.pow(2, (this.pitchBend * PITCH_STICK_SEMITONES) / 12) : 1
    for (const v of this.voices.values()) {
      v.sources.forEach((s, i) => {
        if (v.kind === 'fallback') {
          const osc = s as OscillatorLike
          osc.frequency.cancelScheduledValues(t)
          osc.frequency.setTargetAtTime(midiToFrequency(v.playedMidi) * ratio, t, 0.01)
        } else {
          const src = s as BufferSourceLike
          src.playbackRate.cancelScheduledValues(t)
          src.playbackRate.setTargetAtTime(v.baseRates[i] * ratio, t, 0.01)
        }
      })
    }
  }

  /* ---------- buffers ---------- */

  private bufferFor(midi: number, layerVelocity: number): AudioBufferLike {
    const ctx = this.ctx!
    const key = `${midi}:${velocityLayer(layerVelocity)}`
    const cached = this.cache.get(key)
    if (cached) {
      this.cache.delete(key)
      this.cache.set(key, cached)
      return cached
    }
    const data = this.opts.renderer({ midi, velocity: layerVelocity, sampleRate: ctx.sampleRate, maxSeconds: this.opts.maxBufferSeconds })
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate)
    buffer.copyToChannel(data, 0)
    this.cache.set(key, buffer)
    while (this.cache.size > this.opts.cacheSize) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
    return buffer
  }

  private sampleBufferFor(set: LoadedSet, root: number, layer: number, data: Float32Array, sampleRate: number): AudioBufferLike {
    const key = `${set.id}/${root}:${layer}`
    const cached = this.sampleBuffers.get(key)
    if (cached) return cached
    const ctx = this.ctx!
    const buffer = ctx.createBuffer(1, data.length, sampleRate)
    buffer.copyToChannel(data, 0)
    this.sampleBuffers.set(key, buffer)
    return buffer
  }

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0
  }

  /* ---------- note lifecycle ---------- */

  noteOn(midi: number, velocity: number): boolean {
    if (!this.ctx) {
      void this.start()
      if (!this.ctx) return false
    }
    velocity = Math.min(127, Math.max(1, Math.round(velocity)))
    if (!this.piano.on) {
      this.update({ lastNote: `${midi}@${velocity} (piano section off)` })
      return false
    }
    let started = false
    for (const id of LAYER_IDS) {
      const settings = this.piano.layers[id]
      if (!settings.on) continue
      const played = midi + settings.octave * 12
      if (played < PLAYABLE_LOWEST || played > PLAYABLE_HIGHEST) continue
      if (this.startVoice(id, midi, played, velocity)) started = true
    }
    this.pushStrings()
    this.update({ lastNote: `${midi}@${velocity}` })
    return started
  }

  private startVoice(layer: LayerId, midi: number, playedMidi: number, velocity: number): boolean {
    const ctx = this.ctx!
    const rt = this.layers[layer]
    const settings = this.piano.layers[layer]
    // Repeated note on this layer: retrigger cleanly.
    for (const v of this.voices.values()) if (v.layer === layer && v.midi === midi && !v.releasing) this.release(v, this.opts.retriggerReleaseSeconds)
    // Deterministic stealing: oldest sounding voice first (ties by id).
    while (this.voices.size >= this.opts.maxVoices) {
      const victim = [...this.voices.values()].filter((v) => !v.releasing).sort((a, b) => a.startedAt - b.startedAt || a.id - b.id)[0]
      if (!victim) break
      this.release(victim, this.opts.stealReleaseSeconds)
      this.finalize(victim)
    }
    const t = ctx.currentTime
    const touched = applyKbTouch(velocity, settings.kbTouch)
    const gain = ctx.createGain()
    this.createdNodes++
    gain.connect(rt.input ?? this.master!)
    const model = getModel(settings.modelId)
    const releaseSeconds = settings.softRelease && model.softReleaseSupported ? SOFT_RELEASE_SECONDS : this.opts.releaseSeconds
    let voice: Voice | null = null
    if (rt.set && !this.usesGenerated(layer)) {
      const pick = pickSample(rt.set, playedMidi, touched)
      if (pick) {
        const buffer = this.sampleBufferFor(rt.set, pick.sample.file.root, pick.sample.file.layer, pick.sample.data, pick.sample.sampleRate)
        const layerInfo = rt.set.manifest.layers[pick.layer]
        // The recorded layer carries its natural loudness; scale within the layer by the velocity curve,
        // then let Dyn Comp raise soft strokes (level only — the layer, i.e. the timbre, is unchanged).
        const natural = velocityGain(touched)
        const inLayer = Math.min(1.5, Math.max(0.35, layerInfo ? natural / velocityGain(layerInfo.velocity) : 1))
        const level = inLayer * (dynCompGain(natural, settings.dynComp) / natural)
        voice = this.bufferVoice(layer, midi, playedMidi, velocity, 'recorded-samples', buffer, pick.playbackRate, level, gain, t, releaseSeconds, settings.unison)
      }
    }
    if (!voice && !this.rendererFailed) {
      try {
        const layerIndex = velocityLayer(touched)
        const layerVelocity = LAYER_VELOCITIES[layerIndex]
        const buffer = this.bufferFor(playedMidi, layerVelocity)
        const level = dynCompGain(velocityGain(touched), settings.dynComp) / velocityGain(layerVelocity)
        const sourceKind: LayerSourceKind = this.usesGenerated(layer) ? 'generated-buffers' : 'fallback-generated'
        voice = this.bufferVoice(layer, midi, playedMidi, velocity, sourceKind, buffer, 1, level, gain, t, releaseSeconds, settings.unison)
      } catch (err) {
        this.enterFallback(err)
        voice = this.fallbackVoice(layer, midi, playedMidi, velocity, gain, t)
      }
    }
    if (!voice) voice = this.fallbackVoice(layer, midi, playedMidi, velocity, gain, t)
    this.voices.set(voice.id, voice)
    voice.sources[0].onended = () => this.finalize(voice!)
    voice.cleanupTimer = this.opts.timers.setTimeout(() => this.finalize(voice!), Math.max(0, (voice.endsAt - t) * 1000) + 50)
    return true
  }

  private bufferVoice(layer: LayerId, midi: number, playedMidi: number, velocity: number, sourceKind: LayerSourceKind, buffer: AudioBufferLike, rate: number, level: number, gain: GainNodeLike, t: number, releaseSeconds: number, unison: number): Voice {
    const ctx = this.ctx!
    const bend = this.piano.pstick ? Math.pow(2, (this.pitchBend * PITCH_STICK_SEMITONES) / 12) : 1
    const sources: BufferSourceLike[] = []
    const baseRates: number[] = []
    const panners: StereoPannerLike[] = []
    const u = Math.min(3, Math.max(0, unison))
    const cents = UNISON_CENTS[u]
    const side = UNISON_SIDE_LEVEL[u]
    const sideGains: GainNodeLike[] = []
    // Unison: the centre voice plus two detuned copies panned hard left / right at a lower level
    // (manual p. 26: "transposed voices … stereo Unison"; 1 subtle → 3 wide and obviously detuned).
    const variants = u > 0 ? [0, -cents, cents] : [0]
    variants.forEach((detune, i) => {
      const source = ctx.createBufferSource()
      this.createdNodes++
      source.buffer = buffer
      const r = rate * Math.pow(2, detune / 1200)
      baseRates.push(r)
      source.playbackRate.setValueAtTime(r * bend, t)
      if (i === 0) source.connect(gain)
      else {
        const panner = ctx.createStereoPanner()
        const sideGain = ctx.createGain()
        this.createdNodes += 2
        panner.pan.setValueAtTime(detune < 0 ? -0.85 : 0.85, t)
        sideGain.gain.setValueAtTime(side, t)
        source.connect(panner)
        panner.connect(sideGain)
        sideGain.connect(gain)
        panners.push(panner)
        sideGains.push(sideGain)
      }
      source.start(t)
      sources.push(source)
    })
    // Keep the voice loudness roughly constant when unison adds the two side copies.
    gain.gain.setValueAtTime(level / (1 + side * 0.7), t)
    return { id: this.nextVoiceId++, layer, midi, playedMidi, velocity, kind: 'buffer', sourceKind, sources, baseRates, panners, sideGains, gain, startedAt: t, keyDown: true, sustained: false, releasing: false, endsAt: t + buffer.duration / rate + 0.05, cleanupTimer: null, releaseSeconds }
  }

  private fallbackVoice(layer: LayerId, midi: number, playedMidi: number, velocity: number, gain: GainNodeLike, t: number): Voice {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    this.createdNodes++
    osc.type = 'triangle'
    const bend = this.piano.pstick ? Math.pow(2, (this.pitchBend * PITCH_STICK_SEMITONES) / 12) : 1
    osc.frequency.setValueAtTime(midiToFrequency(playedMidi) * bend, t)
    osc.connect(gain)
    const level = 0.35 * velocityGain(velocity)
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(level, t + 0.005)
    gain.gain.exponentialRampToValueAtTime(GAIN_FLOOR, t + 2.5)
    osc.start(t)
    osc.stop(t + 2.55)
    return { id: this.nextVoiceId++, layer, midi, playedMidi, velocity, kind: 'fallback', sourceKind: 'fallback-oscillator', sources: [osc], baseRates: [1], panners: [], sideGains: [], gain, startedAt: t, keyDown: true, sustained: false, releasing: false, endsAt: t + 2.55, cleanupTimer: null, releaseSeconds: this.opts.releaseSeconds }
  }

  noteOff(midi: number): void {
    for (const v of this.voices.values()) {
      if (v.midi !== midi || !v.keyDown) continue
      v.keyDown = false
      if (this.sustain && this.piano.sustped) v.sustained = true
      else this.release(v, v.releaseSeconds)
    }
    this.pushStrings()
    this.update({})
  }

  setSustain(on: boolean): void {
    if (this.sustain === on) return
    this.sustain = on
    if (!on) {
      for (const v of this.voices.values()) {
        if (v.sustained && !v.keyDown) {
          v.sustained = false
          this.release(v, v.releaseSeconds)
        }
      }
    }
    this.pushStrings()
    this.update({})
  }

  isSustain(): boolean {
    return this.sustain
  }

  /** Releases every owned voice quickly and clears sustain. */
  allNotesOff(): void {
    this.sustain = false
    for (const v of this.voices.values()) {
      v.keyDown = false
      v.sustained = false
      this.release(v, ALL_NOTES_OFF_RELEASE_SECONDS)
    }
    this.pushStrings()
    this.update({})
  }

  private releaseLayer(id: LayerId, seconds: number) {
    for (const v of this.voices.values()) {
      if (v.layer !== id) continue
      v.keyDown = false
      v.sustained = false
      this.release(v, seconds)
    }
  }

  private releaseAllPiano(seconds: number) {
    for (const id of LAYER_IDS) this.releaseLayer(id, seconds)
  }

  private release(v: Voice, seconds: number) {
    if (v.releasing) return
    v.releasing = true
    const t = this.now()
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setValueAtTime(Math.max(GAIN_FLOOR, v.gain.gain.value), t)
    v.gain.gain.exponentialRampToValueAtTime(GAIN_FLOOR, t + seconds)
    const stopAt = t + seconds + 0.005
    for (const s of v.sources) s.stop(stopAt)
    v.endsAt = Math.min(v.endsAt, stopAt)
    this.opts.timers.clearTimeout(v.cleanupTimer)
    v.cleanupTimer = this.opts.timers.setTimeout(() => this.finalize(v), seconds * 1000 + 50)
  }

  private finalize(v: Voice) {
    if (!this.voices.has(v.id)) return
    this.voices.delete(v.id)
    this.opts.timers.clearTimeout(v.cleanupTimer)
    for (const s of v.sources) {
      s.onended = null
      s.disconnect()
    }
    for (const p of v.panners) p.disconnect()
    for (const g of v.sideGains) g.disconnect()
    v.gain.disconnect()
    this.cleanedNodes += v.sources.length + v.panners.length + v.sideGains.length + 1
    this.pushStrings()
    this.update({})
  }

  /** Sends the undamped-string list of each layer to its String Res processor when it changes. */
  private pushStrings() {
    for (const id of LAYER_IDS) {
      const rt = this.layers[id]
      const settings = this.piano.layers[id]
      const pedal = this.sustain && this.piano.sustped
      const strings = settings.stringRes
        ? [...new Set([...this.voices.values()].filter((v) => v.layer === id && !v.releasing && (v.keyDown || v.sustained || pedal)).map((v) => v.playedMidi))].sort((a, b) => a - b)
        : []
      const key = `${settings.stringRes ? 1 : 0}|${pedal ? 1 : 0}|${strings.join(',')}`
      if (key === rt.stringsSent) continue
      rt.stringsSent = key
      this.setChain(id, { stringRes: { on: settings.stringRes, strings, pedal } })
    }
  }

  /** Stops everything immediately, disconnects the master path and closes the context. */
  dispose(): void {
    this.disposed = true
    this.generation++
    if (this.warmTimer !== null) this.opts.timers.clearTimeout(this.warmTimer)
    this.warmTimer = null
    this.warmQueue = []
    const t = this.now()
    for (const v of Array.from(this.voices.values())) {
      for (const s of v.sources) s.stop(t)
      this.finalize(v)
    }
    for (const id of LAYER_IDS) {
      const rt = this.layers[id]
      if (rt.processor) {
        rt.processor.dispose()
        this.cleanedNodes++
        rt.processor = null
      }
      if (rt.input) {
        rt.input.disconnect()
        this.cleanedNodes++
        rt.input = null
      }
      if (rt.level) {
        rt.level.disconnect()
        this.cleanedNodes++
        rt.level = null
      }
      rt.stringsSent = ''
    }
    if (this.rotary) {
      this.rotary.dispose()
      this.cleanedNodes++
      this.rotary = null
    }
    if (this.masterProcessor) {
      this.masterProcessor.dispose()
      this.cleanedNodes++
      this.masterProcessor = null
    }
    if (this.master) {
      this.master.disconnect()
      this.cleanedNodes++
      this.master = null
    }
    const ctx = this.ctx
    this.ctx = null
    this.cache.clear()
    this.sampleBuffers.clear()
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined)
    this.sustain = false
    this.rendererFailed = false
    this.effectsHost = this.createProcessor ? 'none' : 'unavailable'
    this.meters.set({})
    this.status = { ...this.status, contextState: 'closed' }
    this.update({ state: 'idle', message: 'Audio disposed; play a key or press Start audio to create a new audio context.', voiceSource: 'none', warmed: 0 })
  }

  /** Detaches the library subscription (call when the engine is discarded for good). */
  destroy() {
    this.dispose()
    this.unsubscribeLibrary?.()
    this.unsubscribeLibrary = null
  }

  /** Voices sounding right now (including releasing ones). */
  activeVoices(): { midi: number; velocity: number; keyDown: boolean; sustained: boolean; releasing: boolean; kind: 'buffer' | 'fallback'; layer: LayerId; playedMidi: number; source: LayerSourceKind; sources: number }[] {
    return [...this.voices.values()].map((v) => ({ midi: v.midi, velocity: v.velocity, keyDown: v.keyDown, sustained: v.sustained, releasing: v.releasing, kind: v.kind, layer: v.layer, playedMidi: v.playedMidi, source: v.sourceKind, sources: v.sources.length }))
  }

  metrics() {
    return {
      activeVoices: this.voices.size,
      createdNodes: this.createdNodes,
      cleanedNodes: this.cleanedNodes,
      liveNodes: this.createdNodes - this.cleanedNodes,
      cachedBuffers: this.cache.size + this.sampleBuffers.size,
      hasContext: this.ctx !== null,
      effects: this.effectsHost,
    }
  }
}

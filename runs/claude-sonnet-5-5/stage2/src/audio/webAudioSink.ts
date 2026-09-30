import { LAYER_IDS, type EngineState, type EngineStore, type LayerId } from '../engine/state'
import { withImmediateRamps } from './effects/rig'
import { MasterGraph } from './graph'
import { isAcoustic, modelFor, type ModelInfo } from './library/catalog'
import { SampleLibrary } from './library/sampleLibrary'
import { dynCompGain, releaseTime, resonancePartners, touchVelocity } from './params'
import {
  addResonance,
  GeneratedBufferCache,
  startGeneratedVoice,
  startOscillatorVoice,
  startSampleVoice,
  startSynthVoice,
  Voice,
  type StartArgs,
} from './voices'
import type { AudioContextLike, AudioStatus, SampleLoader, Scheduler, VoiceSink, VoiceTarget } from './types'

export const STEAL_FADE_SECONDS = 0.02
/** headroom applied to every layer bus so several voices plus effects stay clear of the limiter */
export const LAYER_HEADROOM = 1.5

export interface WebAudioSinkOptions {
  createAudioContext: () => AudioContextLike | null
  scheduler: Scheduler
  loadSample: SampleLoader
  /** canonical piano + effects state; the sink reads it when a note starts and follows it via `syncState` */
  state: EngineStore
  onStatus?: (status: AudioStatus) => void
}

export interface ModelStatus {
  phase: 'idle' | 'loading' | 'ready' | 'error' | 'synth'
  name: string
  loaded: number
  total: number
}

interface LiveVoice {
  id: number
  layer: LayerId
  /** sounding note (after octave shift) */
  note: number
  voice: Voice
  timer: number | null
}

/**
 * The audio engine. Turns note-lifecycle voice commands into Web Audio nodes and owns the single AudioContext.
 *
 * Per note and layer it picks the best available source for the layer's selected model:
 *   recorded samples  →  (loading or failed) labelled generated stand-in  →  (buffers impossible) oscillator
 * and connects it to that layer's bus. Everything downstream (timbre, ordered effects, layer level, master, limiter) is
 * the `MasterGraph`; there is no other path to the destination.
 */
export class WebAudioPianoSink implements VoiceSink {
  onVoiceEnded: ((voiceId: number) => void) | null = null
  private readonly opts: WebAudioSinkOptions
  private ctx: AudioContextLike | null = null
  private graph: MasterGraph | null = null
  private library: SampleLibrary | null = null
  private readonly voices = new Map<number, LiveVoice>()
  private readonly generated = new GeneratedBufferCache()
  private generatedFailed = false
  private failed = false
  private disposed = false
  private status: AudioStatus = { phase: 'idle', message: 'Audio starts on the first note' }

  constructor(opts: WebAudioSinkOptions) {
    this.opts = opts
  }

  getStatus(): AudioStatus {
    return this.status
  }

  /** number of voices with live nodes; returns to 0 after cleanup */
  liveVoiceCount(): number {
    return this.voices.size
  }

  pendingTimerCount(): number {
    let n = 0
    for (const v of this.voices.values()) if (v.timer !== null) n++
    return n
  }

  /** the signal graph (null until audio has started); exposed for diagnostics and tests */
  getGraph(): MasterGraph | null {
    return this.graph
  }

  getContext(): AudioContextLike | null {
    return this.ctx
  }

  /** per layer: what the selected model is doing (recorded models load; synth models are always available) */
  modelStatuses(): Record<LayerId, ModelStatus> {
    const state = this.opts.state.get()
    const out = {} as Record<LayerId, ModelStatus>
    for (const id of LAYER_IDS) {
      const layer = state.layers[id]
      const model = modelFor(layer.type, layer.models[layer.type])
      if (model.kind === 'synth') out[id] = { phase: 'synth', name: model.name, loaded: 0, total: 0 }
      else {
        const s = this.library?.status(model.id) ?? { phase: 'idle' as const, loaded: 0, total: 0 }
        out[id] = { phase: s.phase, name: model.name, loaded: s.loaded, total: s.total }
      }
    }
    return out
  }

  /** which layer each live voice belongs to and what produced it */
  liveVoices(): Array<{ id: number; layer: LayerId; note: number; origin: Voice['origin']; sources: number }> {
    return Array.from(this.voices.values()).map((v) => ({ id: v.id, layer: v.layer, note: v.note, origin: v.voice.origin, sources: v.voice.sources.length }))
  }

  /** Create the audio context. Must be called from a user gesture in real browsers. */
  ensureStarted(): void {
    if (this.ctx || this.failed || this.disposed) return
    let ctx: AudioContextLike | null = null
    try {
      ctx = this.opts.createAudioContext()
    } catch (error) {
      this.fail(`Audio could not start: ${error instanceof Error ? error.message : 'unknown error'}`)
      return
    }
    if (!ctx) {
      this.fail('Audio unavailable: this browser has no Web Audio support. The keys still move, silently.')
      return
    }
    this.ctx = ctx
    try {
      this.graph = new MasterGraph(ctx, this.opts.scheduler)
      this.library = new SampleLibrary(ctx, this.opts.loadSample, () => this.syncStatus())
      const graph = this.graph
      withImmediateRamps(() => graph.apply(this.opts.state.get()))
    } catch (error) {
      this.fail(`Audio graph could not be created: ${error instanceof Error ? error.message : 'unknown error'}`)
      return
    }
    ctx.onstatechange = () => this.syncStatus()
    this.setStatus({ phase: 'loading', message: 'Audio starting…' })
    this.requestModels(this.opts.state.get())
    this.syncStatus()
    if (ctx.state !== 'running') {
      ctx.resume().then(
        () => this.syncStatus(),
        () => this.fail('Audio was blocked by the browser. Press a key again to retry.'),
      )
    }
  }

  /** follow the canonical state: rebuild parameters, load newly selected models, update the pitch stick */
  syncState(state: EngineState): void {
    if (!this.ctx || !this.graph || this.disposed || this.failed) return
    this.graph.apply(state)
    this.requestModels(state)
    for (const v of this.voices.values()) {
      const layer = state.layers[v.layer]
      v.voice.setBend(layer.pitchStick ? state.pitchBend * 200 : 0)
    }
    this.syncStatus()
  }

  start(voiceId: number, note: number, velocity: number, target: VoiceTarget = { layer: 'A', transpose: 0 }): void {
    this.ensureStarted()
    const ctx = this.ctx
    const graph = this.graph
    if (!ctx || !graph || this.disposed) return
    const layerId = (target.layer === 'B' ? 'B' : 'A') as LayerId
    const state = this.opts.state.get()
    const layer = state.layers[layerId]
    const sounding = note + target.transpose
    const effective = touchVelocity(layer.kbTouch, velocity)
    const args: StartArgs = {
      ctx,
      out: graph.layers[layerId].bus,
      note: sounding,
      velocity: effective,
      gain: dynCompGain(effective, layer.dynComp) * LAYER_HEADROOM,
      unison: layer.unison,
      bendCents: layer.pitchStick ? state.pitchBend * 200 : 0,
    }
    const model = modelFor(layer.type, layer.models[layer.type])
    const voice = this.makeVoice(args, model)
    if (!voice) return
    if (voice.origin === 'recorded' && layer.stringRes && isAcoustic(layer.type)) {
      const loaded = this.library?.get(model.id)
      if (loaded) {
        const sounding_ = [...this.voices.values()].filter((v) => v.layer === layerId && v.voice.origin === 'recorded').map((v) => v.note)
        const pedal = !!target.pedal && layer.sustPed
        const partners = resonancePartners(sounding, sounding_, pedal)
        if (partners.length) addResonance(voice, args, loaded, partners)
      }
    }
    voice.sources[0].onended = () => this.finish(voiceId)
    this.voices.set(voiceId, { id: voiceId, layer: layerId, note: sounding, voice, timer: null })
    this.syncStatus()
  }

  release(voiceId: number): void {
    const live = this.voices.get(voiceId)
    if (!live || !this.ctx) {
      this.notifyEnded(voiceId)
      return
    }
    const layer = this.opts.state.get().layers[live.layer]
    this.fade(live, releaseTime(layer.type, live.note, layer.softRelease))
  }

  steal(voiceId: number): void {
    const live = this.voices.get(voiceId)
    if (!live || !this.ctx) {
      this.notifyEnded(voiceId)
      return
    }
    this.fade(live, STEAL_FADE_SECONDS)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const id of Array.from(this.voices.keys())) this.finish(id, false)
    this.graph?.dispose()
    this.library?.dispose()
    this.generated.clear()
    const ctx = this.ctx
    if (ctx) {
      ctx.onstatechange = null
      ctx.close().catch(() => undefined)
    }
    this.ctx = null
    this.graph = null
    this.library = null
    this.onVoiceEnded = null
    this.status = { phase: 'idle', message: 'Audio stopped' }
  }

  // --- internals --------------------------------------------------------------------------------
  private makeVoice(args: StartArgs, model: ModelInfo): Voice | null {
    if (model.kind === 'synth' && model.synth) {
      try {
        return startSynthVoice(args, model.synth)
      } catch {
        return this.fallbackVoice(args)
      }
    }
    const loaded = this.library?.get(model.id)
    if (loaded) {
      try {
        const v = startSampleVoice(args, loaded)
        if (v) return v
      } catch {
        // fall through to the labelled fallback
      }
    }
    return this.fallbackVoice(args)
  }

  /** labelled fallbacks: generated additive piano, then a plain oscillator */
  private fallbackVoice(args: StartArgs): Voice | null {
    if (!this.generatedFailed) {
      try {
        return startGeneratedVoice(args, this.generated)
      } catch {
        this.generatedFailed = true
      }
    }
    try {
      return startOscillatorVoice(args)
    } catch {
      return null
    }
  }

  private requestModels(state: EngineState) {
    if (!this.library) return
    for (const id of LAYER_IDS) {
      const layer = state.layers[id]
      if (!layer.enabled) continue
      const model = modelFor(layer.type, layer.models[layer.type])
      if (model.kind === 'recorded') this.library.request(model.id)
    }
  }

  private fade(live: LiveVoice, seconds: number) {
    if (live.timer !== null || !this.ctx) return
    live.voice.fade(seconds)
    live.timer = this.opts.scheduler.setTimeout(() => this.finish(live.id), Math.ceil(seconds * 1000) + 40)
  }

  private finish(voiceId: number, notify = true) {
    const live = this.voices.get(voiceId)
    if (!live) return
    this.voices.delete(voiceId)
    if (live.timer !== null) this.opts.scheduler.clearTimeout(live.timer)
    live.voice.dispose()
    if (notify) {
      this.notifyEnded(voiceId)
      this.syncStatus()
    }
  }

  private notifyEnded(voiceId: number) {
    this.onVoiceEnded?.(voiceId)
  }

  /** the status is derived from what is really loaded and running, never from what was requested */
  private syncStatus() {
    const ctx = this.ctx
    if (!ctx || this.disposed || this.failed) return
    if (ctx.state === 'closed') {
      this.fail('Audio context was closed')
      return
    }
    if (ctx.state !== 'running') {
      this.setStatus({ phase: 'loading', message: 'Audio starting… (waiting for the browser to allow sound)' })
      return
    }
    const state = this.opts.state.get()
    const problems: string[] = []
    const loading: string[] = []
    const ready: string[] = []
    let progress = ''
    const seen = new Set<string>()
    for (const id of LAYER_IDS) {
      const layer = state.layers[id]
      if (!layer.enabled) continue
      const model = modelFor(layer.type, layer.models[layer.type])
      if (seen.has(model.id)) continue
      seen.add(model.id)
      if (model.kind === 'synth') {
        ready.push(`${model.name} (live synthesis)`)
        continue
      }
      const s = this.library?.status(model.id) ?? { phase: 'idle', loaded: 0, total: 0 }
      if (s.phase === 'error') problems.push(model.name)
      else if (s.phase === 'ready') ready.push(`${model.name} (recorded samples)`)
      else {
        loading.push(model.name)
        progress = ` ${s.loaded}/${s.total}`
      }
    }
    if (problems.length) {
      const fallbackKind = this.generatedFailed ? 'plain oscillator' : 'generated additive piano'
      this.setStatus({ phase: 'fallback', message: `Piano not found: ${problems.join(', ')}. Fallback voice: ${fallbackKind} (recorded samples failed to load)` })
    } else if (loading.length) {
      this.setStatus({ phase: 'loading', message: `Loading recorded samples for ${loading.join(', ')}…${progress} (a generated stand-in plays meanwhile)` })
    } else if (this.generatedFailed && this.voices.size > 0 && [...this.voices.values()].some((v) => v.voice.origin === 'oscillator')) {
      this.setStatus({ phase: 'fallback', message: 'Fallback voice: plain triangle oscillator (piano buffers unavailable)' })
    } else {
      this.setStatus({ phase: 'ready', message: ready.length ? `Ready: ${ready.join(' + ')}` : 'Ready' })
    }
  }

  private fail(message: string) {
    this.failed = true
    this.setStatus({ phase: 'error', message })
  }

  private setStatus(status: AudioStatus) {
    if (this.status.phase === status.phase && this.status.message === status.message) return
    this.status = status
    this.opts.onStatus?.(status)
  }
}

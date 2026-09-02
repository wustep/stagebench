/**
 * PianoEngine: one deterministic note lifecycle feeding one piano voice.
 * voice = AudioBufferSource(generated buffer) -> GainNode -> master GainNode -> destination.
 * Status is reported exactly as observed: idle / loading / ready / error / fallback.
 */
import type { AudioBufferLike, AudioContextLike, BufferSourceLike, GainNodeLike, OscillatorLike, Timers } from './boundaries'
import { midiToFrequency, renderPianoNote, velocityGain, velocityLayer, type PianoRenderParams } from './pianoRenderer'

export type EngineState = 'idle' | 'loading' | 'ready' | 'error' | 'fallback'
export type VoiceSource = 'generated-buffers' | 'fallback-oscillator' | 'none'

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
}

export interface PianoEngineOptions {
  createContext: () => AudioContextLike
  timers: Timers
  renderer?: (params: PianoRenderParams) => Float32Array
  maxVoices?: number
  masterLevel?: number
  warmNotes?: number[]
  releaseSeconds?: number
  retriggerReleaseSeconds?: number
  stealReleaseSeconds?: number
  cacheSize?: number
  maxBufferSeconds?: number
}

export const RELEASE_SECONDS = 0.3
export const RETRIGGER_RELEASE_SECONDS = 0.03
export const STEAL_RELEASE_SECONDS = 0.02
export const ALL_NOTES_OFF_RELEASE_SECONDS = 0.08
export const LAYER_VELOCITIES = [32, 72, 112] as const
export const DEFAULT_MAX_VOICES = 32
const GAIN_FLOOR = 0.0005

interface Voice {
  id: number
  midi: number
  velocity: number
  kind: 'buffer' | 'fallback'
  source: BufferSourceLike | OscillatorLike
  gain: GainNodeLike
  startedAt: number
  keyDown: boolean
  sustained: boolean
  releasing: boolean
  endsAt: number
  cleanupTimer: unknown
}

export class PianoEngine {
  private ctx: AudioContextLike | null = null
  private master: GainNodeLike | null = null
  private voices = new Map<number, Voice>()
  private cache = new Map<string, AudioBufferLike>()
  private listeners = new Set<() => void>()
  private nextVoiceId = 1
  private sustain = false
  private status: EngineStatus
  private readonly opts: Required<Omit<PianoEngineOptions, 'renderer'>> & { renderer: (p: PianoRenderParams) => Float32Array }
  private disposed = false
  private createdNodes = 0
  private cleanedNodes = 0
  private warmQueue: number[] = []
  private warmTimer: unknown = null
  private rendererFailed = false

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
    }
  }

  getStatus = (): EngineStatus => this.status

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private update(patch: Partial<EngineStatus>) {
    this.status = { ...this.status, ...patch, activeVoices: this.voices.size, sustain: this.sustain, contextState: this.ctx?.state ?? this.status.contextState }
    this.listeners.forEach((l) => l())
  }

  /** Creates the context, master path and warm-up bank. Idempotent. */
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
    this.master = ctx.createGain()
    this.createdNodes++
    this.master.gain.setValueAtTime(this.opts.masterLevel, ctx.currentTime)
    this.master.connect(ctx.destination)
    this.update({ state: 'loading', message: 'Rendering the generated piano bank…', sampleRate: ctx.sampleRate, voiceSource: 'generated-buffers', warmed: 0 })
    this.warmQueue = [...this.opts.warmNotes]
    this.scheduleWarm()
    const resumed = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve()
    return resumed.then(
      () => this.update({}),
      (err) => this.update({ message: `Audio context could not resume: ${String(err)}` }),
    )
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
    else if (this.status.state === 'loading') this.update({ state: 'ready', message: 'Ready: generated additive piano voice (not a recording).' })
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

  private now(): number {
    return this.ctx ? this.ctx.currentTime : 0
  }

  noteOn(midi: number, velocity: number): boolean {
    if (!this.ctx) {
      void this.start()
      if (!this.ctx) return false
    }
    const ctx = this.ctx
    const master = this.master!
    velocity = Math.min(127, Math.max(1, Math.round(velocity)))
    // Repeated note: retrigger cleanly.
    for (const v of this.voices.values()) if (v.midi === midi && !v.releasing) this.release(v, this.opts.retriggerReleaseSeconds)
    // Deterministic stealing: oldest sounding voice first (ties by id).
    while (this.voices.size >= this.opts.maxVoices) {
      const victim = [...this.voices.values()].filter((v) => !v.releasing).sort((a, b) => a.startedAt - b.startedAt || a.id - b.id)[0]
      if (!victim) break
      this.release(victim, this.opts.stealReleaseSeconds)
      this.finalize(victim)
    }
    const t = ctx.currentTime
    const gain = ctx.createGain()
    this.createdNodes++
    gain.connect(master)
    let voice: Voice
    if (!this.rendererFailed) {
      try {
        const layer = velocityLayer(velocity)
        const layerVelocity = LAYER_VELOCITIES[layer]
        const buffer = this.bufferFor(midi, layerVelocity)
        const source = ctx.createBufferSource()
        this.createdNodes++
        source.buffer = buffer
        source.connect(gain)
        const level = velocityGain(velocity) / velocityGain(layerVelocity)
        gain.gain.setValueAtTime(level, t)
        source.start(t)
        voice = { id: this.nextVoiceId++, midi, velocity, kind: 'buffer', source, gain, startedAt: t, keyDown: true, sustained: false, releasing: false, endsAt: t + buffer.duration, cleanupTimer: null }
      } catch (err) {
        this.enterFallback(err)
        voice = this.fallbackVoice(midi, velocity, gain, t)
      }
    } else {
      voice = this.fallbackVoice(midi, velocity, gain, t)
    }
    this.voices.set(voice.id, voice)
    voice.source.onended = () => this.finalize(voice)
    voice.cleanupTimer = this.opts.timers.setTimeout(() => this.finalize(voice), Math.max(0, (voice.endsAt - t) * 1000) + 50)
    this.update({ lastNote: `${midi}@${velocity}` })
    return true
  }

  private fallbackVoice(midi: number, velocity: number, gain: GainNodeLike, t: number): Voice {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    this.createdNodes++
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(midiToFrequency(midi), t)
    osc.connect(gain)
    const level = 0.35 * velocityGain(velocity)
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(level, t + 0.005)
    gain.gain.exponentialRampToValueAtTime(GAIN_FLOOR, t + 2.5)
    osc.start(t)
    osc.stop(t + 2.55)
    return { id: this.nextVoiceId++, midi, velocity, kind: 'fallback', source: osc, gain, startedAt: t, keyDown: true, sustained: false, releasing: false, endsAt: t + 2.55, cleanupTimer: null }
  }

  noteOff(midi: number): void {
    for (const v of this.voices.values()) {
      if (v.midi !== midi || !v.keyDown) continue
      v.keyDown = false
      if (this.sustain) v.sustained = true
      else this.release(v, this.opts.releaseSeconds)
    }
    this.update({})
  }

  setSustain(on: boolean): void {
    if (this.sustain === on) return
    this.sustain = on
    if (!on) {
      for (const v of this.voices.values()) {
        if (v.sustained && !v.keyDown) {
          v.sustained = false
          this.release(v, this.opts.releaseSeconds)
        }
      }
    }
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
    this.update({})
  }

  private release(v: Voice, seconds: number) {
    if (v.releasing) return
    v.releasing = true
    const t = this.now()
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setValueAtTime(Math.max(GAIN_FLOOR, v.gain.gain.value), t)
    v.gain.gain.exponentialRampToValueAtTime(GAIN_FLOOR, t + seconds)
    const stopAt = t + seconds + 0.005
    v.source.stop(stopAt)
    v.endsAt = Math.min(v.endsAt, stopAt)
    this.opts.timers.clearTimeout(v.cleanupTimer)
    v.cleanupTimer = this.opts.timers.setTimeout(() => this.finalize(v), seconds * 1000 + 50)
  }

  private finalize(v: Voice) {
    if (!this.voices.has(v.id)) return
    this.voices.delete(v.id)
    this.opts.timers.clearTimeout(v.cleanupTimer)
    v.source.onended = null
    v.source.disconnect()
    v.gain.disconnect()
    this.cleanedNodes += 2
    this.update({})
  }

  /** Stops everything immediately, disconnects the master path and closes the context. */
  dispose(): void {
    this.disposed = true
    if (this.warmTimer !== null) this.opts.timers.clearTimeout(this.warmTimer)
    this.warmTimer = null
    this.warmQueue = []
    const t = this.now()
    for (const v of Array.from(this.voices.values())) {
      v.source.stop(t)
      this.finalize(v)
    }
    if (this.master) {
      this.master.disconnect()
      this.cleanedNodes++
      this.master = null
    }
    const ctx = this.ctx
    this.ctx = null
    this.cache.clear()
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined)
    this.sustain = false
    this.rendererFailed = false
    this.status = { ...this.status, contextState: 'closed' }
    this.update({ state: 'idle', message: 'Audio disposed; play a key or press Start audio to create a new audio context.', voiceSource: 'none', warmed: 0 })
  }

  /** Voices sounding right now (including releasing ones). */
  activeVoices(): { midi: number; velocity: number; keyDown: boolean; sustained: boolean; releasing: boolean; kind: 'buffer' | 'fallback' }[] {
    return [...this.voices.values()].map((v) => ({ midi: v.midi, velocity: v.velocity, keyDown: v.keyDown, sustained: v.sustained, releasing: v.releasing, kind: v.kind }))
  }

  metrics() {
    return {
      activeVoices: this.voices.size,
      createdNodes: this.createdNodes,
      cleanedNodes: this.cleanedNodes,
      liveNodes: this.createdNodes - this.cleanedNodes,
      cachedBuffers: this.cache.size,
      hasContext: this.ctx !== null,
    }
  }
}

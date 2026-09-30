import {
  midiToHz,
  releaseSeconds,
  renderPianoNote,
  RENDER_SAMPLE_RATE,
  velocityGain,
  velocityLayer,
  VELOCITY_LAYERS,
} from './pianoDsp'
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioStatus,
  BufferSourceLike,
  GainNodeLike,
  OscillatorLike,
  Scheduler,
  VoiceSink,
} from './types'

export const MASTER_LEVEL = 0.85
export const VOICE_HEADROOM = 0.4
export const STEAL_FADE_SECONDS = 0.02
const BUFFER_CACHE_LIMIT = 48

export interface WebAudioSinkOptions {
  createAudioContext: () => AudioContextLike | null
  scheduler: Scheduler
  onStatus?: (status: AudioStatus) => void
}

interface LiveVoice {
  id: number
  note: number
  source: BufferSourceLike | OscillatorLike
  gain: GainNodeLike
  level: number
  timer: number | null
}

/**
 * Turns note-lifecycle voice commands into Web Audio nodes. Every voice is routed
 * source → voice gain → master gain → limiter → destination; there is no other path to the output.
 *
 * The primary voice plays generated additive-synthesis buffers (see pianoDsp.ts). If buffer generation is not
 * possible it falls back to a plain oscillator voice and reports status "fallback".
 */
export class WebAudioPianoSink implements VoiceSink {
  onVoiceEnded: ((voiceId: number) => void) | null = null
  private readonly opts: WebAudioSinkOptions
  private ctx: AudioContextLike | null = null
  private master: GainNodeLike | null = null
  private limiter: ReturnType<AudioContextLike['createDynamicsCompressor']> | null = null
  private readonly voices = new Map<number, LiveVoice>()
  private readonly cache = new Map<string, AudioBufferLike>()
  private useFallback = false
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
      const master = ctx.createGain()
      master.gain.value = MASTER_LEVEL
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -6
      limiter.knee.value = 6
      limiter.ratio.value = 12
      limiter.attack.value = 0.003
      limiter.release.value = 0.15
      master.connect(limiter)
      limiter.connect(ctx.destination)
      this.master = master
      this.limiter = limiter
    } catch (error) {
      this.fail(`Audio graph could not be created: ${error instanceof Error ? error.message : 'unknown error'}`)
      return
    }
    ctx.onstatechange = () => this.syncState()
    this.setStatus({ phase: 'loading', message: 'Audio starting…' })
    this.syncState()
    if (ctx.state !== 'running') {
      ctx.resume().then(
        () => this.syncState(),
        () => this.fail('Audio was blocked by the browser. Press a key again to retry.'),
      )
    }
  }

  start(voiceId: number, note: number, velocity: number): void {
    this.ensureStarted()
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master || this.disposed) return
    const now = ctx.currentTime
    const level = velocityGain(velocity) * VOICE_HEADROOM
    let source: BufferSourceLike | OscillatorLike | null = null
    const gain = ctx.createGain()
    if (!this.useFallback) {
      try {
        const buffer = this.bufferFor(ctx, note, velocity)
        const bufferSource = ctx.createBufferSource()
        bufferSource.buffer = buffer
        source = bufferSource
      } catch {
        this.useFallback = true
        this.syncState()
      }
    }
    if (!source) {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = midiToHz(note)
      source = osc
    }
    const voice: LiveVoice = { id: voiceId, note, source, gain, level, timer: null }
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(level, now + 0.003)
    if (this.useFallback) {
      gain.gain.linearRampToValueAtTime(level * 0.35, now + 0.4)
      gain.gain.linearRampToValueAtTime(0, now + 2.6)
    }
    source.connect(gain)
    gain.connect(master)
    source.onended = () => this.finish(voiceId)
    source.start(now)
    if (this.useFallback) source.stop(now + 2.7)
    this.voices.set(voiceId, voice)
  }

  release(voiceId: number): void {
    const voice = this.voices.get(voiceId)
    const ctx = this.ctx
    if (!voice || !ctx) {
      this.notifyEnded(voiceId)
      return
    }
    const seconds = releaseSeconds(voice.note)
    this.fade(voice, ctx, seconds)
  }

  steal(voiceId: number): void {
    const voice = this.voices.get(voiceId)
    const ctx = this.ctx
    if (!voice || !ctx) {
      this.notifyEnded(voiceId)
      return
    }
    this.fade(voice, ctx, STEAL_FADE_SECONDS)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const id of Array.from(this.voices.keys())) this.finish(id, false)
    try {
      this.master?.disconnect()
      this.limiter?.disconnect()
    } catch {
      // nodes may already be disconnected
    }
    const ctx = this.ctx
    if (ctx) {
      ctx.onstatechange = null
      ctx.close().catch(() => undefined)
    }
    this.ctx = null
    this.master = null
    this.limiter = null
    this.cache.clear()
    this.onVoiceEnded = null
    this.status = { phase: 'idle', message: 'Audio stopped' }
  }

  // --- internals --------------------------------------------------------------------------------
  private fade(voice: LiveVoice, ctx: AudioContextLike, seconds: number) {
    if (voice.timer !== null) return
    const now = ctx.currentTime
    const param = voice.gain.gain
    param.cancelScheduledValues(now)
    param.setValueAtTime(param.value, now)
    param.linearRampToValueAtTime(0, now + seconds)
    voice.timer = this.opts.scheduler.setTimeout(() => this.finish(voice.id), Math.ceil(seconds * 1000) + 40)
  }

  private finish(voiceId: number, notify = true) {
    const voice = this.voices.get(voiceId)
    if (!voice) return
    this.voices.delete(voiceId)
    if (voice.timer !== null) this.opts.scheduler.clearTimeout(voice.timer)
    voice.source.onended = null
    try {
      voice.source.stop()
    } catch {
      // already stopped
    }
    try {
      voice.source.disconnect()
      voice.gain.disconnect()
    } catch {
      // already disconnected
    }
    if (notify) this.notifyEnded(voiceId)
  }

  private notifyEnded(voiceId: number) {
    this.onVoiceEnded?.(voiceId)
  }

  private bufferFor(ctx: AudioContextLike, note: number, velocity: number): AudioBufferLike {
    const layer = velocityLayer(velocity)
    const key = `${note}:${layer}`
    const hit = this.cache.get(key)
    if (hit) {
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit
    }
    const data = renderPianoNote(note, VELOCITY_LAYERS[layer], RENDER_SAMPLE_RATE)
    const buffer = ctx.createBuffer(1, data.length, RENDER_SAMPLE_RATE)
    buffer.getChannelData(0).set(data)
    this.cache.set(key, buffer)
    if (this.cache.size > BUFFER_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return buffer
  }

  private syncState() {
    const ctx = this.ctx
    if (!ctx || this.disposed || this.failed) return
    if (ctx.state === 'running') {
      this.setStatus(
        this.useFallback
          ? { phase: 'fallback', message: 'Fallback voice: plain triangle oscillator (piano buffers unavailable)' }
          : { phase: 'ready', message: 'Ready: generated additive piano voice' },
      )
    } else if (ctx.state === 'closed') {
      this.fail('Audio context was closed')
    } else {
      this.setStatus({ phase: 'loading', message: 'Audio starting… (waiting for the browser to allow sound)' })
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

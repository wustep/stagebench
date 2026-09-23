import type { VoiceFactory, VoiceHandle } from './noteEngine'
import {
  midiToHz,
  nearestRoot,
  renderPianoTone,
  rootNotes,
  TONE_SAMPLE_RATE,
  velocityCutoff,
  velocityGain,
  type ToneOptions,
} from './pianoTone'
import type { AudioContextLike, BufferLike, GainLike, NodeLike, ParamLike, ScheduledSourceLike } from './webAudioTypes'

export type VoiceStatus = 'loading' | 'ready' | 'fallback' | 'error'
export type AudioState = 'not-started' | 'running' | 'suspended' | 'unavailable' | 'closed'

export interface PianoStatus {
  voice: VoiceStatus
  audio: AudioState
  /** 0…1 while generating tones. */
  progress: number
  detail: string
}

export interface PianoAudioOptions {
  createContext: (() => AudioContextLike) | null
  lowNote: number
  highNote: number
  renderTone?: (note: number, options: ToneOptions) => Float32Array
  toneOptions?: ToneOptions
  /** Yield between generated roots so the page stays responsive (injectable for tests). */
  yieldToEventLoop?: () => Promise<void>
}

export const MASTER_GAIN = 0.32
const ATTACK = 0.003
const RELEASE_TAU = 0.085
const TREBLE_RELEASE_TAU = 0.3 // undamped top strings ring a little longer
const FAST_TAU = 0.012
const STOP_AFTER_TAUS = 7

interface ActiveVoice {
  nodes: NodeLike[]
  source: ScheduledSourceLike
  gain: GainLike
  ended: boolean
  cleanup: () => void
}

function holdParam(param: ParamLike, now: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now)
  } else {
    const current = param.value
    param.cancelScheduledValues(now)
    param.setValueAtTime(current, now)
  }
}

/**
 * The single Phase 1 piano voice. Generated (synthesized) root tones are played through
 * BufferSource → low-pass (velocity brightness) → gain (velocity + envelope) → master → out.
 * While tones are still generating, or if generation fails, a clearly labelled oscillator
 * fallback plays through the same chain.
 */
export class PianoAudio implements VoiceFactory {
  private ctx: AudioContextLike | null = null
  private master: GainLike | null = null
  private readonly pcm = new Map<number, Float32Array>()
  private readonly buffers = new Map<number, BufferLike>()
  private readonly active = new Set<ActiveVoice>()
  private readonly listeners = new Set<() => void>()
  private readonly roots: number[]
  private disposed = false
  private statusValue: PianoStatus
  private readonly toneRate: number

  constructor(private readonly options: PianoAudioOptions) {
    this.roots = rootNotes(options.lowNote, options.highNote)
    this.toneRate = options.toneOptions?.sampleRate ?? TONE_SAMPLE_RATE
    this.statusValue = options.createContext
      ? { voice: 'loading', audio: 'not-started', progress: 0, detail: 'Generating piano tones…' }
      : { voice: 'error', audio: 'unavailable', progress: 0, detail: 'Web Audio is not available in this browser — the keybed cannot make sound.' }
  }

  get status(): PianoStatus {
    return this.statusValue
  }

  get rootList(): readonly number[] {
    return this.roots
  }

  /** Voices whose Web Audio nodes are still allocated. */
  get liveVoiceCount(): number {
    return this.active.size
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setStatus(patch: Partial<PianoStatus>): void {
    this.statusValue = { ...this.statusValue, ...patch }
    this.listeners.forEach((l) => l())
  }

  async load(): Promise<void> {
    if (!this.options.createContext || this.disposed) return
    const render = this.options.renderTone ?? renderPianoTone
    const yieldFn = this.options.yieldToEventLoop ?? (() => new Promise<void>((r) => setTimeout(r, 0)))
    try {
      for (let i = 0; i < this.roots.length; i++) {
        if (this.disposed) return
        const root = this.roots[i]
        const data = render(root, { ...this.options.toneOptions, sampleRate: this.toneRate })
        if (!(data instanceof Float32Array) || data.length === 0) throw new Error(`empty tone for note ${root}`)
        this.pcm.set(root, data)
        this.setStatus({ progress: (i + 1) / this.roots.length, detail: `Generating piano tones… ${i + 1}/${this.roots.length}` })
        await yieldFn()
      }
      if (this.disposed) return
      this.setStatus({ voice: 'ready', progress: 1, detail: `Synthesized piano ready (${this.roots.length} generated root tones).` })
    } catch (error) {
      if (this.disposed) return
      this.pcm.clear()
      const message = error instanceof Error ? error.message : String(error)
      this.setStatus({ voice: 'fallback', detail: `Piano tone generation failed (${message}). Playing the labelled fallback oscillator tone.` })
    }
  }

  /** Create/resume the AudioContext. Call from a user gesture so browsers allow sound. */
  unlock(): AudioContextLike | null {
    if (this.disposed) return null
    if (!this.ctx) {
      if (!this.options.createContext) return null
      try {
        this.ctx = this.options.createContext()
        this.master = this.ctx.createGain()
        this.master.gain.value = MASTER_GAIN
        this.master.connect(this.ctx.destination)
      } catch (error) {
        this.ctx = null
        this.master = null
        const message = error instanceof Error ? error.message : String(error)
        this.setStatus({ voice: 'error', audio: 'unavailable', detail: `Could not start Web Audio (${message}).` })
        return null
      }
    }
    const ctx = this.ctx
    this.syncAudioState()
    if (ctx.state === 'suspended') {
      ctx.resume().then(
        () => this.syncAudioState(),
        () => this.syncAudioState(),
      )
    }
    return ctx
  }

  private syncAudioState(): void {
    if (!this.ctx || this.disposed) return
    const audio: AudioState = this.ctx.state === 'running' ? 'running' : this.ctx.state === 'closed' ? 'closed' : 'suspended'
    if (audio !== this.statusValue.audio) this.setStatus({ audio })
  }

  private bufferFor(root: number): BufferLike | null {
    const cached = this.buffers.get(root)
    if (cached) return cached
    const data = this.pcm.get(root)
    if (!data || !this.ctx) return null
    const buffer = this.ctx.createBuffer(1, data.length, this.toneRate)
    buffer.copyToChannel(data, 0)
    this.buffers.set(root, buffer)
    return buffer
  }

  startVoice(note: number, velocity: number, onEnded: () => void): VoiceHandle | null {
    const ctx = this.unlock()
    const master = this.master
    if (!ctx || !master) return null
    const t = ctx.currentTime
    const amp = velocityGain(velocity)

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = velocityCutoff(velocity, note)
    filter.Q.value = 0.5
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(amp, t + ATTACK)

    let source: ScheduledSourceLike
    let naturalStop: number | null = null
    const root = this.statusValue.voice === 'ready' ? nearestRoot(this.roots, note) : null
    const buffer = root === null ? null : this.bufferFor(root)
    if (buffer && root !== null) {
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.playbackRate.value = Math.pow(2, (note - root) / 12)
      source = src
    } else {
      // Labelled fallback: a decaying triangle oscillator (used while loading or after a failure).
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = midiToHz(note)
      gain.gain.setTargetAtTime(amp * 0.15, t + ATTACK, 0.9)
      source = osc
      naturalStop = t + 6
    }

    source.connect(filter)
    filter.connect(gain)
    gain.connect(master)

    const voice: ActiveVoice = {
      nodes: [source, filter, gain],
      source,
      gain,
      ended: false,
      cleanup: () => {
        if (voice.ended) return
        voice.ended = true
        source.onended = null
        for (const node of voice.nodes) node.disconnect()
        this.active.delete(voice)
        onEnded()
      },
    }
    source.onended = voice.cleanup
    this.active.add(voice)
    source.start(t)
    if (naturalStop !== null) source.stop(naturalStop)

    return {
      release: (fast: boolean) => {
        if (voice.ended || !this.ctx) return
        const now = this.ctx.currentTime
        const tau = fast ? FAST_TAU : note >= 89 ? TREBLE_RELEASE_TAU : RELEASE_TAU
        holdParam(gain.gain, now)
        gain.gain.setTargetAtTime(0, now, tau)
        try {
          source.stop(now + tau * STOP_AFTER_TAUS)
        } catch {
          // Already stopped: onended will (or did) clean up.
        }
      },
      stopNow: () => {
        if (voice.ended) return
        try {
          source.stop()
        } catch {
          // ignore
        }
        voice.cleanup()
      },
    }
  }

  /** Stop every voice immediately and free all nodes. */
  stopAll(): void {
    for (const voice of [...this.active]) {
      try {
        voice.source.stop()
      } catch {
        // ignore
      }
      voice.cleanup()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.stopAll()
    this.disposed = true
    this.master?.disconnect()
    const ctx = this.ctx
    this.ctx = null
    this.master = null
    this.buffers.clear()
    this.pcm.clear()
    if (ctx) void ctx.close().catch(() => undefined)
    this.statusValue = { ...this.statusValue, audio: 'closed' }
    this.listeners.clear()
  }
}

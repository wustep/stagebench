import type { AudioBoundary, AudioContextLike, AudioNodeLike, GainNodeLike, OscillatorNodeLike } from './boundaries'

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error' | 'fallback'
export type VoiceMode = 'primary' | 'fallback' | 'none'

const MAX_POLYPHONY = 32
const RELEASE_SEC = 0.22
const QUICK_RELEASE_SEC = 0.045

const PARTIALS = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.42 },
  { ratio: 3, gain: 0.16 },
  { ratio: 4.02, gain: 0.07 },
  { ratio: 5.1, gain: 0.035 },
] as const

export interface PianoEngineOptions {
  /** Throw after the context exists so the labeled sine fallback is used. */
  failPrimary?: boolean
  maxPolyphony?: number
}

interface Voice {
  id: number
  midi: number
  seq: number
  held: boolean
  sustained: boolean
  peak: number
  startTime: number
  nodes: AudioNodeLike[]
  oscs: OscillatorNodeLike[]
  gain: GainNodeLike
  cleanupTimer: number | null
  stopped: boolean
}

function midiFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

function hashNoise(length: number, seed: number): Float32Array {
  let state = seed >>> 0 || 1
  const data = new Float32Array(length)
  for (let index = 0; index < length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const noise = state / 4294967296 * 2 - 1
    data[index] = noise * Math.exp(-index / (length * 0.18)) * 0.4
  }
  return data
}

/**
 * One piano-like voice: additive partials plus a generated hammer-noise
 * transient. Not a sample set. Panel controls are not read here.
 */
export class PianoEngine {
  private phase: EngineStatus = 'idle'
  private detail = 'tap a key to play'
  private mode: VoiceMode = 'none'
  private ctx: AudioContextLike | null = null
  private master: GainNodeLike | null = null
  private readonly voices = new Set<Voice>()
  private readonly byMidi = new Map<number, Voice>()
  private readonly listeners = new Set<() => void>()
  private nextId = 1
  private seq = 1
  private sustainDown = false
  private disposed = false
  private readonly maxPolyphony: number

  constructor(
    private readonly boundary: AudioBoundary,
    private readonly options: PianoEngineOptions = {},
  ) {
    this.maxPolyphony = options.maxPolyphony ?? MAX_POLYPHONY
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  getStatus(): EngineStatus {
    return this.phase
  }

  getDetail(): string {
    return this.detail
  }

  getMode(): VoiceMode {
    return this.mode
  }

  isSustainDown(): boolean {
    return this.sustainDown
  }

  activeVoiceCount(): number {
    return this.voices.size
  }

  heldVoiceCount(): number {
    let count = 0
    for (const voice of this.voices) if (voice.held) count += 1
    return count
  }

  isNoteActive(midi: number): boolean {
    return this.byMidi.has(midi)
  }

  private setStatus(phase: EngineStatus, detail: string) {
    this.phase = phase
    this.detail = detail
    this.emit()
  }

  ensureStarted() {
    if (this.disposed) return
    if (this.phase !== 'idle') return
    this.setStatus('loading', 'starting voice')
    try {
      this.ctx = this.boundary.createContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.85
      this.connectMaster(this.ctx, this.master)
      if (this.options.failPrimary) throw new Error('primary piano voice failed to initialize')
      this.mode = 'primary'
      this.setStatus('ready', 'additive piano')
    } catch (error) {
      if (this.ctx && this.master) {
        this.mode = 'fallback'
        this.setStatus('fallback', 'sine fallback')
      } else {
        this.ctx = null
        this.master = null
        this.mode = 'none'
        const message = error instanceof Error ? error.message : 'audio unavailable'
        this.setStatus('error', message)
      }
    }
  }

  private connectMaster(ctx: AudioContextLike, master: GainNodeLike) {
    try {
      if (ctx.createDynamicsCompressor) {
        const compressor = ctx.createDynamicsCompressor()
        compressor.threshold.value = -12
        compressor.knee.value = 6
        compressor.ratio.value = 8
        compressor.attack.value = 0.003
        compressor.release.value = 0.15
        master.connect(compressor)
        compressor.connect(ctx.destination)
        return
      }
    } catch {
      /* Compressor is optional; the master gain still reaches the destination. */
    }
    master.connect(ctx.destination)
  }

  private resume() {
    const ctx = this.ctx
    if (ctx && ctx.state === 'suspended' && ctx.resume) void ctx.resume()
  }

  noteOn(midi: number, velocity: number, at?: number) {
    if (this.disposed) return
    if (velocity <= 0) {
      this.noteOff(midi, at)
      return
    }
    this.ensureStarted()
    if (!this.ctx || !this.master || this.mode === 'none') return
    this.resume()
    const existing = this.byMidi.get(midi)
    if (existing) {
      existing.held = false
      existing.sustained = false
      this.byMidi.delete(midi)
      this.releaseVoice(existing, QUICK_RELEASE_SEC, at)
    }
    while (this.voices.size >= this.maxPolyphony) {
      const oldest = this.oldestVoice()
      if (!oldest) break
      this.stopImmediate(oldest)
    }
    const voice = this.startVoice(midi, Math.min(1, velocity), at)
    this.byMidi.set(midi, voice)
    this.emit()
  }

  noteOff(midi: number, at?: number) {
    const voice = this.byMidi.get(midi)
    if (!voice) return
    voice.held = false
    if (this.sustainDown) {
      voice.sustained = true
      this.emit()
      return
    }
    this.byMidi.delete(midi)
    this.releaseVoice(voice, RELEASE_SEC, at)
    this.emit()
  }

  setSustain(down: boolean, at?: number) {
    if (this.sustainDown === down) return
    this.sustainDown = down
    if (!down) {
      for (const voice of [...this.voices]) {
        if (voice.sustained && !voice.held) {
          voice.sustained = false
          this.byMidi.delete(voice.midi)
          this.releaseVoice(voice, RELEASE_SEC, at)
        }
      }
    }
    this.emit()
  }

  /** Immediate silence: blur, disconnect, unmount, panic. */
  allNotesOff() {
    this.sustainDown = false
    for (const voice of [...this.voices]) this.stopImmediate(voice)
    this.byMidi.clear()
    this.emit()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.allNotesOff()
    const ctx = this.ctx
    this.ctx = null
    this.master = null
    if (ctx?.close) void ctx.close()
  }

  private oldestVoice(): Voice | null {
    let oldest: Voice | null = null
    for (const voice of this.voices) {
      if (!oldest || voice.seq < oldest.seq) oldest = voice
    }
    return oldest
  }

  private time(at?: number): number {
    return at ?? this.ctx?.currentTime ?? 0
  }

  private startVoice(midi: number, velocity: number, at?: number): Voice {
    const ctx = this.ctx!
    const master = this.master!
    const start = this.time(at)
    const peak = (this.mode === 'fallback' ? 0.08 : 0.05) + 0.55 * velocity ** 1.45
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + 0.008)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.32), start + 0.55)
    gain.connect(master)

    const nodes: AudioNodeLike[] = [gain]
    const oscs: OscillatorNodeLike[] = []

    if (this.mode === 'fallback') {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(midiFreq(midi), start)
      osc.connect(gain)
      osc.start(start)
      oscs.push(osc)
      nodes.push(osc)
    } else {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(650 + velocity * 6200, start)
      filter.Q.setValueAtTime(0.7, start)
      filter.connect(gain)
      nodes.push(filter)
      const fundamental = midiFreq(midi)
      for (const partial of PARTIALS) {
        const osc = ctx.createOscillator()
        const partialGain = ctx.createGain()
        osc.type = 'sine'
        const inharmonic = 1 + 0.00015 * partial.ratio * partial.ratio
        osc.frequency.setValueAtTime(fundamental * partial.ratio * inharmonic, start)
        partialGain.gain.setValueAtTime(partial.gain, start)
        osc.connect(partialGain)
        partialGain.connect(filter)
        osc.start(start)
        oscs.push(osc)
        nodes.push(osc, partialGain)
      }
      const length = Math.max(8, Math.floor(ctx.sampleRate * 0.028))
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
      buffer.getChannelData(0).set(hashNoise(length, midi * 997 + this.seq))
      const noise = ctx.createBufferSource()
      const noiseGain = ctx.createGain()
      noise.buffer = buffer
      noiseGain.gain.setValueAtTime(0.22 + velocity * 0.35, start)
      noise.connect(noiseGain)
      noiseGain.connect(filter)
      noise.start(start)
      try {
        noise.stop(start + 0.04)
      } catch {
        /* already stopped */
      }
      nodes.push(noise, noiseGain)
    }

    const voice: Voice = {
      id: this.nextId++,
      midi,
      seq: this.seq++,
      held: true,
      sustained: false,
      peak,
      startTime: start,
      nodes,
      oscs,
      gain,
      cleanupTimer: null,
      stopped: false,
    }
    this.voices.add(voice)
    return voice
  }

  private envelopeLevel(voice: Voice, at: number): number {
    const elapsed = Math.max(0, at - voice.startTime)
    if (elapsed < 0.008) return Math.max(0.0002, voice.peak * (elapsed / 0.008))
    const decay = Math.min(1, (elapsed - 0.008) / 0.542)
    return Math.max(0.0002, voice.peak * (1 - decay * 0.68))
  }

  private releaseVoice(voice: Voice, seconds: number, at?: number) {
    if (voice.stopped || !this.ctx) return
    const when = this.time(at)
    const level = this.envelopeLevel(voice, when)
    try {
      voice.gain.gain.cancelScheduledValues(when)
      voice.gain.gain.setValueAtTime(level, when)
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, when + seconds)
    } catch {
      /* context closed */
    }
    for (const osc of voice.oscs) {
      try {
        osc.stop(when + seconds + 0.03)
      } catch {
        /* already stopped */
      }
    }
    this.armCleanup(voice, Math.ceil((seconds + 0.05) * 1000))
  }

  private armCleanup(voice: Voice, ms: number) {
    if (voice.cleanupTimer !== null) this.boundary.timers.clearTimeout(voice.cleanupTimer)
    voice.cleanupTimer = this.boundary.timers.setTimeout(() => this.disconnect(voice), ms)
  }

  private stopImmediate(voice: Voice) {
    if (voice.cleanupTimer !== null) {
      this.boundary.timers.clearTimeout(voice.cleanupTimer)
      voice.cleanupTimer = null
    }
    const when = this.ctx?.currentTime ?? 0
    if (!voice.stopped) {
      try {
        voice.gain.gain.cancelScheduledValues(when)
        voice.gain.gain.setValueAtTime(0.0001, when)
      } catch {
        /* context closed */
      }
      for (const osc of voice.oscs) {
        try {
          osc.stop(when)
        } catch {
          /* already stopped */
        }
      }
    }
    this.disconnect(voice)
  }

  private disconnect(voice: Voice) {
    if (voice.stopped) return
    voice.stopped = true
    voice.held = false
    voice.sustained = false
    for (const node of voice.nodes) {
      try {
        node.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    this.voices.delete(voice)
    if (this.byMidi.get(voice.midi) === voice) this.byMidi.delete(voice.midi)
    this.emit()
  }
}

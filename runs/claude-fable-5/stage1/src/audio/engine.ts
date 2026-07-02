import type {
  AudioBoundary,
  AudioContextLike,
  AudioNodeLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
} from './boundaries'

/**
 * Basic Piano engine (Phase 1).
 *
 * One honestly-generated piano-like voice: per note a small stack of detuned
 * oscillator partials runs through a velocity/pitch-keyed lowpass filter and a
 * percussive gain envelope into a master gain and soft limiter. No recorded
 * samples are used and none are claimed.
 */
export type EngineStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'

export interface EngineStatusInfo {
  status: EngineStatus
  message: string
}

interface Voice {
  midi: number
  seq: number
  keyDown: boolean
  sustained: boolean
  releasing: boolean
  oscillators: OscillatorNodeLike[]
  /** Every non-oscillator node owned by this voice (partial gains, filter, envelope). */
  ownedNodes: AudioNodeLike[]
  gain: GainNodeLike
  cleanupTimer: number | null
}

export const MAX_POLYPHONY = 24
const RELEASE_SECONDS = 0.22
const QUICK_RELEASE_SECONDS = 0.03
const CLEANUP_GRACE_MS = 80

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export class PianoEngine {
  private readonly boundary: AudioBoundary
  private context: AudioContextLike | null = null
  private masterGain: GainNodeLike | null = null
  private voices = new Map<number, Voice>()
  private releasingVoices = new Set<Voice>()
  private sustainDown = false
  private seqCounter = 0
  private statusInfo: EngineStatusInfo = { status: 'idle', message: 'Audio starts on the first key press.' }
  private listeners = new Set<(info: EngineStatusInfo) => void>()

  constructor(boundary: AudioBoundary) {
    this.boundary = boundary
  }

  getStatus(): EngineStatusInfo {
    return this.statusInfo
  }

  subscribe(listener: (info: EngineStatusInfo) => void): () => void {
    this.listeners.add(listener)
    listener(this.statusInfo)
    return () => this.listeners.delete(listener)
  }

  private setStatus(status: EngineStatus, message: string): void {
    this.statusInfo = { status, message }
    for (const listener of this.listeners) listener(this.statusInfo)
  }

  /** Lazily creates the audio graph. Safe to call from any input gesture. */
  ensureStarted(): void {
    if (this.context) return
    this.setStatus('loading', 'Starting audio engine…')
    let context: AudioContextLike
    try {
      context = this.boundary.createContext()
    } catch (error) {
      this.setStatus('error', `Audio unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    this.context = context
    try {
      const master = context.createGain()
      master.gain.value = 0.85
      let tail: AudioNodeLike = master
      if (typeof context.createDynamicsCompressor === 'function') {
        const limiter = context.createDynamicsCompressor()
        limiter.threshold.value = -12
        limiter.knee.value = 20
        limiter.ratio.value = 12
        limiter.attack.value = 0.003
        limiter.release.value = 0.25
        master.connect(limiter)
        tail = limiter
      }
      tail.connect(context.destination)
      this.masterGain = master
      if (context.state === 'suspended') void context.resume()
      this.setStatus('ready', 'Basic piano voice ready (generated synthesis — no samples).')
    } catch {
      // Preferred graph failed: fall back to the most minimal usable path.
      try {
        const master = context.createGain()
        master.gain.value = 0.7
        master.connect(context.destination)
        this.masterGain = master
        this.setStatus('fallback', 'Running on a reduced audio path (no limiter).')
      } catch (fallbackError) {
        this.setStatus('error', `Audio graph failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`)
      }
    }
  }

  isRunning(): boolean {
    return this.masterGain !== null
  }

  activeVoiceCount(): number {
    return this.voices.size + this.releasingVoices.size
  }

  heldVoiceCount(): number {
    return this.voices.size
  }

  isNoteActive(midi: number): boolean {
    return this.voices.has(midi)
  }

  noteOn(midi: number, velocity: number): void {
    this.ensureStarted()
    const context = this.context
    const master = this.masterGain
    if (!context || !master) return

    const clampedVelocity = Math.min(1, Math.max(0, velocity))
    // Retrigger: quick-release any existing voice on the same note.
    const existing = this.voices.get(midi)
    if (existing) this.releaseVoice(existing, QUICK_RELEASE_SECONDS)
    // Deterministic voice stealing: drop the oldest held voice past the cap.
    while (this.voices.size >= MAX_POLYPHONY) {
      let oldest: Voice | null = null
      for (const voice of this.voices.values()) {
        if (!oldest || voice.seq < oldest.seq) oldest = voice
      }
      if (!oldest) break
      this.releaseVoice(oldest, QUICK_RELEASE_SECONDS)
    }

    const now = context.currentTime
    const frequency = midiToFrequency(midi)
    const gain = context.createGain()
    const peak = 0.04 + 0.32 * Math.pow(clampedVelocity, 1.5)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.004)
    // Percussive piano-like decay toward a low singing level.
    gain.gain.setTargetAtTime(peak * 0.12, now + 0.004, 0.35 + 1.4 / Math.sqrt(Math.max(1, midi - 20)))

    const ownedNodes: AudioNodeLike[] = [gain]
    let voiceInput: AudioNodeLike = gain
    try {
      const filter: BiquadFilterNodeLike = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = Math.min(9000, 500 + frequency * 1.5 + clampedVelocity * 4200)
      filter.Q.value = 0.4
      filter.connect(gain)
      voiceInput = filter
      ownedNodes.push(filter)
    } catch {
      /* voice runs unfiltered */
    }
    gain.connect(master)

    const partials: Array<{ ratio: number; type: string; level: number; detune: number }> = [
      { ratio: 1, type: 'triangle', level: 1, detune: 0 },
      { ratio: 1, type: 'sine', level: 0.5, detune: 3 },
      { ratio: 2, type: 'sine', level: 0.24, detune: -2 },
      { ratio: 3.01, type: 'sine', level: 0.08, detune: 0 },
    ]
    const oscillators: OscillatorNodeLike[] = []
    for (const partial of partials) {
      const osc = context.createOscillator()
      osc.type = partial.type
      osc.frequency.value = frequency * partial.ratio
      osc.detune.value = partial.detune
      const partialGain = context.createGain()
      partialGain.gain.value = partial.level
      osc.connect(partialGain)
      partialGain.connect(voiceInput)
      osc.start(now)
      oscillators.push(osc)
      ownedNodes.push(partialGain)
    }

    const voice: Voice = {
      midi,
      seq: this.seqCounter++,
      keyDown: true,
      sustained: false,
      releasing: false,
      oscillators,
      ownedNodes,
      gain,
      cleanupTimer: null,
    }
    this.voices.set(midi, voice)
  }

  noteOff(midi: number): void {
    const voice = this.voices.get(midi)
    if (!voice) return
    voice.keyDown = false
    if (this.sustainDown) {
      voice.sustained = true
      return
    }
    this.releaseVoice(voice, RELEASE_SECONDS)
  }

  setSustain(down: boolean): void {
    if (this.sustainDown === down) return
    this.sustainDown = down
    if (!down) {
      for (const voice of [...this.voices.values()]) {
        if (voice.sustained && !voice.keyDown) this.releaseVoice(voice, RELEASE_SECONDS)
      }
    }
  }

  isSustainDown(): boolean {
    return this.sustainDown
  }

  allNotesOff(_reason: 'blur' | 'midi-disconnect' | 'unmount' | 'input-cleanup'): void {
    this.sustainDown = false
    for (const voice of [...this.voices.values()]) this.releaseVoice(voice, QUICK_RELEASE_SECONDS)
  }

  private releaseVoice(voice: Voice, releaseSeconds: number): void {
    if (voice.releasing) return
    voice.releasing = true
    this.voices.delete(voice.midi)
    this.releasingVoices.add(voice)
    const context = this.context
    if (context) {
      const now = context.currentTime
      voice.gain.gain.cancelScheduledValues(now)
      voice.gain.gain.setTargetAtTime(0.0001, now, releaseSeconds / 4)
      const stopAt = now + releaseSeconds + 0.05
      for (const osc of voice.oscillators) {
        try {
          osc.stop(stopAt)
        } catch {
          /* already stopped */
        }
      }
    }
    voice.cleanupTimer = this.boundary.timers.setTimeout(
      () => this.cleanupVoice(voice),
      releaseSeconds * 1000 + CLEANUP_GRACE_MS,
    )
  }

  private cleanupVoice(voice: Voice): void {
    if (voice.cleanupTimer !== null) {
      this.boundary.timers.clearTimeout(voice.cleanupTimer)
      voice.cleanupTimer = null
    }
    for (const osc of voice.oscillators) {
      try {
        osc.disconnect()
      } catch {
        /* detached */
      }
    }
    for (const node of voice.ownedNodes) {
      try {
        node.disconnect()
      } catch {
        /* detached */
      }
    }
    this.releasingVoices.delete(voice)
  }

  /**
   * Stops every owned voice and releases the audio graph. The engine returns
   * to `idle` and may be lazily restarted by a later gesture (this keeps
   * React StrictMode mount/cleanup/mount cycles sound).
   */
  dispose(): void {
    this.allNotesOff('unmount')
    for (const voice of [...this.releasingVoices]) this.cleanupVoice(voice)
    this.masterGain?.disconnect()
    this.masterGain = null
    if (this.context) void this.context.close()
    this.context = null
    this.setStatus('idle', 'Audio starts on the first key press.')
  }
}

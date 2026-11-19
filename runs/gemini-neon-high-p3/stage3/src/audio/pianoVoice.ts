import {
  browserAudioContextFactory,
  browserClock,
  browserSampleFetcher,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioContextFactory,
  type AudioContextLike,
  type AudioNodeLike,
  type Clock,
  type DynamicsCompressorNodeLike,
  type GainNodeLike,
  type OscillatorNodeLike,
  type PianoEngineStatusSnapshot,
  type PianoVoiceBackend,
  type SampleFetcher,
  type TimerHandle,
} from './boundaries'
import { PianoSampleBank, selectSampleForNote } from './pianoSamples'

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

interface ActiveVoiceHandle {
  readonly voiceId: number
  readonly midi: number
  readonly gainNode: GainNodeLike
  readonly nodes: AudioNodeLike[]
  readonly stopTargets: Array<AudioBufferSourceNodeLike | OscillatorNodeLike>
  readonly isFallback: boolean
  released: boolean
  cleanupTimer: TimerHandle | null
}

export interface WebAudioPianoEngineOptions {
  readonly contextFactory?: AudioContextFactory
  readonly sampleFetcher?: SampleFetcher
  readonly clock?: Clock
  readonly baseUrl?: string
  readonly autoLoadSamples?: boolean
}

/**
 * Playable Phase 1 basic piano voice engine.
 * - Uses bundled Salamander Grand V3 multi-sample recordings when decoded.
 * - Routes every voice through one master gain + soft-knee limiter chain so 10+ note chords never clip.
 * - Falls back truthfully to a live harmonic-piano Web Audio synthesis voice while loading or if sample decoding fails.
 */
export class WebAudioPianoEngine implements PianoVoiceBackend {
  private readonly contextFactory: AudioContextFactory
  private readonly clock: Clock
  private readonly sampleBank: PianoSampleBank
  private readonly voices = new Map<number, ActiveVoiceHandle>()
  private readonly statusListeners = new Set<(snap: PianoEngineStatusSnapshot) => void>()

  private ctx: AudioContextLike | null = null
  private masterGain: GainNodeLike | null = null
  private limiter: DynamicsCompressorNodeLike | null = null
  private contextError: string | null = null
  private usedFallbackForRecentNote = false
  private disposed = false
  private unsubBank: (() => void) | null = null

  constructor(options: WebAudioPianoEngineOptions = {}) {
    this.contextFactory = options.contextFactory ?? browserAudioContextFactory
    this.clock = options.clock ?? browserClock
    this.sampleBank = new PianoSampleBank(
      options.sampleFetcher ?? browserSampleFetcher,
      options.baseUrl ?? './',
    )

    this.unsubBank = this.sampleBank.subscribe(() => {
      if (this.sampleBank.getDecodedCount() === this.sampleBank.totalCount) {
        this.usedFallbackForRecentNote = false
      }
      this.emitStatus()
    })

    // Initialize AudioContext eagerly if possible so samples can decode immediately while suspended
    this.ensureContext()
    if (options.autoLoadSamples !== false) {
      void this.sampleBank.loadAll(this.ctx)
    }
  }

  private ensureContext(): AudioContextLike | null {
    if (this.disposed) return null
    if (this.ctx) return this.ctx
    try {
      const created = this.contextFactory()
      if (!created) {
        this.contextError = 'Web Audio API is unavailable in this environment.'
        this.emitStatus()
        return null
      }
      this.ctx = created
      this.masterGain = created.createGain()
      this.masterGain.gain.value = 0.56

      this.limiter = created.createDynamicsCompressor()
      this.limiter.threshold.value = -5
      this.limiter.knee.value = 12
      this.limiter.ratio.value = 10
      this.limiter.attack.value = 0.002
      this.limiter.release.value = 0.12

      this.masterGain.connect(this.limiter)
      this.limiter.connect(created.destination)
      this.contextError = null
      this.emitStatus()
      return this.ctx
    } catch (err) {
      this.contextError = err instanceof Error ? err.message : String(err)
      this.emitStatus()
      return null
    }
  }

  async unlock(): Promise<void> {
    if (this.disposed) return
    const ctx = this.ensureContext()
    if (!ctx) return
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        // Browsers may reject resume outside a user gesture; next gesture retries
      }
    }
    void this.sampleBank.loadAll(ctx)
    this.emitStatus()
  }

  triggerNote(voiceId: number, midi: number, velocity: number): void {
    if (this.disposed) return
    const ctx = this.ensureContext()
    if (!ctx || !this.masterGain) return

    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined)
    }

    // If this voiceId somehow exists, clean it first
    if (this.voices.has(voiceId)) {
      this.releaseNote(voiceId, true)
    }

    const now = ctx.currentTime
    const clampedVel = Math.max(1, Math.min(127, Math.round(velocity)))
    const selected = selectSampleForNote(midi, clampedVel, (key) => this.sampleBank.hasDecoded(key))
    const buffer = this.sampleBank.getBuffer(selected.region.midi, selected.region.vel)

    if (buffer) {
      this.triggerSampledVoice(ctx, voiceId, midi, clampedVel, selected.playbackRate, selected.gain, buffer, now)
      if (this.usedFallbackForRecentNote) {
        this.usedFallbackForRecentNote = false
        this.emitStatus()
      }
    } else {
      this.triggerFallbackSynthVoice(ctx, voiceId, midi, clampedVel, now)
      if (!this.usedFallbackForRecentNote) {
        this.usedFallbackForRecentNote = true
        this.emitStatus()
      }
    }
  }

  private triggerSampledVoice(
    ctx: AudioContextLike,
    voiceId: number,
    midi: number,
    velocity: number,
    playbackRate: number,
    layerGain: number,
    buffer: AudioBufferLike,
    now: number,
  ): void {
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.setValueAtTime(playbackRate, now)

    const voiceGain = ctx.createGain()
    const targetGain = Math.max(0.015, Math.min(1.0, layerGain))
    // 2 ms anti-click onset ramp
    voiceGain.gain.setValueAtTime(0.0001, now)
    voiceGain.gain.linearRampToValueAtTime(targetGain, now + 0.002)

    const nodes: AudioNodeLike[] = [source, voiceGain]

    // Subtle tone darkening for very soft velocity when playing a louder fallback velocity layer
    if (velocity < 55 && layerGain < 0.45) {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(1400 + (velocity / 55) * 4500, now)
      filter.Q.setValueAtTime(0.6, now)
      source.connect(filter)
      filter.connect(voiceGain)
      nodes.push(filter)
    } else {
      source.connect(voiceGain)
    }

    voiceGain.connect(this.masterGain!)

    const handle: ActiveVoiceHandle = {
      voiceId,
      midi,
      gainNode: voiceGain,
      nodes,
      stopTargets: [source],
      isFallback: false,
      released: false,
      cleanupTimer: null,
    }
    this.voices.set(voiceId, handle)

    source.onended = () => {
      this.cleanupVoice(voiceId)
    }
    source.start(now)
  }

  private triggerFallbackSynthVoice(
    ctx: AudioContextLike,
    voiceId: number,
    midi: number,
    velocity: number,
    now: number,
  ): void {
    const freq = midiToFrequency(midi)
    const velNorm = Math.max(1, Math.min(127, velocity)) / 127
    const peakGain = 0.06 + 0.54 * Math.pow(velNorm, 1.55)

    // Register-proportional natural piano decay
    const decayTime = Math.max(1.2, 4.2 - ((midi - 28) / 72) * 2.6)

    const osc1 = ctx.createOscillator()
    osc1.type = 'triangle'
    osc1.frequency.setValueAtTime(freq, now)

    const osc2 = ctx.createOscillator()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(freq * 2, now)
    osc2.detune.setValueAtTime(1.5, now)

    const osc3 = ctx.createOscillator()
    osc3.type = 'sine'
    osc3.frequency.setValueAtTime(freq * 3, now)
    osc3.detune.setValueAtTime(-1.5, now)

    const g1 = ctx.createGain()
    g1.gain.setValueAtTime(0.68, now)
    const g2 = ctx.createGain()
    g2.gain.setValueAtTime(0.22 * (0.5 + 0.5 * velNorm), now)
    const g3 = ctx.createGain()
    g3.gain.setValueAtTime(0.1 * velNorm, now)

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    const startCutoff = Math.min(11000, freq * (3.0 + 7.0 * velNorm))
    const endCutoff = Math.min(4000, Math.max(320, freq * 1.8))
    filter.frequency.setValueAtTime(startCutoff, now)
    filter.frequency.exponentialRampToValueAtTime(endCutoff, now + Math.min(1.4, decayTime * 0.45))
    filter.Q.setValueAtTime(0.7, now)

    const voiceGain = ctx.createGain()
    voiceGain.gain.setValueAtTime(0.0001, now)
    voiceGain.gain.linearRampToValueAtTime(peakGain, now + 0.004)
    voiceGain.gain.exponentialRampToValueAtTime(0.0008, now + decayTime)

    osc1.connect(g1)
    osc2.connect(g2)
    osc3.connect(g3)
    g1.connect(filter)
    g2.connect(filter)
    g3.connect(filter)
    filter.connect(voiceGain)
    voiceGain.connect(this.masterGain!)

    const nodes: AudioNodeLike[] = [osc1, osc2, osc3, g1, g2, g3, filter, voiceGain]
    const handle: ActiveVoiceHandle = {
      voiceId,
      midi,
      gainNode: voiceGain,
      nodes,
      stopTargets: [osc1, osc2, osc3],
      isFallback: true,
      released: false,
      cleanupTimer: null,
    }
    this.voices.set(voiceId, handle)

    osc1.onended = () => {
      this.cleanupVoice(voiceId)
    }

    const autoStopAt = now + decayTime + 0.05
    osc1.start(now)
    osc2.start(now)
    osc3.start(now)
    osc1.stop(autoStopAt)
    osc2.stop(autoStopAt)
    osc3.stop(autoStopAt)
  }

  releaseNote(voiceId: number, fastSteal = false): void {
    const handle = this.voices.get(voiceId)
    if (!handle || !this.ctx) return
    if (handle.released && !fastSteal) return
    handle.released = true

    const now = this.ctx.currentTime
    // Acoustic pianos have no dampers above F#6 (MIDI 90) so treble notes release a bit gentler unless fast-stolen
    const releaseSec = fastSteal ? 0.018 : handle.midi >= 90 ? 0.48 : 0.24
    const timeConst = releaseSec / 4.5

    try {
      handle.gainNode.gain.cancelScheduledValues(now)
      const currentVal = Math.max(0.0001, handle.gainNode.gain.value || 0.2)
      handle.gainNode.gain.setValueAtTime(currentVal, now)
      handle.gainNode.gain.setTargetAtTime(0.0001, now, timeConst)
      handle.gainNode.gain.linearRampToValueAtTime(0, now + releaseSec)
    } catch {
      // Ignore Web Audio scheduling errors on closing contexts
    }

    const stopAt = now + releaseSec + 0.012
    for (const target of handle.stopTargets) {
      try {
        target.stop(stopAt)
      } catch {
        // Already stopped
      }
    }

    if (handle.cleanupTimer !== null) {
      this.clock.clearTimeout(handle.cleanupTimer)
    }
    handle.cleanupTimer = this.clock.setTimeout(
      () => {
        this.cleanupVoice(voiceId)
      },
      Math.ceil((releaseSec + 0.04) * 1000),
    )
  }

  private cleanupVoice(voiceId: number): void {
    const handle = this.voices.get(voiceId)
    if (!handle) return
    this.voices.delete(voiceId)
    if (handle.cleanupTimer !== null) {
      this.clock.clearTimeout(handle.cleanupTimer)
      handle.cleanupTimer = null
    }
    for (const target of handle.stopTargets) {
      target.onended = null
    }
    for (const node of handle.nodes) {
      try {
        node.disconnect()
      } catch {
        // Ignore already disconnected node
      }
    }
  }

  stopAllImmediate(): void {
    const ids = Array.from(this.voices.keys())
    for (const id of ids) {
      const handle = this.voices.get(id)
      if (!handle) continue
      if (this.ctx) {
        const now = this.ctx.currentTime
        try {
          handle.gainNode.gain.cancelScheduledValues(now)
          handle.gainNode.gain.setValueAtTime(Math.max(0.0001, handle.gainNode.gain.value || 0.05), now)
          handle.gainNode.gain.linearRampToValueAtTime(0, now + 0.01)
        } catch {
          // ignore
        }
        for (const target of handle.stopTargets) {
          try {
            target.stop(now + 0.012)
          } catch {
            // ignore
          }
        }
      }
      this.cleanupVoice(id)
    }
  }

  getActiveNodeCount(): number {
    let count = 0
    for (const handle of this.voices.values()) {
      count += handle.nodes.length
    }
    return count
  }

  getActiveVoiceCount(): number {
    return this.voices.size
  }

  getSampleBank(): PianoSampleBank {
    return this.sampleBank
  }

  getStatus(): PianoEngineStatusSnapshot {
    const bankSnap = this.sampleBank.getSnapshot()
    const ctxState = this.ctx ? this.ctx.state : 'unavailable'

    if (this.contextError) {
      return {
        status: 'error',
        loadedSamples: bankSnap.loadedCount,
        totalSamples: bankSnap.totalCount,
        usingFallback: false,
        message: this.contextError,
        audioContextState: ctxState,
      }
    }

    if (bankSnap.state === 'error' && bankSnap.loadedCount === 0) {
      return {
        status: 'fallback',
        loadedSamples: 0,
        totalSamples: bankSnap.totalCount,
        usingFallback: true,
        message: `Recorded samples unavailable (${bankSnap.errorMessage ?? 'load error'}); harmonic synthesis fallback active.`,
        audioContextState: ctxState,
      }
    }

    if (bankSnap.state === 'loading' || bankSnap.state === 'idle') {
      return {
        status: bankSnap.loadedCount > 0 ? 'loading' : this.usedFallbackForRecentNote ? 'fallback' : 'loading',
        loadedSamples: bankSnap.loadedCount,
        totalSamples: bankSnap.totalCount,
        usingFallback: this.usedFallbackForRecentNote || bankSnap.loadedCount === 0,
        message:
          bankSnap.loadedCount > 0
            ? `Loading Salamander Grand samples (${bankSnap.loadedCount}/${bankSnap.totalCount})…`
            : 'Loading Salamander Grand samples (synthesis fallback ready during load)…',
        audioContextState: ctxState,
      }
    }

    return {
      status: 'ready',
      loadedSamples: bankSnap.loadedCount,
      totalSamples: bankSnap.totalCount,
      usingFallback: false,
      message: `Salamander Grand V3 ready (${bankSnap.loadedCount}/${bankSnap.totalCount} samples)`,
      audioContextState: ctxState,
    }
  }

  subscribeStatus(listener: (status: PianoEngineStatusSnapshot) => void): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  private emitStatus(): void {
    const snap = this.getStatus()
    for (const listener of this.statusListeners) {
      listener(snap)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopAllImmediate()
    if (this.unsubBank) {
      this.unsubBank()
      this.unsubBank = null
    }
    this.sampleBank.dispose()
    try {
      this.masterGain?.disconnect()
      this.limiter?.disconnect()
    } catch {
      // ignore
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined)
      this.ctx = null
    }
    this.masterGain = null
    this.limiter = null
    this.statusListeners.clear()
  }
}

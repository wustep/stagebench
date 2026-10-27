import { MASTER_GAIN, renderPianoBody, releasePoints, releaseSecondsFor } from './pianoModel'
import type {
  AudioBufferLike,
  AudioContextFactory,
  AudioContextLike,
  AudioEngine,
  AudioStatusReport,
  BufferSourceLike,
  GainNodeLike,
  VoiceHandle,
} from './types'

/**
 * Web Audio backend.
 *
 * Graph (one master path, nothing bypasses it):
 *
 *   source -> voiceGain -> masterGain -> destination
 *
 * Each voice renders its body into an AudioBuffer from the shared model, so the signal
 * the tests measure and the signal the browser plays are produced by the same code.
 */

export interface WebAudioEngineOptions {
  createContext: AudioContextFactory
  /** Cap on simultaneously owned voices. Stealing is decided by the note session. */
  maxVoices?: number
  masterGain?: number
  /** Called whenever a voice's node ends, so the session can reclaim it. */
  onVoiceEnded?: (voiceId: string) => void
}

interface LiveVoice {
  handle: VoiceHandle
  source: BufferSourceLike
  gain: GainNodeLike
  buffer: AudioBufferLike
  ended: boolean
}

export function createWebAudioEngine(options: WebAudioEngineOptions): AudioEngine {
  const { createContext, onVoiceEnded } = options
  const maxVoices = options.maxVoices ?? 16
  const masterLevel = options.masterGain ?? MASTER_GAIN

  let context: AudioContextLike | null = null
  let master: GainNodeLike | null = null
  let report: AudioStatusReport = { status: 'idle', detail: 'Audio engine not started' }
  const listeners = new Set<(report: AudioStatusReport) => void>()
  const voices = new Map<string, LiveVoice>()
  let liveNodes = 0
  let disposed = false

  function publish(next: AudioStatusReport): void {
    report = next
    for (const listener of listeners) listener(next)
  }

  function buildContext(): AudioContextLike | null {
    if (context) return context
    publish({ status: 'loading', detail: 'Preparing audio engine' })
    try {
      const created = createContext()
      const masterGain = created.createGain()
      masterGain.gain.value = masterLevel
      masterGain.gain.setValueAtTime(masterLevel, created.currentTime)
      masterGain.connect(created.destination)
      context = created
      master = masterGain
      liveNodes = 1
      publish({ status: 'idle', detail: 'Audio engine prepared, waiting for a gesture' })
      return context
    } catch (error) {
      publish({
        status: 'error',
        detail: `Audio unavailable: ${describeError(error)}`,
      })
      context = null
      master = null
      liveNodes = 0
      return null
    }
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
    try {
      voice.source.onended = null
      voice.source.stop()
    } catch {
      /* stopping an already-stopped source is not an error we act on */
    }
    try {
      voice.source.disconnect()
      voice.gain.disconnect()
    } catch {
      /* already disconnected */
    }
    liveNodes = Math.max(0, liveNodes - 2)
    onVoiceEnded?.(voice.handle.id)
  }

  function stopAll(): void {
    for (const voice of Array.from(voices.values())) releaseVoice(voice)
  }

  return {
    kind: 'webaudio',

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
        // Honest fallback: the keybed still responds, but nothing is audible.
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
      if (voices.size >= maxVoices) {
        const oldest = voices.values().next().value as LiveVoice | undefined
        if (oldest) releaseVoice(oldest)
      }
      try {
        const seconds = 3
        const frames = Math.max(1, Math.round(seconds * ctx.sampleRate))
        const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
        const channel = buffer.getChannelData(0)
        channel.set(
          renderPianoBody({
            midi: voice.midi,
            velocity: voice.velocity,
            sampleRate: ctx.sampleRate,
            seconds,
            seed: hashId(voice.id),
          }),
        )
        const gain = ctx.createGain()
        gain.gain.value = 1
        gain.connect(master)
        const source = ctx.createBufferSource()
        source.buffer = buffer
        source.loop = false
        source.connect(gain)
        const live: LiveVoice = { handle: voice, source, gain, buffer, ended: false }
        voices.set(voice.id, live)
        liveNodes += 2
        source.onended = () => {
          if (!live.ended) releaseVoice(live)
        }
        source.start()
      } catch (error) {
        publish({ status: 'error', detail: `Audio error: ${describeError(error)}` })
        stopAll()
      }
    },

    noteOff(voiceId: string) {
      const voice = voices.get(voiceId)
      if (!voice || !context) return
      const now = context.currentTime
      const release = releaseSecondsFor(voice.handle.midi)
      try {
        voice.gain.gain.cancelScheduledValues(now)
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, now)
        const curve = releasePoints(release, context.sampleRate)
        voice.gain.gain.setValueCurveAtTime(curve, now, release)
      } catch {
        /* a backend that cannot schedule the curve still stops below */
      }
      try {
        voice.source.stop(now + release + 0.02)
      } catch {
        /* already stopped */
      }
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

    dispose() {
      if (disposed) return
      stopAll()
      disposed = true
      const ctx = context
      context = null
      const m = master
      master = null
      try {
        m?.disconnect()
      } catch {
        /* already disconnected */
      }
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

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'unknown error'
}

function hashId(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

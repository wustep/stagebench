// Owns the audio context and master path for the piano voice, and reports truthful status.
//
// The context is created on the first user gesture (browsers gate audio on gestures).
// Status moves idle -> loading -> ready, or to fallback when Web Audio cannot be created,
// or to error when the context refuses to resume. In fallback the instrument still tracks
// notes so the UI and the note lifecycle stay exercisable, and the status line says it is silent.

import type { AudioContextFactory, AudioContextLike, GainNodeLike } from '../audio/audioBoundary'
import { startPianoVoice, type VoiceHandle, type VoiceSink } from '../audio/pianoVoice'

export type EngineState = 'idle' | 'loading' | 'ready' | 'error' | 'fallback'

export interface EngineStatus {
  state: EngineState
  message: string
}

export const MASTER_LEVEL = 0.3

export const STATUS_MESSAGES = {
  idle: 'Audio idle. Press a key to start the piano voice.',
  loading: 'Loading piano voice (live synthesis)…',
  ready: 'Piano voice ready (live synthesis, no samples).',
  fallbackPrefix: 'Silent fallback: ',
  errorPrefix: 'Audio error: ',
} as const

export class PianoEngine implements VoiceSink {
  private readonly factory: AudioContextFactory
  private readonly onStatus: (status: EngineStatus) => void
  private context: AudioContextLike | undefined
  private master: GainNodeLike | undefined
  private status: EngineStatus = { state: 'idle', message: STATUS_MESSAGES.idle }

  constructor(factory: AudioContextFactory, onStatus: (status: EngineStatus) => void = () => {}) {
    this.factory = factory
    this.onStatus = onStatus
  }

  get currentStatus(): EngineStatus {
    return this.status
  }

  /** Creates the context and resumes it. Safe to call on every gesture; only the first call does work. */
  ensureStarted(): void {
    if (this.status.state !== 'idle') return
    this.setStatus({ state: 'loading', message: STATUS_MESSAGES.loading })

    let context: AudioContextLike
    try {
      context = this.factory()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.setStatus({ state: 'fallback', message: `${STATUS_MESSAGES.fallbackPrefix}${reason}. Keys are tracked but nothing sounds.` })
      return
    }

    this.context = context
    this.master = context.createGain()
    this.master.gain.setValueAtTime(MASTER_LEVEL, context.currentTime)
    this.master.connect(context.destination)

    context
      .resume()
      .then(() => {
        if (this.context !== context) return
        this.setStatus({ state: 'ready', message: STATUS_MESSAGES.ready })
      })
      .catch((error: unknown) => {
        if (this.context !== context) return
        const reason = error instanceof Error ? error.message : String(error)
        this.setStatus({ state: 'error', message: `${STATUS_MESSAGES.errorPrefix}${reason}` })
      })
  }

  start(note: number, velocity: number, onEnded: () => void): VoiceHandle {
    if (this.context && this.master) {
      return startPianoVoice(this.context, this.master, note, velocity, onEnded)
    }
    return silentHandle(onEnded)
  }

  /**
   * Closes the context and returns to idle, so a later gesture can start audio again.
   * Owned voices must be stopped by the caller first.
   */
  dispose(): void {
    const context = this.context
    this.context = undefined
    this.master = undefined
    if (context) {
      void context.close().catch(() => {})
    }
    this.setStatus({ state: 'idle', message: STATUS_MESSAGES.idle })
  }

  private setStatus(status: EngineStatus): void {
    this.status = status
    this.onStatus(status)
  }
}

/** A voice with no sound. It reports its end when released or stopped so note bookkeeping stays exact. */
function silentHandle(onEnded: () => void): VoiceHandle {
  let ended = false
  const end = () => {
    if (ended) return
    ended = true
    onEnded()
  }
  return { release: end, stop: end }
}

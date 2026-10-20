// Owns the one AudioContext and the signal graph built on it, and reports truthful audio status.
//
// The context is created on the first user gesture (browsers gate audio on gestures). Status moves
// idle -> loading -> ready, or to fallback when Web Audio cannot be created, or to error when the
// context refuses to resume. In fallback the instrument still tracks notes so the UI and the note
// lifecycle stay exercisable, and the status line says it is silent.

import type { AudioContextFactory, AudioContextLike } from '../audio/audioBoundary'
import { SignalGraph } from '../audio/signalGraph'

export type EngineState = 'idle' | 'loading' | 'ready' | 'error' | 'fallback'

export interface EngineStatus {
  state: EngineState
  message: string
}

/** Master gain at the default Master Level knob position (see signalGraph.ts). */
export const MASTER_LEVEL = 0.3

export const STATUS_MESSAGES = {
  idle: 'Audio idle. Press a key to start the piano.',
  loading: 'Starting audio…',
  ready: 'Audio ready: one AudioContext for both piano layers and the effects.',
  fallbackPrefix: 'Silent fallback: ',
  errorPrefix: 'Audio error: ',
} as const

export interface AudioHandles {
  context: AudioContextLike
  graph: SignalGraph
}

export class PianoEngine {
  private readonly factory: AudioContextFactory
  private readonly onStatus: (status: EngineStatus) => void
  private handles: AudioHandles | undefined
  private status: EngineStatus = { state: 'idle', message: STATUS_MESSAGES.idle }

  constructor(factory: AudioContextFactory, onStatus: (status: EngineStatus) => void = () => {}) {
    this.factory = factory
    this.onStatus = onStatus
  }

  get currentStatus(): EngineStatus {
    return this.status
  }

  /** The context and graph once started, or undefined while idle, failed, or after dispose. */
  get audio(): AudioHandles | undefined {
    return this.handles
  }

  /**
   * Creates the context, the graph, and resumes the context. Safe to call on every gesture; only
   * the first call does work. Returns true when this call created the graph.
   */
  ensureStarted(): boolean {
    if (this.status.state !== 'idle') return false
    this.setStatus({ state: 'loading', message: STATUS_MESSAGES.loading })

    let context: AudioContextLike
    try {
      context = this.factory()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.setStatus({ state: 'fallback', message: `${STATUS_MESSAGES.fallbackPrefix}${reason}. Keys are tracked but nothing sounds.` })
      return false
    }

    const graph = new SignalGraph(context)
    this.handles = { context, graph }

    context
      .resume()
      .then(() => {
        if (this.handles?.context !== context) return
        this.setStatus({ state: 'ready', message: STATUS_MESSAGES.ready })
      })
      .catch((error: unknown) => {
        if (this.handles?.context !== context) return
        const reason = error instanceof Error ? error.message : String(error)
        this.setStatus({ state: 'error', message: `${STATUS_MESSAGES.errorPrefix}${reason}` })
      })
    return true
  }

  /**
   * Closes the context and returns to idle, so a later gesture can start audio again.
   * Owned voices must be stopped by the caller first.
   */
  dispose(): void {
    const handles = this.handles
    this.handles = undefined
    if (handles) {
      handles.graph.dispose()
      void handles.context.close().catch(() => {})
    }
    this.setStatus({ state: 'idle', message: STATUS_MESSAGES.idle })
  }

  private setStatus(status: EngineStatus): void {
    this.status = status
    this.onStatus(status)
  }
}

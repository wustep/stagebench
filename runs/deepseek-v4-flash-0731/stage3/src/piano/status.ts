/**
 * Truthful engine status: loading / ready / error / fallback. Phase 1 has no
 * recorded sample sets to load, so the synthesis engine is ready immediately,
 * but the fallback path is a first-class, labeled concept and asset failures
 * can be forced for testing.
 */

export type EngineStatus = 'loading' | 'ready' | 'error' | 'fallback'

export interface StatusSnapshot {
  status: EngineStatus
  /** human-readable message shown near the on-screen sustain/status LED. */
  message: string
  /** true when a labeled fallback voice is active. */
  usingFallback: boolean
}

const READY: StatusSnapshot = { status: 'ready', message: 'Basic piano ready (synthesized voice)', usingFallback: false }

export class StatusModel {
  private state: StatusSnapshot = READY
  private listeners = new Set<() => void>()

  get snapshot(): StatusSnapshot {
    return this.state
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  setLoading(message = 'Loading piano voice…'): void {
    this.state = { status: 'loading', message, usingFallback: false }
    this.emit()
  }

  setReady(message = READY.message): void {
    this.state = { status: 'ready', message, usingFallback: false }
    this.emit()
  }

  setError(message: string): void {
    this.state = { status: 'error', message, usingFallback: false }
    this.emit()
  }

  setFallback(message: string): void {
    this.state = { status: 'fallback', message, usingFallback: true }
    this.emit()
  }
}
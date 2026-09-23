import { createContext, useContext } from 'react'
import type { AudioContextLike } from './audio/webAudioTypes'
import type { ToneOptions } from './audio/pianoTone'
import type { MidiAccessLike } from './input/midi'
import type { StorageLike } from './model/programs'

/** Minimal event target used for keyboard / blur listeners (window in the browser). */
export interface ListenerTarget {
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
}

export interface VisibilitySource extends ListenerTarget {
  readonly visibilityState: string
}

/**
 * Every browser boundary the app touches, so tests run without audio output, MIDI devices,
 * network or real timers.
 */
export interface Runtime {
  createAudioContext: (() => AudioContextLike) | null
  requestMIDIAccess: (() => Promise<MidiAccessLike>) | null
  keyboardTarget: ListenerTarget
  visibility: VisibilitySource
  yieldToEventLoop: () => Promise<void>
  toneOptions?: ToneOptions
  /** Fetch a bundled asset (relative to the app base) as bytes; null = no network/asset access. */
  fetchAsset: ((path: string) => Promise<ArrayBuffer>) | null
  /** Monotonic milliseconds (tap tempo). */
  now: () => number
  /** Program/Live slot persistence (localStorage in the browser); null = memory only. */
  storage?: StorageLike | null
  /** Repeating timer (arpeggiator clock); returns a cancel function. */
  every?: (ms: number, fn: () => void) => () => void
  /** Diagnostics hook: receives the live engine objects on mount (tests inspect canonical state). */
  inspect?: (handles: InspectHandles | null) => void
  /** Test-only audio sizing: shorter reverb IRs and decoded sample zones. */
  audioTuning?: { irScale?: number; maxZoneSeconds?: number }
}

export interface InspectHandles {
  controller: import('./system/controller').StageController
  stage: import('./audio/stageAudio').StageAudio
  engine: import('./audio/layeredEngine').LayeredEngine
}

export function browserRuntime(): Runtime {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<unknown> }
  return {
    createAudioContext: Ctor ? () => new Ctor({ latencyHint: 'interactive' }) as unknown as AudioContextLike : null,
    requestMIDIAccess: typeof nav.requestMIDIAccess === 'function' ? () => nav.requestMIDIAccess!() as Promise<MidiAccessLike> : null,
    keyboardTarget: window,
    visibility: document,
    yieldToEventLoop: () => new Promise((resolve) => setTimeout(resolve, 0)),
    fetchAsset: async (path: string) => {
      const response = await fetch(new URL(path, document.baseURI))
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`)
      return response.arrayBuffer()
    },
    now: () => performance.now(),
    storage: browserStorage(),
    every: (ms, fn) => {
      const handle = setInterval(fn, ms)
      return () => clearInterval(handle)
    },
  }
}

/** localStorage when the browser allows it (private modes may throw). */
function browserStorage(): StorageLike | null {
  try {
    const ls = window.localStorage
    const probe = '__stagebench_probe__'
    ls.setItem(probe, '1')
    ls.removeItem(probe)
    return { getItem: (k) => ls.getItem(k), setItem: (k, v) => ls.setItem(k, v) }
  } catch {
    return null
  }
}

export const RuntimeContext = createContext<Runtime | null>(null)

export function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('RuntimeContext missing')
  return runtime
}

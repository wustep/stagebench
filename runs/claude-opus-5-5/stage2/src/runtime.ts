import { createContext, useContext } from 'react'
import type { AudioContextLike } from './audio/webAudioTypes'
import type { ToneOptions } from './audio/pianoTone'
import type { MidiAccessLike } from './input/midi'

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
  /** Test-only audio sizing: shorter reverb IRs and decoded sample zones. */
  audioTuning?: { irScale?: number; maxZoneSeconds?: number }
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
  }
}

export const RuntimeContext = createContext<Runtime | null>(null)

export function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('RuntimeContext missing')
  return runtime
}

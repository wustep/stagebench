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
  }
}

export const RuntimeContext = createContext<Runtime | null>(null)

export function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('RuntimeContext missing')
  return runtime
}

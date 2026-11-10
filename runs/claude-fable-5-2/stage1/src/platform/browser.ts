import workletUrl from '../audio/piano.worklet.ts?worker&url'
import type { AudioContextLike, KeyEventLike, MidiAccessLike, Platform, Unsubscribe, WorkletNodeLike } from './types'

/** The one place the app touches real browser globals. */

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext

function listen<K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void): Unsubscribe {
  window.addEventListener(type, handler)
  return () => window.removeEventListener(type, handler)
}

export function createBrowserPlatform(): Platform {
  return {
    audio: {
      workletUrl,
      createContext() {
        const scope = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor }
        const Ctor = scope.AudioContext ?? scope.webkitAudioContext
        if (!Ctor) return null
        return new Ctor({ latencyHint: 'interactive' }) as unknown as AudioContextLike
      },
      createWorkletNode(context, processorName) {
        return new AudioWorkletNode(context as unknown as AudioContext, processorName, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        }) as unknown as WorkletNodeLike
      },
    },
    midi: {
      requestAccess:
        typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'
          ? () => navigator.requestMIDIAccess({ sysex: false }) as unknown as Promise<MidiAccessLike>
          : null,
    },
    events: {
      onKeyDown: (handler) => listen('keydown', handler as (event: KeyboardEvent) => void),
      onKeyUp: (handler) => listen('keyup', handler as (event: KeyboardEvent) => void),
      onBlur: (handler) => listen('blur', handler),
      onHidden(handler) {
        const listener = () => {
          if (document.visibilityState === 'hidden') handler()
        }
        document.addEventListener('visibilitychange', listener)
        return () => document.removeEventListener('visibilitychange', listener)
      },
      onResize: (handler) => listen('resize', handler),
      // innerWidth, not clientWidth: a scrollbar appearing or disappearing must not change the fit.
      viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    },
    timing: {
      now: () => performance.now(),
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    },
    storage: {
      getItem(key) {
        try {
          return window.localStorage.getItem(key)
        } catch {
          return null
        }
      },
      setItem(key, value) {
        try {
          window.localStorage.setItem(key, value)
        } catch {
          // Private mode or blocked storage: preferences simply do not persist.
        }
      },
    },
  }
}

export type { KeyEventLike }

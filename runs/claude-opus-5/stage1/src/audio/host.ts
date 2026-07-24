import type { GraphContext, Scheduler } from './graph'

/**
 * Truthful audio status. There is no sample download in Phase 1 — the voice is generated — so
 * there is no "loading assets" state to report and none is invented. The states are exactly the
 * ones that can really happen.
 */
export type AudioStatus =
  | 'unsupported' // no Web Audio in this browser: silent fallback, keys still respond
  | 'idle' // context not started yet; browsers require a user gesture
  | 'starting' // resume() in flight
  | 'ready' // context running, voice available
  | 'error' // context creation or resume failed; silent fallback

export interface AudioStatusReport {
  readonly status: AudioStatus
  readonly message: string
  /** True when notes are audible. False means the surface still works but makes no sound. */
  readonly audible: boolean
}

export const STATUS_MESSAGES: Record<AudioStatus, string> = {
  unsupported: 'Web Audio is not available in this browser — the keybed responds but stays silent.',
  idle: 'Audio is suspended. Play a key or press Start audio to enable sound.',
  starting: 'Starting the audio engine…',
  ready: 'Audio ready — generated piano voice.',
  error: 'The audio engine could not start — the keybed responds but stays silent.',
}

export function describeStatus(status: AudioStatus, detail?: string): AudioStatusReport {
  return {
    status,
    message: detail ? `${STATUS_MESSAGES[status]} (${detail})` : STATUS_MESSAGES[status],
    audible: status === 'ready',
  }
}

export interface AudioContextFactory {
  (): GraphContext | null
}

interface WindowWithAudio {
  AudioContext?: new () => unknown
  webkitAudioContext?: new () => unknown
}

/**
 * Default browser boundary. Returns null when Web Audio is missing so the caller can report
 * the honest `unsupported` state instead of throwing.
 */
export const createBrowserAudioContext: AudioContextFactory = () => {
  if (typeof window === 'undefined') return null
  const scope = window as unknown as WindowWithAudio
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext
  if (!Ctor) return null
  return new Ctor() as unknown as GraphContext
}

export interface AudioBoundary {
  readonly createContext: AudioContextFactory
  readonly scheduler?: Scheduler
}

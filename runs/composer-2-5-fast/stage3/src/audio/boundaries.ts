export interface TimingBoundary {
  now(): number
  setTimeout(fn: () => void, ms: number): ReturnType<typeof globalThis.setTimeout>
  clearTimeout(id: ReturnType<typeof globalThis.setTimeout>): void
}

export const defaultTiming: TimingBoundary = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
}

export interface AudioContextFactory {
  create(sampleRate?: number): AudioContext | OfflineAudioContext
}

export const defaultAudioContextFactory: AudioContextFactory = {
  create: (sampleRate) => {
    const Ctx = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    return sampleRate ? new Ctx({ sampleRate }) : new Ctx()
  },
}

export type PianoStatus = 'loading' | 'ready' | 'error' | 'fallback'

export interface AudioEngineSnapshot {
  activeVoiceCount: number
  sustainHeld: boolean
  status: PianoStatus
}

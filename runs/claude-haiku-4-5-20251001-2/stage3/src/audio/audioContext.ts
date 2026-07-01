/**
 * Injectable AudioContext wrapper for Phase 2 Piano engine
 * Provides a stable, testable interface to the Web Audio API
 */

export interface IAudioContextProvider {
  getContext(): AudioContext | OfflineAudioContext
  isOffline(): boolean
  isRunning(): boolean
}

export class AudioContextProvider implements IAudioContextProvider {
  private context: AudioContext | OfflineAudioContext | null = null
  private isOfflineMode: boolean

  constructor(context?: AudioContext | OfflineAudioContext) {
    if (context) {
      this.context = context
      this.isOfflineMode = context instanceof OfflineAudioContext
    } else {
      this.context = null
      this.isOfflineMode = false
    }
  }

  static create(): AudioContextProvider {
    if (typeof window !== 'undefined' && window.AudioContext) {
      return new AudioContextProvider(new window.AudioContext())
    }
    // Fallback: context will be created lazily
    return new AudioContextProvider()
  }

  static createOffline(length: number, sampleRate: number = 44100): AudioContextProvider {
    const offline = new OfflineAudioContext(2, length, sampleRate)
    return new AudioContextProvider(offline)
  }

  getContext(): AudioContext | OfflineAudioContext {
    if (!this.context) {
      if (typeof window !== 'undefined' && window.AudioContext) {
        this.context = new window.AudioContext()
        this.isOfflineMode = false
      } else {
        throw new Error('AudioContext not available in this environment')
      }
    }
    return this.context
  }

  isOffline(): boolean {
    return this.isOfflineMode
  }

  isRunning(): boolean {
    if (!this.context) return false
    return this.context.state === 'running'
  }

  resume(): Promise<void> {
    const ctx = this.getContext()
    if ('resume' in ctx && ctx.state === 'suspended') {
      return ctx.resume()
    }
    return Promise.resolve()
  }
}

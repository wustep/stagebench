import type { PianoStatus, VoiceBackend, VoiceHandle } from './piano'

export interface VoiceEvent {
  type: 'start' | 'release' | 'stop'
  note?: number
  velocity?: number
  voiceId?: number
}

export class FakeVoiceBackend implements VoiceBackend {
  events: VoiceEvent[] = []
  stopAllCalls = 0
  disposed = false
  status: PianoStatus = { state: 'ready', label: 'Test piano ready' }

  startVoice(note: number, velocity: number, voiceId: number): VoiceHandle {
    this.events.push({ type: 'start', note, velocity, voiceId })
    let ended = false
    return {
      release: () => {
        if (!ended) this.events.push({ type: 'release', note, voiceId })
        ended = true
      },
      stop: () => {
        if (!ended) this.events.push({ type: 'stop', note, voiceId })
        ended = true
      },
    }
  }

  stopAll(): void { this.stopAllCalls += 1 }
  dispose(): void { this.disposed = true }
  getStatus(): PianoStatus { return this.status }
}

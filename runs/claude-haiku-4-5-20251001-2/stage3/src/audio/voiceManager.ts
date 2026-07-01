/**
 * Voice manager for polyphonic Piano engine
 * Implements deterministic voice allocation, stealing, and lifecycle management
 */

export interface Voice {
  noteNumber: number
  startTime: number
  velocity: number
  active: boolean
  handlerId: string | null
}

export interface VoiceManagerConfig {
  maxVoices: number
}

export type VoiceStealingStrategy = 'fifo' | 'lru' | 'velocity-weighted'

export class VoiceManager {
  private voices: Map<string, Voice> = new Map()
  private voiceIdCounter = 0
  private maxVoices: number
  private stealingStrategy: VoiceStealingStrategy

  constructor(config: VoiceManagerConfig, stealingStrategy: VoiceStealingStrategy = 'lru') {
    this.maxVoices = config.maxVoices
    this.stealingStrategy = stealingStrategy
  }

  /**
   * Allocate a voice for a note-on event
   * Steals an existing voice if necessary
   */
  allocateVoice(noteNumber: number, velocity: number, currentTime: number, handlerId: string): string {
    const voiceId = this.generateVoiceId()

    // If under capacity, just add the voice
    if (this.voices.size < this.maxVoices) {
      const voice: Voice = {
        noteNumber,
        velocity,
        startTime: currentTime,
        active: true,
        handlerId,
      }
      this.voices.set(voiceId, voice)
      return voiceId
    }

    // Need to steal a voice
    const victimId = this.selectVoiceToSteal()
    this.voices.delete(victimId)

    const voice: Voice = {
      noteNumber,
      velocity,
      startTime: currentTime,
      active: true,
      handlerId,
    }
    this.voices.set(voiceId, voice)
    return voiceId
  }

  /**
   * Release a voice (note-off)
   */
  releaseVoice(voiceId: string): boolean {
    const voice = this.voices.get(voiceId)
    if (voice) {
      voice.active = false
      return true
    }
    return false
  }

  /**
   * Get a voice by ID
   */
  getVoice(voiceId: string): Voice | undefined {
    return this.voices.get(voiceId)
  }

  /**
   * Check if all voices are inactive (for testing)
   */
  allInactive(): boolean {
    return Array.from(this.voices.values()).every(v => !v.active)
  }

  /**
   * Reset all voices (for all-notes-off)
   */
  reset(): void {
    this.voices.clear()
  }

  /**
   * Get all active voices
   */
  getActiveVoices(): Array<[string, Voice]> {
    return Array.from(this.voices.entries()).filter(([, voice]) => voice.active)
  }

  /**
   * Get voice count
   */
  getVoiceCount(): number {
    return this.voices.size
  }

  private selectVoiceToSteal(): string {
    const voiceEntries = Array.from(this.voices.entries())

    if (voiceEntries.length === 0) {
      throw new Error('No voices to steal')
    }

    switch (this.stealingStrategy) {
      case 'fifo': {
        // Steal the oldest voice
        let oldest = voiceEntries[0]
        for (const entry of voiceEntries) {
          if (entry[1].startTime < oldest[1].startTime) {
            oldest = entry
          }
        }
        return oldest[0]
      }

      case 'velocity-weighted': {
        // Steal the voice with lowest velocity
        let lowest = voiceEntries[0]
        for (const entry of voiceEntries) {
          if (entry[1].velocity < lowest[1].velocity) {
            lowest = entry
          }
        }
        return lowest[0]
      }

      case 'lru':
      default: {
        // LRU is same as FIFO for our purposes (no explicit access tracking)
        let oldest = voiceEntries[0]
        for (const entry of voiceEntries) {
          if (entry[1].startTime < oldest[1].startTime) {
            oldest = entry
          }
        }
        return oldest[0]
      }
    }
  }

  private generateVoiceId(): string {
    return `voice-${++this.voiceIdCounter}`
  }
}

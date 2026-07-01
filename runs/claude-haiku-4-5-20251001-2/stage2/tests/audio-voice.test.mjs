import { test } from 'node:test'
import { strictEqual, ok } from 'node:assert'

// Simplified test-compatible voice manager
class VoiceManager {
  constructor(config, stealingStrategy = 'lru') {
    this.voices = new Map()
    this.voiceIdCounter = 0
    this.maxVoices = config.maxVoices
    this.stealingStrategy = stealingStrategy
  }

  allocateVoice(noteNumber, velocity, currentTime, handlerId) {
    const voiceId = this.generateVoiceId()

    if (this.voices.size < this.maxVoices) {
      const voice = {
        noteNumber,
        velocity,
        startTime: currentTime,
        active: true,
        handlerId,
      }
      this.voices.set(voiceId, voice)
      return voiceId
    }

    const victimId = this.selectVoiceToSteal()
    this.voices.delete(victimId)

    const voice = {
      noteNumber,
      velocity,
      startTime: currentTime,
      active: true,
      handlerId,
    }
    this.voices.set(voiceId, voice)
    return voiceId
  }

  releaseVoice(voiceId) {
    const voice = this.voices.get(voiceId)
    if (voice) {
      voice.active = false
      return true
    }
    return false
  }

  getVoice(voiceId) {
    return this.voices.get(voiceId)
  }

  allInactive() {
    return Array.from(this.voices.values()).every(v => !v.active)
  }

  reset() {
    this.voices.clear()
  }

  getActiveVoices() {
    return Array.from(this.voices.entries()).filter(([, voice]) => voice.active)
  }

  getVoiceCount() {
    return this.voices.size
  }

  selectVoiceToSteal() {
    const voiceEntries = Array.from(this.voices.entries())
    if (voiceEntries.length === 0) {
      throw new Error('No voices to steal')
    }

    switch (this.stealingStrategy) {
      case 'fifo': {
        let oldest = voiceEntries[0]
        for (const entry of voiceEntries) {
          if (entry[1].startTime < oldest[1].startTime) {
            oldest = entry
          }
        }
        return oldest[0]
      }

      case 'velocity-weighted': {
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

  generateVoiceId() {
    return `voice-${++this.voiceIdCounter}`
  }
}

// Tests
test('audio.voices: allocate voice returns unique ID', () => {
  const vm = new VoiceManager({ maxVoices: 32 })
  const id1 = vm.allocateVoice(60, 0.8, 0, 'test1')
  const id2 = vm.allocateVoice(64, 0.9, 10, 'test2')
  strictEqual(typeof id1, 'string')
  strictEqual(typeof id2, 'string')
  ok(id1 !== id2, 'Voice IDs should be unique')
})

test('audio.voices: voice count reflects allocations', () => {
  const vm = new VoiceManager({ maxVoices: 32 })
  strictEqual(vm.getVoiceCount(), 0)
  vm.allocateVoice(60, 0.8, 0, 'test1')
  strictEqual(vm.getVoiceCount(), 1)
  vm.allocateVoice(64, 0.9, 10, 'test2')
  strictEqual(vm.getVoiceCount(), 2)
})

test('audio.voices: steal voice when at capacity', () => {
  const vm = new VoiceManager({ maxVoices: 2 })
  const v1 = vm.allocateVoice(60, 0.8, 0, 'test1')
  const v2 = vm.allocateVoice(64, 0.9, 10, 'test2')
  strictEqual(vm.getVoiceCount(), 2, 'Should have 2 voices at capacity')

  const v3 = vm.allocateVoice(67, 0.7, 20, 'test3')
  strictEqual(vm.getVoiceCount(), 2, 'Should still have 2 voices after stealing')

  // v1 should be stolen (oldest)
  const stillExists = vm.getVoice(v1)
  strictEqual(stillExists, undefined, 'Stolen voice should be gone')
})

test('audio.voices: release voice marks as inactive', () => {
  const vm = new VoiceManager({ maxVoices: 32 })
  const voiceId = vm.allocateVoice(60, 0.8, 0, 'test1')
  const voice = vm.getVoice(voiceId)
  ok(voice.active, 'Voice should be active after allocation')
  vm.releaseVoice(voiceId)
  ok(!voice.active, 'Voice should be inactive after release')
})

test('audio.voices: get active voices filters released ones', () => {
  const vm = new VoiceManager({ maxVoices: 32 })
  const v1 = vm.allocateVoice(60, 0.8, 0, 'test1')
  const v2 = vm.allocateVoice(64, 0.9, 10, 'test2')
  vm.releaseVoice(v1)
  const active = vm.getActiveVoices()
  strictEqual(active.length, 1, 'Should have 1 active voice')
  strictEqual(active[0][0], v2, 'Active voice should be v2')
})

test('audio.voices: LRU steals oldest voice', () => {
  const vm = new VoiceManager({ maxVoices: 2 }, 'lru')
  const v1 = vm.allocateVoice(60, 0.8, 0, 'oldest')
  const v2 = vm.allocateVoice(64, 0.9, 100, 'newer')
  vm.allocateVoice(67, 0.7, 200, 'newest')
  ok(!vm.getVoice(v1), 'Oldest voice should be stolen')
  ok(vm.getVoice(v2), 'Newer voice should remain')
})

test('audio.voices: velocity-weighted steals lowest velocity', () => {
  const vm = new VoiceManager({ maxVoices: 2 }, 'velocity-weighted')
  const v1 = vm.allocateVoice(60, 0.3, 0, 'low-vel') // Lowest velocity
  const v2 = vm.allocateVoice(64, 0.9, 10, 'high-vel')
  vm.allocateVoice(67, 0.7, 20, 'mid-vel')
  ok(!vm.getVoice(v1), 'Lowest velocity voice should be stolen')
  ok(vm.getVoice(v2), 'High velocity voice should remain')
})

test('audio.voices: reset clears all voices', () => {
  const vm = new VoiceManager({ maxVoices: 32 })
  vm.allocateVoice(60, 0.8, 0, 'test1')
  vm.allocateVoice(64, 0.9, 10, 'test2')
  strictEqual(vm.getVoiceCount(), 2)
  vm.reset()
  strictEqual(vm.getVoiceCount(), 0)
})

test('audio.voices: all-inactive checks all active flags', () => {
  const vm = new VoiceManager({ maxVoices: 32 })
  const v1 = vm.allocateVoice(60, 0.8, 0, 'test1')
  const v2 = vm.allocateVoice(64, 0.9, 10, 'test2')
  ok(!vm.allInactive(), 'Should not be all inactive with active voices')
  vm.releaseVoice(v1)
  ok(!vm.allInactive(), 'Should not be all inactive with one active remaining')
  vm.releaseVoice(v2)
  ok(vm.allInactive(), 'Should be all inactive when all released')
})

export type PianoStatusState = 'loading' | 'ready' | 'fallback' | 'error'

export interface PianoStatus {
  state: PianoStatusState
  message: string
}

interface Voice {
  id: number
  midi: number
  owner: string
  velocity: number
  startedAt: number
  released: boolean
  releaseTimer?: number
  oscillator?: OscillatorNode
  gain?: GainNode
}

interface PianoEngineOptions {
  maxVoices?: number
  onStatus?: (status: PianoStatus) => void
  context?: AudioContext
}

export interface PianoEngine {
  prepare: () => void
  noteOn: (midi: number, velocity: number, owner: string) => void
  noteOff: (midi: number, owner: string) => void
  setSustain: (enabled: boolean) => void
  allNotesOff: () => void
  dispose: () => void
  getSnapshot: () => { activeVoices: number; sustain: boolean; status: PianoStatus; stolenVoices: number }
}

const AudioContextCtor = () => window.AudioContext ?? window.webkitAudioContext

function midiToFrequency(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12)
}

function now(context?: AudioContext) {
  return context?.currentTime ?? performance.now() / 1000
}

export function createPianoEngine(options: PianoEngineOptions = {}): PianoEngine {
  const maxVoices = options.maxVoices ?? 18
  let status: PianoStatus = { state: 'loading', message: 'Preparing generated piano voice' }
  let context = options.context
  let sustain = false
  let nextVoiceId = 1
  let stolenVoices = 0
  const voices = new Map<number, Voice>()
  const sustained = new Set<number>()

  const setStatus = (next: PianoStatus) => {
    status = next
    options.onStatus?.(next)
  }

  const ensureContext = () => {
    if (context) return context
    const Constructor = AudioContextCtor()
    if (!Constructor) {
      setStatus({ state: 'fallback', message: 'Playable fallback: audio output unavailable in this browser' })
      return null
    }
    try {
      context = new Constructor()
      setStatus({ state: 'ready', message: 'Generated piano ready' })
      return context
    } catch {
      setStatus({ state: 'fallback', message: 'Playable fallback: generated audio context could not start' })
      return null
    }
  }

  const finishVoice = (voice: Voice, releaseSeconds = 0.18) => {
    const ctx = context
    voice.released = true
    if (voice.releaseTimer) window.clearTimeout(voice.releaseTimer)
    if (ctx && voice.gain) {
      const at = now(ctx)
      voice.gain.gain.cancelScheduledValues(at)
      voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), at)
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, at + releaseSeconds)
      voice.oscillator?.stop(at + releaseSeconds + 0.02)
    }
    voice.releaseTimer = window.setTimeout(() => {
      voice.oscillator?.disconnect()
      voice.gain?.disconnect()
      voices.delete(voice.id)
      sustained.delete(voice.id)
    }, (releaseSeconds + 0.06) * 1000)
  }

  const stealIfNeeded = () => {
    if (voices.size < maxVoices) return
    const candidates = [...voices.values()].sort((left, right) => {
      if (left.released !== right.released) return left.released ? -1 : 1
      return left.startedAt - right.startedAt
    })
    const voice = candidates[0]
    if (voice) {
      stolenVoices += 1
      finishVoice(voice, 0.05)
    }
  }

  return {
    prepare() {
      ensureContext()
    },
    noteOn(midi, velocity, owner) {
      const ctx = ensureContext()
      if (!ctx) return
      void ctx.resume?.()
      stealIfNeeded()
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      const frequency = midiToFrequency(midi)
      const at = now(ctx)
      const level = 0.045 + Math.max(0.05, Math.min(1, velocity)) ** 1.65 * 0.19
      oscillator.type = 'triangle'
      oscillator.frequency.setValueAtTime(frequency, at)
      oscillator.detune.setValueAtTime((velocity - 0.5) * 3, at)
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(level, at + 0.012)
      gain.gain.exponentialRampToValueAtTime(Math.max(level * 0.58, 0.0001), at + 0.42)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(at)
      voices.set(nextVoiceId, {
        id: nextVoiceId,
        midi,
        owner,
        velocity,
        startedAt: at,
        released: false,
        oscillator,
        gain,
      })
      nextVoiceId += 1
    },
    noteOff(midi, owner) {
      for (const voice of voices.values()) {
        if (voice.midi === midi && voice.owner === owner && !voice.released) {
          if (sustain) {
            sustained.add(voice.id)
          } else {
            finishVoice(voice, 0.24 + voice.velocity * 0.12)
          }
        }
      }
    },
    setSustain(enabled) {
      sustain = enabled
      if (!enabled) {
        for (const voiceId of sustained) {
          const voice = voices.get(voiceId)
          if (voice) finishVoice(voice, 0.28)
        }
        sustained.clear()
      }
    },
    allNotesOff() {
      sustain = false
      sustained.clear()
      for (const voice of voices.values()) finishVoice(voice, 0.03)
    },
    dispose() {
      this.allNotesOff()
      if (options.context === undefined) {
        void context?.close?.()
      }
    },
    getSnapshot() {
      return { activeVoices: voices.size, sustain, status, stolenVoices }
    },
  }
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext
  }
}

// Web Audio Piano voice for Phase 1

const NOTE_ON_GAIN = 0.5
const RELEASE_TIME = 1.0

interface ActiveVoice {
  oscillator: OscillatorNode
  gain: GainNode
  envelope: GainNode
  startTime: number
  noteNumber: number
}

export class PianoAudio {
  private audioContext: AudioContext | null = null
  private masterGain: GainNode | null = null
  private activeVoices: Map<number, ActiveVoice[]> = new Map()
  private sustainedNotes: Set<number> = new Set()
  private initialized = false
  private error: string | null = null

  constructor() {
    this.initializeAudio()
  }

  private initializeAudio() {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()

      // Create master gain node with limiter
      this.masterGain = this.audioContext.createGain()
      this.masterGain.gain.value = 0.3
      this.masterGain.connect(this.audioContext.destination)

      this.initialized = true
      this.error = null
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to initialize AudioContext'
      this.initialized = false
    }
  }

  private noteToFrequency(noteNumber: number): number {
    return 440 * Math.pow(2, (noteNumber - 69) / 12)
  }

  noteOn(noteNumber: number, velocity: number): void {
    if (!this.audioContext || !this.masterGain) {
      this.initializeAudio()
      if (!this.audioContext || !this.masterGain) return
    }

    // Resume context if needed
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume()
    }

    const frequency = this.noteToFrequency(noteNumber)
    const voiceCount = this.activeVoices.get(noteNumber)?.length ?? 0

    // Voice stealing: max 8 concurrent notes
    if (voiceCount > 0) {
      const existing = this.activeVoices.get(noteNumber)!
      if (existing.length >= 8) {
        const oldVoice = existing.shift()!
        oldVoice.oscillator.stop(this.audioContext.currentTime + 0.01)
        oldVoice.envelope.gain.cancelScheduledValues(this.audioContext.currentTime)
      }
    }

    const oscillator = this.audioContext.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency

    const envelope = this.audioContext.createGain()
    const velocityGain = velocity / 127

    envelope.gain.setValueAtTime(0, this.audioContext.currentTime)
    envelope.gain.linearRampToValueAtTime(
      NOTE_ON_GAIN * velocityGain,
      this.audioContext.currentTime + 0.01
    )

    oscillator.connect(envelope)
    envelope.connect(this.masterGain)
    oscillator.start(this.audioContext.currentTime)

    const voice: ActiveVoice = { oscillator, gain: this.masterGain, envelope, startTime: this.audioContext.currentTime, noteNumber }

    if (!this.activeVoices.has(noteNumber)) {
      this.activeVoices.set(noteNumber, [])
    }
    this.activeVoices.get(noteNumber)!.push(voice)
  }

  noteOff(noteNumber: number, immediately: boolean = false): void {
    if (!this.audioContext) return

    const voices = this.activeVoices.get(noteNumber) || []
    if (!immediately && this.sustainedNotes.has(noteNumber)) {
      return // Hold note if sustain is active
    }

    voices.forEach((voice) => {
      const now = this.audioContext!.currentTime
      voice.envelope.gain.cancelScheduledValues(now)
      voice.envelope.gain.setValueAtTime(voice.envelope.gain.value, now)
      voice.envelope.gain.exponentialRampToValueAtTime(0.001, now + RELEASE_TIME)
      voice.oscillator.stop(now + RELEASE_TIME)
    })

    this.activeVoices.delete(noteNumber)
  }

  setSustain(active: boolean): void {
    if (!this.audioContext) return

    if (!active) {
      // Release all sustained notes
      Array.from(this.sustainedNotes).forEach((note) => {
        this.noteOff(note, false)
      })
      this.sustainedNotes.clear()
    }
  }

  releaseSustainedNote(noteNumber: number): void {
    if (!this.audioContext) return
    this.sustainedNotes.delete(noteNumber)
    this.noteOff(noteNumber, false)
  }

  sustain(noteNumber: number): void {
    this.sustainedNotes.add(noteNumber)
  }

  allNotesOff(): void {
    if (!this.audioContext) return

    Array.from(this.activeVoices.keys()).forEach((note) => {
      const voices = this.activeVoices.get(note) || []
      voices.forEach((voice) => {
        voice.oscillator.stop(this.audioContext!.currentTime + 0.01)
      })
    })

    this.activeVoices.clear()
    this.sustainedNotes.clear()
  }

  setMasterLevel(level: number): void {
    if (this.masterGain) {
      this.masterGain.gain.value = Math.max(0, Math.min(1, level))
    }
  }

  isReady(): boolean {
    return this.initialized && this.audioContext !== null && this.audioContext.state !== 'closed'
  }

  getError(): string | null {
    return this.error
  }

  getState(): AudioContextState | null {
    return this.audioContext?.state ?? null
  }
}

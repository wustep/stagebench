export interface VoiceHandle {
  id: string
  midi: number
  gain: number
}

export type PianoMode = 'loading' | 'sampled' | 'fallback'

export interface PianoAudioBackend {
  prepare(): Promise<'sampled' | 'fallback'>
  resume(): Promise<void>
  startVoice(midi: number, gain: number): VoiceHandle
  releaseVoice(voice: VoiceHandle, releaseSeconds: number): void
  stopVoice(voice: VoiceHandle): void
  setMasterVolume(value: number): void
  setReverb(value: number): void
}

export interface PianoSnapshot {
  activeNotes: number[]
  sustainedNotes: number[]
  voiceCount: number
  sustain: boolean
  volume: number
  reverb: number
  mode: PianoMode
}

interface ActiveVoice {
  handle: VoiceHandle
  order: number
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))

export function velocityToGain(velocity: number) {
  const normalized = clamp(velocity, 0, 127) / 127
  return normalized === 0 ? 0 : normalized ** 1.7
}

export class PianoEngine {
  private active = new Map<number, ActiveVoice>()
  private sustained = new Map<number, ActiveVoice>()
  private sequence = 0
  private sustainDown = false
  private volume = 0.72
  private reverb = 0.31
  private mode: PianoMode = 'loading'
  private listeners = new Set<(snapshot: PianoSnapshot) => void>()
  private readonly maxPolyphony: number
  private readonly releaseSeconds: number

  constructor(private readonly audio: PianoAudioBackend, options: { maxPolyphony?: number; releaseSeconds?: number } = {}) {
    this.maxPolyphony = Math.max(1, options.maxPolyphony ?? 32)
    this.releaseSeconds = Math.max(0, options.releaseSeconds ?? 0.42)
    audio.setMasterVolume(this.volume)
    audio.setReverb(this.reverb)
  }

  async prepare() {
    this.mode = await this.audio.prepare()
    this.emit()
    return this.mode
  }

  noteOn(midi: number, velocity = 100) {
    if (!Number.isFinite(midi) || midi < 0 || midi > 127 || velocity <= 0) return
    void this.audio.resume()
    this.releaseExisting(midi)
    while (this.voiceCount() >= this.maxPolyphony) this.stealOldest()
    const handle = this.audio.startVoice(Math.round(midi), velocityToGain(velocity))
    this.active.set(Math.round(midi), { handle, order: this.sequence++ })
    this.emit()
  }

  noteOff(midi: number) {
    const note = Math.round(midi)
    const voice = this.active.get(note)
    if (!voice) return
    this.active.delete(note)
    if (this.sustainDown) this.sustained.set(note, voice)
    else this.release(voice)
    this.emit()
  }

  setSustain(down: boolean) {
    if (down === this.sustainDown) return
    this.sustainDown = down
    if (!down) {
      for (const voice of this.sustained.values()) this.release(voice)
      this.sustained.clear()
    }
    this.emit()
  }

  allNotesOff() {
    for (const voice of [...this.active.values(), ...this.sustained.values()]) this.audio.stopVoice(voice.handle)
    this.active.clear()
    this.sustained.clear()
    this.sustainDown = false
    this.emit()
  }

  setMasterVolume(value: number) {
    this.volume = clamp(value)
    this.audio.setMasterVolume(this.volume)
    this.emit()
  }

  setReverb(value: number) {
    this.reverb = clamp(value)
    this.audio.setReverb(this.reverb)
    this.emit()
  }

  snapshot(): PianoSnapshot {
    return {
      activeNotes: [...this.active.keys()].sort((a, b) => a - b),
      sustainedNotes: [...this.sustained.keys()].sort((a, b) => a - b),
      voiceCount: this.voiceCount(),
      sustain: this.sustainDown,
      volume: this.volume,
      reverb: this.reverb,
      mode: this.mode,
    }
  }

  subscribe(listener: (snapshot: PianoSnapshot) => void) {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  private emit() {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }

  private voiceCount() { return this.active.size + this.sustained.size }

  private release(voice: ActiveVoice) { this.audio.releaseVoice(voice.handle, this.releaseSeconds) }

  private releaseExisting(midi: number) {
    const active = this.active.get(midi)
    if (active) {
      this.release(active)
      this.active.delete(midi)
    }
    const sustained = this.sustained.get(midi)
    if (sustained) {
      this.release(sustained)
      this.sustained.delete(midi)
    }
  }

  private stealOldest() {
    const candidates = [...this.active.entries(), ...this.sustained.entries()]
    const oldest = candidates.reduce((first, candidate) => candidate[1].order < first[1].order ? candidate : first)
    this.audio.stopVoice(oldest[1].handle)
    this.active.delete(oldest[0])
    this.sustained.delete(oldest[0])
  }
}

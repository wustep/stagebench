export type PianoStatus =
  | { state: 'ready'; label: string }
  | { state: 'starting'; label: string }
  | { state: 'error'; label: string }
  | { state: 'fallback'; label: string }

export interface VoiceHandle {
  release(): void
  stop(): void
}

export interface VoiceBackend {
  startVoice(note: number, velocity: number, voiceId: number): VoiceHandle
  stopAll(): void
  dispose(): void
  getStatus(): PianoStatus
  subscribe?(listener: (status: PianoStatus) => void): () => void
}

export interface Clock {
  now(): number
}

interface OwnedVoice {
  voiceId: number
  note: number
  velocity: number
  sourceId: string
  sequence: number
  held: boolean
  sustained: boolean
  handle: VoiceHandle
}

export interface NoteSnapshot {
  activeNotes: number[]
  activeVoiceCount: number
  sustain: boolean
}

export interface PlayablePianoEngine {
  noteOn(note: number, velocity: number, sourceId: string): void
  noteOff(sourceId: string): void
  setSustain(down: boolean): void
  allNotesOff(): void
  dispose(): void
  snapshot(): NoteSnapshot
  getStatus(): PianoStatus
  subscribe(listener: (snapshot: NoteSnapshot) => void): () => void
  subscribeStatus(listener: (status: PianoStatus) => void): () => void
}

export class PianoNoteEngine {
  private voices = new Map<string, OwnedVoice>()
  private sequence = 0
  private voiceId = 0
  private sustainDown = false
  private listeners = new Set<(snapshot: NoteSnapshot) => void>()

  constructor(
    private readonly backend: VoiceBackend,
    private readonly maxPolyphony = 24,
    private readonly clock: Clock = { now: () => performance.now() },
  ) {}

  noteOn(note: number, velocity: number, sourceId: string): void {
    if (this.voices.has(sourceId)) this.noteOff(sourceId)
    if (this.voices.size >= this.maxPolyphony) this.stealOldestVoice()

    const normalizedVelocity = Math.max(0.01, Math.min(1, velocity))
    const voiceId = ++this.voiceId
    const voice: OwnedVoice = {
      voiceId,
      note,
      velocity: normalizedVelocity,
      sourceId,
      sequence: ++this.sequence + this.clock.now() * Number.EPSILON,
      held: true,
      sustained: false,
      handle: this.backend.startVoice(note, normalizedVelocity, voiceId),
    }
    this.voices.set(sourceId, voice)
    this.emit()
  }

  noteOff(sourceId: string): void {
    const voice = this.voices.get(sourceId)
    if (!voice) return
    voice.held = false
    if (this.sustainDown) {
      voice.sustained = true
    } else {
      voice.handle.release()
      this.voices.delete(sourceId)
    }
    this.emit()
  }

  setSustain(down: boolean): void {
    if (this.sustainDown === down) return
    this.sustainDown = down
    if (!down) {
      for (const [sourceId, voice] of this.voices) {
        if (!voice.held && voice.sustained) {
          voice.handle.release()
          this.voices.delete(sourceId)
        }
      }
    }
    this.emit()
  }

  allNotesOff(): void {
    for (const voice of this.voices.values()) voice.handle.stop()
    this.voices.clear()
    this.sustainDown = false
    this.backend.stopAll()
    this.emit()
  }

  dispose(): void {
    this.allNotesOff()
    this.backend.dispose()
    this.listeners.clear()
  }

  snapshot(): NoteSnapshot {
    const notes = [...new Set([...this.voices.values()].map((voice) => voice.note))].sort((a, b) => a - b)
    return { activeNotes: notes, activeVoiceCount: this.voices.size, sustain: this.sustainDown }
  }

  getStatus(): PianoStatus {
    return this.backend.getStatus()
  }

  subscribe(listener: (snapshot: NoteSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => this.listeners.delete(listener)
  }

  subscribeStatus(listener: (status: PianoStatus) => void): () => void {
    listener(this.backend.getStatus())
    return this.backend.subscribe?.(listener) ?? (() => undefined)
  }

  private stealOldestVoice(): void {
    const oldest = [...this.voices.values()].sort((a, b) => a.sequence - b.sequence)[0]
    if (!oldest) return
    oldest.handle.stop()
    this.voices.delete(oldest.sourceId)
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

interface AudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext
}

export class BrowserPianoBackend implements VoiceBackend {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private handles = new Map<number, VoiceHandle>()
  private listeners = new Set<(status: PianoStatus) => void>()
  private status: PianoStatus = typeof window === 'undefined' || !(window.AudioContext || (window as AudioWindow).webkitAudioContext)
    ? { state: 'fallback', label: 'Audio unavailable · silent visual fallback' }
    : { state: 'ready', label: 'Modeled piano ready · audio starts on first note' }

  startVoice(note: number, velocity: number, voiceId: number): VoiceHandle {
    try {
      this.ensureContext()
      if (!this.context || !this.master) return this.silentHandle()

      const context = this.context
      const startedAt = context.currentTime
      const frequency = 440 * 2 ** ((note - 69) / 12)
      const voiceGain = context.createGain()
      const tone = context.createBiquadFilter()
      const oscillators: OscillatorNode[] = []
      const partials = [
        { ratio: 1, amount: 0.72, type: 'triangle' as OscillatorType },
        { ratio: 2.01, amount: 0.19, type: 'sine' as OscillatorType },
        { ratio: 3.98, amount: 0.08, type: 'sine' as OscillatorType },
      ]

      voiceGain.gain.setValueAtTime(0.0001, startedAt)
      voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.012, velocity ** 1.65 * 0.34), startedAt + 0.008)
      voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.004, velocity * 0.09), startedAt + 1.4)
      tone.type = 'lowpass'
      tone.frequency.setValueAtTime(1700 + velocity * 5200, startedAt)
      tone.Q.setValueAtTime(0.7, startedAt)
      tone.connect(voiceGain)
      voiceGain.connect(this.master)

      for (const partial of partials) {
        const oscillator = context.createOscillator()
        const partialGain = context.createGain()
        oscillator.type = partial.type
        oscillator.frequency.setValueAtTime(frequency * partial.ratio, startedAt)
        oscillator.detune.setValueAtTime((voiceId % 3 - 1) * 0.7, startedAt)
        partialGain.gain.setValueAtTime(partial.amount, startedAt)
        oscillator.connect(partialGain).connect(tone)
        oscillator.start(startedAt)
        oscillators.push(oscillator)
      }

      let stopped = false
      const finish = (releaseSeconds: number) => {
        if (stopped) return
        stopped = true
        const now = context.currentTime
        voiceGain.gain.cancelScheduledValues(now)
        voiceGain.gain.setValueAtTime(Math.max(0.0001, voiceGain.gain.value), now)
        voiceGain.gain.exponentialRampToValueAtTime(0.0001, now + releaseSeconds)
        for (const oscillator of oscillators) oscillator.stop(now + releaseSeconds + 0.03)
        window.setTimeout(() => {
          for (const oscillator of oscillators) oscillator.disconnect()
          tone.disconnect()
          voiceGain.disconnect()
          this.handles.delete(voiceId)
        }, (releaseSeconds + 0.08) * 1000)
      }
      const handle = { release: () => finish(0.58), stop: () => finish(0.018) }
      this.handles.set(voiceId, handle)
      return handle
    } catch {
      this.setStatus({ state: 'error', label: 'Audio start failed · silent visual fallback' })
      return this.silentHandle()
    }
  }

  stopAll(): void {
    for (const handle of this.handles.values()) handle.stop()
    this.handles.clear()
  }

  dispose(): void {
    this.stopAll()
    if (this.context && this.context.state !== 'closed') void this.context.close()
    this.context = null
    this.master = null
    this.listeners.clear()
  }

  getStatus(): PianoStatus {
    return this.status
  }

  subscribe(listener: (status: PianoStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private ensureContext(): void {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume()
      return
    }
    const Constructor = window.AudioContext || (window as AudioWindow).webkitAudioContext
    if (!Constructor) {
      this.setStatus({ state: 'fallback', label: 'Audio unavailable · silent visual fallback' })
      return
    }
    this.setStatus({ state: 'starting', label: 'Starting modeled piano…' })
    this.context = new Constructor()
    this.master = this.context.createGain()
    this.master.gain.value = 0.7
    this.master.connect(this.context.destination)
    void this.context.resume().then(
      () => this.setStatus({ state: 'ready', label: 'Modeled piano ready' }),
      () => this.setStatus({ state: 'error', label: 'Audio permission failed · silent visual fallback' }),
    )
  }

  private silentHandle(): VoiceHandle {
    return { release: () => undefined, stop: () => undefined }
  }

  private setStatus(status: PianoStatus): void {
    this.status = status
    for (const listener of this.listeners) listener(status)
  }
}

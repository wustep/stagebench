export interface PianoOutput {
  noteOn(id: string, midi: number, velocity: number): void
  noteOff(id: string, releaseSeconds?: number): void
  allNotesOff(): void
  dispose(): void
}

export interface NoteRecord {
  id: string
  midi: number
  velocity: number
  order: number
  state: 'pressed' | 'sustained'
}

export interface NoteLifecycleSnapshot {
  sustain: boolean
  notes: NoteRecord[]
}

/** Shared note ownership for keybed, computer keyboard, and MIDI input. */
export class NoteLifecycle {
  private readonly notes = new Map<string, NoteRecord>()
  private order = 0
  private sustain = false

  constructor(private readonly output: PianoOutput, private readonly maxVoices = 32) {}

  noteOn(id: string, midi: number, velocity: number): void {
    this.noteOff(id, 0.012)
    if (this.notes.size >= this.maxVoices) {
      const oldest = [...this.notes.values()].sort((a, b) => a.order - b.order)[0]
      if (oldest) {
        this.notes.delete(oldest.id)
        this.output.noteOff(oldest.id, 0.012)
      }
    }
    const record: NoteRecord = {
      id,
      midi,
      velocity: clamp(Math.round(velocity), 1, 127),
      order: this.order++,
      state: 'pressed',
    }
    this.notes.set(id, record)
    try {
      this.output.noteOn(id, midi, record.velocity)
    } catch (error) {
      this.notes.delete(id)
      throw error
    }
  }

  noteOff(id: string, releaseSeconds = 0.24): void {
    const record = this.notes.get(id)
    if (!record) return
    if (this.sustain) {
      record.state = 'sustained'
      return
    }
    this.notes.delete(id)
    this.output.noteOff(id, releaseSeconds)
  }

  setSustain(isDown: boolean): void {
    if (this.sustain === isDown) return
    this.sustain = isDown
    if (!isDown) {
      for (const [id, note] of this.notes) {
        if (note.state === 'sustained') {
          this.notes.delete(id)
          this.output.noteOff(id)
        }
      }
    }
  }

  allNotesOff(): void {
    this.notes.clear()
    this.sustain = false
    this.output.allNotesOff()
  }

  snapshot(): NoteLifecycleSnapshot {
    return { sustain: this.sustain, notes: [...this.notes.values()].map((note) => ({ ...note })) }
  }
}

const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value))

export const velocityAmplitude = (velocity: number): number => {
  const normalized = clamp(velocity, 1, 127) / 127
  return 0.025 + 0.72 * normalized ** 1.65
}

export const midiFrequency = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)

/** Generated additive piano tone, used by the live Web Audio buffer renderer. */
export function renderPianoWave(midi: number, frameCount: number, sampleRate: number): Float32Array {
  const output = new Float32Array(frameCount)
  const frequency = midiFrequency(midi)
  const partials = [1, 0.43, 0.19, 0.075, 0.028]
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / sampleRate
    const envelope = Math.exp(-time * 2.8) * (0.94 + 0.06 * Math.exp(-time * 16))
    let sample = 0
    for (let harmonic = 1; harmonic <= partials.length; harmonic += 1) {
      const inharmonicFrequency = frequency * harmonic * (1 + 0.00018 * harmonic * harmonic)
      sample += Math.sin(2 * Math.PI * inharmonicFrequency * time) * (partials[harmonic - 1] ?? 0)
    }
    output[frame] = sample * envelope * 0.78
  }
  return output
}

interface ActiveVoice {
  source: AudioBufferSourceNode
  gain: GainNode
  createdAt: number
  stopped: boolean
}

type AudioContextConstructor = new () => AudioContext

function browserAudioContext(): AudioContext {
  const audioWindow = window as Window & { webkitAudioContext?: AudioContextConstructor }
  const Context = window.AudioContext ?? audioWindow.webkitAudioContext
  if (!Context) throw new Error('Web Audio is unavailable in this browser')
  return new Context()
}

/** Offline, generated additive tone. No remote samples or recordings are used. */
export class WebAudioPiano implements PianoOutput {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private readonly voices = new Map<string, ActiveVoice>()
  private readonly buffers = new Map<number, AudioBuffer>()
  private sequence = 0

  constructor(private readonly contextFactory: () => AudioContext = browserAudioContext, private readonly maxVoices = 32) {}

  noteOn(id: string, midi: number, velocity: number): void {
    const context = this.getContext()
    this.stopVoice(id, 0.005)
    while (this.voices.size >= this.maxVoices) {
      const oldest = [...this.voices.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]
      if (!oldest) break
      this.stopVoice(oldest[0], 0.005)
    }
    const source = context.createBufferSource()
    source.buffer = this.getBuffer(midi)
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.linearRampToValueAtTime(velocityAmplitude(velocity), context.currentTime + 0.008)
    source.connect(gain)
    gain.connect(this.master!)
    const voice: ActiveVoice = { source, gain, createdAt: this.sequence++, stopped: false }
    this.voices.set(id, voice)
    source.onended = () => {
      if (this.voices.get(id) === voice) this.voices.delete(id)
      source.disconnect()
      gain.disconnect()
    }
    source.start()
    void context.resume().catch(() => undefined)
  }

  noteOff(id: string, releaseSeconds = 0.24): void {
    this.stopVoice(id, releaseSeconds)
  }

  allNotesOff(): void {
    for (const id of this.voices.keys()) this.stopVoice(id, 0.012)
  }

  dispose(): void {
    this.allNotesOff()
    const context = this.context
    this.context = null
    this.master = null
    this.buffers.clear()
    if (context && context.state !== 'closed') void context.close().catch(() => undefined)
  }

  private getContext(): AudioContext {
    if (!this.context || this.context.state === 'closed') {
      const context = this.contextFactory()
      const master = context.createGain()
      master.gain.value = 0.72
      master.connect(context.destination)
      this.context = context
      this.master = master
      this.buffers.clear()
    }
    return this.context
  }

  private getBuffer(midi: number): AudioBuffer {
    const context = this.context!
    const cached = this.buffers.get(midi)
    if (cached) return cached
    const sampleRate = context.sampleRate
    const frameCount = Math.round(sampleRate * 2.2)
    const buffer = context.createBuffer(1, frameCount, sampleRate)
    buffer.getChannelData(0).set(renderPianoWave(midi, frameCount, sampleRate))
    this.buffers.set(midi, buffer)
    return buffer
  }

  private stopVoice(id: string, releaseSeconds: number): void {
    const voice = this.voices.get(id)
    if (!voice || voice.stopped) return
    voice.stopped = true
    this.voices.delete(id)
    const context = this.context
    if (!context) return
    const now = context.currentTime
    const release = Math.max(0.006, releaseSeconds)
    voice.gain.gain.cancelScheduledValues(now)
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now)
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + release)
    try {
      voice.source.stop(now + release + 0.025)
    } catch {
      voice.source.disconnect()
      voice.gain.disconnect()
    }
  }
}

export const createPianoOutput = (): PianoOutput => new WebAudioPiano()

import type { AudioContextFactory, PianoStatus, TimingBoundary } from './boundaries'
import { defaultAudioContextFactory, defaultTiming } from './boundaries'

const MAX_POLYPHONY = 32

interface ActiveVoice {
  midi: number
  voiceId: number
  osc: OscillatorNode
  gain: GainNode
  startedAt: number
}

export interface PianoEngineOptions {
  audioContextFactory?: AudioContextFactory
  timing?: TimingBoundary
  polyphony?: number
  forceError?: boolean
}

export class PianoEngine {
  readonly context: AudioContext | OfflineAudioContext
  readonly timing: TimingBoundary
  readonly maxPolyphony: number
  private masterGain: GainNode
  private voices = new Map<number, ActiveVoice>()
  private sustainedNotes = new Set<number>()
  private sustainPedal = false
  private nextVoiceId = 1
  private status: PianoStatus = 'loading'
  private started = false

  constructor(options: PianoEngineOptions = {}) {
    this.timing = options.timing ?? defaultTiming
    this.maxPolyphony = options.polyphony ?? MAX_POLYPHONY
    const factory = options.audioContextFactory ?? defaultAudioContextFactory
    this.context = factory.create()
    this.masterGain = this.context.createGain()
    this.masterGain.gain.value = 0.35
    this.masterGain.connect(this.context.destination)

    if (options.forceError) {
      this.status = 'error'
    } else {
      this.status = 'ready'
    }
  }

  getStatus(): PianoStatus {
    return this.status
  }

  getActiveVoiceCount(): number {
    return this.voices.size
  }

  isSustainHeld(): boolean {
    return this.sustainPedal
  }

  async ensureStarted(): Promise<void> {
    if (this.started) return
    if ('resume' in this.context) {
      await this.context.resume()
    }
    this.started = true
  }

  midiToFreq(midi: number): number {
    return 440 * 2 ** ((midi - 69) / 12)
  }

  velocityToGain(velocity: number): number {
    const v = Math.max(1, Math.min(127, velocity))
    return (v / 127) ** 1.4
  }

  noteOn(midi: number, velocity = 100, time?: number): number {
    if (this.status === 'error') return -1
    const when = time ?? this.context.currentTime
    const voiceId = this.nextVoiceId++
    this.releaseVoiceForNote(midi, when, 0.01)

    if (this.voices.size >= this.maxPolyphony) {
      this.stealOldestVoice(when)
    }

    const osc = this.context.createOscillator()
    const gain = this.context.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(this.midiToFreq(midi), when)

    const overtone = this.context.createOscillator()
    const overtoneGain = this.context.createGain()
    overtone.type = 'sine'
    overtone.frequency.setValueAtTime(this.midiToFreq(midi) * 2, when)
    overtoneGain.gain.value = 0.15

    const amp = this.velocityToGain(velocity)
    gain.gain.setValueAtTime(0, when)
    gain.gain.linearRampToValueAtTime(amp, when + 0.008)
    gain.gain.exponentialRampToValueAtTime(Math.max(amp * 0.65, 0.001), when + 1.2)

    osc.connect(gain)
    overtone.connect(overtoneGain)
    overtoneGain.connect(gain)
    gain.connect(this.masterGain)

    osc.start(when)
    overtone.start(when)

    this.voices.set(voiceId, { midi, voiceId, osc, gain, startedAt: this.timing.now() })
    return voiceId
  }

  noteOff(midi: number, time?: number): void {
    const when = time ?? this.context.currentTime
    if (this.sustainPedal || this.sustainedNotes.has(midi)) {
      this.sustainedNotes.add(midi)
      return
    }
    this.releaseVoiceForNote(midi, when)
  }

  setSustain(on: boolean, time?: number): void {
    const when = time ?? this.context.currentTime
    this.sustainPedal = on
    if (!on) {
      for (const midi of [...this.sustainedNotes]) {
        this.sustainedNotes.delete(midi)
        this.releaseVoiceForNote(midi, when)
      }
    }
  }

  allNotesOff(time?: number): void {
    const when = time ?? this.context.currentTime
    this.sustainPedal = false
    this.sustainedNotes.clear()
    for (const voice of [...this.voices.values()]) {
      this.releaseVoice(voice, when)
    }
  }

  dispose(): void {
    this.allNotesOff()
    this.masterGain.disconnect()
    if ('close' in this.context) {
      void this.context.close()
    }
  }

  private stealOldestVoice(when: number): void {
    let oldest: ActiveVoice | null = null
    for (const voice of this.voices.values()) {
      if (!oldest || voice.startedAt < oldest.startedAt) oldest = voice
    }
    if (oldest) this.releaseVoice(oldest, when, 0.02)
  }

  private releaseVoiceForNote(midi: number, when: number, release = 0.08): void {
    for (const voice of [...this.voices.values()]) {
      if (voice.midi === midi) this.releaseVoice(voice, when, release)
    }
  }

  private releaseVoice(voice: ActiveVoice, when: number, release = 0.08): void {
    if (!this.voices.has(voice.voiceId)) return
    voice.gain.gain.cancelScheduledValues(when)
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), when)
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, when + release)
    voice.osc.stop(when + release + 0.05)
    this.voices.delete(voice.voiceId)
  }
}

export async function measureOutputLevel(
  engine: PianoEngine,
  midi: number,
  velocity: number,
  sampleMs = 200,
): Promise<number> {
  const offline = new OfflineAudioContext(1, 44100 * 2, 44100)
  const factory: AudioContextFactory = { create: () => offline }
  const testEngine = new PianoEngine({ audioContextFactory: factory, timing: defaultTiming })
  testEngine.noteOn(midi, velocity, 0)
  const buffer = await offline.startRendering()
  const data = buffer.getChannelData(0)
  const samples = Math.min(data.length, Math.floor((sampleMs / 1000) * buffer.sampleRate))
  let sum = 0
  for (let i = 0; i < samples; i++) sum += data[i]! ** 2
  testEngine.dispose()
  return Math.sqrt(sum / samples)
}

export type VoiceState = 'held' | 'sustained' | 'released'
export type PianoStatus = 'ready' | 'fallback' | 'error'

export interface AudioAdapter {
  startVoice(voice: PianoVoice): void
  releaseVoice(voice: PianoVoice, releaseSeconds: number): void
  stopVoice(voice: PianoVoice): void
  allNotesOff(): void
}

export interface PianoVoice {
  id: number
  note: number
  velocity: number
  source: string
  startedAt: number
  state: VoiceState
  stolen: boolean
}

export interface PianoSnapshot {
  status: PianoStatus
  sustain: boolean
  voices: PianoVoice[]
  ownedSources: string[]
}

export class NullAudioAdapter implements AudioAdapter {
  public started: number[] = []
  public released: number[] = []
  public stopped: number[] = []

  startVoice(voice: PianoVoice) {
    this.started.push(voice.id)
  }

  releaseVoice(voice: PianoVoice) {
    this.released.push(voice.id)
  }

  stopVoice(voice: PianoVoice) {
    this.stopped.push(voice.id)
  }

  allNotesOff() {
    this.started = []
    this.released = []
    this.stopped = []
  }
}

export class GeneratedPianoEngine {
  private voices = new Map<number, PianoVoice>()
  private sourceToVoice = new Map<string, number>()
  private nextVoiceId = 1
  private sustain = false

  constructor(
    private readonly adapter: AudioAdapter = new NullAudioAdapter(),
    private readonly maxVoices = 16,
    private readonly releaseSeconds = 0.48,
    public readonly status: PianoStatus = 'ready',
  ) {}

  noteOn(note: number, velocity = 0.8, source = `note-${note}-${this.nextVoiceId}`) {
    if (this.sourceToVoice.has(source)) return this.sourceToVoice.get(source) ?? null
    this.enforcePolyphonyLimit()
    const voice: PianoVoice = {
      id: this.nextVoiceId,
      note,
      velocity: Math.max(0.05, Math.min(1, velocity)),
      source,
      startedAt: this.nextVoiceId,
      state: 'held',
      stolen: false,
    }
    this.nextVoiceId += 1
    this.voices.set(voice.id, voice)
    this.sourceToVoice.set(source, voice.id)
    this.adapter.startVoice(voice)
    return voice.id
  }

  noteOff(note: number, source?: string) {
    const voiceIds = source ? [this.sourceToVoice.get(source)].filter((id): id is number => id !== undefined) : this.findHeldVoices(note).map((voice) => voice.id)
    for (const voiceId of voiceIds) {
      const voice = this.voices.get(voiceId)
      if (!voice) continue
      this.sourceToVoice.delete(voice.source)
      if (this.sustain) {
        voice.state = 'sustained'
        continue
      }
      this.releaseVoice(voice)
    }
  }

  setSustain(enabled: boolean) {
    if (this.sustain === enabled) return
    this.sustain = enabled
    if (!enabled) {
      for (const voice of this.voices.values()) {
        if (voice.state === 'sustained') this.releaseVoice(voice)
      }
    }
  }

  allNotesOff() {
    for (const voice of this.voices.values()) {
      this.adapter.stopVoice(voice)
    }
    this.voices.clear()
    this.sourceToVoice.clear()
    this.sustain = false
    this.adapter.allNotesOff()
  }

  cleanupReleased() {
    for (const voice of this.voices.values()) {
      if (voice.state === 'released') this.voices.delete(voice.id)
    }
  }

  snapshot(): PianoSnapshot {
    return {
      status: this.status,
      sustain: this.sustain,
      voices: [...this.voices.values()].map((voice) => ({ ...voice })),
      ownedSources: [...this.sourceToVoice.keys()].sort(),
    }
  }

  private findHeldVoices(note: number) {
    return [...this.voices.values()].filter((voice) => voice.note === note && voice.state === 'held')
  }

  private releaseVoice(voice: PianoVoice) {
    voice.state = 'released'
    this.adapter.releaseVoice(voice, this.releaseSeconds)
  }

  private enforcePolyphonyLimit() {
    if (this.voices.size < this.maxVoices) return
    const candidates = [...this.voices.values()].sort((left, right) => {
      if (left.state !== right.state) return left.state === 'released' ? -1 : 1
      return left.startedAt - right.startedAt || left.note - right.note
    })
    const stolen = candidates[0]
    if (!stolen) return
    stolen.stolen = true
    this.sourceToVoice.delete(stolen.source)
    this.adapter.stopVoice(stolen)
    this.voices.delete(stolen.id)
  }
}

export class WebAudioPianoAdapter implements AudioAdapter {
  private context: AudioContext | null = null
  private nodes = new Map<number, { gain: GainNode; oscillators: OscillatorNode[] }>()

  private getContext() {
    if (!this.context) {
      this.context = new AudioContext()
    }
    return this.context
  }

  startVoice(voice: PianoVoice) {
    const context = this.getContext()
    void context.resume()
    const now = context.currentTime
    const frequency = 440 * 2 ** ((voice.note - 69) / 12)
    const gain = context.createGain()
    const filter = context.createBiquadFilter()
    const main = context.createOscillator()
    const body = context.createOscillator()
    main.type = 'triangle'
    body.type = 'sine'
    main.frequency.value = frequency
    body.frequency.value = frequency * 2.01
    filter.type = 'lowpass'
    filter.frequency.value = 2500 + voice.velocity * 3000
    filter.Q.value = 0.9
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.035 + voice.velocity * 0.16, now + 0.018)
    gain.gain.exponentialRampToValueAtTime(0.022 + voice.velocity * 0.09, now + 0.22)
    main.connect(filter)
    body.connect(filter)
    filter.connect(gain)
    gain.connect(context.destination)
    main.start(now)
    body.start(now)
    this.nodes.set(voice.id, { gain, oscillators: [main, body] })
  }

  releaseVoice(voice: PianoVoice, releaseSeconds: number) {
    const node = this.nodes.get(voice.id)
    if (!node || !this.context) return
    const now = this.context.currentTime
    node.gain.gain.cancelScheduledValues(now)
    node.gain.gain.setTargetAtTime(0.0001, now, releaseSeconds / 3)
    for (const oscillator of node.oscillators) oscillator.stop(now + releaseSeconds)
    window.setTimeout(() => this.nodes.delete(voice.id), Math.ceil(releaseSeconds * 1000) + 40)
  }

  stopVoice(voice: PianoVoice) {
    const node = this.nodes.get(voice.id)
    if (!node || !this.context) return
    const now = this.context.currentTime
    for (const oscillator of node.oscillators) {
      try {
        oscillator.stop(now)
      } catch {
        // Already stopped voices are harmless during global cleanup.
      }
    }
    this.nodes.delete(voice.id)
  }

  allNotesOff() {
    for (const voiceId of Array.from(this.nodes.keys())) {
      const node = this.nodes.get(voiceId)
      if (!node || !this.context) continue
      for (const oscillator of node.oscillators) {
        try {
          oscillator.stop(this.context.currentTime)
        } catch {
          // Already stopped voices are harmless during global cleanup.
        }
      }
      this.nodes.delete(voiceId)
    }
  }
}

export const COMPUTER_KEY_TO_MIDI = new Map<string, number>([
  ['a', 60],
  ['w', 61],
  ['s', 62],
  ['e', 63],
  ['d', 64],
  ['f', 65],
  ['t', 66],
  ['g', 67],
  ['y', 68],
  ['h', 69],
  ['u', 70],
  ['j', 71],
  ['k', 72],
  ['o', 73],
  ['l', 74],
  ['p', 75],
  [';', 76],
  ["'", 77],
])

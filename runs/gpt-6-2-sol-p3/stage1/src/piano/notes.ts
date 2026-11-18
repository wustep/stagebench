export interface Voice {
  release(seconds?: number): void
  stop(): void
}

export interface VoiceOutput {
  play(note: number, velocity: number, ended: () => void): Voice | undefined
  stopAll(): void
}

export interface KeyState {
  held: ReadonlySet<number>
  sustained: ReadonlySet<number>
}

type VoicePhase = 'held' | 'sustained' | 'releasing'
interface Playing {
  note: number
  channel: string
  phase: VoicePhase
  voice: Voice
}

const priority: Record<VoicePhase, number> = { releasing: 0, sustained: 1, held: 2 }
export const emptyKeys: KeyState = { held: new Set(), sustained: new Set() }
export const localChannel = 'local'

export class NoteLifecycle {
  private nextId = 1
  private readonly owners = new Map<string, { note: number; id: number }>()
  private readonly voices = new Map<number, Playing>()
  private readonly pedals = new Set<string>()

  constructor(
    private readonly output: VoiceOutput,
    private readonly onKeys: (state: KeyState) => void,
    private readonly voiceLimit = 24,
  ) {}

  press(token: string, note: number, velocity: number, channel = localChannel) {
    if (this.owners.has(token) || !Number.isInteger(note) || note < 0 || note > 127 ||
        !Number.isFinite(velocity) || velocity <= 0) return
    if (this.voices.size >= this.voiceLimit) this.stealVoice()

    const id = this.nextId++
    this.owners.set(token, { note, id })
    const voice = this.output.play(note, Math.min(127, velocity), () => this.voiceEnded(id))
    if (voice) this.voices.set(id, { note, voice, channel, phase: 'held' })
    this.publish()
  }

  release(token: string) {
    const owner = this.owners.get(token)
    if (!owner) return
    this.owners.delete(token)
    const playing = this.voices.get(owner.id)
    if (playing) {
      if (this.pedals.has(playing.channel)) playing.phase = 'sustained'
      else this.releaseVoice(playing)
    }
    this.publish()
  }

  sustain(channel: string, down: boolean) {
    if (down) {
      this.pedals.add(channel)
      return
    }
    if (!this.pedals.delete(channel)) return
    for (const playing of this.voices.values()) {
      if (playing.channel === channel && playing.phase === 'sustained') this.releaseVoice(playing)
    }
    this.publish()
  }

  allNotesOff() {
    this.owners.clear()
    this.voices.clear()
    this.pedals.clear()
    this.output.stopAll()
    this.onKeys(emptyKeys)
  }

  private releaseVoice(playing: Playing) {
    playing.phase = 'releasing'
    playing.voice.release()
  }

  private stealVoice() {
    let oldest: [number, Playing] | undefined
    for (const entry of this.voices) {
      if (!oldest || priority[entry[1].phase] < priority[oldest[1].phase]) oldest = entry
    }
    if (!oldest) return
    const [id, playing] = oldest
    this.voices.delete(id)
    playing.voice.release(0.016)
  }

  private voiceEnded(id: number) {
    const playing = this.voices.get(id)
    this.voices.delete(id)
    if (playing?.phase === 'sustained') this.publish()
  }

  private publish() {
    const held = new Set(Array.from(this.owners.values(), ({ note }) => note))
    const sustained = new Set<number>()
    for (const playing of this.voices.values()) {
      if (playing.phase === 'sustained') sustained.add(playing.note)
    }
    this.onKeys({ held, sustained })
  }
}

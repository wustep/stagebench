export interface Voice { release(): void; stop(): void }
export interface VoiceBackend { start(note: number, velocity: number): Voice }
interface OwnedVoice { token: number; source: string; note: number; voice: Voice; held: boolean }

/** All note sources use this ownership table. Oldest sounding voice is stolen first. */
export class PianoEngine {
  private voices = new Map<number, OwnedVoice>()
  private token = 0
  private sustainSources = new Set<string>()
  constructor(private backend: VoiceBackend, readonly maxVoices = 24) {}

  noteOn(source: string, note: number, velocity = 100): number {
    if (!Number.isInteger(note) || note < 0 || note > 127 || velocity <= 0) return -1
    if (this.voices.size >= this.maxVoices) {
      const oldest = this.voices.values().next().value as OwnedVoice
      oldest.voice.stop()
      this.voices.delete(oldest.token)
    }
    const token = ++this.token
    const voice = this.backend.start(note, Math.max(1, Math.min(127, velocity)))
    this.voices.set(token, { token, source, note, voice, held: true })
    return token
  }

  noteOff(source: string, note: number): void {
    const owned = [...this.voices.values()].find(v => v.source === source && v.note === note && v.held)
    if (!owned) return
    owned.held = false
    if (!this.sustainSources.size) this.releaseVoice(owned)
  }

  setSustain(source: string, down: boolean): void {
    if (down) this.sustainSources.add(source)
    else this.sustainSources.delete(source)
    if (!this.sustainSources.size) {
      for (const owned of this.voices.values()) if (!owned.held) this.releaseVoice(owned)
    }
  }

  disconnectSource(sourcePrefix: string): void {
    for (const owned of this.voices.values()) {
      if (owned.source.startsWith(sourcePrefix)) {
        owned.voice.stop()
        this.voices.delete(owned.token)
      }
    }
    for (const source of this.sustainSources) if (source.startsWith(sourcePrefix)) this.sustainSources.delete(source)
    if (!this.sustainSources.size) for (const owned of this.voices.values()) if (!owned.held) this.releaseVoice(owned)
  }

  allNotesOff(): void {
    for (const owned of this.voices.values()) owned.voice.stop()
    this.voices.clear()
    this.sustainSources.clear()
  }

  get soundingCount(): number { return this.voices.size }
  get sustainDown(): boolean { return this.sustainSources.size > 0 }
  get activeNotes(): number[] { return [...this.voices.values()].map(v => v.note) }

  private releaseVoice(owned: OwnedVoice): void {
    owned.voice.release()
    this.voices.delete(owned.token)
  }
}

export type AudioStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Small live additive piano synthesis, with velocity-dependent brightness and decay. */
export class WebPianoBackend implements VoiceBackend {
  private context: AudioContext | null = null
  private live = new Set<Voice>()
  constructor(private onStatus: (status: AudioStatus) => void) {}

  start(note: number, velocity: number): Voice {
    if (!this.context) {
      this.onStatus('loading')
      try {
        this.context = new AudioContext()
      } catch {
        this.onStatus('error')
        return { release() {}, stop() {} }
      }
    }
    const context = this.context
    if (context.state !== 'running') {
      void context.resume().then(() => this.onStatus('ready')).catch(() => this.onStatus('error'))
    } else this.onStatus('ready')
    const now = context.currentTime
    const amplitude = Math.pow(velocity / 127, 1.55)
    const base = 440 * Math.pow(2, (note - 69) / 12)
    const output = context.createGain()
    output.gain.setValueAtTime(0.0001, now)
    output.gain.exponentialRampToValueAtTime(0.23 * amplitude + 0.0001, now + 0.008)
    output.gain.exponentialRampToValueAtTime(0.11 * amplitude + 0.0001, now + 0.14)
    output.gain.exponentialRampToValueAtTime(0.00012, now + 8)
    output.connect(context.destination)
    const oscillators: OscillatorNode[] = []
    const partials = [1, 2.003, 3.008]
    const levels = [1, 0.33 * (velocity / 127), 0.13 * (velocity / 127)]
    partials.forEach((partial, index) => {
      const oscillator = context.createOscillator()
      const partialGain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.setValueAtTime(base * partial, now)
      partialGain.gain.value = levels[index]
      oscillator.connect(partialGain).connect(output)
      oscillator.start(now)
      oscillators.push(oscillator)
    })
    let stopped = false
    const finish = (releaseTime: number) => {
      if (stopped) return
      stopped = true
      output.gain.cancelScheduledValues(context.currentTime)
      output.gain.setValueAtTime(Math.max(output.gain.value, 0.0001), context.currentTime)
      output.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + releaseTime)
      oscillators.forEach(oscillator => oscillator.stop(context.currentTime + releaseTime + 0.02))
      window.setTimeout(() => {
        oscillators.forEach(oscillator => oscillator.disconnect())
        output.disconnect()
        this.live.delete(voice)
      }, Math.ceil((releaseTime + 0.05) * 1000))
    }
    const voice: Voice = { release: () => finish(0.22), stop: () => finish(0.008) }
    this.live.add(voice)
    return voice
  }

  get liveVoiceCount(): number { return this.live.size }
  async close(): Promise<void> {
    for (const voice of this.live) voice.stop()
    await this.context?.close()
    this.context = null
    this.live.clear()
  }
}

export interface MidiMessage { data: Uint8Array | number[] }
export function routeMidiMessage(engine: PianoEngine, source: string, message: MidiMessage): void {
  const [status, note, value] = message.data
  const kind = status & 0xf0
  const channel = status & 0x0f
  const owner = `${source}:ch${channel}`
  if (kind === 0x90 && value > 0) engine.noteOn(owner, note, value)
  else if (kind === 0x80 || (kind === 0x90 && value === 0)) engine.noteOff(owner, note)
  else if (kind === 0xb0 && note === 64) engine.setSustain(owner, value >= 64)
  else if (kind === 0xb0 && (note === 120 || note === 123)) engine.disconnectSource(owner)
}

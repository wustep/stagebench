// One deterministic note lifecycle shared by every input (pointer, touch, computer keys,
// focused on-screen keys, Web MIDI). It knows nothing about the DOM or Web Audio: voices come
// from an injected VoiceFactory.

export interface VoiceHandle {
  /** Begin the release. `fast` is used for stealing, retriggering and all-notes-off. */
  release(fast: boolean): void
  /** Hard stop and free all nodes immediately (unmount). */
  stopNow(): void
}

export interface VoiceFactory {
  /** Start a voice. `onEnded` must be called exactly once when the voice's nodes are freed. */
  startVoice(note: number, velocity: number, onEnded: () => void): VoiceHandle | null
}

export type VoicePhase = 'held' | 'sustained' | 'releasing'

export interface VoiceInfo {
  id: number
  note: number
  velocity: number
  phase: VoicePhase
  seq: number
}

export interface EngineSnapshot {
  /** Notes physically held by at least one source (drives key depression). */
  held: readonly number[]
  /** Notes with a voice that is held or sustained. */
  sounding: readonly number[]
  sustain: boolean
  voices: readonly VoiceInfo[]
  steals: number
}

interface Voice extends VoiceInfo {
  handle: VoiceHandle | null
}

export const DEFAULT_POLYPHONY = 24

export class NoteEngine {
  private readonly holders = new Map<number, Set<string>>()
  private readonly sustainSources = new Set<string>()
  private voices: Voice[] = []
  private nextId = 1
  private seq = 0
  private steals = 0
  private snapshotCache: EngineSnapshot | null = null
  private readonly listeners = new Set<() => void>()
  private disposed = false

  constructor(
    private voiceFactory: VoiceFactory,
    readonly maxPolyphony = DEFAULT_POLYPHONY,
  ) {}

  setVoiceFactory(factory: VoiceFactory): void {
    this.voiceFactory = factory
  }

  get sustain(): boolean {
    return this.sustainSources.size > 0
  }

  noteOn(note: number, velocity: number, source: string): void {
    if (this.disposed) return
    const v = Math.min(127, Math.max(1, Math.round(velocity)))
    let set = this.holders.get(note)
    if (!set) {
      set = new Set()
      this.holders.set(note, set)
    }
    // A repeated key-down from the same source is ignored (key repeat, double events).
    if (set.has(source)) return
    set.add(source)

    // Repeated note: the previous voice for this pitch is released quickly, then retriggered.
    for (const voice of this.voices) {
      if (voice.note === note && voice.phase !== 'releasing') this.releaseVoice(voice, true)
    }
    this.makeRoom()
    const id = this.nextId++
    const voice: Voice = { id, note, velocity: v, phase: 'held', seq: this.seq++, handle: null }
    this.voices.push(voice)
    voice.handle = this.voiceFactory.startVoice(note, v, () => this.voiceEnded(id))
    // No audio available: the key still depresses, but there is no voice to track.
    if (!voice.handle) this.voices = this.voices.filter((x) => x !== voice)
    this.changed()
  }

  noteOff(note: number, source: string): void {
    const set = this.holders.get(note)
    if (!set || !set.delete(source)) return
    if (set.size === 0) {
      this.holders.delete(note)
      this.releaseNote(note)
    }
    this.changed()
  }

  /** Release every note held by sources whose id starts with `prefix` (and their sustain). */
  releaseSources(prefix: string): void {
    let touched = false
    for (const [note, set] of [...this.holders]) {
      for (const source of [...set]) {
        if (source.startsWith(prefix)) {
          set.delete(source)
          touched = true
        }
      }
      if (set.size === 0) {
        this.holders.delete(note)
        this.releaseNote(note)
      }
    }
    for (const s of [...this.sustainSources]) {
      if (s.startsWith(prefix)) {
        this.setSustain(false, s)
        touched = true
      }
    }
    if (touched) this.changed()
  }

  setSustain(down: boolean, source: string): void {
    const was = this.sustain
    if (down) this.sustainSources.add(source)
    else this.sustainSources.delete(source)
    if (was && !this.sustain) {
      for (const voice of this.voices) {
        if (voice.phase === 'sustained') this.releaseVoice(voice, false)
      }
    }
    if (was !== this.sustain) this.changed()
  }

  /** Stop everything this engine owns: holders, sustain, and every voice (fast fade). */
  allNotesOff(): void {
    this.holders.clear()
    this.sustainSources.clear()
    for (const voice of [...this.voices]) this.releaseVoice(voice, true)
    this.changed()
  }

  /** Unmount: hard-stop every voice and refuse new notes. */
  dispose(): void {
    this.disposed = true
    this.holders.clear()
    this.sustainSources.clear()
    const voices = this.voices
    this.voices = []
    for (const voice of voices) voice.handle?.stopNow()
    this.changed()
    this.listeners.clear()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): EngineSnapshot {
    if (!this.snapshotCache) {
      const held = [...this.holders.keys()].sort((a, b) => a - b)
      const sounding = [...new Set(this.voices.filter((v) => v.phase !== 'releasing').map((v) => v.note))].sort((a, b) => a - b)
      this.snapshotCache = {
        held,
        sounding,
        sustain: this.sustain,
        voices: this.voices.map(({ id, note, velocity, phase, seq }) => ({ id, note, velocity, phase, seq })),
        steals: this.steals,
      }
    }
    return this.snapshotCache
  }

  private releaseNote(note: number): void {
    for (const voice of this.voices) {
      if (voice.note !== note || voice.phase !== 'held') continue
      if (this.sustain) voice.phase = 'sustained'
      else this.releaseVoice(voice, false)
    }
  }

  private releaseVoice(voice: Voice, fast: boolean): void {
    if (voice.phase === 'releasing' && !fast) return
    voice.phase = 'releasing'
    voice.handle?.release(fast)
  }

  /**
   * Deterministic voice stealing: when at the limit, remove the oldest releasing voice,
   * else the oldest sustained (not held) voice, else the oldest held voice.
   */
  private makeRoom(): void {
    while (this.voices.length >= this.maxPolyphony) {
      const order: VoicePhase[] = ['releasing', 'sustained', 'held']
      let victim: Voice | undefined
      for (const phase of order) {
        victim = this.voices.filter((v) => v.phase === phase).sort((a, b) => a.seq - b.seq)[0]
        if (victim) break
      }
      if (!victim) return
      this.voices = this.voices.filter((v) => v !== victim)
      this.steals++
      victim.phase = 'releasing'
      victim.handle?.release(true)
    }
  }

  private voiceEnded(id: number): void {
    const before = this.voices.length
    this.voices = this.voices.filter((v) => v.id !== id)
    if (this.voices.length !== before) this.changed()
  }

  private changed(): void {
    this.snapshotCache = null
    this.listeners.forEach((l) => l())
  }
}

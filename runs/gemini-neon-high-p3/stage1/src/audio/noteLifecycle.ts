import type { PianoVoiceBackend } from './boundaries'

export type VoicePhase = 'held' | 'sustained' | 'releasing'

export interface ManagedVoice {
  readonly voiceId: number
  readonly midi: number
  readonly velocity: number
  readonly startedOrder: number
  phase: VoicePhase
}

export interface NoteLifecycleSnapshot {
  readonly activeNotes: ReadonlySet<number>
  readonly sustainedNotes: ReadonlySet<number>
  readonly sustainActive: boolean
  readonly activeVoiceCount: number
  readonly stolenVoiceCount: number
  readonly lastNoteMidi: number | null
  readonly lastVelocity: number | null
}

export interface NoteLifecycleOptions {
  readonly maxPolyphony?: number
}

/**
 * Deterministic polyphonic note lifecycle manager shared by pointer, multi-touch,
 * computer keyboard, and Web MIDI inputs.
 */
export class NoteLifecycleController {
  private readonly backend: PianoVoiceBackend
  private readonly maxPolyphony: number
  private readonly heldSourcesByMidi = new Map<number, Set<string>>()
  private readonly sourcesToMidi = new Map<string, number>()
  private readonly sustainSources = new Set<string>()
  private readonly voices = new Map<number, ManagedVoice>()
  private readonly listeners = new Set<(snapshot: NoteLifecycleSnapshot) => void>()

  private nextVoiceId = 1
  private nextOrder = 1
  private stolenVoiceCount = 0
  private lastNoteMidi: number | null = null
  private lastVelocity: number | null = null

  constructor(backend: PianoVoiceBackend, options: NoteLifecycleOptions = {}) {
    this.backend = backend
    this.maxPolyphony = Math.max(1, options.maxPolyphony ?? 32)
  }

  get isSustainActive(): boolean {
    return this.sustainSources.size > 0
  }

  noteOn(midi: number, velocity: number, sourceId: string): number | null {
    const clampedMidi = Math.max(0, Math.min(127, Math.round(midi)))
    const clampedVel = Math.max(0, Math.min(127, Math.round(velocity)))
    if (clampedVel === 0) {
      this.noteOff(clampedMidi, sourceId)
      return null
    }

    // If this exact sourceId was holding a different note (e.g. pointer glissando), release the previous one first
    const prevMidi = this.sourcesToMidi.get(sourceId)
    if (prevMidi !== undefined && prevMidi !== clampedMidi) {
      this.noteOff(prevMidi, sourceId)
    }

    // Suppress duplicate trigger from the exact same held source (keyboard repeat guard)
    if (prevMidi === clampedMidi) {
      return null
    }

    let sources = this.heldSourcesByMidi.get(clampedMidi)
    if (!sources) {
      sources = new Set<string>()
      this.heldSourcesByMidi.set(clampedMidi, sources)
    }
    sources.add(sourceId)
    this.sourcesToMidi.set(sourceId, clampedMidi)

    // Re-striking a note that already has a sustained/held voice damps the older instance cleanly
    for (const voice of this.voices.values()) {
      if (voice.midi === clampedMidi && voice.phase !== 'releasing') {
        voice.phase = 'releasing'
        this.backend.releaseNote(voice.voiceId, true)
        this.voices.delete(voice.voiceId)
      }
    }

    // Enforce deterministic polyphony cap before allocating new voice
    while (this.voices.size >= this.maxPolyphony) {
      this.stealOneVoice()
    }

    const voiceId = this.nextVoiceId++
    const voice: ManagedVoice = {
      voiceId,
      midi: clampedMidi,
      velocity: clampedVel,
      startedOrder: this.nextOrder++,
      phase: 'held',
    }
    this.voices.set(voiceId, voice)
    this.lastNoteMidi = clampedMidi
    this.lastVelocity = clampedVel

    this.backend.triggerNote(voiceId, clampedMidi, clampedVel)
    this.emit()
    return voiceId
  }

  noteOff(midi: number, sourceId: string): void {
    const clampedMidi = Math.max(0, Math.min(127, Math.round(midi)))
    const trackedMidi = this.sourcesToMidi.get(sourceId)
    if (trackedMidi === clampedMidi) {
      this.sourcesToMidi.delete(sourceId)
    }

    const sources = this.heldSourcesByMidi.get(clampedMidi)
    if (!sources) return
    sources.delete(sourceId)

    if (sources.size > 0) {
      this.emit()
      return
    }
    this.heldSourcesByMidi.delete(clampedMidi)

    // Last holding source for this note released
    for (const voice of this.voices.values()) {
      if (voice.midi === clampedMidi && voice.phase === 'held') {
        if (this.isSustainActive) {
          voice.phase = 'sustained'
        } else {
          voice.phase = 'releasing'
          this.backend.releaseNote(voice.voiceId, false)
          this.voices.delete(voice.voiceId)
        }
      }
    }
    this.emit()
  }

  releaseSource(sourceId: string): void {
    const midi = this.sourcesToMidi.get(sourceId)
    if (midi !== undefined) {
      this.noteOff(midi, sourceId)
    }
  }

  releaseSourcesByPrefix(prefix: string): void {
    const matching: Array<[string, number]> = []
    for (const [sourceId, midi] of this.sourcesToMidi.entries()) {
      if (sourceId.startsWith(prefix)) {
        matching.push([sourceId, midi])
      }
    }
    for (const [sourceId, midi] of matching) {
      this.noteOff(midi, sourceId)
    }
    // Also release sustain sources matching this prefix
    let sustainChanged = false
    for (const s of Array.from(this.sustainSources)) {
      if (s.startsWith(prefix)) {
        this.sustainSources.delete(s)
        sustainChanged = true
      }
    }
    if (sustainChanged && !this.isSustainActive) {
      this.releaseSustainedVoices()
    }
  }

  setSustain(active: boolean, sourceId: string): void {
    const wasActive = this.isSustainActive
    if (active) {
      this.sustainSources.add(sourceId)
    } else {
      this.sustainSources.delete(sourceId)
    }
    const nowActive = this.isSustainActive
    if (wasActive && !nowActive) {
      this.releaseSustainedVoices()
    } else if (wasActive !== nowActive) {
      this.emit()
    }
  }

  private releaseSustainedVoices(): void {
    for (const voice of Array.from(this.voices.values())) {
      if (voice.phase === 'sustained') {
        voice.phase = 'releasing'
        this.backend.releaseNote(voice.voiceId, false)
        this.voices.delete(voice.voiceId)
      }
    }
    this.emit()
  }

  /**
   * Deterministic voice-stealing priority:
   * 1. Oldest releasing voice
   * 2. Oldest sustained (pedal-held) voice
   * 3. Oldest actively held voice
   */
  private stealOneVoice(): void {
    let victim: ManagedVoice | null = null
    const rank = (phase: VoicePhase): number =>
      phase === 'releasing' ? 0 : phase === 'sustained' ? 1 : 2

    for (const candidate of this.voices.values()) {
      if (!victim) {
        victim = candidate
        continue
      }
      const cRank = rank(candidate.phase)
      const vRank = rank(victim.phase)
      if (cRank < vRank || (cRank === vRank && candidate.startedOrder < victim.startedOrder)) {
        victim = candidate
      }
    }

    if (victim) {
      this.voices.delete(victim.voiceId)
      this.stolenVoiceCount++
      this.backend.releaseNote(victim.voiceId, true)
    }
  }

  allNotesOff(): void {
    this.heldSourcesByMidi.clear()
    this.sourcesToMidi.clear()
    this.sustainSources.clear()
    this.voices.clear()
    this.backend.stopAllImmediate()
    this.emit()
  }

  getActiveVoices(): readonly ManagedVoice[] {
    return Array.from(this.voices.values())
  }

  getSnapshot(): NoteLifecycleSnapshot {
    const activeNotes = new Set<number>(this.heldSourcesByMidi.keys())
    const sustainedNotes = new Set<number>()
    for (const voice of this.voices.values()) {
      if (voice.phase === 'sustained') {
        sustainedNotes.add(voice.midi)
      }
    }
    return {
      activeNotes,
      sustainedNotes,
      sustainActive: this.isSustainActive,
      activeVoiceCount: this.voices.size,
      stolenVoiceCount: this.stolenVoiceCount,
      lastNoteMidi: this.lastNoteMidi,
      lastVelocity: this.lastVelocity,
    }
  }

  subscribe(listener: (snapshot: NoteLifecycleSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    const snap = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(snap)
    }
  }
}

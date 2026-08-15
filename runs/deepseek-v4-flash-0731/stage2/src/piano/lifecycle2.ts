import { StageEngine, type StageVoice } from '../audio/stage'

/**
 * Phase 2 note lifecycle. Mirrors the Phase 1 `NoteLifecycle` surface (so the
 * keybed, computer keyboard, and MIDI adapters keep working unchanged) but
 * drives the two-layer `StageEngine`: a key on pushes a voice into every
 * enabled layer (A and B), each with its own instrument/octave/level/effects.
 * Per-layer voice ownership is preserved — voices belong to the layer that
 * sounded them.
 *
 * The controller also owns all-notes-off cleanup: blur, MIDI disconnect, and
 * unmount each silence every owned voice.
 */

export interface NoteStatus {
  /** midi note -> number of active press sources. */
  activeNotes: ReadonlyMap<number, number>
  voiceCount: number
  sustain: boolean
}

export class StageLifecycle {
  readonly engine: StageEngine
  private presses = new Map<number, number>()
  private sourceNotes = new Map<string | number, Set<number>>()
  private disposed = false
  private version = 0
  private listeners = new Set<() => void>()

  constructor(engine: StageEngine) {
    this.engine = engine
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshotVersion = (): number => this.version

  get activeMidis(): readonly number[] {
    return [...this.presses.keys()]
  }

  get status(): NoteStatus {
    return {
      activeNotes: this.presses,
      voiceCount: this.engine.voiceCount,
      sustain: this.engine.sustainInput,
    }
  }

  private emit(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  /** Push a note into every enabled layer and return the primary voice. */
  noteOn(midi: number, velocity: number, source: string | number = 'default'): StageVoice | null {
    if (this.disposed) return null
    const clamped = Math.max(1, Math.min(127, Math.round(midi)))
    const current = this.presses.get(clamped) ?? 0
    let voice: StageVoice | null = null
    if (current === 0) {
      // push into every enabled layer; each layer owns its own voices.
      voice = this.engine.noteOn('A', clamped, velocity)
      const bVoice = this.engine.noteOn('B', clamped, velocity)
      if (!voice) voice = bVoice
    }
    this.presses.set(clamped, current + 1)
    let set = this.sourceNotes.get(source)
    if (!set) {
      set = new Set()
      this.sourceNotes.set(source, set)
    }
    set.add(clamped)
    this.emit()
    return voice
  }

  noteOff(midi: number, source: string | number = 'default'): void {
    if (this.disposed) return
    const clamped = Math.max(1, Math.min(127, Math.round(midi)))
    const current = this.presses.get(clamped) ?? 0
    const set = this.sourceNotes.get(source)
    if (set) set.delete(clamped)
    if (current <= 1) {
      this.presses.delete(clamped)
      this.engine.noteOff('A', clamped)
      this.engine.noteOff('B', clamped)
    } else {
      this.presses.set(clamped, current - 1)
    }
    this.emit()
  }

  clearSource(source: string | number): void {
    if (this.disposed) return
    const set = this.sourceNotes.get(source)
    if (!set) return
    for (const midi of [...set]) this.noteOff(midi, source)
    this.sourceNotes.delete(source)
  }

  setSustain(on: boolean): void {
    this.engine.setSustain(on)
    this.emit()
  }

  allNotesOff(): void {
    if (this.disposed) return
    this.presses.clear()
    this.sourceNotes.clear()
    this.engine.allNotesOff()
    this.emit()
  }

  forceRelease(): void {
    this.engine.allNotesOff()
    this.presses.clear()
    this.sourceNotes.clear()
    this.emit()
  }

  dispose(): void {
    if (this.disposed) return
    this.engine.dispose()
    this.forceRelease()
    this.disposed = true
  }

  get isDisposed(): boolean {
    return this.disposed
  }
}

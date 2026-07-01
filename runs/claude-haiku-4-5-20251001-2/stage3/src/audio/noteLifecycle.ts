/**
 * Deterministic note lifecycle management
 * Single entry point for all note input sources: keyboard, pointer, touch, MIDI
 */

export interface NoteEvent {
  type: 'note-on' | 'note-off'
  noteNumber: number
  velocity: number
  timestamp: number
  sourceId: string // e.g., 'keyboard-40', 'pointer-button1', 'midi-channel0'
}

export interface INoteLifecycleListener {
  onNoteOn(event: NoteEvent): void
  onNoteOff(event: NoteEvent): void
  onAllNotesOff(): void
}

export class NoteLifecycleService {
  private listeners: Set<INoteLifecycleListener> = new Set()
  private activeNotes: Map<string, NoteEvent> = new Map() // sourceId -> NoteEvent
  private baseTime: number = 0
  private sustainEnabled: boolean = false

  constructor() {
    if (typeof performance !== 'undefined') {
      this.baseTime = performance.now()
    }
  }

  /**
   * Subscribe to note lifecycle events
   */
  subscribe(listener: INoteLifecycleListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Handle note-on event from any source
   * Deterministic: same note number from any source at same time produces same audible result
   */
  noteOn(noteNumber: number, velocity: number, sourceId: string): void {
    const timestamp = this.getCurrentTime()

    const event: NoteEvent = {
      type: 'note-on',
      noteNumber,
      velocity,
      timestamp,
      sourceId,
    }

    this.activeNotes.set(sourceId, event)

    for (const listener of this.listeners) {
      listener.onNoteOn(event)
    }
  }

  /**
   * Handle note-off event
   * Velocity is ignored on note-off (release behavior is independent of velocity)
   */
  noteOff(sourceId: string): void {
    const activeNote = this.activeNotes.get(sourceId)
    if (!activeNote) {
      return
    }

    const timestamp = this.getCurrentTime()
    const event: NoteEvent = {
      type: 'note-off',
      noteNumber: activeNote.noteNumber,
      velocity: activeNote.velocity,
      timestamp,
      sourceId,
    }

    this.activeNotes.delete(sourceId)

    for (const listener of this.listeners) {
      listener.onNoteOff(event)
    }
  }

  /**
   * All notes off (panic button, program change, etc.)
   */
  allNotesOff(): void {
    const sources = Array.from(this.activeNotes.keys())
    this.activeNotes.clear()

    for (const listener of this.listeners) {
      listener.onAllNotesOff()
    }

    // Also send individual note-offs for each active note
    for (const sourceId of sources) {
      // Create synthetic note-off for cleanup
      const timestamp = this.getCurrentTime()
      for (const listener of this.listeners) {
        listener.onNoteOff({
          type: 'note-off',
          noteNumber: 0, // Will be ignored
          velocity: 0,
          timestamp,
          sourceId,
        })
      }
    }
  }

  /**
   * Check if a note is currently active from a specific source
   */
  isNoteActive(sourceId: string): boolean {
    return this.activeNotes.has(sourceId)
  }

  /**
   * Get the note number for an active source
   */
  getActiveNote(sourceId: string): number | null {
    return this.activeNotes.get(sourceId)?.noteNumber ?? null
  }

  /**
   * Get current time in milliseconds from start
   */
  private getCurrentTime(): number {
    if (typeof performance !== 'undefined') {
      return performance.now() - this.baseTime
    }
    return 0
  }

  /**
   * Reset (for testing)
   */
  reset(): void {
    this.activeNotes.clear()
  }

  /**
   * Set sustain pedal state
   */
  setSustain(enabled: boolean): void {
    this.sustainEnabled = enabled
  }

  /**
   * Get sustain pedal state
   */
  isSustainEnabled(): boolean {
    return this.sustainEnabled
  }
}

import { PianoEngine } from '../audio/engine'
import type { Voice } from '../audio/types'

/**
 * The single note lifecycle. Every input path (pointer, multi-touch, computer
 * keyboard, Web MIDI) funnels through this controller, which owns the mapping
 * from input -> engine voices and tracks per-note press state so repeated and
 * overlapping notes behave deterministically.
 *
 * The controller also owns all-notes-off cleanup: blur, MIDI disconnect, and
 * unmount each silence every owned voice.
 */

export interface NoteLifecycleOptions {
  engine: PianoEngine
  onStateChange?: () => void
}

export interface NoteStatus {
  /** midi note -> number of active press sources. */
  activeNotes: ReadonlyMap<number, number>
  voiceCount: number
  sustain: boolean
}

export class NoteLifecycle {
  readonly engine: PianoEngine
  /** midi -> count of concurrent press sources (multi-touch / layered keys). */
  private presses = new Map<number, number>()
  /** source id -> set of midi notes that source currently holds. */
  private sourceNotes = new Map<string | number, Set<number>>()
  private onStateChange: (() => void) | undefined
  private disposed = false
  private version = 0
  private listeners = new Set<() => void>()

  constructor(options: NoteLifecycleOptions) {
    this.engine = options.engine
    this.onStateChange = options.onStateChange
  }

  /** subscription snapshot: a monotonic version, bumped on every change. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshotVersion = (): number => this.version

  /** a stable, immutable read of the press state for React/wire syncing. */
  get activeMidis(): readonly number[] {
    return [...this.presses.keys()]
  }

  get status(): NoteStatus {
    return {
      activeNotes: this.presses,
      voiceCount: this.engine.voiceCount,
      sustain: this.engine.isSustain,
    }
  }

  private emit(): void {
    this.version++
    this.onStateChange?.()
    for (const listener of this.listeners) listener()
  }

  /** Note on from any source. Repeated presses of the same note share one
   *  voice until all sources release it (monophonic-per-note retrigger avoided
   *  so overlapping inputs don't double-trigger). Independent sources for
   *  DIFFERENT notes each start their own voice. */
  noteOn(midi: number, velocity: number, source: string | number = 'default'): Voice | null {
    if (this.disposed) return null
    const clamped = Math.max(1, Math.min(127, Math.round(midi)))
    const current = this.presses.get(clamped) ?? 0
    // If no voice is currently sounding for this note, start one.
    const voice = current === 0 ? this.engine.noteOn(clamped, velocity) : null
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

  /** Note off from a source. The voice is released only when the last source
   *  releases the note. */
  noteOff(midi: number, source: string | number = 'default'): void {
    if (this.disposed) return
    const clamped = Math.max(1, Math.min(127, Math.round(midi)))
    const current = this.presses.get(clamped) ?? 0
    const set = this.sourceNotes.get(source)
    if (set) set.delete(clamped)
    if (current <= 1) {
      this.presses.delete(clamped)
      this.engine.noteOff(clamped)
    } else {
      this.presses.set(clamped, current - 1)
    }
    this.emit()
  }

  /** Remove a source entirely, releasing every note it held. */
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

  /** Silence everything (Panic, blur, MIDI disconnect, unmount). */
  allNotesOff(): void {
    if (this.disposed) return
    this.presses.clear()
    this.sourceNotes.clear()
    this.engine.allNotesOff()
    this.emit()
  }

  /** Release every note a source holds without regard for other sources (used
   *  on blur/disconnect when we want immediate silence). Consistent with
   *  all-notes-off semantics for that source's notes. */
  forceRelease(): void {
    this.engine.allNotesOff()
    this.presses.clear()
    this.sourceNotes.clear()
    this.emit()
  }

  /** Permanently tear down: silence every voice and stop accepting input. */
  dispose(): void {
    if (this.disposed) return
    this.forceRelease()
    this.disposed = true
  }

  get isDisposed(): boolean {
    return this.disposed
  }
}
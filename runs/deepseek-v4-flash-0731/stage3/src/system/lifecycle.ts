/**
 * Phase 3 — note lifecycle driving the whole System4 instrument.
 *
 * Mirrors the Phase 1 `NoteLifecycle` surface (so the keybed, computer
 * keyboard and MIDI adapters work unchanged) but routes every note through the
 * system's transpose/scene/zone/crossfade logic before it reaches any engine.
 * Owns all-notes-off cleanup (blur, MIDI disconnect, unmount) and Panic.
 */

import { System4 } from '../audio/system4'

export interface SystemNoteStatus {
  activeNotes: ReadonlyMap<number, number>
  voiceCount: number
  sustain: boolean
}

export class SystemLifecycle {
  readonly engine: System4
  private presses = new Map<number, number>()
  private sourceNotes = new Map<string | number, Set<number>>()
  private disposed = false
  private version = 0
  private listeners = new Set<() => void>()

  constructor(engine: System4) {
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

  get status(): SystemNoteStatus {
    return { activeNotes: this.presses, voiceCount: this.engine.voiceCount, sustain: this.engine.sustainInput }
  }

  private emit(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  noteOn(midi: number, velocity: number, source: string | number = 'default'): void {
    if (this.disposed) return
    const clamped = Math.max(1, Math.min(127, Math.round(midi)))
    const current = this.presses.get(clamped) ?? 0
    if (current === 0) this.engine.noteOn(clamped, velocity)
    this.presses.set(clamped, current + 1)
    let set = this.sourceNotes.get(source)
    if (!set) {
      set = new Set()
      this.sourceNotes.set(source, set)
    }
    set.add(clamped)
    this.emit()
  }

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

  clearSource(source: string | number): void {
    if (this.disposed) return
    const set = this.sourceNotes.get(source)
    if (!set) return
    for (const midi of set) this.noteOff(midi, source)
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

  /** Shift+Transpose Panic. */
  panic(): void {
    this.forceRelease()
    this.engine.panic()
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

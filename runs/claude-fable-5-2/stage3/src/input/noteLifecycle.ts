/** Where notes go. The piano engine implements this; tests can substitute a recorder. */
export interface NoteSink {
  noteOn(note: number, velocity: number): void
  noteOff(note: number): void
  setSustain(down: boolean): void
  allNotesOff(): void
}

export interface LifecycleSnapshot {
  /** Notes with at least one holder, ascending. */
  held: readonly number[]
  sustain: boolean
}

export interface LifecycleOptions {
  lowNote: number
  highNote: number
}

/**
 * The single note lifecycle shared by every input: pointer, touch, computer keyboard,
 * and Web MIDI all call `press` / `release` here and nothing else.
 *
 * A "source" is whatever is physically holding a key: `pointer:7`, `kbd:KeyA`,
 * `midi:input-1:0`. Tracking holders per note gives the rules that make input dependable:
 *  - the same source pressing the same note twice is ignored (key repeat, duplicate events);
 *  - a second source pressing an already-held note re-strikes it;
 *  - a note is released only when its last holder lets go;
 *  - a source can be dropped wholesale (pointer cancelled, MIDI device unplugged).
 */
export class NoteLifecycle {
  private readonly sink: NoteSink
  private readonly lowNote: number
  private readonly highNote: number
  private readonly holders = new Map<number, Set<string>>()
  private readonly sustainSources = new Set<string>()
  private listeners = new Set<() => void>()
  private snapshot: LifecycleSnapshot = { held: [], sustain: false }

  constructor(sink: NoteSink, options: LifecycleOptions) {
    this.sink = sink
    this.lowNote = options.lowNote
    this.highNote = options.highNote
  }

  getSnapshot = (): LifecycleSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get listenerCount(): number {
    return this.listeners.size
  }

  inRange(note: number): boolean {
    return Number.isInteger(note) && note >= this.lowNote && note <= this.highNote
  }

  isHeld(note: number): boolean {
    return this.holders.has(note)
  }

  /** Returns true when the press struck a note. */
  press(source: string, note: number, velocity: number): boolean {
    if (!this.inRange(note)) return false
    let set = this.holders.get(note)
    if (set?.has(source)) return false
    if (!set) {
      set = new Set()
      this.holders.set(note, set)
    }
    set.add(source)
    this.sink.noteOn(note, clampVelocity(velocity))
    this.publish()
    return true
  }

  release(source: string, note: number): void {
    const set = this.holders.get(note)
    if (!set || !set.delete(source)) return
    if (set.size > 0) return
    this.holders.delete(note)
    this.sink.noteOff(note)
    this.publish()
  }

  /** Release everything a source (or every source sharing a prefix) is holding, including sustain. */
  releaseSource(sourceOrPrefix: string): void {
    const matches = (source: string) => source === sourceOrPrefix || source.startsWith(`${sourceOrPrefix}:`)
    for (const [note, set] of Array.from(this.holders)) {
      for (const source of Array.from(set)) {
        if (matches(source)) this.release(source, note)
      }
    }
    for (const source of Array.from(this.sustainSources)) {
      if (matches(source)) this.setSustain(source, false)
    }
  }

  /** Notes a source is holding right now. */
  notesHeldBy(source: string): number[] {
    const notes: number[] = []
    for (const [note, set] of this.holders) if (set.has(source)) notes.push(note)
    return notes
  }

  /** Sustain is down while any source holds it down. */
  setSustain(source: string, down: boolean): void {
    const before = this.sustainSources.size > 0
    if (down) this.sustainSources.add(source)
    else this.sustainSources.delete(source)
    const after = this.sustainSources.size > 0
    if (before === after) return
    this.sink.setSustain(after)
    this.publish()
  }

  get sustain(): boolean {
    return this.sustainSources.size > 0
  }

  isSustainHeldBy(source: string): boolean {
    return this.sustainSources.has(source)
  }

  /** Drop every holder and the pedal, and tell the sink to stop every voice. */
  allNotesOff(): void {
    this.holders.clear()
    this.sustainSources.clear()
    this.sink.allNotesOff()
    this.publish()
  }

  private publish(): void {
    const held = [...this.holders.keys()].sort((a, b) => a - b)
    const sustain = this.sustainSources.size > 0
    const previous = this.snapshot
    if (
      previous.sustain === sustain &&
      previous.held.length === held.length &&
      previous.held.every((note, index) => note === held[index])
    ) {
      return
    }
    this.snapshot = { held, sustain }
    for (const listener of this.listeners) listener()
  }
}

/** Velocities are 0..1. Anything at or below zero becomes the softest audible strike. */
export function clampVelocity(velocity: number): number {
  if (!Number.isFinite(velocity)) return 0.7
  return Math.min(1, Math.max(0.02, velocity))
}

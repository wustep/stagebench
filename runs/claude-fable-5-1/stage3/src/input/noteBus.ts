/**
 * NoteBus: the single note lifecycle every input feeds (pointer, touch, computer keyboard, MIDI,
 * on-screen sustain). It tracks which sources hold which notes so overlapping inputs are
 * deterministic: a note-on from any source (re)triggers the sink, a note-off only reaches the sink
 * when no source still holds the note. Sustain is the union of all sustain sources.
 */
export type NoteSource = 'pointer' | 'keyboard' | 'midi' | 'ui' | 'test'

export interface NoteSink {
  noteOn(midi: number, velocity: number): unknown
  noteOff(midi: number): unknown
  setSustain(on: boolean): unknown
  allNotesOff(): unknown
}

export interface NoteBusState {
  held: ReadonlyMap<number, ReadonlySet<NoteSource>>
  sustain: boolean
  sustainSources: ReadonlySet<NoteSource>
  lastEvent: string | null
}

export interface NoteBusOptions {
  lowest: number
  highest: number
}

export class NoteBus {
  private held = new Map<number, Set<NoteSource>>()
  private sustainSources = new Set<NoteSource>()
  private listeners = new Set<() => void>()
  private snapshot: NoteBusState
  private lastEvent: string | null = null

  constructor(private sink: NoteSink, private readonly range: NoteBusOptions) {
    this.snapshot = this.buildSnapshot()
  }

  /** Replaces the sink (services wire the Performer after the controller that it needs exist). */
  setSink(sink: NoteSink) {
    this.sink = sink
  }

  private buildSnapshot(): NoteBusState {
    const held = new Map<number, ReadonlySet<NoteSource>>()
    for (const [midi, sources] of this.held) held.set(midi, new Set(sources))
    return { held, sustain: this.sustainSources.size > 0, sustainSources: new Set(this.sustainSources), lastEvent: this.lastEvent }
  }

  private emit(event: string) {
    this.lastEvent = event
    this.snapshot = this.buildSnapshot()
    this.listeners.forEach((l) => l())
  }

  getState = (): NoteBusState => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  inRange(midi: number): boolean {
    return Number.isInteger(midi) && midi >= this.range.lowest && midi <= this.range.highest
  }

  isHeld(midi: number): boolean {
    return this.held.has(midi)
  }

  heldNotes(): number[] {
    return [...this.held.keys()].sort((a, b) => a - b)
  }

  isSustain(): boolean {
    return this.sustainSources.size > 0
  }

  noteOn(midi: number, velocity: number, source: NoteSource): boolean {
    if (!this.inRange(midi)) return false
    const v = Math.min(127, Math.max(1, Math.round(velocity)))
    let sources = this.held.get(midi)
    if (!sources) {
      sources = new Set()
      this.held.set(midi, sources)
    }
    sources.add(source)
    this.sink.noteOn(midi, v)
    this.emit(`on ${midi} v${v} (${source})`)
    return true
  }

  noteOff(midi: number, source: NoteSource): boolean {
    const sources = this.held.get(midi)
    if (!sources || !sources.has(source)) return false
    sources.delete(source)
    if (sources.size === 0) {
      this.held.delete(midi)
      this.sink.noteOff(midi)
    }
    this.emit(`off ${midi} (${source})`)
    return true
  }

  setSustain(source: NoteSource, on: boolean): void {
    const before = this.sustainSources.size > 0
    if (on) this.sustainSources.add(source)
    else this.sustainSources.delete(source)
    const after = this.sustainSources.size > 0
    if (before !== after) this.sink.setSustain(after)
    this.emit(`sustain ${on ? 'on' : 'off'} (${source})`)
  }

  /** Releases every note and sustain held by one source (e.g. keyboard blur, MIDI disconnect). */
  releaseSource(source: NoteSource): void {
    for (const midi of Array.from(this.held.keys())) this.noteOff(midi, source)
    if (this.sustainSources.has(source)) this.setSustain(source, false)
    this.emit(`release-all (${source})`)
  }

  /** Releases everything from every source and tells the sink to silence every owned voice. */
  releaseAll(): void {
    this.held.clear()
    this.sustainSources.clear()
    this.sink.allNotesOff()
    this.emit('all-notes-off')
  }
}

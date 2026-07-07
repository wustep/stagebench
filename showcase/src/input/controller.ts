import { PianoEngine, type AllNotesOffReason } from '../audio/engine'
import { VARIANT } from '../model/variant'

export type NoteSource = 'pointer' | 'keyboard' | 'midi' | 'file'

/**
 * Unified note lifecycle front door. Pointer, touch, computer keyboard and
 * MIDI all call the same noteOn/noteOff/pedal path; the controller keeps
 * the engine and the visible key-press state in sync and owns per-source
 * cleanup (blur, MIDI disconnect, unmount) plus the functional Panic path.
 */
export class InstrumentController {
  readonly engine: PianoEngine
  private held = new Map<number, Set<NoteSource>>()
  private listeners = new Set<() => void>()
  private batchDepth = 0
  private pendingEmit = false

  constructor(engine: PianoEngine) {
    this.engine = engine
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    if (this.batchDepth > 0) {
      this.pendingEmit = true
      return
    }
    for (const listener of this.listeners) listener()
  }

  /** Coalesces listener notifications across a burst of note events (MIDI
   *  file chords, per-source release sweeps): every subscriber — 73 keybed
   *  keys plus the pedal hooks — re-reads its snapshot on each emit, so a
   *  ten-note chord emitting once instead of ten times is a real saving. */
  batch(run: () => void): void {
    this.batchDepth += 1
    try {
      run()
    } finally {
      this.batchDepth -= 1
      if (this.batchDepth === 0 && this.pendingEmit) {
        this.pendingEmit = false
        for (const listener of this.listeners) listener()
      }
    }
  }

  isNoteHeld(midi: number): boolean {
    return this.held.has(midi)
  }

  heldNotes(): number[] {
    return [...this.held.keys()]
  }

  noteOn(midi: number, velocity: number, source: NoteSource): void {
    if (midi < VARIANT.keyboard.firstMidi || midi > VARIANT.keyboard.lastMidi) return
    const sources = this.held.get(midi)
    if (sources) {
      sources.add(source)
    } else {
      this.held.set(midi, new Set([source]))
    }
    this.engine.noteOn(midi, velocity)
    this.emit()
  }

  noteOff(midi: number, source: NoteSource): void {
    const sources = this.held.get(midi)
    if (!sources || !sources.has(source)) return
    sources.delete(source)
    if (sources.size > 0) return
    this.held.delete(midi)
    this.engine.noteOff(midi)
    this.emit()
  }

  /** Damper pedal — boolean (space bar) or continuous 0..1 (MIDI CC64 half-pedal). */
  setSustain(value: boolean | number): void {
    this.engine.ensureStarted()
    this.engine.setSustain(value)
    this.emit()
  }

  isSustainDown(): boolean {
    return this.engine.isSustainDown()
  }

  setSostenuto(down: boolean): void {
    this.engine.ensureStarted()
    this.engine.setSostenuto(down)
    this.emit()
  }

  isSostenutoDown(): boolean {
    return this.engine.isSostenutoDown()
  }

  setSoft(down: boolean): void {
    this.engine.ensureStarted()
    this.engine.setSoft(down)
    this.emit()
  }

  isSoftDown(): boolean {
    return this.engine.isSoftDown()
  }

  /** Pitch stick input: ±2 semitone bend on sounding piano voices. No
   *  listener emit: no controller subscriber reads bend state (the stick's
   *  visual position lives in the presentation store), and bend streams
   *  arrive at pointer/MIDI rates — waking all 73 keybed subscribers plus
   *  the pedal hooks per tick was pure snapshot-read churn. */
  setPitchBend(semitones: number): void {
    this.engine.setPitchBend(semitones)
  }

  /** Releases every note owned by one source (e.g. keyboard blur). */
  releaseSource(source: NoteSource): void {
    this.batch(() => {
      for (const [midi, sources] of [...this.held]) {
        if (sources.has(source)) this.noteOff(midi, source)
      }
    })
  }

  /** Panic panel button: immediate all-notes-off through the same engine path. */
  panic(): void {
    this.allNotesOff('panic')
  }

  /** Cleanup path shared by blur/MIDI-disconnect/unmount and Panic. */
  allNotesOff(reason: AllNotesOffReason): void {
    this.held.clear()
    this.engine.allNotesOff(reason)
    this.emit()
  }

  dispose(): void {
    this.held.clear()
    this.engine.dispose()
  }
}

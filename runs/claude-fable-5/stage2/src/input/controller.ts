import { PianoEngine, type AllNotesOffReason } from '../audio/engine'
import { VARIANT } from '../model/variant'

export type NoteSource = 'pointer' | 'keyboard' | 'midi'

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

  constructor(engine: PianoEngine) {
    this.engine = engine
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
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

  /** Pitch stick input: ±2 semitone bend on sounding piano voices. */
  setPitchBend(semitones: number): void {
    this.engine.setPitchBend(semitones)
    this.emit()
  }

  /** Releases every note owned by one source (e.g. keyboard blur). */
  releaseSource(source: NoteSource): void {
    for (const [midi, sources] of [...this.held]) {
      if (sources.has(source)) this.noteOff(midi, source)
    }
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

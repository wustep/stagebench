import { PianoEngine } from '../audio/engine'
import { VARIANT } from '../model/variant'

export type NoteSource = 'pointer' | 'keyboard' | 'midi'

/**
 * Unified note lifecycle front door. Pointer, touch, computer keyboard and
 * MIDI all call the same noteOn/noteOff/setSustain path; the controller keeps
 * the engine and the visible key-press state in sync and owns per-source
 * cleanup (blur, MIDI disconnect, unmount).
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

  setSustain(down: boolean): void {
    this.engine.ensureStarted()
    this.engine.setSustain(down)
    this.emit()
  }

  isSustainDown(): boolean {
    return this.engine.isSustainDown()
  }

  /** Releases every note owned by one source (e.g. keyboard blur). */
  releaseSource(source: NoteSource): void {
    for (const [midi, sources] of [...this.held]) {
      if (sources.has(source)) this.noteOff(midi, source)
    }
  }

  /** Internal cleanup path — not wired to any visible panel button. */
  allNotesOff(reason: 'blur' | 'midi-disconnect' | 'unmount' | 'input-cleanup'): void {
    this.held.clear()
    this.engine.allNotesOff(reason)
    this.emit()
  }

  dispose(): void {
    this.held.clear()
    this.engine.dispose()
  }
}

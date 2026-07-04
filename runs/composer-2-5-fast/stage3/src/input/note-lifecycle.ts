import { PianoEngine } from '../audio/engine'

export interface NoteLifecycleCallbacks {
  onKeyDown?: (midi: number) => void
  onKeyUp?: (midi: number) => void
}

export class NoteLifecycle {
  private pressedKeys = new Set<number>()
  private computerKeysHeld = new Set<string>()
  private engine: PianoEngine
  private callbacks: NoteLifecycleCallbacks

  constructor(engine: PianoEngine, callbacks: NoteLifecycleCallbacks = {}) {
    this.engine = engine
    this.callbacks = callbacks
  }

  getPressedCount(): number {
    return this.pressedKeys.size
  }

  getPressedKeys(): ReadonlySet<number> {
    return this.pressedKeys
  }

  isPressed(midi: number): boolean {
    return this.pressedKeys.has(midi)
  }

  pointerDown(midi: number, velocity = 100): void {
    if (this.pressedKeys.has(midi)) {
      this.engine.noteOn(midi, velocity)
      return
    }
    this.pressedKeys.add(midi)
    this.engine.noteOn(midi, velocity)
    this.callbacks.onKeyDown?.(midi)
  }

  pointerUp(midi: number): void {
    if (!this.pressedKeys.has(midi)) return
    this.pressedKeys.delete(midi)
    this.engine.noteOff(midi)
    this.callbacks.onKeyUp?.(midi)
  }

  pointerCancel(midi: number): void {
    this.pointerUp(midi)
  }

  pointerCancelAll(): void {
    for (const midi of [...this.pressedKeys]) {
      this.pointerUp(midi)
    }
  }

  computerKeyDown(code: string, midi: number, velocity = 100): void {
    if (this.computerKeysHeld.has(code)) return
    this.computerKeysHeld.add(code)
    this.pointerDown(midi, velocity)
  }

  computerKeyUp(code: string, midi: number): void {
    if (!this.computerKeysHeld.has(code)) return
    this.computerKeysHeld.delete(code)
    this.pointerUp(midi)
  }

  computerKeyCancelAll(): void {
    this.computerKeysHeld.clear()
    this.pointerCancelAll()
  }

  midiNoteOn(midi: number, velocity: number): void {
    this.pointerDown(midi, velocity)
  }

  midiNoteOff(midi: number): void {
    this.pointerUp(midi)
  }

  setSustain(on: boolean): void {
    this.engine.setSustain(on)
  }

  blurCleanup(): void {
    this.computerKeyCancelAll()
    this.engine.allNotesOff()
  }

  dispose(): void {
    this.blurCleanup()
    this.engine.dispose()
  }
}

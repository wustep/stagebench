export const COMPUTER_KEY_MAP: Readonly<Record<string, number>> = Object.freeze({
  a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66,
  g: 67, y: 68, h: 69, u: 70, j: 71, k: 72,
  o: 73, l: 74, p: 75, ';': 76, "'": 77,
})

export interface NoteInputTarget {
  noteOn(midi: number, velocity: number): void
  noteOff(midi: number): void
}

export class ComputerKeyboardInput {
  private held = new Map<string, number>()

  constructor(private readonly target: NoteInputTarget) {}

  keyDown(rawKey: string, repeat: boolean) {
    const key = rawKey.toLowerCase()
    const midi = COMPUTER_KEY_MAP[key]
    if (midi === undefined || repeat || this.held.has(key)) return false
    this.held.set(key, midi)
    this.target.noteOn(midi, 104)
    return true
  }

  keyUp(rawKey: string) {
    const key = rawKey.toLowerCase()
    const midi = this.held.get(key)
    if (midi === undefined) return false
    this.held.delete(key)
    this.target.noteOff(midi)
    return true
  }

  releaseAll() {
    for (const midi of this.held.values()) this.target.noteOff(midi)
    this.held.clear()
  }

  heldNotes() { return [...this.held.values()] }
}

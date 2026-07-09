import type { PlayablePianoEngine } from './piano'

export const COMPUTER_KEY_MAP: Record<string, number> = {
  KeyA: 48, KeyW: 49, KeyS: 50, KeyE: 51, KeyD: 52, KeyF: 53, KeyT: 54, KeyG: 55,
  KeyY: 56, KeyH: 57, KeyU: 58, KeyJ: 59, KeyK: 60, KeyO: 61, KeyL: 62, KeyP: 63,
  Semicolon: 64, Quote: 65, BracketRight: 66, Backslash: 67,
  KeyZ: 60, KeyX: 62, KeyC: 64, KeyV: 65, KeyB: 67, KeyN: 69, KeyM: 71, Comma: 72,
}

export interface MidiMessageLike {
  data: ArrayLike<number>
}

export interface MidiInputLike {
  id: string
  name?: string | null
  state?: string
  onmidimessage: ((event: MidiMessageLike) => void) | null
}

export interface MidiAccessLike {
  inputs: Iterable<MidiInputLike> | { values(): IterableIterator<MidiInputLike> }
  onstatechange: ((event: { port?: MidiInputLike }) => void) | null
}

export class PianoInputController {
  private activeComputerKeys = new Set<string>()
  private activePointers = new Map<number, number>()
  private midiCounter = 0
  private midiQueues = new Map<number, string[]>()
  private midiAccess: MidiAccessLike | null = null

  constructor(
    private readonly engine: PlayablePianoEngine,
    private readonly onMidiStateChange?: (inputs: MidiInputLike[]) => void,
  ) {}

  pointerDown(pointerId: number, note: number, velocity = 0.78): void {
    if (this.activePointers.has(pointerId)) this.pointerUp(pointerId)
    this.activePointers.set(pointerId, note)
    this.engine.noteOn(note, velocity, `pointer:${pointerId}`)
  }

  pointerUp(pointerId: number): void {
    if (!this.activePointers.has(pointerId)) return
    this.activePointers.delete(pointerId)
    this.engine.noteOff(`pointer:${pointerId}`)
  }

  keyDown(code: string, repeat = false): boolean {
    if (code === 'Space') {
      if (repeat || this.activeComputerKeys.has(code)) return true
      this.activeComputerKeys.add(code)
      this.engine.setSustain(true)
      return true
    }
    const note = COMPUTER_KEY_MAP[code]
    if (note === undefined) return false
    if (repeat || this.activeComputerKeys.has(code)) return true
    this.activeComputerKeys.add(code)
    this.engine.noteOn(note, 0.74, `keyboard:${code}`)
    return true
  }

  keyUp(code: string): boolean {
    if (!this.activeComputerKeys.has(code)) return code in COMPUTER_KEY_MAP || code === 'Space'
    this.activeComputerKeys.delete(code)
    if (code === 'Space') this.engine.setSustain(false)
    else this.engine.noteOff(`keyboard:${code}`)
    return true
  }

  midiMessage(data: ArrayLike<number>): void {
    const status = data[0] ?? 0
    const type = status & 0xf0
    const note = data[1] ?? 0
    const value = data[2] ?? 0
    if (type === 0x90 && value > 0) {
      const token = `midi:${note}:${++this.midiCounter}`
      const queue = this.midiQueues.get(note) ?? []
      queue.push(token)
      this.midiQueues.set(note, queue)
      this.engine.noteOn(note, value / 127, token)
    } else if (type === 0x80 || (type === 0x90 && value === 0)) {
      const queue = this.midiQueues.get(note)
      const token = queue?.shift()
      if (token) this.engine.noteOff(token)
      if (queue?.length === 0) this.midiQueues.delete(note)
    } else if (type === 0xb0 && note === 64) {
      this.engine.setSustain(value >= 64)
    } else if (type === 0xb0 && (note === 120 || note === 123)) {
      this.allNotesOff()
    }
  }

  attachMidiAccess(access: MidiAccessLike): void {
    this.detachMidiAccess()
    this.midiAccess = access
    this.bindMidiInputs(access)
    access.onstatechange = () => {
      this.allNotesOff()
      this.bindMidiInputs(access)
      this.onMidiStateChange?.(this.getInputs(access).filter((input) => input.state !== 'disconnected'))
    }
    this.onMidiStateChange?.(this.getInputs(access).filter((input) => input.state !== 'disconnected'))
  }

  detachMidiAccess(): void {
    if (!this.midiAccess) return
    for (const input of this.getInputs(this.midiAccess)) input.onmidimessage = null
    this.midiAccess.onstatechange = null
    this.midiAccess = null
    this.allNotesOff()
  }

  allNotesOff(): void {
    this.activeComputerKeys.clear()
    this.activePointers.clear()
    this.midiQueues.clear()
    this.engine.allNotesOff()
  }

  dispose(): void {
    this.detachMidiAccess()
    this.engine.dispose()
  }

  private bindMidiInputs(access: MidiAccessLike): void {
    for (const input of this.getInputs(access)) {
      input.onmidimessage = (event) => this.midiMessage(event.data)
    }
  }

  private getInputs(access: MidiAccessLike): MidiInputLike[] {
    const inputs = access.inputs
    const values = (inputs as { values?: () => IterableIterator<MidiInputLike> }).values
    if (typeof values === 'function') return [...values.call(inputs)]
    return [...(inputs as Iterable<MidiInputLike>)]
  }
}

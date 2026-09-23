import type { PianoEngine } from '../audio/engine'
import { KEY_CODE_TO_MIDI, KEYBOARD_VELOCITY, SUSTAIN_KEY_CODE } from './keymap'

export type NoteSource = 'pointer' | 'keyboard' | 'midi'

function isPanelTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('[data-panel-control]'))
}

/**
 * One note lifecycle shared by pointer, computer keyboard, and MIDI.
 * A note stays on until every source that turned it on has released it.
 * Keyboard auto-repeat is ignored. Blur and disconnect call allNotesOff.
 */
export class InstrumentController {
  private readonly held = new Map<number, Set<NoteSource>>()
  private readonly keyCodes = new Set<string>()
  private sustainKey = false
  private readonly listeners = new Set<() => void>()
  private attached: (() => void) | null = null

  constructor(private readonly engine: PianoEngine) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  isNoteHeld(midi: number): boolean {
    return (this.held.get(midi)?.size ?? 0) > 0
  }

  heldNotes(): number[] {
    return [...this.held.keys()]
  }

  noteOn(midi: number, velocity: number, source: NoteSource) {
    const sources = this.held.get(midi) ?? new Set<NoteSource>()
    const already = sources.has(source)
    if (already && source !== 'midi') return
    sources.add(source)
    this.held.set(midi, sources)
    this.engine.noteOn(midi, velocity)
    this.emit()
  }

  noteOff(midi: number, source: NoteSource) {
    const sources = this.held.get(midi)
    if (!sources || !sources.has(source)) return
    sources.delete(source)
    if (sources.size === 0) {
      this.held.delete(midi)
      this.engine.noteOff(midi)
    }
    this.emit()
  }

  setSustain(down: boolean) {
    this.engine.setSustain(down)
    this.emit()
  }

  allNotesOff(reason: 'blur' | 'disconnect' | 'unmount' | 'midi' | 'input-cleanup' = 'input-cleanup') {
    void reason
    this.held.clear()
    this.keyCodes.clear()
    this.sustainKey = false
    this.engine.setSustain(false)
    this.engine.allNotesOff()
    this.emit()
  }

  attachWindow(target: Window) {
    this.detachWindow()
    const onKeyDown = (event: KeyboardEvent) => this.onKey(event, true)
    const onKeyUp = (event: KeyboardEvent) => this.onKey(event, false)
    const onBlur = () => this.allNotesOff('blur')
    target.addEventListener('keydown', onKeyDown)
    target.addEventListener('keyup', onKeyUp)
    target.addEventListener('blur', onBlur)
    this.attached = () => {
      target.removeEventListener('keydown', onKeyDown)
      target.removeEventListener('keyup', onKeyUp)
      target.removeEventListener('blur', onBlur)
    }
    return () => this.detachWindow()
  }

  detachWindow() {
    this.attached?.()
    this.attached = null
  }

  private onKey(event: KeyboardEvent, down: boolean) {
    if (isPanelTarget(event.target)) return
    if (event.code === SUSTAIN_KEY_CODE) {
      event.preventDefault()
      if (down) {
        if (event.repeat || this.sustainKey) return
        this.sustainKey = true
        this.setSustain(true)
        return
      }
      if (!this.sustainKey) return
      this.sustainKey = false
      this.setSustain(false)
      return
    }
    const midi = KEY_CODE_TO_MIDI[event.code]
    if (midi === undefined) return
    if (down) {
      if (event.repeat || this.keyCodes.has(event.code)) return
      event.preventDefault()
      this.keyCodes.add(event.code)
      this.noteOn(midi, KEYBOARD_VELOCITY, 'keyboard')
      return
    }
    if (!this.keyCodes.has(event.code)) return
    this.keyCodes.delete(event.code)
    this.noteOff(midi, 'keyboard')
  }
}

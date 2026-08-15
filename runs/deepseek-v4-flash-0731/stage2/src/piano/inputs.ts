import type { NoteLifecycle } from './lifecycle'

/**
 * Input adapters for the basic piano. Each owns its own event listeners,
 * exposes attach/detach for clean setup/teardown, and reports its own state
 * (repeat suppression, MIDI permission) so tests and the UI stay honest.
 */

export const SUSTAIN_KEY = ' '
// Computer-key mapping spread across two octaves (C4..B5). Value objects are
// frozen static tables (allowed: Record lookup, not Set/Map iteration).
export const KEY_TO_MIDI: Record<string, number> = {
  z: 60, s: 61, x: 62, d: 63, c: 64, v: 65, g: 66, b: 67, h: 68, n: 69, j: 70, m: 71,
  q: 72, '2': 73, w: 74, '3': 75, e: 76, r: 77, '5': 78, t: 79, '6': 80, y: 81, '7': 82, u: 83,
}
export const MIDI_TO_KEY: Record<number, string> = Object.fromEntries(
  Object.entries(KEY_TO_MIDI).map(([key, midi]) => [midi, key]),
)

export interface KeyboardOptions {
  lifecycle: NoteLifecycle
  /** keys -> note; defaults to the standard two-octave map. */
  keyToMidi?: Record<string, number>
  /** key that toggles sustain; defaults to Space. */
  sustainKey?: string
  /** called whenever a mapped key is pressed or released. */
  onActivity?(): void
}

export class ComputerKeyboard {
  private lifecycle: NoteLifecycle
  private keyToMidi: Record<string, number>
  private sustainKey: string
  private onActivity: (() => void) | undefined
  /** keys currently held down (repeat suppression). */
  private heldKeys = new Set<string>()
  private attached = false
  private handleKeyDown: (event: KeyboardEvent) => void
  private handleKeyUp: (event: KeyboardEvent) => void
  private handleBlur: () => void
  private source = 'keyboard'

  constructor(options: KeyboardOptions) {
    this.lifecycle = options.lifecycle
    this.keyToMidi = options.keyToMidi ?? KEY_TO_MIDI
    this.sustainKey = options.sustainKey ?? SUSTAIN_KEY
    this.onActivity = options.onActivity
    this.handleKeyDown = (event) => this.onDown(event)
    this.handleKeyUp = (event) => this.onUp(event)
    this.handleBlur = () => this.onBlur()
  }

  attach(target: Window = window): void {
    if (this.attached) return
    this.attached = true
    target.addEventListener('keydown', this.handleKeyDown)
    target.addEventListener('keyup', this.handleKeyUp)
    target.addEventListener('blur', this.handleBlur)
  }

  detach(): void {
    if (!this.attached) return
    this.attached = false
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    window.removeEventListener('blur', this.handleBlur)
    this.onBlur() // release anything still held
  }

  /** keys held right now (for tests / UI). */
  get heldKeysSnapshot(): string[] {
    return [...this.heldKeys]
  }

  private onDown(event: KeyboardEvent): void {
    const key = event.key
    if (key === this.sustainKey) {
      event.preventDefault()
      if (!this.heldKeys.has(key)) {
        this.heldKeys.add(key)
        this.lifecycle.setSustain(true)
        this.onActivity?.()
      }
      return
    }
    const midi = this.keyToMidi[key]
    if (midi === undefined) return
    event.preventDefault()
    // repeat suppression: ignore auto-repeat keydown while the key is held
    if (this.heldKeys.has(key)) return
    this.heldKeys.add(key)
    this.lifecycle.noteOn(midi, 0.8, this.source)
    this.onActivity?.()
  }

  private onUp(event: KeyboardEvent): void {
    const key = event.key
    if (key === this.sustainKey) {
      if (this.heldKeys.delete(key)) this.lifecycle.setSustain(false)
      this.onActivity?.()
      return
    }
    if (!this.heldKeys.delete(key)) return
    this.releaseKey(key)
  }

  private releaseKey(key: string): void {
    const midi = this.keyToMidi[key]
    if (midi === undefined) return
    this.lifecycle.noteOff(midi, this.source)
  }

  private onBlur(): void {
    if (this.heldKeys.size === 0) return
    // release everything on window blur, then silence every owned voice
    for (const key of [...this.heldKeys]) {
      this.heldKeys.delete(key)
      this.clearKey(key)
    }
    this.lifecycle.forceRelease()
  }

  private clearKey(key: string): void {
    if (key === this.sustainKey) {
      this.lifecycle.setSustain(false)
      return
    }
    const midi = this.keyToMidi[key]
    if (midi === undefined) return
    this.lifecycle.noteOff(midi, this.source)
  }

  /** Release a specific held key (used by tests/modal focus changes). */
  release(key: string): void {
    if (!this.heldKeys.delete(key)) return
    this.clearKey(key)
  }
}

export type MidiPermission = 'granted' | 'denied' | null | undefined

export interface MidiInputOptions {
  lifecycle: NoteLifecycle
  /** returns a MIDI access promise; tests supply a stub. Defaults to real Web MIDI. */
  requestAccess?: () => Promise<MidiAccess | 'unsupported'>
  onPermissionChange?(permission: MidiPermission): void
  onActivity?(): void
}

export interface MidiAccess {
  onstatechange?: ((event: MidiInputStateEvent) => void) | null
  inputs(): MidiInput[]
}

export interface MidiInput {
  onmidimessage?: ((event: MidiMessageEvent) => void) | null
}

export interface MidiInputStateEvent {
  port: { connection: 'open' | 'closed' }
}

export interface MidiMessageEvent {
  data: Uint8Array | readonly number[]
}

const MIDI_NOTE_ON = 0x90
const MIDI_NOTE_OFF = 0x80
const MIDI_CC = 0xb0
const CC_SUSTAIN = 64

export class MidiInputBinding {
  private lifecycle: NoteLifecycle
  private requestAccess: () => Promise<MidiAccess | 'unsupported'>
  private onPermissionChange: MidiInputOptions['onPermissionChange']
  private onActivity: MidiInputOptions['onActivity']
  private source = 'midi'
  private access: MidiAccess | 'unsupported' | null = null
  private _permission: MidiPermission = null
  private disposed = false
  /** midi note -> keys held by midi (for sustain-safe note off). */
  private held = new Set<number>()

  constructor(options: MidiInputOptions) {
    this.lifecycle = options.lifecycle
    this.requestAccess =
      options.requestAccess ??
      (async () => {
        const nav = window.navigator as Navigator & { requestMIDIAccess?: () => Promise<MidiAccess> }
        if (!nav.requestMIDIAccess) return 'unsupported'
        try {
          const access = (await nav.requestMIDIAccess()) as unknown as MidiAccess
          return access
        } catch {
          return 'unsupported'
        }
      })
    this.onPermissionChange = options.onPermissionChange
    this.onActivity = options.onActivity
  }

  /** Begin requesting MIDI access. Returns the resulting permission. */
  async connect(): Promise<MidiPermission> {
    const access = await this.requestAccess()
    this.access = access
    if (access === 'unsupported') {
      this._permission = 'denied'
      this.onPermissionChange?.(this._permission)
      return this._permission
    }
    access.onstatechange = (event) => {
      if (event.port.connection === 'closed') this.lifecycle.forceRelease()
    }
    // bind to every input, guard against nulls
    for (const input of access.inputs() ?? []) {
      input.onmidimessage = (event) => this.onMessage(event)
    }
    this._permission = 'granted'
    this.onPermissionChange?.(this._permission)
    return this._permission
  }

  /** Simulate a permission-denied state (for truthful UI/test). */
  deny(): void {
    this._permission = 'denied'
    this.onPermissionChange?.(this._permission)
  }

  get permission(): MidiPermission {
    return this._permission
  }

  get isConnected(): boolean {
    return this.access !== null && this.access !== 'unsupported'
  }

  private onMessage(event: MidiMessageEvent): void {
    if (this.disposed) return
    const data = Array.from(event.data ?? [])
    if (data.length < 3) return
    const [status, note, value] = data
    const type = status & 0xf0
    if (type === MIDI_NOTE_ON || type === MIDI_NOTE_OFF) {
      const velocity = value
      if (type === MIDI_NOTE_ON && velocity > 0) {
        if (!this.held.has(note)) this.held.add(note)
        this.lifecycle.noteOn(note, velocity / 127, this.source)
      } else {
        if (this.held.delete(note)) this.lifecycle.noteOff(note, this.source)
      }
      this.onActivity?.()
    } else if (type === MIDI_CC && note === CC_SUSTAIN) {
      this.lifecycle.setSustain(value >= 64)
      this.onActivity?.()
    }
  }

  dispose(): void {
    this.disposed = true
  }
}
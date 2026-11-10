import type { MidiAccessLike, MidiBoundary, MidiInputLike, MidiMessageEventLike } from '../platform/types'
import type { NoteLifecycle } from './noteLifecycle'

/**
 * unsupported — the browser has no Web MIDI
 * idle        — supported, not requested yet
 * requesting  — waiting for the browser's permission prompt
 * connected   — permission granted and at least one input is attached
 * no-inputs   — permission granted but nothing is plugged in (or everything was unplugged)
 * denied      — the user or browser refused access
 * error       — the request failed for another reason
 */
export type MidiStatus = 'unsupported' | 'idle' | 'requesting' | 'connected' | 'no-inputs' | 'denied' | 'error'

export interface MidiSnapshot {
  status: MidiStatus
  detail: string
  inputs: readonly string[]
}

export interface MidiOptions {
  /** Called when a note arrives, so the audio engine can be woken. */
  onActivity?: () => void
  /** Called for the modulation wheel (CC1) and the control / expression pedal (CC11), value 0..127. */
  onController?: (controller: number, value: number) => void
}

const MOD_WHEEL_CC = 1
const CONTROL_PEDAL_CC = 11
const SUSTAIN_CC = 64
const ALL_SOUND_OFF_CC = 120
const ALL_NOTES_OFF_CC = 123

/**
 * Web MIDI input: note on/off with velocity and sustain (CC64), feeding the shared lifecycle;
 * the modulation wheel (CC1) and control pedal (CC11) are handed on as morph sources.
 */
export class MidiInput {
  private readonly boundary: MidiBoundary
  private readonly lifecycle: NoteLifecycle
  private readonly onActivity: () => void
  private readonly onController: (controller: number, value: number) => void
  private access: MidiAccessLike | null = null
  private attached = new Map<string, MidiInputLike>()
  private listeners = new Set<() => void>()
  private disposed = false
  private snapshot: MidiSnapshot

  constructor(boundary: MidiBoundary, lifecycle: NoteLifecycle, options: MidiOptions = {}) {
    this.boundary = boundary
    this.lifecycle = lifecycle
    this.onActivity = options.onActivity ?? (() => undefined)
    this.onController = options.onController ?? (() => undefined)
    this.snapshot = boundary.requestAccess
      ? { status: 'idle', detail: 'MIDI is off. Enable it to play from a MIDI keyboard.', inputs: [] }
      : { status: 'unsupported', detail: 'This browser has no Web MIDI support.', inputs: [] }
  }

  getSnapshot = (): MidiSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Number of message handlers currently installed on MIDI inputs. */
  get attachedCount(): number {
    return this.attached.size
  }

  /** Ask the browser for MIDI access. Must be called from a user action. */
  async enable(): Promise<void> {
    const request = this.boundary.requestAccess
    if (!request || this.access || this.snapshot.status === 'requesting') return
    this.set({ status: 'requesting', detail: 'Waiting for MIDI permission…', inputs: [] })
    try {
      const access = await request()
      if (this.disposed) return
      this.access = access
      access.onstatechange = () => this.scan()
      this.scan()
    } catch (error) {
      if (this.disposed) return
      const name = (error as { name?: string } | null)?.name ?? ''
      if (name === 'SecurityError' || name === 'NotAllowedError') {
        this.set({ status: 'denied', detail: 'MIDI access was denied. The keybed, touch, and computer keys still work.', inputs: [] })
      } else {
        const message = error instanceof Error && error.message ? error.message : 'unknown error'
        this.set({ status: 'error', detail: `MIDI could not start: ${message}.`, inputs: [] })
      }
    }
  }

  dispose(): void {
    this.disposed = true
    for (const input of this.attached.values()) input.onmidimessage = null
    this.attached.clear()
    if (this.access) this.access.onstatechange = null
    this.access = null
    this.lifecycle.releaseSource('midi')
    this.listeners.clear()
  }

  /** Reconcile attached handlers with what is plugged in right now. */
  private scan(): void {
    const access = this.access
    if (!access) return
    const present = new Map<string, MidiInputLike>()
    access.inputs.forEach((input) => {
      if (input.state !== 'disconnected') present.set(input.id, input)
    })

    for (const [id, input] of Array.from(this.attached)) {
      if (present.get(id) === input) continue
      // Unplugged: nothing can send its note-offs any more, so release what it held.
      input.onmidimessage = null
      this.attached.delete(id)
      this.lifecycle.releaseSource(`midi:${id}`)
    }
    for (const [id, input] of present) {
      if (this.attached.has(id)) continue
      input.onmidimessage = (event) => this.handleMessage(id, event)
      this.attached.set(id, input)
    }

    const names = [...this.attached.values()].map((input) => input.name || input.id)
    if (names.length > 0) {
      this.set({ status: 'connected', detail: `MIDI input: ${names.join(', ')}.`, inputs: names })
    } else {
      this.set({ status: 'no-inputs', detail: 'MIDI is enabled, but no MIDI input is connected.', inputs: [] })
    }
  }

  private handleMessage(inputId: string, event: MidiMessageEventLike): void {
    const data = event.data
    if (!data || data.length < 2) return
    const kind = data[0] & 0xf0
    const channel = data[0] & 0x0f
    const source = `midi:${inputId}:${channel}`
    const number = data[1] & 0x7f
    const value = data.length > 2 ? data[2] & 0x7f : 0

    if (kind === 0x90 && value > 0) {
      this.onActivity()
      this.lifecycle.press(source, number, value / 127)
    } else if (kind === 0x80 || kind === 0x90) {
      this.lifecycle.release(source, number)
    } else if (kind === 0xb0) {
      if (number === SUSTAIN_CC) this.lifecycle.setSustain(source, value >= 64)
      else if (number === MOD_WHEEL_CC || number === CONTROL_PEDAL_CC) this.onController(number, value)
      else if (number === ALL_NOTES_OFF_CC || number === ALL_SOUND_OFF_CC) this.lifecycle.releaseSource(source)
    }
  }

  private set(next: MidiSnapshot): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

import type { MidiAccessLike, MidiBoundary, MidiMessageEventLike, MidiPortLike } from '../audio/boundaries'
import { VARIANT } from '../model/variant'

export type MidiStatus = 'unsupported' | 'requesting' | 'denied' | 'no-device' | 'connected' | 'disconnected'

export interface MidiStatusInfo {
  status: MidiStatus
  message: string
}

export interface MidiHandlers {
  noteOn(midi: number, velocity: number): void
  noteOff(midi: number): void
  /** CC64 damper — continuous 0..1 so half-pedaling reaches the engine. */
  setSustain(value: number): void
  /** CC66 sostenuto pedal. */
  setSostenuto?(down: boolean): void
  /** CC67 soft pedal. */
  setSoft?(down: boolean): void
  /** Called when the active device disappears so owned notes can be cleaned up. */
  onDisconnectCleanup(): void
}

const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CONTROL_CHANGE = 0xb0
const CC_SUSTAIN = 64
const CC_SOSTENUTO = 66
const CC_SOFT = 67

function inKeybedRange(midi: number): boolean {
  return midi >= VARIANT.keyboard.firstMidi && midi <= VARIANT.keyboard.lastMidi
}

/**
 * Web MIDI input manager. Parses note on/off (velocity-sensitive, running
 * status handled per message), sustain CC64, and hot-plug state changes.
 * The access object is injected so tests run without devices or permission.
 */
export class MidiInputManager {
  private readonly handlers: MidiHandlers
  private statusInfo: MidiStatusInfo = { status: 'unsupported', message: 'Web MIDI is not supported here.' }
  private listeners = new Set<(info: MidiStatusInfo) => void>()
  private access: MidiAccessLike | null = null
  private attachedPorts = new Set<MidiPortLike>()
  private disposed = false

  constructor(handlers: MidiHandlers) {
    this.handlers = handlers
  }

  getStatus(): MidiStatusInfo {
    return this.statusInfo
  }

  subscribe(listener: (info: MidiStatusInfo) => void): () => void {
    this.listeners.add(listener)
    listener(this.statusInfo)
    return () => this.listeners.delete(listener)
  }

  private setStatus(status: MidiStatus, message: string): void {
    if (this.disposed) return
    this.statusInfo = { status, message }
    for (const listener of this.listeners) listener(this.statusInfo)
  }

  async start(boundary: MidiBoundary): Promise<void> {
    this.disposed = false
    if (!boundary.requestAccess) {
      this.setStatus('unsupported', 'Web MIDI is not supported here.')
      return
    }
    this.setStatus('requesting', 'Requesting MIDI access…')
    let access: MidiAccessLike
    try {
      access = await boundary.requestAccess()
    } catch {
      this.setStatus('denied', 'MIDI permission denied — keyboard, pointer and touch input still work.')
      return
    }
    if (this.disposed) return
    this.access = access
    access.onstatechange = () => this.refreshPorts()
    this.refreshPorts()
  }

  private refreshPorts(): void {
    if (!this.access || this.disposed) return
    const previousCount = this.attachedPorts.size
    const current = new Set<MidiPortLike>()
    for (const port of this.access.inputs.values()) {
      if (port.state === 'disconnected') continue
      current.add(port)
      if (!this.attachedPorts.has(port)) {
        port.onmidimessage = (event) => this.handleMessage(event)
      }
    }
    for (const port of this.attachedPorts) {
      if (!current.has(port)) port.onmidimessage = null
    }
    this.attachedPorts = current
    if (current.size > 0) {
      const names = [...current].map((p) => p.name ?? 'MIDI device').join(', ')
      this.setStatus('connected', `MIDI connected: ${names}`)
    } else if (previousCount > 0) {
      this.handlers.onDisconnectCleanup()
      this.setStatus('disconnected', 'MIDI device disconnected — notes were cleaned up.')
    } else {
      this.setStatus('no-device', 'MIDI ready — no input device connected.')
    }
  }

  handleMessage(event: MidiMessageEventLike): void {
    const data = event.data
    if (!data || data.length < 2 || this.disposed) return
    const statusByte = data[0]! & 0xf0
    if (statusByte === NOTE_ON && data.length >= 3) {
      const note = data[1]!
      const velocity = data[2]!
      if (!inKeybedRange(note)) return
      if (velocity === 0) this.handlers.noteOff(note)
      else this.handlers.noteOn(note, velocity / 127)
    } else if (statusByte === NOTE_OFF) {
      const note = data[1]!
      if (!inKeybedRange(note)) return
      this.handlers.noteOff(note)
    } else if (statusByte === CONTROL_CHANGE && data.length >= 3) {
      if (data[1] === CC_SUSTAIN) this.handlers.setSustain(data[2]! / 127)
      else if (data[1] === CC_SOSTENUTO) this.handlers.setSostenuto?.(data[2]! >= 64)
      else if (data[1] === CC_SOFT) this.handlers.setSoft?.(data[2]! >= 64)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const port of this.attachedPorts) port.onmidimessage = null
    this.attachedPorts.clear()
    if (this.access) this.access.onstatechange = null
    this.access = null
  }
}

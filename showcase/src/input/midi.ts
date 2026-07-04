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
  /** CC11 expression — continuous 0..1; drives the Control Pedal morph source. */
  setControlPedal?(value: number): void
  /** CC1 mod wheel — continuous 0..1; drives the Wheel morph source (and the
   *  on-screen wheel, which reads the same canonical value). */
  setModWheel?(value: number): void
  /** Pitch bend — normalized -1..1 (14-bit, center 8192 = 0); drives the
   *  pitch stick's ±2 semitone bend. */
  setPitchBend?(value: number): void
  /** External MIDI clock lock (manual p. 40): a BPM estimated from real-time
   *  clock ticks (0xF8, 24 per quarter), or null when the device stops
   *  (0xFC) — the master clock reverts to its internal tempo. */
  setExternalClock?(bpm: number | null): void
  /** Called when the active device disappears so owned notes can be cleaned up. */
  onDisconnectCleanup(): void
}

const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CONTROL_CHANGE = 0xb0
const PITCH_BEND = 0xe0
const CLOCK_TICK = 0xf8
const CLOCK_START = 0xfa
const CLOCK_STOP = 0xfc
/** Ticks per quarter note in MIDI real-time clock. */
const TICKS_PER_BEAT = 24
const CC_MOD_WHEEL = 1
const CC_EXPRESSION = 11
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
  /** Recent 0xF8 tick times for external-clock tempo estimation. */
  private clockTicks: number[] = []

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
    let removedAny = false
    for (const port of this.attachedPorts) {
      if (!current.has(port)) {
        port.onmidimessage = null
        removedAny = true
      }
    }
    this.attachedPorts = current
    if (current.size > 0) {
      const names = [...current].map((p) => p.name ?? 'MIDI device').join(', ')
      if (removedAny) {
        // A device left while others remain: its held notes would otherwise
        // ring forever (their note-offs can never arrive).
        this.handlers.onDisconnectCleanup()
        this.setStatus('connected', `MIDI device removed — notes cleaned up. Connected: ${names}`)
      } else {
        this.setStatus('connected', `MIDI connected: ${names}`)
      }
    } else if (previousCount > 0) {
      this.handlers.onDisconnectCleanup()
      this.setStatus('disconnected', 'MIDI device disconnected — notes were cleaned up.')
    } else {
      this.setStatus('no-device', 'MIDI ready — no input device connected.')
    }
  }

  handleMessage(event: MidiMessageEventLike): void {
    const data = event.data
    if (!data || data.length < 1 || this.disposed) return
    // Real-time messages are single-byte and may arrive interleaved.
    if (data[0] === CLOCK_TICK) {
      this.handleClockTick(event.timeStamp ?? Date.now())
      return
    }
    if (data[0] === CLOCK_START) {
      this.clockTicks.length = 0 // re-sync the estimator from the downbeat
      return
    }
    if (data[0] === CLOCK_STOP) {
      this.clockTicks.length = 0
      this.handlers.setExternalClock?.(null)
      return
    }
    if (data.length < 2) return
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
      else if (data[1] === CC_EXPRESSION) this.handlers.setControlPedal?.(data[2]! / 127)
      else if (data[1] === CC_MOD_WHEEL) this.handlers.setModWheel?.(data[2]! / 127)
    } else if (statusByte === PITCH_BEND && data.length >= 3) {
      // 14-bit LSB/MSB, center 8192 -> 0. The positive half divides by 8191
      // so a full-up bend (16383) reaches exactly +1.
      const raw = ((data[2]! & 0x7f) << 7) | (data[1]! & 0x7f)
      const centered = raw - 8192
      this.handlers.setPitchBend?.(centered < 0 ? centered / 8192 : centered / 8191)
    }
  }

  /** Rolling-average tempo from 24-ppq real-time ticks: after one full beat
   *  of samples the estimated BPM is forwarded on every tick (the store
   *  dedupes repeats). A gap or backwards timestamp restarts the window. */
  private handleClockTick(at: number): void {
    const last = this.clockTicks[this.clockTicks.length - 1]
    if (last !== undefined && (at - last > 500 || at <= last)) this.clockTicks.length = 0
    this.clockTicks.push(at)
    // Two beats of history keeps the average steady against jitter.
    if (this.clockTicks.length > TICKS_PER_BEAT * 2 + 1) this.clockTicks.shift()
    if (this.clockTicks.length < TICKS_PER_BEAT + 1) return
    const first = this.clockTicks[0]!
    const beatMs = ((at - first) / (this.clockTicks.length - 1)) * TICKS_PER_BEAT
    if (beatMs > 0) this.handlers.setExternalClock?.(60000 / beatMs)
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

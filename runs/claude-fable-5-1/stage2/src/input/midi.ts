/**
 * Web MIDI input: note on/off with velocity and sustain (CC64) on any channel, plus truthful
 * unsupported / requesting / ready / denied / error / disconnected states. A disconnect releases
 * every note the MIDI source holds.
 */
import type { MidiAccessLike, MidiBoundary, MidiInputLike, MidiMessageEventLike } from '../audio/boundaries'
import type { NoteBus } from './noteBus'

export type MidiState = 'unsupported' | 'idle' | 'requesting' | 'ready' | 'denied' | 'error' | 'disconnected'

export interface MidiStatus {
  state: MidiState
  message: string
  inputs: string[]
  lastMessage: string | null
  sustain: boolean
}

export type ParsedMidi =
  | { type: 'noteon'; midi: number; velocity: number; channel: number }
  | { type: 'noteoff'; midi: number; channel: number }
  | { type: 'sustain'; on: boolean; channel: number }
  | { type: 'all-notes-off'; channel: number }
  | { type: 'other' }

export function parseMidiMessage(data: Uint8Array | ArrayLike<number> | null): ParsedMidi | null {
  if (!data || data.length === 0) return null
  const status = data[0] & 0xf0
  const channel = data[0] & 0x0f
  if (status === 0x90 && data.length >= 3) {
    return data[2] > 0 ? { type: 'noteon', midi: data[1], velocity: data[2], channel } : { type: 'noteoff', midi: data[1], channel }
  }
  if (status === 0x80 && data.length >= 2) return { type: 'noteoff', midi: data[1], channel }
  if (status === 0xb0 && data.length >= 3) {
    if (data[1] === 64) return { type: 'sustain', on: data[2] >= 64, channel }
    if (data[1] === 123 || data[1] === 120) return { type: 'all-notes-off', channel }
  }
  return { type: 'other' }
}

function inputsOf(access: MidiAccessLike): MidiInputLike[] {
  const list: MidiInputLike[] = []
  access.inputs.forEach((input: MidiInputLike) => list.push(input))
  return list
}

export class MidiController {
  private status: MidiStatus
  private listeners = new Set<() => void>()
  private access: MidiAccessLike | null = null
  private attached = new Set<MidiInputLike>()
  private generation = 0

  constructor(private readonly boundary: MidiBoundary, private readonly bus: NoteBus) {
    this.status = boundary.requestAccess
      ? { state: 'idle', message: 'Web MIDI available; access not requested yet.', inputs: [], lastMessage: null, sustain: false }
      : { state: 'unsupported', message: 'Web MIDI is not supported in this browser.', inputs: [], lastMessage: null, sustain: false }
  }

  getStatus = (): MidiStatus => this.status

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private update(patch: Partial<MidiStatus>) {
    this.status = { ...this.status, ...patch }
    this.listeners.forEach((l) => l())
  }

  async connect(): Promise<void> {
    const generation = ++this.generation
    if (!this.boundary.requestAccess) {
      this.update({ state: 'unsupported', message: 'Web MIDI is not supported in this browser.' })
      return
    }
    if (this.access) return
    this.update({ state: 'requesting', message: 'Requesting MIDI access…' })
    try {
      const access = await this.boundary.requestAccess()
      if (generation !== this.generation) return
      this.access = access
      access.onstatechange = () => this.refreshPorts()
      this.refreshPorts()
    } catch (err) {
      if (generation !== this.generation) return
      const name = (err as { name?: string } | null)?.name ?? ''
      const denied = name === 'SecurityError' || name === 'NotAllowedError' || /denied|permission/i.test(String(err))
      this.update({
        state: denied ? 'denied' : 'error',
        message: denied ? 'MIDI access was denied; keyboard and pointer input still work.' : `MIDI access failed: ${err instanceof Error ? err.message : String(err)}`,
        inputs: [],
      })
    }
  }

  private refreshPorts() {
    if (!this.access) return
    const inputs = inputsOf(this.access).filter((i) => i.state === 'connected')
    for (const input of inputs) {
      if (!this.attached.has(input)) {
        input.onmidimessage = (event: MidiMessageEventLike) => this.handle(event.data)
        this.attached.add(input)
      }
    }
    for (const input of Array.from(this.attached)) {
      if (!inputs.includes(input)) {
        input.onmidimessage = null
        this.attached.delete(input)
      }
    }
    const names = inputs.map((i) => i.name ?? i.id)
    const hadInputs = this.status.inputs.length > 0
    if (inputs.length === 0) {
      if (hadInputs) this.bus.releaseSource('midi')
      this.update({ state: 'disconnected', message: hadInputs ? 'MIDI device disconnected; its notes were released.' : 'MIDI access granted; no input device connected.', inputs: [], sustain: false })
    } else {
      this.update({ state: 'ready', message: `MIDI ready: ${names.join(', ')}`, inputs: names })
    }
  }

  /** Public so tests and the UI can feed raw bytes without a device. */
  handle(data: Uint8Array | ArrayLike<number> | null): ParsedMidi | null {
    const parsed = parseMidiMessage(data)
    if (!parsed) return null
    switch (parsed.type) {
      case 'noteon':
        this.bus.noteOn(parsed.midi, parsed.velocity, 'midi')
        this.update({ lastMessage: `note on ${parsed.midi} vel ${parsed.velocity}` })
        break
      case 'noteoff':
        this.bus.noteOff(parsed.midi, 'midi')
        this.update({ lastMessage: `note off ${parsed.midi}` })
        break
      case 'sustain':
        this.bus.setSustain('midi', parsed.on)
        this.update({ lastMessage: `sustain ${parsed.on ? 'down' : 'up'}`, sustain: parsed.on })
        break
      case 'all-notes-off':
        this.bus.releaseSource('midi')
        this.update({ lastMessage: 'all notes off', sustain: false })
        break
      default:
        break
    }
    return parsed
  }

  dispose() {
    this.generation++
    for (const input of this.attached) input.onmidimessage = null
    this.attached.clear()
    if (this.access) this.access.onstatechange = null
    this.access = null
    this.bus.releaseSource('midi')
    this.update({ state: this.boundary.requestAccess ? 'idle' : 'unsupported', message: this.boundary.requestAccess ? 'MIDI released.' : 'Web MIDI is not supported in this browser.', inputs: [], sustain: false })
  }
}

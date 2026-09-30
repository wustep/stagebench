import type { NoteLifecycle } from '../audio/lifecycle'

export interface MidiMessageLike {
  data: Uint8Array | ArrayLike<number> | null
}

export interface MidiInputLike {
  id: string
  name?: string | null
  state?: string
  onmidimessage: ((event: MidiMessageLike) => void) | null
}

export interface MidiAccessLike {
  inputs: { values(): Iterable<MidiInputLike> }
  onstatechange: ((event: unknown) => void) | null
}

/** null = this environment has no Web MIDI */
export type MidiProvider = (() => Promise<MidiAccessLike>) | null

export type MidiPhase = 'idle' | 'requesting' | 'connected' | 'no-devices' | 'disconnected' | 'denied' | 'unsupported' | 'error'

export interface MidiStatus {
  phase: MidiPhase
  devices: string[]
  message: string
}

export type ParsedMidi =
  | { type: 'noteOn'; note: number; velocity: number }
  | { type: 'noteOff'; note: number }
  | { type: 'sustain'; down: boolean }
  | { type: 'allNotesOff' }
  | { type: 'ignored' }

export function parseMidi(data: ArrayLike<number> | null): ParsedMidi {
  if (!data || data.length < 2) return { type: 'ignored' }
  const status = data[0] & 0xf0
  const d1 = data[1] & 0x7f
  const d2 = (data.length > 2 ? data[2] : 0) & 0x7f
  if (status === 0x90) return d2 > 0 ? { type: 'noteOn', note: d1, velocity: d2 } : { type: 'noteOff', note: d1 }
  if (status === 0x80) return { type: 'noteOff', note: d1 }
  if (status === 0xb0) {
    if (d1 === 64) return { type: 'sustain', down: d2 >= 64 }
    if (d1 === 120 || d1 === 123) return { type: 'allNotesOff' }
  }
  return { type: 'ignored' }
}

export interface MidiController {
  connect(): Promise<void>
  getStatus(): MidiStatus
  subscribe(listener: () => void): () => void
  dispose(): void
}

const STATUS_IDLE: MidiStatus = { phase: 'idle', devices: [], message: 'MIDI not connected' }

export function createMidiController(provider: MidiProvider, lifecycle: NoteLifecycle): MidiController {
  let status: MidiStatus = provider ? STATUS_IDLE : { phase: 'unsupported', devices: [], message: 'Web MIDI is not available in this browser' }
  let access: MidiAccessLike | null = null
  let hadDevices = false
  let disposed = false
  const attached = new Map<string, MidiInputLike>()
  const listeners = new Set<() => void>()

  const emit = (next: MidiStatus) => {
    status = next
    listeners.forEach((l) => l())
  }

  const onMessage = (portId: string, event: MidiMessageLike) => {
    const msg = parseMidi(event.data)
    switch (msg.type) {
      case 'noteOn':
        lifecycle.noteOn(`midi:${portId}:${msg.note}`, msg.note, msg.velocity)
        break
      case 'noteOff':
        lifecycle.noteOff(`midi:${portId}:${msg.note}`)
        break
      case 'sustain':
        lifecycle.sustain(`midi:${portId}:cc64`, msg.down)
        break
      case 'allNotesOff':
        lifecycle.releaseSource(`midi:${portId}:`)
        break
      default:
        break
    }
  }

  const scan = () => {
    if (!access) return
    const present = new Map<string, MidiInputLike>()
    for (const input of access.inputs.values()) {
      if (input.state === undefined || input.state === 'connected') present.set(input.id, input)
    }
    for (const [id, input] of attached) {
      if (!present.has(id)) {
        input.onmidimessage = null
        attached.delete(id)
        lifecycle.releaseSource(`midi:${id}:`)
      }
    }
    for (const [id, input] of present) {
      if (!attached.has(id)) {
        input.onmidimessage = (event) => onMessage(id, event)
        attached.set(id, input)
      }
    }
    const devices = [...attached.values()].map((i) => i.name || i.id)
    if (devices.length > 0) {
      hadDevices = true
      emit({ phase: 'connected', devices, message: `MIDI: ${devices.join(', ')}` })
    } else if (hadDevices) {
      emit({ phase: 'disconnected', devices: [], message: 'MIDI device disconnected — notes and sustain released' })
    } else {
      emit({ phase: 'no-devices', devices: [], message: 'MIDI access granted, but no input device is connected' })
    }
  }

  return {
    async connect() {
      if (disposed) return
      if (!provider) {
        emit({ phase: 'unsupported', devices: [], message: 'Web MIDI is not available in this browser' })
        return
      }
      if (status.phase === 'requesting') return
      emit({ phase: 'requesting', devices: [], message: 'Waiting for MIDI permission…' })
      try {
        access = await provider()
      } catch (error) {
        if (disposed) return
        const name = error instanceof Error ? error.name : ''
        if (name === 'SecurityError' || name === 'NotAllowedError') {
          emit({ phase: 'denied', devices: [], message: 'MIDI permission was denied — the on-screen and computer keyboards still work' })
        } else {
          emit({ phase: 'error', devices: [], message: `MIDI could not start: ${error instanceof Error ? error.message : 'unknown error'}` })
        }
        return
      }
      if (disposed) return
      access.onstatechange = () => scan()
      scan()
    },
    getStatus: () => status,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      disposed = true
      for (const input of attached.values()) input.onmidimessage = null
      attached.clear()
      if (access) access.onstatechange = null
      access = null
      lifecycle.releaseSource('midi:')
      listeners.clear()
    },
  }
}

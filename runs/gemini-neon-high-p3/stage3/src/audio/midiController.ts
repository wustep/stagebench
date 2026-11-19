import {
  browserMidiProvider,
  type MidiAccessLike,
  type MidiInputLike,
  type MidiMessageEventLike,
  type MidiProvider,
} from './boundaries'

export type MidiConnectionStatus =
  | 'initializing'
  | 'ready'
  | 'no-devices'
  | 'denied'
  | 'unsupported'
  | 'error'

export interface MidiStatusSnapshot {
  readonly status: MidiConnectionStatus
  readonly connectedInputs: readonly string[]
  readonly message: string
}

export interface MidiMessageCallbacks {
  readonly onNoteOn: (midi: number, velocity: number, sourceId: string) => void
  readonly onNoteOff: (midi: number, sourceId: string) => void
  readonly onSustain: (active: boolean, sourceId: string) => void
  readonly onControlChange?: (cc: number, value: number, sourceId: string) => void
  readonly onPitchBend?: (normalized: number, sourceId: string) => void
  readonly onAllNotesOff: (portPrefix: string) => void
  readonly onPortDisconnect: (portPrefix: string) => void
}

function collectInputs(access: MidiAccessLike): MidiInputLike[] {
  const raw = access.inputs
  if ('values' in raw && typeof raw.values === 'function') {
    return Array.from(raw.values())
  }
  return Array.from(raw as Iterable<MidiInputLike>)
}

export function parseMidiMessage(
  data: Uint8Array | null,
  portId: string,
  callbacks: MidiMessageCallbacks,
): void {
  if (!data || data.length < 2) return
  const status = data[0]
  const command = status & 0xf0
  const channel = status & 0x0f
  const data1 = data[1] & 0x7f
  const data2 = data.length >= 3 ? data[2] & 0x7f : 0

  if (command === 0x90) {
    const sourceId = `midi:${portId}:ch${channel}:n${data1}`
    if (data2 > 0) {
      callbacks.onNoteOn(data1, data2, sourceId)
    } else {
      callbacks.onNoteOff(data1, sourceId)
    }
    return
  }

  if (command === 0x80) {
    const sourceId = `midi:${portId}:ch${channel}:n${data1}`
    callbacks.onNoteOff(data1, sourceId)
    return
  }

  if (command === 0xb0) {
    if (data1 === 64) {
      callbacks.onSustain(data2 >= 64, `midi:${portId}:ch${channel}:cc64`)
    } else if (data1 === 120 || data1 === 123) {
      callbacks.onAllNotesOff(`midi:${portId}:ch${channel}:`)
    } else if (callbacks.onControlChange) {
      callbacks.onControlChange(data1, data2, `midi:${portId}:ch${channel}:cc${data1}`)
    }
    return
  }

  if (command === 0xe0 && callbacks.onPitchBend) {
    const raw14 = ((data2 & 0x7f) << 7) | (data1 & 0x7f)
    const normalized = Math.max(-1, Math.min(1, (raw14 - 8192) / 8192))
    callbacks.onPitchBend(normalized, `midi:${portId}:ch${channel}:pb`)
  }
}

export class MidiController {
  private readonly provider: MidiProvider
  private readonly callbacks: MidiMessageCallbacks
  private readonly boundInputs = new Map<string, MidiInputLike>()
  private readonly listeners = new Set<(snap: MidiStatusSnapshot) => void>()

  private access: MidiAccessLike | null = null
  private snapshot: MidiStatusSnapshot = {
    status: 'initializing',
    connectedInputs: [],
    message: 'Initializing Web MIDI…',
  }
  private initialized = false
  private disposed = false

  constructor(callbacks: MidiMessageCallbacks, provider: MidiProvider = browserMidiProvider) {
    this.callbacks = callbacks
    this.provider = provider
  }

  async init(): Promise<void> {
    if (this.disposed) return
    if (this.initialized && this.access) {
      this.syncInputs()
      return
    }
    if (!this.provider.isSupported()) {
      this.initialized = true
      this.updateSnapshot({
        status: 'unsupported',
        connectedInputs: [],
        message: 'Web MIDI unavailable in this browser',
      })
      return
    }

    try {
      const access = await this.provider.requestAccess()
      if (this.disposed) return
      this.access = access
      this.initialized = true
      access.onstatechange = () => {
        if (!this.disposed) {
          this.syncInputs()
        }
      }
      this.syncInputs()
    } catch (err) {
      if (this.disposed) return
      this.initialized = true
      const name = err instanceof Error ? err.name : ''
      const msg = err instanceof Error ? err.message : String(err)
      const isDenied =
        name === 'SecurityError' ||
        name === 'NotAllowedError' ||
        /denied|permission|not allowed/i.test(msg)
      this.updateSnapshot({
        status: isDenied ? 'denied' : 'error',
        connectedInputs: [],
        message: isDenied ? 'Web MIDI permission denied' : `Web MIDI error: ${msg}`,
      })
    }
  }

  private syncInputs(): void {
    if (!this.access || this.disposed) return
    const current = collectInputs(this.access)
    const activeIds = new Set<string>()
    const connectedNames: string[] = []

    for (const input of current) {
      const isConnected = input.state === undefined || input.state === 'connected'
      if (!isConnected) continue
      activeIds.add(input.id)
      connectedNames.push(input.name || input.id || 'MIDI Input')

      if (!this.boundInputs.has(input.id)) {
        const portId = input.id
        input.onmidimessage = (event: MidiMessageEventLike) => {
          if (!this.disposed) {
            parseMidiMessage(event.data, portId, this.callbacks)
          }
        }
        this.boundInputs.set(portId, input)
      }
    }

    // Detect disconnected inputs and release any voices they held
    for (const [portId, oldInput] of Array.from(this.boundInputs.entries())) {
      if (!activeIds.has(portId)) {
        oldInput.onmidimessage = null
        this.boundInputs.delete(portId)
        this.callbacks.onPortDisconnect(`midi:${portId}:`)
      }
    }

    if (connectedNames.length > 0) {
      this.updateSnapshot({
        status: 'ready',
        connectedInputs: connectedNames,
        message:
          connectedNames.length === 1
            ? `MIDI ready: ${connectedNames[0]}`
            : `MIDI ready (${connectedNames.length} inputs)`,
      })
    } else {
      this.updateSnapshot({
        status: 'no-devices',
        connectedInputs: [],
        message: 'Web MIDI ready (no input devices connected)',
      })
    }
  }

  getSnapshot(): MidiStatusSnapshot {
    return this.snapshot
  }

  getBoundInputCount(): number {
    return this.boundInputs.size
  }

  subscribe(listener: (snap: MidiStatusSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private updateSnapshot(next: MidiStatusSnapshot): void {
    this.snapshot = next
    for (const listener of this.listeners) {
      listener(next)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const input of this.boundInputs.values()) {
      input.onmidimessage = null
    }
    this.boundInputs.clear()
    if (this.access) {
      this.access.onstatechange = null
      this.access = null
    }
    this.listeners.clear()
  }
}

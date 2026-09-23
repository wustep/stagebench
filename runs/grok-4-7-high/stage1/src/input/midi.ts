export type MidiStatus = 'idle' | 'pending' | 'ready' | 'denied' | 'disconnected' | 'unsupported'

export interface MidiMessageEventLike {
  data: Uint8Array | null
}

export interface MidiPortLike {
  id?: string
  name?: string | null
  state: 'connected' | 'disconnected'
  addEventListener(type: 'midimessage' | 'statechange', listener: (event: MidiMessageEventLike) => void): void
  removeEventListener(type: 'midimessage' | 'statechange', listener: (event: MidiMessageEventLike) => void): void
}

export interface MidiAccessLike {
  inputs: Iterable<MidiPortLike> | { values(): Iterable<MidiPortLike> }
  addEventListener(type: 'statechange', listener: () => void): void
  removeEventListener(type: 'statechange', listener: () => void): void
}

export interface MidiBoundary {
  isSupported(): boolean
  requestAccess(): Promise<MidiAccessLike>
}

export function realMidiBoundary(): MidiBoundary {
  const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MidiAccessLike> }
  return {
    isSupported: () => typeof nav.requestMIDIAccess === 'function',
    requestAccess: () => nav.requestMIDIAccess!(),
  }
}

export interface MidiHandlers {
  onNoteOn: (note: number, velocity: number) => void
  onNoteOff: (note: number) => void
  onSustain: (down: boolean) => void
  onAllNotesOff: () => void
}

function inputPorts(access: MidiAccessLike): MidiPortLike[] {
  const inputs = access.inputs
  if (Symbol.iterator in inputs) return [...(inputs as Iterable<MidiPortLike>)]
  return [...inputs.values()]
}

/**
 * Web MIDI note, velocity, and CC64 sustain. Permission denial and later
 * port disconnect are explicit statuses; both stop owned notes via the handler.
 */
export class MidiInput {
  private phase: MidiStatus = 'idle'
  private readonly listeners = new Set<() => void>()
  private readonly cleanups: (() => void)[] = []
  private access: MidiAccessLike | null = null

  constructor(
    private readonly boundary: MidiBoundary,
    private readonly handlers: MidiHandlers,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getStatus(): MidiStatus {
    return this.phase
  }

  private setStatus(phase: MidiStatus) {
    if (this.phase === phase) return
    this.phase = phase
    for (const listener of this.listeners) listener()
  }

  async start() {
    if (!this.boundary.isSupported()) {
      this.setStatus('unsupported')
      return
    }
    this.setStatus('pending')
    try {
      const access = await this.boundary.requestAccess()
      this.access = access
      this.bind(access)
      this.setStatus('ready')
    } catch {
      this.setStatus('denied')
    }
  }

  private bind(access: MidiAccessLike) {
    const onPortMessage = (event: MidiMessageEventLike) => this.handleMessage(event.data)
    const onPortState = () => this.refreshConnections()
    const attach = (port: MidiPortLike) => {
      port.addEventListener('midimessage', onPortMessage)
      port.addEventListener('statechange', onPortState)
      this.cleanups.push(() => {
        port.removeEventListener('midimessage', onPortMessage)
        port.removeEventListener('statechange', onPortState)
      })
    }
    for (const port of inputPorts(access)) attach(port)
    const onAccess = () => {
      if (!this.access) return
      for (const port of inputPorts(this.access)) attach(port)
      this.refreshConnections()
    }
    access.addEventListener('statechange', onAccess)
    this.cleanups.push(() => access.removeEventListener('statechange', onAccess))
  }

  private refreshConnections() {
    if (!this.access) return
    const ports = inputPorts(this.access)
    const hadConnected = this.phase === 'ready'
    const connected = ports.some((port) => port.state === 'connected')
    if (hadConnected && ports.length > 0 && !connected) {
      this.handlers.onAllNotesOff()
      this.setStatus('disconnected')
    }
  }

  /** Test/helper: mark the session disconnected and silence notes. */
  markDisconnected() {
    this.handlers.onAllNotesOff()
    this.setStatus('disconnected')
  }

  private handleMessage(data: Uint8Array | null) {
    if (!data || data.length < 2) return
    const status = data[0] ?? 0
    const data1 = data[1] ?? 0
    const data2 = data[2] ?? 0
    const command = status & 0xf0
    if (command === 0x90 && data2 > 0) {
      this.handlers.onNoteOn(data1, data2 / 127)
      return
    }
    if (command === 0x90 && data2 === 0) {
      this.handlers.onNoteOff(data1)
      return
    }
    if (command === 0x80) {
      this.handlers.onNoteOff(data1)
      return
    }
    if (command === 0xb0 && data1 === 64) {
      this.handlers.onSustain(data2 >= 64)
      return
    }
    if (command === 0xb0 && (data1 === 120 || data1 === 123)) {
      this.handlers.onAllNotesOff()
    }
  }

  close() {
    for (const cleanup of this.cleanups) cleanup()
    this.cleanups.length = 0
    this.access = null
  }
}

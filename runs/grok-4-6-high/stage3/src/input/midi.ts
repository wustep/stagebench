export type MidiConnectionState = 'idle' | 'connected' | 'denied' | 'disconnected' | 'unavailable'

export interface MidiInputLike {
  addEventListener(type: 'midimessage', listener: (event: { data: Uint8Array | number[] }) => void): void
  removeEventListener(type: 'midimessage', listener: (event: { data: Uint8Array | number[] }) => void): void
  onmidimessage?: ((event: { data: Uint8Array | number[] }) => void) | null
  state?: string
}

export interface MidiAccessLike {
  inputs: { values(): Iterable<MidiInputLike> } | Iterable<MidiInputLike>
  onstatechange: ((event: { port?: { state?: string; type?: string } }) => void) | null
}

export type MidiAccessFactory = () => Promise<MidiAccessLike>

export interface MidiHandlers {
  noteOn: (note: number, velocity: number) => void
  noteOff: (note: number) => void
  sustain: (down: boolean) => void
  controlPedal?: (value: number) => void
  onState: (state: MidiConnectionState) => void
}

function iterateInputs(access: MidiAccessLike): MidiInputLike[] {
  const { inputs } = access
  if (inputs && typeof (inputs as { values?: () => Iterable<MidiInputLike> }).values === 'function') {
    return [...(inputs as { values: () => Iterable<MidiInputLike> }).values()]
  }
  return [...(inputs as Iterable<MidiInputLike>)]
}

export class MidiController {
  private handlers: MidiHandlers
  private requestAccess: MidiAccessFactory | null
  private access: MidiAccessLike | null = null
  private bound = new Map<MidiInputLike, (event: { data: Uint8Array | number[] }) => void>()
  private state: MidiConnectionState = 'idle'
  private onStateChange: (() => void) | null = null

  private disposed = false

  constructor(handlers: MidiHandlers, requestAccess?: MidiAccessFactory | null) {
    this.handlers = handlers
    this.requestAccess = requestAccess === undefined ? defaultMidiFactory() : requestAccess
  }

  getState(): MidiConnectionState {
    return this.state
  }

  async connect(): Promise<MidiConnectionState> {
    if (this.disposed) return this.state
    if (!this.requestAccess) {
      this.setState('unavailable')
      return this.state
    }
    try {
      const access = await this.requestAccess()
      if (this.disposed) return this.state
      this.access = access
      this.attach(access)
      this.setState('connected')
      return this.state
    } catch (error) {
      if (this.disposed) return this.state
      const name = (error as { name?: string })?.name
      if (name === 'SecurityError' || name === 'NotAllowedError') this.setState('denied')
      else this.setState('unavailable')
      return this.state
    }
  }

  disconnect(): void {
    this.detach()
    this.access = null
    this.setState('disconnected')
  }

  dispose(): void {
    this.disposed = true
    this.detach()
    this.access = null
  }

  handleMessage(data: ArrayLike<number>): void {
    if (data.length < 1) return
    const status = data[0] & 0xf0
    const a = data[1] ?? 0
    const b = data[2] ?? 0
    if (status === 0x90) {
      if (b <= 0) this.handlers.noteOff(a)
      else this.handlers.noteOn(a, b / 127)
      return
    }
    if (status === 0x80) {
      this.handlers.noteOff(a)
      return
    }
    if (status === 0xb0 && a === 64) {
      this.handlers.sustain(b >= 64)
      return
    }
    if (status === 0xb0 && a === 11) {
      this.handlers.controlPedal?.(b / 127)
    }
  }

  private attach(access: MidiAccessLike): void {
    this.detach()
    for (const input of iterateInputs(access)) {
      const listener = (event: { data: Uint8Array | number[] }) => this.handleMessage(event.data)
      input.addEventListener('midimessage', listener)
      this.bound.set(input, listener)
    }
    this.onStateChange = () => {
      const ports = iterateInputs(access)
      const connected = ports.some((port) => port.state !== 'disconnected')
      if (!connected) {
        this.setState('disconnected')
      }
    }
    access.onstatechange = (event) => {
      if (event.port?.state === 'disconnected') this.setState('disconnected')
      this.onStateChange?.()
    }
  }

  private detach(): void {
    for (const [input, listener] of this.bound) {
      input.removeEventListener('midimessage', listener)
    }
    this.bound.clear()
    if (this.access) this.access.onstatechange = null
  }

  private setState(state: MidiConnectionState): void {
    this.state = state
    this.handlers.onState(state)
  }
}

function defaultMidiFactory(): MidiAccessFactory | null {
  const nav = globalThis.navigator as Navigator & {
    requestMIDIAccess?: () => Promise<MidiAccessLike>
  }
  if (typeof nav?.requestMIDIAccess !== 'function') return null
  return () => nav.requestMIDIAccess() as unknown as Promise<MidiAccessLike>
}

/** Injectable Web MIDI input */

export type MidiConnectionState = 'unsupported' | 'pending' | 'connected' | 'denied' | 'disconnected'

export interface MidiNoteHandlers {
  onNoteOn: (midi: number, velocity: number) => void
  onNoteOff: (midi: number) => void
  onSustain: (down: boolean) => void
  onStateChange?: (state: MidiConnectionState) => void
}

export interface MidiAccessLike {
  inputs: Map<string, MidiInputLike> | { forEach: (cb: (input: MidiInputLike) => void) => void }
  onstatechange: ((ev: { port: { state: string; type: string } }) => void) | null
}

export interface MidiInputLike {
  id: string
  state: string
  onmidimessage: ((ev: { data: Uint8Array | number[] }) => void) | null
}

export interface MidiInputOptions {
  /** Injected requestMIDIAccess; defaults to navigator.requestMIDIAccess */
  requestAccess?: () => Promise<MidiAccessLike>
  handlers: MidiNoteHandlers
}

/**
 * Attach MIDI note/velocity and CC64 sustain.
 * Handles denied and disconnected states without requiring a physical device.
 */
export class MidiInput {
  private state: MidiConnectionState = 'pending'
  private access: MidiAccessLike | null = null
  private handlers: MidiNoteHandlers
  private requestAccess: () => Promise<MidiAccessLike>
  private unsubscribers: Array<() => void> = []

  constructor(opts: MidiInputOptions) {
    this.handlers = opts.handlers
    this.requestAccess =
      opts.requestAccess ??
      (async () => {
        if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
          throw Object.assign(new Error('MIDI unsupported'), { name: 'NotSupportedError' })
        }
        const access = await (
          navigator as Navigator & { requestMIDIAccess: () => Promise<unknown> }
        ).requestMIDIAccess()
        return access as MidiAccessLike
      })
  }

  getState(): MidiConnectionState {
    return this.state
  }

  private setState(s: MidiConnectionState) {
    this.state = s
    this.handlers.onStateChange?.(s)
  }

  async connect(): Promise<MidiConnectionState> {
    try {
      this.setState('pending')
      this.access = await this.requestAccess()
      this.bindInputs()
      this.access.onstatechange = (ev) => {
        if (ev.port.type === 'input') {
          if (ev.port.state === 'disconnected') {
            this.setState('disconnected')
            this.handlers.onSustain(false)
          } else if (ev.port.state === 'connected') {
            this.bindInputs()
            this.setState('connected')
          }
        }
      }
      this.setState('connected')
    } catch (err) {
      const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : ''
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.setState('denied')
      } else if (name === 'NotSupportedError') {
        this.setState('unsupported')
      } else {
        this.setState('denied')
      }
    }
    return this.state
  }

  private bindInputs() {
    if (!this.access) return
    const attach = (input: MidiInputLike) => {
      input.onmidimessage = (ev) => this.handleMessage(ev.data)
    }
    if (this.access.inputs instanceof Map) {
      for (const input of this.access.inputs.values()) attach(input)
    } else {
      this.access.inputs.forEach(attach)
    }
  }

  /** Test helper: inject a raw MIDI message */
  handleMessage(data: Uint8Array | number[]): void {
    const status = data[0] & 0xf0
    const data1 = data[1]
    const data2 = data[2] ?? 0
    if (status === 0x90) {
      if (data2 > 0) {
        this.handlers.onNoteOn(data1, data2 / 127)
      } else {
        this.handlers.onNoteOff(data1)
      }
    } else if (status === 0x80) {
      this.handlers.onNoteOff(data1)
    } else if (status === 0xb0 && data1 === 64) {
      this.handlers.onSustain(data2 >= 64)
    }
  }

  disconnect(): void {
    for (const u of this.unsubscribers) u()
    this.unsubscribers = []
    this.handlers.onSustain(false)
    this.setState('disconnected')
    this.access = null
  }
}

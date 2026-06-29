export type MidiConnectionState = 'idle' | 'connected' | 'disconnected' | 'unsupported' | 'permission-denied' | 'error'

export interface MidiPortLike {
  name?: string | null
  state?: string
  onmidimessage: ((event: { data: Uint8Array }) => void) | null
}

export interface MidiAccessLike {
  inputs: Map<string, MidiPortLike>
  onstatechange: ((event: unknown) => void) | null
}

export type RequestMidiAccess = () => Promise<MidiAccessLike>

export type ParsedMidiMessage =
  | { type: 'note-on'; note: number; velocity: number }
  | { type: 'note-off'; note: number }
  | { type: 'sustain'; down: boolean }

export function parseMidiMessage(data: ArrayLike<number>): ParsedMidiMessage | null {
  const status = data[0] ?? 0
  const command = status & 0xf0
  const first = data[1] ?? 0
  const second = data[2] ?? 0
  if (command === 0x90) return second === 0 ? { type: 'note-off', note: first } : { type: 'note-on', note: first, velocity: second }
  if (command === 0x80) return { type: 'note-off', note: first }
  if (command === 0xb0 && first === 64) return { type: 'sustain', down: second >= 64 }
  return null
}

export class MidiInput {
  private access: MidiAccessLike | null = null

  constructor(
    private readonly requestAccess: RequestMidiAccess | null,
    private readonly target: { noteOn(midi: number, velocity: number): void; noteOff(midi: number): void; sustain(down: boolean): void },
    private readonly onState?: (state: MidiConnectionState, detail?: string) => void,
  ) {}

  async connect(): Promise<MidiConnectionState> {
    if (!this.requestAccess) return this.report('unsupported')
    try {
      this.access = await this.requestAccess()
      this.bindPorts()
      this.access.onstatechange = () => this.bindPorts()
      return this.report(this.access.inputs.size ? 'connected' : 'disconnected')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') return this.report('permission-denied')
      return this.report('error', error instanceof Error ? error.message : 'Unknown MIDI error')
    }
  }

  disconnect() {
    if (!this.access) return
    for (const port of this.access.inputs.values()) port.onmidimessage = null
    this.access.onstatechange = null
    this.access = null
    this.report('idle')
  }

  private bindPorts() {
    if (!this.access) return
    for (const port of this.access.inputs.values()) {
      port.onmidimessage = (event) => this.receive(event.data)
    }
    this.report(this.access.inputs.size ? 'connected' : 'disconnected')
  }

  private receive(data: ArrayLike<number>) {
    const message = parseMidiMessage(data)
    if (!message) return
    if (message.type === 'note-on') this.target.noteOn(message.note, message.velocity)
    if (message.type === 'note-off') this.target.noteOff(message.note)
    if (message.type === 'sustain') this.target.sustain(message.down)
  }

  private report(state: MidiConnectionState, detail?: string) {
    this.onState?.(state, detail)
    return state
  }
}

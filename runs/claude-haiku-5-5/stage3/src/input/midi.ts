// Web MIDI adapter. It reports truthful access status and turns note and CC64 messages into intents.
// The access factory is injected, so tests can run without a device, a permission prompt, or a browser.

export type MidiStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'disconnected' | 'unsupported'

export const MIDI_STATUS_MESSAGES: Readonly<Record<MidiStatus, string>> = {
  idle: 'MIDI not requested.',
  requesting: 'Requesting MIDI access…',
  ready: 'MIDI input ready.',
  denied: 'MIDI access denied. Keyboard and pointer still play the piano.',
  disconnected: 'No MIDI input connected. Keyboard and pointer still play the piano.',
  unsupported: 'Web MIDI is not available in this browser. Keyboard and pointer still play the piano.',
}

export interface MidiMessageEvent {
  data: Uint8Array
}

export interface MidiInputLike {
  readonly id: string
  readonly state?: 'connected' | 'disconnected'
  onmidimessage: ((event: MidiMessageEvent) => void) | null
}

export interface MidiAccessLike {
  readonly inputs: ReadonlyMap<string, MidiInputLike>
  onstatechange: ((event: unknown) => void) | null
}

export type MidiAccessRequest = () => Promise<MidiAccessLike>

/** Every handler acts only on MIDI-owned notes and sustain; keyboard and pointer input is never touched. */
export interface MidiHandlers {
  noteOn(note: number, velocity: number): void
  noteOff(note: number): void
  sustain(on: boolean): void
  allNotesOff(): void
  onStatus(status: MidiStatus): void
  /** Control Pedal, from CC11, as a 0..1 value. Optional: a handler that ignores it is still valid. */
  controlPedal?(value: number): void
}

export const MIDI_SOURCE = 'midi'
export const SUSTAIN_CONTROLLER = 64
/** Expression: drives the Control Pedal morph source (manual p. 39). */
export const CONTROL_PEDAL_CONTROLLER = 11
export const ALL_NOTES_OFF_CONTROLLER = 123

export interface MidiController {
  /** Requests access once. Denied or unavailable access is reported through status, never thrown. */
  connect(): void
  disconnect(): void
  status(): MidiStatus
}

export function createMidiController(requestAccess: MidiAccessRequest | undefined, handlers: MidiHandlers): MidiController {
  let status: MidiStatus = 'idle'
  let access: MidiAccessLike | undefined
  let connected = false

  const setStatus = (next: MidiStatus) => {
    status = next
    handlers.onStatus(next)
  }

  const handleMessage = (event: MidiMessageEvent) => {
    const bytes = event.data
    if (bytes.length < 2) return
    const kind = bytes[0] & 0xf0
    const note = bytes[1]
    const value = bytes[2] ?? 0
    if (kind === 0x90 && value > 0) {
      handlers.noteOn(note, value)
    } else if (kind === 0x80 || (kind === 0x90 && value === 0)) {
      handlers.noteOff(note)
    } else if (kind === 0xb0) {
      if (note === SUSTAIN_CONTROLLER) handlers.sustain(value >= 64)
      if (note === CONTROL_PEDAL_CONTROLLER) handlers.controlPedal?.(value / 127)
      if (note === ALL_NOTES_OFF_CONTROLLER) handlers.allNotesOff()
    }
  }

  const attachInputs = () => {
    if (!access) return
    let count = 0
    for (const input of access.inputs.values()) {
      if (input.state === 'disconnected') continue
      input.onmidimessage = handleMessage
      count += 1
    }
    if (count === 0) {
      // Losing the last input leaves held MIDI notes and a held CC64 with no release coming: clear them.
      handlers.allNotesOff()
      handlers.sustain(false)
    }
    setStatus(count > 0 ? 'ready' : 'disconnected')
  }

  return {
    connect() {
      if (connected || status === 'requesting') return
      if (!requestAccess) {
        setStatus('unsupported')
        return
      }
      connected = true
      setStatus('requesting')
      requestAccess()
        .then((granted) => {
          if (!connected) return
          access = granted
          access.onstatechange = () => attachInputs()
          attachInputs()
        })
        .catch(() => {
          if (!connected) return
          setStatus('denied')
        })
    },
    disconnect() {
      if (!connected) return
      connected = false
      if (access) {
        access.onstatechange = null
        for (const input of access.inputs.values()) {
          input.onmidimessage = null
        }
        access = undefined
      }
      handlers.allNotesOff()
      handlers.sustain(false)
      setStatus('idle')
    },
    status() {
      return status
    },
  }
}

/** Default access request from the browser. Undefined when the API is missing. */
export function browserMidiAccess(): MidiAccessRequest | undefined {
  const navigatorWithMidi = globalThis.navigator as unknown as {
    requestMIDIAccess?: (options: { sysex: boolean }) => Promise<MidiAccessLike>
  } | undefined
  const request = navigatorWithMidi?.requestMIDIAccess
  if (!request) return undefined
  return () => request.call(navigatorWithMidi, { sysex: false })
}

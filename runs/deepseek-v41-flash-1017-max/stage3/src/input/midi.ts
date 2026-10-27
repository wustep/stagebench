/**
 * Web MIDI boundary.
 *
 * The whole surface the app needs is declared here, so tests can drive note-on,
 * note-off, sustain and the denied/disconnected cases with plain objects. Nothing in
 * this module touches `navigator` unless a caller asks for the browser access.
 */
export type MidiState = 'unsupported' | 'idle' | 'requesting' | 'ready' | 'denied' | 'error' | 'disconnected'

export interface MidiInputLike {
  id: string
  name?: string
  manufacturer?: string
  state?: string
  onmidimessage: ((event: { data: Uint8Array }) => void) | null
}

export interface MidiAccessLike {
  inputs: Map<string, MidiInputLike>
  onstatechange: ((event: { port?: MidiInputLike }) => void) | null
}

export type MidiAccessFactory = () => Promise<MidiAccessLike>

export interface MidiStatusReport {
  state: MidiState
  detail: string
  inputCount: number
  inputNames: string[]
}

export interface MidiBridgeOptions {
  requestAccess: MidiAccessFactory
  /** Called with a per-device owner key so two devices holding one note stay independent. */
  onNoteOn: (owner: string, midi: number, velocity: number) => void
  onNoteOff: (owner: string, midi: number) => void
  onSustain: (owner: string, down: boolean) => void
  /**
   * Continuous controller input the instrument documents: CC11 is the Control Pedal morph
   * source (specs/nord-stage-4.programs.json). Nothing else is mapped, and a controller
   * with no documented meaning is ignored rather than silently pretending to work.
   */
  onControl?: (owner: string, controller: number, value: number) => void
  onStatus: (report: MidiStatusReport) => void
  /** Called when every input disappears or the platform reports a disconnect. */
  onDisconnect: () => void
  /** Milliseconds to wait for the platform before reporting a stall. Defaults to 6000. */
  timeoutMs?: number
}

export interface MidiBridge {
  connect(): Promise<MidiStatusReport>
  status(): MidiStatusReport
  /** Prefix for every owner key this bridge hands out. */
  readonly ownerPrefix: string
  disconnect(): void
}

export const MIDI_OWNER_PREFIX = 'midi'

export function midiOwnerFor(inputId: string): string {
  return `${MIDI_OWNER_PREFIX}:${inputId}`
}

export interface MidiMessageHandlers {
  onNoteOn: (midi: number, velocity: number) => void
  onNoteOff: (midi: number) => void
  onSustain: (down: boolean) => void
  onAllNotesOff: () => void
  /** CC11 only: the Control Pedal morph source. */
  onControl?: (controller: number, value: number) => void
}

export type DecodedMidi =
  | { kind: 'note-on'; midi: number }
  | { kind: 'note-off'; midi: number }
  | { kind: 'sustain-on' }
  | { kind: 'sustain-off' }
  | { kind: 'all-notes-off' }
  | { kind: 'control'; controller: number; value: number }
  | { kind: 'ignored' }

/** The only continuous controller this instrument documents as an input. */
export const CONTROL_PEDAL_CC = 11

/**
 * Decodes one MIDI message. Exported so tests can assert the mapping directly and so
 * the byte-level contract is visible in one place.
 */
export function decodeMidiMessage(data: Uint8Array, handlers: MidiMessageHandlers): DecodedMidi {
  if (data.length < 1) return { kind: 'ignored' }
  const status = data[0] & 0xf0

  if (status === 0x90) {
    if (data.length < 3) return { kind: 'ignored' }
    const midi = data[1]
    const velocity = data[2]
    if (velocity === 0) {
      // Running status note-on with velocity 0 is the conventional note-off.
      handlers.onNoteOff(midi)
      return { kind: 'note-off', midi }
    }
    handlers.onNoteOn(midi, velocity / 127)
    return { kind: 'note-on', midi }
  }
  if (status === 0x80) {
    if (data.length < 2) return { kind: 'ignored' }
    handlers.onNoteOff(data[1])
    return { kind: 'note-off', midi: data[1] }
  }
  if (status === 0xb0 && data.length >= 3) {
    const controller = data[1]
    const value = data[2]
    if (controller === 64) {
      const down = value >= 64
      handlers.onSustain(down)
      return { kind: down ? 'sustain-on' : 'sustain-off' }
    }
    if (controller === 123) {
      handlers.onAllNotesOff()
      return { kind: 'all-notes-off' }
    }
    if (controller === CONTROL_PEDAL_CC) {
      handlers.onControl?.(controller, value)
      return { kind: 'control', controller, value }
    }
  }
  return { kind: 'ignored' }
}

/** Rejects with a TimeoutError if the platform never answers an access request. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      const error = new Error(`No answer within ${ms} ms`)
      error.name = 'TimeoutError'
      rejectPromise(error)
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolvePromise(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        rejectPromise(error)
      },
    )
  })
}

function inputNamesOf(source: MidiAccessLike): string[] {
  const names: string[] = []
  for (const input of source.inputs.values()) names.push(input.name || input.id)
  return names
}

export function createMidiBridge(options: MidiBridgeOptions): MidiBridge {
  const timeoutMs = options.timeoutMs ?? 6000
  let report: MidiStatusReport = {
    state: 'idle',
    detail: 'MIDI not connected',
    inputCount: 0,
    inputNames: [],
  }
  let access: MidiAccessLike | null = null
  const bonded = new Map<MidiInputLike, string>()
  let disposed = false

  function publish(next: MidiStatusReport): void {
    report = next
    options.onStatus(next)
  }

  function bind(input: MidiInputLike): void {
    const owner = midiOwnerFor(input.id)
    bonded.set(input, owner)
    input.onmidimessage = (event) => {
      decodeMidiMessage(event.data, {
        onNoteOn: (midi, velocity) => options.onNoteOn(owner, midi, velocity),
        onNoteOff: (midi) => options.onNoteOff(owner, midi),
        onSustain: (down) => options.onSustain(owner, down),
        onAllNotesOff: () => options.onDisconnect(),
        onControl: (controller, value) => options.onControl?.(owner, controller, value),
      })
    }
  }

  function unbind(input: MidiInputLike): void {
    input.onmidimessage = null
    bonded.delete(input)
  }

  function syncInputs(): void {
    if (!access) return
    const present = new Set<MidiInputLike>()
    for (const input of access.inputs.values()) {
      present.add(input)
      if (!bonded.has(input)) bind(input)
    }
    for (const input of Array.from(bonded.keys())) {
      if (!present.has(input)) unbind(input)
    }
    const names = inputNamesOf(access)
    if (present.size === 0) {
      options.onDisconnect()
      publish({
        state: 'disconnected',
        detail: 'MIDI device disconnected — keybed and computer keyboard still play',
        inputCount: 0,
        inputNames: [],
      })
      return
    }
    publish({
      state: 'ready',
      detail: `MIDI ready · ${names.join(', ')}`,
      inputCount: present.size,
      inputNames: names,
    })
  }

  return {
    ownerPrefix: MIDI_OWNER_PREFIX,

    async connect() {
      if (disposed) return report
      publish({ state: 'requesting', detail: 'Requesting MIDI access', inputCount: 0, inputNames: [] })
      try {
        const next = await withTimeout(options.requestAccess(), timeoutMs)
        if (disposed) {
          for (const input of next.inputs.values()) input.onmidimessage = null
          return report
        }
        access = next
        next.onstatechange = () => syncInputs()
        syncInputs()
        return report
      } catch (error) {
        const name = error instanceof Error ? error.name : ''
        const denied = name === 'SecurityError' || name === 'NotAllowedError'
        const unsupported = name === 'NotSupportedError'
        const timedOut = name === 'TimeoutError'
        publish({
          state: denied ? 'denied' : unsupported ? 'unsupported' : 'error',
          detail: denied
            ? 'MIDI access denied — keybed and computer keyboard still play'
            : unsupported
              ? 'Web MIDI unsupported in this browser — keybed and computer keyboard still play'
              : timedOut
                ? 'No MIDI answer from the browser — keybed and computer keyboard still play'
                : `MIDI unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
          inputCount: 0,
          inputNames: [],
        })
        return report
      }
    },

    status: () => report,

    disconnect() {
      for (const input of Array.from(bonded.keys())) unbind(input)
      if (access) access.onstatechange = null
      access = null
      options.onDisconnect()
      publish({ state: 'idle', detail: 'MIDI not connected', inputCount: 0, inputNames: [] })
    },
  }
}

/**
 * Browser access factory. Rejects with a named error rather than throwing when Web MIDI
 * is absent, so the caller's denied/unsupported path matches every other failure.
 * `adapt` converts the platform's MIDIAccess into the narrow shape the bridge uses.
 */
export function browserMidiAccess(
  adapt: (access: MIDIAccess) => MidiAccessLike,
): Promise<MidiAccessLike> {
  const nav =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> })
  if (!nav?.requestMIDIAccess) {
    const error = new Error('Web MIDI is not supported in this browser')
    error.name = 'NotSupportedError'
    return Promise.reject(error)
  }
  return nav.requestMIDIAccess().then(adapt)
}

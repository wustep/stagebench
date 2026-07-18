/**
 * Injectable Web MIDI boundary.
 *
 * The app calls `requestMidiAccess()` in the browser; tests inject a fake
 * `MidiAccessLike`. All MIDI state (available/denied/disconnected) is
 * reported truthfully to the status line.
 */

export interface MidiMessageLike {
  data: Uint8Array | number[] | null
}

export interface MidiInputLike {
  id: string
  name?: string | null
  state?: string
  onmidimessage: ((e: MidiMessageLike) => void) | null
}

export interface MidiAccessLike {
  inputs: { values(): IterableIterator<MidiInputLike> }
  onstatechange: ((e?: unknown) => void) | null
}

export type MidiStatus = 'unsupported' | 'pending' | 'ready' | 'denied' | 'disconnected'

export interface MidiCallbacks {
  noteOn: (note: number, velocity01: number) => void
  noteOff: (note: number) => void
  sustain: (down: boolean) => void
  /** CC11: Control Pedal morph source (programs spec). */
  controlPedal?: (position01: number) => void
  onStatus: (status: MidiStatus, detail?: string) => void
}

export function requestMidiAccess(): Promise<MidiAccessLike> {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { requestMIDIAccess?: () => Promise<unknown> }) : undefined
  if (!nav?.requestMIDIAccess) return Promise.reject(new Error('Web MIDI is not supported by this browser'))
  return nav.requestMIDIAccess() as Promise<MidiAccessLike>
}

/**
 * Wire a MidiAccessLike into the note lifecycle. Returns an unsubscribe
 * function that removes every listener it installed (disconnect/unmount
 * cleanup).
 */
export function attachMidi(access: MidiAccessLike, cb: MidiCallbacks): () => void {
  const attached = new Set<MidiInputLike>()

  const handle = (e: MidiMessageLike) => {
    const data = e.data
    if (!data || data.length < 3) return
    const status = data[0] & 0xf0
    const d1 = data[1]
    const d2 = data[2]
    if (status === 0x90 && d2 > 0) cb.noteOn(d1, d2 / 127)
    else if (status === 0x80 || (status === 0x90 && d2 === 0)) cb.noteOff(d1)
    else if (status === 0xb0 && d1 === 64) cb.sustain(d2 >= 64)
    else if (status === 0xb0 && d1 === 11) cb.controlPedal?.(d2 / 127)
  }

  const attachAll = () => {
    const inputs = [...access.inputs.values()]
    let connected = 0
    for (const input of inputs) {
      if (!attached.has(input)) {
        input.onmidimessage = handle
        attached.add(input)
      }
      if (input.state !== 'disconnected') connected++
    }
    cb.onStatus(connected > 0 ? 'ready' : 'disconnected')
  }

  access.onstatechange = attachAll
  attachAll()

  return () => {
    for (const input of attached) {
      if (input.onmidimessage === handle) input.onmidimessage = null
    }
    attached.clear()
    access.onstatechange = null
  }
}

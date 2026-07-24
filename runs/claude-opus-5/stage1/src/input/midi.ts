/**
 * Web MIDI boundary. The engine never touches `navigator` directly: a `RequestMidiAccess`
 * function is injected, so tests exercise granted, denied, unsupported and disconnected states
 * without a physical device.
 */

export interface MidiMessageEvent {
  readonly data: Uint8Array | null
}

export interface MidiInputLike {
  readonly id: string
  readonly name?: string | null
  readonly manufacturer?: string | null
  readonly state?: string
  onmidimessage: ((event: MidiMessageEvent) => void) | null
}

export interface MidiConnectionEvent {
  readonly port?: { readonly id?: string; readonly state?: string; readonly type?: string } | null
}

export interface MidiAccessLike {
  readonly inputs: {
    values(): IterableIterator<MidiInputLike>
  }
  onstatechange: ((event: MidiConnectionEvent) => void) | null
}

export type RequestMidiAccess = () => Promise<MidiAccessLike>

export type MidiPermission = 'unsupported' | 'requesting' | 'granted' | 'denied'

export interface MidiStatus {
  readonly permission: MidiPermission
  readonly inputNames: readonly string[]
  readonly message: string
}

export const MIDI_MESSAGES: Record<MidiPermission, string> = {
  unsupported: 'Web MIDI is not available in this browser.',
  requesting: 'Requesting MIDI access…',
  granted: 'MIDI connected.',
  denied: 'MIDI access was denied.',
}

export type ParsedMidi =
  | { type: 'noteOn'; note: number; velocity: number; channel: number }
  | { type: 'noteOff'; note: number; channel: number }
  | { type: 'sustain'; down: boolean; channel: number }
  | { type: 'allNotesOff'; channel: number }

const NOTE_OFF = 0x80
const NOTE_ON = 0x90
const CONTROL_CHANGE = 0xb0
const CC_SUSTAIN = 64
const CC_ALL_NOTES_OFF = 123
const CC_ALL_SOUND_OFF = 120

/** Pure parser for the messages the piano cares about. Returns null for anything else. */
export function parseMidiMessage(data: Uint8Array | null | undefined): ParsedMidi | null {
  if (!data || data.length < 2) return null
  const status = data[0] & 0xf0
  const channel = data[0] & 0x0f

  if (status === NOTE_ON) {
    const velocity = data[2] ?? 0
    if (velocity === 0) return { type: 'noteOff', note: data[1], channel }
    return { type: 'noteOn', note: data[1], velocity, channel }
  }
  if (status === NOTE_OFF) return { type: 'noteOff', note: data[1], channel }
  if (status === CONTROL_CHANGE) {
    const controller = data[1]
    const value = data[2] ?? 0
    if (controller === CC_SUSTAIN) return { type: 'sustain', down: value >= 64, channel }
    if (controller === CC_ALL_NOTES_OFF || controller === CC_ALL_SOUND_OFF) {
      return { type: 'allNotesOff', channel }
    }
  }
  return null
}

/** MIDI velocity 1..127 mapped to the 0..1 velocity the engine uses. */
export function midiVelocityToUnit(velocity: number): number {
  return Math.min(1, Math.max(0.01, velocity / 127))
}

export function browserRequestMidiAccess(): RequestMidiAccess | null {
  if (typeof navigator === 'undefined') return null
  const scope = navigator as unknown as {
    requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MidiAccessLike>
  }
  if (typeof scope.requestMIDIAccess !== 'function') return null
  return () => scope.requestMIDIAccess!({ sysex: false })
}

export function inputNamesOf(access: MidiAccessLike): string[] {
  const names: string[] = []
  for (const input of access.inputs.values()) {
    names.push(input.name ?? input.id)
  }
  return names
}

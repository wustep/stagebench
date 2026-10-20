import { describe, expect, it } from 'vitest'
import { createMidiController, MIDI_SOURCE, type MidiAccessLike, type MidiHandlers, type MidiInputLike, type MidiStatus } from './midi'

class FakeMidiInput implements MidiInputLike {
  onmidimessage: ((event: { data: Uint8Array }) => void) | null = null
  state: 'connected' | 'disconnected' = 'connected'
  constructor(readonly id: string) {}
  send(bytes: number[]) {
    this.onmidimessage?.({ data: Uint8Array.from(bytes) })
  }
}

function fakeAccess(inputs: FakeMidiInput[]) {
  const map = new Map(inputs.map((input) => [input.id, input] as const))
  const access: MidiAccessLike & { plug(input: FakeMidiInput): void; unplug(id: string): void } = {
    inputs: map,
    onstatechange: null,
    plug(input) {
      map.set(input.id, input)
      access.onstatechange?.({})
    },
    unplug(id) {
      const input = map.get(id)
      if (input) input.state = 'disconnected'
      map.delete(id)
      access.onstatechange?.({})
    },
  }
  return access
}

function recorder() {
  const calls: string[] = []
  const statuses: MidiStatus[] = []
  const handlers: MidiHandlers = {
    noteOn: (note, velocity) => calls.push(`on ${note} ${velocity}`),
    noteOff: (note) => calls.push(`off ${note}`),
    sustain: (on) => calls.push(`sustain ${on}`),
    allNotesOff: () => calls.push('all-off'),
    onStatus: (status) => statuses.push(status),
  }
  return { calls, statuses, handlers }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('MIDI input (Web MIDI boundary, no device needed)', () => {
  it('reports unsupported without throwing when Web MIDI is missing', () => {
    const { statuses, handlers } = recorder()
    const midi = createMidiController(undefined, handlers)
    midi.connect()
    expect(statuses).toEqual(['unsupported'])
    expect(midi.status()).toBe('unsupported')
  })

  it('reports denied when access is refused, and keeps the piano playable (no throw)', async () => {
    const { statuses, handlers } = recorder()
    const midi = createMidiController(() => Promise.reject(new Error('NotAllowedError')), handlers)
    midi.connect()
    await flush()
    expect(statuses.at(-1)).toBe('denied')
  })

  it('reports disconnected when access is granted but no input is present', async () => {
    const { statuses, handlers } = recorder()
    const access = fakeAccess([])
    const midi = createMidiController(() => Promise.resolve(access), handlers)
    midi.connect()
    await flush()
    expect(statuses.at(-1)).toBe('disconnected')
  })

  it('turns note-on, velocity, and note-off into intents', async () => {
    const { calls, statuses, handlers } = recorder()
    const input = new FakeMidiInput('keys')
    const midi = createMidiController(() => Promise.resolve(fakeAccess([input])), handlers)
    midi.connect()
    await flush()
    expect(statuses.at(-1)).toBe('ready')

    input.send([0x90, 60, 96])
    input.send([0x91, 62, 0]) // velocity 0 on any channel is a note-off
    input.send([0x80, 64, 40])
    expect(calls).toEqual(['on 60 96', 'off 62', 'off 64'])
  })

  it('maps CC64 at or above 64 to sustain on and below to sustain off', async () => {
    const { calls, handlers } = recorder()
    const input = new FakeMidiInput('keys')
    const midi = createMidiController(() => Promise.resolve(fakeAccess([input])), handlers)
    midi.connect()
    await flush()

    input.send([0xb0, 64, 127])
    input.send([0xb0, 64, 63])
    expect(calls).toEqual(['sustain true', 'sustain false'])
  })

  it('ignores unrelated messages', async () => {
    const { calls, handlers } = recorder()
    const input = new FakeMidiInput('keys')
    const midi = createMidiController(() => Promise.resolve(fakeAccess([input])), handlers)
    midi.connect()
    await flush()
    input.send([0xe0, 0, 64]) // pitch bend
    input.send([0xb0, 1, 127]) // mod wheel
    expect(calls).toEqual([])
  })

  it('releases MIDI notes when the last input is unplugged, then recovers when one returns', async () => {
    const { calls, statuses, handlers } = recorder()
    const input = new FakeMidiInput('keys')
    const access = fakeAccess([input])
    const midi = createMidiController(() => Promise.resolve(access), handlers)
    midi.connect()
    await flush()

    access.unplug('keys')
    expect(statuses.at(-1)).toBe('disconnected')
    expect(calls).toContain('all-off')
    expect(calls).toContain('sustain false')

    access.plug(new FakeMidiInput('keys-2'))
    expect(statuses.at(-1)).toBe('ready')
  })

  it('disconnect clears MIDI-owned notes and sustain and detaches handlers', async () => {
    const { calls, handlers } = recorder()
    const input = new FakeMidiInput('keys')
    const midi = createMidiController(() => Promise.resolve(fakeAccess([input])), handlers)
    midi.connect()
    await flush()
    midi.disconnect()

    expect(calls).toEqual(['all-off', 'sustain false'])
    expect(input.onmidimessage).toBeNull()
    expect(midi.status()).toBe('idle')
  })

  it('tags MIDI notes with the midi source so other inputs are never released by it', () => {
    expect(MIDI_SOURCE).toBe('midi')
  })
})

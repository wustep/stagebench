import { describe, expect, it, vi } from 'vitest'
import { MidiInput, parseMidiMessage, type MidiAccessLike } from './MidiInput'

describe('MIDI message parsing', () => {
  it('parses note on, note-off including zero velocity, and sustain CC64', () => {
    expect(parseMidiMessage([0x90, 60, 101])).toEqual({ type: 'note-on', note: 60, velocity: 101 })
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({ type: 'note-off', note: 60 })
    expect(parseMidiMessage([0x80, 61, 64])).toEqual({ type: 'note-off', note: 61 })
    expect(parseMidiMessage([0xb0, 64, 127])).toEqual({ type: 'sustain', down: true })
    expect(parseMidiMessage([0xb0, 64, 0])).toEqual({ type: 'sustain', down: false })
    expect(parseMidiMessage([0xe0, 0, 0])).toBeNull()
  })
})

describe('MIDI connection states', () => {
  it('reports disconnected when access is available but no inputs exist', async () => {
    const access: MidiAccessLike = { inputs: new Map(), onstatechange: null }
    const input = new MidiInput(async () => access, { noteOn: vi.fn(), noteOff: vi.fn(), sustain: vi.fn() })
    await expect(input.connect()).resolves.toBe('disconnected')
  })

  it('reports permission denied without throwing', async () => {
    const denied = new DOMException('denied', 'NotAllowedError')
    const input = new MidiInput(async () => { throw denied }, { noteOn: vi.fn(), noteOff: vi.fn(), sustain: vi.fn() })
    await expect(input.connect()).resolves.toBe('permission-denied')
  })

  it('routes messages from connected MIDI inputs', async () => {
    const port = { name: 'Test Keys', onmidimessage: null as ((event: { data: Uint8Array }) => void) | null }
    const access: MidiAccessLike = { inputs: new Map([['1', port]]), onstatechange: null }
    const noteOn = vi.fn()
    const sustain = vi.fn()
    const input = new MidiInput(async () => access, { noteOn, noteOff: vi.fn(), sustain })
    await expect(input.connect()).resolves.toBe('connected')
    port.onmidimessage?.({ data: new Uint8Array([0x90, 67, 120]) })
    port.onmidimessage?.({ data: new Uint8Array([0xb0, 64, 127]) })
    expect(noteOn).toHaveBeenCalledWith(67, 120)
    expect(sustain).toHaveBeenCalledWith(true)
  })
})

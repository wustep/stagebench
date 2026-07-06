import { describe, expect, it } from 'vitest'
import { parseMidiFile } from './midi-file'

/** Tiny SMF builder helpers so tests read as musical intent, not bytes. */
function vlq(value: number): number[] {
  const bytes = [value & 0x7f]
  let rest = value >> 7
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80)
    rest >>= 7
  }
  return bytes
}

function u16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff]
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0))
}

function buildSmf(trackBody: number[], { ticksPerQuarter = 480, format = 0, tracks = 1 } = {}): ArrayBuffer {
  const header = [...ascii('MThd'), ...u32(6), ...u16(format), ...u16(tracks), ...u16(ticksPerQuarter)]
  const track = [...ascii('MTrk'), ...u32(trackBody.length), ...trackBody]
  return new Uint8Array([...header, ...track]).buffer
}

const END_OF_TRACK = [...vlq(0), 0xff, 0x2f, 0x00]

describe('parseMidiFile', () => {
  it('parses note on/off timing at the default 120 BPM', () => {
    // At 120 BPM one quarter note (480 ticks) = 0.5s.
    const body = [
      ...vlq(0),
      0x90,
      60,
      100, // note on C4, tick 0
      ...vlq(480),
      0x80,
      60,
      0, // note off C4, tick 480 (0.5s)
      ...END_OF_TRACK,
    ]
    const parsed = parseMidiFile(buildSmf(body), 'song.mid')
    expect(parsed.name).toBe('song.mid')
    expect(parsed.events).toHaveLength(2)
    expect(parsed.events[0]).toMatchObject({ type: 'noteOn', midi: 60, time: 0 })
    expect(parsed.events[0].value).toBeCloseTo(100 / 127)
    expect(parsed.events[1]).toMatchObject({ type: 'noteOff', midi: 60 })
    expect(parsed.events[1].time).toBeCloseTo(0.5)
    expect(parsed.durationSec).toBeCloseTo(0.5)
  })

  it('treats note-on with zero velocity as note-off', () => {
    const body = [...vlq(0), 0x90, 64, 0, ...END_OF_TRACK]
    const parsed = parseMidiFile(buildSmf(body))
    expect(parsed.events[0]).toMatchObject({ type: 'noteOff', midi: 64 })
  })

  it('honors a set-tempo meta event', () => {
    // 60 BPM = 1,000,000 us/quarter, so 480 ticks = 1s.
    const tempo = [...vlq(0), 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40]
    const body = [...tempo, ...vlq(0), 0x90, 60, 80, ...vlq(480), 0x80, 60, 0, ...END_OF_TRACK]
    const parsed = parseMidiFile(buildSmf(body))
    expect(parsed.events[1].time).toBeCloseTo(1)
  })

  it('follows running status for consecutive note-ons', () => {
    const body = [
      ...vlq(0),
      0x90,
      60,
      100, // explicit status
      ...vlq(10),
      62,
      100, // running status reuses 0x90
      ...END_OF_TRACK,
    ]
    const parsed = parseMidiFile(buildSmf(body))
    expect(parsed.events).toHaveLength(2)
    expect(parsed.events.map((event) => event.midi)).toEqual([60, 62])
  })

  it('captures sustain (CC64) events', () => {
    const body = [...vlq(0), 0xb0, 64, 127, ...vlq(240), 0xb0, 64, 0, ...END_OF_TRACK]
    const parsed = parseMidiFile(buildSmf(body))
    expect(parsed.events).toHaveLength(2)
    expect(parsed.events[0]).toMatchObject({ type: 'sustain' })
    expect(parsed.events[0].value).toBeCloseTo(1)
    expect(parsed.events[1].value).toBeCloseTo(0)
  })

  it('counts notes outside the keybed range', () => {
    // MIDI 21 (A0) is below the 73-key keybed's low E1 (28).
    const body = [...vlq(0), 0x90, 21, 90, ...vlq(0), 0x90, 60, 90, ...END_OF_TRACK]
    const parsed = parseMidiFile(buildSmf(body))
    expect(parsed.outOfRangeNotes).toBe(1)
  })

  it('rejects a non-MIDI buffer', () => {
    expect(() => parseMidiFile(new Uint8Array([1, 2, 3, 4]).buffer)).toThrow(/MIDI/)
  })
})

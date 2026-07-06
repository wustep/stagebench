/**
 * Minimal, dependency-free Standard MIDI File (SMF) parser.
 *
 * Parses format 0/1 files down to a single, time-sorted list of note
 * on/off events with absolute times in seconds (tempo map applied). This is
 * deliberately small: it decodes exactly what the showcase can honestly play
 * — note on/off and sustain (CC64) — and skips everything else (program
 * changes, pitch bend, SysEx, lyrics). Timing honors set-tempo meta events
 * and both ticks-per-quarter and SMPTE division.
 */

export type MidiFileEventType = 'noteOn' | 'noteOff' | 'sustain'

export interface MidiFileEvent {
  /** Absolute time from the start of the song, in seconds. */
  time: number
  type: MidiFileEventType
  /** MIDI note number for note events; unused (0) for sustain. */
  midi: number
  /** 0..1 for note velocity; 0..1 pedal depth for sustain. */
  value: number
}

export interface ParsedMidiFile {
  name: string
  durationSec: number
  events: MidiFileEvent[]
  /** Notes present in the file but outside the keybed range (28..100). */
  outOfRangeNotes: number
}

class ByteReader {
  private pos = 0
  constructor(private readonly view: DataView) {}

  get offset(): number {
    return this.pos
  }

  get remaining(): number {
    return this.view.byteLength - this.pos
  }

  seek(pos: number): void {
    this.pos = pos
  }

  u8(): number {
    return this.view.getUint8(this.pos++)
  }

  u16(): number {
    const value = this.view.getUint16(this.pos)
    this.pos += 2
    return value
  }

  u32(): number {
    const value = this.view.getUint32(this.pos)
    this.pos += 4
    return value
  }

  bytes(length: number): void {
    this.pos += length
  }

  chunkId(): string {
    let id = ''
    for (let i = 0; i < 4; i += 1) id += String.fromCharCode(this.u8())
    return id
  }

  /** Variable-length quantity (7 bits per byte, MSB = continue). */
  vlq(): number {
    let value = 0
    for (let i = 0; i < 4; i += 1) {
      const byte = this.u8()
      value = (value << 7) | (byte & 0x7f)
      if ((byte & 0x80) === 0) break
    }
    return value
  }
}

/** An event with an absolute tick, kept before the tempo map is applied. */
interface TickEvent {
  tick: number
  /** Sort priority so tempo changes at the same tick apply before notes. */
  order: number
  type: MidiFileEventType | 'tempo'
  midi: number
  value: number
}

const DEFAULT_TEMPO_US = 500_000 // 120 BPM
const KEYBED_FIRST = 28
const KEYBED_LAST = 100

/** Parse a raw .mid/.midi ArrayBuffer into playable, time-sorted events. */
export function parseMidiFile(data: ArrayBuffer, name = 'MIDI file'): ParsedMidiFile {
  const reader = new ByteReader(new DataView(data))
  if (reader.remaining < 14 || reader.chunkId() !== 'MThd') {
    throw new Error('Not a MIDI file (missing MThd header)')
  }
  const headerLength = reader.u32()
  reader.u16() // format (0/1/2) — handled uniformly by merging all tracks
  const trackCount = reader.u16()
  const division = reader.u16()
  // Skip any header bytes beyond the standard 6 (spec allows extensions).
  reader.seek(8 + headerLength)

  // SMPTE timing when the high bit is set: -frames per second, ticks/frame.
  const smpte = (division & 0x8000) !== 0
  const ticksPerSecond = smpte ? (0x100 - ((division >> 8) & 0xff)) * (division & 0xff) : 0
  const ticksPerQuarter = smpte ? 0 : division || 480

  const tickEvents: TickEvent[] = []
  let outOfRangeNotes = 0

  for (let track = 0; track < trackCount; track += 1) {
    if (reader.remaining < 8) break
    const id = reader.chunkId()
    const length = reader.u32()
    const end = reader.offset + length
    if (id !== 'MTrk') {
      reader.seek(end) // unknown chunk type: skip per spec
      continue
    }
    let tick = 0
    let runningStatus = 0
    while (reader.offset < end) {
      tick += reader.vlq()
      let status = reader.u8()
      if ((status & 0x80) === 0) {
        // Running status: reuse the previous status, rewind the data byte.
        reader.seek(reader.offset - 1)
        status = runningStatus
      } else {
        runningStatus = status
      }
      const command = status & 0xf0

      if (status === 0xff) {
        const metaType = reader.u8()
        const metaLength = reader.vlq()
        if (metaType === 0x51 && metaLength === 3) {
          const us = (reader.u8() << 16) | (reader.u8() << 8) | reader.u8()
          tickEvents.push({ tick, order: 0, type: 'tempo', midi: 0, value: us })
        } else {
          reader.bytes(metaLength)
        }
        continue
      }
      if (status === 0xf0 || status === 0xf7) {
        reader.bytes(reader.vlq()) // SysEx: ignored
        continue
      }

      switch (command) {
        case 0x90: {
          const note = reader.u8()
          const velocity = reader.u8()
          if (note < KEYBED_FIRST || note > KEYBED_LAST) outOfRangeNotes += 1
          // Note-on with zero velocity is the conventional note-off.
          if (velocity === 0) {
            tickEvents.push({ tick, order: 1, type: 'noteOff', midi: note, value: 0 })
          } else {
            tickEvents.push({ tick, order: 2, type: 'noteOn', midi: note, value: velocity / 127 })
          }
          break
        }
        case 0x80: {
          const note = reader.u8()
          reader.u8() // release velocity: unused
          tickEvents.push({ tick, order: 1, type: 'noteOff', midi: note, value: 0 })
          break
        }
        case 0xb0: {
          const cc = reader.u8()
          const value = reader.u8()
          if (cc === 64) tickEvents.push({ tick, order: 1, type: 'sustain', midi: 0, value: value / 127 })
          break
        }
        case 0xa0: // poly aftertouch (2 data bytes)
        case 0xe0: // pitch bend (2 data bytes)
          reader.bytes(2)
          break
        case 0xc0: // program change (1 data byte)
        case 0xd0: // channel pressure (1 data byte)
          reader.bytes(1)
          break
        default:
          // Unknown/malformed status: bail out of this track to stay in sync.
          reader.seek(end)
          break
      }
    }
    reader.seek(end)
  }

  // Stable-sort by tick, then by order so tempo/offs precede ons at a tick.
  tickEvents.sort((a, b) => a.tick - b.tick || a.order - b.order)

  const events: MidiFileEvent[] = []
  let seconds = 0
  let lastTick = 0
  let tempoUs = DEFAULT_TEMPO_US
  const secondsPerTick = () => (smpte ? 1 / ticksPerSecond : tempoUs / 1_000_000 / ticksPerQuarter)

  for (const event of tickEvents) {
    seconds += (event.tick - lastTick) * secondsPerTick()
    lastTick = event.tick
    if (event.type === 'tempo') {
      tempoUs = event.value
      continue
    }
    events.push({ time: seconds, type: event.type, midi: event.midi, value: event.value })
  }

  return {
    name,
    durationSec: events.length > 0 ? events[events.length - 1].time : 0,
    events,
    outOfRangeNotes,
  }
}

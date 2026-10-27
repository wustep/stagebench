import { describe, expect, it, beforeEach } from 'vitest'
import { createPianoSession, type PianoSession } from '../audio/noteSession'
import { createManualClock, type ManualClock } from '../audio/clock'
import { createRecordingEngine, type RecordingEngine } from '../audio/fakes'
import { VARIANT } from '../hardware/variant'
import {
  KEYBOARD_BASE_MIDI,
  KEY_MAPPINGS,
  SUSTAIN_KEY_CODE,
  SUSTAIN_KEY_LABEL,
  mappedMidiRange,
  midiForCode,
} from '../input/keyboardMap'
import {
  MIDI_OWNER_PREFIX,
  createMidiBridge,
  decodeMidiMessage,
  midiOwnerFor,
  type MidiAccessLike,
  type MidiInputLike,
  type MidiStatusReport,
} from '../input/midi'

/**
 * piano.basic-inputs — pointer, independent multi-touch, mapped computer keyboard with
 * repeat suppression, MIDI note/velocity/sustain, and denied/disconnected MIDI.
 *
 * Every case drives the same `PianoSession` the UI uses, with fakes at the boundaries.
 */

function makeSession(): { session: PianoSession; engine: RecordingEngine; clock: ManualClock } {
  const engine = createRecordingEngine()
  const clock = createManualClock()
  const session = createPianoSession({
    engine,
    clock,
    lowestMidi: VARIANT.lowestMidi,
    highestMidi: VARIANT.highestMidi,
  })
  return { session, engine, clock }
}

describe('piano.basic-inputs — pointer and multi-touch', () => {
  let session: PianoSession
  let engine: RecordingEngine

  beforeEach(() => {
    ;({ session, engine } = makeSession())
  })

  it('treats each pointer as an independent owner', () => {
    // Two fingers, two different notes, at the same moment.
    session.press({ midi: 55, velocity: 0.7, source: 'pointer', owner: 'pointer:1' })
    session.press({ midi: 67, velocity: 0.6, source: 'pointer', owner: 'pointer:2' })
    expect(session.snapshot().held).toEqual([55, 67])
    expect(engine.activeVoiceCount()).toBe(2)

    // Lifting one finger leaves the other note sounding.
    session.release('pointer', 'pointer:1', 55)
    expect(session.snapshot().held).toEqual([67])
    expect(engine.activeVoiceCount()).toBe(1)

    session.release('pointer', 'pointer:2', 67)
    expect(session.snapshot().sounding).toEqual([])
  })

  it('keeps a glissando from a single pointer to one sounding note at a time', () => {
    // A drag across keys releases the previous note before starting the next.
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'pointer:1' })
    session.release('pointer', 'pointer:1', 60)
    session.press({ midi: 62, velocity: 0.7, source: 'pointer', owner: 'pointer:1' })
    expect(session.snapshot().held).toEqual([62])
    expect(engine.activeVoiceCount()).toBe(1)
    expect(engine.endedVoices).toHaveLength(1)
  })

  it('cancels a pointer cleanly without leaving a voice behind', () => {
    session.press({ midi: 64, velocity: 0.4, source: 'pointer', owner: 'pointer:7' })
    // pointercancel is the same path as pointerup for the session.
    session.release('pointer', 'pointer:7', 64)
    expect(engine.activeVoiceCount()).toBe(0)
    expect(session.snapshot().voices).toHaveLength(0)
  })

  it('supports five simultaneous touch points', () => {
    const midis = [48, 52, 55, 59, 62]
    midis.forEach((midi, i) => {
      session.press({ midi, velocity: 0.5 + i * 0.05, source: 'pointer', owner: `touch:${i}` })
    })
    expect(session.snapshot().held).toEqual(midis.toSorted((a, b) => a - b))
    midis.forEach((midi, i) => session.release('pointer', `touch:${i}`, midi))
    expect(session.snapshot().sounding).toEqual([])
  })
})

describe('piano.basic-inputs — mapped computer keyboard', () => {
  it('maps two full octaves starting at C3', () => {
    expect(KEYBOARD_BASE_MIDI).toBe(48)
    const range = mappedMidiRange()
    expect(range.lowest).toBe(48)
    expect(range.highest).toBe(76)
    // Every mapping lands inside the instrument's 73-key range.
    for (const mapping of KEY_MAPPINGS) {
      const midi = KEYBOARD_BASE_MIDI + mapping.offset
      expect(midi).toBeGreaterThanOrEqual(VARIANT.lowestMidi)
      expect(midi).toBeLessThanOrEqual(VARIANT.highestMidi)
    }
  })

  it('places semitones on the expected physical keys', () => {
    expect(midiForCode('KeyZ')).toBe(48) // C3
    expect(midiForCode('KeyS')).toBe(49) // C#3
    expect(midiForCode('KeyX')).toBe(50) // D3
    expect(midiForCode('KeyQ')).toBe(60) // C4
    expect(midiForCode('KeyP')).toBe(76) // E5
    expect(midiForCode('KeyA')).toBeUndefined()
  })

  it('suppresses auto-repeat so a held key strikes exactly once', () => {
    const { session, engine } = makeSession()
    // The UI keeps a held-code set; the session also ignores a duplicate owner press.
    const held = new Set<string>()
    const strike = (code: string, repeat: boolean) => {
      if (repeat) return
      if (held.has(code)) return
      held.add(code)
      session.press({ midi: midiForCode(code)!, velocity: 0.78, source: 'keyboard', owner: `keyboard:${code}` })
    }
    strike('KeyZ', false)
    strike('KeyZ', true)
    strike('KeyZ', true)
    expect(engine.startedVoices).toHaveLength(1)
    expect(session.snapshot().held).toEqual([48])
  })

  it('releases the mapped note on key up', () => {
    const { session, engine } = makeSession()
    session.press({ midi: 60, velocity: 0.78, source: 'keyboard', owner: 'keyboard:KeyQ' })
    session.release('keyboard', 'keyboard:KeyQ', 60)
    expect(engine.endedVoices).toHaveLength(1)
    expect(session.snapshot().sounding).toEqual([])
  })

  it('uses space as the sustain pedal and labels it', () => {
    expect(SUSTAIN_KEY_CODE).toBe('Space')
    expect(SUSTAIN_KEY_LABEL).toBe('SPACE')
    const { session } = makeSession()
    session.setSustain(true, `keyboard:${SUSTAIN_KEY_CODE}`)
    expect(session.snapshot().sustainPedal).toBe(true)
    session.setSustain(false, `keyboard:${SUSTAIN_KEY_CODE}`)
    expect(session.snapshot().sustainPedal).toBe(false)
  })

  it('clears every held note on blur', () => {
    const { session, engine } = makeSession()
    session.press({ midi: 48, velocity: 0.7, source: 'keyboard', owner: 'keyboard:KeyZ' })
    session.press({ midi: 55, velocity: 0.7, source: 'keyboard', owner: 'keyboard:KeyG' })
    session.setSustain(true, 'keyboard:Space')
    session.allNotesOff('blur')
    expect(engine.activeVoiceCount()).toBe(0)
    expect(session.snapshot().sounding).toEqual([])
    expect(session.snapshot().sustainPedal).toBe(false)
  })
})

describe('piano.basic-inputs — MIDI', () => {
  it('decodes note on with velocity, note off, and velocity-0 note off', () => {
    const seen: string[] = []
    const handlers = {
      onNoteOn: (midi: number, velocity: number) => seen.push(`on:${midi}:${velocity.toFixed(3)}`),
      onNoteOff: (midi: number) => seen.push(`off:${midi}`),
      onSustain: (down: boolean) => seen.push(`sus:${down}`),
      onAllNotesOff: () => seen.push('all-off'),
    }
    expect(decodeMidiMessage(new Uint8Array([0x90, 60, 127]), handlers)).toEqual({ kind: 'note-on', midi: 60 })
    expect(decodeMidiMessage(new Uint8Array([0x80, 60, 0]), handlers)).toEqual({ kind: 'note-off', midi: 60 })
    expect(decodeMidiMessage(new Uint8Array([0x90, 62, 0]), handlers)).toEqual({ kind: 'note-off', midi: 62 })
    expect(decodeMidiMessage(new Uint8Array([0xb0, 64, 127]), handlers)).toEqual({ kind: 'sustain-on' })
    expect(decodeMidiMessage(new Uint8Array([0xb0, 64, 0]), handlers)).toEqual({ kind: 'sustain-off' })
    expect(decodeMidiMessage(new Uint8Array([0xb0, 123, 0]), handlers)).toEqual({ kind: 'all-notes-off' })
    expect(seen).toEqual(['on:60:1.000', 'off:60', 'off:62', 'sus:true', 'sus:false', 'all-off'])
  })

  it('ignores unrelated messages and malformed packets', () => {
    const handlers = {
      onNoteOn: () => undefined,
      onNoteOff: () => undefined,
      onSustain: () => undefined,
      onAllNotesOff: () => undefined,
    }
    expect(decodeMidiMessage(new Uint8Array([]), handlers).kind).toBe('ignored')
    expect(decodeMidiMessage(new Uint8Array([0x90, 60]), handlers).kind).toBe('ignored')
    expect(decodeMidiMessage(new Uint8Array([0xe0, 0, 64]), handlers).kind).toBe('ignored')
    expect(decodeMidiMessage(new Uint8Array([0xb0, 7, 100]), handlers).kind).toBe('ignored')
  })

  it('plays notes and sustains from a MIDI device', async () => {
    const { session, engine } = makeSession()
    const input = createFakeInput('dev-1', 'Nord Pedal Keys')
    const access = createFakeAccess([input])
    const reports: MidiStatusReport[] = []
    const bridge = createMidiBridge({
      requestAccess: () => Promise.resolve(access),
      onNoteOn: (owner, midi, velocity) => session.press({ midi, velocity, source: 'midi', owner }),
      onNoteOff: (owner, midi) => session.release('midi', owner, midi),
      onSustain: (owner, down) => session.setSustain(down, owner),
      onStatus: (report) => reports.push(report),
      onDisconnect: () => session.allNotesOff('midi-disconnect'),
    })

    const report = await bridge.connect()
    expect(report.state).toBe('ready')
    expect(report.inputCount).toBe(1)
    expect(reports.at(-1)?.inputNames).toEqual(['Nord Pedal Keys'])

    const owner = midiOwnerFor('dev-1')
    expect(owner.startsWith(`${MIDI_OWNER_PREFIX}:`)).toBe(true)

    input.emit([0x90, 64, 100])
    expect(session.snapshot().held).toEqual([64])
    expect(session.snapshot().velocities[64]).toBeCloseTo(100 / 127, 5)
    expect(engine.startedVoices).toHaveLength(1)

    input.emit([0xb0, 64, 127])
    input.emit([0x80, 64, 0])
    // Pedal is down, so the released key keeps sounding.
    expect(session.snapshot().held).toEqual([])
    expect(session.snapshot().sustained).toEqual([64])
    expect(engine.activeVoiceCount()).toBe(1)

    input.emit([0xb0, 64, 0])
    expect(session.snapshot().sounding).toEqual([])
    expect(engine.activeVoiceCount()).toBe(0)
  })

  it('reports denied MIDI access truthfully and keeps the keybed usable', async () => {
    const { session } = makeSession()
    const denied = Object.assign(new Error('The request is not allowed'), { name: 'SecurityError' })
    const reports: MidiStatusReport[] = []
    const bridge = createMidiBridge({
      requestAccess: () => Promise.reject(denied),
      onNoteOn: (owner, midi, velocity) => session.press({ midi, velocity, source: 'midi', owner }),
      onNoteOff: (owner, midi) => session.release('midi', owner, midi),
      onSustain: (owner, down) => session.setSustain(down, owner),
      onStatus: (report) => reports.push(report),
      onDisconnect: () => session.allNotesOff('midi-disconnect'),
    })
    const report = await bridge.connect()
    expect(report.state).toBe('denied')
    expect(report.detail).toMatch(/denied/i)
    // The keybed still plays.
    session.press({ midi: 60, velocity: 0.7, source: 'pointer', owner: 'pointer:1' })
    expect(session.snapshot().held).toEqual([60])
  })

  it('reports unsupported Web MIDI without throwing', async () => {
    const { session } = makeSession()
    const reports: MidiStatusReport[] = []
    const bridge = createMidiBridge({
      requestAccess: () =>
        Promise.reject(Object.assign(new Error('nope'), { name: 'NotSupportedError' })),
      onNoteOn: () => undefined,
      onNoteOff: () => undefined,
      onSustain: () => undefined,
      onStatus: (report) => reports.push(report),
      onDisconnect: () => session.allNotesOff('midi-disconnect'),
    })
    const report = await bridge.connect()
    expect(report.state).toBe('unsupported')
    expect(report.inputCount).toBe(0)
  })

  it('stops every voice when the MIDI device disconnects', async () => {
    const { session, engine } = makeSession()
    const input = createFakeInput('dev-2', 'Stage Piano')
    const access = createFakeAccess([input])
    const bridge = createMidiBridge({
      requestAccess: () => Promise.resolve(access),
      onNoteOn: (owner, midi, velocity) => session.press({ midi, velocity, source: 'midi', owner }),
      onNoteOff: (owner, midi) => session.release('midi', owner, midi),
      onSustain: (owner, down) => session.setSustain(down, owner),
      onStatus: () => undefined,
      onDisconnect: () => session.allNotesOff('midi-disconnect'),
    })
    await bridge.connect()
    input.emit([0x90, 60, 90])
    input.emit([0xb0, 64, 127])
    input.emit([0x80, 60, 0])
    expect(engine.activeVoiceCount()).toBe(1)

    // The port disappears and the platform reports it.
    access.inputs.clear()
    input.onmidimessage = null
    access.onstatechange?.({ port: input })
    expect(engine.activeVoiceCount()).toBe(0)
    expect(session.lastAllNotesOffReason()).toBe('midi-disconnect')
    expect(bridge.status().state).toBe('disconnected')
  })

  it('unbinds its handler when disconnected and stops delivering messages', async () => {
    const { session } = makeSession()
    const input = createFakeInput('dev-3', 'Keys')
    const access = createFakeAccess([input])
    const bridge = createMidiBridge({
      requestAccess: () => Promise.resolve(access),
      onNoteOn: (owner, midi, velocity) => session.press({ midi, velocity, source: 'midi', owner }),
      onNoteOff: (owner, midi) => session.release('midi', owner, midi),
      onSustain: (owner, down) => session.setSustain(down, owner),
      onStatus: () => undefined,
      onDisconnect: () => session.allNotesOff('midi-disconnect'),
    })
    await bridge.connect()
    expect(input.onmidimessage).not.toBeNull()
    bridge.disconnect()
    expect(input.onmidimessage).toBeNull()
    expect(bridge.status().state).toBe('idle')
  })
})

function createFakeInput(id: string, name: string): MidiInputLike & { emit(data: number[]): void } {
  const input: MidiInputLike & { emit(data: number[]): void } = {
    id,
    name,
    manufacturer: 'Test',
    state: 'connected',
    onmidimessage: null,
    emit(data: number[]) {
      input.onmidimessage?.({ data: new Uint8Array(data) })
    },
  }
  return input
}

function createFakeAccess(inputs: MidiInputLike[]): MidiAccessLike {
  const map = new Map<string, MidiInputLike>()
  for (const input of inputs) map.set(input.id, input)
  return { inputs: map, onstatechange: null }
}

describe('piano.basic-inputs — a stalled MIDI request reports honestly', () => {
  it('times out instead of staying in the requesting state forever', async () => {
    const reports: MidiStatusReport[] = []
    const bridge = createMidiBridge({
      requestAccess: () => new Promise<MidiAccessLike>(() => undefined),
      onNoteOn: () => undefined,
      onNoteOff: () => undefined,
      onSustain: () => undefined,
      onStatus: (report) => reports.push(report),
      onDisconnect: () => undefined,
      timeoutMs: 20,
    })
    const report = await bridge.connect()
    expect(report.state).toBe('error')
    expect(report.detail).toMatch(/No MIDI answer/i)
    expect(reports.some((r) => r.state === 'requesting')).toBe(true)
  })
})

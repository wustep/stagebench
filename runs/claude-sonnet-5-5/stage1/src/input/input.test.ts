import { describe, expect, it } from 'vitest'
import { createInstrument } from '../audio/instrument'
import { createHarness, FakeMidiInput } from '../test-utils/fakes'
import { KEY_MAP, KEY_VELOCITY } from './computerKeyboard'
import { parseMidi } from './midi'

const keyEvent = (code: string, extra: Record<string, unknown> = {}) => ({
  code,
  repeat: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: null,
  preventDefault() {},
  ...extra,
})

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('piano.basic-inputs — computer keyboard', () => {
  it('maps two rows to piano notes', () => {
    expect(KEY_MAP.get('KeyZ')).toBe(48)
    expect(KEY_MAP.get('KeyQ')).toBe(60)
    expect(KEY_MAP.get('Digit2')).toBe(61)
    expect(new Set(KEY_MAP.values()).size).toBeLessThan(KEY_MAP.size + 1)
  })

  it('plays on keydown and releases on keyup', () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    h.keys.emit('keydown', keyEvent('KeyQ'))
    expect(inst.getSnapshot().pressed.has(60)).toBe(true)
    h.keys.emit('keyup', keyEvent('KeyQ'))
    expect(inst.getSnapshot().pressed.has(60)).toBe(false)
    expect(inst.lifecycle.getVoices()[0].state).toBe('releasing')
    inst.dispose()
  })

  it('suppresses auto-repeat: one voice per physical press', () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    h.keys.emit('keydown', keyEvent('KeyQ'))
    for (let i = 0; i < 10; i++) h.keys.emit('keydown', keyEvent('KeyQ', { repeat: true }))
    // some platforms deliver repeats without the flag; the pressed set catches those too
    h.keys.emit('keydown', keyEvent('KeyQ'))
    expect(inst.lifecycle.getVoices()).toHaveLength(1)
    h.keys.emit('keyup', keyEvent('KeyQ'))
    inst.dispose()
  })

  it('plays several keys at once and ignores unmapped keys and modifier shortcuts', () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    h.keys.emit('keydown', keyEvent('KeyQ'))
    h.keys.emit('keydown', keyEvent('KeyE'))
    h.keys.emit('keydown', keyEvent('KeyK'))
    h.keys.emit('keydown', keyEvent('KeyW', { ctrlKey: true }))
    h.keys.emit('keydown', keyEvent('KeyW', { target: { tagName: 'INPUT' } }))
    expect(Array.from(inst.getSnapshot().pressed).sort()).toEqual([60, 64])
    inst.dispose()
  })

  it('uses a fixed mezzo-forte velocity', () => {
    expect(KEY_VELOCITY).toBe(96)
  })

  it('Space is the sustain pedal, unless a panel control has focus', () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    h.keys.emit('keydown', keyEvent('KeyQ'))
    h.keys.emit('keydown', keyEvent('Space', { target: { tagName: 'BUTTON' } }))
    expect(inst.getSnapshot().sustain).toBe(false)
    h.keys.emit('keydown', keyEvent('Space'))
    expect(inst.getSnapshot().sustain).toBe(true)
    h.keys.emit('keyup', keyEvent('KeyQ'))
    expect(inst.lifecycle.getVoices()[0].state).toBe('sustained')
    h.keys.emit('keyup', keyEvent('Space'))
    expect(inst.getSnapshot().sustain).toBe(false)
    expect(inst.lifecycle.getVoices()[0].state).toBe('releasing')
    inst.dispose()
  })

  it('releases every key and the pedal when the window loses focus', () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    h.keys.emit('keydown', keyEvent('KeyQ'))
    h.keys.emit('keydown', keyEvent('Space'))
    h.win.emit('blur')
    expect(inst.getSnapshot().pressed.size).toBe(0)
    expect(inst.getSnapshot().sustain).toBe(false)
    // pressing the same key again works after blur (down-state was cleared)
    h.keys.emit('keydown', keyEvent('KeyQ'))
    expect(inst.getSnapshot().pressed.has(60)).toBe(true)
    inst.dispose()
  })
})

describe('piano.basic-inputs — MIDI', () => {
  it('parses note on/off (including note-on velocity 0), CC64 and all-notes-off', () => {
    expect(parseMidi([0x90, 60, 100])).toEqual({ type: 'noteOn', note: 60, velocity: 100 })
    expect(parseMidi([0x93, 60, 0])).toEqual({ type: 'noteOff', note: 60 })
    expect(parseMidi([0x80, 60, 64])).toEqual({ type: 'noteOff', note: 60 })
    expect(parseMidi([0xb0, 64, 127])).toEqual({ type: 'sustain', down: true })
    expect(parseMidi([0xb5, 64, 63])).toEqual({ type: 'sustain', down: false })
    expect(parseMidi([0xb0, 123, 0])).toEqual({ type: 'allNotesOff' })
    expect(parseMidi([0xb0, 7, 100])).toEqual({ type: 'ignored' })
    expect(parseMidi([0xe0, 0, 64])).toEqual({ type: 'ignored' })
    expect(parseMidi(null)).toEqual({ type: 'ignored' })
  })

  it('connects, plays notes with velocity and handles CC64 sustain', async () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    await inst.midi.connect()
    expect(inst.getSnapshot().midi.phase).toBe('connected')
    expect(inst.getSnapshot().midi.devices).toEqual(['Fake Keys'])

    h.midiInput.send(0x90, 60, 30)
    h.midiInput.send(0x90, 64, 120)
    const voices = inst.lifecycle.getVoices()
    expect(voices.map((v) => v.velocity)).toEqual([30, 120])

    h.midiInput.send(0xb0, 64, 127)
    h.midiInput.send(0x80, 60, 0)
    expect(inst.lifecycle.getVoices()[0].state).toBe('sustained')
    h.midiInput.send(0xb0, 64, 0)
    expect(inst.lifecycle.getVoices()[0].state).toBe('releasing')
    inst.dispose()
  })

  it('reports denied permission truthfully and keeps other inputs working', async () => {
    const h = createHarness({ midi: 'denied' })
    const inst = createInstrument(h.deps)
    await inst.midi.connect()
    expect(inst.getSnapshot().midi.phase).toBe('denied')
    expect(inst.getSnapshot().midi.message).toMatch(/denied/i)
    h.keys.emit('keydown', keyEvent('KeyQ'))
    expect(inst.getSnapshot().pressed.has(60)).toBe(true)
    inst.dispose()
  })

  it('reports unsupported browsers', async () => {
    const h = createHarness({ midi: 'unsupported' })
    const inst = createInstrument(h.deps)
    expect(inst.getSnapshot().midi.phase).toBe('unsupported')
    await inst.midi.connect()
    expect(inst.getSnapshot().midi.phase).toBe('unsupported')
    inst.dispose()
  })

  it('reports granted access without devices', async () => {
    const h = createHarness({ midi: 'empty' })
    const inst = createInstrument(h.deps)
    await inst.midi.connect()
    expect(inst.getSnapshot().midi.phase).toBe('no-devices')
    const late = new FakeMidiInput('late', 'Late Keys')
    h.midiAccess.plug(late)
    expect(inst.getSnapshot().midi.phase).toBe('connected')
    late.send(0x90, 62, 90)
    expect(inst.getSnapshot().pressed.has(62)).toBe(true)
    inst.dispose()
  })

  it('a disconnected device releases its held notes and sustain', async () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    await inst.midi.connect()
    h.midiInput.send(0x90, 60, 90)
    h.midiInput.send(0x90, 64, 90)
    h.midiInput.send(0xb0, 64, 127)
    h.midiInput.send(0x80, 64, 0)
    h.midiAccess.unplug(h.midiInput)
    expect(inst.getSnapshot().midi.phase).toBe('disconnected')
    expect(inst.getSnapshot().pressed.size).toBe(0)
    expect(inst.getSnapshot().sustain).toBe(false)
    expect(inst.lifecycle.getVoices().every((v) => v.state === 'releasing')).toBe(true)
    inst.dispose()
  })

  it('unmount detaches MIDI handlers and releases voices', async () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    await inst.midi.connect()
    h.midiInput.send(0x90, 60, 90)
    inst.dispose()
    expect(h.midiInput.onmidimessage).toBeNull()
    expect(h.midiAccess.onstatechange).toBeNull()
    await settle()
    expect(inst.lifecycle.getVoices()).toHaveLength(0)
  })

  it('CC123 releases only that port’s notes', async () => {
    const h = createHarness()
    const inst = createInstrument(h.deps)
    await inst.midi.connect()
    h.midiInput.send(0x90, 60, 90)
    h.keys.emit('keydown', keyEvent('KeyE'))
    h.midiInput.send(0xb0, 123, 0)
    expect(Array.from(inst.getSnapshot().pressed)).toEqual([64])
    inst.dispose()
  })
})

import { describe, expect, it } from 'vitest'
import { NoteEngine, type VoiceFactory, type VoiceHandle } from '../audio/noteEngine'

interface FakeVoice {
  note: number
  velocity: number
  released: 'no' | 'normal' | 'fast'
  stopped: boolean
  end: () => void
}

function fakeFactory() {
  const voices: FakeVoice[] = []
  const factory: VoiceFactory = {
    startVoice(note, velocity, onEnded): VoiceHandle {
      const v: FakeVoice = { note, velocity, released: 'no', stopped: false, end: onEnded }
      voices.push(v)
      return {
        release: (fast) => {
          v.released = fast ? 'fast' : v.released === 'fast' ? 'fast' : 'normal'
        },
        stopNow: () => {
          v.stopped = true
        },
      }
    },
  }
  return { voices, factory }
}

describe('note lifecycle (piano.basic-note-lifecycle)', () => {
  it('note on starts a held voice and note off releases it', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory)
    engine.noteOn(60, 90, 'pointer:1')
    expect(voices).toHaveLength(1)
    expect(engine.snapshot().held).toEqual([60])
    expect(engine.snapshot().voices[0]).toMatchObject({ note: 60, velocity: 90, phase: 'held' })
    engine.noteOff(60, 'pointer:1')
    expect(voices[0].released).toBe('normal')
    expect(engine.snapshot().held).toEqual([])
    expect(engine.snapshot().voices[0].phase).toBe('releasing')
    voices[0].end()
    expect(engine.snapshot().voices).toHaveLength(0)
  })

  it('repeated notes retrigger: the old voice is released fast and a new one starts', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory)
    engine.noteOn(64, 80, 'pointer:1')
    engine.noteOff(64, 'pointer:1')
    engine.noteOn(64, 100, 'pointer:1')
    expect(voices).toHaveLength(2)
    expect(voices[0].released).toBe('normal')
    engine.noteOn(64, 50, 'kbd:KeyE')
    expect(voices).toHaveLength(3)
    expect(voices[1].released).toBe('fast')
    expect(voices[2].released).toBe('no')
  })

  it('ignores duplicate note-on from the same source (no double trigger)', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory)
    engine.noteOn(60, 90, 'kbd:KeyA')
    engine.noteOn(60, 90, 'kbd:KeyA')
    expect(voices).toHaveLength(1)
  })

  it('overlapping holders keep the note down until the last one releases', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory)
    engine.noteOn(62, 90, 'pointer:1')
    engine.noteOn(62, 90, 'midi:a:0')
    engine.noteOff(62, 'pointer:1')
    expect(engine.snapshot().held).toEqual([62])
    expect(voices[1].released).toBe('no')
    engine.noteOff(62, 'midi:a:0')
    expect(engine.snapshot().held).toEqual([])
    expect(voices[1].released).toBe('normal')
  })

  it('noteOff for an unknown source is a no-op', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory)
    engine.noteOn(60, 90, 'pointer:1')
    engine.noteOff(60, 'pointer:2')
    expect(voices[0].released).toBe('no')
  })

  it('all-notes-off releases every voice fast and clears holders and sustain', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory)
    engine.setSustain(true, 'kbd:sustain')
    engine.noteOn(60, 90, 'a')
    engine.noteOn(64, 90, 'b')
    engine.noteOff(64, 'b')
    engine.allNotesOff()
    expect(voices.every((v) => v.released === 'fast')).toBe(true)
    const snap = engine.snapshot()
    expect(snap.held).toEqual([])
    expect(snap.sustain).toBe(false)
    expect(snap.sounding).toEqual([])
  })

  it('dispose hard-stops voices and refuses new notes', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory)
    engine.noteOn(60, 90, 'a')
    engine.dispose()
    expect(voices[0].stopped).toBe(true)
    engine.noteOn(62, 90, 'a')
    expect(voices).toHaveLength(1)
    expect(engine.snapshot().voices).toHaveLength(0)
  })

  it('releaseSources releases only matching holders', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory)
    engine.noteOn(60, 90, 'midi:in1:0')
    engine.noteOn(62, 90, 'pointer:1')
    engine.setSustain(true, 'midi:in1:sustain')
    engine.releaseSources('midi:in1:')
    expect(engine.snapshot().held).toEqual([62])
    expect(engine.snapshot().sustain).toBe(false)
    expect(voices[0].released).toBe('normal')
    expect(voices[1].released).toBe('no')
  })
})

describe('sustain and polyphony (piano.basic-sustain-polyphony)', () => {
  it('sustain keeps released notes sounding until the pedal comes up', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory)
    engine.setSustain(true, 'kbd:sustain')
    engine.noteOn(60, 90, 'a')
    engine.noteOff(60, 'a')
    expect(voices[0].released).toBe('no')
    expect(engine.snapshot().voices[0].phase).toBe('sustained')
    expect(engine.snapshot().sounding).toEqual([60])
    engine.setSustain(false, 'kbd:sustain')
    expect(voices[0].released).toBe('normal')
  })

  it('sustain up does not release notes that are still held', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory)
    engine.setSustain(true, 's')
    engine.noteOn(60, 90, 'a')
    engine.setSustain(false, 's')
    expect(voices[0].released).toBe('no')
    engine.noteOff(60, 'a')
    expect(voices[0].released).toBe('normal')
  })

  it('sustain is the OR of all sustain sources', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory)
    engine.setSustain(true, 'kbd:sustain')
    engine.setSustain(true, 'midi:x:sustain')
    engine.noteOn(60, 90, 'a')
    engine.noteOff(60, 'a')
    engine.setSustain(false, 'kbd:sustain')
    expect(voices[0].released).toBe('no')
    engine.setSustain(false, 'midi:x:sustain')
    expect(voices[0].released).toBe('normal')
  })

  it('plays concurrent voices up to the polyphony limit', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory, 8)
    for (let i = 0; i < 8; i++) engine.noteOn(48 + i, 90, `s${i}`)
    expect(engine.snapshot().voices).toHaveLength(8)
    expect(voices.every((v) => v.released === 'no')).toBe(true)
    expect(engine.snapshot().steals).toBe(0)
  })

  it('steals deterministically: releasing first, then oldest sustained, then oldest held', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory, 4)
    engine.setSustain(true, 'ped')
    engine.noteOn(60, 90, 'a') // v0 held → sustained
    engine.noteOn(61, 90, 'b') // v1 held
    engine.noteOn(62, 90, 'c') // v2 held → sustained
    engine.noteOn(63, 90, 'd') // v3 held
    engine.noteOff(60, 'a')
    engine.noteOff(62, 'c')
    engine.noteOn(64, 90, 'e') // steals oldest sustained: v0 (60)
    expect(voices[0].released).toBe('fast')
    expect(engine.snapshot().voices.map((v) => v.note)).toEqual([61, 62, 63, 64])
    engine.noteOn(65, 90, 'f') // steals next sustained: v2 (62)
    expect(voices[2].released).toBe('fast')
    engine.noteOn(66, 90, 'g') // no sustained left: oldest held v1 (61)
    expect(voices[1].released).toBe('fast')
    expect(engine.snapshot().voices.map((v) => v.note)).toEqual([63, 64, 65, 66])
    expect(engine.snapshot().steals).toBe(3)
  })

  it('stealing prefers voices that are already releasing', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory, 3)
    engine.noteOn(60, 90, 'a')
    engine.noteOn(61, 90, 'b')
    engine.noteOn(62, 90, 'c')
    engine.noteOff(61, 'b') // releasing but not yet ended
    engine.noteOn(63, 90, 'd')
    expect(engine.snapshot().voices.map((v) => v.note)).toEqual([60, 62, 63])
    expect(voices[1].released).toBe('fast')
    expect(voices[0].released).toBe('no')
  })

  it('the same sequence always produces the same stealing order', () => {
    const run = () => {
      const { factory } = fakeFactory()
      const engine = new NoteEngine(factory, 5)
      const order: number[][] = []
      for (let i = 0; i < 20; i++) {
        engine.noteOn(40 + ((i * 7) % 30), 60 + i, `s${i % 3}`)
        if (i % 4 === 0) engine.noteOff(40 + ((i * 7) % 30), `s${i % 3}`)
        order.push(engine.snapshot().voices.map((v) => v.note))
      }
      return order
    }
    expect(run()).toEqual(run())
  })

  it('carries velocity to the voice and clamps it to 1..127', () => {
    const { voices, factory } = fakeFactory()
    const engine = new NoteEngine(factory)
    engine.noteOn(60, 0, 'a')
    engine.noteOn(62, 300, 'b')
    engine.noteOn(64, 64, 'c')
    expect(voices.map((v) => v.velocity)).toEqual([1, 127, 64])
  })
})

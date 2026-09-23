// Input adapters feeding the shared note lifecycle: computer keyboard and Web MIDI.
// Real NoteEngine; voices come from the real PianoAudio rendered by the audio simulator where
// velocity/sustain must be audible, otherwise from a recording fake factory.
import { describe, expect, it } from 'vitest'
import { NoteEngine, type VoiceFactory } from '../audio/noteEngine'
import { PianoAudio } from '../audio/pianoAudio'
import { attachComputerKeyboard, DEFAULT_BASE_NOTE, KEYBOARD_VELOCITY } from '../input/computerKeyboard'
import { connectMidi, type MidiStatus } from '../input/midi'
import { CountingTarget, FakeMidiAccess, FakeMidiInput } from '../testing/fakes'
import { rms, SimAudioContext } from '../testing/simAudio'

function recordingFactory() {
  const started: { note: number; velocity: number }[] = []
  const factory: VoiceFactory = {
    startVoice(note, velocity) {
      started.push({ note, velocity })
      return { release: () => undefined, stopNow: () => undefined }
    },
  }
  return { started, factory }
}

function keyboardRig() {
  const { started, factory } = recordingFactory()
  const engine = new NoteEngine(factory)
  const target = new CountingTarget()
  const visibility = new CountingTarget()
  const bases: number[] = []
  const kb = attachComputerKeyboard({ engine: () => engine, target, visibility, onBaseChange: (b) => bases.push(b) })
  const down = (code: string, extra: KeyboardEventInit = {}, eventTarget?: EventTarget) => {
    const ev = new KeyboardEvent('keydown', { code, cancelable: true, ...extra })
    if (eventTarget) Object.defineProperty(ev, 'target', { value: eventTarget })
    target.dispatchEvent(ev)
    return ev
  }
  const up = (code: string) => target.dispatchEvent(new KeyboardEvent('keyup', { code }))
  return { engine, started, target, visibility, kb, bases, down, up }
}

async function audibleRig() {
  const ctx = new SimAudioContext(16000)
  const audio = new PianoAudio({
    createContext: () => ctx,
    lowNote: 28,
    highNote: 100,
    toneOptions: { sampleRate: 8000, durationScale: 0.5 },
    yieldToEventLoop: () => Promise.resolve(),
  })
  await audio.load()
  return { ctx, audio, engine: new NoteEngine(audio) }
}

describe('piano.basic-inputs — computer keyboard', () => {
  it('maps the home row to white keys and the top row to black keys from C4', () => {
    const r = keyboardRig()
    expect(DEFAULT_BASE_NOTE).toBe(60)
    for (const code of ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyK']) r.down(code)
    expect(r.started.map((s) => s.note)).toEqual([60, 61, 62, 63, 64, 65, 72])
    expect(r.started.every((s) => s.velocity === KEYBOARD_VELOCITY)).toBe(true)
    expect(r.engine.snapshot().held).toEqual([60, 61, 62, 63, 64, 65, 72])
  })

  it('suppresses OS auto-repeat and duplicate keydowns', () => {
    const r = keyboardRig()
    r.down('KeyA')
    r.down('KeyA', { repeat: true })
    r.down('KeyA', { repeat: true })
    r.down('KeyA')
    expect(r.started).toHaveLength(1)
    r.up('KeyA')
    expect(r.engine.snapshot().held).toEqual([])
    r.down('KeyA')
    expect(r.started).toHaveLength(2)
  })

  it('releases the note it started even if the octave changed while held', () => {
    const r = keyboardRig()
    r.down('KeyA')
    r.down('KeyX')
    expect(r.bases).toEqual([72])
    r.up('KeyA')
    expect(r.engine.snapshot().held).toEqual([])
    r.down('KeyA')
    expect(r.started.at(-1)?.note).toBe(72)
  })

  it('Z/X shift octaves within the keybed range', () => {
    const r = keyboardRig()
    for (let i = 0; i < 6; i++) {
      r.down('KeyZ')
      r.up('KeyZ')
    }
    expect(r.kb.state.baseNote).toBe(36)
    for (let i = 0; i < 8; i++) {
      r.down('KeyX')
      r.up('KeyX')
    }
    expect(r.kb.state.baseNote).toBe(84)
    // Keys that would fall above E7 are ignored rather than clamped.
    r.down('Quote') // 84 + 17 = 101 > 100
    expect(r.started).toHaveLength(0)
  })

  it('Space is a sustain pedal (repeat-safe); it is left to focused buttons and text fields', () => {
    const r = keyboardRig()
    r.down('Space')
    r.down('Space', { repeat: true })
    expect(r.engine.snapshot().sustain).toBe(true)
    r.up('Space')
    expect(r.engine.snapshot().sustain).toBe(false)
    const button = document.createElement('button')
    r.down('Space', {}, button)
    expect(r.engine.snapshot().sustain).toBe(false)
    const input = document.createElement('input')
    r.down('KeyA', {}, input)
    expect(r.started).toHaveLength(0)
  })

  it('modifier chords are not notes', () => {
    const r = keyboardRig()
    r.down('KeyA', { ctrlKey: true })
    r.down('KeyS', { metaKey: true })
    expect(r.started).toHaveLength(0)
  })

  it('window blur and hidden tab release held keys and the keyboard sustain', () => {
    const r = keyboardRig()
    r.down('KeyA')
    r.down('Space')
    r.target.dispatchEvent(new Event('blur'))
    expect(r.engine.snapshot().held).toEqual([])
    expect(r.engine.snapshot().sustain).toBe(false)
    r.down('KeyS')
    r.visibility.visibilityState = 'hidden'
    r.visibility.dispatchEvent(new Event('visibilitychange'))
    expect(r.engine.snapshot().held).toEqual([])
    // After blur the same physical key can start again (no stuck "down" entry).
    r.visibility.visibilityState = 'visible'
    r.down('KeyA')
    expect(r.engine.snapshot().held).toEqual([60])
  })

  it('detach releases everything and removes every listener', () => {
    const r = keyboardRig()
    expect(r.target.listenerCount).toBe(3)
    expect(r.visibility.listenerCount).toBe(1)
    r.down('KeyA')
    r.kb.detach()
    expect(r.engine.snapshot().held).toEqual([])
    expect(r.target.listenerCount).toBe(0)
    expect(r.visibility.listenerCount).toBe(0)
    r.down('KeyS')
    expect(r.started).toHaveLength(1)
  })
})

async function midiRig(mode: 'grant' | 'deny' | 'none' = 'grant') {
  const { started, factory } = recordingFactory()
  const engine = new NoteEngine(factory)
  const access = new FakeMidiAccess()
  const input = new FakeMidiInput('in-1', 'Test Keyboard')
  access.add(input)
  const statuses: MidiStatus[] = []
  const request =
    mode === 'none' ? null : mode === 'grant' ? () => Promise.resolve(access) : () => Promise.reject(new Error('SecurityError: permission denied'))
  const connection = await connectMidi(request, () => engine, (s) => statuses.push(s))
  return { engine, started, access, input, statuses, connection }
}

describe('piano.basic-inputs — Web MIDI', () => {
  it('reports requesting then connected with the input name', async () => {
    const r = await midiRig()
    expect(r.statuses[0]).toEqual({ state: 'requesting' })
    expect(r.statuses.at(-1)).toEqual({ state: 'connected', inputs: ['Test Keyboard'] })
  })

  it('note on carries velocity; note off and note-on velocity 0 release', async () => {
    const r = await midiRig()
    r.input.send([0x90, 60, 33])
    r.input.send([0x90, 64, 120])
    expect(r.started).toEqual([
      { note: 60, velocity: 33 },
      { note: 64, velocity: 120 },
    ])
    r.input.send([0x80, 60, 64])
    r.input.send([0x90, 64, 0])
    expect(r.engine.snapshot().held).toEqual([])
  })

  it('channels are independent holders of the same note', async () => {
    const r = await midiRig()
    r.input.send([0x90, 60, 90])
    r.input.send([0x91, 60, 90])
    r.input.send([0x80, 60, 0])
    expect(r.engine.snapshot().held).toEqual([60])
    r.input.send([0x81, 60, 0])
    expect(r.engine.snapshot().held).toEqual([])
  })

  it('CC64 drives sustain (>= 64 down), CC123 releases this input, CC120 silences all', async () => {
    const r = await midiRig()
    r.input.send([0xb0, 64, 127])
    expect(r.engine.snapshot().sustain).toBe(true)
    r.input.send([0xb0, 64, 63])
    expect(r.engine.snapshot().sustain).toBe(false)
    r.input.send([0x90, 60, 80])
    r.input.send([0xb0, 123, 0])
    expect(r.engine.snapshot().held).toEqual([])
    r.input.send([0x90, 62, 80])
    r.engine.noteOn(64, 80, 'pointer:1')
    r.input.send([0xb0, 120, 0])
    expect(r.engine.snapshot().held).toEqual([])
  })

  it('ignores notes outside E1–E7 and malformed messages', async () => {
    const r = await midiRig()
    r.input.send([0x90, 27, 100])
    r.input.send([0x90, 101, 100])
    r.input.send([0x90])
    r.input.send([0xe0, 0, 64]) // pitch bend: not a Phase 1 feature
    expect(r.started).toHaveLength(0)
  })

  it('denied access is reported truthfully and plays nothing', async () => {
    const r = await midiRig('deny')
    expect(r.connection).toBeNull()
    expect(r.statuses.at(-1)).toEqual({ state: 'denied', message: 'SecurityError: permission denied' })
  })

  it('missing Web MIDI is reported as unsupported', async () => {
    const r = await midiRig('none')
    expect(r.connection).toBeNull()
    expect(r.statuses).toEqual([{ state: 'unsupported' }])
  })

  it('granted with no devices reports no-inputs, then connects when one appears', async () => {
    const access = new FakeMidiAccess()
    const statuses: MidiStatus[] = []
    const { factory, started } = recordingFactory()
    const engine = new NoteEngine(factory)
    await connectMidi(() => Promise.resolve(access), () => engine, (s) => statuses.push(s))
    expect(statuses.at(-1)).toEqual({ state: 'no-inputs' })
    const late = new FakeMidiInput('late', 'Late Keys')
    access.add(late)
    expect(statuses.at(-1)).toEqual({ state: 'connected', inputs: ['Late Keys'] })
    late.send([0x90, 70, 70])
    expect(started).toEqual([{ note: 70, velocity: 70 }])
  })

  it('disconnecting a device releases its notes and its sustain, and reports it', async () => {
    const r = await midiRig()
    r.input.send([0x90, 60, 80])
    r.input.send([0xb0, 64, 127])
    r.engine.noteOn(72, 80, 'pointer:1')
    r.access.disconnect('in-1')
    const snap = r.engine.snapshot()
    expect(snap.held).toEqual([72])
    expect(snap.sustain).toBe(false)
    expect(r.statuses.at(-1)).toEqual({ state: 'disconnected', message: 'MIDI input disconnected; its notes were released.' })
    expect(r.input.onmidimessage).toBeNull()
  })

  it('detach unhooks every input and releases its notes', async () => {
    const r = await midiRig()
    r.input.send([0x90, 60, 80])
    r.connection!.detach()
    expect(r.input.onmidimessage).toBeNull()
    expect(r.access.onstatechange).toBeNull()
    expect(r.engine.snapshot().held).toEqual([])
  })
})

describe('piano.basic-inputs — inputs are audible through the piano voice', () => {
  it('MIDI velocity changes the rendered level', async () => {
    const soft = await audibleRig()
    const loud = await audibleRig()
    const connect = async (engine: NoteEngine) => {
      const access = new FakeMidiAccess()
      const input = new FakeMidiInput('in', 'Keys')
      access.add(input)
      await connectMidi(() => Promise.resolve(access), () => engine, () => undefined)
      return input
    }
    ;(await connect(soft.engine)).send([0x90, 60, 30])
    ;(await connect(loud.engine)).send([0x90, 60, 120])
    const a = rms(soft.ctx.render(0.3))
    const b = rms(loud.ctx.render(0.3))
    expect(a).toBeGreaterThan(0.001)
    expect(b).toBeGreaterThan(a * 1.5)
  })

  it('MIDI CC64 keeps a released note sounding', async () => {
    const dry = await audibleRig()
    const wet = await audibleRig()
    for (const [rig, pedal] of [
      [dry, false],
      [wet, true],
    ] as const) {
      const access = new FakeMidiAccess()
      const input = new FakeMidiInput('in', 'Keys')
      access.add(input)
      await connectMidi(() => Promise.resolve(access), () => rig.engine, () => undefined)
      if (pedal) input.send([0xb0, 64, 127])
      input.send([0x90, 60, 100])
      rig.ctx.render(0.1)
      input.send([0x80, 60, 0])
    }
    const tailDry = rms(dry.ctx.render(0.5), 4000)
    const tailWet = rms(wet.ctx.render(0.5), 4000)
    expect(tailWet).toBeGreaterThan(0.001)
    expect(tailWet).toBeGreaterThan(tailDry * 5)
  })

  it('computer keys play audibly and release to silence', async () => {
    const rig = await audibleRig()
    const target = new CountingTarget()
    const kb = attachComputerKeyboard({ engine: () => rig.engine, target, visibility: new CountingTarget() })
    target.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }))
    expect(rms(rig.ctx.render(0.2))).toBeGreaterThan(0.01)
    target.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA' }))
    rig.ctx.render(1.2)
    expect(rig.ctx.liveSourceCount()).toBe(0)
    expect(rms(rig.ctx.render(0.1))).toBe(0)
    kb.detach()
  })
})

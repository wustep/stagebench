import { describe, it, expect, vi } from 'vitest'
import { PianoEngine, type AudioBoundary } from './audio'
import { InputController, type MidiAccess, type MidiInput } from './inputs'
function fixture() { const audio: AudioBoundary = { start: async () => {}, voice: vi.fn(() => ({ release: vi.fn(), stop: vi.fn() })), close: vi.fn() }; const engine = new PianoEngine(audio); const status = vi.fn(); return { engine, input: new InputController(engine, status), audio, status } }
describe('shared input lifecycle', () => {
  it('owns each touch independently and handles release/cancel', () => {
    const { engine, input } = fixture(); input.pointerDown(11, 60); input.pointerDown(12, 64)
    expect(engine.notes.size).toBe(2); input.pointerUp(11); expect([...engine.notes.values()].map(n => n.midi)).toEqual([64]); input.pointerUp(12); expect(engine.notes.size).toBe(0)
  })
  it('suppresses repeats, ignores editable targets, supports space sustain and keyup outside focus', () => {
    const { input, engine, audio } = fixture()
    expect(input.keyDown('KeyA')).toBe(true); expect(input.keyDown('KeyA', true)).toBe(false); expect(input.keyDown('KeyA')).toBe(false)
    expect(input.keyDown('KeyS', false, true)).toBe(false); expect(input.keyDown('Space')).toBe(true)
    input.keyUp('KeyA'); expect(engine.notes.size).toBe(1); input.keyUp('Space'); expect(engine.notes.size).toBe(0); expect(audio.voice).not.toHaveBeenCalled()
  })
  it('accepts MIDI velocity, overlapping repeated notes, channel-specific CC64, note-on zero and all-off', async () => {
    const { input, engine, audio } = fixture()
    input.midi('device', new Uint8Array([0x91, 60, 24])); input.midi('device', new Uint8Array([0x91, 60, 110]))
    await engine.activate(); await Promise.resolve(); expect(audio.voice).toHaveBeenCalledWith(60, 24, expect.any(Function)); expect(audio.voice).toHaveBeenCalledWith(60, 110, expect.any(Function))
    input.midi('device', new Uint8Array([0xb1, 64, 127])); input.midi('device', new Uint8Array([0x81, 60, 0])); input.midi('device', new Uint8Array([0x91, 60, 0]))
    expect([...engine.notes.values()].every(n => !n.held && !n.released)).toBe(true)
    input.midi('device', new Uint8Array([0xb1, 64, 0])); expect([...engine.notes.values()].every(n => n.released)).toBe(true)
    input.midi('device', new Uint8Array([0xb1, 123, 0])); expect(engine.notes.size).toBe(0)
  })
  it('reports unavailable/denied MIDI, connection and disconnect; detaches handlers', async () => {
    const { input, engine, status } = fixture(); await input.connect(); expect(status).toHaveBeenLastCalledWith(expect.stringContaining('unavailable'))
    await input.connect(async () => { throw new Error('denied') }); expect(status).toHaveBeenLastCalledWith(expect.stringContaining('denied'))
    const port: MidiInput = { id: 'm', state: 'connected', onmidimessage: null }
    const access: MidiAccess = { inputs: new Map([['m', port]]), onstatechange: null }
    await input.connect(async () => access); expect(status).toHaveBeenLastCalledWith('MIDI connected · 1 input')
    port.onmidimessage?.({ data: new Uint8Array([0x90, 60, 100]) }); expect(engine.notes.size).toBe(1)
    port.state = 'disconnected'; access.onstatechange?.(); expect(engine.notes.size).toBe(0); expect(port.onmidimessage).toBeNull()
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining('disconnected')); input.dispose(); expect(access.onstatechange).toBeNull()
  })
  it('ignores late MIDI permission results after disposal', async () => {
    const { input } = fixture(); let resolve!: (a: MidiAccess) => void
    const pending = input.connect(() => new Promise(r => { resolve = r })); input.dispose()
    const access: MidiAccess = { inputs: new Map(), onstatechange: null }; resolve(access); await pending; expect(access.onstatechange).toBeNull()
  })
  it('blur and unmount remove voices, pedals and event listeners', () => {
    const { input, engine } = fixture(); const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener')
    const detach = input.attach(window); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' })); expect(engine.notes.size).toBe(1)
    engine.sustain('ui', true); window.dispatchEvent(new Event('blur')); expect(engine.notes.size).toBe(0); expect(engine.pedals.size).toBe(0)
    detach(); expect(remove.mock.calls.map(([name]) => name)).toEqual(add.mock.calls.map(([name]) => name)); add.mockRestore(); remove.mockRestore()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { deniedMidiBoundary, FakeMidiAccess, FakePort, fakeMidiBoundary } from '../test/fakes'
import { MidiInputManager, type MidiHandlers } from './midi'

function makeHandlers(): MidiHandlers & {
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  sustain: ReturnType<typeof vi.fn>
  sostenuto: ReturnType<typeof vi.fn>
  soft: ReturnType<typeof vi.fn>
  cleanup: ReturnType<typeof vi.fn>
  wheel: ReturnType<typeof vi.fn>
  bend: ReturnType<typeof vi.fn>
} {
  const on = vi.fn()
  const off = vi.fn()
  const sustain = vi.fn()
  const sostenuto = vi.fn()
  const soft = vi.fn()
  const cleanup = vi.fn()
  const wheel = vi.fn()
  const bend = vi.fn()
  return {
    on,
    off,
    sustain,
    sostenuto,
    soft,
    cleanup,
    wheel,
    bend,
    noteOn: on,
    noteOff: off,
    setSustain: sustain,
    setSostenuto: sostenuto,
    setSoft: soft,
    setModWheel: wheel,
    setPitchBend: bend,
    onDisconnectCleanup: cleanup,
  }
}

describe('piano.basic-inputs — Web MIDI boundary', () => {
  it('reports unsupported when the platform has no Web MIDI', async () => {
    const manager = new MidiInputManager(makeHandlers())
    await manager.start({})
    expect(manager.getStatus().status).toBe('unsupported')
  })

  it('reports denied when permission is rejected and stays usable', async () => {
    const manager = new MidiInputManager(makeHandlers())
    await manager.start(deniedMidiBoundary())
    expect(manager.getStatus().status).toBe('denied')
    expect(manager.getStatus().message).toMatch(/denied/i)
  })

  it('reports no-device, then connected with the device name on hot-plug', async () => {
    const access = new FakeMidiAccess()
    const manager = new MidiInputManager(makeHandlers())
    await manager.start(fakeMidiBoundary(access))
    expect(manager.getStatus().status).toBe('no-device')

    access.addPort(new FakePort('p1', 'Test Piano 73'))
    expect(manager.getStatus().status).toBe('connected')
    expect(manager.getStatus().message).toContain('Test Piano 73')
  })

  it('parses note on/off with velocity and treats velocity 0 as note off', async () => {
    const handlers = makeHandlers()
    const access = new FakeMidiAccess()
    const port = new FakePort('p1', 'Dev')
    access.ports.set(port.id, port)
    const manager = new MidiInputManager(handlers)
    await manager.start(fakeMidiBoundary(access))

    port.emit([0x90, 60, 100])
    expect(handlers.on).toHaveBeenCalledWith(60, 100 / 127)
    port.emit([0x80, 60, 0])
    expect(handlers.off).toHaveBeenCalledWith(60)
    port.emit([0x90, 64, 127])
    expect(handlers.on).toHaveBeenCalledWith(64, 1)
    port.emit([0x90, 64, 0]) // running-status style note off
    expect(handlers.off).toHaveBeenCalledWith(64)
    expect(handlers.on).toHaveBeenCalledTimes(2)
  })

  it('maps sustain CC64 to a continuous pedal value (full, half, up)', async () => {
    const handlers = makeHandlers()
    const access = new FakeMidiAccess()
    const port = new FakePort('p1', 'Dev')
    access.ports.set(port.id, port)
    const manager = new MidiInputManager(handlers)
    await manager.start(fakeMidiBoundary(access))

    port.emit([0xb0, 64, 127])
    expect(handlers.sustain).toHaveBeenLastCalledWith(1)
    port.emit([0xb0, 64, 64]) // half-pedal position
    expect(handlers.sustain).toHaveBeenLastCalledWith(64 / 127)
    port.emit([0xb0, 64, 0])
    expect(handlers.sustain).toHaveBeenLastCalledWith(0)
  })

  it('maps sostenuto CC66 and soft CC67 to pedal transitions', async () => {
    const handlers = makeHandlers()
    const access = new FakeMidiAccess()
    const port = new FakePort('p1', 'Dev')
    access.ports.set(port.id, port)
    const manager = new MidiInputManager(handlers)
    await manager.start(fakeMidiBoundary(access))

    port.emit([0xb0, 66, 127])
    expect(handlers.sostenuto).toHaveBeenLastCalledWith(true)
    port.emit([0xb0, 66, 0])
    expect(handlers.sostenuto).toHaveBeenLastCalledWith(false)
    port.emit([0xb0, 67, 127])
    expect(handlers.soft).toHaveBeenLastCalledWith(true)
    port.emit([0xb0, 67, 0])
    expect(handlers.soft).toHaveBeenLastCalledWith(false)
  })

  it('maps CC1 mod wheel to a continuous 0..1 value', async () => {
    const access = new FakeMidiAccess()
    const handlers = makeHandlers()
    const manager = new MidiInputManager(handlers)
    await manager.start(fakeMidiBoundary(access))
    const port = new FakePort('p1', 'Test Piano 73')
    access.addPort(port)
    port.emit([0xb0, 1, 127])
    expect(handlers.wheel).toHaveBeenLastCalledWith(1)
    port.emit([0xb0, 1, 64])
    expect(handlers.wheel).toHaveBeenLastCalledWith(64 / 127)
    port.emit([0xb0, 1, 0])
    expect(handlers.wheel).toHaveBeenLastCalledWith(0)
  })

  it('maps 14-bit pitch bend to -1..1 with an exact center and full-scale ends', async () => {
    const access = new FakeMidiAccess()
    const handlers = makeHandlers()
    const manager = new MidiInputManager(handlers)
    await manager.start(fakeMidiBoundary(access))
    const port = new FakePort('p1', 'Test Piano 73')
    access.addPort(port)
    port.emit([0xe0, 0x00, 0x40]) // center: 8192
    expect(handlers.bend).toHaveBeenLastCalledWith(0)
    port.emit([0xe0, 0x7f, 0x7f]) // 16383: full up
    expect(handlers.bend).toHaveBeenLastCalledWith(1)
    port.emit([0xe0, 0x00, 0x00]) // 0: full down
    expect(handlers.bend).toHaveBeenLastCalledWith(-1)
    port.emit([0xe0, 0x00, 0x60]) // 12288: half up
    expect(handlers.bend).toHaveBeenLastCalledWith(4096 / 8191)
  })

  it('estimates BPM from 24-ppq real-time clock ticks and releases on stop', async () => {
    const access = new FakeMidiAccess()
    const handlers = makeHandlers()
    const clock = vi.fn()
    handlers.setExternalClock = clock
    const manager = new MidiInputManager(handlers)
    await manager.start(fakeMidiBoundary(access))
    const port = new FakePort('p1', 'Clock Dev')
    access.addPort(port)
    // 120 BPM: a quarter note is 500 ms -> ticks every 500/24 ms.
    const tickMs = 500 / 24
    for (let i = 0; i <= 48; i++) port.emit([0xf8], 1000 + i * tickMs)
    expect(clock).toHaveBeenCalled()
    const lastBpm = clock.mock.calls.at(-1)![0] as number
    expect(lastBpm).toBeCloseTo(120, 0)
    port.emit([0xfc]) // clock stop -> release the lock
    expect(clock).toHaveBeenLastCalledWith(null)
  })

  it('ignores notes outside the keybed range and malformed messages', async () => {
    const handlers = makeHandlers()
    const access = new FakeMidiAccess()
    const port = new FakePort('p1', 'Dev')
    access.ports.set(port.id, port)
    const manager = new MidiInputManager(handlers)
    await manager.start(fakeMidiBoundary(access))

    port.emit([0x90, 20, 100]) // below E1
    port.emit([0x90, 108, 100]) // above E7
    port.emit([0x90]) // truncated
    port.onmidimessage?.({ data: null })
    expect(handlers.on).not.toHaveBeenCalled()
  })

  it('cleans up owned notes and reports disconnected when the device is removed', async () => {
    const handlers = makeHandlers()
    const access = new FakeMidiAccess()
    const port = new FakePort('p1', 'Dev')
    access.ports.set(port.id, port)
    const manager = new MidiInputManager(handlers)
    await manager.start(fakeMidiBoundary(access))
    expect(manager.getStatus().status).toBe('connected')

    access.removePort(port)
    expect(handlers.cleanup).toHaveBeenCalledTimes(1)
    expect(manager.getStatus().status).toBe('disconnected')
    expect(port.onmidimessage).toBeNull()
  })

  it('stops listening after dispose', async () => {
    const handlers = makeHandlers()
    const access = new FakeMidiAccess()
    const port = new FakePort('p1', 'Dev')
    access.ports.set(port.id, port)
    const manager = new MidiInputManager(handlers)
    await manager.start(fakeMidiBoundary(access))
    manager.dispose()
    expect(port.onmidimessage).toBeNull()
    expect(access.onstatechange).toBeNull()
  })
})

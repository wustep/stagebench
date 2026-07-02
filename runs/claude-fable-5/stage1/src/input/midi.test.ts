import { describe, expect, it, vi } from 'vitest'
import { deniedMidiBoundary, FakeMidiAccess, FakePort, fakeMidiBoundary } from '../test/fakes'
import { MidiInputManager, type MidiHandlers } from './midi'

function makeHandlers(): MidiHandlers & {
  on: ReturnType<typeof vi.fn>
  off: ReturnType<typeof vi.fn>
  sustain: ReturnType<typeof vi.fn>
  cleanup: ReturnType<typeof vi.fn>
} {
  const on = vi.fn()
  const off = vi.fn()
  const sustain = vi.fn()
  const cleanup = vi.fn()
  return {
    on,
    off,
    sustain,
    cleanup,
    noteOn: on,
    noteOff: off,
    setSustain: sustain,
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

  it('maps sustain CC64 to pedal transitions at the 64 threshold', async () => {
    const handlers = makeHandlers()
    const access = new FakeMidiAccess()
    const port = new FakePort('p1', 'Dev')
    access.ports.set(port.id, port)
    const manager = new MidiInputManager(handlers)
    await manager.start(fakeMidiBoundary(access))

    port.emit([0xb0, 64, 127])
    expect(handlers.sustain).toHaveBeenLastCalledWith(true)
    port.emit([0xb0, 64, 63])
    expect(handlers.sustain).toHaveBeenLastCalledWith(false)
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

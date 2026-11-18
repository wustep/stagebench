import { expect, it, vi } from 'vitest'
import { Piano } from '../src/piano'
import { connectInputs } from '../src/inputs'
function rig(limit = 32) {
  const voices: {
    note: number
    velocity: number
    release: ReturnType<typeof vi.fn>
    end: () => void
  }[] = []
  const piano = new Piano(
    {
      start: (note, velocity, end) => {
        const voice = { note, velocity, end, release: vi.fn() }
        voices.push(voice)
        return voice
      },
    },
    () => {},
    limit,
  )
  return { voices, piano }
}
it('matches repeated strikes FIFO, keeps other sources independent and prunes ended nodes', () => {
  const { voices, piano } = rig()
  piano.on('a', 60, 40)
  piano.on('a', 60, 90)
  piano.on('b', 60, 75)
  piano.off('a')
  expect(voices[0].release).toHaveBeenCalledOnce()
  expect(voices[1].release).not.toHaveBeenCalled()
  piano.pedal('global', true)
  piano.off('a')
  piano.off('b')
  expect(piano.pressed.size).toBe(0)
  expect(voices[1].release).not.toHaveBeenCalled()
  piano.pedal('global', false)
  expect(voices[1].release).toHaveBeenCalledOnce()
  expect(voices[2].release).toHaveBeenCalledOnce()
  voices.forEach((v) => v.end())
  expect(piano.count).toBe(0)
})
it('steals sustained then oldest held voices without routing stale releases to a new strike', () => {
  const { voices, piano } = rig(2)
  piano.on('a', 60, 20)
  piano.on('b', 62, 127)
  piano.pedal('global', true)
  piano.off('b')
  piano.on('a', 60, 80)
  expect(voices[1].release).toHaveBeenCalledWith(true)
  piano.on('c', 65, 70)
  expect(voices[0].release).toHaveBeenCalledWith(true)
  piano.off('a')
  expect(voices[2].release).not.toHaveBeenCalled()
  expect([...piano.pressed]).toEqual([60, 65])
  piano.clear()
  expect(piano.count).toBe(0)
  expect(piano.sustained).toBe(false)
  expect(voices[3].release).toHaveBeenCalledWith(true)
})
it('routes all MIDI inputs and channels, handles velocity zero, disconnect, hotplug and disposal', async () => {
  const { voices, piano } = rig()
  const port = (id: string) => ({
    id,
    state: 'connected',
    onmidimessage: null as null | ((e: { data: number[] }) => void),
  })
  const a = port('A'),
    b = port('B'),
    access = {
      inputs: new Map([
        ['A', a],
        ['B', b],
      ]),
      onstatechange: null as null | (() => void),
    }
  const report = vi.fn(),
    remove = connectInputs(
      window,
      piano,
      () => {},
      () => Promise.resolve(access as unknown as MIDIAccess),
      report,
    )
  await Promise.resolve()
  a.onmidimessage!({ data: [0x92, 64, 75] })
  b.onmidimessage!({ data: [0x90, 64, 90] })
  expect(voices.map((v) => v.velocity)).toEqual([75, 90])
  a.onmidimessage!({ data: [0xb2, 64, 127] })
  a.onmidimessage!({ data: [0x92, 64, 0] })
  b.onmidimessage!({ data: [0x80, 64, 0] })
  expect(voices[1].release).toHaveBeenCalledOnce()
  expect(voices[0].release).not.toHaveBeenCalled()
  a.state = 'disconnected'
  access.onstatechange!()
  expect(piano.count).toBe(0)
  expect(a.onmidimessage).toBeNull()
  a.state = 'connected'
  access.onstatechange!()
  expect(a.onmidimessage).toBeTypeOf('function')
  b.onmidimessage!({ data: [0x90, 45, 20] })
  remove()
  expect(voices.at(-1)?.release).toHaveBeenCalledWith(true)
  expect(a.onmidimessage).toBeNull()
  expect(b.onmidimessage).toBeNull()
  expect(access.onstatechange).toBeNull()
})
it('reports denied MIDI, suppresses repeated keyboard events and stops ownership on blur', async () => {
  const { voices, piano } = rig(),
    report = vi.fn()
  const remove = connectInputs(
    window,
    piano,
    () => {},
    () => Promise.reject(Error()),
    report,
  )
  await Promise.resolve()
  expect(report).toHaveBeenCalledWith('Access denied')
  const press = () =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }))
  press()
  press()
  expect(voices.length).toBe(1)
  window.dispatchEvent(new Event('blur'))
  expect(piano.count).toBe(0)
  press()
  expect(voices.length).toBe(2)
  remove()
  press()
  expect(voices.length).toBe(2)
})

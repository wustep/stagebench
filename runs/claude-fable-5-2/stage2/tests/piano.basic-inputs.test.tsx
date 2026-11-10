import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createSession } from '../src/app/session'
import { isBlackNote } from '../src/hardware/keys'
import { KEYBOARD_VELOCITY, KEY_OFFSETS, isInteractiveTarget, isTextEntryTarget } from '../src/input/keyboard'
import { velocityFromStrike } from '../src/ui/Keybed'
import { mountApp } from './support/app'
import { createFakePlatform, FakeMidiPort } from './support/fakes'
import { makeKernel, mono, render, rms } from './support/signal'

/**
 * Feature: piano.basic-inputs
 * Pointer, independent multi-touch, mapped keyboard with repeat suppression,
 * MIDI note/velocity/sustain, and denied/disconnected MIDI.
 * No physical MIDI device, network, or audio output is involved.
 */

function noteOns(app: ReturnType<typeof mountApp>) {
  return app.fake.audio.node.received.filter((message) => message.type === 'noteOn')
}

describe('piano.basic-inputs: pointer and touch', () => {
  it('a pointer press on a key strikes that note and makes real signal; lifting it releases', async () => {
    const app = mountApp()
    fireEvent.pointerDown(app.key(60), { pointerId: 1, pointerType: 'mouse', button: 0 })
    await app.settle()
    expect(noteOns(app)).toEqual([expect.objectContaining({ note: 60 })])
    expect(rms(app.fake.audio.node.render(0.2).left)).toBeGreaterThan(0.003)

    fireEvent.pointerUp(app.key(60), { pointerId: 1 })
    expect(app.fake.audio.node.received.at(-1)).toEqual({ type: 'noteOff', note: 60 })
    app.fake.audio.node.render(1.5)
    expect(app.fake.audio.node.host.kernel.voiceCount).toBe(0)
  })

  it('ignores secondary mouse buttons', async () => {
    const app = mountApp()
    fireEvent.pointerDown(app.key(60), { pointerId: 1, pointerType: 'mouse', button: 2 })
    await app.settle()
    expect(app.key(60)).toHaveAttribute('aria-pressed', 'false')
    expect(app.fake.audio.contexts).toHaveLength(0)
  })

  it('maps where the key is struck to velocity: nearer the front edge is harder', () => {
    const rect = { top: 100, height: 200 }
    const back = velocityFromStrike(110, rect)
    const middle = velocityFromStrike(200, rect)
    const front = velocityFromStrike(295, rect)
    expect(back).toBeLessThan(middle)
    expect(middle).toBeLessThan(front)
    expect(back).toBeGreaterThanOrEqual(0.3)
    expect(front).toBeLessThanOrEqual(0.95)
    // Unmeasurable key (no layout): a sensible default.
    expect(velocityFromStrike(0, { top: 0, height: 0 })).toBe(0.7)

    // And that velocity difference is audible, not just a number.
    const loudness = (velocity: number) => {
      const kernel = makeKernel()
      kernel.noteOn(60, velocity)
      return rms(mono(render(kernel, 0.3)))
    }
    expect(loudness(front)).toBeGreaterThan(loudness(back) * 2)
  })

  it('tracks every touch independently', async () => {
    const app = mountApp()
    fireEvent.pointerDown(app.key(60), { pointerId: 11, pointerType: 'touch' })
    fireEvent.pointerDown(app.key(64), { pointerId: 12, pointerType: 'touch' })
    fireEvent.pointerDown(app.key(67), { pointerId: 13, pointerType: 'touch' })
    await app.settle()
    expect(noteOns(app).map((message) => message.note).sort()).toEqual([60, 64, 67])
    expect(app.fake.audio.node.host.kernel.voiceCount).toBe(3)

    fireEvent.pointerUp(app.key(64), { pointerId: 12 })
    expect(app.key(60)).toHaveAttribute('aria-pressed', 'true')
    expect(app.key(64)).toHaveAttribute('aria-pressed', 'false')
    expect(app.key(67)).toHaveAttribute('aria-pressed', 'true')

    // A lift is matched by pointer, not by whatever element it happens to end over.
    fireEvent.pointerUp(app.key(72), { pointerId: 11 })
    expect(app.key(60)).toHaveAttribute('aria-pressed', 'false')
    expect(app.key(67)).toHaveAttribute('aria-pressed', 'true')
  })

  it('a cancelled touch releases its note', async () => {
    const app = mountApp()
    fireEvent.pointerDown(app.key(62), { pointerId: 5, pointerType: 'touch' })
    await app.settle()
    fireEvent.pointerCancel(app.key(62), { pointerId: 5 })
    expect(app.key(62)).toHaveAttribute('aria-pressed', 'false')
    expect(app.fake.audio.node.received.at(-1)).toEqual({ type: 'noteOff', note: 62 })
  })

  it('two touches on the same key: the key stays down until both lift', async () => {
    const app = mountApp()
    fireEvent.pointerDown(app.key(60), { pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerDown(app.key(60), { pointerId: 2, pointerType: 'touch' })
    await app.settle()
    fireEvent.pointerUp(app.key(60), { pointerId: 1 })
    expect(app.key(60)).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerUp(app.key(60), { pointerId: 2 })
    expect(app.key(60)).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('piano.basic-inputs: computer keyboard', () => {
  function session() {
    const fake = createFakePlatform()
    const created = createSession(fake.platform)
    return { fake, session: created }
  }

  it('lays the home row out as a piano starting on middle C', () => {
    const codes = Object.keys(KEY_OFFSETS)
    expect(codes).toHaveLength(18)
    expect(KEY_OFFSETS.KeyA).toBe(0)
    expect(new Set(Object.values(KEY_OFFSETS)).size).toBe(18)
    // Home-row keys are white notes, the row above is black notes.
    for (const [code, offset] of Object.entries(KEY_OFFSETS)) {
      const homeRow = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote']
      expect(isBlackNote(60 + offset)).toBe(!homeRow.includes(code))
    }
    const { session: s } = session()
    expect(s.keyboard.noteFor('KeyA')).toBe(60)
    expect(s.keyboard.noteFor('KeyW')).toBe(61)
    expect(s.keyboard.noteFor('Quote')).toBe(77)
    expect(s.keyboard.noteFor('KeyQ')).toBeNull()
    s.dispose()
  })

  it('plays on key down and releases on key up', async () => {
    const { fake, session: s } = session()
    fake.events.key('down', 'KeyA')
    await s.engine.start()
    expect(s.lifecycle.getSnapshot().held).toEqual([60])
    expect(fake.audio.node.received).toContainEqual({ type: 'noteOn', note: 60, velocity: KEYBOARD_VELOCITY })
    fake.events.key('up', 'KeyA')
    expect(s.lifecycle.getSnapshot().held).toEqual([])
    expect(fake.audio.node.received.at(-1)).toEqual({ type: 'noteOff', note: 60 })
    s.dispose()
  })

  it('suppresses auto-repeat: holding a key strikes once', async () => {
    const { fake, session: s } = session()
    await s.engine.start()
    fake.events.key('down', 'KeyG')
    for (let index = 0; index < 20; index += 1) fake.events.key('down', 'KeyG', { repeat: true })
    // Some platforms resend key-down without the repeat flag.
    fake.events.key('down', 'KeyG')
    expect(fake.audio.node.received.filter((message) => message.type === 'noteOn')).toHaveLength(1)
    fake.events.key('up', 'KeyG')
    fake.events.key('down', 'KeyG')
    expect(fake.audio.node.received.filter((message) => message.type === 'noteOn')).toHaveLength(2)
    s.dispose()
  })

  it('plays chords', () => {
    const { fake, session: s } = session()
    fake.events.key('down', 'KeyA')
    fake.events.key('down', 'KeyD')
    fake.events.key('down', 'KeyG')
    expect(s.lifecycle.getSnapshot().held).toEqual([60, 64, 67])
    fake.events.key('up', 'KeyD')
    expect(s.lifecycle.getSnapshot().held).toEqual([60, 67])
    s.dispose()
  })

  it('shifts octave with Z and X, remembers it, and never strands a held note', () => {
    const { fake, session: s } = session()
    fake.events.key('down', 'KeyA')
    fake.events.key('down', 'KeyX')
    expect(s.keyboard.getBaseNote()).toBe(72)
    expect(fake.storage.data.get('stage4.keyboard.baseNote')).toBe('72')
    // The key pressed before the shift releases the note it actually struck.
    fake.events.key('up', 'KeyA')
    expect(s.lifecycle.getSnapshot().held).toEqual([])
    fake.events.key('down', 'KeyA')
    expect(s.lifecycle.getSnapshot().held).toEqual([72])
    fake.events.key('up', 'KeyA')
    for (let index = 0; index < 10; index += 1) fake.events.key('down', 'KeyZ')
    expect(s.keyboard.getBaseNote()).toBe(36)
    s.dispose()

    // A new session picks the stored octave back up.
    const again = createSession(fake.platform)
    expect(again.keyboard.getBaseNote()).toBe(36)
    again.dispose()
  })

  it('ignores keys outside the 73-key range instead of playing a wrong note', () => {
    const { fake, session: s } = session()
    for (let index = 0; index < 4; index += 1) fake.events.key('down', 'KeyX')
    expect(s.keyboard.getBaseNote()).toBe(84)
    fake.events.key('down', 'Quote') // would be F7 (101), above E7
    expect(s.lifecycle.getSnapshot().held).toEqual([])
    fake.events.key('down', 'Semicolon') // E7
    expect(s.lifecycle.getSnapshot().held).toEqual([100])
    s.dispose()
  })

  it('stays out of the way of shortcuts and text entry', () => {
    const { fake, session: s } = session()
    fake.events.key('down', 'KeyA', { metaKey: true })
    fake.events.key('down', 'KeyS', { ctrlKey: true })
    fake.events.key('down', 'KeyD', { altKey: true })
    fake.events.key('down', 'KeyF', { target: { tagName: 'INPUT' } })
    fake.events.key('down', 'KeyG', { target: { tagName: 'DIV', isContentEditable: true } })
    expect(s.lifecycle.getSnapshot().held).toEqual([])
    expect(isTextEntryTarget({ tagName: 'textarea' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
    s.dispose()
  })

  it('Space is the sustain pedal, unless a control has focus', () => {
    const { fake, session: s } = session()
    const down = fake.events.key('down', 'Space')
    expect(down.defaultPrevented).toBe(true)
    expect(s.lifecycle.getSnapshot().sustain).toBe(true)
    fake.events.key('down', 'Space', { repeat: true })
    fake.events.key('up', 'Space')
    expect(s.lifecycle.getSnapshot().sustain).toBe(false)

    const onButton = fake.events.key('down', 'Space', { target: { tagName: 'BUTTON' } })
    expect(onButton.defaultPrevented).toBe(false)
    expect(s.lifecycle.getSnapshot().sustain).toBe(false)
    const slider = { tagName: 'DIV', getAttribute: (name: string) => (name === 'role' ? 'slider' : null) }
    expect(isInteractiveTarget(slider)).toBe(true)
    expect(isInteractiveTarget({ tagName: 'DIV', getAttribute: () => null })).toBe(false)
    s.dispose()
  })

  it('sustain from the computer keyboard holds real sound', async () => {
    const { fake, session: s } = session()
    await s.engine.start()
    fake.events.key('down', 'Space')
    fake.events.key('down', 'KeyA')
    fake.events.key('up', 'KeyA')
    const ringing = fake.audio.node.render(0.6)
    expect(rms(ringing.left.subarray(ringing.left.length - 4800))).toBeGreaterThan(0.002)
    fake.events.key('up', 'Space')
    fake.audio.node.render(1.5)
    expect(fake.audio.node.host.kernel.voiceCount).toBe(0)
    s.dispose()
  })
})

describe('piano.basic-inputs: Web MIDI', () => {
  async function withPort() {
    const fake = createFakePlatform()
    const port = new FakeMidiPort('in-1', 'Stage Keys')
    fake.midi.ports.set(port.id, port)
    const session = createSession(fake.platform)
    await session.midi.enable()
    await session.engine.start()
    return { fake, port, session }
  }

  it('is off until enabled, then reports the connected input by name', async () => {
    const fake = createFakePlatform()
    fake.midi.ports.set('in-1', new FakeMidiPort('in-1', 'Stage Keys'))
    const session = createSession(fake.platform)
    expect(session.midi.getSnapshot().status).toBe('idle')
    expect(fake.midi.requests).toBe(0)
    await session.midi.enable()
    expect(session.midi.getSnapshot()).toMatchObject({ status: 'connected', inputs: ['Stage Keys'] })
    // Enabling twice does not ask twice.
    await session.midi.enable()
    expect(fake.midi.requests).toBe(1)
    session.dispose()
  })

  it('note on carries velocity; note off and note-on-velocity-0 both release', async () => {
    const { fake, port, session } = await withPort()
    port.send(0x90, 60, 127)
    port.send(0x90, 64, 32)
    const struck = fake.audio.node.received.filter((message) => message.type === 'noteOn')
    expect(struck).toEqual([
      { type: 'noteOn', note: 60, velocity: 1 },
      { type: 'noteOn', note: 64, velocity: 32 / 127 },
    ])
    expect(session.lifecycle.getSnapshot().held).toEqual([60, 64])
    port.send(0x80, 60, 0)
    port.send(0x90, 64, 0)
    expect(session.lifecycle.getSnapshot().held).toEqual([])
    session.dispose()
  })

  it('MIDI velocity changes how loud the note actually is', async () => {
    const level = async (velocity: number) => {
      const { fake, port, session } = await withPort()
      port.send(0x90, 60, velocity)
      const out = rms(fake.audio.node.render(0.3).left)
      session.dispose()
      return out
    }
    const soft = await level(30)
    const hard = await level(120)
    expect(soft).toBeGreaterThan(0)
    expect(hard).toBeGreaterThan(soft * 4)
  })

  it('CC64 is the sustain pedal: 64 and above is down, below is up', async () => {
    const { fake, port, session } = await withPort()
    port.send(0xb0, 64, 64)
    expect(session.lifecycle.getSnapshot().sustain).toBe(true)
    port.send(0x90, 60, 100)
    port.send(0x80, 60, 0)
    fake.audio.node.render(0.5)
    expect(fake.audio.node.host.kernel.voiceCount).toBe(1)
    port.send(0xb0, 64, 63)
    expect(session.lifecycle.getSnapshot().sustain).toBe(false)
    fake.audio.node.render(1.5)
    expect(fake.audio.node.host.kernel.voiceCount).toBe(0)
    // Other controllers are ignored.
    port.send(0xb0, 1, 127)
    port.send(0xb0, 7, 0)
    expect(session.lifecycle.getSnapshot()).toEqual({ held: [], sustain: false })
    session.dispose()
  })

  it('works on any channel, ignores out-of-range notes and malformed messages', async () => {
    const { port, session } = await withPort()
    port.send(0x93, 60, 100)
    port.send(0x9f, 62, 100)
    expect(session.lifecycle.getSnapshot().held).toEqual([60, 62])
    port.send(0x83, 60, 0)
    port.send(0x8f, 62, 0)
    port.send(0x90, 20, 100) // below E1
    port.send(0x90, 110, 100) // above E7
    port.send(0x90)
    port.send(0xf8)
    port.onmidimessage?.({ data: null })
    expect(session.lifecycle.getSnapshot().held).toEqual([])
    session.dispose()
  })

  it('All Notes Off (CC123) from a device releases that device\'s notes', async () => {
    const { port, session } = await withPort()
    port.send(0x90, 60, 100)
    port.send(0x90, 67, 100)
    session.lifecycle.press('pointer:1', 72, 0.8)
    port.send(0xb0, 123, 0)
    expect(session.lifecycle.getSnapshot().held).toEqual([72])
    session.dispose()
  })

  it('reports a denied permission truthfully and keeps other inputs working', async () => {
    const fake = createFakePlatform()
    fake.midi.mode = 'denied'
    const session = createSession(fake.platform)
    await session.midi.enable()
    expect(session.midi.getSnapshot().status).toBe('denied')
    expect(session.midi.getSnapshot().detail).toMatch(/denied/i)
    fake.events.key('down', 'KeyA')
    expect(session.lifecycle.getSnapshot().held).toEqual([60])
    session.dispose()
  })

  it('reports unsupported browsers and failed requests', async () => {
    const unsupported = createFakePlatform()
    unsupported.midi.mode = 'missing'
    const first = createSession(unsupported.platform)
    expect(first.midi.getSnapshot().status).toBe('unsupported')
    await first.midi.enable()
    expect(first.midi.getSnapshot().status).toBe('unsupported')
    first.dispose()

    const failing = createFakePlatform()
    failing.midi.mode = 'error'
    const second = createSession(failing.platform)
    await second.midi.enable()
    expect(second.midi.getSnapshot()).toMatchObject({ status: 'error' })
    expect(second.midi.getSnapshot().detail).toMatch(/MIDI subsystem unavailable/)
    second.dispose()
  })

  it('follows hot-plugging: no input → connected → disconnected', async () => {
    const fake = createFakePlatform()
    const session = createSession(fake.platform)
    await session.midi.enable()
    expect(session.midi.getSnapshot().status).toBe('no-inputs')

    const port = new FakeMidiPort('in-9', 'Late Keys')
    fake.midi.plug(port)
    expect(session.midi.getSnapshot()).toMatchObject({ status: 'connected', inputs: ['Late Keys'] })
    port.send(0x90, 60, 100)
    expect(session.lifecycle.getSnapshot().held).toEqual([60])

    fake.midi.unplug('in-9')
    expect(session.midi.getSnapshot().status).toBe('no-inputs')
    expect(session.midi.getSnapshot().detail).toMatch(/no MIDI input is connected/)
    expect(session.lifecycle.getSnapshot().held).toEqual([])
    // A message from the dead port goes nowhere.
    port.send(0x90, 62, 100)
    expect(session.lifecycle.getSnapshot().held).toEqual([])
    session.dispose()
  })
})

describe('piano.basic-inputs: in the app', () => {
  it('the Enable MIDI button asks for access and the status follows', async () => {
    const app = mountApp((fake) => {
      fake.midi.ports.set('in-1', new FakeMidiPort('in-1', 'Stage Keys'))
    })
    expect(screen.getByTestId('midi-status')).toHaveTextContent('Off')
    fireEvent.click(screen.getByRole('button', { name: 'Enable MIDI' }))
    await app.settle()
    expect(screen.getByTestId('midi-status')).toHaveTextContent('Connected')
    expect(app.control('program-oled')).toHaveTextContent('MIDI CONNECTED')

    const port = app.fake.midi.ports.get('in-1')!
    act(() => port.send(0x90, 64, 100))
    expect(app.key(64)).toHaveAttribute('aria-pressed', 'true')
    act(() => app.fake.midi.unplug('in-1'))
    expect(app.key(64)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('midi-status')).toHaveTextContent('No input connected')
  })

  it('shows Denied when the permission prompt is refused', async () => {
    const app = mountApp((fake) => {
      fake.midi.mode = 'denied'
    })
    fireEvent.click(screen.getByRole('button', { name: 'Enable MIDI' }))
    await app.settle()
    expect(screen.getByTestId('midi-status')).toHaveTextContent('Denied')
    expect(app.control('program-oled')).toHaveTextContent('MIDI DENIED')
  })

  it('computer keys light the matching keybed key', () => {
    const app = mountApp()
    act(() => {
      app.fake.events.key('down', 'KeyA')
    })
    expect(app.key(60)).toHaveAttribute('aria-pressed', 'true')
    act(() => {
      app.fake.events.key('up', 'KeyA')
    })
    expect(app.key(60)).toHaveAttribute('aria-pressed', 'false')
  })
})

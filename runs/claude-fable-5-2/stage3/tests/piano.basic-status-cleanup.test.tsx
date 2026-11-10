import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createSession } from '../src/app/session'
import { PianoEngine } from '../src/audio/engine'
import { mountApp } from './support/app'
import { createFakePlatform, FakeMidiPort, flush } from './support/fakes'
import { peak, rms } from './support/signal'

/**
 * Feature: piano.basic-status-cleanup
 * Truthful loading/ready/error/fallback status; blur/disconnect/unmount stops every owned voice.
 */

function makeEngine(configure?: (fake: ReturnType<typeof createFakePlatform>) => void) {
  const fake = createFakePlatform()
  configure?.(fake)
  const engine = new PianoEngine(fake.platform.audio, fake.platform.timing)
  return { fake, engine }
}

describe('piano.basic-status-cleanup: engine status', () => {
  it('is idle and creates nothing until asked to start', () => {
    const { fake, engine } = makeEngine()
    expect(engine.getSnapshot().status).toBe('idle')
    expect(engine.getSnapshot().backend).toBe('none')
    expect(fake.audio.contexts).toHaveLength(0)
  })

  it('goes idle → loading → ready when the worklet loads', async () => {
    const { fake, engine } = makeEngine()
    const seen: string[] = []
    engine.subscribe(() => seen.push(engine.getSnapshot().status))
    const started = engine.start()
    expect(engine.getSnapshot().status).toBe('loading')
    await started
    expect(engine.getSnapshot()).toMatchObject({ status: 'ready', backend: 'worklet' })
    expect(seen).toEqual(['loading', 'ready'])
    expect(fake.audio.context.addModuleCalls).toEqual(['fake://piano.worklet.js'])
    expect(fake.timing.pendingTimers).toBe(0)
  })

  it('connects exactly one node to the destination, and that node carries the sound', async () => {
    const { fake, engine } = makeEngine()
    await engine.start()
    expect(fake.audio.connections).toHaveLength(1)
    expect(fake.audio.connections[0].from).toBe(fake.audio.node)
    expect(fake.audio.connections[0].to).toBe(fake.audio.context.destination)

    engine.noteOn(60, 0.8)
    const out = fake.audio.node.render(0.2)
    expect(rms(out.left)).toBeGreaterThan(0.005)
    // Starting again must not add a second path to the output.
    await engine.start()
    expect(fake.audio.connections).toHaveLength(1)
    expect(fake.audio.contexts).toHaveLength(1)
  })

  it('reports "fallback" and keeps playing on the main thread when the worklet module fails', async () => {
    const { fake, engine } = makeEngine((f) => {
      f.audio.worklet = 'reject'
    })
    await engine.start()
    const snapshot = engine.getSnapshot()
    expect(snapshot.status).toBe('fallback')
    expect(snapshot.backend).toBe('script-processor')
    expect(snapshot.detail).toMatch(/fallback/i)
    expect(snapshot.detail).toMatch(/module failed to load/)
    expect(fake.audio.workletNodes).toHaveLength(0)
    expect(fake.audio.connections).toHaveLength(1)

    // The fallback is real: the ScriptProcessor callback renders the same voice.
    const script = fake.audio.context.scriptNodes[0]
    expect(peak(script.render(2).left)).toBe(0)
    engine.noteOn(60, 0.8)
    expect(rms(script.render(8).left)).toBeGreaterThan(0.005)
    engine.noteOff(60)
    script.render(60)
    expect(peak(script.render(1).left)).toBe(0)
  })

  it('falls back when the browser has no AudioWorklet at all', async () => {
    const { engine } = makeEngine((f) => {
      f.audio.worklet = 'missing'
    })
    await engine.start()
    expect(engine.getSnapshot().status).toBe('fallback')
  })

  it('falls back when the worklet module never finishes loading', async () => {
    const { fake, engine } = makeEngine((f) => {
      f.audio.worklet = 'never'
    })
    const started = engine.start()
    await flush()
    expect(engine.getSnapshot().status).toBe('loading')
    expect(fake.timing.pendingTimers).toBe(1)
    fake.timing.advance(3999)
    await flush()
    expect(engine.getSnapshot().status).toBe('loading')
    fake.timing.advance(1)
    await started
    expect(engine.getSnapshot().status).toBe('fallback')
    expect(engine.getSnapshot().detail).toMatch(/did not load within 4000 ms/)
    expect(fake.timing.pendingTimers).toBe(0)
  })

  it('reports "error" when neither host can start, and stays safe to play', async () => {
    const { fake, engine } = makeEngine((f) => {
      f.audio.worklet = 'reject'
      f.audio.scriptProcessor = false
    })
    await engine.start()
    expect(engine.getSnapshot().status).toBe('error')
    expect(engine.getSnapshot().detail).toMatch(/silent/i)
    expect(fake.audio.context.closed).toBe(true)
    expect(() => {
      engine.noteOn(60, 0.8)
      engine.noteOff(60)
      engine.setSustain(true)
      engine.allNotesOff()
    }).not.toThrow()
  })

  it('reports "error" when the browser has no Web Audio', async () => {
    const { engine } = makeEngine((f) => {
      f.audio.supported = false
    })
    await engine.start()
    expect(engine.getSnapshot()).toMatchObject({ status: 'error', backend: 'none' })
    expect(engine.getSnapshot().detail).toMatch(/no Web Audio/i)
  })

  it('does not claim "ready" while the browser keeps the context suspended', async () => {
    const { fake, engine } = makeEngine((f) => {
      f.audio.initialState = 'suspended'
      f.audio.resumeUnlocks = false
    })
    await engine.start()
    expect(engine.getSnapshot().status).toBe('loading')
    expect(engine.getSnapshot().detail).toMatch(/click, tap, or press a key/)
    expect(fake.audio.context.resumeCalls).toBeGreaterThan(0)

    // Notes played while suspended are remembered, not queued up to burst out later.
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    engine.noteOff(64)
    expect(fake.audio.node.received.filter((message) => message.type === 'noteOn')).toHaveLength(0)

    fake.audio.context.setState('running')
    expect(engine.getSnapshot().status).toBe('ready')
    const struck = fake.audio.node.received.filter((message) => message.type === 'noteOn')
    expect(struck).toEqual([{ type: 'noteOn', note: 60, velocity: 0.8 }])
  })

  it('strikes only the keys still held when loading finishes', async () => {
    const { fake, engine } = makeEngine()
    const started = engine.start()
    engine.setSustain(true)
    engine.noteOn(60, 0.7)
    engine.noteOn(67, 0.7)
    engine.noteOff(67)
    await started
    const messages = fake.audio.node.received
    expect(messages.filter((message) => message.type === 'noteOn')).toEqual([{ type: 'noteOn', note: 60, velocity: 0.7 }])
    expect(messages).toContainEqual({ type: 'sustain', down: true })
    expect(fake.audio.node.host.kernel.voiceCount).toBe(1)
  })

  it('reports the live voice count from the synthesis host', async () => {
    const { fake, engine } = makeEngine()
    await engine.start()
    engine.noteOn(60, 0.8)
    engine.noteOn(64, 0.8)
    fake.audio.node.render(0.1)
    expect(engine.getSnapshot().voices).toBe(2)
    engine.allNotesOff()
    fake.audio.node.render(0.5)
    expect(engine.getSnapshot().voices).toBe(0)
  })

  it('dispose stops every voice and releases the context, the node, and the timer', async () => {
    const { fake, engine } = makeEngine()
    await engine.start()
    engine.setSustain(true)
    for (const note of [48, 60, 64, 67]) engine.noteOn(note, 0.9)
    fake.audio.node.render(0.1)
    expect(fake.audio.node.host.kernel.voiceCount).toBe(4)

    engine.dispose()
    expect(engine.getSnapshot().status).toBe('idle')
    expect(fake.audio.node.connected).toBe(false)
    expect(fake.audio.node.port.onmessage).toBeNull()
    expect(fake.audio.context.closed).toBe(true)
    expect(fake.audio.context.onstatechange).toBeNull()
    expect(fake.timing.pendingTimers).toBe(0)
    fake.audio.node.render(0.5)
    expect(fake.audio.node.host.kernel.voiceCount).toBe(0)
  })

  it('dispose during loading abandons the load cleanly', async () => {
    const { fake, engine } = makeEngine((f) => {
      f.audio.worklet = 'never'
    })
    void engine.start()
    await flush()
    engine.dispose()
    expect(fake.timing.pendingTimers).toBe(0)
    expect(fake.audio.context.closed).toBe(true)
    expect(engine.getSnapshot().status).toBe('idle')
    expect(fake.audio.connections).toHaveLength(0)
  })
})

describe('piano.basic-status-cleanup: session cleanup', () => {
  async function playing() {
    const fake = createFakePlatform()
    const session = createSession(fake.platform)
    await session.engine.start()
    const kernel = () => fake.audio.node.host.kernel
    return { fake, session, kernel }
  }

  it('window blur stops every voice, whatever was holding it', async () => {
    const { fake, session, kernel } = await playing()
    session.lifecycle.press('pointer:1', 60, 0.8)
    fake.events.key('down', 'KeyD')
    fake.events.key('down', 'Space')
    session.lifecycle.press('midi:x:0', 72, 0.8)
    fake.audio.node.render(0.05)
    expect(kernel().voiceCount).toBe(3)
    expect(session.lifecycle.getSnapshot().sustain).toBe(true)

    fake.events.emitBlur()
    expect(session.lifecycle.getSnapshot()).toEqual({ held: [], sustain: false })
    const tail = fake.audio.node.render(0.5)
    expect(kernel().voiceCount).toBe(0)
    expect(peak(tail.left.subarray(tail.left.length - 128))).toBe(0)

    // Key-up events that arrive after the blur are harmless, and the key works again afterwards.
    fake.events.key('up', 'KeyD')
    fake.events.key('down', 'KeyD')
    expect(session.lifecycle.getSnapshot().held).toEqual([64])
    session.dispose()
  })

  it('hiding the page stops every voice', async () => {
    const { fake, session, kernel } = await playing()
    session.lifecycle.press('pointer:1', 60, 0.8)
    session.lifecycle.setSustain('ui:pedal', true)
    fake.audio.node.render(0.05)
    fake.events.emitHidden()
    fake.audio.node.render(0.5)
    expect(kernel().voiceCount).toBe(0)
    expect(session.lifecycle.getSnapshot().sustain).toBe(false)
    session.dispose()
  })

  it('unplugging a MIDI device releases its notes and its pedal', async () => {
    const { fake, session, kernel } = await playing()
    const port = new FakeMidiPort('kbd-1', 'Test Keys')
    fake.midi.ports.set(port.id, port)
    await session.midi.enable()
    port.send(0xb0, 64, 127)
    port.send(0x90, 60, 100)
    port.send(0x90, 64, 100)
    port.send(0x80, 64, 0)
    fake.audio.node.render(0.05)
    expect(kernel().voiceCount).toBe(2)

    fake.midi.unplug('kbd-1')
    expect(session.midi.getSnapshot().status).toBe('no-inputs')
    expect(session.lifecycle.getSnapshot()).toEqual({ held: [], sustain: false })
    expect(port.onmidimessage).toBeNull()
    fake.audio.node.render(1.5)
    expect(kernel().voiceCount).toBe(0)
    session.dispose()
  })

  it('dispose returns listeners, MIDI handlers, timers, and voices to baseline', async () => {
    const fake = createFakePlatform()
    expect(fake.events.listenerCount).toBe(0)
    const session = createSession(fake.platform)
    expect(fake.events.listenerCount).toBe(4) // key down, key up, blur, hidden
    const port = new FakeMidiPort('kbd-1')
    fake.midi.ports.set(port.id, port)
    await session.midi.enable()
    await session.engine.start()
    session.lifecycle.press('pointer:1', 60, 0.8)
    port.send(0x90, 67, 90)
    fake.audio.node.render(0.05)
    expect(session.midi.attachedCount).toBe(1)

    session.dispose()
    session.dispose() // idempotent
    expect(fake.events.listenerCount).toBe(0)
    expect(session.midi.attachedCount).toBe(0)
    expect(port.onmidimessage).toBeNull()
    expect(fake.midi.access?.onstatechange).toBeNull()
    expect(fake.timing.pendingTimers).toBe(0)
    expect(fake.audio.context.closed).toBe(true)
    expect(fake.audio.node.connected).toBe(false)
    fake.audio.node.render(0.5)
    expect(fake.audio.node.host.kernel.voiceCount).toBe(0)
    expect(session.lifecycle.getSnapshot()).toEqual({ held: [], sustain: false })
  })
})

describe('piano.basic-status-cleanup: what the user is told', () => {
  it('shows Idle before any gesture, then Ready, on the page and on the Program OLED', async () => {
    const app = mountApp()
    expect(screen.getByTestId('audio-status')).toHaveTextContent('Idle')
    expect(app.control('program-oled')).toHaveTextContent('AUDIO PRESS A KEY')

    fireEvent.pointerDown(app.key(60), { pointerId: 1 })
    await app.settle()
    expect(screen.getByTestId('audio-status')).toHaveTextContent('Ready')
    expect(app.control('program-oled')).toHaveTextContent('AUDIO READY')
    expect(app.control('program-oled').getAttribute('aria-label')).toMatch(/AUDIO READY/)
  })

  it('says Fallback when it is a fallback and Error when there is no sound', async () => {
    const fallback = mountApp((fake) => {
      fake.audio.worklet = 'reject'
    })
    fireEvent.pointerDown(fallback.key(60), { pointerId: 1 })
    await fallback.settle()
    expect(screen.getByTestId('audio-status')).toHaveTextContent('Fallback')
    expect(fallback.control('program-oled')).toHaveTextContent('AUDIO FALLBACK')
    fallback.unmount()

    const broken = mountApp((fake) => {
      fake.audio.supported = false
    })
    fireEvent.pointerDown(broken.key(60), { pointerId: 1 })
    await broken.settle()
    expect(screen.getByTestId('audio-status')).toHaveTextContent('Error')
    expect(broken.control('program-oled')).toHaveTextContent('AUDIO NO AUDIO')
    // The key still moves: input keeps working even with no sound.
    expect(broken.key(60)).toHaveAttribute('aria-pressed', 'true')
  })

  it('unmounting the app stops every voice and removes every listener', async () => {
    const app = mountApp()
    fireEvent.pointerDown(app.key(60), { pointerId: 1 })
    fireEvent.pointerDown(app.key(64), { pointerId: 2 })
    await app.settle()
    act(() => {
      app.fake.events.key('down', 'Space')
    })
    app.fake.audio.node.render(0.05)
    expect(app.fake.audio.node.host.kernel.voiceCount).toBe(2)
    expect(app.fake.events.listenerCount).toBeGreaterThan(0)

    app.unmount()
    expect(app.fake.events.listenerCount).toBe(0)
    expect(app.fake.audio.context.closed).toBe(true)
    expect(app.fake.audio.node.connected).toBe(false)
    app.fake.audio.node.render(0.5)
    expect(app.fake.audio.node.host.kernel.voiceCount).toBe(0)
  })

  it('the All notes off button stops everything', async () => {
    const app = mountApp()
    fireEvent.pointerDown(app.key(60), { pointerId: 1 })
    await app.settle()
    fireEvent.click(screen.getByRole('button', { name: /Sustain pedal/ }))
    expect(screen.getByRole('button', { name: /Sustain pedal/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'All notes off' }))
    expect(app.key(60)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /Sustain pedal/ })).toHaveAttribute('aria-pressed', 'false')
    app.fake.audio.node.render(0.5)
    expect(app.fake.audio.node.host.kernel.voiceCount).toBe(0)
  })
})

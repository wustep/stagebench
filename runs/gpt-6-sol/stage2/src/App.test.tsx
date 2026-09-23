import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { hardwareControls, pianoKeys, sections } from './hardware'
import { PianoEngine, routeMidiMessage, WebPianoBackend } from './piano'
import type { Voice, VoiceBackend } from './piano'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

function fakeBackend() {
  const started: { note: number; velocity: number; voice: Voice; released: number; stopped: number }[] = []
  const backend: VoiceBackend = { start(note, velocity) {
    const entry = { note, velocity, released: 0, stopped: 0, voice: {} as Voice }
    entry.voice = { release: () => { entry.released++ }, stop: () => { entry.stopped++ } }
    started.push(entry)
    return entry.voice
  } }
  return { backend, started }
}

describe('surface model', () => {
  it('has exact 73-key E1–E7 geometry and the six photo measured sections', () => {
    expect(pianoKeys).toHaveLength(73)
    expect(pianoKeys[0]).toMatchObject({ midi: 28, name: 'E1', isBlack: false })
    expect(pianoKeys[72]).toMatchObject({ midi: 100, name: 'E7', isBlack: false })
    expect(pianoKeys.filter(key => key.isBlack)).toHaveLength(30)
    expect(pianoKeys.filter(key => !key.isBlack)).toHaveLength(43)
    expect(pianoKeys.filter(key => !key.isBlack).map(key => key.whiteIndex)).toEqual(Array.from({ length: 43 }, (_, index) => index))
    expect(sections.map(section => [section.id, section.width])).toEqual([
      ['performance', 14], ['organ', 20], ['piano', 8.5], ['program', 12.5], ['synth', 25], ['effects', 20],
    ])
    expect(sections.reduce((sum, section) => sum + section.width, 0)).toBe(100)
  })

  it('gives every control a unique stable ID and includes required landmarks', () => {
    expect(new Set(hardwareControls.map(control => control.id)).size).toBe(hardwareControls.length)
    expect(hardwareControls.filter(control => control.kind === 'drawbar')).toHaveLength(9)
    expect(hardwareControls.filter(control => control.section === 'program' && control.name.startsWith('Program '))).toHaveLength(9) // dial plus eight buttons
    for (const section of sections) expect(hardwareControls.filter(control => control.section === section.id).length).toBeGreaterThan(8)
  })
})

describe('note lifecycle', () => {
  it('handles repeated/overlapping notes, release and all notes off', () => {
    const { backend, started } = fakeBackend()
    const engine = new PianoEngine(backend)
    engine.noteOn('pointer:1', 60, 30)
    engine.noteOn('pointer:2', 60, 120)
    engine.noteOn('pointer:1', 60, 80)
    expect(engine.soundingCount).toBe(3)
    expect(started.map(entry => entry.velocity)).toEqual([30, 120, 80])
    engine.noteOff('pointer:1', 60)
    expect(started[0].released).toBe(1)
    expect(started[2].released).toBe(0)
    engine.noteOff('pointer:1', 60)
    engine.noteOff('pointer:2', 60)
    expect(engine.soundingCount).toBe(0)
    expect(started.every(entry => entry.released === 1)).toBe(true)
    engine.noteOn('keyboard:a', 48)
    engine.allNotesOff()
    expect(started[3].stopped).toBe(1)
    expect(engine.soundingCount).toBe(0)
  })

  it('holds released notes under sustain and steals the oldest voice deterministically', () => {
    const { backend, started } = fakeBackend()
    const engine = new PianoEngine(backend, 2)
    engine.setSustain('pedal', true)
    engine.noteOn('a', 60)
    engine.noteOff('a', 60)
    engine.noteOn('b', 62)
    engine.noteOn('c', 64)
    expect(started[0].stopped).toBe(1)
    expect(engine.activeNotes).toEqual([62, 64])
    engine.setSustain('pedal', false)
    expect(started[0].released).toBe(0)
    engine.noteOff('b', 62)
    expect(started[1].released).toBe(1)
    engine.allNotesOff()
    expect(started[2].stopped).toBe(1)
  })

  it('routes MIDI note velocity, note-on-zero, CC64 and disconnect cleanup', () => {
    const { backend, started } = fakeBackend()
    const engine = new PianoEngine(backend)
    routeMidiMessage(engine, 'midi:one', { data: [0x91, 60, 22] })
    routeMidiMessage(engine, 'midi:one', { data: [0xb1, 64, 127] })
    routeMidiMessage(engine, 'midi:one', { data: [0x91, 60, 0] })
    expect(started[0].velocity).toBe(22)
    expect(engine.soundingCount).toBe(1)
    routeMidiMessage(engine, 'midi:one', { data: [0xb1, 64, 0] })
    expect(started[0].released).toBe(1)
    routeMidiMessage(engine, 'midi:one', { data: [0x91, 61, 80] })
    engine.disconnectSource('midi:one')
    expect(started[1].stopped).toBe(1)
    expect(engine.soundingCount).toBe(0)
  })
})

describe('rendered instrument', () => {
  it('renders all keys, accessible controls, only two OLEDs and no detached chassis', () => {
    const { backend } = fakeBackend()
    const { container } = render(<App backend={backend} requestMidi={() => Promise.reject(new Error('denied'))} />)
    expect(container.querySelectorAll('.instrument')).toHaveLength(1)
    expect(container.querySelectorAll('.deck-section')).toHaveLength(6)
    expect(container.querySelectorAll('.piano-key')).toHaveLength(73)
    expect(container.querySelectorAll('.oled')).toHaveLength(2)
    expect(container.querySelectorAll('[data-control-id]')).toHaveLength(hardwareControls.length)
    expect(screen.getByRole('slider', { name: 'Master Level' })).toHaveValue('68')
    expect(screen.getByRole('button', { name: 'Piano On' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'E1 piano key' })).toHaveAttribute('data-midi', '28')
  })

  it('lets decorative controls move with keyboard/pointer without starting audio', () => {
    const { backend, started } = fakeBackend()
    render(<App backend={backend} requestMidi={() => Promise.reject(new Error('denied'))} />)
    const button = screen.getByRole('button', { name: 'Piano On' })
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'true')
    const knob = screen.getByRole('slider', { name: 'Master Level' })
    fireEvent.change(knob, { target: { value: '73' } })
    expect(knob).toHaveValue('73')
    expect(started).toHaveLength(0)
  })

  it('plays mapped computer keys, suppresses repeats, sustains, and cleans on blur', () => {
    const { backend, started } = fakeBackend()
    render(<App backend={backend} requestMidi={() => Promise.reject(new Error('denied'))} />)
    const focusedButton = screen.getByRole('button', { name: 'Piano On' })
    focusedButton.focus()
    fireEvent.keyDown(focusedButton, { key: 'a', code: 'KeyA' })
    fireEvent.keyDown(focusedButton, { key: 'a', code: 'KeyA', repeat: true })
    expect(started).toHaveLength(1)
    expect(started[0].note).toBe(48)
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    fireEvent.keyUp(window, { key: 'a', code: 'KeyA' })
    expect(started[0].released).toBe(0)
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
    expect(started[0].released).toBe(1)
    fireEvent.keyDown(window, { key: 's', code: 'KeyS' })
    fireEvent.blur(window)
    expect(started[1].stopped).toBe(1)
  })

  it('tracks two independent pointer presses and releases', () => {
    class TestPointerEvent extends MouseEvent {
      pointerId: number
      constructor(type: string, init: MouseEventInit & { pointerId?: number }) { super(type, init); this.pointerId = init.pointerId ?? 0 }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent)
    HTMLElement.prototype.setPointerCapture = vi.fn()
    const { backend, started } = fakeBackend()
    render(<App backend={backend} requestMidi={() => Promise.reject(new Error('denied'))} />)
    const e = screen.getByRole('button', { name: 'E1 piano key' })
    const f = screen.getByRole('button', { name: 'F1 piano key' })
    fireEvent.pointerDown(e, { pointerId: 1 })
    fireEvent.pointerDown(f, { pointerId: 2 })
    expect(started.map(entry => entry.note)).toEqual([28, 29])
    fireEvent.pointerUp(e, { pointerId: 1 })
    expect(started[0].released).toBe(1)
    expect(started[1].released).toBe(0)
    fireEvent.pointerCancel(f, { pointerId: 2 })
    expect(started[1].released).toBe(1)
  })

  it('reports denied MIDI without pretending it connected', async () => {
    const { backend } = fakeBackend()
    render(<App backend={backend} requestMidi={() => Promise.reject(new Error('denied'))} />)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('MIDI denied or unavailable'))
  })

  it('stops a held note when the instrument unmounts', () => {
    const { backend, started } = fakeBackend()
    const view = render(<App backend={backend} requestMidi={() => Promise.reject(new Error('denied'))} />)
    fireEvent.keyDown(window, { key: 'a', code: 'KeyA' })
    expect(started).toHaveLength(1)
    view.unmount()
    expect(started[0].stopped).toBe(1)
  })
})

describe('live synthesis graph', () => {
  it('makes nonzero velocity-sensitive gain and schedules release to silence', () => {
    vi.useFakeTimers()
    class Param {
      value = 0
      ramps: number[] = []
      setValueAtTime(value: number) { this.value = value }
      exponentialRampToValueAtTime(value: number) { this.value = value; this.ramps.push(value) }
      cancelScheduledValues() {}
    }
    class Gain {
      gain = new Param()
      connect() { return this }
      disconnect() {}
    }
    class Oscillator {
      type = 'sine'
      frequency = new Param()
      connect(target: Gain) { return target }
      start() {}
      stop() {}
      disconnect() {}
    }
    class Context {
      static instances: Context[] = []
      state = 'running'
      currentTime = 0
      destination = {}
      gains: Gain[] = []
      constructor() { Context.instances.push(this) }
      createGain() { const gain = new Gain(); this.gains.push(gain); return gain }
      createOscillator() { return new Oscillator() }
      resume() { return Promise.resolve() }
      close() { return Promise.resolve() }
    }
    vi.stubGlobal('AudioContext', Context)
    const statuses: string[] = []
    const backend = new WebPianoBackend(status => statuses.push(status))
    const soft = backend.start(60, 20)
    const loud = backend.start(60, 120)
    const [softOutput, , , , loudOutput] = Context.instances[0].gains
    expect(softOutput.gain.ramps[0]).toBeGreaterThan(0)
    expect(loudOutput.gain.ramps[0]).toBeGreaterThan(softOutput.gain.ramps[0])
    expect(statuses).toContain('ready')
    soft.release()
    loud.stop()
    expect(softOutput.gain.ramps.at(-1)).toBe(0.0001)
    vi.advanceTimersByTime(400)
    expect(backend.liveVoiceCount).toBe(0)
  })

  it('reports an audio error when Web Audio cannot be created', () => {
    vi.stubGlobal('AudioContext', undefined)
    const statuses: string[] = []
    const backend = new WebPianoBackend(status => statuses.push(status))
    backend.start(60, 100)
    expect(statuses).toEqual(['loading', 'error'])
    expect(backend.liveVoiceCount).toBe(0)
  })
})

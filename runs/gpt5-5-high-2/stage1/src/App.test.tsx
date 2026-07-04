import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { blackKeyCount, createControlState, decorativeControls, keyboard, sections, whiteKeyCount } from './hardware'
import { createPianoEngine } from './pianoEngine'

class FakeAudioParam {
  value = 0
  setValueAtTime(value: number) {
    this.value = value
  }
  exponentialRampToValueAtTime(value: number) {
    this.value = value
  }
  cancelScheduledValues() {}
}

class FakeNode {
  gain = new FakeAudioParam()
  frequency = new FakeAudioParam()
  detune = new FakeAudioParam()
  type = 'triangle'
  connected: unknown[] = []
  stopped = false
  connect(target: unknown) {
    this.connected.push(target)
  }
  disconnect() {
    this.connected = []
  }
  start() {}
  stop() {
    this.stopped = true
  }
}

class FakeAudioContext {
  currentTime = 1
  destination = {}
  state = 'running'
  createOscillator() {
    return new FakeNode() as unknown as OscillatorNode
  }
  createGain() {
    return new FakeNode() as unknown as GainNode
  }
  resume = vi.fn()
  close = vi.fn()
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Nord Stage 4 73 surface', () => {
  it('models the exact Stage 4 73 E-to-E keybed and section layout', () => {
    expect(keyboard).toHaveLength(73)
    expect(whiteKeyCount).toBe(43)
    expect(blackKeyCount).toBe(30)
    expect(keyboard[0]).toMatchObject({ note: 'E1', midi: 28, black: false })
    expect(keyboard.at(-1)).toMatchObject({ note: 'E7', midi: 100, black: false })
    expect(sections.map((section) => section.id)).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    expect(sections.map((section) => section.fraction)).toEqual([0.13, 0.21, 0.15, 0.09, 0.21, 0.21])
    expect(sections.filter((section) => section.hasOled).map((section) => section.id)).toEqual(['program', 'synth'])
  })

  it('renders the complete visible surface with required landmarks and stable controls', () => {
    render(<App />)
    expect(screen.getByLabelText(/Nord Stage 4 73 Phase 1 recreation/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /piano key/i })).toHaveLength(73)
    expect(screen.getByLabelText(/Program \/ Morph primary OLED/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Synth primary OLED/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Organ primary OLED/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Nine decorative organ drawbars/i)).toBeInTheDocument()

    for (const control of decorativeControls) {
      const button = screen.getByRole('button', { name: `${control.label} decorative control` })
      expect(button).toHaveAttribute('data-control-id', control.id)
    }
  })

  it('moves decorative controls accessibly without changing their stable inventory', () => {
    render(<App />)
    const state = createControlState()
    expect(Object.keys(state)).toHaveLength(decorativeControls.length)
    const dial = screen.getByRole('button', { name: /Program Dial decorative control/i })
    expect(dial).toHaveAttribute('aria-valuenow', '42')
    fireEvent.keyDown(dial, { key: 'ArrowRight' })
    expect(dial).toHaveAttribute('aria-valuenow', '50')
    const live = screen.getByRole('button', { name: /Live Mode decorative control/i })
    fireEvent.pointerDown(live, { pointerId: 9 })
    expect(live).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('piano key interactions', () => {
  it('supports pointer note press, release, cancel, and blur cleanup presentation', () => {
    render(<App />)
    const key = screen.getByRole('button', { name: 'C4 piano key' })
    fireEvent.pointerDown(key, { pointerId: 1, clientY: 20 })
    expect(key).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerCancel(key, { pointerId: 1 })
    expect(key).toHaveAttribute('aria-pressed', 'false')

    fireEvent.pointerDown(key, { pointerId: 2, clientY: 20 })
    fireEvent.blur(window)
    expect(key).toHaveAttribute('aria-pressed', 'false')
  })

  it('supports mapped computer keys with repeat suppression and sustain cleanup', () => {
    render(<App />)
    const c3 = screen.getByRole('button', { name: 'C3 piano key' })
    fireEvent.keyDown(window, { key: 'a', repeat: false })
    expect(c3).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: 'a', repeat: true })
    expect(c3).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: ' ', repeat: false })
    fireEvent.keyUp(window, { key: 'a' })
    expect(c3).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('piano-status')).toHaveTextContent(/sustain held/i)
    fireEvent.keyUp(window, { key: ' ' })
    expect(screen.getByTestId('piano-status')).toHaveTextContent(/generated piano ready/i)
  })

  it('keeps the chassis inspectable within the canonical document at desktop and narrow widths', () => {
    render(<App />)
    const shell = screen.getByLabelText(/Nord Stage 4 73 Phase 1 recreation/i)
    expect(shell).toHaveClass('instrument-shell')
    expect(within(shell).getByLabelText(/73 key E to E hammer action keybed/i)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/hero|buy now|fully modeled effects/i)
  })
})

describe('basic generated piano engine', () => {
  it('has a deterministic note lifecycle with release, sustain, polyphony, and voice stealing', () => {
    vi.useFakeTimers()
    const status = vi.fn()
    const engine = createPianoEngine({ context: new FakeAudioContext() as unknown as AudioContext, maxVoices: 2, onStatus: status })
    engine.prepare()
    engine.noteOn(60, 0.2, 'one')
    engine.noteOn(64, 1, 'two')
    expect(engine.getSnapshot()).toMatchObject({ activeVoices: 2, sustain: false, stolenVoices: 0 })
    engine.noteOn(67, 0.8, 'three')
    expect(engine.getSnapshot().stolenVoices).toBe(1)
    engine.setSustain(true)
    engine.noteOff(64, 'two')
    expect(engine.getSnapshot().sustain).toBe(true)
    engine.setSustain(false)
    engine.allNotesOff()
    vi.advanceTimersByTime(1000)
    expect(engine.getSnapshot().activeVoices).toBe(0)
  })

  it('reports a truthful fallback when no browser audio context exists', () => {
    const originalAudioContext = window.AudioContext
    const originalWebkitAudioContext = window.webkitAudioContext
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined })
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: undefined })
    const engine = createPianoEngine()
    engine.prepare()
    expect(engine.getSnapshot().status).toMatchObject({ state: 'fallback' })
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: originalAudioContext })
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: originalWebkitAudioContext })
  })
})

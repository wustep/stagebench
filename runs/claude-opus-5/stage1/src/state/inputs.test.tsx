import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { peak } from '../audio/offline'
import { midiVelocityToUnit, parseMidiMessage } from '../input/midi'
import {
  DEFAULT_BASE_MIDI,
  clampBaseMidi,
  midiForKeyCode,
  shouldHandleSustainKey,
} from '../input/keymap'
import { absentAudioBoundaries, createRig, failingAudioBoundaries } from '../test/harness'

const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CONTROL_CHANGE = 0xb0

/** Feature: piano.basic-inputs */
describe('MIDI message parsing', () => {
  it('reads note on, note off, zero-velocity note off and sustain', () => {
    expect(parseMidiMessage(new Uint8Array([NOTE_ON, 60, 100]))).toEqual({
      type: 'noteOn',
      note: 60,
      velocity: 100,
      channel: 0,
    })
    expect(parseMidiMessage(new Uint8Array([NOTE_ON, 60, 0]))).toEqual({ type: 'noteOff', note: 60, channel: 0 })
    expect(parseMidiMessage(new Uint8Array([NOTE_OFF | 3, 60, 64]))).toEqual({
      type: 'noteOff',
      note: 60,
      channel: 3,
    })
    expect(parseMidiMessage(new Uint8Array([CONTROL_CHANGE, 64, 127]))).toEqual({
      type: 'sustain',
      down: true,
      channel: 0,
    })
    expect(parseMidiMessage(new Uint8Array([CONTROL_CHANGE, 64, 0]))).toEqual({
      type: 'sustain',
      down: false,
      channel: 0,
    })
    expect(parseMidiMessage(new Uint8Array([CONTROL_CHANGE, 123, 0]))).toEqual({
      type: 'allNotesOff',
      channel: 0,
    })
  })

  it('ignores messages the piano does not use, and malformed data', () => {
    expect(parseMidiMessage(new Uint8Array([0xe0, 0, 64]))).toBeNull()
    expect(parseMidiMessage(new Uint8Array([CONTROL_CHANGE, 7, 100]))).toBeNull()
    expect(parseMidiMessage(new Uint8Array([0x90]))).toBeNull()
    expect(parseMidiMessage(null)).toBeNull()
    expect(parseMidiMessage(undefined)).toBeNull()
  })

  it('maps MIDI velocity onto the engine range without ever reaching zero', () => {
    expect(midiVelocityToUnit(127)).toBe(1)
    expect(midiVelocityToUnit(1)).toBeGreaterThan(0)
    expect(midiVelocityToUnit(64)).toBeGreaterThan(midiVelocityToUnit(20))
  })
})

describe('computer keyboard mapping', () => {
  it('maps the two mapped rows onto a chromatic octave and a half', () => {
    expect(midiForKeyCode('KeyA', 60)).toBe(60)
    expect(midiForKeyCode('KeyW', 60)).toBe(61)
    expect(midiForKeyCode('Quote', 60)).toBe(77)
    expect(midiForKeyCode('KeyQ', 60)).toBeNull()
  })

  it('refuses to map notes outside the variant range', () => {
    expect(midiForKeyCode('KeyA', 20)).toBeNull()
    expect(clampBaseMidi(0)).toBe(28)
    expect(clampBaseMidi(999)).toBe(83)
    expect(clampBaseMidi(DEFAULT_BASE_MIDI)).toBe(DEFAULT_BASE_MIDI)
  })

  it('leaves Space to a focused control instead of stealing it for sustain', () => {
    const button = document.createElement('button')
    const slider = document.createElement('div')
    slider.setAttribute('role', 'slider')
    const input = document.createElement('input')
    expect(shouldHandleSustainKey(button)).toBe(false)
    expect(shouldHandleSustainKey(slider)).toBe(false)
    expect(shouldHandleSustainKey(input)).toBe(false)
    expect(shouldHandleSustainKey(document.body)).toBe(true)
    expect(shouldHandleSustainKey(null)).toBe(true)
  })
})

describe('wired inputs', () => {
  it('plays and releases from mapped computer keys with repeat suppression', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    const key = container.querySelector('#key-60')!

    act(() => {
      fireEvent.keyDown(window, { code: 'KeyA', key: 'a' })
    })
    await waitFor(() => expect(key).toHaveAttribute('aria-pressed', 'true'))
    const nodesAfterFirst = rig.graph.liveNodeCount

    act(() => {
      fireEvent.keyDown(window, { code: 'KeyA', key: 'a', repeat: true })
      fireEvent.keyDown(window, { code: 'KeyA', key: 'a' })
    })
    expect(rig.graph.liveNodeCount).toBe(nodesAfterFirst)

    act(() => {
      fireEvent.keyUp(window, { code: 'KeyA', key: 'a' })
    })
    await waitFor(() => expect(key).toHaveAttribute('aria-pressed', 'false'))
  })

  it('shifts the mapped octave with Z and X', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyX', key: 'x' })
    })
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyA', key: 'a' })
    })
    await waitFor(() => expect(container.querySelector('#key-72')).toHaveAttribute('aria-pressed', 'true'))
    act(() => {
      fireEvent.keyUp(window, { code: 'KeyA', key: 'a' })
      fireEvent.keyDown(window, { code: 'KeyZ', key: 'z' })
    })
    act(() => {
      fireEvent.keyDown(window, { code: 'KeyA', key: 'a' })
    })
    await waitFor(() => expect(container.querySelector('#key-60')).toHaveAttribute('aria-pressed', 'true'))
  })

  it('holds notes with the Space sustain key and releases them on key up', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    const sustainButton = screen.getByRole('button', { name: /Sustain pedal/i })

    act(() => {
      fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    })
    await waitFor(() => expect(sustainButton).toHaveAttribute('aria-pressed', 'true'))

    act(() => {
      fireEvent.keyDown(window, { code: 'KeyA', key: 'a' })
      fireEvent.keyUp(window, { code: 'KeyA', key: 'a' })
    })
    await waitFor(() => expect(container.querySelector('#key-60')).toHaveAttribute('aria-pressed', 'false'))
    // The key is up but the pedal still owns the voice.
    expect(peak(rig.graph.render(0.3))).toBeGreaterThan(0)

    act(() => {
      fireEvent.keyUp(window, { code: 'Space', key: ' ' })
    })
    await waitFor(() => expect(sustainButton).toHaveAttribute('aria-pressed', 'false'))
  })

  it('plays MIDI notes with velocity and honours CC64 sustain', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    await screen.findByText(/MIDI connected/i)
    expect(screen.getByText(/Fake Controller/)).toBeInTheDocument()

    act(() => {
      rig.midiInput.send([NOTE_ON, 64, 110])
    })
    await waitFor(() => expect(container.querySelector('#key-64')).toHaveAttribute('aria-pressed', 'true'))
    expect(peak(rig.graph.render(0.3))).toBeGreaterThan(0.05)

    act(() => {
      rig.midiInput.send([CONTROL_CHANGE, 64, 127])
    })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Sustain pedal/i })).toHaveAttribute('aria-pressed', 'true'),
    )

    act(() => {
      rig.midiInput.send([NOTE_OFF, 64, 0])
    })
    await waitFor(() => expect(container.querySelector('#key-64')).toHaveAttribute('aria-pressed', 'false'))
  })

  it('renders a hard MIDI strike louder than a soft one', async () => {
    const soft = createRig()
    const softRender = render(<App boundaries={soft.boundaries} />)
    await screen.findByText(/MIDI connected/i)
    act(() => {
      soft.midiInput.send([NOTE_ON, 60, 20])
    })
    const softPeak = peak(soft.graph.render(0.3))
    softRender.unmount()

    const hard = createRig()
    render(<App boundaries={hard.boundaries} />)
    await screen.findByText(/MIDI connected/i)
    act(() => {
      hard.midiInput.send([NOTE_ON, 60, 120])
    })
    const hardPeak = peak(hard.graph.render(0.3))

    expect(hardPeak).toBeGreaterThan(softPeak * 2)
  })

  it('stops everything when a MIDI device is disconnected', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    await screen.findByText(/MIDI connected/i)
    act(() => {
      rig.midiInput.send([NOTE_ON, 60, 100])
    })
    await waitFor(() => expect(container.querySelector('#key-60')).toHaveAttribute('aria-pressed', 'true'))
    act(() => {
      rig.midiAccess.disconnect()
    })
    await waitFor(() => expect(container.querySelector('#key-60')).toHaveAttribute('aria-pressed', 'false'))
  })

  it('honours a MIDI all-notes-off message', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    await screen.findByText(/MIDI connected/i)
    act(() => {
      rig.midiInput.send([NOTE_ON, 60, 100])
      rig.midiInput.send([NOTE_ON, 67, 100])
    })
    await waitFor(() => expect(container.querySelector('#key-67')).toHaveAttribute('aria-pressed', 'true'))
    act(() => {
      rig.midiInput.send([CONTROL_CHANGE, 123, 0])
    })
    await waitFor(() => {
      expect(container.querySelector('#key-60')).toHaveAttribute('aria-pressed', 'false')
      expect(container.querySelector('#key-67')).toHaveAttribute('aria-pressed', 'false')
    })
  })

  it('reports denied MIDI honestly and keeps the keybed playable', async () => {
    const rig = createRig({ midi: 'denied' })
    const { container } = render(<App boundaries={rig.boundaries} />)
    await screen.findByText(/MIDI access was denied/i)
    expect(container.querySelector('[data-midi-permission="denied"]')).not.toBeNull()

    fireEvent.pointerDown(container.querySelector('#key-60')!, { pointerId: 1, button: 0, pointerType: 'mouse' })
    await waitFor(() => expect(container.querySelector('#key-60')).toHaveAttribute('aria-pressed', 'true'))
    expect(peak(rig.graph.render(0.3))).toBeGreaterThan(0)
  })

  it('reports a browser without Web MIDI honestly', async () => {
    const rig = createRig({ midi: 'unsupported' })
    const { container } = render(<App boundaries={rig.boundaries} />)
    await screen.findByText(/Web MIDI is not available/i)
    expect(container.querySelector('[data-midi-permission="unsupported"]')).not.toBeNull()
  })
})

/** Feature: piano.basic-status-cleanup */
describe('audio status and cleanup', () => {
  it('reports the ready state once the context is running', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={rig.boundaries} />)
    await screen.findByText(/Audio ready — generated piano voice/i)
    expect(container.querySelector('[data-audio-status="ready"]')).not.toBeNull()
    expect(container.querySelector('[data-oled="program"]')?.textContent).toContain('AUDIO READY')
  })

  it('reports a browser with no Web Audio and stays silent but playable', async () => {
    const { container } = render(<App boundaries={absentAudioBoundaries()} />)
    await screen.findByText(/Web Audio is not available/i)
    expect(container.querySelector('[data-audio-status="unsupported"]')).not.toBeNull()
    fireEvent.pointerDown(container.querySelector('#key-60')!, { pointerId: 1, button: 0, pointerType: 'mouse' })
    await waitFor(() => expect(container.querySelector('#key-60')).toHaveAttribute('aria-pressed', 'true'))
  })

  it('reports a failed audio context with the real reason', async () => {
    const { container } = render(<App boundaries={failingAudioBoundaries()} />)
    await screen.findByText(/could not start/i)
    expect(container.querySelector('[data-audio-status="error"]')).not.toBeNull()
    expect(screen.getByText(/AudioContext blocked/)).toBeInTheDocument()
  })

  it('starts suspended and only starts the context on a gesture when autoStart is off', async () => {
    const rig = createRig()
    const { container } = render(<App boundaries={{ ...rig.boundaries, autoStart: false }} />)
    expect(container.querySelector('[data-audio-status="idle"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start audio' }))
    await screen.findByText(/Audio ready — generated piano voice/i)
  })

  it('stops every owned voice and closes the context on unmount', async () => {
    const rig = createRig()
    const view = render(<App boundaries={rig.boundaries} />)
    await screen.findByText(/Audio ready — generated piano voice/i)
    fireEvent.pointerDown(view.container.querySelector('#key-60')!, {
      pointerId: 1,
      button: 0,
      pointerType: 'mouse',
    })
    await waitFor(() => expect(rig.graph.liveNodeCount).toBeGreaterThan(2))

    view.unmount()
    expect(rig.graph.liveNodeCount).toBe(0)
    expect(peak(rig.graph.render(0.5))).toBe(0)
    await waitFor(() => expect(rig.graph.state).toBe('closed'))
  })
})

import { act, fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VoiceState } from '../src/audio/dsp/kernel'
import details from '../IMPLEMENTATION_DETAILS.json'
import { mountApp, type MountedApp } from './support/app'
import { FakeMidiPort } from './support/fakes'
import { down, kernelOf, keys, led, oled, press, render, shiftPress, start, up } from './support/panel'
import { magnitudeAt, mono, rmsAt, timeToSilence } from './support/signal'
import { change, makeStage, renderStage, selectType } from './support/stage'

/**
 * Feature: piano.pedals
 * Sustain from UI/keyboard/MIDI honoring SUSTPED; any claimed soft/sostenuto behavior is
 * tested or truthfully labeled an approximation.
 *
 * Soft and sostenuto pedals are not implemented and not claimed; the last test pins that down.
 */

/** Strike and release middle C, then report how long it keeps sounding. */
function ringTime(app: MountedApp, seconds = 2.5): number {
  down(app, 60)
  render(app, 0.15)
  up(app, 60)
  return timeToSilence(mono(render(app, seconds)), 1e-3)
}

async function withMidi() {
  const port = new FakeMidiPort('in-1', 'Stage Keys')
  const app = mountApp((fake) => fake.midi.ports.set(port.id, port))
  await start(app)
  fireEvent.click(screen.getByRole('button', { name: 'Enable MIDI' }))
  await app.settle()
  return { app, port }
}

describe('piano.pedals: three ways to press the sustain pedal', () => {
  it('the on-screen pedal holds a released note, and lets it go when it comes up', async () => {
    const app = mountApp()
    await start(app)
    const dry = ringTime(app)
    expect(dry).toBeLessThan(0.8)

    fireEvent.click(screen.getByRole('button', { name: /Sustain pedal/ }))
    expect(app.control('program-oled')).toHaveTextContent('SUSTAIN DOWN')
    down(app, 60)
    render(app, 0.15)
    up(app, 60)
    expect(kernelOf(app).describeVoices()[0].state).toBe(VoiceState.Sustained)
    const held = mono(render(app, 1.5))
    expect(rmsAt(held, 1.3, 0.2)).toBeGreaterThan(0.002)

    fireEvent.click(screen.getByRole('button', { name: /Sustain pedal/ }))
    expect(kernelOf(app).describeVoices()[0].state).toBe(VoiceState.Released)
    expect(timeToSilence(mono(render(app, 2)), 1e-3)).toBeLessThan(0.8)
    expect(kernelOf(app).voiceCount).toBe(0)
  })

  it('the computer keyboard Space bar is the pedal', async () => {
    const app = mountApp()
    await start(app)
    act(() => void app.fake.events.key('down', 'Space'))
    expect(screen.getByRole('button', { name: /Sustain pedal/ })).toHaveAttribute('aria-pressed', 'true')
    act(() => void app.fake.events.key('down', 'KeyA'))
    render(app, 0.15)
    act(() => void app.fake.events.key('up', 'KeyA'))
    expect(rmsAt(mono(render(app, 1.5)), 1.3, 0.2)).toBeGreaterThan(0.002)
    act(() => void app.fake.events.key('up', 'Space'))
    render(app, 1.5)
    expect(kernelOf(app).voiceCount).toBe(0)
  })

  it('MIDI CC64 is the pedal: 64 and above is down, anything below is up (no half-pedalling)', async () => {
    const { app, port } = await withMidi()
    act(() => {
      port.send(0xb0, 64, 127)
      port.send(0x90, 60, 100)
      port.send(0x80, 60, 0)
    })
    expect(kernelOf(app).describeVoices()[0].state).toBe(VoiceState.Sustained)
    expect(rmsAt(mono(render(app, 1.5)), 1.3, 0.2)).toBeGreaterThan(0.002)
    // 63 is fully up: there is no in-between damper position.
    act(() => port.send(0xb0, 64, 63))
    expect(kernelOf(app).describeVoices()[0].state).toBe(VoiceState.Released)
    render(app, 1.5)
    expect(kernelOf(app).voiceCount).toBe(0)
    act(() => {
      port.send(0xb0, 64, 64)
      port.send(0x90, 62, 100)
      port.send(0x80, 62, 0)
    })
    expect(kernelOf(app).describeVoices()[0].state).toBe(VoiceState.Sustained)
  })

  it('any one source keeps the pedal down until every source has released it', async () => {
    const { app, port } = await withMidi()
    act(() => {
      app.fake.events.key('down', 'Space')
      port.send(0xb0, 64, 127)
    })
    down(app, 60)
    up(app, 60)
    act(() => void app.fake.events.key('up', 'Space'))
    expect(kernelOf(app).describeVoices()[0].state).toBe(VoiceState.Sustained)
    act(() => port.send(0xb0, 64, 0))
    expect(kernelOf(app).describeVoices()[0].state).toBe(VoiceState.Released)
  })
})

describe('piano.pedals: SUSTPED', () => {
  it('starts on, with its LED lit', () => {
    const app = mountApp()
    expect(led(app, 'piano-sustped')).toBe('on')
    expect(led(app, 'piano-pstick')).toBe('off')
  })

  it('Shift + Layer A switches SUSTPED; with it off the pedal no longer reaches the Piano', async () => {
    const app = mountApp()
    await start(app)
    fireEvent.click(screen.getByRole('button', { name: /Sustain pedal/ }))
    const sustained = ringTime(app)
    expect(sustained).toBeGreaterThan(2)
    fireEvent.click(screen.getByRole('button', { name: 'All notes off' }))
    render(app, 0.5)

    shiftPress(app, 'piano-layer-a')
    expect(led(app, 'piano-sustped')).toBe('off')
    expect(oled(app, 'notice')).toBe('> SUSTAIN PEDAL OFF')
    expect(kernelOf(app).getState().layers.map((layer) => layer.sustain)).toEqual([false, false])
    // Shift + Layer A did not touch the layer itself.
    expect(app.control('piano-layer-a')).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: /Sustain pedal/ }))
    // The pedal is physically down — and ignored.
    expect(app.control('program-oled')).toHaveTextContent('SUSTAIN DOWN')
    expect(ringTime(app)).toBeLessThan(0.8)
    expect(kernelOf(app).voiceCount).toBe(0)

    shiftPress(app, 'piano-layer-a')
    expect(led(app, 'piano-sustped')).toBe('on')
    expect(ringTime(app)).toBeGreaterThan(2)
  })

  it('switching SUSTPED off while the pedal is holding notes lets them go', async () => {
    const app = mountApp()
    await start(app)
    fireEvent.click(screen.getByRole('button', { name: /Sustain pedal/ }))
    down(app, 60)
    down(app, 64)
    up(app, 60)
    render(app, 0.2)
    shiftPress(app, 'piano-layer-a')
    const states = kernelOf(app).describeVoices().map((voice) => [voice.key, voice.state])
    // The released key is damped; the key still under a finger keeps sounding.
    expect(states).toEqual([
      [60, VoiceState.Released],
      [64, VoiceState.Held],
    ])
  })

  it('Shift can be the computer Shift key, or a click on a panel Shift button that latches it', async () => {
    const app = mountApp()
    await start(app)
    act(() => void app.fake.events.key('down', 'ShiftLeft'))
    press(app, 'piano-layer-a')
    act(() => void app.fake.events.key('up', 'ShiftLeft'))
    expect(led(app, 'piano-sustped')).toBe('off')

    // Latch: click Shift, then the control. The latch is shown, used once, and released.
    press(app, 'shift')
    expect(app.control('shift')).toHaveAttribute('data-latched', 'true')
    expect(app.control('fx-shift')).toHaveAttribute('data-latched', 'true')
    press(app, 'piano-layer-a')
    expect(led(app, 'piano-sustped')).toBe('on')
    expect(app.control('shift')).not.toHaveAttribute('data-latched')
    // Without Shift the same button is the layer button again.
    press(app, 'piano-layer-b')
    expect(app.control('piano-layer-b')).toHaveAttribute('aria-pressed', 'true')
    expect(led(app, 'piano-sustped')).toBe('on')
    // A second click on Shift releases an unused latch.
    press(app, 'shift')
    press(app, 'shift')
    expect(app.control('shift')).not.toHaveAttribute('data-latched')
  })

  it('reaches both layers when on, and each layer holds its own voices', async () => {
    const kernel = await makeStage((sound) => {
      sound.layers[1].on = true
      selectType(sound.layers[1], 'Upright')
    })
    kernel.setSustain(true)
    kernel.noteOn(60, 0.8)
    kernel.noteOff(60)
    expect(kernel.describeVoices().map((voice) => voice.state)).toEqual([VoiceState.Sustained, VoiceState.Sustained])
    change(kernel, (sound) => {
      for (const layer of sound.layers) layer.sustain = false
    })
    expect(kernel.describeVoices().map((voice) => voice.state)).toEqual([VoiceState.Released, VoiceState.Released])
    renderStage(kernel, 1.5)
    expect(kernel.voiceCount).toBe(0)
  })
})

describe('piano.pedals: PSTICK', () => {
  const C5 = 523.2511

  it('Shift + Layer B lets the pitch stick bend the Piano by up to two semitones either way', async () => {
    const app = mountApp()
    await start(app)
    for (let presses = 0; presses < 5; presses += 1) press(app, 'piano-type')
    // The stick does nothing to the Piano until PSTICK is on.
    keys(app, 'perf-pitch-stick', 'End')
    expect(kernelOf(app).getState().layers[0].bend).toBe(0)
    fireEvent.blur(app.control('perf-pitch-stick'))

    shiftPress(app, 'piano-layer-b')
    expect(led(app, 'piano-pstick')).toBe('on')
    expect(app.control('piano-layer-b')).toHaveAttribute('aria-pressed', 'false')

    down(app, 72)
    render(app, 0.2)
    const straight = mono(render(app, 0.3))
    expect(magnitudeAt(straight, C5)).toBeGreaterThan(magnitudeAt(straight, C5 * Math.pow(2, 2 / 12)) * 10)

    // Hold the stick fully up: two semitones sharp.
    const stick = app.control('perf-pitch-stick')
    fireEvent.keyDown(stick, { key: 'End' })
    expect(kernelOf(app).getState().layers[0].bend).toBe(2)
    render(app, 0.1)
    const bent = mono(render(app, 0.3))
    expect(magnitudeAt(bent, C5 * Math.pow(2, 2 / 12))).toBeGreaterThan(magnitudeAt(bent, C5) * 10)
    fireEvent.keyDown(stick, { key: 'Home' })
    expect(kernelOf(app).getState().layers[0].bend).toBe(-2)
    render(app, 0.1)
    const flat = mono(render(app, 0.3))
    expect(magnitudeAt(flat, C5 * Math.pow(2, -2 / 12))).toBeGreaterThan(magnitudeAt(flat, C5) * 10)

    // Let go: the stick springs back and so does the pitch.
    fireEvent.blur(stick)
    expect(kernelOf(app).getState().layers[0].bend).toBe(0)
    up(app, 72)
  })

  it('bends recorded pianos too', async () => {
    const kernel = await makeStage()
    kernel.noteOn(72, 0.8)
    const straight = mono(renderStage(kernel, 0.4))
    change(kernel, (sound) => void (sound.layers[0].bend = 2))
    renderStage(kernel, 0.05)
    const bent = mono(renderStage(kernel, 0.4))
    const D5 = C5 * Math.pow(2, 2 / 12)
    expect(magnitudeAt(straight, C5)).toBeGreaterThan(magnitudeAt(straight, D5) * 4)
    expect(magnitudeAt(bent, D5)).toBeGreaterThan(magnitudeAt(bent, C5) * 4)
  })
})

describe('piano.pedals: what is not there', () => {
  it('claims no soft pedal, sostenuto pedal, half-pedalling, or pedal noise', () => {
    const app = mountApp()
    expect(screen.queryByRole('button', { name: /soft pedal|sostenuto|una corda/i })).toBeNull()
    expect(app.container.textContent).not.toMatch(/sostenuto|una corda|half.?pedal/i)
    expect(details.optionalFeatures.notImplemented.join(' ')).toMatch(/Soft pedal and sostenuto pedal/)
    expect(details.optionalFeatures.implemented.join(' ')).not.toMatch(/soft pedal|sostenuto/i)
    expect(details.unsupported.excludedBySpec.join(' ')).toMatch(/Pedal noise and half-pedaling/)
    // The Ped Noise LED is never lit, and Shift + Acoustics only reports that it is unavailable.
    expect(led(app, 'piano-ped-noise')).toBe('off')
    shiftPress(app, 'piano-acoustics')
    expect(led(app, 'piano-ped-noise')).toBe('off')
    expect(oled(app, 'notice')).toBe('> PEDAL NOISE IS NOT AVAILABLE')
    expect(app.control('piano-acoustics')).toHaveAttribute('data-step-label', 'String Resonance')
  })
})

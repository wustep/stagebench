import { fireEvent, screen } from '@testing-library/react'
import { OfflineAudioContext } from 'node-web-audio-api'
import { describe, expect, it } from 'vitest'
import { ManualTimers, type AudioBoundary, type AudioContextLike } from './boundaries'
import { PianoEngine } from './engine'
import { renderApp } from '../test/renderApp'
import { meanAbsDiff, renderPiano, rms, zeroCrossings } from '../test/renderAudio'

describe('piano.layers', () => {
  it('owns voices per layer and cleans them up when a layer is disabled', async () => {
    const rendered = await renderPiano((engine) => {
      engine.pressLayer('B')
      engine.noteOn(60, 0.8)
      expect(engine.getFocus()).toBe('B')
      expect(engine.voicesOn('A')).toBe(1)
      expect(engine.voicesOn('B')).toBe(1)
      expect(engine.heldVoiceCount()).toBe(2)
    }, 0.3)
    expect(rms(rendered.channel, 200, 4000)).toBeGreaterThan(0.01)
    rendered.engine.setLayerEnabled('B', false)
    expect(rendered.engine.voicesOn('B')).toBe(0)
    expect(rendered.engine.getFocus()).toBe('A')
    rendered.engine.setLayerEnabled('A', false)
    expect(rendered.engine.activeVoiceCount()).toBe(0)
  })

  it('changes level and octave on the focused layer only', async () => {
    const quiet = await renderPiano((engine) => {
      engine.setLayerEnabled('A', false)
      engine.setLayerEnabled('B', true)
      engine.focusLayer('B')
      engine.setLayerLevel('B', 15)
      engine.noteOn(60, 0.85)
    }, 0.4)
    const loud = await renderPiano((engine) => {
      engine.setLayerEnabled('A', false)
      engine.setLayerEnabled('B', true)
      engine.focusLayer('B')
      engine.setLayerLevel('B', 100)
      engine.noteOn(60, 0.85)
    }, 0.4)
    expect(rms(loud.channel, 400, 8000)).toBeGreaterThan(rms(quiet.channel, 400, 8000) * 2)

    const low = await renderPiano((engine) => {
      engine.setOctave('A', 0)
      engine.noteOn(60, 0.7)
    }, 0.3)
    const high = await renderPiano((engine) => {
      engine.nudgeOctave(1)
      expect(engine.getLayer('A').octave).toBe(12)
      engine.nudgeOctave(1)
      expect(engine.getLayer('A').octave).toBe(12)
      engine.noteOn(60, 0.7)
    }, 0.3)
    const lowCross = zeroCrossings(low.channel, 800, 6000)
    const highCross = zeroCrossings(high.channel, 800, 6000)
    expect(highCross).toBeGreaterThan(lowCross * 1.6)
  })
})

describe('piano.pedals', () => {
  it('honors SUSTPED per layer and ignores sustain when that layer is off', async () => {
    const held = await renderPiano((engine) => {
      expect(engine.isSustped('A')).toBe(true)
      engine.setSustain(true)
      engine.noteOn(60, 0.8)
      engine.noteOff(60, 0.12)
      expect(engine.isNoteActive(60)).toBe(true)
    }, 0.7)
    const released = await renderPiano((engine) => {
      engine.toggleSustped('A')
      expect(engine.isSustped('A')).toBe(false)
      engine.setSustain(true)
      engine.noteOn(60, 0.8)
      engine.noteOff(60, 0.12)
      expect(engine.isNoteActive(60)).toBe(false)
    }, 0.7)
    expect(rms(held.channel, 22000, 30000)).toBeGreaterThan(rms(released.channel, 22000, 30000) * 1.8)
  })

  it('holds only the layer whose SUSTPED is enabled', () => {
    const timers = new ManualTimers()
    const context = new OfflineAudioContext(1, 44100, 44100)
    const engine = new PianoEngine({ createContext: () => context as unknown as AudioContextLike, timers })
    engine.ensureStarted()
    engine.pressLayer('B')
    engine.toggleSustped('B')
    engine.setSustain(true, 0)
    engine.noteOn(67, 0.7, 0)
    engine.noteOff(67, 0.05)
    expect(engine.isNoteActive(67)).toBe(true)
    timers.advance(500)
    expect(engine.voicesOn('A')).toBe(1)
    expect(engine.voicesOn('B')).toBe(0)
    expect(engine.isNoteActive(67)).toBe(true)
  })

  it('bends only layers with PSTICK enabled', async () => {
    const bent = await renderPiano((engine) => {
      engine.setPitchStick(100)
      engine.noteOn(60, 0.75)
    }, 0.3)
    const straight = await renderPiano((engine) => {
      engine.togglePstick('A')
      engine.setPitchStick(100)
      engine.noteOn(60, 0.75)
    }, 0.3)
    expect(zeroCrossings(bent.channel, 600, 5000)).toBeGreaterThan(zeroCrossings(straight.channel, 600, 5000) * 1.05)
    expect(meanAbsDiff(bent.channel, straight.channel)).toBeGreaterThan(0.01)
  })

  it('toggles sustain from the pedal control without claiming a second pedal model', () => {
    let engine: PianoEngine | null = null
    const timers = new ManualTimers()
    const context = new OfflineAudioContext(1, 44100, 44100)
    const audio: AudioBoundary = { createContext: () => context as unknown as AudioContextLike, timers }
    renderApp({
      audio,
      onEngine: (created) => {
        engine = created
      },
    })
    const pedal = screen.getByRole('button', { name: 'Sustain Pedal' })
    expect(pedal).toHaveAttribute('data-testid', 'sustain-pedal')
    expect(pedal).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(pedal)
    expect(engine!.isSustainDown()).toBe(true)
    expect(pedal).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(pedal)
    expect(engine!.isSustainDown()).toBe(false)
  })
})

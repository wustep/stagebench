import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { lastAudibleIndex, renderPianoScript, rms } from './audio/piano-engine'
import { defaultInstrumentState } from './model/instrument-state'

describe('piano.pedals', () => {
  it('honors SUSTPED per layer from the engine', async () => {
    const held = await renderPianoScript(0.85, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.sustped = true
      engine.applyState(state, 0)
      engine.setSustain(true, 0)
      engine.noteOn(60, 0.8, 0)
      engine.noteOff(60, 0.08)
    })
    const ignored = await renderPianoScript(0.85, (engine) => {
      const state = defaultInstrumentState()
      state.layers.A.sustped = false
      engine.applyState(state, 0)
      engine.setSustain(true, 0)
      engine.noteOn(60, 0.8, 0)
      engine.noteOff(60, 0.08)
    })
    const mid = Math.floor(0.4 * 44100)
    expect(rms(held, mid, mid + 4000)).toBeGreaterThan(rms(ignored, mid, mid + 4000) * 1.3)
    expect(lastAudibleIndex(held)).toBeGreaterThan(lastAudibleIndex(ignored))
  })

  it('drives sustain from the UI pedal and Space key', () => {
    render(<App deps={{ autoMidi: false }} />)
    const pedal = screen.getByLabelText('Sustain pedal')
    fireEvent.pointerDown(pedal, { pointerId: 21, button: 0 })
    expect(pedal).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pointerUp(pedal, { pointerId: 21 })
    expect(pedal).toHaveAttribute('aria-pressed', 'false')
    fireEvent.keyDown(window, { code: 'Space', key: ' ', repeat: false })
    expect(pedal).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(window, { code: 'Space', key: ' ' })
    expect(pedal).toHaveAttribute('aria-pressed', 'false')
  })
})

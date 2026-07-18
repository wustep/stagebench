import { fireEvent, render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../App'
import { PianoEngine } from '../audio/engine'
import { FakeAudioBackend, rms, windowEnergy } from '../audio/fake-backend'
import { makeRig } from '../test-helpers'
import { SYNTH_FALLBACK_LABEL } from '../state/app-context'

describe('piano.pedals', () => {
  it('sustain from UI lifecycle honors SUSTPED per layer', async () => {
    const { engine } = await makeRig()
    // Layer A SUSTPED on (default), layer B off.
    engine.setLayerEnabled('pianoB', true)
    engine.setLayerSustainPedal('pianoB', false)
    engine.setSustain(true)
    engine.setFocusLayer('pianoA')
    engine.noteOn(60, 0.8)
    engine.noteOff(60)
    engine.setFocusLayer('pianoB')
    engine.noteOn(64, 0.8)
    engine.noteOff(64)
    const a = engine.getVoices().find((v) => v.layer === 'pianoA')!
    const b = engine.getVoices().find((v) => v.layer === 'pianoB')!
    expect(a.releasedAt).toBeNull() // held by pedal
    expect(b.releasedAt).not.toBeNull() // SUSTPED off → released immediately
    engine.setSustain(false)
    expect(engine.getVoices().find((v) => v.layer === 'pianoA')!.releasedAt).not.toBeNull()
  })

  it('sustain works from the computer keyboard (spacebar) with SUSTPED on', async () => {
    const backend = new FakeAudioBackend()
    const engine = new PianoEngine(backend)
    render(<App engine={engine} disableMidi />)
    fireEvent.keyDown(window, { key: 'z' })
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyUp(window, { key: 'z' })
    expect(engine.getVoices()[0].releasedAt).toBeNull()
    fireEvent.keyUp(window, { key: ' ' })
    expect(engine.getVoices()[0].releasedAt).not.toBeNull()
  })

  it('with SUSTPED off the keyboard sustain does not defer release', async () => {
    const { engine } = await makeRig()
    engine.setLayerSustainPedal('pianoA', false)
    engine.setSustain(true)
    engine.noteOn(60, 0.8)
    engine.noteOff(60)
    expect(engine.getVoices()[0].releasedAt).not.toBeNull()
  })

  it('sustained notes audibly outlast released notes in the rendered signal', async () => {
    const { backend, engine } = await makeRig()
    engine.setSustain(true)
    engine.noteOn(60, 0.9)
    backend.advance(0.2)
    engine.noteOff(60) // pedal holds it
    const sustained = backend.renderMix(1.2, 0.2)
    engine.allNotesOff()
    const { backend: b2, engine: e2 } = await makeRig()
    e2.noteOn(60, 0.9)
    b2.advance(0.2)
    e2.noteOff(60) // damper down immediately
    const released = b2.renderMix(1.2, 0.2)
    const sr = backend.sampleRate
    const susTail = windowEnergy(sustained, sr * 0.6, sr * 1.2)
    const relTail = windowEnergy(released, sr * 0.6, sr * 1.2)
    expect(susTail).toBeGreaterThan(relTail * 3)
  })
})

describe('piano.fallback', () => {
  it('asset failure marks the type failed, reports honestly, and stays playable', async () => {
    const backend = new FakeAudioBackend()
    const engine = new PianoEngine(backend)
    render(<App engine={engine} disableMidi />)
    engine.markTypeFailed('grand', `${SYNTH_FALLBACK_LABEL}: grand samples failed to load (test)`)
    expect(engine.isTypeFailed('grand')).toBe(true)
    await waitFor(() => {
      const el = document.querySelector('[data-status="audio"]')!
      expect(el.textContent).toMatch(new RegExp(SYNTH_FALLBACK_LABEL, 'i'))
    })
    // Program display reports the failure (manual p. 24).
    await waitFor(() => {
      const oled = document.querySelector('[data-oled="piano-fallback"]')
      expect(oled).toBeTruthy()
      expect(oled!.textContent).toMatch(/failed/i)
    })
    // Still playable: notes start voices and render audio (the fallback voice).
    engine.noteOn(60, 0.8)
    expect(backend.activeVoiceCount()).toBe(1)
    backend.advance(0.05)
    const buf = backend.renderMix(0.4)
    expect(rms(buf)).toBeGreaterThan(0.001)
  })

  it('a failed type does not report the primary library ready for that type', async () => {
    const { engine } = await makeRig()
    engine.markTypeFailed('upright', 'test failure')
    expect(engine.isTypeFailed('upright')).toBe(true)
    expect(engine.isTypeFailed('grand')).toBe(false) // other types unaffected
  })

  it('the fallback is labeled synthesized, never described as the recording', async () => {
    const backend = new FakeAudioBackend()
    const engine = new PianoEngine(backend)
    render(<App engine={engine} disableMidi />)
    engine.setLayerType('pianoA', 'electric')
    engine.markTypeFailed('electric', `${SYNTH_FALLBACK_LABEL}: electric samples failed to load (test)`)
    await waitFor(() => {
      const oled = document.querySelector('[data-oled="piano-fallback"]')
      expect(oled).toBeTruthy()
      expect(oled!.textContent?.toLowerCase()).toContain('synthesized fallback')
      expect(oled!.textContent?.toLowerCase()).not.toContain('recorded')
    })
  })
})

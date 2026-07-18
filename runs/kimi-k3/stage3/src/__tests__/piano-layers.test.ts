import { describe, expect, it } from 'vitest'
import { MAX_VOICES } from '../audio/engine'
import { rms, windowEnergy } from '../audio/fake-backend'
import { makeRig } from '../test-helpers'

describe('piano.layers', () => {
  it('focus selects which layer new notes own', async () => {
    const { engine } = await makeRig()
    engine.setFocusLayer('pianoA')
    engine.noteOn(60, 0.8)
    expect(engine.getVoices()[0].layer).toBe('pianoA')
    engine.setLayerEnabled('pianoB', true)
    engine.setFocusLayer('pianoB')
    engine.noteOn(64, 0.8)
    expect(engine.getVoices()[1].layer).toBe('pianoB')
    expect(engine.getVoices().filter((v) => !v.stopped).length).toBe(2)
  })

  it('disabling a layer stops only its own voices (correct ownership)', async () => {
    const { engine, backend } = await makeRig()
    engine.setFocusLayer('pianoA')
    engine.noteOn(60, 0.8)
    engine.setLayerEnabled('pianoB', true)
    engine.setFocusLayer('pianoB')
    engine.noteOn(64, 0.8)
    expect(backend.activeVoiceCount()).toBe(2)
    engine.setLayerEnabled('pianoB', false)
    // Only the pianoB voice stopped.
    expect(backend.activeVoiceCount()).toBe(1)
    expect(engine.getVoices().every((v) => v.layer === 'pianoA')).toBe(true)
    engine.setLayerEnabled('pianoA', false)
    expect(backend.activeVoiceCount()).toBe(0)
  })

  it('notes are not started on a disabled layer', async () => {
    const { engine, backend } = await makeRig()
    engine.setLayerEnabled('pianoA', false)
    engine.setFocusLayer('pianoA')
    engine.noteOn(60, 0.8)
    expect(backend.startCount).toBe(0)
  })

  it('layer level measurably scales that layer in the rendered mix', async () => {
    const { backend, engine } = await makeRig()
    engine.noteOn(60, 0.9)
    backend.advance(0.05)
    const loud = backend.renderMix(0.5)
    engine.setLayerLevel('pianoA', 0.15)
    const quiet = backend.renderMix(0.5)
    expect(rms(quiet)).toBeLessThan(rms(loud) * 0.5)
    expect(rms(quiet)).toBeGreaterThan(0.0002)
  })

  it('octave shift transposes the rendered audio ±12 semitones', async () => {
    const { backend, engine } = await makeRig()
    engine.noteOn(60, 0.8)
    backend.advance(0.02)
    const normal = backend.renderMix(0.4)
    engine.setLayerOctave('pianoA', 12)
    const up = backend.renderMix(0.4)
    engine.setLayerOctave('pianoA', -12)
    const down = backend.renderMix(0.4)
    // Transposed renders must not be identical to the normal render.
    const corr = (a: Float32Array, b: Float32Array) => {
      let dot = 0, ea = 0, eb = 0
      for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; ea += a[i] * a[i]; eb += b[i] * b[i] }
      return dot / Math.max(1e-12, Math.sqrt(ea * eb))
    }
    expect(corr(normal, up)).toBeLessThan(0.9)
    expect(corr(normal, down)).toBeLessThan(0.9)
    expect(rms(up)).toBeGreaterThan(0.001)
    expect(rms(down)).toBeGreaterThan(0.001)
  })

  it('two layers with different types sound together in the mix (both contribute energy)', async () => {
    const { backend, engine } = await makeRig()
    engine.setFocusLayer('pianoA')
    engine.noteOn(60, 0.8)
    backend.advance(0.02)
    const aOnly = backend.renderMix(0.4)
    engine.setLayerEnabled('pianoB', true)
    engine.setFocusLayer('pianoB')
    engine.setLayerType('pianoB', 'electric')
    engine.noteOn(64, 0.8)
    const both = backend.renderMix(0.4)
    expect(rms(both)).toBeGreaterThan(rms(aOnly) * 1.1)
  })

  it('per-layer polyphony with stealing keeps ownership deterministic', async () => {
    const { backend, engine } = await makeRig()
    engine.setLayerEnabled('pianoB', true)
    for (let i = 0; i < MAX_VOICES + 4; i++) {
      backend.advance(0.005)
      engine.setFocusLayer(i % 2 === 0 ? 'pianoA' : 'pianoB')
      engine.noteOn(36 + (i % 40), 0.7)
    }
    const aLive = engine.getVoices().filter((v) => !v.stopped && v.layer === 'pianoA').length
    const bLive = engine.getVoices().filter((v) => !v.stopped && v.layer === 'pianoB').length
    expect(aLive).toBeLessThanOrEqual(MAX_VOICES)
    expect(bLive).toBeLessThanOrEqual(MAX_VOICES)
    expect(backend.activeVoiceCount()).toBeLessThanOrEqual(MAX_VOICES * 2)
  })

  it('cleanup returns per-layer voice counts to baseline', async () => {
    const { backend, engine } = await makeRig()
    engine.setLayerEnabled('pianoB', true)
    engine.noteOn(60, 0.8)
    engine.setFocusLayer('pianoB')
    engine.noteOn(64, 0.8)
    engine.allNotesOff()
    expect(backend.activeVoiceCount()).toBe(0)
    expect(engine.getVoices().length).toBe(0)
    // Render a window comfortably past the stop ramp: silence.
    const tail = backend.renderMix(0.3, 0.2)
    expect(windowEnergy(tail, 0, tail.length)).toBeLessThan(1e-6)
  })
})

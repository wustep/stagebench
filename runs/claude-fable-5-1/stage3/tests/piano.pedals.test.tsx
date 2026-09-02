import { readFileSync } from 'node:fs'
import path from 'node:path'
import { act, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { audibleSeconds, normalizedDifference } from '../src/dsp/analysis'
import { mono, renderPiano } from '../src/audio/offlinePiano'
import { el, keyEl, mountApp, quickRenderer, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

/** Arms the panel Shift latch (press + release of the Layer Effects SHIFT button). */
function armShift() {
  fireEvent.pointerDown(el('effects.shift'), { pointerId: 9, button: 0 })
  fireEvent.pointerUp(el('effects.shift'), { pointerId: 9 })
}

describe('piano.pedals — sustain from the UI, the computer keyboard and MIDI CC64, honouring SUSTPED', () => {
  it('the UI pedal, the Shift key and CC64 all sustain released keys until the pedal lifts', async () => {
    mounted = await mountApp()
    const { engine, bus } = mounted.services
    // UI pedal
    fireEvent.click(el('sustain-pedal'))
    expect(engine.isSustain()).toBe(true)
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(keyEl(60), { pointerId: 1 })
    expect(engine.activeVoices()[0]).toMatchObject({ midi: 60, sustained: true, releasing: false })
    fireEvent.click(el('sustain-pedal'))
    expect(engine.activeVoices()[0].releasing).toBe(true)
    mounted.world.ctx.advance(1)
    // computer keyboard Shift
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' })))
    expect(bus.isSustain()).toBe(true)
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' })))
    await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA' })))
    expect(engine.activeVoices()[0]).toMatchObject({ midi: 60, sustained: true })
    await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' })))
    expect(engine.activeVoices()[0].releasing).toBe(true)
    mounted.world.ctx.advance(1)
    // MIDI CC64
    await act(async () => {
      mounted!.world.input.send([0xb0, 64, 127])
      mounted!.world.input.send([0x90, 62, 100])
      mounted!.world.input.send([0x80, 62, 0])
    })
    expect(engine.activeVoices()[0]).toMatchObject({ midi: 62, sustained: true })
    await act(async () => mounted!.world.input.send([0xb0, 64, 0]))
    expect(engine.activeVoices()[0].releasing).toBe(true)
    expect(document.getElementById('sustain-status')?.textContent).toMatch(/Sustain: up/)
  })

  it('SUSTPED (Shift + Layer A) routes the pedal away from the Piano section: keys release even with the pedal down', async () => {
    mounted = await mountApp()
    const { engine, state } = mounted.services
    expect(state.get().piano.sustped).toBe(true)
    expect(document.querySelector('.led-sustped .led')?.className).toContain('lit')
    armShift()
    expect(state.get().shiftArmed).toBe(true)
    expect(document.getElementById('program.oled')?.textContent).toContain('SHIFT')
    fireEvent.click(el('piano.layer-a.on'))
    expect(state.get().piano.sustped).toBe(false)
    expect(state.get().piano.layers.A.on).toBe(true) // the layer itself is untouched by the Shift function
    expect(el('piano.layer-a.on').getAttribute('aria-pressed')).toBe('true')
    expect(state.get().shiftArmed).toBe(false)
    expect(document.querySelector('.led-sustped .led')?.className).not.toContain('lit')
    fireEvent.click(el('sustain-pedal'))
    expect(engine.isSustain()).toBe(true) // the pedal input itself is down…
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(keyEl(60), { pointerId: 1 })
    expect(engine.activeVoices()[0]).toMatchObject({ sustained: false, releasing: true }) // …but the piano ignores it
    expect(document.getElementById('sustain-status')?.textContent).toMatch(/SUSTPED off/)
    // back on: Shift + Layer A again
    armShift()
    fireEvent.click(el('piano.layer-a.on'))
    expect(state.get().piano.sustped).toBe(true)
    fireEvent.pointerDown(keyEl(64), { pointerId: 2, button: 0 })
    fireEvent.pointerUp(keyEl(64), { pointerId: 2 })
    expect(engine.activeVoices().find((v) => v.midi === 64)).toMatchObject({ sustained: true, releasing: false })
    fireEvent.click(el('sustain-pedal'))
  })

  it('PSTICK (Shift + Layer B) lets the pitch stick bend the piano ±2 semitones; otherwise the stick is inert', async () => {
    mounted = await mountApp()
    const { engine, state } = mounted.services
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    const source = mounted.world.ctx.sources().at(-1)!
    fireEvent.keyDown(el('performance.pitch-stick'), { key: 'End' })
    expect(source.playbackRate.value).toBe(1) // PSTICK off: the stick changes nothing audible
    fireEvent.keyUp(el('performance.pitch-stick'), { key: 'End' })
    armShift()
    fireEvent.click(el('piano.layer-b.on'))
    expect(state.get().piano.pstick).toBe(true)
    expect(state.get().piano.layers.B.on).toBe(false) // the layer toggle was a Shift function
    expect(document.querySelector('.led-pstick .led')?.className).toContain('lit')
    fireEvent.keyDown(el('performance.pitch-stick'), { key: 'End' })
    expect(source.playbackRate.value).toBeCloseTo(Math.pow(2, 2 / 12), 6)
    fireEvent.keyUp(el('performance.pitch-stick'), { key: 'End' }) // springs back to centre
    expect(source.playbackRate.value).toBeCloseTo(1, 6)
    fireEvent.pointerUp(keyEl(60), { pointerId: 1 })
    void engine
  })

  it('renders the pedal audibly: sustain lengthens a released note only while SUSTPED is on', () => {
    const sr = 11025
    const base = [
      { time: 0, type: 'on' as const, midi: 60, velocity: 100 },
      { time: 0.1, type: 'sustain' as const, on: true },
      { time: 0.3, type: 'off' as const, midi: 60 },
      { time: 1.4, type: 'sustain' as const, on: false },
    ]
    const withPedal = mono(renderPiano(base, { sampleRate: sr, seconds: 2, renderer: quickRenderer, sustped: true }))
    const pedalIgnored = mono(renderPiano(base, { sampleRate: sr, seconds: 2, renderer: quickRenderer, sustped: false }))
    const noPedal = mono(renderPiano(base.filter((e) => e.type !== 'sustain'), { sampleRate: sr, seconds: 2, renderer: quickRenderer }))
    expect(audibleSeconds(withPedal, sr)).toBeGreaterThan(audibleSeconds(noPedal, sr) + 0.8)
    expect(normalizedDifference(pedalIgnored, noPedal)).toBeLessThan(1e-6)
  })

  it('does not claim soft or sostenuto pedals: they are listed as unsupported, not simulated', () => {
    const details = JSON.parse(readFileSync(path.resolve(__dirname, '../IMPLEMENTATION_DETAILS.json'), 'utf8'))
    const unsupported = JSON.stringify(details.unsupported ?? details.excluded ?? [])
    expect(unsupported).toMatch(/sostenuto/i)
    expect(unsupported).toMatch(/soft pedal|una corda/i)
    expect(unsupported).toMatch(/half.?pedal/i)
  })
})

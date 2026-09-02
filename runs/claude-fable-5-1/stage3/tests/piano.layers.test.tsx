import { act, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { faderToGain } from '../src/dsp/types'
import { RELEASE_SECONDS } from '../src/audio/engine'
import { getModel } from '../src/audio/pianoModels'
import { el, flush, keyEl, mountApp, waitUntil, type Mounted } from './helpers'

let mounted: Mounted | null = null
afterEach(() => {
  mounted?.unmount()
  mounted = null
})

const voicesOf = (m: Mounted, layer: 'A' | 'B') => m.services.engine.activeVoices().filter((v) => v.layer === layer)

describe('piano.layers — two layers with enable, focus, level, octave and correct voice ownership', () => {
  it('only enabled layers own voices: A alone, then A + B, and turning B off releases only B', async () => {
    mounted = await mountApp()
    const { engine, state } = mounted.services
    expect(state.get().piano.layers.A.on).toBe(true)
    expect(state.get().piano.layers.B.on).toBe(false)
    fireEvent.pointerDown(keyEl(60), { pointerId: 1, button: 0 })
    expect(voicesOf(mounted, 'A')).toHaveLength(1)
    expect(voicesOf(mounted, 'B')).toHaveLength(0)
    fireEvent.pointerUp(keyEl(60), { pointerId: 1 })
    mounted.world.ctx.advance(1)
    // enable B from the panel: it turns on and takes focus
    fireEvent.click(el('piano.layer-b.on'))
    expect(state.get().piano.layers.B.on).toBe(true)
    expect(state.get().piano.focus).toBe('B')
    expect(el('piano.layer-b.on').getAttribute('aria-pressed')).toBe('true')
    fireEvent.pointerDown(keyEl(64), { pointerId: 2, button: 0 })
    expect(voicesOf(mounted, 'A').map((v) => v.midi)).toEqual([64])
    expect(voicesOf(mounted, 'B').map((v) => v.midi)).toEqual([64])
    expect(engine.getStatus().layers.B.voices).toBe(1)
    // turning B off releases B's voice, A keeps sounding while the key is held
    fireEvent.click(el('piano.layer-b.on'))
    expect(state.get().piano.layers.B.on).toBe(false)
    expect(state.get().piano.focus).toBe('A')
    expect(voicesOf(mounted, 'B').every((v) => v.releasing)).toBe(true)
    expect(voicesOf(mounted, 'A')[0].releasing).toBe(false)
    fireEvent.pointerUp(keyEl(64), { pointerId: 2 })
    mounted.world.ctx.advance(RELEASE_SECONDS + 0.2)
    expect(engine.activeVoices()).toEqual([])
    // turning the whole section off silences everything and new keys do not sound
    fireEvent.click(el('piano.on'))
    fireEvent.pointerDown(keyEl(60), { pointerId: 3, button: 0 })
    expect(engine.activeVoices()).toEqual([])
    expect(document.getElementById('program.oled')?.textContent).toMatch(/Piano section off/)
    fireEvent.pointerUp(keyEl(60), { pointerId: 3 })
    fireEvent.click(el('piano.on'))
  })

  it('each layer has its own level fader (LED graph + gain node with a ramp) and its own octave shift', async () => {
    mounted = await mountApp()
    const { engine, state } = mounted.services
    await act(async () => {
      fireEvent.click(el('start-audio'))
    })
    const ctx = mounted.world.ctx
    const [, , levelA, , levelB] = ctx.gains()
    expect(levelA.gain.value).toBeCloseTo(faderToGain(90), 6)
    expect(levelB.gain.value).toBe(0) // B is off
    fireEvent.keyDown(el('piano.layer-a.level'), { key: 'Home' })
    expect(state.get().piano.layers.A.level).toBe(0)
    expect(levelA.gain.events.at(-1)).toMatchObject({ type: 'target', value: 0 })
    fireEvent.keyDown(el('piano.layer-a.level'), { key: 'End' })
    expect(levelA.gain.events.at(-1)).toMatchObject({ type: 'target', value: faderToGain(100) })
    fireEvent.click(el('piano.layer-b.on'))
    expect(levelB.gain.events.at(-1)).toMatchObject({ type: 'target', value: faderToGain(45) })
    expect(el('piano.layer-b.level').parentElement!.querySelectorAll('.ladder-led.lit').length).toBeGreaterThan(0)
    // octave shift acts on the focused layer only (B is focused now)
    fireEvent.pointerDown(el('piano.octave-up'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('piano.octave-up'), { pointerId: 1 })
    expect(state.get().piano.layers.B.octave).toBe(1)
    expect(state.get().piano.layers.A.octave).toBe(0)
    fireEvent.pointerDown(el('piano.octave-up'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('piano.octave-up'), { pointerId: 1 })
    expect(state.get().piano.layers.B.octave).toBe(1) // clamped to ±1 octave
    fireEvent.pointerDown(keyEl(60), { pointerId: 2, button: 0 })
    expect(voicesOf(mounted, 'A')[0].playedMidi).toBe(60)
    expect(voicesOf(mounted, 'B')[0].playedMidi).toBe(72)
    fireEvent.pointerUp(keyEl(60), { pointerId: 2 })
    fireEvent.pointerDown(el('piano.octave-down'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('piano.octave-down'), { pointerId: 1 })
    fireEvent.pointerDown(el('piano.octave-down'), { pointerId: 1, button: 0 })
    fireEvent.pointerUp(el('piano.octave-down'), { pointerId: 1 })
    expect(state.get().piano.layers.B.octave).toBe(-1)
    void engine
  })

  it('focus follows the layer buttons and the FX FOCUS Piano button; the panel re-shows the focused layer', async () => {
    mounted = await mountApp()
    const { state } = mounted.services
    // A focused: set KB Touch to Light on A
    const touch = el('piano.kb-touch')
    fireEvent.click(touch)
    expect(state.get().piano.layers.A.kbTouch).toBe(2)
    expect(Number(touch.dataset.value)).toBe(2)
    // enable B → focus B → panel shows B's default (Medium)
    fireEvent.click(el('piano.layer-b.on'))
    expect(state.get().piano.focus).toBe('B')
    expect(Number(touch.dataset.value)).toBe(1)
    expect(document.querySelector('[data-layer="B"]')?.getAttribute('data-focus')).toBe('true')
    expect(el('piano.layer-b.on').closest('.pbtn-wrap')?.className).toContain('is-focus')
    fireEvent.click(el('piano.unison'))
    expect(state.get().piano.layers.B.unison).toBe(1)
    expect(state.get().piano.layers.A.unison).toBe(0)
    // FX FOCUS Piano pressed again while both layers are on toggles the focused layer back to A
    fireEvent.click(el('effects.focus.piano'))
    expect(state.get().piano.focus).toBe('A')
    expect(Number(touch.dataset.value)).toBe(2)
    expect(Number(el('piano.unison').dataset.value)).toBe(0)
    expect(document.querySelector('.fx-led-piano-a .led')?.className).toContain('lit')
    expect(document.querySelector('.fx-led-piano-b .led')?.className).not.toContain('lit')
  })

  it('layers can play different models independently, and unmount cleans every layer up', async () => {
    mounted = await mountApp({ samples: true })
    const { engine, state, bus } = mounted.services
    fireEvent.click(el('piano.layer-b.on'))
    // B → Electric (two type presses from Grand)
    fireEvent.click(el('piano.type'))
    fireEvent.click(el('piano.type'))
    expect(getModel(state.get().piano.layers.B.modelId).type).toBe('Electric')
    expect(getModel(state.get().piano.layers.A.modelId).type).toBe('Grand')
    await waitUntil(() => engine.getStatus().layers.A.state === 'ready' && engine.getStatus().layers.B.state === 'ready')
    await act(async () => {
      await engine.start()
    })
    await flush()
    await flush()
    bus.noteOn(60, 100, 'test')
    const a = voicesOf(mounted, 'A')[0]
    const b = voicesOf(mounted, 'B')[0]
    expect(a.source).toBe('recorded-samples')
    expect(b.source).toBe('recorded-samples')
    const sources = mounted.world.ctx.sources()
    expect(sources[0].buffer).not.toBe(sources[1].buffer)
    expect(document.getElementById('library-message')?.textContent).toMatch(/A: Grand · Salamander C5 .* B: Electric · Wurlitzer EP200/)
    const ctx = mounted.world.ctx
    mounted.unmount()
    mounted = null
    expect(engine.activeVoices()).toEqual([])
    expect(ctx.liveNodes()).toEqual([])
    expect(engine.metrics().liveNodes).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { VoiceState } from '../src/audio/dsp/kernel'
import { createInitialState, deriveSound } from '../src/state/model'
import { defaultSoundState } from '../src/audio/dsp/params'
import { mountApp } from './support/app'
import { down, kernelOf, keys, led, oled, press, render, start, step, up, value } from './support/panel'
import { magnitudeAt, mono, peak, rms, rmsAt } from './support/signal'
import { change, difference, makeStage, renderStage, selectType } from './support/stage'

/**
 * Feature: piano.layers
 * Two-layer enable/focus/level/octave with correct voice ownership and cleanup.
 */

const C4 = 261.6256

describe('piano.layers: start-up', () => {
  it('starts with Layer A on and focused, Layer B off, and the panel showing exactly that', () => {
    const app = mountApp()
    expect(app.control('piano-layer-a')).toHaveAttribute('aria-pressed', 'true')
    expect(app.control('piano-layer-b')).toHaveAttribute('aria-pressed', 'false')
    expect(led(app, 'piano-layer-a')).toBe('on')
    expect(led(app, 'piano-layer-b')).toBe('off')
    expect(value(app, 'piano-layer-a-level')).toBe(100)
    expect(value(app, 'piano-layer-b-level')).toBe(42)
    expect(oled(app, 'layers')).toBe('PIANO A:GRAND<  B:OFF')
    expect(led(app, 'piano-fx-focus')).toBe('on')
  })

  it('the kernel starts in the state the panel shows', () => {
    const derived = deriveSound(createInitialState())
    const builtIn = defaultSoundState()
    expect(JSON.parse(JSON.stringify(derived, (_, v) => (typeof v === 'number' ? Number(v.toFixed(9)) : v)))).toEqual(
      JSON.parse(JSON.stringify(builtIn, (_, v) => (typeof v === 'number' ? Number(v.toFixed(9)) : v))),
    )
  })
})

describe('piano.layers: voice ownership', () => {
  it('one key strikes one voice per enabled layer, each owned by its layer', async () => {
    const kernel = await makeStage()
    kernel.noteOn(60, 0.8)
    expect(kernel.describeVoices().map((voice) => voice.layer)).toEqual([0])

    change(kernel, (sound) => {
      sound.layers[1].on = true
      selectType(sound.layers[1], 'Electric')
    })
    kernel.noteOn(64, 0.8)
    const voices = kernel.describeVoices()
    expect(voices.map((voice) => [voice.layer, voice.key])).toEqual([
      [0, 60],
      [0, 64],
      [1, 64],
    ])
    expect(kernel.layerVoiceCount(0)).toBe(2)
    expect(kernel.layerVoiceCount(1)).toBe(1)
    // One note-off releases that key in both layers and nothing else.
    kernel.noteOff(64)
    expect(kernel.describeVoices().map((voice) => [voice.layer, voice.key, voice.state])).toEqual([
      [0, 60, VoiceState.Held],
      [0, 64, VoiceState.Released],
      [1, 64, VoiceState.Released],
    ])
  })

  it('two layers together sound different from either alone, and each layer adds its own signal', async () => {
    const play = async (a: boolean, b: boolean) => {
      const kernel = await makeStage((sound) => {
        sound.layers[0].on = a
        sound.layers[1].on = b
        sound.layers[1].level = 1
        selectType(sound.layers[1], 'Misc')
      })
      kernel.noteOn(60, 0.8)
      return mono(renderStage(kernel, 0.5))
    }
    const onlyA = await play(true, false)
    const onlyB = await play(false, true)
    const both = await play(true, true)
    expect(rms(onlyA)).toBeGreaterThan(0.01)
    expect(rms(onlyB)).toBeGreaterThan(0.01)
    expect(difference(onlyA, onlyB)).toBeGreaterThan(0.5)
    // Below the limiter the mix is the sum of the two layer buses.
    const sum = onlyA.map((sample, index) => sample + onlyB[index])
    expect(peak(sum)).toBeLessThan(0.5)
    expect(difference(both, sum)).toBeLessThan(1e-3)
    // No layer on: silence, and no voices.
    const none = await play(false, false)
    expect(peak(none)).toBe(0)
  })

  it('switching a layer off releases its own voices and leaves the other layer ringing', async () => {
    const kernel = await makeStage((sound) => {
      sound.layers[1].on = true
      selectType(sound.layers[1], 'Upright')
    })
    kernel.noteOn(60, 0.8)
    kernel.noteOn(67, 0.8)
    renderStage(kernel, 0.1)
    expect(kernel.layerVoiceCount(0)).toBe(2)
    expect(kernel.layerVoiceCount(1)).toBe(2)

    change(kernel, (sound) => void (sound.layers[1].on = false))
    expect(kernel.describeVoices().filter((voice) => voice.layer === 1).every((voice) => voice.state === VoiceState.Released)).toBe(true)
    expect(kernel.describeVoices().filter((voice) => voice.layer === 0).every((voice) => voice.state === VoiceState.Held)).toBe(true)
    renderStage(kernel, 1.5)
    expect(kernel.layerVoiceCount(1)).toBe(0)
    expect(kernel.layerVoiceCount(0)).toBe(2)
    // A new key now strikes only Layer A.
    kernel.noteOn(72, 0.8)
    expect(kernel.describeVoices().filter((voice) => voice.key === 72).map((voice) => voice.layer)).toEqual([0])
  })

  it('the sustain pedal holds each layer\'s own voices; all-notes-off clears both', async () => {
    const kernel = await makeStage((sound) => void (sound.layers[1].on = true))
    kernel.setSustain(true)
    kernel.noteOn(60, 0.8)
    kernel.noteOff(60)
    expect(kernel.describeVoices().map((voice) => [voice.layer, voice.state])).toEqual([
      [0, VoiceState.Sustained],
      [1, VoiceState.Sustained],
    ])
    kernel.allNotesOff()
    renderStage(kernel, 0.5)
    expect(kernel.voiceCount).toBe(0)
    expect(kernel.resonanceCount).toBe(0)
    expect(peak(renderStage(kernel, 0.1).left)).toBe(0)
  })

  it('each layer has its own polyphony and steals only from itself', async () => {
    const kernel = await makeStage((sound) => void (sound.layers[1].on = true))
    for (let note = 28; note <= 100; note += 1) kernel.noteOn(note, 0.5)
    expect(kernel.layerVoiceCount(0)).toBeGreaterThanOrEqual(48)
    expect(kernel.soundingCount()).toBe(96)
    const sounding = kernel.describeVoices().filter((voice) => voice.state === VoiceState.Held)
    expect(sounding.filter((voice) => voice.layer === 0)).toHaveLength(48)
    expect(sounding.filter((voice) => voice.layer === 1)).toHaveLength(48)
    // The survivors are the most recent strikes in each layer.
    expect(Math.min(...sounding.map((voice) => voice.key))).toBe(100 - 47)
    kernel.allNotesOff()
    renderStage(kernel, 0.6)
    expect(kernel.voiceCount).toBe(0)
  })
})

describe('piano.layers: level and octave', () => {
  it('each fader sets its own layer\'s level and nothing else', async () => {
    const level = async (a: number, b: number) => {
      const kernel = await makeStage((sound) => {
        sound.layers[1].on = true
        selectType(sound.layers[1], 'Misc')
        sound.layers[0].level = a
        sound.layers[1].level = b
      })
      kernel.noteOn(60, 0.6)
      return mono(renderStage(kernel, 0.4))
    }
    const full = await level(1, 0)
    const half = await level(0.5, 0)
    const off = await level(0, 0)
    expect(rms(full)).toBeGreaterThan(rms(half) * 3)
    expect(rms(half)).toBeGreaterThan(0.002)
    expect(peak(off)).toBe(0)
    // Layer B's fader brings in Layer B without changing Layer A's part.
    const withB = await level(1, 1)
    const onlyB = await level(0, 1)
    const sum = full.map((sample, index) => sample + onlyB[index])
    expect(difference(withB, sum)).toBeLessThan(1e-3)
  })

  it('a moving fader does not click', async () => {
    const kernel = await makeStage((sound) => selectType(sound.layers[0], 'Misc'))
    kernel.noteOn(48, 0.7)
    renderStage(kernel, 0.3)
    const steady = renderStage(kernel, 0.05).left
    const steadyStep = Math.max(...steady.map((sample, index) => (index ? Math.abs(sample - steady[index - 1]) : 0)))
    change(kernel, (sound) => void (sound.layers[0].level = 0))
    const moving = renderStage(kernel, 0.05).left
    const movingStep = Math.max(...moving.map((sample, index) => (index ? Math.abs(sample - moving[index - 1]) : 0)))
    expect(movingStep).toBeLessThan(steadyStep * 1.5 + 1e-3)
    expect(peak(renderStage(kernel, 0.05).left)).toBe(0)
  })

  it('octave shift moves one layer by exactly an octave and leaves the other where it was', async () => {
    const play = async (octaveA: number, octaveB: number) => {
      const kernel = await makeStage((sound) => {
        for (const layer of sound.layers) {
          layer.on = true
          layer.level = 1
          selectType(layer, 'Misc')
        }
        sound.layers[0].octave = octaveA
        sound.layers[1].octave = octaveB
      })
      kernel.noteOn(60, 0.7)
      return { kernel, out: mono(renderStage(kernel, 0.5)) }
    }
    const flat = await play(0, 0)
    expect(magnitudeAt(flat.out, C4)).toBeGreaterThan(magnitudeAt(flat.out, C4 * 2) * 10)

    const up1 = await play(0, 1)
    expect(up1.kernel.describeVoices().map((voice) => [voice.layer, voice.key, voice.note])).toEqual([
      [0, 60, 60],
      [1, 60, 72],
    ])
    expect(magnitudeAt(up1.out, C4 * 2)).toBeGreaterThan(magnitudeAt(flat.out, C4 * 2) * 5)
    expect(magnitudeAt(up1.out, C4)).toBeGreaterThan(magnitudeAt(flat.out, C4) * 0.3)

    const down1 = await play(-1, 0)
    expect(magnitudeAt(down1.out, C4 / 2)).toBeGreaterThan(magnitudeAt(flat.out, C4 / 2) * 20)
    // The key still releases the shifted voice.
    down1.kernel.noteOff(60)
    renderStage(down1.kernel, 1.5)
    expect(down1.kernel.voiceCount).toBe(0)
  })

  it('recorded pianos shift by octave by playing the other recording, not by pitching the same one', async () => {
    const kernel = await makeStage((sound) => void (sound.layers[0].octave = 1))
    kernel.noteOn(60, 0.8)
    const out = mono(renderStage(kernel, 0.4))
    expect(kernel.describeVoices()[0]).toMatchObject({ key: 60, note: 72, sampled: true })
    expect(magnitudeAt(out, C4 * 2)).toBeGreaterThan(magnitudeAt(out, C4) * 5)
  })
})

describe('piano.layers: the panel', () => {
  it('layer buttons: off → on and focused; on → focused; focused → off; the last layer stays on', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'piano-layer-b')
    await app.settle()
    expect(app.control('piano-layer-b')).toHaveAttribute('aria-pressed', 'true')
    // Both on: the focused layer's LED blinks (manual p. 23).
    expect(led(app, 'piano-layer-b')).toBe('blink')
    expect(led(app, 'piano-layer-a')).toBe('on')
    expect(oled(app, 'layers')).toBe('PIANO A:GRAND  B:GRAND<')
    expect(kernelOf(app).getState().layers.map((layer) => layer.on)).toEqual([true, true])

    press(app, 'piano-layer-a')
    expect(led(app, 'piano-layer-a')).toBe('blink')
    expect(led(app, 'piano-layer-b')).toBe('on')
    expect(kernelOf(app).getState().layers.map((layer) => layer.on)).toEqual([true, true])

    press(app, 'piano-layer-a')
    expect(app.control('piano-layer-a')).toHaveAttribute('aria-pressed', 'false')
    expect(led(app, 'piano-layer-a')).toBe('off')
    expect(led(app, 'piano-layer-b')).toBe('on')
    expect(kernelOf(app).getState().layers.map((layer) => layer.on)).toEqual([false, true])

    press(app, 'piano-layer-b')
    expect(app.control('piano-layer-b')).toHaveAttribute('aria-pressed', 'true')
    expect(oled(app, 'notice')).toMatch(/ONLY LAYER ON/)
    expect(kernelOf(app).getState().layers.map((layer) => layer.on)).toEqual([false, true])
  })

  it('the Piano controls edit the focused layer only, and the panel follows the focus', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'piano-layer-b')
    press(app, 'piano-type')
    press(app, 'piano-type')
    press(app, 'piano-unison')
    await app.settle()
    expect(step(app, 'piano-type')).toBe('Electric')
    expect(step(app, 'piano-unison')).toBe('1')
    expect(oled(app, 'layers')).toBe('PIANO A:GRAND  B:ELECTRIC<')
    const state = kernelOf(app).getState()
    expect(state.layers[0].source).toEqual({ kind: 'samples', set: 'grand' })
    expect(state.layers[1].source).toEqual({ kind: 'samples', set: 'electric' })
    expect(state.layers.map((layer) => layer.unison)).toEqual([0, 1])

    // Back to Layer A: the panel shows A's settings again.
    press(app, 'piano-layer-a')
    expect(step(app, 'piano-type')).toBe('Grand')
    expect(step(app, 'piano-unison')).toBe('Off')
    expect(oled(app, 'model')).toBe('Salamander Grand')
    press(app, 'piano-layer-b')
    expect(step(app, 'piano-type')).toBe('Electric')
    expect(oled(app, 'model')).toBe('EP200 Reed Piano')
  })

  it('playing with both layers on really sounds both, and the faders mix them', async () => {
    const app = mountApp()
    await start(app)
    down(app, 60)
    const single = mono(render(app, 0.3))
    up(app, 60)
    render(app, 1.5)

    press(app, 'piano-layer-b')
    press(app, 'piano-type')
    press(app, 'piano-type')
    await app.settle()
    keys(app, 'piano-layer-b-level', 'End')
    expect(value(app, 'piano-layer-b-level')).toBe(100)
    down(app, 60)
    const layered = mono(render(app, 0.3))
    expect(kernelOf(app).describeVoices().map((voice) => voice.layer)).toEqual([0, 1])
    expect(difference(single, layered)).toBeGreaterThan(0.1)

    keys(app, 'piano-layer-a-level', 'Home')
    render(app, 0.1)
    const onlyB = mono(render(app, 0.2))
    keys(app, 'piano-layer-b-level', 'Home')
    render(app, 0.1)
    expect(peak(render(app, 0.1).left)).toBe(0)
    expect(rms(onlyB)).toBeGreaterThan(0.003)
    up(app, 60)
    render(app, 1.5)
    expect(kernelOf(app).voiceCount).toBe(0)
  })

  it('the Octave Shift buttons move the focused layer one octave either way and stop there', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'piano-octave-up')
    press(app, 'piano-octave-up')
    expect(kernelOf(app).getState().layers[0].octave).toBe(1)
    expect(oled(app, 'notice')).toBe('> LAYER A OCTAVE +1')
    down(app, 60)
    render(app, 0.1)
    expect(kernelOf(app).describeVoices()[0]).toMatchObject({ key: 60, note: 72 })
    up(app, 60)
    press(app, 'piano-octave-down')
    press(app, 'piano-octave-down')
    press(app, 'piano-octave-down')
    expect(kernelOf(app).getState().layers[0].octave).toBe(-1)
    expect(kernelOf(app).getState().layers[1].octave).toBe(0)
  })

  it('the Piano On button silences the whole section and brings it back', async () => {
    const app = mountApp()
    await start(app)
    down(app, 60)
    expect(rmsAt(mono(render(app, 0.2)), 0, 0.2)).toBeGreaterThan(0.003)
    press(app, 'piano-on')
    expect(app.control('piano-on')).toHaveAttribute('aria-pressed', 'false')
    expect(oled(app, 'layers')).toBe('PIANO A:OFF<  B:OFF')
    render(app, 1.5)
    expect(kernelOf(app).voiceCount).toBe(0)
    up(app, 60)
    down(app, 64)
    expect(peak(render(app, 0.2).left)).toBe(0)
    expect(kernelOf(app).voiceCount).toBe(0)
    up(app, 64)
    press(app, 'piano-on')
    down(app, 64)
    expect(rms(render(app, 0.2).left)).toBeGreaterThan(0.003)
  })
})

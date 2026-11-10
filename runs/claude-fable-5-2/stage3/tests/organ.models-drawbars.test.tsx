import { fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { B3_OFFSETS, drawbarGain } from '../src/audio/dsp/organ'
import { OrganModel, VibType } from '../src/audio/dsp/params'
import { ORGAN_MODELS } from '../src/organ/catalog'
import { mountApp } from './support/app'
import { bandLevel, db } from './support/fxbench'
import { kernelOf, led, oled, press, start, step } from './support/panel'
import { harmonics, loudestOf, makeRig, noteHz, organKernel, renderKernel, retune, slice } from './support/rig'
import { brightness, magnitudeAt, mono, rms } from './support/signal'
import { difference } from './support/stage'

/**
 * Feature: organ.models-drawbars
 * B3/Vox/Farf/Pipe spectral distinctions; drawbars/registers with LED state; percussion, key
 * click, vibrato/chorus.
 *
 * Everything here is measured on rendered audio from the real kernel.
 */

const NOTE = 60
const F0 = noteHz(NOTE)
const only = (bar: number, value = 8) => Array.from({ length: 9 }, (_, index) => (index === bar ? value : 0))

function play(model: number, drawbars: number[], seconds = 0.6, extra?: Parameters<typeof organKernel>[0]) {
  const kernel = organKernel((layer, sound) => {
    layer.model = model
    layer.drawbars = drawbars
    extra?.(layer, sound)
  })
  kernel.noteOn(NOTE, 0.8)
  return mono(renderKernel(kernel, seconds))
}

describe('organ.models-drawbars: the B3 drawbars are nine harmonic partials', () => {
  it('each drawbar sounds its own footage: 16, 5 1/3, 8, 4, 2 2/3, 2, 1 3/5, 1 1/3, 1', () => {
    const footages = B3_OFFSETS.map((semis) => noteHz(NOTE + semis))
    B3_OFFSETS.forEach((_, bar) => {
      const out = slice(play(OrganModel.B3, only(bar)), 0.1, 0.6)
      expect(rms(out), `drawbar ${bar + 1}`).toBeGreaterThan(0.005)
      expect(loudestOf(out, footages), `drawbar ${bar + 1}`).toBeCloseTo(footages[bar], 3)
    })
  })

  it('a pushed-in drawbar is silent and each step out is about 3 dB', () => {
    // (Measured after the key click, which sounds at its fixed level whatever the drawbars do.)
    expect(rms(slice(play(OrganModel.B3, only(2, 0)), 0.05, 0.6))).toBeLessThan(1e-4)
    const levels = [2, 4, 6, 8].map((value) => magnitudeAt(slice(play(OrganModel.B3, only(2, value)), 0.1, 0.6), F0))
    for (let i = 1; i < levels.length; i += 1) {
      expect(db(levels[i] / levels[i - 1])).toBeGreaterThan(4.5)
      expect(db(levels[i] / levels[i - 1])).toBeLessThan(7.5)
    }
    expect(drawbarGain('hammond', 8)).toBe(1)
    expect(drawbarGain('hammond', 0)).toBe(0)
  })

  it('a tonewheel is nearly a sine, and the full registration is the sum of its drawbars', () => {
    const [h1, h2, h3] = harmonics(slice(play(OrganModel.B3, only(2)), 0.1, 0.6), F0, 3)
    expect(h2 / h1).toBeLessThan(0.05)
    expect(h3 / h1).toBeLessThan(0.05)
    const full = slice(play(OrganModel.B3, [8, 8, 8, 8, 8, 8, 8, 8, 8]), 0.1, 0.6)
    for (const semis of B3_OFFSETS) expect(magnitudeAt(full, noteHz(NOTE + semis)), `${semis}`).toBeGreaterThan(0.01)
  })

  it('moving a drawbar while a key is held changes the spectrum at once, without a new key press', () => {
    const kernel = organKernel((layer) => {
      layer.drawbars = only(2)
    })
    kernel.noteOn(NOTE, 0.8)
    const before = slice(mono(renderKernel(kernel, 0.3)), 0.1, 0.3)
    retune(kernel, (sound) => {
      sound.organ.layers[0].drawbars = [0, 0, 8, 8, 0, 0, 0, 0, 0]
    })
    const after = slice(mono(renderKernel(kernel, 0.3)), 0.1, 0.3)
    expect(magnitudeAt(before, 2 * F0)).toBeLessThan(0.002)
    expect(magnitudeAt(after, 2 * F0)).toBeGreaterThan(0.02)
    expect(kernel.organLayer(0).keyCount).toBe(1)
  })

  it('high notes fold back: the 1 foot drawbar on the top C does not run past the last tonewheel', () => {
    const kernel = organKernel((layer) => {
      layer.drawbars = only(8)
    })
    kernel.noteOn(96, 0.8)
    const out = slice(mono(renderKernel(kernel, 0.3)), 0.1, 0.3)
    // 96 + 36 = 132 is above wheel 91 (note 114): it folds down by octaves to note 108.
    expect(loudestOf(out, [noteHz(132), noteHz(120), noteHz(108), noteHz(96)])).toBeCloseTo(noteHz(108), 3)
  })
})

describe('organ.models-drawbars: four engines, not one oscillator renamed', () => {
  const FULL = [8, 8, 8, 8, 8, 8, 8, 8, 8]
  const MODELS = [OrganModel.B3, OrganModel.Vox, OrganModel.Farf, OrganModel.Pipe1]

  it('B3, Vox, Farf, and Pipe 1 render differently from one another on the same keys and drawbars', () => {
    const renders = MODELS.map((model) => slice(play(model, FULL), 0.15, 0.6))
    for (const out of renders) expect(rms(out)).toBeGreaterThan(0.01)
    for (let a = 0; a < renders.length; a += 1) {
      for (let b = a + 1; b < renders.length; b += 1) {
        expect(difference(renders[a], renders[b]), `${a} vs ${b}`).toBeGreaterThan(0.5)
      }
    }
  })

  it('their harmonic content differs: sine wheels, a reed wave, a buzzy divider, flute pipes', () => {
    // One 8 foot stop on each, read at the fundamental's harmonics.
    const b3 = harmonics(slice(play(OrganModel.B3, only(2)), 0.15, 0.6), F0, 6)
    const vox = harmonics(slice(play(OrganModel.Vox, [0, 8, 0, 0, 0, 0, 0, 0, 8]), 0.15, 0.6), F0, 6)
    const farf = harmonics(slice(play(OrganModel.Farf, only(5)), 0.15, 0.6), F0, 6)
    const pipe = harmonics(slice(play(OrganModel.Pipe1, only(1)), 0.15, 0.6), F0, 6)
    // B3: almost nothing above the fundamental.
    expect(b3[1] / b3[0]).toBeLessThan(0.05)
    // Vox reed: a full harmonic series, each harmonic about 1/n.
    expect(vox[1] / vox[0]).toBeGreaterThan(0.35)
    expect(vox[2] / vox[0]).toBeGreaterThan(0.2)
    // Farf "Strings 8" is high-passed: the upper harmonics outweigh the fundamental.
    expect(farf[3] + farf[4] + farf[5]).toBeGreaterThan(farf[0])
    // Pipe flute: odd harmonics stand over even ones.
    expect(pipe[2]).toBeGreaterThan(pipe[1] * 1.5)
    expect(pipe[1] / pipe[0]).toBeLessThan(0.2)
  })

  it('pipes speak slowly; tonewheels are on at once', () => {
    const b3 = play(OrganModel.B3, only(2), 0.3)
    const pipe = play(OrganModel.Pipe1, only(1), 0.3)
    const early = (out: Float32Array) => rms(slice(out, 0.004, 0.012)) / rms(slice(out, 0.2, 0.3))
    expect(early(b3)).toBeGreaterThan(0.8)
    expect(early(pipe)).toBeLessThan(0.45)
  })

  it('Vox: the last two drawbars mix the dark flute signal and the bright reed signal', () => {
    const flute = slice(play(OrganModel.Vox, [0, 8, 0, 0, 0, 0, 0, 8, 0]), 0.15, 0.6)
    const reed = slice(play(OrganModel.Vox, [0, 8, 0, 0, 0, 0, 0, 0, 8]), 0.15, 0.6)
    const neither = play(OrganModel.Vox, [0, 8, 0, 0, 0, 0, 0, 0, 0])
    expect(rms(neither)).toBeLessThan(1e-4)
    expect(brightness(reed)).toBeGreaterThan(brightness(flute) * 4)
    expect(bandLevel(reed, 3000, 8000)).toBeGreaterThan(bandLevel(flute, 3000, 8000) * 5)
    // The mixture drawbars add more than one pitch each.
    const mixture = slice(play(OrganModel.Vox, [0, 0, 0, 0, 8, 0, 0, 8, 0]), 0.15, 0.6)
    expect(magnitudeAt(mixture, noteHz(NOTE + 7))).toBeGreaterThan(0.01)
    expect(magnitudeAt(mixture, noteHz(NOTE + 28))).toBeGreaterThan(0.01)
  })

  it('Farf: the drawbars are on/off tabs — past half is on, and further out is no louder', () => {
    const level = (value: number) => rms(slice(play(OrganModel.Farf, only(2, value)), 0.15, 0.6))
    expect(level(0)).toBeLessThan(1e-4)
    expect(level(4)).toBeLessThan(1e-4)
    expect(level(5)).toBeGreaterThan(0.01)
    expect(level(8)).toBeCloseTo(level(5), 6)
    // Each tab has its own voicing: a flute and a string tab at the same footage are not the same sound.
    const fluteTab = slice(play(OrganModel.Farf, only(2)), 0.15, 0.6)
    const stringTab = slice(play(OrganModel.Farf, only(5)), 0.15, 0.6)
    expect(brightness(stringTab)).toBeGreaterThan(brightness(fluteTab) * 5)
  })

  it('B3 Bass and Pipe 2 reuse engines, as the spec allows, and are labelled as doing so', () => {
    // B3 Bass: only the 16 and 8 foot drawbars do anything.
    expect(rms(slice(play(OrganModel.B3Bass, [8, 8, 0, 0, 0, 0, 0, 0, 0]), 0.15, 0.6))).toBeGreaterThan(0.01)
    expect(rms(slice(play(OrganModel.B3Bass, [0, 0, 8, 8, 8, 8, 8, 8, 8]), 0.05, 0.6))).toBeLessThan(1e-4)
    // Pipe 2 is brighter than Pipe 1 on the same stop.
    const pipe1 = slice(play(OrganModel.Pipe1, only(1)), 0.15, 0.6)
    const pipe2 = slice(play(OrganModel.Pipe2, only(1)), 0.15, 0.6)
    expect(brightness(pipe2)).toBeGreaterThan(brightness(pipe1) * 2)
    expect(ORGAN_MODELS.find((model) => model.name === 'B3 Bass')?.about).toMatch(/B3 engine/)
    expect(ORGAN_MODELS.find((model) => model.name === 'Pipe 2')?.about).toMatch(/Pipe 1 engine/)
    for (const model of ORGAN_MODELS) expect(model.about).toMatch(/^Synthesized/)
  })
})

describe('organ.models-drawbars: B3 percussion and key click', () => {
  const third = noteHz(NOTE + 19)
  const second = noteHz(NOTE + 12)
  const percussive = (perc: Partial<{ on: boolean; soft: boolean; fast: boolean; third: boolean }>, seconds = 1) =>
    play(OrganModel.B3, only(0), seconds, (layer) => {
      layer.perc = { on: true, soft: false, fast: true, third: true, ...perc }
    })

  it('percussion adds a decaying partial on the attack', () => {
    const off = percussive({ on: false })
    const on = percussive({})
    expect(magnitudeAt(slice(off, 0.01, 0.1), third)).toBeLessThan(0.002)
    const early = magnitudeAt(slice(on, 0.01, 0.1), third)
    const late = magnitudeAt(slice(on, 0.6, 0.9), third)
    expect(early).toBeGreaterThan(0.01)
    expect(late).toBeLessThan(early * 0.05)
  })

  it('Decay Fast, Volume Soft, and Harmonic Third each change it measurably', () => {
    const at = (out: Float32Array, hz: number, from: number, to: number) => magnitudeAt(slice(out, from, to), hz)
    // Slow decay still rings where fast decay has gone.
    expect(at(percussive({ fast: false }), third, 0.3, 0.5)).toBeGreaterThan(at(percussive({ fast: true }), third, 0.3, 0.5) * 4)
    // Soft is quieter than normal.
    const normal = at(percussive({}), third, 0.01, 0.1)
    const soft = at(percussive({ soft: true }), third, 0.01, 0.1)
    expect(db(normal / soft)).toBeGreaterThan(4)
    // Third off moves the percussion to the second harmonic.
    const onSecond = percussive({ third: false })
    expect(at(onSecond, second, 0.01, 0.1)).toBeGreaterThan(0.01)
    expect(at(onSecond, third, 0.01, 0.1)).toBeLessThan(0.002)
  })

  it('is single-triggered: a note played legato gets none, a note after all keys are up gets it again', () => {
    const kernel = organKernel((layer) => {
      layer.drawbars = only(0)
      layer.perc = { on: true, soft: false, fast: true, third: true }
    })
    const hit = (note: number) => {
      kernel.noteOn(note, 0.8)
      return magnitudeAt(slice(mono(renderKernel(kernel, 0.6)), 0.01, 0.1), noteHz(note + 19))
    }
    expect(hit(60)).toBeGreaterThan(0.01)
    // 60 is still held and the envelope has died away: 64 joins without percussion.
    expect(hit(64)).toBeLessThan(0.002)
    kernel.noteOff(60)
    kernel.noteOff(64)
    renderKernel(kernel, 0.1)
    expect(hit(67)).toBeGreaterThan(0.01)
  })

  it('key click is a short broadband transient at a fixed level on the attack, and only the B3 has it', () => {
    const high = (out: Float32Array, from: number, to: number) => bandLevel(slice(out, from, to), 4000, 12000)
    const b3 = play(OrganModel.B3, only(0), 0.4)
    const vox = play(OrganModel.Vox, [8, 0, 0, 0, 0, 0, 0, 8, 0], 0.4)
    expect(high(b3, 0, 0.006)).toBeGreaterThan(high(b3, 0.2, 0.3) * 20)
    expect(high(b3, 0, 0.006)).toBeGreaterThan(high(vox, 0, 0.006) * 5)
    // Fixed level: the click is the same whatever the drawbar setting.
    const loud = play(OrganModel.B3, [8, 0, 0, 0, 0, 0, 0, 0, 0], 0.1)
    const quiet = play(OrganModel.B3, [1, 0, 0, 0, 0, 0, 0, 0, 0], 0.1)
    expect(high(loud, 0, 0.006) / high(quiet, 0, 0.006)).toBeGreaterThan(0.7)
    expect(high(loud, 0, 0.006) / high(quiet, 0, 0.006)).toBeLessThan(1.4)
  })
})

describe('organ.models-drawbars: vibrato / chorus', () => {
  const withVib = (vibType: number | null, seconds = 1.2, bar = 2) =>
    play(OrganModel.B3, only(bar), seconds, (layer, sound) => {
      layer.vibOn = vibType !== null
      if (vibType !== null) sound.organ.vibType = vibType
    })
  /** Level of the 6.9 Hz sidebands relative to the carrier: how deep the pitch modulation is. */
  const sideband = (out: Float32Array) => {
    const steady = slice(out, 0.2, 1.2)
    return (magnitudeAt(steady, F0 + 6.9) + magnitudeAt(steady, F0 - 6.9)) / magnitudeAt(steady, F0)
  }
  /** How much the loudness wobbles. */
  const wobble = (out: Float32Array) => {
    const windows: number[] = []
    for (let t = 0.2; t < 1.15; t += 0.02) windows.push(rms(slice(out, t, t + 0.02)))
    return (Math.max(...windows) - Math.min(...windows)) / Math.max(...windows)
  }

  it('vibrato modulates the pitch, and its depth grows from V1 to V2 to V3', () => {
    const off = sideband(withVib(null))
    const depths = [VibType.V1, VibType.V2, VibType.V3].map((type) => sideband(withVib(type)))
    // (What is left with vibrato off is only the leakage of a one-second analysis window.)
    expect(off).toBeLessThan(0.05)
    expect(depths[0]).toBeGreaterThan(off * 3)
    expect(depths[1]).toBeGreaterThan(depths[0] * 1.3)
    expect(depths[2]).toBeGreaterThan(depths[1] * 1.3)
  })

  it('chorus mixes the modulated signal with the straight one: C1 is not V1, and depth grows C1 to C3', () => {
    // Heard on the 1 foot drawbar, where the scanner's short delay is a large part of a cycle.
    const v1 = withVib(VibType.V1, 1.2, 8)
    const c1 = withVib(VibType.C1, 1.2, 8)
    expect(difference(slice(v1, 0.2, 1.2), slice(c1, 0.2, 1.2))).toBeGreaterThan(0.1)
    // Vibrato alone keeps a steady level; chorus beats against the dry signal.
    expect(wobble(v1)).toBeLessThan(0.1)
    expect(wobble(c1)).toBeGreaterThan(wobble(v1) * 2)
    // Deeper settings beat harder (read on the 4 foot drawbar, where the phase swing stays within one turn).
    expect(wobble(withVib(VibType.C3, 1.2, 3))).toBeGreaterThan(wobble(withVib(VibType.C1, 1.2, 3)) * 1.5)
  })

  it('is switched per layer: Layer A can have it while Layer B does not', () => {
    const both = (aOn: boolean, bOn: boolean) => {
      const kernel = organKernel((layer, sound) => {
        layer.drawbars = only(2)
        layer.vibOn = aOn
        sound.organ.vibType = VibType.V3
        sound.organ.layers[1] = { ...sound.organ.layers[1], on: true, level: 1, octave: 1, drawbars: only(2), vibOn: bOn }
      })
      kernel.noteOn(NOTE, 0.8)
      const out = slice(mono(renderKernel(kernel, 1.2)), 0.2, 1.2)
      const side = (hz: number) => (magnitudeAt(out, hz + 6.9) + magnitudeAt(out, hz - 6.9)) / magnitudeAt(out, hz)
      return { a: side(F0), b: side(2 * F0) }
    }
    const onlyA = both(true, false)
    expect(onlyA.a).toBeGreaterThan(0.1)
    expect(onlyA.b).toBeLessThan(0.03)
    const onlyB = both(false, true)
    expect(onlyB.a).toBeLessThan(0.03)
    expect(onlyB.b).toBeGreaterThan(0.1)
  })

  it('on the pipe models the selector detunes instead: slow beating, not a 7 Hz vibrato', () => {
    const pipe = (vibType: number | null) =>
      play(OrganModel.Pipe1, only(1), 2.4, (layer, sound) => {
        layer.vibOn = vibType !== null
        if (vibType !== null) sound.organ.vibType = vibType
      })
    const straight = pipe(null)
    const detuned = pipe(VibType.C2)
    const steady = (out: Float32Array) => slice(out, 0.4, 2.4)
    expect(difference(steady(straight), steady(detuned))).toBeGreaterThan(0.1)
    expect(magnitudeAt(steady(detuned), F0 + 0.9) / magnitudeAt(steady(detuned), F0)).toBeGreaterThan(0.05)
  })
})

describe('organ.models-drawbars: the panel', () => {
  it('a drawbar moves its LED graph, the canonical state, and the sound together', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'organ-on')
    const bar = app.control('organ-drawbar-4')
    const graph = app.container.querySelector<HTMLElement>('[data-graph-for="organ-drawbar-4"]')!
    expect(graph.querySelectorAll('.is-lit')).toHaveLength(4)
    fireEvent.keyDown(bar, { key: 'End' })
    expect(graph.querySelectorAll('.is-lit')).toHaveLength(8)
    expect(kernelOf(app).getState().organ.layers[0].drawbars[3]).toBe(8)
    expect(oled(app, 'notice')).toBe("> ORGAN A 4' 8")
    fireEvent.keyDown(bar, { key: 'Home' })
    expect(graph.querySelectorAll('.is-lit')).toHaveLength(0)
    expect(kernelOf(app).getState().organ.layers[0].drawbars[3]).toBe(0)
    expect(bar).toHaveAttribute('data-decorative', 'false')
  })

  it('the Organ Model button steps the six models and their LEDs, and the display names the model', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'organ-on')
    const slugs = ['b3', 'vox', 'farf', 'pipe1', 'pipe2', 'b3-bass']
    ORGAN_MODELS.forEach((model, index) => {
      expect(step(app, 'organ-model')).toBe(model.name)
      expect(slugs.map((slug) => led(app, `organ-model-${slug}`))).toEqual(slugs.map((_, at) => (at === index ? 'on' : 'off')))
      expect(kernelOf(app).getState().organ.layers[0].model).toBe(model.id)
      expect(oled(app, 'model')).toContain(model.name)
      expect(oled(app, 'source')).toMatch(/^SYNTHESIZED/)
      press(app, 'organ-model')
    })
    expect(step(app, 'organ-model')).toBe('B3')
  })

  it('percussion and vibrato buttons show and set the focused layer', () => {
    const rig = makeRig()
    rig.press('organ-on')
    expect(rig.step('organ-perc-on')).toBe(0)
    rig.press('organ-perc-on')
    rig.press('organ-perc-volume-soft')
    rig.press('organ-perc-decay-fast')
    rig.press('organ-perc-harmonic-third')
    expect(rig.sound().organ.layers[0].perc).toEqual({ on: true, soft: true, fast: false, third: false })
    expect([rig.led('organ-perc-on'), rig.led('organ-perc-volume-soft'), rig.led('organ-perc-decay-fast'), rig.led('organ-perc-harmonic-third')]).toEqual(['on', 'on', 'off', 'off'])
    // The selector steps V1 C1 V2 C2 V3 C3; On is per layer.
    expect(rig.sound().organ.vibType).toBe(VibType.C3)
    rig.press('organ-vibrato-type')
    expect(rig.sound().organ.vibType).toBe(VibType.V1)
    expect(rig.led('organ-vibrato-type-v1')).toBe('on')
    rig.press('organ-vibrato-on')
    expect(rig.sound().organ.layers[0].vibOn).toBe(false)
    rig.press('organ-layer-b')
    expect(rig.step('organ-vibrato-on')).toBe(1)
    expect(rig.sound().organ.layers[1].vibOn).toBe(true)
    // Layer B kept its own percussion settings.
    expect(rig.step('organ-perc-on')).toBe(0)
    rig.dispose()
  })

  it('the drawbar notice says what a drawbar is on the selected model', () => {
    const rig = makeRig()
    rig.press('organ-on')
    rig.press('organ-model')
    rig.press('organ-model')
    rig.set('organ-drawbar-3', 3)
    expect(rig.state().notice).toBe('Organ A Flute 8 Off')
    rig.set('organ-drawbar-3', 7)
    expect(rig.state().notice).toBe('Organ A Flute 8 On')
    for (let presses = 0; presses < 3; presses += 1) rig.press('organ-model')
    rig.set('organ-drawbar-5', 6)
    expect(rig.state().notice).toBe('Organ A drawbar 5: not used by B3 Bass')
    rig.dispose()
  })
})

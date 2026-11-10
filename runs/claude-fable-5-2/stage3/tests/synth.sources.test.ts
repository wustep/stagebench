import { describe, expect, it } from 'vitest'
import { SynthWave, type SynthLayerSound } from '../src/audio/dsp/params'
import { OSC_CTRL_ROLE, SYNTH_CATEGORIES, SYNTH_WAVEFORMS, waveform, wavesOf } from '../src/synth/catalog'
import { envelope } from './support/fxbench'
import { harmonics, makeRig, noteHz, renderKernel, retune, slice, synthKernel } from './support/rig'
import { brightness, equal, magnitudeAt, mono, rms } from './support/signal'
import { correlation, difference } from './support/stage'

/**
 * Feature: synth.sources
 * Three layers; required waveforms distinct per category; Osc Ctrl behaves per category.
 */

const NOTE = 57 // A3, 220 Hz
const F0 = noteHz(NOTE)

function play(configure: (layer: SynthLayerSound) => void, seconds = 0.6, note = NOTE) {
  const kernel = synthKernel((layer) => configure(layer))
  kernel.noteOn(note, 0.8)
  return renderKernel(kernel, seconds)
}
const wave = (id: number, ctrl = 0.5, seconds = 0.6) =>
  play((layer) => {
    layer.osc.wave = id
    layer.osc.ctrl = ctrl
  }, seconds)
const steady = (out: { left: Float32Array; right: Float32Array }) => slice(mono(out), 0.1, 0.6)

describe('synth.sources: the required waveform list', () => {
  it('is exactly the list in the synth spec, in five categories', () => {
    const byCategory = Object.fromEntries(SYNTH_CATEGORIES.map((category) => [category, wavesOf(category).map((item) => item.name)]))
    expect(byCategory).toEqual({
      Pure: ['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise'],
      Sync: ['Sync Saw', 'Sync Square'],
      Multi: ['Multi Saw', 'Multi Saw 8ve'],
      Super: ['Super Saw', 'Super Square'],
      'FM-H': ['FM 2-op A'],
    })
    expect(SYNTH_WAVEFORMS.map((item) => item.id)).toEqual(SYNTH_WAVEFORMS.map((_, index) => index))
    expect(Object.keys(OSC_CTRL_ROLE)).toEqual([...SYNTH_CATEGORIES])
  })

  it('every waveform sounds, and no two render alike', () => {
    const renders = SYNTH_WAVEFORMS.map((item) => steady(wave(item.id)))
    renders.forEach((out, index) => expect(rms(out), SYNTH_WAVEFORMS[index].name).toBeGreaterThan(0.02))
    for (let a = 0; a < renders.length; a += 1) {
      for (let b = a + 1; b < renders.length; b += 1) {
        expect(difference(renders[a], renders[b]), `${SYNTH_WAVEFORMS[a].name} vs ${SYNTH_WAVEFORMS[b].name}`).toBeGreaterThan(0.15)
      }
    }
  })

  it('the Pure waves have the spectra their names promise', () => {
    const spectrum = (id: number) => harmonics(steady(wave(id)), F0, 6)
    const sine = spectrum(SynthWave.Sine)
    expect(Math.max(...sine.slice(1)) / sine[0]).toBeLessThan(0.01)
    const triangle = spectrum(SynthWave.Triangle)
    expect(triangle[1] / triangle[0]).toBeLessThan(0.01)
    expect(triangle[2] / triangle[0]).toBeGreaterThan(0.08)
    expect(triangle[2] / triangle[0]).toBeLessThan(0.14)
    const saw = spectrum(SynthWave.Saw)
    expect(saw[1] / saw[0]).toBeGreaterThan(0.42)
    expect(saw[1] / saw[0]).toBeLessThan(0.58)
    expect(saw[2] / saw[0]).toBeGreaterThan(0.27)
    const square = spectrum(SynthWave.Square)
    expect(square[1] / square[0]).toBeLessThan(0.02)
    expect(square[2] / square[0]).toBeGreaterThan(0.27)
    expect(square[3] / square[0]).toBeLessThan(0.02)
    // A 33 % pulse has almost no third harmonic; a 10 % pulse has strong low harmonics throughout.
    const pulse33 = spectrum(SynthWave.Pulse33)
    expect(pulse33[2] / pulse33[0]).toBeLessThan(0.06)
    expect(pulse33[1] / pulse33[0]).toBeGreaterThan(0.4)
    const pulse10 = spectrum(SynthWave.Pulse10)
    expect(pulse10[1] / pulse10[0]).toBeGreaterThan(0.85)
    expect(pulse10[4] / pulse10[0]).toBeGreaterThan(0.5)
    // Noise has no pitch: nothing stands out at the note.
    const noise = steady(wave(SynthWave.Noise))
    expect(magnitudeAt(noise, F0)).toBeLessThan(rms(noise) * 0.15)
    expect(brightness(noise)).toBeGreaterThan(1)
  })

  it('band-limited: a high saw has no strong aliases below its fundamental', () => {
    const high = 96
    const out = steady(play((layer) => {
      layer.osc.wave = SynthWave.Saw
    }, 0.6, high))
    const fundamental = magnitudeAt(out, noteHz(high))
    for (const hz of [300, 517, 911, 1403, 1750]) expect(magnitudeAt(out, hz) / fundamental, `${hz} Hz`).toBeLessThan(0.02)
  })
})

describe('synth.sources: Osc Ctrl is a different control in every category', () => {
  it('Pure: no effect at all — the samples are identical', () => {
    for (const id of [SynthWave.Sine, SynthWave.Saw, SynthWave.Square, SynthWave.Pulse10, SynthWave.Noise]) {
      const low = wave(id, 0)
      const high = wave(id, 1)
      expect(equal(low.left, high.left), waveform(id).name).toBe(true)
    }
  })

  it('Sync: raises the pitch of the synced oscillator while the note stays put', () => {
    const levels = [0, 0.35, 0.7, 1].map((ctrl) => steady(wave(SynthWave.SyncSaw, ctrl)))
    // Brighter and brighter…
    for (let i = 1; i < levels.length; i += 1) expect(brightness(levels[i])).toBeGreaterThan(brightness(levels[i - 1]) * 1.3)
    // …but still periodic at the played note: energy sits on its harmonics, not between them.
    for (const out of levels) {
      const on = harmonics(out, F0, 8).reduce((sum, value) => sum + value, 0)
      const between = [1.5, 2.5, 3.5, 4.5].reduce((sum, ratio) => sum + magnitudeAt(out, F0 * ratio), 0)
      expect(between / on).toBeLessThan(0.05)
    }
    // At zero the slave runs at the note's own pitch: a plain saw.
    expect(difference(levels[0], steady(wave(SynthWave.Saw)))).toBeLessThan(0.05)
    // The formant follows the knob: at 0.7 the slave is 2^2.1 = 4.3 times the note.
    const formant = harmonics(levels[2], F0, 8)
    expect(formant.indexOf(Math.max(...formant)) + 1).toBeGreaterThanOrEqual(4)
    expect(difference(steady(wave(SynthWave.SyncSquare, 0.6)), levels[2])).toBeGreaterThan(0.3)
  })

  it('Multi: sets the detune between the stacked saws — steady at zero, beating when raised', () => {
    const wobble = (out: Float32Array) => {
      const env = envelope(out, 0.02)
      let min = Infinity
      let max = 0
      for (const value of env) {
        min = Math.min(min, value)
        max = Math.max(max, value)
      }
      return (max - min) / max
    }
    const together = mono(wave(SynthWave.MultiSaw, 0, 1.2))
    const apart = mono(wave(SynthWave.MultiSaw, 0.8, 1.2))
    expect(wobble(slice(together, 0.1, 1.2))).toBeLessThan(0.05)
    expect(wobble(slice(apart, 0.1, 1.2))).toBeGreaterThan(0.25)
    // The stack is mono, and the 8ve variant adds an octave above.
    const stereo = wave(SynthWave.MultiSaw, 0.8)
    expect(equal(stereo.left, stereo.right)).toBe(true)
    const plain = harmonics(steady(wave(SynthWave.MultiSaw, 0)), F0, 2)
    const octave = harmonics(steady(wave(SynthWave.MultiSawOct, 0)), F0, 2)
    expect(octave[1] / octave[0]).toBeGreaterThan((plain[1] / plain[0]) * 1.4)
  })

  it('Super: spreads seven oscillators in pitch and across the stereo field', () => {
    const narrow = wave(SynthWave.SuperSaw, 0, 1)
    const wide = wave(SynthWave.SuperSaw, 1, 1)
    const width = (out: { left: Float32Array; right: Float32Array }) => 1 - correlation(slice(out.left, 0.1, 1), slice(out.right, 0.1, 1))
    expect(width(wide)).toBeGreaterThan(width(narrow) + 0.3)
    expect(equal(wide.left, wide.right)).toBe(false)
    // Detuned far enough, the fundamental is no longer one line: energy spreads around it.
    const spread = (out: { left: Float32Array; right: Float32Array }) => {
      const signal = slice(mono(out), 0.1, 1)
      return (magnitudeAt(signal, F0 * 1.05) + magnitudeAt(signal, F0 * 0.95)) / magnitudeAt(signal, F0)
    }
    expect(spread(wide)).toBeGreaterThan(spread(narrow) * 3)
    // Super Square is the same idea built from squares: no even harmonics when the stack is tight.
    const square = harmonics(slice(mono(wave(SynthWave.SuperSquare, 0, 1)), 0.1, 1), F0, 3)
    expect(square[1] / square[0]).toBeLessThan(0.1)
  })

  it('FM-H: is the modulation amount — a sine at zero, more harmonics the further it is turned', () => {
    const levels = [0, 0.25, 0.5, 1].map((ctrl) => steady(wave(SynthWave.Fm2Op, ctrl)))
    const pure = harmonics(levels[0], F0, 4)
    expect(Math.max(...pure.slice(1)) / pure[0]).toBeLessThan(0.01)
    for (let i = 1; i < levels.length; i += 1) expect(brightness(levels[i])).toBeGreaterThan(brightness(levels[i - 1]) * 1.5)
    // Harmonic FM at 1:1: the sidebands land exactly on the harmonics.
    const rich = levels[2]
    const on = harmonics(rich, F0, 8).reduce((sum, value) => sum + value, 0)
    expect((magnitudeAt(rich, F0 * 1.5) + magnitudeAt(rich, F0 * 2.5)) / on).toBeLessThan(0.02)
  })

  it('the five categories are five behaviours: the same knob position gives five different sounds', () => {
    const ids = [SynthWave.Saw, SynthWave.SyncSaw, SynthWave.MultiSaw, SynthWave.SuperSaw, SynthWave.Fm2Op]
    expect(ids.map((id) => waveform(id).category)).toEqual([...SYNTH_CATEGORIES])
    const renders = ids.map((id) => steady(wave(id, 0.6)))
    for (let a = 0; a < renders.length; a += 1) {
      for (let b = a + 1; b < renders.length; b += 1) expect(difference(renders[a], renders[b])).toBeGreaterThan(0.4)
    }
    // And turning the knob moves four of them and leaves Pure alone.
    const moved = ids.map((id) => difference(steady(wave(id, 0.1)), steady(wave(id, 0.9))))
    expect(moved[0]).toBe(0)
    for (const amount of moved.slice(1)) expect(amount).toBeGreaterThan(0.3)
  })

  it('Osc Ctrl can be moved by the oscillator envelope and by the LFO', () => {
    // Envelope: FM amount starts high and falls, so the note starts bright and ends plain.
    const swept = mono(
      play((layer) => {
        layer.osc.wave = SynthWave.Fm2Op
        layer.osc.ctrl = 0
        layer.oscEnv = { attack: 0.001, decay: 0.15, release: 0.1, sustain: false, amount: 0.8, velocity: false, toPitch: false }
      }, 1),
    )
    expect(brightness(slice(swept, 0.005, 0.05))).toBeGreaterThan(brightness(slice(swept, 0.7, 1)) * 5)
    // LFO to Osc Ctrl on a sync wave: the brightness goes up and down with it.
    const lfo = mono(
      play((layer) => {
        layer.osc.wave = SynthWave.SyncSaw
        layer.osc.ctrl = 0.5
        layer.lfo = { wave: 0, dest: 2, rate: 2, amount: 1 }
      }, 1),
    )
    const readings = [0.125, 0.375].map((at) => brightness(slice(lfo, at - 0.05, at + 0.05)))
    expect(Math.max(...readings) / Math.min(...readings)).toBeGreaterThan(2)
  })
})

describe('synth.sources: three independent layers', () => {
  it('each layer has its own waveform, voices, and state', () => {
    const kernel = synthKernel((layer, sound) => {
      layer.osc.wave = SynthWave.Sine
      sound.synth.layers[1] = { ...structuredClone(layer), osc: { wave: SynthWave.Square, ctrl: 0, coarse: 12, fine: 0 } }
      sound.synth.layers[2] = { ...structuredClone(layer), on: false, osc: { wave: SynthWave.Saw, ctrl: 0, coarse: 0, fine: 0 } }
    })
    kernel.noteOn(NOTE, 0.8)
    expect(kernel.synthLayer(0).voiceCount).toBe(1)
    expect(kernel.synthLayer(1).voiceCount).toBe(1)
    expect(kernel.synthLayer(2).voiceCount).toBe(0)
    const out = slice(mono(renderKernel(kernel, 0.6)), 0.1, 0.6)
    // Layer A's sine at 220 Hz, layer B's square an octave up with its third harmonic at 1320 Hz.
    expect(magnitudeAt(out, F0)).toBeGreaterThan(0.03)
    expect(magnitudeAt(out, 2 * F0)).toBeGreaterThan(0.03)
    expect(magnitudeAt(out, 6 * F0)).toBeGreaterThan(0.008)
    // Changing layer B leaves layer A's voice exactly where it was.
    retune(kernel, (sound) => {
      sound.synth.layers[1].on = false
    })
    expect(kernel.synthLayer(0).describe().map((voice) => voice.note)).toEqual([NOTE])
    const alone = slice(mono(renderKernel(kernel, 0.6)), 0.2, 0.6)
    expect(magnitudeAt(alone, 2 * F0)).toBeLessThan(0.002)
    expect(magnitudeAt(alone, F0)).toBeGreaterThan(0.03)
    kernel.noteOff(NOTE)
    renderKernel(kernel, 0.5)
    expect(kernel.voiceCount).toBe(0)
  })

  it('pitch: coarse in semitones and fine in cents move the oscillator', () => {
    const pitched = (coarse: number, fine: number) =>
      steady(play((layer) => {
        layer.osc = { wave: SynthWave.Sine, ctrl: 0, coarse, fine }
      }))
    expect(magnitudeAt(pitched(12, 0), 2 * F0)).toBeGreaterThan(0.05)
    expect(magnitudeAt(pitched(-12, 0), F0 / 2)).toBeGreaterThan(0.05)
    expect(magnitudeAt(pitched(7, 0), noteHz(NOTE + 7))).toBeGreaterThan(0.05)
    const sharp = pitched(0, 50)
    expect(magnitudeAt(sharp, noteHz(NOTE + 0.5))).toBeGreaterThan(magnitudeAt(sharp, F0) * 3)
  })

  it('the panel selects waveforms with the three dials: whole list, category, and within the category', () => {
    const rig = makeRig()
    rig.press('synth-on')
    const current = () => waveform(rig.state().synth.layers[rig.state().synth.focus].wave).name
    expect(current()).toBe('Saw')
    rig.turn('synth-osc-dial-1', 1)
    expect(current()).toBe('Square')
    rig.turn('synth-osc-dial-2', 1)
    expect(current()).toBe('Sync Saw')
    rig.turn('synth-osc-dial-3', 1)
    expect(current()).toBe('Sync Square')
    rig.turn('synth-osc-dial-3', 5)
    expect(current()).toBe('Sync Square')
    rig.turn('synth-osc-dial-2', 3)
    expect(current()).toBe('FM 2-op A')
    rig.turn('synth-osc-dial-1', -20)
    expect(current()).toBe('Sine')
    expect(rig.sound().synth.layers[0].osc.wave).toBe(SynthWave.Sine)
    expect(rig.state().notice).toBe('Synth A: Pure Sine')
    // Every one of the fourteen can be reached, and the other layers keep their own.
    const seen = new Set<string>()
    for (let i = 0; i < SYNTH_WAVEFORMS.length; i += 1) {
      seen.add(current())
      rig.turn('synth-osc-dial-1', 1)
    }
    expect(seen.size).toBe(SYNTH_WAVEFORMS.length)
    rig.press('synth-layer-b')
    expect(current()).toBe('Saw')
    rig.dispose()
  })

  it('the Osc Ctrl knob sets the canonical value and says what it does for the category', () => {
    const rig = makeRig()
    rig.press('synth-on')
    rig.set('synth-osc-ctrl', 8)
    expect(rig.sound().synth.layers[0].osc.ctrl).toBeCloseTo(0.8)
    expect(rig.state().notice).toBe('Synth A Osc Ctrl 8.0')
    expect(OSC_CTRL_ROLE.Pure).toBe('no effect')
    expect(OSC_CTRL_ROLE['FM-H']).toBe('FM amount')
    rig.dispose()
  })
})

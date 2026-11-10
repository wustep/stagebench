import { describe, expect, it } from 'vitest'
import { Chain, OrganModel, defaultSoundState } from '../src/audio/dsp/params'
import { StageKernel } from '../src/audio/dsp/stage'
import { mountApp } from './support/app'
import { db } from './support/fxbench'
import { down, kernelOf, led, oled, press, render, shiftPress, start, up } from './support/panel'
import { makeRig, noteHz, organKernel, renderKernel, retune, slice } from './support/rig'
import { SR, equal, magnitudeAt, mono, peak, rms } from './support/signal'

/**
 * Feature: organ.engine
 * Two-layer note lifecycle, levels, focus, zones, shared effect chain, cleanup.
 */

const only = (bar: number) => Array.from({ length: 9 }, (_, index) => (index === bar ? 8 : 0))

/** Organ A on the 8 foot drawbar and Organ B an octave up on its own, so the two can be told apart. */
function twoLayers() {
  return organKernel((layer, sound) => {
    layer.drawbars = only(2)
    sound.organ.layers[1] = { ...structuredClone(layer), level: 1, octave: 1 }
  })
}

describe('organ.engine: note lifecycle', () => {
  it('a key sounds while it is held and stops when it is lifted', () => {
    const kernel = organKernel((layer) => {
      layer.drawbars = only(2)
    })
    expect(peak(renderKernel(kernel, 0.1).left)).toBe(0)
    kernel.noteOn(60, 0.8)
    expect(kernel.organLayer(0).keyCount).toBe(1)
    const held = mono(renderKernel(kernel, 1))
    // An organ does not decay: the level a second in is the level at the start.
    expect(db(rms(slice(held, 0.8, 1)) / rms(slice(held, 0.05, 0.25)))).toBeGreaterThan(-0.5)
    kernel.noteOff(60)
    expect(kernel.organLayer(0).keyCount).toBe(0)
    const released = mono(renderKernel(kernel, 0.3))
    expect(rms(slice(released, 0.1, 0.3))).toBeLessThan(1e-5)
  })

  it('is not velocity sensitive, and is fully polyphonic', () => {
    const level = (velocity: number) => {
      const kernel = organKernel((layer) => {
        layer.drawbars = only(2)
      })
      kernel.noteOn(60, velocity)
      return slice(mono(renderKernel(kernel, 0.4)), 0.1, 0.4)
    }
    expect(equal(level(0.1), level(1))).toBe(true)
    const kernel = organKernel((layer) => {
      layer.drawbars = only(2)
    })
    const chord = Array.from({ length: 40 }, (_, index) => 36 + index)
    for (const note of chord) kernel.noteOn(note, 0.8)
    expect(kernel.organLayer(0).keyCount).toBe(40)
    const out = slice(mono(renderKernel(kernel, 0.4)), 0.1, 0.4)
    for (const note of [36, 50, 75]) expect(magnitudeAt(out, noteHz(note)), `${note}`).toBeGreaterThan(0.001)
    for (const note of chord) kernel.noteOff(note)
    expect(kernel.voiceCount).toBe(0)
  })

  it('repeated and overlapping notes: each key is its own contact', () => {
    const kernel = organKernel((layer) => {
      layer.drawbars = only(2)
    })
    kernel.noteOn(60, 0.8)
    kernel.noteOn(64, 0.8)
    kernel.noteOn(60, 0.8) // a second strike of a held key changes nothing
    expect(kernel.organLayer(0).heldKeys()).toEqual([60, 64])
    kernel.noteOff(60)
    expect(kernel.organLayer(0).heldKeys()).toEqual([64])
    const out = slice(mono(renderKernel(kernel, 0.3)), 0.1, 0.3)
    expect(magnitudeAt(out, noteHz(64))).toBeGreaterThan(0.02)
    expect(magnitudeAt(out, noteHz(60))).toBeLessThan(0.001)
    kernel.noteOff(64)
    kernel.noteOff(64)
    expect(kernel.organLayer(0).keyCount).toBe(0)
  })

  it('two keys that share a tonewheel share the oscillator, as on the instrument', () => {
    const kernel = organKernel((layer) => {
      layer.drawbars = [0, 0, 8, 8, 0, 0, 0, 0, 0]
    })
    kernel.noteOn(48, 0.8)
    renderKernel(kernel, 0.1)
    const one = kernel.organLayer(0).activeSlots
    // C4's 8 foot is the same wheel as C3's 4 foot: three wheels for four partials.
    kernel.noteOn(60, 0.8)
    renderKernel(kernel, 0.1)
    expect(one).toBe(2)
    expect(kernel.organLayer(0).activeSlots).toBe(3)
  })

  it('the sustain pedal holds organ keys only when the Organ has SUSTPED on', () => {
    const held = (sustain: boolean) => {
      const kernel = organKernel((layer, sound) => {
        layer.drawbars = only(2)
        sound.organ.sustain = sustain
      })
      kernel.setSustain(true)
      kernel.noteOn(60, 0.8)
      kernel.noteOff(60)
      const during = kernel.organLayer(0).keyCount
      kernel.setSustain(false)
      return [during, kernel.organLayer(0).keyCount]
    }
    expect(held(false)).toEqual([0, 0])
    expect(held(true)).toEqual([1, 0])
    const rig = makeRig()
    rig.press('organ-on')
    expect(rig.sound().organ.sustain).toBe(false)
    rig.shiftPress('organ-layer-a')
    expect(rig.sound().organ.sustain).toBe(true)
    expect(rig.led('organ-sustped')).toBe('on')
    rig.dispose()
  })

  it('the pitch stick bends the organ by up to two semitones when PSTICK is on', () => {
    const rig = makeRig()
    rig.press('piano-on')
    rig.press('organ-on')
    rig.stage.setOrganLayer(0, (layer) => {
      layer.drawbars = only(2)
      layer.vibOn = false
    })
    rig.down(57)
    rig.set('perf-pitch-stick', 100)
    expect(rig.sound().organ.bend).toBe(0)
    rig.shiftPress('organ-layer-b')
    expect(rig.led('organ-pstick')).toBe('on')
    expect(rig.sound().organ.bend).toBe(2)
    const out = slice(mono(rig.render(0.4)), 0.1, 0.4)
    expect(magnitudeAt(out, noteHz(59))).toBeGreaterThan(magnitudeAt(out, noteHz(57)) * 5)
    rig.dispose()
  })
})

describe('organ.engine: two layers', () => {
  it('both layers play the same key, each with its own model, drawbars, and octave', () => {
    const kernel = organKernel((layer, sound) => {
      layer.model = OrganModel.B3
      layer.drawbars = only(2)
      sound.organ.layers[1] = { ...structuredClone(layer), level: 1, model: OrganModel.Vox, drawbars: [0, 0, 8, 0, 0, 0, 0, 0, 8] }
    })
    kernel.noteOn(48, 0.8)
    expect([kernel.organLayer(0).keyCount, kernel.organLayer(1).keyCount]).toEqual([1, 1])
    expect([kernel.organLayer(0).modelName, kernel.organLayer(1).modelName]).toEqual([OrganModel.B3, OrganModel.Vox])
    const out = slice(mono(renderKernel(kernel, 0.4)), 0.1, 0.4)
    // B3 8 foot: the fundamental. Vox 4 foot reed: an octave up, with its own harmonics.
    expect(magnitudeAt(out, noteHz(48))).toBeGreaterThan(0.01)
    expect(magnitudeAt(out, noteHz(60))).toBeGreaterThan(0.01)
    expect(magnitudeAt(out, 3 * noteHz(60))).toBeGreaterThan(0.002)
    // Layer A alone has neither of the Vox's partials.
    retune(kernel, (sound) => {
      sound.organ.layers[1].on = false
    })
    expect(kernel.organLayer(1).keyCount).toBe(0)
    const alone = slice(mono(renderKernel(kernel, 0.4)), 0.15, 0.4)
    expect(magnitudeAt(alone, noteHz(60))).toBeLessThan(0.001)
    expect(magnitudeAt(alone, noteHz(48))).toBeGreaterThan(0.01)
  })

  it('each layer has its own level', () => {
    const kernel = twoLayers()
    kernel.noteOn(60, 0.8)
    const read = () => {
      const out = slice(mono(renderKernel(kernel, 0.4)), 0.15, 0.4)
      return [magnitudeAt(out, noteHz(60)), magnitudeAt(out, noteHz(72))]
    }
    const even = read()
    retune(kernel, (sound) => {
      sound.organ.layers[0].level = 0.5
    })
    const lower = read()
    expect(db(lower[0] / even[0])).toBeGreaterThan(-13)
    expect(db(lower[0] / even[0])).toBeLessThan(-11)
    expect(lower[1] / even[1]).toBeGreaterThan(0.97)
    // A fader move is ramped: no step in the output.
    retune(kernel, (sound) => {
      sound.organ.layers[0].level = 1
    })
    const ramp = mono(renderKernel(kernel, 0.05))
    let jump = 0
    for (let i = 1; i < ramp.length; i += 1) jump = Math.max(jump, Math.abs(ramp[i] - ramp[i - 1]))
    expect(jump).toBeLessThan(0.02)
  })

  it('layers take keyboard zones independently', () => {
    const kernel = organKernel((layer, sound) => {
      layer.drawbars = only(2)
      layer.zone = [0, 1]
      sound.organ.layers[1] = { ...structuredClone(layer), level: 1, zone: [2, 3] }
      sound.keyboard.points[1] = { on: true, note: 60, xfade: 0 }
    })
    kernel.noteOn(50, 0.8)
    expect([kernel.organLayer(0).keyCount, kernel.organLayer(1).keyCount]).toEqual([1, 0])
    kernel.noteOn(70, 0.8)
    expect([kernel.organLayer(0).keyCount, kernel.organLayer(1).keyCount]).toEqual([1, 1])
    kernel.noteOff(50)
    kernel.noteOff(70)
    expect(kernel.voiceCount).toBe(0)
  })

  it('switching one layer off releases its keys and leaves the other layer playing', () => {
    const kernel = twoLayers()
    kernel.noteOn(60, 0.8)
    retune(kernel, (sound) => {
      sound.organ.layers[0].on = false
    })
    expect([kernel.organLayer(0).keyCount, kernel.organLayer(1).keyCount]).toEqual([0, 1])
    const out = slice(mono(renderKernel(kernel, 0.4)), 0.15, 0.4)
    expect(magnitudeAt(out, noteHz(60))).toBeLessThan(0.001)
    expect(magnitudeAt(out, noteHz(72))).toBeGreaterThan(0.02)
  })

  it('focus decides which layer the panel edits and shows', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'organ-on')
    expect(oled(app, 'layers')).toBe('ORGAN A:B3<  B:OFF')
    press(app, 'organ-layer-b')
    expect(oled(app, 'layers')).toBe('ORGAN A:B3  B:B3<')
    expect([led(app, 'organ-layer-a'), led(app, 'organ-layer-b')]).toEqual(['on', 'blink'])
    press(app, 'organ-model')
    press(app, 'organ-model')
    expect(oled(app, 'layers')).toBe('ORGAN A:B3  B:FARF<')
    expect(kernelOf(app).getState().organ.layers.map((layer) => layer.model)).toEqual([OrganModel.B3, OrganModel.Farf])
    press(app, 'organ-layer-a')
    expect(oled(app, 'model')).toBe('B3 868433635')
    shiftPress(app, 'organ-layer-a')
    expect(led(app, 'organ-sustped')).toBe('on')
  })
})

describe('organ.engine: one shared effect chain', () => {
  it('both layers go through the same chain: one compressor, one reverb, one tail', () => {
    const kernel = organKernel((layer, sound) => {
      layer.drawbars = only(2)
      sound.organ.layers[1] = { ...structuredClone(layer), level: 1, octave: 1 }
      sound.organ.fx.reverb = { on: true, type: 5, tone: 0, mix: 0.6 }
    })
    kernel.noteOn(60, 0.8)
    renderKernel(kernel, 0.4)
    kernel.noteOff(60)
    const tail = slice(mono(renderKernel(kernel, 0.6)), 0.3, 0.6)
    // Both layers' pitches are in the one reverb tail.
    expect(magnitudeAt(tail, noteHz(60))).toBeGreaterThan(0.0005)
    expect(magnitudeAt(tail, noteHz(72))).toBeGreaterThan(0.0005)
    expect(kernel.busCount).toBe(6)
    expect(kernel.layerAsleep(Chain.Organ)).toBe(false)
  })

  it('the layer levels come before the shared chain, so they change what a drive stage does', () => {
    const driven = (level: number) => {
      const kernel = organKernel((layer, sound) => {
        layer.drawbars = only(2)
        layer.level = level
        sound.organ.fx.amp = { on: true, type: 0, drive: 0.9, bass: 0, mid: 0, freq: 0.5, treble: 0 }
      })
      kernel.noteOn(48, 0.8)
      kernel.noteOn(55, 0.8)
      const out = slice(mono(renderKernel(kernel, 0.5)), 0.15, 0.5)
      // Intermodulation between the two notes: a product at the difference of their frequencies.
      return magnitudeAt(out, noteHz(55) - noteHz(48)) / magnitudeAt(out, noteHz(48))
    }
    expect(driven(1)).toBeGreaterThan(driven(0.4) * 1.5)
  })

  it('the Organ has its own chain: Piano effects do not touch it and its effects do not touch the Piano', () => {
    const rig = makeRig()
    rig.press('organ-on')
    expect(rig.state().fx.focus).toBe(Chain.Organ)
    rig.press('fx-reverb-on')
    rig.press('fx-comp-on')
    const sound = rig.sound()
    expect([sound.organ.fx.reverb.on, sound.organ.fx.comp.on]).toEqual([true, true])
    expect([sound.layers[0].fx.reverb.on, sound.layers[0].fx.comp.on, sound.synth.layers[0].fx.reverb.on]).toEqual([false, false, false])
    // Focusing Organ B is the same chain as Organ A.
    rig.press('organ-layer-b')
    expect(rig.state().fx.focus).toBe(Chain.Organ)
    expect(rig.led('fx-reverb-on')).toBe('on')
    rig.dispose()
  })
})

describe('organ.engine: cleanup', () => {
  it('after the keys are up the bus goes to sleep and renders exact silence', () => {
    const kernel = organKernel((layer, sound) => {
      layer.drawbars = [8, 8, 8, 8, 8, 8, 8, 8, 8]
      layer.vibOn = true
      layer.perc = { on: true, soft: false, fast: false, third: true }
      sound.organ.fx.delay = { on: true, time: 0.1, feedback: 0.4, mix: 0.5, filter: 0, pingPong: false }
    })
    for (const note of [48, 60, 64, 67]) kernel.noteOn(note, 0.8)
    renderKernel(kernel, 0.3)
    expect(kernel.layerAsleep(Chain.Organ)).toBe(false)
    for (const note of [48, 60, 64, 67]) kernel.noteOff(note)
    renderKernel(kernel, 3)
    expect(kernel.voiceCount).toBe(0)
    expect(kernel.organLayer(0).activeSlots).toBe(0)
    expect(kernel.organLayer(0).busy).toBe(false)
    expect(kernel.layerAsleep(Chain.Organ)).toBe(true)
    expect(peak(renderKernel(kernel, 0.2).left)).toBe(0)
  })

  it('all notes off stops every organ key, pedal or not, within tens of milliseconds', () => {
    const kernel = organKernel((layer, sound) => {
      layer.drawbars = only(2)
      sound.organ.sustain = true
      sound.organ.layers[1] = { ...structuredClone(layer), level: 1 }
    })
    kernel.setSustain(true)
    for (const note of [50, 57, 62]) {
      kernel.noteOn(note, 0.8)
      kernel.noteOff(note)
    }
    expect(kernel.voiceCount).toBe(6)
    kernel.allNotesOff()
    expect(kernel.voiceCount).toBe(0)
    const out = mono(renderKernel(kernel, 0.3))
    expect(rms(out.subarray(Math.round(0.1 * SR)))).toBeLessThan(1e-5)
    // The pedal was reset too: a new note is not held.
    kernel.noteOn(60, 0.8)
    kernel.noteOff(60)
    expect(kernel.voiceCount).toBe(0)
  })

  it('a kernel that never played an organ costs nothing and stays silent', () => {
    const kernel = new StageKernel({ sampleRate: SR })
    const sound = defaultSoundState()
    sound.layers[0].on = false
    kernel.setState(sound)
    kernel.noteOn(60, 0.8)
    expect(kernel.voiceCount).toBe(0)
    expect(peak(renderKernel(kernel, 0.2).left)).toBe(0)
    expect(kernel.layerAsleep(Chain.Organ)).toBe(true)
  })

  it('in the app: organ keys are counted, released on blur, and gone after unmount', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'piano-on')
    press(app, 'organ-on')
    down(app, 60)
    down(app, 64)
    expect(kernelOf(app).organLayer(0).keyCount).toBe(2)
    expect(rms(render(app, 0.3).left)).toBeGreaterThan(0.005)
    expect(app.getByTestId('voice-count')).toHaveTextContent('Voices: 2')
    app.fake.events.emitBlur()
    expect(kernelOf(app).organLayer(0).keyCount).toBe(0)
    render(app, 1)
    expect(peak(render(app, 0.2).left)).toBe(0)
    up(app, 60)
    const kernel = kernelOf(app)
    app.unmount()
    expect(kernel.voiceCount).toBe(0)
    expect(app.fake.audio.context.closed).toBe(true)
  })
})

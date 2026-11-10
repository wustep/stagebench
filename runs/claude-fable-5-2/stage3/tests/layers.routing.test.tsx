import { describe, expect, it } from 'vitest'
import { CHAIN_COUNT, Chain, layerGain } from '../src/audio/dsp/params'
import { CHAIN_NAMES, chainOf, chainOwner, fxTargets } from '../src/state/model'
import { mountApp } from './support/app'
import { db } from './support/fxbench'
import { down, kernelOf, keys, led, oled, press, render, shiftPress, start, up } from './support/panel'
import { makeRig, noteHz, slice } from './support/rig'
import { magnitudeAt, mono, rms } from './support/signal'

/**
 * Feature: layers.routing
 * Enable/focus/level/octave/effect-target routing for every layer of every engine.
 *
 * Seven layers — Organ A B, Piano A B, Synth A B C — and six effect chains (the two Organ
 * layers share one).
 */

const LAYERS = [
  { section: 'organ', index: 0, button: 'organ-layer-a', fader: 'organ-layer-a-level', chain: Chain.Organ },
  { section: 'organ', index: 1, button: 'organ-layer-b', fader: 'organ-layer-b-level', chain: Chain.Organ },
  { section: 'piano', index: 0, button: 'piano-layer-a', fader: 'piano-layer-a-level', chain: Chain.PianoA },
  { section: 'piano', index: 1, button: 'piano-layer-b', fader: 'piano-layer-b-level', chain: Chain.PianoB },
  { section: 'synth', index: 0, button: 'synth-layer-a', fader: 'synth-layer-a-level', chain: Chain.SynthA },
  { section: 'synth', index: 1, button: 'synth-layer-b', fader: 'synth-layer-b-level', chain: Chain.SynthB },
  { section: 'synth', index: 2, button: 'synth-layer-c', fader: 'synth-layer-c-level', chain: Chain.SynthC },
] as const
type Layer = (typeof LAYERS)[number]

/** A rig where only `layer` can sound: its section on, the layer on and focused, every other layer off. */
function solo(layer: Layer) {
  const rig = makeRig()
  rig.stage.edit((state) => {
    for (const section of ['organ', 'piano', 'synth'] as const) {
      state[section].on = section === layer.section
      state[section].layers.forEach((each, index) => {
        each.on = section === layer.section && index === layer.index
        each.level = 100
      })
    }
    state[layer.section].focus = layer.index
    state.fx.focus = layer.chain
    state.ui.section = layer.section
    // Plain, steady sounds, so levels and pitches can be read.
    for (const organ of state.organ.layers) {
      organ.drawbars = [0, 0, 8, 0, 0, 0, 0, 0, 0]
      organ.vibOn = false
    }
    for (const synth of state.synth.layers) {
      synth.wave = 0
      synth.filter.on = false
      synth.voice.unison = 0
      synth.oscEnv.amount = 0
      synth.ampEnv.velocity = 0
    }
  })
  return rig
}
/** How many notes each of the seven layers is sounding. */
function census(rig: ReturnType<typeof makeRig>): number[] {
  const { kernel } = rig
  return [
    kernel.organLayer(0).keyCount,
    kernel.organLayer(1).keyCount,
    kernel.layerVoiceCount(0),
    kernel.layerVoiceCount(1),
    kernel.synthLayer(0).voiceCount,
    kernel.synthLayer(1).voiceCount,
    kernel.synthLayer(2).voiceCount,
  ].map((count) => (count > 0 ? 1 : 0))
}
const layerState = (rig: ReturnType<typeof makeRig>, layer: Layer) => (rig.state()[layer.section].layers as Array<{ on: boolean; octave: number }>)[layer.index]
const layerOn = (rig: ReturnType<typeof makeRig>, layer: Layer) => {
  const sound = rig.sound()
  return layer.section === 'piano' ? sound.layers[layer.index].on : layer.section === 'organ' ? sound.organ.layers[layer.index].on : sound.synth.layers[layer.index].on
}

describe('layers.routing: enable', () => {
  it('each of the seven layers sounds when it and its section are on, and only it', () => {
    LAYERS.forEach((layer, position) => {
      const rig = solo(layer)
      rig.down(60)
      expect(census(rig), `${layer.section} ${layer.index}`).toEqual(LAYERS.map((_, at) => (at === position ? 1 : 0)))
      expect(rms(rig.render(0.3).left)).toBeGreaterThan(0.003)
      rig.dispose()
    })
  })

  it('every layer button switches its layer on, and the section On button gates the whole section', () => {
    for (const layer of LAYERS) {
      const rig = makeRig()
      if (!rig.state()[layer.section].on) rig.press(`${layer.section}-on`)
      expect(rig.led(`${layer.section}-on`)).toBe('on')
      if (!layerState(rig, layer).on) rig.press(layer.button)
      expect(layerOn(rig, layer), layer.button).toBe(true)
      expect(rig.led(layer.button)).not.toBe('off')
      // Section off: the layer keeps its own switch but no longer sounds.
      rig.press(`${layer.section}-on`)
      expect(layerOn(rig, layer), layer.button).toBe(false)
      expect(layerState(rig, layer).on).toBe(true)
      rig.down(60)
      expect(census(rig)[LAYERS.indexOf(layer)]).toBe(0)
      rig.dispose()
    }
  })

  it('switching a layer off lets go of its notes and no other layer\'s', () => {
    const rig = makeRig()
    rig.press('organ-on')
    rig.press('organ-layer-b')
    rig.press('synth-on')
    rig.press('synth-layer-b')
    rig.press('synth-layer-c')
    rig.press('piano-layer-b')
    rig.down(60)
    expect(census(rig)).toEqual([1, 1, 1, 1, 1, 1, 1])
    rig.press('synth-layer-c') // focused: off
    rig.render(1.5)
    expect(census(rig)).toEqual([1, 1, 1, 1, 1, 1, 0])
    rig.press('organ-layer-b') // focused: off
    rig.render(0.2)
    expect(census(rig)).toEqual([1, 0, 1, 1, 1, 1, 0])
    rig.press('piano-on')
    expect(rig.kernel.describeVoices().every((voice) => voice.state !== 1)).toBe(true)
    expect(census(rig).slice(0, 2)).toEqual([1, 0])
    expect(census(rig).slice(4)).toEqual([1, 1, 0])
    rig.dispose()
  })
})

describe('layers.routing: focus', () => {
  it('a layer button focuses its layer: the panel edits it, its LED blinks, and the effects follow', () => {
    for (const layer of LAYERS) {
      const rig = makeRig()
      if (!rig.state()[layer.section].on) rig.press(`${layer.section}-on`)
      // Turn on a second layer so there is a focus to move.
      const other = LAYERS.find((each) => each.section === layer.section && each.index !== layer.index)!
      if (!layerState(rig, other).on) rig.press(other.button)
      if (!layerState(rig, layer).on || rig.state()[layer.section].focus !== layer.index) rig.press(layer.button)
      expect(rig.state()[layer.section].focus, layer.button).toBe(layer.index)
      expect(rig.led(layer.button)).toBe('blink')
      expect(rig.led(other.button)).toBe('on')
      expect(rig.state().fx.focus).toBe(layer.chain)
      expect(rig.led(`${layer.section}-fx-focus`)).toBe('on')
      for (const section of ['organ', 'piano', 'synth']) {
        if (section !== layer.section) expect(rig.led(`${section}-fx-focus`)).toBe('off')
      }
      expect(rig.state().ui.section).toBe(layer.section)
      rig.dispose()
    }
  })

  it('the section controls edit the focused layer and leave the others alone', () => {
    const rig = makeRig()
    rig.press('organ-on')
    rig.press('organ-layer-b')
    rig.set('organ-drawbar-1', 2)
    rig.press('organ-model')
    expect(rig.state().organ.layers.map((layer) => [layer.drawbars[0], layer.model])).toEqual([[8, 0], [2, 1]])
    // The panel shows whichever layer is in focus.
    rig.press('organ-layer-a')
    expect(rig.value('organ-drawbar-1')).toBe(8)
    expect(rig.step('organ-model')).toBe(0)
    rig.press('organ-layer-b')
    expect(rig.value('organ-drawbar-1')).toBe(2)

    rig.press('synth-on')
    rig.press('synth-layer-c')
    rig.set('synth-filter-freq', 9)
    rig.press('synth-voice-mode')
    expect(rig.state().synth.layers.map((layer) => [layer.filter.freq, layer.voice.mode])).toEqual([[3.5, 0], [3.5, 0], [9, 1]])
    rig.press('synth-layer-a')
    expect(rig.value('synth-filter-freq')).toBe(3.5)
    rig.dispose()
  })

  it('the focused layer cannot be switched off while it is the only one on', () => {
    for (const section of ['organ', 'piano', 'synth'] as const) {
      const rig = makeRig()
      if (!rig.state()[section].on) rig.press(`${section}-on`)
      rig.press(`${section}-layer-a`)
      expect(rig.state()[section].layers[0].on).toBe(true)
      expect(rig.state().notice).toMatch(/is the only layer on$/)
      rig.dispose()
    }
  })
})

describe('layers.routing: level', () => {
  it('every layer has its own fader, and the fader sets that layer\'s level', () => {
    for (const layer of LAYERS) {
      const rig = solo(layer)
      const at = (value: number) => {
        rig.set(layer.fader, value)
        rig.kernel.allNotesOff()
        rig.render(0.5)
        rig.down(60)
        const out = rms(slice(mono(rig.render(0.25)), 0.05, 0.25))
        rig.up(60)
        return out
      }
      const full = at(100)
      const half = at(50)
      expect(full, layer.fader).toBeGreaterThan(0.003)
      // The fader law is a square: half way is a quarter of the gain, -12 dB.
      expect(layerGain(0.5)).toBe(0.25)
      expect(db(half / full), layer.fader).toBeGreaterThan(-13.5)
      expect(db(half / full), layer.fader).toBeLessThan(-10.5)
      expect(at(0), layer.fader).toBe(0)
      expect(rig.state().notice).toMatch(/Level 0$/)
      rig.dispose()
    }
  })

  it('the two organ layers are levelled separately even though they share one chain', () => {
    const rig = solo(LAYERS[0])
    rig.stage.edit((state) => {
      state.organ.layers[1].on = true
      state.organ.layers[1].octave = 1
    })
    rig.down(60)
    const read = () => {
      const out = slice(mono(rig.render(0.4)), 0.1, 0.4)
      return [magnitudeAt(out, noteHz(60)), magnitudeAt(out, noteHz(72))]
    }
    const both = read()
    rig.set('organ-layer-b-level', 50)
    const quieter = read()
    expect(quieter[0] / both[0]).toBeGreaterThan(0.95)
    expect(db(quieter[1] / both[1])).toBeLessThan(-10.5)
    rig.dispose()
  })
})

describe('layers.routing: octave shift', () => {
  it('the Octave Shift buttons move the focused layer up and down an octave, in every section', () => {
    for (const layer of LAYERS) {
      const rig = solo(layer)
      const heard = () => {
        rig.kernel.allNotesOff()
        rig.render(0.5)
        rig.down(57)
        const out = slice(mono(rig.render(0.5)), 0.1, 0.5)
        rig.up(57)
        return [110, 220, 440].map((hz) => magnitudeAt(out, hz))
      }
      const loudest = (levels: number[]) => levels.indexOf(Math.max(...levels))
      expect(loudest(heard()), `${layer.button} at 0`).toBe(1)
      rig.press(`${layer.section}-octave-up`)
      expect(layerState(rig, layer).octave).toBe(1)
      expect(loudest(heard()), `${layer.button} up`).toBe(2)
      rig.press(`${layer.section}-octave-down`)
      rig.press(`${layer.section}-octave-down`)
      expect(loudest(heard()), `${layer.button} down`).toBe(0)
      // ±12 semitones: it stops at one octave either way.
      rig.press(`${layer.section}-octave-down`)
      expect(layerState(rig, layer).octave).toBe(-1)
      rig.dispose()
    }
  })

  it('only the focused layer moves', () => {
    const rig = makeRig()
    rig.press('synth-on')
    rig.press('synth-layer-b')
    rig.press('synth-octave-up')
    expect(rig.sound().synth.layers.map((layer) => layer.octave)).toEqual([0, 1, 0])
    expect(rig.sound().layers.map((layer) => layer.octave)).toEqual([0, 0])
    expect(rig.state().notice).toBe('Synth B Octave +1')
    rig.dispose()
  })
})

describe('layers.routing: effect targets', () => {
  it('there are six chains: one per Piano and Synth layer, and one the Organ layers share', () => {
    expect(CHAIN_COUNT).toBe(6)
    expect([...CHAIN_NAMES]).toEqual(['Piano A', 'Piano B', 'Organ', 'Synth A', 'Synth B', 'Synth C'])
    expect(LAYERS.map((layer) => chainOf(layer.section, layer.index))).toEqual([2, 2, 0, 1, 3, 4, 5])
    expect(chainOwner(Chain.Organ)).toEqual({ section: 'organ', layer: 0 })
    expect(chainOwner(Chain.SynthC)).toEqual({ section: 'synth', layer: 2 })
    expect(makeRig().kernel.busCount).toBe(6)
  })

  it('an effect switched on with a layer in focus is in that layer\'s chain and no other', () => {
    for (const layer of LAYERS) {
      const rig = solo(layer)
      rig.press('fx-reverb-on')
      rig.set('fx-reverb-mix', 9)
      const chains = rig.state().fx.chains.map((chain) => chain.reverb.on)
      expect(chains, layer.button).toEqual(CHAIN_NAMES.map((_, chain) => chain === layer.chain))
      const sound = rig.sound()
      const heard = layer.section === 'piano' ? sound.layers[layer.index].fx : layer.section === 'organ' ? sound.organ.fx : sound.synth.layers[layer.index].fx
      expect(heard.reverb).toMatchObject({ on: true, mix: 0.9 })
      rig.dispose()
    }
  })

  it('the effect is heard on its own layer only: a reverb tail on one, a dry stop on the other', () => {
    const tail = (reverbOn: Layer, played: Layer) => {
      const rig = solo(played)
      rig.stage.edit((state) => {
        state.fx.chains[reverbOn.chain].reverb = { on: true, type: 5, tone: 0, mix: 8 }
      })
      rig.down(60)
      rig.render(0.3)
      rig.up(60)
      rig.render(0.4)
      const out = rms(rig.render(0.3).left)
      rig.dispose()
      return out
    }
    const synthA = LAYERS[4]
    const synthB = LAYERS[5]
    const organA = LAYERS[0]
    const organB = LAYERS[1]
    expect(tail(synthA, synthA)).toBeGreaterThan(0.0005)
    expect(tail(synthA, synthB)).toBeLessThan(tail(synthA, synthA) * 0.01)
    // The organ's chain is shared: a reverb set with Organ A in focus is on Organ B's notes too.
    expect(tail(organA, organB)).toBeGreaterThan(0.0005)
    expect(tail(organA, synthA)).toBeLessThan(tail(organA, organB) * 0.01)
  })

  it('the FX Focus buttons choose the chain by hand: Organ, Piano A/B, Synth A/B/C', () => {
    const rig = makeRig()
    rig.press('fx-focus-organ')
    expect(rig.state().fx.focus).toBe(Chain.Organ)
    expect(rig.led('fx-focus-organ')).toBe('on')
    expect(rig.step('fx-focus-piano')).toBe(0)
    expect(rig.state().notice).toBe('FX Focus Organ')
    const synth: number[] = []
    for (let presses = 0; presses < 4; presses += 1) {
      rig.press('fx-focus-synth')
      synth.push(rig.state().fx.focus)
    }
    expect(synth).toEqual([Chain.SynthA, Chain.SynthB, Chain.SynthC, Chain.SynthA])
    expect([rig.led('fx-focus-synth-a'), rig.led('fx-focus-synth-b'), rig.led('fx-focus-synth-c')]).toEqual(['on', 'off', 'off'])
    expect(rig.led('fx-focus-organ')).toBe('off')
    rig.press('fx-focus-piano')
    rig.press('fx-focus-piano')
    expect(rig.state().fx.focus).toBe(Chain.PianoB)
    // The effect knobs show the focused chain.
    rig.set('fx-delay-mix', 7.5)
    rig.press('fx-focus-organ')
    expect(rig.value('fx-delay-mix')).toBe(2)
    // Coming from another section, FX Focus Piano lands on the Piano's focused layer (A), then steps to B.
    rig.press('fx-focus-piano')
    expect(rig.state().fx.focus).toBe(Chain.PianoA)
    expect(rig.value('fx-delay-mix')).toBe(2)
    rig.press('fx-focus-piano')
    expect(rig.value('fx-delay-mix')).toBe(7.5)
    // The layer focus of the sections did not move.
    expect(rig.state().piano.focus).toBe(0)
    rig.dispose()
  })

  it('Synth Group shares one setting across A, B, and C; Global shares a unit across all six chains', () => {
    const rig = makeRig()
    rig.press('synth-on')
    rig.press('fx-mod2-on')
    rig.shiftPress('fx-focus-synth')
    expect(rig.state().fx.synthGroup).toBe(true)
    expect(rig.step('fx-focus-synth')).toBe(4)
    expect(fxTargets(rig.state(), 'mod2')).toEqual([Chain.SynthA, Chain.SynthB, Chain.SynthC])
    // Entering copied Synth A's chain; edits now reach all three and no piano or organ chain.
    rig.set('fx-mod2-amount', 8)
    expect(rig.state().fx.chains.map((chain) => [chain.mod2.on, chain.mod2.amount])).toEqual([
      [false, 3], [false, 3], [false, 3], [true, 8], [true, 8], [true, 8],
    ])
    rig.shiftPress('fx-focus-synth')
    rig.set('fx-mod2-amount', 1)
    expect(rig.state().fx.chains.map((chain) => chain.mod2.amount)).toEqual([3, 3, 3, 1, 8, 8])
    // Global reverb from the Synth: every chain, the Organ's included.
    rig.shiftPress('fx-reverb-on')
    rig.press('fx-reverb-on')
    rig.set('fx-reverb-mix', 4.4)
    expect(rig.state().fx.chains.map((chain) => [chain.reverb.on, chain.reverb.mix])).toEqual(CHAIN_NAMES.map(() => [true, 4.4]))
    expect(rig.sound().organ.fx.reverb.on).toBe(true)
    expect(rig.sound().organ.fx.reverb.mix).toBeCloseTo(0.44)
    expect(rig.led('fx-reverb-global')).toBe('on')
    rig.dispose()
  })

  it('Shift + FX Focus Organ is All FX Off, the same switch as Layer Effects On', () => {
    const rig = makeRig()
    rig.shiftPress('fx-focus-organ')
    expect(rig.sound().fxOn).toBe(false)
    expect(rig.led('fx-on')).toBe('off')
    expect(rig.state().notice).toBe('All Effects Off')
    rig.press('fx-on')
    expect(rig.sound().fxOn).toBe(true)
    rig.dispose()
  })
})

describe('layers.routing: on the instrument', () => {
  it('layers of all three engines are switched, focused, and levelled from the panel and heard', async () => {
    const app = mountApp()
    await start(app)
    const kernel = kernelOf(app)
    press(app, 'organ-on')
    expect(oled(app, 'layers')).toBe('ORGAN A:B3<  B:OFF')
    expect(led(app, 'organ-fx-focus')).toBe('on')
    expect(led(app, 'piano-fx-focus')).toBe('off')
    press(app, 'synth-on')
    press(app, 'synth-layer-b')
    expect(oled(app, 'layers')).toBe('SYNTH A:PURE  B:PURE<  C:OFF')
    expect(led(app, 'synth-layer-b')).toBe('blink')
    down(app, 60)
    expect([kernel.organLayer(0).keyCount, kernel.layerVoiceCount(0) > 0, kernel.synthLayer(0).voiceCount, kernel.synthLayer(1).voiceCount]).toEqual([1, true, 1, 1])
    const loud = rms(render(app, 0.3).left)
    expect(loud).toBeGreaterThan(0.01)
    up(app, 60)
    render(app, 2)
    // Pull every fader but the organ's down: what is left is the organ alone.
    for (const id of ['piano-layer-a-level', 'synth-layer-a-level', 'synth-layer-b-level']) keys(app, id, 'Home')
    down(app, 60)
    const organOnly = render(app, 0.3)
    expect(rms(organOnly.left)).toBeGreaterThan(0.003)
    expect(rms(organOnly.left)).toBeLessThan(loud)
    keys(app, 'organ-layer-a-level', 'Home')
    render(app, 0.1)
    expect(rms(render(app, 0.2).left)).toBe(0)
    // One audio context, one node, throughout.
    expect(app.fake.audio.contexts).toHaveLength(1)
    expect(app.fake.audio.connections).toHaveLength(1)
    shiftPress(app, 'synth-layer-a')
    expect(led(app, 'synth-sustped')).toBe('off')
  })
})

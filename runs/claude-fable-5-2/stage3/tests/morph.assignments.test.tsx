import { fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { INVENTORY } from '../src/hardware/inventory'
import { applyMorphs, morphBase, morphTarget, morphedValue } from '../src/state/morph'
import { mountApp } from './support/app'
import { FakeMidiPort } from './support/fakes'
import { db } from './support/fxbench'
import { down, keys, kernelOf, led, oled, press, render, shiftPress, start, value } from './support/panel'
import { makeRig, noteHz, slice } from './support/rig'
import { brightness, magnitudeAt, mono, rms } from './support/signal'

/**
 * Feature: morph.assignments
 * Wheel and Control Pedal assignment, interpolation, indicators, and clearing.
 */

/** Latch a source, move controls to their morph end values, unlatch. */
function assign(rig: ReturnType<typeof makeRig>, source: 'wheel' | 'pedal', moves: Array<[string, number]>) {
  const button = source === 'wheel' ? 'morph-wheel' : 'morph-control-pedal'
  rig.press(button)
  for (const [id, to] of moves) rig.set(id, to)
  rig.press(button)
}
const wheel = (rig: ReturnType<typeof makeRig>, position: number) => rig.set('perf-mod-wheel', Math.round(position * 127))

describe('morph.assignments: assigning', () => {
  it('latch a source, move a control from its start to where the morph should end, unlatch', () => {
    const rig = makeRig()
    rig.press('synth-on')
    rig.set('synth-filter-freq', 3)
    rig.press('morph-wheel')
    expect(rig.state().ui.morphAssign).toBe('wheel')
    expect(rig.led('morph-wheel')).toBe('blink')
    rig.set('synth-filter-freq', 9)
    expect(rig.state().morph.wheel).toEqual([{ path: 'synth.layers.0.filter.freq', to: 9 }])
    expect(rig.state().notice).toBe('Morph Wheel: Synth A Filter Freq 3 to 9')
    // The stored value has not moved: the morph starts there.
    expect(rig.state().synth.layers[0].filter.freq).toBe(3)
    // While latched the knob shows the end of the morph, so it can be adjusted from there.
    expect(rig.value('synth-filter-freq')).toBe(9)
    rig.press('morph-wheel')
    expect(rig.state().ui.morphAssign).toBeNull()
    expect(rig.value('synth-filter-freq')).toBe(3)
    expect(rig.led('morph-wheel')).toBe('on')
    rig.dispose()
  })

  it('holding a source button while moving a control assigns too, and letting go does not latch it', () => {
    const rig = makeRig()
    rig.press('synth-on')
    // One finger holds Wheel, another turns Filter Freq.
    rig.hardware.press('morph-wheel')
    rig.set('synth-filter-freq', 8)
    rig.set('synth-filter-res', 1)
    expect(rig.value('synth-filter-freq')).toBe(8)
    rig.hardware.release('morph-wheel', true)
    expect(rig.state().morph.wheel).toEqual([
      { path: 'synth.layers.0.filter.freq', to: 8 },
      { path: 'synth.layers.0.filter.res', to: 1 },
    ])
    expect(rig.state().ui.morphAssign).toBeNull()
    expect(rig.led('morph-wheel')).toBe('on')
    // Released, the knobs show their stored values again and move the sound as usual.
    expect(rig.value('synth-filter-freq')).toBe(3.5)
    rig.set('synth-filter-freq', 4)
    expect(rig.state().synth.layers[0].filter.freq).toBe(4)
    expect(rig.state().morph.wheel).toHaveLength(2)
    // A plain press with nothing moved is the latch.
    rig.press('morph-wheel')
    expect(rig.state().ui.morphAssign).toBe('wheel')
    rig.dispose()
  })

  it('one source can carry many destinations, some going up while others go down', () => {
    const rig = makeRig()
    rig.press('synth-on')
    rig.press('organ-on')
    assign(rig, 'wheel', [
      ['synth-filter-freq', 9],
      ['synth-layer-a-level', 20],
      ['organ-drawbar-1', 0],
      ['organ-drawbar-9', 8],
      ['fx-reverb-mix', 1],
    ])
    expect(rig.state().morph.wheel).toHaveLength(5)
    const at = (position: number) => {
      wheel(rig, position)
      const sound = rig.sound()
      return {
        freq: sound.synth.layers[0].filter.freq,
        level: sound.synth.layers[0].level,
        bar1: sound.organ.layers[0].drawbars[0],
        bar9: sound.organ.layers[0].drawbars[8],
      }
    }
    expect(at(0)).toEqual({ freq: 0.35, level: 1, bar1: 8, bar9: 5 })
    const half = at(64 / 127)
    expect(half.freq).toBeGreaterThan(0.35)
    expect(half.level).toBeLessThan(1)
    expect(half.bar1).toBeLessThan(8)
    expect(half.bar9).toBeGreaterThan(5)
    expect(at(1)).toEqual({ freq: 0.9, level: 0.2, bar1: 0, bar9: 8 })
    rig.dispose()
  })

  it('the Wheel and the Control Pedal are separate sources with separate assignments', () => {
    const rig = makeRig()
    rig.press('synth-on')
    assign(rig, 'wheel', [['synth-filter-freq', 8.5]])
    assign(rig, 'pedal', [['synth-filter-res', 9]])
    expect(rig.state().morph.wheel.map((item) => item.path)).toEqual(['synth.layers.0.filter.freq'])
    expect(rig.state().morph.pedal.map((item) => item.path)).toEqual(['synth.layers.0.filter.res'])
    wheel(rig, 1)
    expect(rig.sound().synth.layers[0].filter).toMatchObject({ freq: 0.85, res: 0.52 })
    rig.stage.setPedal(1)
    expect(rig.sound().synth.layers[0].filter).toMatchObject({ freq: 0.85, res: 0.9 })
    wheel(rig, 0)
    expect(rig.sound().synth.layers[0].filter).toMatchObject({ freq: 0.35, res: 0.9 })
    expect([rig.led('morph-wheel'), rig.led('morph-control-pedal')]).toEqual(['on', 'on'])
    rig.dispose()
  })

  it('every destination in the programs spec can be assigned, and nothing else can', () => {
    const destinations: Array<[string, string, (rig: ReturnType<typeof makeRig>) => void]> = [
      ['organ-layer-a-level', 'organ.layers.0.level', (rig) => rig.press('organ-on')],
      ['organ-drawbar-4', 'organ.layers.0.drawbars.3', (rig) => rig.press('organ-on')],
      ['piano-layer-a-level', 'piano.layers.0.level', () => undefined],
      ['synth-layer-b-level', 'synth.layers.1.level', (rig) => rig.press('synth-on')],
      ['synth-lfo-rate', 'synth.layers.0.lfo.rate', (rig) => rig.press('synth-on')],
      ['synth-osc-ctrl', 'synth.layers.0.ctrl', (rig) => rig.press('synth-on')],
      ['synth-lfo-amount', 'synth.layers.0.lfo.amount', (rig) => rig.press('synth-on')],
      ['synth-filter-freq', 'synth.layers.0.filter.freq', (rig) => rig.press('synth-on')],
      ['synth-filter-res', 'synth.layers.0.filter.res', (rig) => rig.press('synth-on')],
      ['synth-arp-rate', 'synth.layers.0.arp.rate', (rig) => rig.press('synth-on')],
      ['fx-mod1-rate', 'fx.chains.0.mod1.rate', () => undefined],
      ['fx-mod1-amount', 'fx.chains.0.mod1.amount', () => undefined],
      ['fx-mod2-amount', 'fx.chains.0.mod2.amount', () => undefined],
      ['fx-delay-tempo', 'fx.chains.0.delay.tempo', () => undefined],
      ['fx-delay-feedback', 'fx.chains.0.delay.feedback', () => undefined],
      ['fx-delay-mix', 'fx.chains.0.delay.mix', () => undefined],
      ['fx-eq-mid-freq', 'fx.chains.0.amp.freq', () => undefined],
      ['fx-drive', 'fx.chains.0.amp.drive', () => undefined],
      ['fx-reverb-mix', 'fx.chains.0.reverb.mix', () => undefined],
    ]
    for (const [id, path, prepare] of destinations) {
      const rig = makeRig()
      prepare(rig)
      const control = INVENTORY.controlById.get(id)!
      const base = morphBase(rig.state(), path)
      const end = base > ((control as { max: number }).max + (control as { min: number }).min) / 2 ? (control as { min: number }).min : (control as { max: number }).max
      assign(rig, 'pedal', [[id, end]])
      expect(rig.state().morph.pedal, id).toEqual([{ path, to: end }])
      expect(morphTarget(path), path).not.toBeNull()
      rig.stage.setPedal(1)
      expect(morphedValue(rig.state(), path), path).toBe(end)
      rig.dispose()
    }
    // Rotary speed is assigned with the speed button.
    const rig = makeRig()
    rig.press('morph-wheel')
    rig.press('rotary-speed')
    expect(rig.state().morph.wheel).toEqual([{ path: 'rotary.speed', to: 1 }])
    expect(rig.state().rotary.fast).toBe(false)
    // Not destinations: they say so and nothing is assigned.
    for (const id of ['fx-eq-bass', 'fx-comp-amount', 'synth-glide', 'rotary-drive']) {
      rig.set(id, 9)
      expect(rig.state().notice).toBe('Morph Wheel: that control is not a morph destination')
    }
    expect(rig.state().morph.wheel).toHaveLength(1)
    expect(morphTarget('fx.chains.0.comp.amount')).toBeNull()
    expect(morphTarget('master')).toBeNull()
    rig.dispose()
  })
})

describe('morph.assignments: interpolation', () => {
  it('the value moves in a straight line between the stored value and the end value', () => {
    const rig = makeRig()
    rig.press('synth-on')
    rig.set('synth-filter-freq', 2)
    assign(rig, 'wheel', [['synth-filter-freq', 10]])
    for (const raw of [0, 32, 64, 96, 127]) {
      rig.set('perf-mod-wheel', raw)
      expect(rig.sound().synth.layers[0].filter.freq).toBeCloseTo((2 + 8 * (raw / 127)) / 10, 9)
    }
    // Both sources on one destination add their moves, within the control's range.
    assign(rig, 'pedal', [['synth-filter-freq', 0]])
    rig.set('perf-mod-wheel', 127)
    rig.stage.setPedal(1)
    expect(rig.sound().synth.layers[0].filter.freq).toBeCloseTo(0.8, 9)
    rig.stage.setPedal(0.5)
    expect(rig.sound().synth.layers[0].filter.freq).toBeCloseTo(0.9, 9)
    rig.dispose()
  })

  it('morphing is heard: the wheel opens a filter and a pedal fades a layer in', () => {
    const rig = makeRig()
    rig.press('piano-on')
    rig.press('synth-on')
    rig.stage.setSynthLayer(0, (layer) => {
      layer.filter = { on: true, type: 1, freq: 3, res: 1, envAmt: 0, track: 0, drive: 0 }
      layer.voice.unison = 0
      layer.oscEnv.amount = 0
    })
    assign(rig, 'wheel', [['synth-filter-freq', 9]])
    rig.set('synth-layer-a-level', 0)
    assign(rig, 'pedal', [['synth-layer-a-level', 100]])
    rig.down(45)
    expect(rms(rig.render(0.3).left)).toBe(0)
    rig.stage.setPedal(1)
    const dark = slice(mono(rig.render(0.5)), 0.2, 0.5)
    wheel(rig, 1)
    const bright = slice(mono(rig.render(0.5)), 0.2, 0.5)
    expect(rms(dark)).toBeGreaterThan(0.01)
    expect(brightness(bright)).toBeGreaterThan(brightness(dark) * 10)
    // Halfway on the pedal is a quarter of the gain (the fader law is a square): about -12 dB.
    rig.stage.setPedal(0.5)
    const half = slice(mono(rig.render(0.5)), 0.2, 0.5)
    expect(db(rms(half) / rms(bright))).toBeGreaterThan(-14)
    expect(db(rms(half) / rms(bright))).toBeLessThan(-10)
    rig.dispose()
  })

  it('a morphed drawbar changes the organ spectrum as the wheel moves', () => {
    const rig = makeRig()
    rig.press('piano-on')
    rig.press('organ-on')
    rig.stage.setOrganLayer(0, (layer) => {
      layer.drawbars = [0, 0, 8, 0, 0, 0, 0, 0, 0]
      layer.vibOn = false
    })
    assign(rig, 'wheel', [['organ-drawbar-4', 8]])
    rig.down(60)
    const octave = () => magnitudeAt(slice(mono(rig.render(0.4)), 0.1, 0.4), noteHz(72))
    const none = octave()
    wheel(rig, 0.5)
    const some = octave()
    wheel(rig, 1)
    const all = octave()
    expect(none).toBeLessThan(0.001)
    expect(some).toBeGreaterThan(0.005)
    expect(all).toBeGreaterThan(some * 2)
    rig.dispose()
  })

  it('a morphed Delay Tempo moves the delay time; applying morphs never changes the stored program', () => {
    const rig = makeRig()
    assign(rig, 'wheel', [['fx-delay-tempo', 8]])
    const before = JSON.stringify(rig.state().fx)
    wheel(rig, 1)
    expect(rig.sound().layers[0].fx.delay.time).toBeGreaterThan(0.5)
    wheel(rig, 0)
    expect(rig.sound().layers[0].fx.delay.time).toBeLessThan(0.1)
    wheel(rig, 0.7)
    expect(JSON.stringify(rig.state().fx)).toBe(before)
    expect(applyMorphs(rig.state())).not.toBe(rig.state())
    wheel(rig, 0)
    // With the sources at rest the state is used as it is: no copy at all.
    expect(applyMorphs(rig.state())).toBe(rig.state())
    rig.dispose()
  })
})

describe('morph.assignments: indicators', () => {
  it('an assigned knob lights its green morph LED, for the layer and chain that are in focus', () => {
    const rig = makeRig()
    rig.press('synth-on')
    const morphLeds = INVENTORY.leds.filter((item) => item.id.endsWith('-morph'))
    expect(morphLeds.length).toBe(20)
    for (const item of morphLeds) expect(item.color).toBe('green')
    expect(rig.led('synth-filter-freq-morph')).toBe('off')
    assign(rig, 'wheel', [['synth-filter-freq', 9], ['fx-reverb-mix', 2]])
    expect(rig.led('synth-filter-freq-morph')).toBe('on')
    expect(rig.led('fx-reverb-mix-morph')).toBe('on')
    expect(rig.led('synth-filter-res-morph')).toBe('off')
    // Another layer has no assignment, so its LEDs are dark; back on A they are lit again.
    rig.press('synth-layer-b')
    expect(rig.led('synth-filter-freq-morph')).toBe('off')
    expect(rig.led('fx-reverb-mix-morph')).toBe('off')
    rig.press('synth-layer-a')
    expect(rig.led('synth-filter-freq-morph')).toBe('on')
    expect(rig.text('synth-filter-freq')).toMatch(/morph from 3\.5: Wheel to 9; now 3\.5/)
    wheel(rig, 1)
    expect(rig.text('synth-filter-freq')).toMatch(/now 9$/)
    rig.dispose()
  })

  it('level faders and drawbars show the morphed value on their LED graphs', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'organ-on')
    const ladder = app.container.querySelector<HTMLElement>('[data-ladder-for="organ-layer-a-level"]')!
    const graph = app.container.querySelector<HTMLElement>('[data-graph-for="organ-drawbar-2"]')!
    expect(ladder).toHaveAttribute('data-lit', '12')
    expect(graph.querySelectorAll('.is-lit')).toHaveLength(6)
    press(app, 'morph-wheel')
    keys(app, 'organ-layer-a-level', 'Home')
    keys(app, 'organ-drawbar-2', 'Home')
    press(app, 'morph-wheel')
    // At rest the faders show the stored values and are marked as morphed.
    expect(value(app, 'organ-layer-a-level')).toBe(100)
    expect(ladder).toHaveAttribute('data-lit', '12')
    expect(ladder).toHaveAttribute('data-morphed', 'true')
    // Push the wheel up: the graphs follow the morph while the fader cap and the drawbar stay put.
    keys(app, 'perf-mod-wheel', 'End')
    expect(ladder).toHaveAttribute('data-lit', '0')
    expect(graph.querySelectorAll('.is-lit')).toHaveLength(0)
    expect(value(app, 'organ-layer-a-level')).toBe(100)
    expect(value(app, 'organ-drawbar-2')).toBe(6)
    expect(kernelOf(app).getState().organ.layers[0].level).toBe(0)
    fireEvent.keyDown(app.control('perf-mod-wheel'), { key: 'Home' })
    expect(ladder).toHaveAttribute('data-lit', '12')
    expect(led(app, 'morph-wheel')).toBe('on')
  })

  it('the Rotary MORPH LED and the source buttons show what is assigned', () => {
    const rig = makeRig()
    expect([rig.led('morph-wheel'), rig.led('morph-control-pedal'), rig.led('rotary-morph')]).toEqual(['off', 'off', 'off'])
    rig.press('morph-control-pedal')
    expect(rig.led('morph-control-pedal')).toBe('blink')
    rig.press('rotary-speed')
    rig.press('morph-control-pedal')
    expect(rig.led('rotary-morph')).toBe('on')
    expect(rig.led('morph-control-pedal')).toBe('on')
    expect(rig.led('morph-wheel')).toBe('off')
    rig.dispose()
  })
})

describe('morph.assignments: clearing', () => {
  it('Shift + a source button clears all of that source\'s assignments and leaves the other source alone', () => {
    const rig = makeRig()
    rig.press('synth-on')
    assign(rig, 'wheel', [['synth-filter-freq', 9], ['synth-osc-ctrl', 9]])
    assign(rig, 'pedal', [['synth-filter-res', 9]])
    wheel(rig, 1)
    rig.shiftPress('morph-wheel')
    expect(rig.state().morph.wheel).toEqual([])
    expect(rig.state().morph.pedal).toHaveLength(1)
    expect(rig.state().notice).toBe('Morph Wheel cleared')
    expect(rig.led('morph-wheel')).toBe('off')
    expect(rig.led('synth-filter-freq-morph')).toBe('off')
    expect(rig.led('synth-filter-res-morph')).toBe('on')
    // The wheel no longer moves anything.
    expect(rig.sound().synth.layers[0].filter.freq).toBe(0.35)
    expect(rig.meter('synth-layer-a-level')).toBeUndefined()
    rig.dispose()
  })

  it('re-latching and moving a control back to its stored value removes just that assignment', () => {
    const rig = makeRig()
    rig.press('synth-on')
    assign(rig, 'wheel', [['synth-filter-freq', 9], ['synth-osc-ctrl', 9]])
    rig.press('morph-wheel')
    expect(rig.value('synth-filter-freq')).toBe(9)
    rig.set('synth-filter-freq', 3.5)
    expect(rig.state().notice).toBe('Morph Wheel: Synth A Filter Freq removed')
    rig.press('morph-wheel')
    expect(rig.state().morph.wheel).toEqual([{ path: 'synth.layers.0.ctrl', to: 9 }])
    expect(rig.led('synth-filter-freq-morph')).toBe('off')
    expect(rig.led('synth-osc-ctrl-morph')).toBe('on')
    // Changing the end value replaces the assignment instead of adding a second one.
    assign(rig, 'wheel', [['synth-osc-ctrl', 6]])
    expect(rig.state().morph.wheel).toEqual([{ path: 'synth.layers.0.ctrl', to: 6 }])
    rig.dispose()
  })

  it('Exit leaves a latched Morph Assign', () => {
    const rig = makeRig()
    rig.press('morph-wheel')
    rig.exit()
    expect(rig.state().ui.morphAssign).toBeNull()
    rig.set('fx-reverb-mix', 2)
    expect(rig.state().morph.wheel).toEqual([])
    expect(rig.state().fx.chains[0].reverb.mix).toBe(2)
    rig.dispose()
  })
})

describe('morph.assignments: the control pedal', () => {
  it('the on-screen pedal and MIDI CC11 both drive the Control Pedal source; CC1 drives the wheel', async () => {
    const app = mountApp((fake) => fake.midi.plug(new FakeMidiPort('kb')))
    await start(app)
    fireEvent.click(app.getByRole('button', { name: 'Enable MIDI' }))
    await app.settle()
    press(app, 'morph-control-pedal')
    keys(app, 'fx-reverb-mix', 'Home')
    press(app, 'morph-control-pedal')
    press(app, 'morph-wheel')
    keys(app, 'piano-layer-a-level', 'Home')
    press(app, 'morph-wheel')
    expect(oled(app, 'notice')).toBe('> MORPH WHEEL ASSIGN OFF')
    const reverb = () => kernelOf(app).getState().layers[0].fx.reverb.mix
    expect(reverb()).toBeCloseTo(0.65)
    // The on-screen pedal.
    const pedal = app.control('control-pedal') as HTMLInputElement
    fireEvent.change(pedal, { target: { value: '127' } })
    expect(reverb()).toBe(0)
    fireEvent.change(pedal, { target: { value: '0' } })
    expect(reverb()).toBeCloseTo(0.65)
    // MIDI CC11, and the slider follows it.
    const port = app.fake.midi.ports.get('kb')!
    port.send(0xb0, 11, 127)
    await app.settle()
    expect(reverb()).toBe(0)
    expect((app.control('control-pedal') as HTMLInputElement).value).toBe('127')
    // MIDI CC1 moves the wheel, and the panel wheel follows it.
    port.send(0xb0, 1, 127)
    await app.settle()
    expect(kernelOf(app).getState().layers[0].level).toBe(0)
    expect(value(app, 'perf-mod-wheel')).toBe(127)
    down(app, 60)
    expect(rms(render(app, 0.2).left)).toBe(0)
    shiftPress(app, 'morph-wheel')
    expect(kernelOf(app).getState().layers[0].level).toBe(1)
  })
})

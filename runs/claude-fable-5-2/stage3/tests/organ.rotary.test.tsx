import { describe, expect, it } from 'vitest'
import { Rotor } from '../src/audio/dsp/effects'
import { AmpType, Chain } from '../src/audio/dsp/params'
import { mountApp } from './support/app'
import { envelope } from './support/fxbench'
import { down, kernelOf, led, oled, press, render, shiftPress, start, step } from './support/panel'
import { harmonics, makeRig, noteHz, organKernel, renderKernel, retune, slice } from './support/rig'
import { SR, equal, mono, rms } from './support/signal'
import { correlation, difference } from './support/stage'

/**
 * Feature: organ.rotary
 * Routing, slow/fast/stop with acceleration, drive, morphable speed.
 */

const only = (bar: number) => Array.from({ length: 9 }, (_, index) => (index === bar ? 8 : 0))
const SPEEDS = { hornSlow: 0.83, hornFast: 6.7, drumSlow: 0.7, drumFast: 5.9 }

function rotaryOrgan(configure?: Parameters<typeof organKernel>[0]) {
  return organKernel((layer, sound) => {
    layer.drawbars = [0, 0, 8, 0, 0, 0, 0, 8, 8]
    sound.organ.toRotary = true
    configure?.(layer, sound)
  })
}
/** How many times a second the loudness of one channel swings: the horn going round. */
function swingRate(buffer: Float32Array): number {
  const env = envelope(buffer, 0.005)
  let mean = 0
  for (const value of env) mean += value
  mean /= env.length
  let crossings = 0
  for (let i = 1; i < env.length; i += 1) if (env[i - 1] < mean && env[i] >= mean) crossings += 1
  return crossings / (buffer.length / SR)
}

describe('organ.rotary: routing', () => {
  it('the Organ button in the Rotary group routes the organ through the rotary speaker', () => {
    const rig = makeRig()
    rig.press('organ-on')
    expect(rig.sound().organ.toRotary).toBe(false)
    expect(rig.led('rotary-on')).toBe('off')
    rig.press('rotary-source')
    expect(rig.sound().organ.toRotary).toBe(true)
    expect(rig.led('rotary-source')).toBe('on')
    expect(rig.led('rotary-on')).toBe('on')
    expect(rig.state().notice).toBe('Organ to Rotary On')
    // The ON LED says whether anything actually plays through it.
    rig.press('organ-on')
    expect(rig.led('rotary-on')).toBe('off')
    rig.press('organ-on')
    rig.press('rotary-source')
    expect(rig.sound().organ.toRotary).toBe(false)
    expect(rig.led('rotary-on')).toBe('off')
    rig.dispose()
  })

  it('routed, the organ comes out moving and in stereo; unrouted, it is the same in both channels', () => {
    const play = (routed: boolean) => {
      const kernel = rotaryOrgan((_, sound) => {
        sound.organ.toRotary = routed
      })
      kernel.noteOn(60, 0.8)
      return renderKernel(kernel, 2)
    }
    const straight = play(false)
    const turning = play(true)
    expect(equal(straight.left, straight.right)).toBe(true)
    expect(equal(turning.left, turning.right)).toBe(false)
    expect(correlation(slice(turning.left, 0.5, 2), slice(turning.right, 0.5, 2))).toBeLessThan(0.98)
    expect(difference(mono(straight), mono(turning))).toBeGreaterThan(0.3)
    // The horn's amplitude swing is there with the rotary and absent without.
    const swing = (buffer: Float32Array) => {
      const env = envelope(slice(buffer, 0.5, 2), 0.01)
      return (Math.max(...env) - Math.min(...env)) / Math.max(...env)
    }
    expect(swing(turning.left)).toBeGreaterThan(0.2)
    // (The little that is left without it is the drawbars' own partials beating inside a 10 ms window.)
    expect(swing(straight.left)).toBeLessThan(0.1)
  })

  it('it is the one shared rotor: organ and a piano layer set To Rotary turn together', () => {
    const rig = makeRig()
    rig.press('organ-on')
    rig.press('rotary-source')
    rig.press('fx-focus-piano')
    rig.press('fx-amp-on')
    for (let presses = 0; presses < 3; presses += 1) rig.press('fx-amp-type')
    expect(rig.sound().layers[0].fx.amp.type).toBe(AmpType.ToRotary)
    expect(rig.led('rotary-on')).toBe('on')
    rig.press('rotary-speed')
    expect(rig.sound().rotary.fast).toBe(true)
    rig.down(60)
    rig.render(4)
    // One rotor, one speed, for both.
    expect(rig.kernel.rotorSpeed.horn).toBeGreaterThan(6)
    rig.dispose()
  })

  it('the organ keeps its rotary when Layer Effects are switched off: it is the speaker, not a layer effect', () => {
    const kernel = rotaryOrgan((_, sound) => {
      sound.fxOn = false
    })
    kernel.noteOn(60, 0.8)
    const out = renderKernel(kernel, 1)
    expect(equal(out.left, out.right)).toBe(false)
  })

  it('reverb comes before the rotary for the organ too', () => {
    const kernel = rotaryOrgan((_, sound) => {
      sound.organ.fx.reverb = { on: true, type: 5, tone: 0, mix: 0.7 }
    })
    kernel.noteOn(60, 0.8)
    renderKernel(kernel, 0.5)
    kernel.noteOff(60)
    // The tail is still swinging with the horn: the rotary is after the reverb.
    const tail = renderKernel(kernel, 1.5)
    const env = envelope(slice(tail.left, 0.2, 1.5), 0.01)
    const other = envelope(slice(tail.right, 0.2, 1.5), 0.01)
    let apart = 0
    for (let i = 0; i < env.length; i += 1) apart = Math.max(apart, Math.abs(env[i] - other[i]) / Math.max(env[i], other[i], 1e-9))
    expect(apart).toBeGreaterThan(0.2)
  })
})

describe('organ.rotary: slow, fast, stop', () => {
  it('slow and fast are different speeds, heard as the rate of the swing', () => {
    const rate = (fast: boolean) => {
      const kernel = rotaryOrgan((_, sound) => {
        sound.rotary.fast = fast
      })
      kernel.noteOn(72, 0.8)
      renderKernel(kernel, 6)
      return swingRate(renderKernel(kernel, 4).left)
    }
    const slow = rate(false)
    const fast = rate(true)
    // Slow: horn 0.83 and drum 0.7 turns a second. Fast: 6.7 and 5.9.
    expect(slow).toBeGreaterThan(0.5)
    expect(slow).toBeLessThan(2.5)
    expect(fast).toBeGreaterThan(5)
    expect(fast).toBeLessThan(14)
    expect(fast).toBeGreaterThan(slow * 2.5)
  })

  it('speed changes accelerate: the horn gets there in about a second, the heavy drum takes several', () => {
    const kernel = rotaryOrgan()
    kernel.noteOn(60, 0.8)
    renderKernel(kernel, 0.5)
    expect(kernel.rotorSpeed.horn).toBeCloseTo(SPEEDS.hornSlow, 1)
    retune(kernel, (sound) => {
      sound.rotary.fast = true
    })
    const horn: number[] = []
    const drum: number[] = []
    for (let tenth = 0; tenth < 80; tenth += 1) {
      renderKernel(kernel, 0.1)
      horn.push(kernel.rotorSpeed.horn)
      drum.push(kernel.rotorSpeed.drum)
    }
    // Not instant: a tenth of a second in it has barely started…
    expect(horn[0]).toBeLessThan(2)
    // …it rises steadily, never jumping…
    for (let i = 1; i < horn.length; i += 1) {
      expect(horn[i]).toBeGreaterThanOrEqual(horn[i - 1])
      expect(horn[i] - horn[i - 1]).toBeLessThan(1)
    }
    // …and arrives. The drum lags well behind the horn.
    expect(horn[25]).toBeGreaterThan(6.4)
    expect(drum[10]).toBeLessThan(horn[10] * 0.5)
    expect(drum[79]).toBeGreaterThan(4.8)
    // Slowing down is gradual too.
    retune(kernel, (sound) => {
      sound.rotary.fast = false
    })
    renderKernel(kernel, 0.3)
    expect(kernel.rotorSpeed.horn).toBeGreaterThan(3)
    renderKernel(kernel, 6)
    expect(kernel.rotorSpeed.horn).toBeCloseTo(SPEEDS.hornSlow, 1)
  })

  it('Stop Mode turns the slow position into a standstill, and the rotors coast down to it', () => {
    const kernel = rotaryOrgan((_, sound) => {
      sound.rotary.stop = true
      sound.rotary.fast = true
      // No drive, so that nothing but the rotors can make the level move.
      sound.rotary.drive = 0
    })
    kernel.noteOn(60, 0.8)
    renderKernel(kernel, 5)
    expect(kernel.rotorSpeed.horn).toBeGreaterThan(6)
    retune(kernel, (sound) => {
      sound.rotary.fast = false
    })
    renderKernel(kernel, 0.5)
    expect(kernel.rotorSpeed.horn).toBeGreaterThan(1)
    renderKernel(kernel, 30)
    expect(kernel.rotorSpeed.horn).toBeLessThan(0.01)
    expect(kernel.rotorSpeed.drum).toBeLessThan(0.02)
    // The heavy drum is the last to come to rest.
    renderKernel(kernel, 40)
    expect(kernel.rotorSpeed.drum).toBe(0)
    // Stopped, the sound stands still: no swing left.
    const still = renderKernel(kernel, 2).left
    const env = envelope(slice(still, 0.2, 2), 0.1)
    expect((Math.max(...env) - Math.min(...env)) / Math.max(...env)).toBeLessThan(0.03)
  })

  it('the panel: Slow/Fast and Stop Mode buttons, LEDs, and the display', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'organ-on')
    press(app, 'rotary-source')
    expect(led(app, 'rotary-on')).toBe('on')
    expect([led(app, 'rotary-speed-slow'), led(app, 'rotary-speed-fast')]).toEqual(['on', 'off'])
    press(app, 'rotary-speed')
    expect(step(app, 'rotary-speed')).toBe('Fast')
    expect(oled(app, 'notice')).toBe('> ROTARY FAST')
    expect(kernelOf(app).getState().rotary).toMatchObject({ fast: true, stop: false })
    press(app, 'rotary-stop-mode')
    press(app, 'rotary-speed')
    expect(oled(app, 'notice')).toBe('> ROTARY STOP')
    expect(kernelOf(app).getState().rotary).toMatchObject({ fast: false, stop: true })
    down(app, 60)
    const out = render(app, 0.5)
    expect(rms(out.left)).toBeGreaterThan(0.003)
    expect(equal(out.left, out.right)).toBe(false)
    shiftPress(app, 'rotary-source')
    expect(oled(app, 'notice')).toBe('> ROTARY CLOSE MIC IS NOT AVAILABLE')
    expect(kernelOf(app).getState().organ.toRotary).toBe(true)
  })
})

describe('organ.rotary: drive', () => {
  it('Drive overdrives the signal going into the rotary: more harmonics, the further it is turned', () => {
    const distortion = (drive: number) => {
      const kernel = rotaryOrgan((layer, sound) => {
        layer.drawbars = only(2)
        sound.rotary.drive = drive
        sound.rotary.stop = true
      })
      kernel.noteOn(48, 0.8)
      const out = slice(mono(renderKernel(kernel, 12)), 11, 12)
      const [h1, , h3] = harmonics(out, noteHz(48), 3)
      return h3 / h1
    }
    const levels = [0, 0.3, 0.7, 1].map(distortion)
    expect(levels[0]).toBeLessThan(0.02)
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]).toBeGreaterThan(levels[i - 1] * 1.3)
  })

  it('the Drive knob sets it from the panel', () => {
    const rig = makeRig()
    rig.set('rotary-drive', 7.5)
    expect(rig.sound().rotary.drive).toBeCloseTo(0.75)
    expect(rig.state().notice).toBe('Rotary Drive 7.5')
    rig.dispose()
  })
})

describe('organ.rotary: morphable speed', () => {
  it('a morph on the speed moves the rotors anywhere between slow and fast', () => {
    const rotor = new Rotor(SR)
    const settle = (speed: number | undefined, fast = false, stop = false) => {
      rotor.configure(fast, stop, 0, speed)
      for (let block = 0; block < 30 * 375; block += 1) rotor.advance(128)
      return rotor.hornSpeed
    }
    expect(settle(0)).toBeCloseTo(SPEEDS.hornSlow, 2)
    expect(settle(1)).toBeCloseTo(SPEEDS.hornFast, 2)
    expect(settle(0.5)).toBeCloseTo((SPEEDS.hornSlow + SPEEDS.hornFast) / 2, 2)
    // In Stop Mode the bottom of the morph is a standstill.
    expect(settle(0, false, true)).toBeLessThan(0.01)
    expect(settle(0.5, false, true)).toBeCloseTo(SPEEDS.hornFast / 2, 2)
    // Without a morph the switch decides, exactly as before.
    expect(settle(undefined, true)).toBeCloseTo(SPEEDS.hornFast, 2)
  })

  it('assigned to the wheel or pedal from the panel, the source sets the speed and the MORPH LED lights', () => {
    const rig = makeRig()
    rig.press('organ-on')
    rig.press('rotary-source')
    rig.press('morph-control-pedal')
    rig.press('rotary-speed')
    rig.press('morph-control-pedal')
    expect(rig.state().morph.pedal).toEqual([{ path: 'rotary.speed', to: 1 }])
    expect(rig.led('rotary-morph')).toBe('on')
    // The switch itself has not moved, and at rest the sound state carries no morphed speed.
    expect(rig.state().rotary.fast).toBe(false)
    expect(rig.sound().rotary.speed).toBeUndefined()
    rig.down(60)
    rig.stage.setPedal(1)
    expect(rig.sound().rotary.speed).toBe(1)
    rig.render(5)
    expect(rig.kernel.rotorSpeed.horn).toBeGreaterThan(6.3)
    rig.stage.setPedal(0.5)
    expect(rig.sound().rotary.speed).toBe(0.5)
    rig.render(8)
    expect(rig.kernel.rotorSpeed.horn).toBeGreaterThan(3)
    expect(rig.kernel.rotorSpeed.horn).toBeLessThan(4.5)
    rig.stage.setPedal(0)
    rig.render(8)
    expect(rig.kernel.rotorSpeed.horn).toBeCloseTo(SPEEDS.hornSlow, 1)
    // Starting from Fast, the morph runs the other way: the pedal slows it down.
    rig.shiftPress('morph-control-pedal')
    expect(rig.led('rotary-morph')).toBe('off')
    rig.press('rotary-speed')
    rig.press('morph-wheel')
    rig.press('rotary-speed')
    rig.press('morph-wheel')
    expect(rig.state().morph.wheel).toEqual([{ path: 'rotary.speed', to: 0 }])
    rig.set('perf-mod-wheel', 127)
    expect(rig.sound().rotary.speed).toBe(0)
    expect(rig.kernel.getState().organ.toRotary).toBe(true)
    expect(rig.state().fx.focus).toBe(Chain.Organ)
    rig.dispose()
  })
})

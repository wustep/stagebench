import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AmpType, DelayFilter, delayKnobToSeconds, delaySecondsToKnob } from '../src/audio/dsp/params'
import { UNSUPPORTED_IN_FUNCTIONAL_SECTIONS } from '../src/hardware/functional'
import { mountApp, type MountedApp } from './support/app'
import { bandLevel, envelope } from './support/fxbench'
import { down, kernelOf, keys, led, oled, press, render, shiftPress, start, step, up, value } from './support/panel'
import { SR, equal, mono, peak, rms, rmsAt, type Stereo } from './support/signal'
import { difference, fx, makeStage, renderStage, selectType } from './support/stage'

/**
 * Feature: effects.routing
 * Focus follows layers, manual focus, group and global modes, per-unit bypass, all-effects
 * bypass, dry/wet, documented order, delay feedback path, To Rotary.
 *
 * Everything here goes through the mounted panel: a button or knob is operated, and the
 * rendered audio and the kernel's own state must both show the result.
 */

const UNIT_BUTTONS = {
  mod1: 'fx-mod1-on',
  mod2: 'fx-mod2-on',
  delay: 'fx-delay-on',
  amp: 'fx-amp-on',
  comp: 'fx-comp-on',
  reverb: 'fx-reverb-on',
} as const

function chains(app: MountedApp) {
  return kernelOf(app).getState().layers.map((layer) => layer.fx)
}

/** Play a short chord on a fresh, started app after `prepare`, and render it. */
async function chord(prepare: (app: MountedApp) => void | Promise<void> = () => undefined, seconds = 0.8): Promise<{ app: MountedApp; out: Stereo }> {
  const app = mountApp()
  await start(app)
  await prepare(app)
  await app.settle()
  for (const note of [55, 60, 64]) down(app, note)
  const out = render(app, seconds)
  return { app, out }
}

describe('effects.routing: per-unit on / bypass', () => {
  it('starts with every unit off and Layer Effects on, as the LEDs show', () => {
    const app = mountApp()
    for (const [unit, id] of Object.entries(UNIT_BUTTONS)) {
      expect(app.control(id), unit).toHaveAttribute('aria-pressed', 'false')
      expect(led(app, id), unit).toBe('off')
    }
    expect(app.control('fx-on')).toHaveAttribute('aria-pressed', 'true')
    expect(step(app, 'fx-focus-piano')).toBe('Layer A')
    expect(led(app, 'rotary-on')).toBe('off')
  })

  it('each On button switches its unit into the signal path, and out again leaves no trace', async () => {
    const dry = await chord()
    for (const [unit, id] of Object.entries(UNIT_BUTTONS) as Array<[keyof typeof UNIT_BUTTONS, string]>) {
      const wet = await chord((app) => press(app, id))
      expect(led(wet.app, id), unit).toBe('on')
      expect(chains(wet.app)[0][unit].on, unit).toBe(true)
      expect(chains(wet.app)[1][unit].on, unit).toBe(false)
      expect(difference(dry.out.left, wet.out.left), unit).toBeGreaterThan(0.03)

      // Off again: after the 12 ms crossfade the output is bit-for-bit the dry instrument's.
      press(wet.app, id)
      expect(led(wet.app, id), unit).toBe('off')
      render(wet.app, 0.1)
      render(dry.app, wet === undefined ? 0 : 0.1)
      const after = render(wet.app, 0.2)
      const reference = render(dry.app, 0.2)
      expect(equal(after.left, reference.left), unit).toBe(true)
      expect(equal(after.right, reference.right), unit).toBe(true)
      wet.app.unmount()
      // Bring the reference back in step for the next unit.
      dry.app.unmount()
      Object.assign(dry, await chord())
    }
  })
})

describe('effects.routing: all-effects bypass', () => {
  it('Layer Effects On switches every unit out at once and back in, keeping their settings', async () => {
    const dry = await chord()
    const wet = await chord((app) => {
      for (const id of Object.values(UNIT_BUTTONS)) press(app, id)
    })
    expect(difference(dry.out.left, wet.out.left)).toBeGreaterThan(0.3)

    press(wet.app, 'fx-on')
    expect(wet.app.control('fx-on')).toHaveAttribute('aria-pressed', 'false')
    expect(led(wet.app, 'fx-on')).toBe('off')
    expect(oled(wet.app, 'notice')).toBe('> ALL EFFECTS OFF')
    expect(kernelOf(wet.app).getState().fxOn).toBe(false)
    // The units keep their own On LEDs: only the master switch is off.
    for (const id of Object.values(UNIT_BUTTONS)) expect(led(wet.app, id)).toBe('on')
    render(wet.app, 0.1)
    render(dry.app, 0.1)
    const bypassed = render(wet.app, 0.3)
    const reference = render(dry.app, 0.3)
    expect(equal(bypassed.left, reference.left)).toBe(true)
    expect(equal(bypassed.right, reference.right)).toBe(true)

    press(wet.app, 'fx-on')
    render(wet.app, 0.1)
    render(dry.app, 0.1)
    expect(difference(render(dry.app, 0.3).left, render(wet.app, 0.3).left)).toBeGreaterThan(0.3)
  })
})

describe('effects.routing: focus', () => {
  it('follows the Piano layer buttons: the effect controls show and edit the focused layer\'s chain', async () => {
    const app = mountApp()
    await start(app)
    // Layer A: reverb on, Hall, mix full.
    press(app, 'fx-reverb-on')
    press(app, 'fx-reverb-type') // Cathedral → Spring
    keys(app, 'fx-reverb-mix', 'End')
    expect(step(app, 'fx-reverb-type')).toBe('Spring')

    press(app, 'piano-layer-b')
    await app.settle()
    expect(step(app, 'fx-focus-piano')).toBe('Layer B')
    expect([led(app, 'fx-focus-piano-a'), led(app, 'fx-focus-piano-b')]).toEqual(['off', 'on'])
    // The panel now shows Layer B's untouched chain.
    expect(app.control('fx-reverb-on')).toHaveAttribute('aria-pressed', 'false')
    expect(step(app, 'fx-reverb-type')).toBe('Cathedral')
    expect(value(app, 'fx-reverb-mix')).toBe(6.5)
    // Edit B: delay on.
    press(app, 'fx-delay-on')
    keys(app, 'fx-delay-mix', 'End')
    expect(chains(app).map((chain) => [chain.reverb.on, chain.delay.on])).toEqual([
      [true, false],
      [false, true],
    ])

    press(app, 'piano-layer-a')
    expect(step(app, 'fx-focus-piano')).toBe('Layer A')
    expect(app.control('fx-reverb-on')).toHaveAttribute('aria-pressed', 'true')
    expect(app.control('fx-delay-on')).toHaveAttribute('aria-pressed', 'false')
    expect(step(app, 'fx-reverb-type')).toBe('Spring')
    expect(value(app, 'fx-reverb-mix')).toBe(10)
    expect(value(app, 'fx-delay-mix')).toBe(2)
  })

  it('the FX Focus Piano button moves effect focus by hand without moving the Piano focus', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'piano-layer-b')
    press(app, 'piano-layer-a')
    await app.settle()
    expect(oled(app, 'layers')).toBe('PIANO A:GRAND<  B:GRAND')
    press(app, 'fx-focus-piano')
    expect(step(app, 'fx-focus-piano')).toBe('Layer B')
    expect(oled(app, 'notice')).toBe('> FX FOCUS PIANO B')
    // The Piano panel still edits Layer A…
    expect(oled(app, 'layers')).toBe('PIANO A:GRAND<  B:GRAND')
    press(app, 'piano-unison')
    expect(kernelOf(app).getState().layers.map((layer) => layer.unison)).toEqual([1, 0])
    // …while the effect panel edits Layer B.
    press(app, 'fx-mod2-on')
    expect(chains(app).map((chain) => chain.mod2.on)).toEqual([false, true])
    press(app, 'fx-focus-piano')
    expect(step(app, 'fx-focus-piano')).toBe('Layer A')
    expect(app.control('fx-mod2-on')).toHaveAttribute('aria-pressed', 'false')
    // The yellow FX FOCUS LED by the Piano's On button shows which section the effects belong to.
    expect(led(app, 'piano-fx-focus')).toBe('on')
  })

  it('an effect on the focused layer is heard on that layer only', async () => {
    const play = async (layerWithReverb: 'a' | 'b' | null) => {
      const app = mountApp()
      await start(app)
      press(app, 'piano-layer-b')
      press(app, 'piano-type')
      press(app, 'piano-type')
      await app.settle()
      keys(app, 'piano-layer-b-level', 'End')
      if (layerWithReverb) {
        // Layer B has the focus after being switched on; a press on Layer A moves it there.
        if (layerWithReverb === 'a') press(app, 'piano-layer-a')
        press(app, 'fx-reverb-on')
        keys(app, 'fx-reverb-mix', 'End')
      }
      // Solo one layer with the faders to hear whose signal is wet.
      const solo = (layer: 'a' | 'b') => {
        keys(app, 'piano-layer-a-level', layer === 'a' ? 'End' : 'Home')
        keys(app, 'piano-layer-b-level', layer === 'b' ? 'End' : 'Home')
        down(app, 60)
        const out = mono(render(app, 0.5))
        up(app, 60)
        act(() => kernelOf(app).allNotesOff())
        render(app, 0.5)
        return out
      }
      const heard = { a: solo('a'), b: solo('b') }
      app.unmount()
      return heard
    }
    const none = await play(null)
    const onA = await play('a')
    const onB = await play('b')
    expect(difference(none.a, onA.a)).toBeGreaterThan(0.3)
    expect(difference(none.b, onA.b)).toBe(0)
    expect(difference(none.b, onB.b)).toBeGreaterThan(0.3)
    expect(difference(none.a, onB.a)).toBe(0)
  })
})

describe('effects.routing: Group', () => {
  it('Shift + FX Focus Piano groups the two layers: the focused chain is copied, and edits reach both', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'fx-mod2-on')
    press(app, 'fx-mod2-type') // Chorus → Vibe
    keys(app, 'fx-mod2-amount', 'End')
    expect(chains(app).map((chain) => [chain.mod2.on, chain.mod2.type, chain.mod2.amount])).toEqual([
      [true, 3, 1],
      [false, 2, 0.3],
    ])

    shiftPress(app, 'fx-focus-piano')
    expect(step(app, 'fx-focus-piano')).toBe('Group A B')
    expect([led(app, 'fx-focus-piano-a'), led(app, 'fx-focus-piano-b')]).toEqual(['on', 'on'])
    expect(oled(app, 'notice')).toBe('> PIANO FX GROUP ON')
    // Entering the group applied Layer A's settings to Layer B.
    expect(chains(app)[1]).toEqual(chains(app)[0])

    // Every kind of edit now lands on both chains.
    press(app, 'fx-reverb-on')
    press(app, 'fx-amp-type')
    keys(app, 'fx-delay-feedback', 'Home')
    keys(app, 'fx-eq-bass', 'Home')
    const [a, b] = chains(app)
    expect(b).toEqual(a)
    expect(a.reverb.on).toBe(true)
    expect(a.amp.type).toBe(AmpType.JC)
    expect(a.delay.feedback).toBe(0)
    expect(a.amp.bass).toBe(-15)

    // Leaving the group: both layers keep the shared settings until one is changed by hand.
    shiftPress(app, 'fx-focus-piano')
    expect(step(app, 'fx-focus-piano')).toBe('Layer A')
    expect(chains(app)[1]).toEqual(chains(app)[0])
    press(app, 'fx-reverb-on')
    expect(chains(app).map((chain) => chain.reverb.on)).toEqual([false, true])
  })

  it('a grouped effect is heard on both layers', async () => {
    const play = async (group: boolean) => {
      const app = mountApp()
      await start(app)
      press(app, 'piano-layer-b')
      press(app, 'piano-layer-a')
      await app.settle()
      keys(app, 'piano-layer-a-level', 'Home')
      keys(app, 'piano-layer-b-level', 'End')
      if (group) shiftPress(app, 'fx-focus-piano')
      press(app, 'fx-reverb-on')
      keys(app, 'fx-reverb-mix', 'End')
      // Only Layer B is audible; the reverb was switched on with Layer A in focus.
      down(app, 60)
      return mono(render(app, 0.5))
    }
    const separate = await play(false)
    const grouped = await play(true)
    expect(rms(separate)).toBeGreaterThan(0.003)
    expect(difference(separate, grouped)).toBeGreaterThan(0.3)
  })
})

describe('effects.routing: Global', () => {
  it('Shift + On makes Delay, Compressor, or Reverb global: one setting for every layer', async () => {
    const app = mountApp()
    await start(app)
    for (const [unit, id] of [['delay', 'fx-delay-on'], ['comp', 'fx-comp-on'], ['reverb', 'fx-reverb-on']] as const) {
      expect(led(app, `fx-${unit}-global`)).toBe('off')
      press(app, id)
      expect(chains(app).map((chain) => chain[unit].on), unit).toEqual([true, false])
      shiftPress(app, id)
      expect(led(app, `fx-${unit}-global`), unit).toBe('on')
      // Shift + On is the Global switch, not the On switch: the unit is still on, now everywhere.
      expect(chains(app).map((chain) => chain[unit].on), unit).toEqual([true, true])
      expect(chains(app)[1][unit]).toEqual(chains(app)[0][unit])
    }
    // Global edits reach both layers; non-global units stay per layer.
    keys(app, 'fx-reverb-mix', 'Home')
    keys(app, 'fx-comp-amount', 'End')
    keys(app, 'fx-delay-feedback', 'Home')
    press(app, 'fx-reverb-type')
    press(app, 'fx-mod1-on')
    const [a, b] = chains(app)
    expect([a.reverb, a.comp, a.delay]).toEqual([b.reverb, b.comp, b.delay])
    expect(a.reverb.mix).toBe(0)
    expect(a.comp.amount).toBe(1)
    expect([a.mod1.on, b.mod1.on]).toEqual([true, false])

    // Switch the global reverb off from Layer B's focus: it goes off for both.
    press(app, 'fx-focus-piano')
    expect(app.control('fx-reverb-on')).toHaveAttribute('aria-pressed', 'true')
    press(app, 'fx-reverb-on')
    expect(chains(app).map((chain) => chain.reverb.on)).toEqual([false, false])

    // Leaving Global: settings stay shared until changed, then diverge.
    shiftPress(app, 'fx-reverb-on')
    expect(led(app, 'fx-reverb-global')).toBe('off')
    expect(oled(app, 'notice')).toBe('> REVERB GLOBAL OFF')
    press(app, 'fx-reverb-on')
    expect(chains(app).map((chain) => chain.reverb.on)).toEqual([false, true])
    // Delay and Compressor are still global.
    expect([led(app, 'fx-delay-global'), led(app, 'fx-comp-global')]).toEqual(['on', 'on'])
  })

  it('a global reverb is heard on a layer it was never switched on for', async () => {
    const play = async (global: boolean) => {
      const app = mountApp()
      await start(app)
      press(app, 'piano-layer-b')
      press(app, 'piano-layer-a')
      await app.settle()
      keys(app, 'piano-layer-a-level', 'Home')
      keys(app, 'piano-layer-b-level', 'End')
      press(app, 'fx-reverb-on')
      keys(app, 'fx-reverb-mix', 'End')
      if (global) shiftPress(app, 'fx-reverb-on')
      down(app, 60)
      return mono(render(app, 0.5))
    }
    expect(difference(await play(false), await play(true))).toBeGreaterThan(0.3)
  })
})

describe('effects.routing: dry / wet', () => {
  it('Delay Dry/Wet at minimum is the dry signal exactly; at maximum the direct sound is gone', async () => {
    const dry = await chord()
    const zero = await chord((app) => {
      press(app, 'fx-delay-on')
      keys(app, 'fx-delay-mix', 'Home')
    })
    render(dry.app, 0.2)
    render(zero.app, 0.2)
    const a = render(dry.app, 0.3)
    const b = render(zero.app, 0.3)
    expect(equal(a.left, b.left)).toBe(true)

    const full = await chord((app) => {
      press(app, 'fx-delay-on')
      keys(app, 'fx-delay-mix', 'End')
      keys(app, 'fx-delay-tempo', 'End')
    })
    // Fully wet with a 1.5 s delay: after the switch-on fade, silence until the first repeat.
    expect(rmsAt(mono(full.out), 0.1, 0.6)).toBeLessThan(rmsAt(mono(dry.out), 0.1, 0.6) * 0.01)
    const later = mono(render(full.app, 1.2))
    expect(rmsAt(later, 0.7, 0.4)).toBeGreaterThan(0.003)
  })

  it('Reverb Dry/Wet runs from dry to fully wet', async () => {
    const dry = await chord()
    const none = await chord((app) => {
      press(app, 'fx-reverb-on')
      keys(app, 'fx-reverb-mix', 'Home')
    })
    render(dry.app, 0.2)
    render(none.app, 0.2)
    expect(difference(render(dry.app, 0.3).left, render(none.app, 0.3).left)).toBeLessThan(1e-6)

    const levels: number[] = []
    for (const position of ['Home', 'PageUp', 'End']) {
      const { app } = await chord((panel) => {
        press(panel, 'fx-reverb-on')
        keys(panel, 'fx-reverb-mix', 'Home', ...(position === 'Home' ? [] : [position]))
      }, 0.3)
      for (const note of [55, 60, 64]) up(app, note)
      render(app, 1)
      // What is left a second after the keys came up is reverb.
      levels.push(rms(render(app, 0.3).left))
      app.unmount()
    }
    expect(levels[0]).toBe(0)
    expect(levels[1]).toBeGreaterThan(1e-5)
    expect(levels[2]).toBeGreaterThan(levels[1] * 2)
  })
})

describe('effects.routing: Delay feedback path and tempo', () => {
  it('the Filter button steps Off → LP → BP → HP and its LEDs follow', async () => {
    const app = mountApp()
    await start(app)
    expect(step(app, 'fx-delay-filter')).toBe('LP')
    expect([led(app, 'fx-delay-filter-lp'), led(app, 'fx-delay-filter-hp')]).toEqual(['on', 'off'])
    press(app, 'fx-delay-filter')
    expect(step(app, 'fx-delay-filter')).toBe('BP')
    expect([led(app, 'fx-delay-filter-lp'), led(app, 'fx-delay-filter-hp')]).toEqual(['on', 'on'])
    expect(chains(app)[0].delay.filter).toBe(DelayFilter.BP)
    press(app, 'fx-delay-filter')
    expect(step(app, 'fx-delay-filter')).toBe('HP')
    press(app, 'fx-delay-filter')
    expect(step(app, 'fx-delay-filter')).toBe('Off')
    expect(chains(app)[0].delay.filter).toBe(DelayFilter.Off)
  })

  it('the filter works on the repeats, each one more than the last, and never on the dry signal', async () => {
    const staccato = async (filterPresses: number) => {
      const app = mountApp()
      await start(app)
      press(app, 'fx-delay-on')
      keys(app, 'fx-delay-tempo', 'Home', 'PageUp', 'PageUp', 'PageUp') // 6 of 10: about 270 ms
      keys(app, 'fx-delay-feedback', 'End')
      keys(app, 'fx-delay-mix', 'Home', 'PageUp', 'PageUp') // 4 of 10
      for (let presses = 0; presses < filterPresses; presses += 1) press(app, 'fx-delay-filter')
      const time = chains(app)[0].delay.time
      render(app, 0.1)
      down(app, 72)
      render(app, 0.06)
      up(app, 72)
      const out = mono(render(app, time * 5 + 0.3))
      return { out, time, app }
    }
    const lp = await staccato(0)
    expect(step(lp.app, 'fx-delay-filter')).toBe('LP')
    const off = await staccato(3)
    expect(step(off.app, 'fx-delay-filter')).toBe('Off')
    const hp = await staccato(2)
    expect(step(hp.app, 'fx-delay-filter')).toBe('HP')

    // Before the first repeat arrives the three are identical: the dry path is not filtered.
    const head = Math.round((lp.time - 0.07) * SR)
    expect(equal(lp.out.subarray(0, head), off.out.subarray(0, head))).toBe(true)
    expect(equal(hp.out.subarray(0, head), off.out.subarray(0, head))).toBe(true)

    // Brightness of each successive repeat (treble relative to the fundamental region).
    const tilt = (out: Float32Array, time: number, repeat: number) => {
      const from = Math.round((repeat * time - 0.06) * SR)
      const window = out.subarray(from, from + Math.round(0.2 * SR))
      return bandLevel(window, 2000, 6000) / bandLevel(window, 450, 600)
    }
    const lowpassed = [1, 2, 3, 4].map((repeat) => tilt(lp.out, lp.time, repeat))
    for (let k = 1; k < lowpassed.length; k += 1) expect(lowpassed[k], `LP repeat ${k + 1}`).toBeLessThan(lowpassed[k - 1] * 0.8)
    const highpassed = [1, 2, 3, 4].map((repeat) => tilt(hp.out, hp.time, repeat))
    for (let k = 1; k < highpassed.length; k += 1) expect(highpassed[k], `HP repeat ${k + 1}`).toBeGreaterThan(highpassed[k - 1] * 1.2)
    // With the filter off the repeats keep their colour.
    const plain = [1, 2, 3, 4].map((repeat) => tilt(off.out, off.time, repeat))
    expect(plain[3] / plain[0]).toBeGreaterThan(0.7)
    expect(plain[3] / plain[0]).toBeLessThan(1.4)
  })

  it('the Tempo knob and Tap agree: both set the same delay time, shown in milliseconds', async () => {
    const app = mountApp()
    await start(app)
    expect(chains(app)[0].delay.time).toBeCloseTo(delayKnobToSeconds(0.3), 9)
    expect(app.control('fx-delay-tempo')).toHaveAttribute('aria-description', `${Math.round(delayKnobToSeconds(0.3) * 1000)} ms`)

    // Two taps half a second apart.
    press(app, 'fx-delay-tap')
    expect(oled(app, 'notice')).toMatch(/TAP AGAIN/)
    app.fake.timing.advance(500)
    press(app, 'fx-delay-tap')
    expect(chains(app)[0].delay.time).toBeCloseTo(0.5, 9)
    expect(oled(app, 'notice')).toBe('> DELAY TAP 500 MS (120 BPM)')
    expect(app.control('fx-delay-tempo')).toHaveAttribute('aria-description', '500 ms')
    // The knob moved to the position that means 500 ms (to the knob's own resolution).
    expect(value(app, 'fx-delay-tempo')).toBeCloseTo(delaySecondsToKnob(0.5) * 10, 1)
    expect(delayKnobToSeconds(value(app, 'fx-delay-tempo') / 10)).toBeGreaterThan(0.48)
    expect(delayKnobToSeconds(value(app, 'fx-delay-tempo') / 10)).toBeLessThan(0.52)

    // A third tap a quarter of a second later halves the time.
    app.fake.timing.advance(250)
    press(app, 'fx-delay-tap')
    expect(chains(app)[0].delay.time).toBeCloseTo(0.25, 9)
    // The echo really arrives a quarter of a second after the note.
    press(app, 'fx-delay-on')
    keys(app, 'fx-delay-mix', 'End')
    keys(app, 'fx-delay-feedback', 'Home')
    render(app, 0.1)
    down(app, 84)
    render(app, 0.03)
    up(app, 84)
    const env = envelope(mono(render(app, 0.6)), 0.01)
    const loudest = env.indexOf(Math.max(...env))
    expect((loudest * 0.01 + 0.03)).toBeGreaterThan(0.2)
    expect((loudest * 0.01 + 0.03)).toBeLessThan(0.32)

    // Turning the knob takes over again; a tap long after the last one starts afresh.
    keys(app, 'fx-delay-tempo', 'End')
    expect(chains(app)[0].delay.time).toBeCloseTo(1.5, 9)
    app.fake.timing.advance(5000)
    press(app, 'fx-delay-tap')
    expect(chains(app)[0].delay.time).toBeCloseTo(1.5, 9)
    expect(app.fake.timing.pendingTimers).toBe(0)
  })

  it('Shift + Filter is Ping Pong: its LED lights and repeats alternate sides', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'fx-delay-on')
    keys(app, 'fx-delay-tempo', 'Home', 'PageUp', 'PageUp', 'PageUp')
    keys(app, 'fx-delay-mix', 'End')
    keys(app, 'fx-delay-feedback', 'End')
    shiftPress(app, 'fx-delay-filter')
    expect(led(app, 'fx-delay-ping-pong')).toBe('on')
    expect(step(app, 'fx-delay-filter')).toBe('LP')
    expect(chains(app)[0].delay.pingPong).toBe(true)
    const time = chains(app)[0].delay.time
    render(app, 0.1)
    down(app, 72)
    render(app, 0.05)
    up(app, 72)
    const out = render(app, time * 3 + 0.3)
    const side = (repeat: number) => {
      const from = Math.round((repeat * time - 0.05) * SR)
      const to = from + Math.round(0.15 * SR)
      return rms(out.left, from, to) - rms(out.right, from, to)
    }
    expect(side(1)).toBeGreaterThan(0)
    expect(side(2)).toBeLessThan(0)
    shiftPress(app, 'fx-delay-filter')
    expect(led(app, 'fx-delay-ping-pong')).toBe('off')
  })
})

describe('effects.routing: Compressor extras', () => {
  it('Shift + Amount switches Fast without moving the amount; ACTIVE lights while it is compressing', async () => {
    const app = mountApp()
    await start(app)
    press(app, 'fx-comp-on')
    keys(app, 'fx-comp-amount', 'End', 'PageDown')
    expect(value(app, 'fx-comp-amount')).toBe(8)
    expect(led(app, 'fx-comp-fast')).toBe('off')
    // Hold Shift (the computer key) and turn the knob: anticlockwise is off, clockwise is on.
    act(() => void app.fake.events.key('down', 'ShiftLeft'))
    keys(app, 'fx-comp-amount', 'ArrowDown')
    expect(led(app, 'fx-comp-fast')).toBe('off')
    keys(app, 'fx-comp-amount', 'ArrowUp')
    act(() => void app.fake.events.key('up', 'ShiftLeft'))
    expect(led(app, 'fx-comp-fast')).toBe('on')
    expect(oled(app, 'notice')).toBe('> COMPRESSOR FAST ON')
    // The knob did not move: with Shift held it was the Fast switch.
    expect(value(app, 'fx-comp-amount')).toBe(8)
    expect(chains(app)[0].comp).toEqual({ on: true, amount: 0.8, fast: true })

    expect(led(app, 'fx-comp-active')).toBe('off')
    for (const note of [48, 55, 60, 64, 67]) down(app, note)
    render(app, 0.3)
    expect(led(app, 'fx-comp-active')).toBe('on')
    for (const note of [48, 55, 60, 64, 67]) up(app, note)
    render(app, 3)
    expect(led(app, 'fx-comp-active')).toBe('off')
  })
})

describe('effects.routing: To Rotary', () => {
  it('the Amp selector reaches To Rotary; with the unit on, the layer is routed and the Rotary ON LED lights', async () => {
    const dry = await chord()
    const { app, out } = await chord((panel) => {
      expect(step(panel, 'fx-amp-type')).toBe('Twin')
      for (let presses = 0; presses < 3; presses += 1) press(panel, 'fx-amp-type')
      expect(step(panel, 'fx-amp-type')).toBe('To Rotary')
      expect(led(panel, 'fx-amp-type-to-rotary')).toBe('on')
      // Selected but the unit is off: not routed yet.
      expect(led(panel, 'rotary-on')).toBe('off')
      press(panel, 'fx-amp-on')
      expect(led(panel, 'rotary-on')).toBe('on')
    })
    expect(chains(app)[0].amp).toMatchObject({ on: true, type: AmpType.ToRotary })
    expect(difference(dry.out.left, out.left)).toBeGreaterThan(0.2)
    // Spinning: the two sides swap level.
    const settled = render(app, 2)
    const left = envelope(settled.left, 0.02)
    const right = envelope(settled.right, 0.02)
    const balance = left.map((v, i) => (v - right[i]) / (v + right[i] + 1e-12))
    expect(Math.max(...balance) - Math.min(...balance)).toBeGreaterThan(0.3)

    // Unrouting: unit off, or all effects off, or another amp type.
    press(app, 'fx-on')
    expect(led(app, 'rotary-on')).toBe('off')
    press(app, 'fx-on')
    expect(led(app, 'rotary-on')).toBe('on')
    press(app, 'fx-amp-type')
    expect(step(app, 'fx-amp-type')).toBe('LP Filter')
    expect(led(app, 'rotary-on')).toBe('off')
  })

  it('the Rotary controls are live: Slow/Fast, Stop Mode, and Drive reach the one shared rotor', async () => {
    const app = mountApp()
    await start(app)
    for (let presses = 0; presses < 3; presses += 1) press(app, 'fx-amp-type')
    press(app, 'fx-amp-on')
    expect(step(app, 'rotary-speed')).toBe('Slow/Stop')
    expect([led(app, 'rotary-speed-slow'), led(app, 'rotary-speed-fast')]).toEqual(['on', 'off'])
    render(app, 1)
    const slow = kernelOf(app).rotorSpeed.horn
    expect(slow).toBeGreaterThan(0.5)
    expect(slow).toBeLessThan(1.2)

    press(app, 'rotary-speed')
    expect(step(app, 'rotary-speed')).toBe('Fast')
    expect([led(app, 'rotary-speed-slow'), led(app, 'rotary-speed-fast')]).toEqual(['off', 'on'])
    render(app, 0.3)
    const accelerating = kernelOf(app).rotorSpeed.horn
    render(app, 4)
    const fast = kernelOf(app).rotorSpeed.horn
    expect(accelerating).toBeGreaterThan(slow)
    expect(accelerating).toBeLessThan(fast)
    expect(fast).toBeGreaterThan(6)

    press(app, 'rotary-stop-mode')
    expect(app.control('rotary-stop-mode')).toHaveAttribute('aria-pressed', 'true')
    press(app, 'rotary-speed')
    expect(oled(app, 'notice')).toBe('> ROTARY STOP')
    render(app, 12)
    expect(kernelOf(app).rotorSpeed.horn).toBeLessThan(0.01)

    keys(app, 'rotary-drive', 'End')
    expect(kernelOf(app).getState().rotary).toEqual({ fast: false, stop: true, drive: 1 })
  })

  it('both layers share that rotor, and other units still come before it', async () => {
    const one = async (layer: number) => {
      const kernel = await makeStage((sound) => {
        for (const item of sound.layers) {
          item.on = true
          selectType(item, 'Misc')
          item.fx.amp = { on: true, type: AmpType.ToRotary, drive: 0, bass: 0, mid: 0, freq: 0.5, treble: 0 }
        }
        sound.layers[0].level = layer === 0 ? 1 : 0
        sound.layers[1].level = layer === 1 ? 1 : 0
        sound.rotary.fast = true
      })
      renderStage(kernel, 3)
      kernel.noteOn(72, 0.8)
      return renderStage(kernel, 1.5)
    }
    const a = await one(0)
    const b = await one(1)
    // Same instrument on both layers through the same rotor: the same motion, in step.
    expect(rms(a.left)).toBeGreaterThan(0.003)
    expect(difference(a.left, b.left)).toBeLessThan(1e-6)

    // A tremolo ahead of the Rotary is still heard through it.
    const withTrem = await makeStage((sound) => {
      selectType(sound.layers[0], 'Misc')
      fx(sound).amp = { on: true, type: AmpType.ToRotary, drive: 0, bass: 0, mid: 0, freq: 0.5, treble: 0 }
      fx(sound).mod1 = { on: true, type: 1, rate: 0.8, amount: 1 }
    })
    const without = await makeStage((sound) => {
      selectType(sound.layers[0], 'Misc')
      fx(sound).amp = { on: true, type: AmpType.ToRotary, drive: 0, bass: 0, mid: 0, freq: 0.5, treble: 0 }
    })
    for (const kernel of [withTrem, without]) kernel.noteOn(72, 0.8)
    expect(difference(mono(renderStage(without, 1)), mono(renderStage(withTrem, 1)))).toBeGreaterThan(0.2)
  })
})

describe('effects.routing: what stays decorative', () => {
  it('the excluded and later-phase controls in these sections move but send nothing to the audio host', async () => {
    const app = mountApp()
    await start(app)
    const sent = app.fake.audio.node.received.length
    const before = JSON.stringify(kernelOf(app).getState())
    for (const id of Object.keys(UNSUPPORTED_IN_FUNCTIONAL_SECTIONS)) {
      const element = app.control(id)
      expect(element, id).toHaveAttribute('data-decorative', 'true')
      if (element.tagName === 'BUTTON') {
        press(app, id)
        expect(element).toHaveAttribute('data-presses', '1')
      } else {
        keys(app, id, 'End')
        expect(value(app, id)).toBeGreaterThan(0)
      }
    }
    expect(app.fake.audio.node.received).toHaveLength(sent)
    expect(JSON.stringify(kernelOf(app).getState())).toBe(before)
  })

  it('Shift combinations for excluded features report that and change nothing', async () => {
    const app = mountApp()
    await start(app)
    const before = JSON.stringify(kernelOf(app).getState())
    const cases: Array<[string, RegExp]> = [
      ['fx-mod1-type', /VARIATIONS ARE NOT AVAILABLE/],
      ['fx-mod2-type', /VARIATIONS ARE NOT AVAILABLE/],
      ['fx-reverb-type', /VARIATIONS ARE NOT AVAILABLE/],
      ['fx-delay-tap', /ANALOG DELAY MODE IS NOT AVAILABLE/],
      ['rotary-stop-mode', /ROTARY STOP ANGLE IS NOT AVAILABLE/],
      ['piano-type', /PIANO INFO IS NOT AVAILABLE/],
    ]
    for (const [id, notice] of cases) {
      const label = step(app, id)
      shiftPress(app, id)
      expect(oled(app, 'notice'), id).toMatch(notice)
      expect(step(app, id), id).toBe(label)
    }
    expect(JSON.stringify(kernelOf(app).getState())).toBe(before)
    // Excluded indicator LEDs are never lit.
    for (const slug of ['fx-mod1-variation', 'fx-mod2-variation', 'fx-amp-variation', 'fx-delay-variation', 'fx-reverb-chorale', 'fx-delay-analog', 'fx-mod1-mst-clk', 'fx-delay-mst-clk', 'rotary-close-mic']) {
      expect(led(app, slug), slug).toBe('off')
    }
    expect(peak(render(app, 0.1).left)).toBe(0)
  })
})

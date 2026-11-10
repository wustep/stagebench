import { describe, expect, it } from 'vitest'
import { KbTouch, Timbre, masterGain } from '../src/audio/dsp/params'
import { KB_TOUCHES, TIMBRES } from '../src/state/model'
import { mountApp } from './support/app'
import { bandLevel, db } from './support/fxbench'
import { down, kernelOf, keys, led, oled, press, render, start, step, up, value } from './support/panel'
import { SR, brightness, magnitudeAt, mono, peak, rms, rmsAt, timeToSilence } from './support/signal'
import { correlation, difference, makeStage, renderStage, selectType } from './support/stage'
import type { LayerSound } from '../src/audio/dsp/params'
import type { PianoTypeName } from '../src/piano/catalog'

/**
 * Feature: piano.velocity-controls
 * KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, and Master Level measurably
 * alter rendered audio.
 *
 * Each control is proven twice: on the kernel, where the audible relationship is measured, and
 * from the panel, where the button or knob must reach that same kernel state and show it.
 */

async function strike(
  configure: (layer: LayerSound) => void,
  options: { note?: number; velocity?: number; seconds?: number; type?: PianoTypeName } = {},
) {
  const kernel = await makeStage((sound) => {
    selectType(sound.layers[0], options.type ?? 'Grand')
    sound.layers[0].stringRes = false
    configure(sound.layers[0])
  })
  kernel.noteOn(options.note ?? 60, options.velocity ?? 0.6)
  const stereo = renderStage(kernel, options.seconds ?? 0.5)
  return { kernel, stereo, out: mono(stereo) }
}

describe('piano.velocity-controls: KB Touch', () => {
  it('Light is louder than Medium, and Medium louder than Heavy, for the same moderate strike', async () => {
    const level = async (touch: number, velocity: number) => rms((await strike((layer) => void (layer.kbTouch = touch), { velocity })).out)
    for (const velocity of [0.3, 0.5, 0.7]) {
      const heavy = await level(KbTouch.Heavy, velocity)
      const medium = await level(KbTouch.Medium, velocity)
      const light = await level(KbTouch.Light, velocity)
      expect(medium, `velocity ${velocity}`).toBeGreaterThan(heavy * 1.25)
      expect(light, `velocity ${velocity}`).toBeGreaterThan(medium * 1.25)
    }
    // The hardest possible strike is the same in every setting: only the curve changes.
    const top = await Promise.all([KbTouch.Heavy, KbTouch.Medium, KbTouch.Light].map((touch) => level(touch, 1)))
    expect(top[0]).toBeCloseTo(top[1], 5)
    expect(top[2]).toBeCloseTo(top[1], 5)
  })

  it('changes timbre response too: a light touch reaches the harder recordings sooner', async () => {
    // At this velocity Heavy stays on the soft recording while Light reaches the medium one.
    const heavy = (await strike((layer) => void (layer.kbTouch = KbTouch.Heavy), { velocity: 0.45 })).out
    const light = (await strike((layer) => void (layer.kbTouch = KbTouch.Light), { velocity: 0.45 })).out
    expect(brightness(light)).toBeGreaterThan(brightness(heavy) * 1.15)
    expect(correlation(light, heavy)).toBeLessThan(0.995)
  })

  it('the KB Touch button steps Medium → Light → Heavy, lights the right LEDs, and changes the sound', async () => {
    const app = mountApp()
    await start(app)
    expect([...KB_TOUCHES]).toEqual(['Medium', 'Light', 'Heavy'])
    const heard: number[] = []
    for (const expected of ['Medium', 'Light', 'Heavy']) {
      expect(step(app, 'piano-kb-touch')).toBe(expected)
      expect(kernelOf(app).getState().layers[0].kbTouch).toBe(KB_TOUCHES.indexOf(expected as 'Medium'))
      down(app, 60)
      heard.push(rms(render(app, 0.3).left))
      up(app, 60)
      render(app, 1.5)
      press(app, 'piano-kb-touch')
    }
    expect(step(app, 'piano-kb-touch')).toBe('Medium')
    // Medium lights MED, Heavy lights HEAVY, Light lights both (as printed on the panel).
    expect([led(app, 'piano-kb-touch-med'), led(app, 'piano-kb-touch-heavy')]).toEqual(['on', 'off'])
    const [medium, light, heavy] = heard
    expect(light).toBeGreaterThan(medium * 1.15)
    expect(medium).toBeGreaterThan(heavy * 1.15)
  })
})

describe('piano.velocity-controls: Dyn Comp', () => {
  it('raises soft strikes more with each level and leaves the hardest strike alone', async () => {
    const level = async (dynComp: number, velocity: number) => rms((await strike((layer) => void (layer.dynComp = dynComp), { velocity })).out)
    const soft = await Promise.all([0, 1, 2, 3].map((dynComp) => level(dynComp, 0.2)))
    for (let k = 1; k < 4; k += 1) expect(soft[k], `level ${k}`).toBeGreaterThan(soft[k - 1] * 1.4)
    const hard = await Promise.all([0, 1, 2, 3].map((dynComp) => level(dynComp, 1)))
    for (let k = 1; k < 4; k += 1) expect(hard[k]).toBeCloseTo(hard[0], 5)
    // So the dynamic range narrows.
    const range = (k: number) => db(hard[k] / soft[k])
    expect(range(0)).toBeGreaterThan(20)
    expect(range(3)).toBeLessThan(range(0) / 2)
    expect(range(3)).toBeLessThan(range(2))
    expect(range(2)).toBeLessThan(range(1))
  })

  it('does not change the timbre response: only the level of the note moves', async () => {
    for (const velocity of [0.2, 0.5]) {
      const plain = (await strike((layer) => void (layer.dynComp = 0), { velocity })).out
      const squeezed = (await strike((layer) => void (layer.dynComp = 3), { velocity })).out
      // Same recording, same shape, different gain.
      expect(correlation(plain, squeezed)).toBeGreaterThan(0.9999)
      expect(brightness(squeezed)).toBeCloseTo(brightness(plain), 5)
      expect(rms(squeezed)).toBeGreaterThan(rms(plain) * 1.5)
    }
  })

  it('the Dyn Comp button steps Off → 1 → 2 → 3 with its LEDs, and soft playing gets louder', async () => {
    const app = mountApp()
    await start(app)
    const kernel = kernelOf(app)
    const soft = () => {
      kernel.noteOn(60, 0.2)
      const out = rms(render(app, 0.3).left)
      kernel.allNotesOff()
      render(app, 0.5)
      return out
    }
    const levels: number[] = []
    for (const expected of ['Off', '1', '2', '3']) {
      expect(step(app, 'piano-dyn-comp')).toBe(expected)
      levels.push(soft())
      press(app, 'piano-dyn-comp')
    }
    expect(step(app, 'piano-dyn-comp')).toBe('Off')
    for (let k = 1; k < 4; k += 1) expect(levels[k]).toBeGreaterThan(levels[k - 1] * 1.3)
    press(app, 'piano-dyn-comp')
    press(app, 'piano-dyn-comp')
    press(app, 'piano-dyn-comp')
    // 3 lights both LEDs.
    expect([led(app, 'piano-dyn-comp-1'), led(app, 'piano-dyn-comp-2')]).toEqual(['on', 'on'])
    expect(oled(app, 'notice')).toBe('> DYN COMP 3')
  })
})

describe('piano.velocity-controls: Timbre', () => {
  const balance = (out: Float32Array) => ({
    // The fundamentals of the two lowest notes of the chord (C2, C3).
    low: magnitudeAt(out, 65.406) + magnitudeAt(out, 130.813),
    mid: bandLevel(out, 900, 1800),
    high: bandLevel(out, 4000, 9000),
  })
  async function timbre(type: PianoTypeName, setting: number) {
    // A chord across the keyboard, so every band has something in it.
    const kernel = await makeStage((sound) => {
      selectType(sound.layers[0], type)
      sound.layers[0].stringRes = false
      sound.layers[0].timbre = setting
    })
    for (const note of [36, 48, 60, 72, 84]) kernel.noteOn(note, 0.9)
    return mono(renderStage(kernel, 0.6))
  }

  it('acoustic: Soft damps the highs, Mid pushes the mid-range forward, Bright lifts the treble', async () => {
    const off = balance(await timbre('Grand', Timbre.Off))
    const soft = balance(await timbre('Grand', Timbre.Soft))
    const mid = balance(await timbre('Grand', Timbre.Mid))
    const bright = balance(await timbre('Grand', Timbre.Bright))
    expect(db(soft.high / off.high)).toBeLessThan(-5)
    expect(db(soft.low / off.low)).toBeGreaterThan(0.5)
    expect(db(mid.mid / off.mid)).toBeGreaterThan(3)
    expect(db(mid.high / off.high)).toBeLessThan(-1)
    expect(db(mid.low / off.low)).toBeLessThan(-1)
    expect(db(bright.high / off.high)).toBeGreaterThan(5)
    expect(Math.abs(db(bright.low / off.low))).toBeLessThan(1)
  })

  it('electric: adds Dyno 1 and Dyno 2, which push the bell; Dyno 2 also lifts the bass and scoops the mids', async () => {
    const bell = (out: Float32Array) => bandLevel(out, 2400, 3600)
    const off = await timbre('Electric', Timbre.Off)
    const dyno1 = await timbre('Electric', Timbre.Dyno1)
    const dyno2 = await timbre('Electric', Timbre.Dyno2)
    expect(db(bell(dyno1) / bell(off))).toBeGreaterThan(6)
    expect(db(bell(dyno2) / bell(off))).toBeGreaterThan(6)
    expect(db(balance(dyno2).low / balance(dyno1).low)).toBeGreaterThan(5)
    expect(db(bandLevel(dyno2, 400, 600) / bandLevel(off, 400, 600))).toBeLessThan(-2)
    // All six electric settings differ from one another.
    const all = await Promise.all(TIMBRES.map((_, setting) => timbre('Electric', setting)))
    for (let a = 0; a < all.length; a += 1) {
      for (let b = a + 1; b < all.length; b += 1) expect(difference(all[a], all[b]), `${TIMBRES[a]} vs ${TIMBRES[b]}`).toBeGreaterThan(0.08)
    }
  })

  it('Off is exactly transparent', async () => {
    const kernel = await makeStage((sound) => void (sound.layers[0].stringRes = false))
    kernel.noteOn(60, 0.8)
    const a = mono(renderStage(kernel, 0.3))
    const again = (await strike(() => undefined, { velocity: 0.8, seconds: 0.3 })).out
    expect(difference(a, again)).toBe(0)
  })

  it('the Timbre button offers four settings on an acoustic piano and six on an electric one', async () => {
    const app = mountApp()
    await start(app)
    const cycle = () => {
      const seen: string[] = []
      do {
        seen.push(step(app, 'piano-timbre') ?? '')
        press(app, 'piano-timbre')
      } while (step(app, 'piano-timbre') !== 'Off')
      return seen
    }
    expect(cycle()).toEqual(['Off', 'Soft', 'Mid', 'Bright'])
    press(app, 'piano-type')
    press(app, 'piano-type')
    await app.settle()
    expect(step(app, 'piano-type')).toBe('Electric')
    expect(cycle()).toEqual(['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'])

    // Dyno 1 lights BRIGHT and MID together; it reaches the kernel as the electric curve.
    for (let presses = 0; presses < 4; presses += 1) press(app, 'piano-timbre')
    expect(step(app, 'piano-timbre')).toBe('Dyno 1')
    expect([led(app, 'piano-timbre-bright'), led(app, 'piano-timbre-mid'), led(app, 'piano-timbre-soft')]).toEqual(['on', 'on', 'off'])
    expect(kernelOf(app).getState().layers[0]).toMatchObject({ family: 'electric', timbre: Timbre.Dyno1 })
    // Going back to an acoustic type drops a setting that type does not have.
    for (let presses = 0; presses < 4; presses += 1) press(app, 'piano-type')
    expect(step(app, 'piano-type')).toBe('Grand')
    expect(step(app, 'piano-timbre')).toBe('Off')
  })

  it('pressing Timbre while a chord rings changes what is heard, without a click', async () => {
    const app = mountApp()
    await start(app)
    for (const note of [48, 60, 72]) down(app, note)
    render(app, 0.3)
    const before = mono(render(app, 0.2))
    press(app, 'piano-timbre')
    const switching = mono(render(app, 0.2))
    press(app, 'piano-timbre')
    press(app, 'piano-timbre')
    render(app, 0.1)
    const bright = mono(render(app, 0.2))
    expect(step(app, 'piano-timbre')).toBe('Bright')
    expect(brightness(bright)).toBeGreaterThan(brightness(before) * 1.5)
    const jump = (signal: Float32Array) => Math.max(...signal.map((sample, index) => (index ? Math.abs(sample - signal[index - 1]) : 0)))
    expect(jump(switching)).toBeLessThan(jump(before) * 2 + 0.01)
  })
})

describe('piano.velocity-controls: Unison', () => {
  it('Off is one centred voice; 1, 2, and 3 are detuned stereo voices of increasing width', async () => {
    const width = async (unison: number) => {
      const { stereo, kernel } = await strike((layer) => void (layer.unison = unison), { velocity: 0.8, seconds: 1.5, type: 'Electric' })
      const side = stereo.left.map((sample, index) => sample - stereo.right[index])
      const middle = stereo.left.map((sample, index) => sample + stereo.right[index])
      return { ratio: rms(side) / rms(middle), voices: kernel.voiceCount, stereo }
    }
    const off = await width(0)
    const one = await width(1)
    const two = await width(2)
    const three = await width(3)
    expect(off.voices).toBe(1)
    expect([one.voices, two.voices, three.voices]).toEqual([2, 2, 3])
    // A note at middle C sits almost in the centre without unison.
    expect(off.ratio).toBeLessThan(0.1)
    expect(one.ratio).toBeGreaterThan(off.ratio + 0.2)
    expect(two.ratio).toBeGreaterThan(one.ratio * 1.05)
    // Level stays comparable: unison widens, it does not just add volume.
    for (const setting of [one, two, three]) {
      expect(rms(mono(setting.stereo)) / rms(mono(off.stereo))).toBeGreaterThan(0.5)
      expect(rms(mono(setting.stereo)) / rms(mono(off.stereo))).toBeLessThan(1.6)
    }
  })

  it('detune grows from subtle to obvious: the beating gets faster', async () => {
    // Synthesized bar: a pure, steady tone, so beating between the unison voices is easy to read.
    const beatRate = async (unison: number) => {
      const { out } = await strike((layer) => void (layer.unison = unison), { type: 'Misc', velocity: 0.8, seconds: 3, note: 72 })
      const window = Math.round(SR * 0.01)
      const env: number[] = []
      for (let start = 0; start + window <= out.length; start += window) env.push(rms(out, start, start + window))
      // Count dips of the envelope relative to its smooth decay.
      let dips = 0
      for (let k = 2; k < env.length - 2; k += 1) {
        if (env[k] < env[k - 1] && env[k] <= env[k + 1] && env[k] < 0.7 * Math.max(env[k - 2], env[k + 2])) dips += 1
      }
      return dips / 3
    }
    const one = await beatRate(1)
    const two = await beatRate(2)
    const three = await beatRate(3)
    expect(await beatRate(0)).toBe(0)
    expect(two).toBeGreaterThan(one)
    expect(three).toBeGreaterThan(two)
    // ±4 cents at C5 beats about 2.4 times a second; ±17 cents about four times faster.
    expect(one).toBeGreaterThan(1)
    expect(one).toBeLessThan(4)
    expect(three).toBeGreaterThan(one * 2)
  })

  it('on a recorded piano the side voices borrow the neighbouring recordings', async () => {
    const { kernel } = await strike((layer) => void (layer.unison = 3), { velocity: 0.8 })
    const voices = kernel.describeVoices()
    expect(voices).toHaveLength(3)
    expect(voices.every((voice) => voice.sampled && voice.key === 60 && voice.note === 60)).toBe(true)
    kernel.noteOff(60)
    renderStage(kernel, 1.5)
    expect(kernel.voiceCount).toBe(0)
  })

  it('the Unison button steps Off → 1 → 2 → 3 with its LEDs and widens what is heard', async () => {
    const app = mountApp()
    await start(app)
    const widths: number[] = []
    for (const expected of ['Off', '1', '2', '3']) {
      expect(step(app, 'piano-unison')).toBe(expected)
      down(app, 60)
      const out = render(app, 0.6)
      const side = out.left.map((sample, index) => sample - out.right[index])
      widths.push(rms(side) / rms(mono(out)))
      up(app, 60)
      render(app, 1.5)
      expect(kernelOf(app).voiceCount).toBe(0)
      press(app, 'piano-unison')
    }
    expect(widths[1]).toBeGreaterThan(widths[0] + 0.2)
    expect(widths[3]).toBeGreaterThan(widths[0] + 0.2)
    press(app, 'piano-unison')
    expect([led(app, 'piano-unison-1'), led(app, 'piano-unison-2')]).toEqual(['on', 'off'])
  })
})

describe('piano.velocity-controls: Soft Release', () => {
  const tail = async (softRelease: boolean, type: PianoTypeName = 'Grand') => {
    const kernel = await makeStage((sound) => {
      selectType(sound.layers[0], type)
      sound.layers[0].stringRes = false
      sound.layers[0].softRelease = softRelease
    })
    kernel.noteOn(48, 0.8)
    renderStage(kernel, 0.3)
    kernel.noteOff(48)
    return mono(renderStage(kernel, 3))
  }

  it('makes the release longer and less abrupt', async () => {
    const normal = await tail(false)
    const soft = await tail(true)
    expect(peak(normal.subarray(SR)).valueOf()).toBe(0)
    const normalTime = timeToSilence(normal, 1e-3)
    const softTime = timeToSilence(soft, 1e-3)
    expect(normalTime).toBeGreaterThan(0.05)
    expect(softTime).toBeGreaterThan(normalTime * 1.8)
    expect(softTime).toBeLessThan(normalTime * 4)
    // "Slightly longer": it still ends, within three seconds.
    expect(peak(soft.subarray(soft.length - 4800))).toBe(0)
    // Less pronounced: 100 ms after the key comes up there is still far more sound left.
    expect(rmsAt(soft, 0.1, 0.05)).toBeGreaterThan(rmsAt(normal, 0.1, 0.05) * 2)
  })

  it('is disabled for Clav: the catalog says so, the state ignores it, and the release is unchanged', async () => {
    const app = mountApp()
    await start(app)
    for (let presses = 0; presses < 3; presses += 1) press(app, 'piano-type')
    expect(step(app, 'piano-type')).toBe('Clav')
    // Clav supports neither Soft Release nor String Res: the button has nowhere to go.
    expect(step(app, 'piano-acoustics')).toBe('Off')
    press(app, 'piano-acoustics')
    expect(step(app, 'piano-acoustics')).toBe('Off')
    expect(oled(app, 'notice')).toMatch(/NO SOFT RELEASE OR STRING RES/)
    expect(kernelOf(app).getState().layers[0]).toMatchObject({ softRelease: false, stringRes: false })
    expect([led(app, 'piano-acoustics-soft-rel'), led(app, 'piano-acoustics-string-res')]).toEqual(['off', 'off'])
  })

  it('the Acoustics button steps through Soft Release and String Res, and the release really changes', async () => {
    const app = mountApp()
    await start(app)
    // Start-up, as on the photo: String Res on.
    expect(step(app, 'piano-acoustics')).toBe('String Resonance')
    const releaseTime = () => {
      down(app, 48)
      render(app, 0.3)
      up(app, 48)
      return timeToSilence(mono(render(app, 2)), 1e-3)
    }
    const normal = releaseTime()
    press(app, 'piano-acoustics')
    expect(step(app, 'piano-acoustics')).toBe('Soft Release and String Resonance')
    expect([led(app, 'piano-acoustics-soft-rel'), led(app, 'piano-acoustics-string-res')]).toEqual(['on', 'on'])
    expect(kernelOf(app).getState().layers[0]).toMatchObject({ softRelease: true, stringRes: true })
    expect(releaseTime()).toBeGreaterThan(normal * 1.8)
    press(app, 'piano-acoustics')
    expect(step(app, 'piano-acoustics')).toBe('Off')
    press(app, 'piano-acoustics')
    expect(step(app, 'piano-acoustics')).toBe('Soft Release')
    expect(kernelOf(app).getState().layers[0]).toMatchObject({ softRelease: true, stringRes: false })
    // An electric piano has Soft Release but no strings to resonate.
    press(app, 'piano-type')
    press(app, 'piano-type')
    press(app, 'piano-acoustics')
    expect(step(app, 'piano-acoustics')).toBe('Off')
    press(app, 'piano-acoustics')
    expect(step(app, 'piano-acoustics')).toBe('Soft Release')
  })
})

describe('piano.velocity-controls: String Res', () => {
  const C4 = 261.6256

  /** Hold C3 quietly, play C4 staccato, then listen to what is left once C4 has been damped. */
  async function heldString(stringRes: boolean) {
    const kernel = await makeStage((sound) => void (sound.layers[0].stringRes = stringRes))
    kernel.noteOn(48, 0.25)
    renderStage(kernel, 0.5)
    kernel.noteOn(60, 0.9)
    renderStage(kernel, 0.15)
    kernel.noteOff(60)
    renderStage(kernel, 0.6)
    const out = mono(renderStage(kernel, 0.5))
    return { kernel, out }
  }

  it('a held string rings on at the pitch of a note played and damped above it', async () => {
    const without = await heldString(false)
    const withRes = await heldString(true)
    expect(without.kernel.resonanceCount).toBe(0)
    expect(withRes.kernel.resonanceCount).toBeGreaterThan(0)
    // C4 is the second partial of the held C3: that is where the sympathetic energy appears.
    expect(magnitudeAt(withRes.out, C4)).toBeGreaterThan(magnitudeAt(without.out, C4) * 1.1)
    expect(difference(without.out, withRes.out)).toBeGreaterThan(0.02)
    // It is a resonance, not another note: no new voice was struck.
    expect(withRes.kernel.voiceCount).toBe(without.kernel.voiceCount)
  })

  it('a key held long after its own note has died still rings when a related note is played', async () => {
    const silentString = async (stringRes: boolean) => {
      const kernel = await makeStage((sound) => void (sound.layers[0].stringRes = stringRes))
      kernel.noteOn(48, 0.3)
      renderStage(kernel, 7)
      // The recording of C3 has run out; the key is still down, so the string is still free.
      expect(kernel.voiceCount).toBe(0)
      expect(peak(renderStage(kernel, 0.1).left)).toBe(0)
      kernel.noteOn(60, 0.9)
      renderStage(kernel, 0.15)
      kernel.noteOff(60)
      renderStage(kernel, 0.6)
      return { kernel, out: mono(renderStage(kernel, 0.4)) }
    }
    const without = await silentString(false)
    const withRes = await silentString(true)
    // Without String Res the staccato note is simply gone. With it, C4 hangs in the air.
    expect(peak(without.out)).toBe(0)
    expect(rms(withRes.out)).toBeGreaterThan(1e-4)
    expect(magnitudeAt(withRes.out, C4)).toBeGreaterThan(magnitudeAt(withRes.out, C4 * 1.06) * 10)
    withRes.kernel.noteOff(48)
    renderStage(withRes.kernel, 1)
    expect(peak(renderStage(withRes.kernel, 0.1).left)).toBe(0)
  })

  it('stops when the held string is damped', async () => {
    const { kernel } = await heldString(true)
    kernel.noteOff(48)
    renderStage(kernel, 1.5)
    expect(kernel.resonanceCount).toBe(0)
    expect(kernel.voiceCount).toBe(0)
    expect(peak(renderStage(kernel, 0.1).left)).toBe(0)
  })

  it('nothing resonates when no other string is free', async () => {
    const kernel = await makeStage((sound) => void (sound.layers[0].stringRes = true))
    kernel.noteOn(60, 0.9)
    expect(kernel.resonanceCount).toBe(0)
    // An unrelated held note (no shared partial within reach) does not ring either.
    kernel.noteOn(61, 0.9)
    expect(kernel.resonanceCount).toBe(0)
  })

  it('with the sustain pedal down every string is free: a single note excites its relatives', async () => {
    const pedal = async (stringRes: boolean) => {
      const kernel = await makeStage((sound) => void (sound.layers[0].stringRes = stringRes))
      kernel.setSustain(true)
      kernel.noteOn(60, 0.9)
      const out = mono(renderStage(kernel, 1))
      return { kernel, out }
    }
    const without = await pedal(false)
    const withRes = await pedal(true)
    expect(withRes.kernel.resonanceCount).toBeGreaterThan(2)
    expect(difference(without.out, withRes.out)).toBeGreaterThan(0.01)
    // Pedal up: the dampers fall and the resonance goes with the note.
    withRes.kernel.noteOff(60)
    withRes.kernel.setSustain(false)
    renderStage(withRes.kernel, 1.5)
    expect(withRes.kernel.resonanceCount).toBe(0)
  })

  it('is simulated, and says so', async () => {
    const details = (await import('../IMPLEMENTATION_DETAILS.json')).default
    const entry = details.audio.generatedSources.find((source) => source.name === 'Sympathetic string resonance')
    expect(entry?.isRecording).toBe(false)
    expect(entry?.description).toMatch(/Simulated, not sampled/)
  })
})

describe('piano.velocity-controls: Master Level', () => {
  it('scales the whole output: silent at zero, louder all the way up', async () => {
    const level = async (master: number) => {
      const kernel = await makeStage((sound) => {
        sound.master = master
        sound.layers[1].on = true
        selectType(sound.layers[1], 'Misc')
      })
      kernel.noteOn(60, 0.5)
      return mono(renderStage(kernel, 0.4))
    }
    const levels = await Promise.all([0, 0.25, 0.5, 0.7, 1].map(level))
    expect(peak(levels[0])).toBe(0)
    for (let k = 1; k < levels.length; k += 1) expect(rms(levels[k])).toBeGreaterThan(rms(levels[k - 1]) * 1.3)
    // The reference position (7 of 10) keeps the Phase 1 loudness.
    expect(masterGain(0.7)).toBeCloseTo(0.7, 6)
    expect(rms(levels[4]) / rms(levels[3])).toBeCloseTo(masterGain(1) / masterGain(0.7), 1)
  })

  it('everything passes the master limiter: the output never exceeds full scale', async () => {
    const kernel = await makeStage((sound) => {
      sound.master = 1
      sound.layers[1].on = true
      sound.layers[1].level = 1
    })
    for (let note = 36; note < 84; note += 2) kernel.noteOn(note, 1)
    const out = renderStage(kernel, 0.5)
    expect(peak(out.left)).toBeGreaterThan(0.9)
    expect(peak(out.left)).toBeLessThanOrEqual(1)
    expect(peak(out.right)).toBeLessThanOrEqual(1)
  })

  it('the Master Level knob is live: turning it changes the level of a ringing note without a click', async () => {
    // The same note in an untouched instrument, as the reference for each moment in time.
    const untouched = mountApp()
    await start(untouched)
    down(untouched, 48)
    render(untouched, 0.3)
    const reference = rms(render(untouched, 0.1).left)
    untouched.unmount()

    const app = mountApp()
    await start(app)
    expect(value(app, 'perf-master-level')).toBe(7)
    down(app, 48)
    render(app, 0.2)
    keys(app, 'perf-master-level', 'End')
    expect(value(app, 'perf-master-level')).toBe(10)
    expect(kernelOf(app).getState().master).toBe(1)
    const turning = render(app, 0.1).left
    const loud = rms(render(app, 0.1).left)
    expect(loud).toBeGreaterThan(reference * 1.6)
    const steps = turning.map((sample, index) => (index ? Math.abs(sample - turning[index - 1]) : 0))
    expect(Math.max(...steps)).toBeLessThan(0.05)
    keys(app, 'perf-master-level', 'Home')
    render(app, 0.1)
    expect(peak(render(app, 0.1).left)).toBe(0)
    expect(oled(app, 'notice')).toBe('> MASTER LEVEL 0.0')
    // The voice is still there; only the master is down.
    expect(kernelOf(app).voiceCount).toBe(1)
  })
})

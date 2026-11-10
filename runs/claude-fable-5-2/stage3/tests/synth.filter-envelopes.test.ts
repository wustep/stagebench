import { describe, expect, it } from 'vitest'
import { ENV_STEPS, FilterType, SynthWave, attackSeconds, decaySeconds, type SynthLayerSound } from '../src/audio/dsp/params'
import { FILTER_TYPES, KB_TRACKS } from '../src/synth/catalog'
import { bandLevel, db } from './support/fxbench'
import { crossingRate, harmonics, makeRig, noteHz, renderKernel, slice, synthKernel } from './support/rig'
import { brightness, magnitudeAt, mono, rms, timeToSilence } from './support/signal'
import { difference } from './support/stage'

/**
 * Feature: synth.filter-envelopes
 * Filter types/tracking/resonance/drive and all three envelopes have observable effects.
 */

const NOTE = 45 // A2, 110 Hz: plenty of harmonics for a filter to work on
const F0 = noteHz(NOTE)

function play(configure: (layer: SynthLayerSound) => void, seconds = 0.6, note = NOTE, velocity = 0.8, hold = Infinity) {
  const kernel = synthKernel((layer) => {
    layer.osc.wave = SynthWave.Saw
    layer.filter = { on: true, type: FilterType.LP24, freq: 0.55, res: 0, envAmt: 0, track: 0, drive: 0 }
    configure(layer)
  })
  kernel.noteOn(note, velocity)
  if (hold === Infinity) return mono(renderKernel(kernel, seconds))
  const held = mono(renderKernel(kernel, hold))
  kernel.noteOff(note)
  const tail = mono(renderKernel(kernel, seconds - hold))
  const out = new Float32Array(held.length + tail.length)
  out.set(held)
  out.set(tail, held.length)
  return out
}
const steady = (out: Float32Array) => slice(out, 0.1, 0.6)
const filtered = (type: number, freq = 0.55, res = 0) =>
  steady(play((layer) => {
    layer.filter.type = type
    layer.filter.freq = freq
    layer.filter.res = res
  }))

describe('synth.filter-envelopes: four filter types', () => {
  // Cutoff knob at 0.55 is 20 Hz * 2^5.5 = 905 Hz.
  const dry = steady(play((layer) => {
    layer.filter.on = false
  }))

  it('LP12 and LP24 take away the top, LP24 more steeply', () => {
    const lp12 = filtered(FilterType.LP12)
    const lp24 = filtered(FilterType.LP24)
    // Harmonics 30 to 60 of the 110 Hz note: 3.3 kHz to 6.6 kHz, read exactly on the harmonics.
    const top = (out: Float32Array) => harmonics(out, F0, 60).slice(29).reduce((sum, level) => sum + level, 0)
    expect(top(lp12)).toBeLessThan(top(dry) * 0.3)
    expect(top(lp24)).toBeLessThan(top(lp12) * 0.3)
    // The fundamental, far below the cutoff, passes.
    expect(magnitudeAt(lp12, F0) / magnitudeAt(dry, F0)).toBeGreaterThan(0.85)
    expect(magnitudeAt(lp24, F0) / magnitudeAt(dry, F0)).toBeGreaterThan(0.85)
  })

  it('HP takes away the bottom, BP keeps only the middle', () => {
    const hp = filtered(FilterType.HP)
    const bp = filtered(FilterType.BP)
    expect(magnitudeAt(hp, F0)).toBeLessThan(magnitudeAt(dry, F0) * 0.1)
    expect(bandLevel(hp, 3000, 9000)).toBeGreaterThan(bandLevel(dry, 3000, 9000) * 0.7)
    expect(magnitudeAt(bp, F0)).toBeLessThan(magnitudeAt(dry, F0) * 0.3)
    expect(bandLevel(bp, 5000, 12000)).toBeLessThan(bandLevel(dry, 5000, 12000) * 0.4)
    // The harmonic nearest the cutoff (8 x 110 = 880 Hz) is what a band-pass keeps best.
    const kept = harmonics(bp, F0, 16).map((level, index) => level / harmonics(dry, F0, 16)[index])
    expect(kept.indexOf(Math.max(...kept)) + 1).toBeGreaterThanOrEqual(7)
    expect(kept.indexOf(Math.max(...kept)) + 1).toBeLessThanOrEqual(9)
  })

  it('the four types render four different signals, and Filter Off is the dry oscillator', () => {
    const renders = [FilterType.LP12, FilterType.LP24, FilterType.HP, FilterType.BP].map((type) => filtered(type))
    for (let a = 0; a < renders.length; a += 1) {
      for (let b = a + 1; b < renders.length; b += 1) expect(difference(renders[a], renders[b])).toBeGreaterThan(0.1)
    }
    expect(FILTER_TYPES).toEqual(['LP12', 'LP24', 'HP', 'BP'])
    expect(difference(dry, renders[0])).toBeGreaterThan(0.1)
  })

  it('Freq moves the cutoff: the higher the knob, the brighter a low-pass', () => {
    const levels = [0.3, 0.45, 0.6, 0.75, 0.9].map((freq) => brightness(filtered(FilterType.LP24, freq)))
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]).toBeGreaterThan(levels[i - 1] * 1.5)
  })

  it('Res raises a peak at the cutoff', () => {
    // 20 * 2^5.459 = 880 Hz: the cutoff sits on the 8th harmonic.
    const at = (res: number) => {
      const out = filtered(FilterType.LP12, 0.5459, res)
      return harmonics(out, F0, 8)[7] / harmonics(out, F0, 8)[0]
    }
    expect(at(0.5)).toBeGreaterThan(at(0) * 1.5)
    expect(at(0.95)).toBeGreaterThan(at(0.5) * 2)
  })

  it('keyboard tracking moves the cutoff with the key: Off, 1/3, 2/3, 1', () => {
    expect(KB_TRACKS).toEqual(['Off', '1/3', '2/3', '1'])
    // Three octaves up from middle C, with the cutoff well below the note unless tracking opens it.
    const high = (track: number) =>
      bandLevel(
        steady(play((layer) => {
          layer.filter.freq = 0.5
          layer.filter.track = track
        }, 0.6, 96)),
        2000,
        9000,
      )
    const levels = [0, 1 / 3, 2 / 3, 1].map(high)
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]).toBeGreaterThan(levels[i - 1] * 1.5)
    // At middle C (the pivot) tracking changes nothing.
    const pivot = (track: number) => steady(play((layer) => {
      layer.filter.track = track
    }, 0.6, 60))
    expect(difference(pivot(0), pivot(1))).toBeLessThan(1e-6)
  })

  it('Drive adds harmonics before the filter, more at each level', () => {
    const driven = (drive: number) => {
      const out = steady(play((layer) => {
        layer.osc.wave = SynthWave.Sine
        layer.filter = { on: true, type: FilterType.LP24, freq: 0.9, res: 0, envAmt: 0, track: 0, drive }
      }))
      const [h1, , h3] = harmonics(out, F0, 3)
      return h3 / h1
    }
    const levels = [0, 1, 2, 3].map(driven)
    expect(levels[0]).toBeLessThan(0.005)
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]).toBeGreaterThan(levels[i - 1] + 0.03)
  })
})

describe('synth.filter-envelopes: the filter envelope', () => {
  const swept = (envAmt: number, velocity = 0.8, velocitySensitive = false) =>
    play((layer) => {
      layer.filter = { on: true, type: FilterType.LP24, freq: 0.3, res: 0.2, envAmt, track: 0, drive: 0 }
      layer.filterEnv = { attack: 0.001, decay: 0.2, release: 0.1, sustain: false, velocity: velocitySensitive }
    }, 1, NOTE, velocity)

  it('Env Amt opens the filter on the attack and lets it close again', () => {
    const closed = swept(0)
    const open = swept(0.8)
    expect(brightness(slice(open, 0.01, 0.06))).toBeGreaterThan(brightness(slice(closed, 0.01, 0.06)) * 4)
    // After the decay the two are the same filter again.
    expect(brightness(slice(open, 0.8, 1)) / brightness(slice(closed, 0.8, 1))).toBeLessThan(1.5)
    expect(brightness(slice(swept(0.8), 0.01, 0.06))).toBeGreaterThan(brightness(slice(swept(0.4), 0.01, 0.06)) * 2)
  })

  it('attack, decay, and release times shape the sweep', () => {
    const early = (configure: (layer: SynthLayerSound) => void, from: number, to: number, hold = Infinity) =>
      brightness(
        slice(
          play((layer) => {
            layer.filter = { on: true, type: FilterType.LP24, freq: 0.3, res: 0.2, envAmt: 0.8, track: 0, drive: 0 }
            layer.filterEnv = { attack: 0.001, decay: 0.2, release: 0.1, sustain: false, velocity: false }
            layer.ampEnv.release = 1.5
            configure(layer)
          }, 1, NOTE, 0.8, hold),
          from,
          to,
        ),
      )
    // A slow attack has not opened the filter yet where a fast one already has.
    expect(early((layer) => void (layer.filterEnv.attack = 0.4), 0.02, 0.06)).toBeLessThan(early(() => undefined, 0.02, 0.06) * 0.5)
    // A long decay is still open where a short one has closed.
    expect(early((layer) => void (layer.filterEnv.decay = 2), 0.25, 0.35)).toBeGreaterThan(early(() => undefined, 0.25, 0.35) * 3)
    // Sustain (decay at maximum) holds it open while the key is down; release then closes it at its own pace.
    const sustained = (release: number) => early((layer) => void (layer.filterEnv = { attack: 0.001, decay: 1, release, sustain: true, velocity: false }), 0.5, 0.6, 0.3)
    expect(sustained(2)).toBeGreaterThan(sustained(0.05) * 5)
  })

  it('with Velocity on, harder keys open the filter further', () => {
    const soft = brightness(slice(swept(0.8, 0.2, true), 0.01, 0.06))
    const hard = brightness(slice(swept(0.8, 1, true), 0.01, 0.06))
    expect(hard).toBeGreaterThan(soft * 3)
    const softFixed = brightness(slice(swept(0.8, 0.2, false), 0.01, 0.06))
    const hardFixed = brightness(slice(swept(0.8, 1, false), 0.01, 0.06))
    expect(hardFixed / softFixed).toBeLessThan(1.2)
  })
})

describe('synth.filter-envelopes: the amplifier envelope', () => {
  const amp = (configure: (layer: SynthLayerSound) => void, seconds = 1.2, hold = Infinity, velocity = 0.8) =>
    play((layer) => {
      layer.filter.on = false
      configure(layer)
    }, seconds, NOTE, velocity, hold)

  it('attack: a slow attack fades the note in', () => {
    const fast = amp((layer) => void (layer.ampEnv.attack = 0.002))
    const slow = amp((layer) => void (layer.ampEnv.attack = 0.5))
    expect(rms(slice(slow, 0.02, 0.08))).toBeLessThan(rms(slice(fast, 0.02, 0.08)) * 0.2)
    expect(rms(slice(slow, 0.7, 0.9)) / rms(slice(fast, 0.7, 0.9))).toBeGreaterThan(0.9)
  })

  it('decay: the note dies away while held, unless decay is at maximum (sustain)', () => {
    const decaying = amp((layer) => void (layer.ampEnv = { ...layer.ampEnv, decay: 0.3, sustain: false }))
    const sustaining = amp((layer) => void (layer.ampEnv = { ...layer.ampEnv, decay: decaySeconds(ENV_STEPS), sustain: true }))
    expect(db(rms(slice(decaying, 0.9, 1.1)) / rms(slice(decaying, 0.02, 0.1)))).toBeLessThan(-40)
    expect(db(rms(slice(sustaining, 0.9, 1.1)) / rms(slice(sustaining, 0.02, 0.1)))).toBeGreaterThan(-1)
    const longer = amp((layer) => void (layer.ampEnv = { ...layer.ampEnv, decay: 1.5, sustain: false }))
    expect(rms(slice(longer, 0.5, 0.7))).toBeGreaterThan(rms(slice(decaying, 0.5, 0.7)) * 10)
  })

  it('release: the tail after key-up lasts as long as the release time', () => {
    const tail = (release: number) => timeToSilence(slice(amp((layer) => void (layer.ampEnv.release = release), 2.5, 0.2), 0.2, 2.5), 0.001)
    const short = tail(0.05)
    const long = tail(1)
    expect(short).toBeLessThan(0.15)
    expect(long).toBeGreaterThan(0.5)
    expect(long).toBeGreaterThan(short * 5)
  })

  it('velocity levels Off / 1 / 2 / 3: from no response to a wide one', () => {
    const range = (level: number) => {
      const soft = rms(slice(amp((layer) => void (layer.ampEnv.velocity = level), 0.4, Infinity, 0.25), 0.1, 0.4))
      const hard = rms(slice(amp((layer) => void (layer.ampEnv.velocity = level), 0.4, Infinity, 1), 0.1, 0.4))
      return db(hard / soft)
    }
    const ranges = [0, 1, 2, 3].map(range)
    expect(ranges[0]).toBeCloseTo(0, 5)
    for (let i = 1; i < ranges.length; i += 1) expect(ranges[i]).toBeGreaterThan(ranges[i - 1] + 2)
    expect(ranges[3]).toBeGreaterThan(15)
  })
})

describe('synth.filter-envelopes: the oscillator envelope', () => {
  it('Env To Pitch retargets it to the pitch: positive amounts sweep down onto the note, negative up', () => {
    const sweep = (amount: number) =>
      play((layer) => {
        layer.osc.wave = SynthWave.Sine
        layer.filter.on = false
        layer.oscEnv = { attack: 0.0005, decay: 0.15, release: 0.1, sustain: false, amount, velocity: false, toPitch: true }
      }, 0.8, 57)
    const down = sweep(0.5)
    expect(crossingRate(slice(down, 0.005, 0.03))).toBeGreaterThan(crossingRate(slice(down, 0.6, 0.8)) * 1.3)
    expect(crossingRate(slice(down, 0.6, 0.8))).toBeCloseTo(220, -1)
    const up = sweep(-0.5)
    expect(crossingRate(slice(up, 0.005, 0.03))).toBeLessThan(crossingRate(slice(up, 0.6, 0.8)) * 0.75)
    // Without Env To Pitch the same envelope leaves a Pure oscillator's pitch alone.
    const flat = play((layer) => {
      layer.osc.wave = SynthWave.Sine
      layer.filter.on = false
      layer.oscEnv = { attack: 0.0005, decay: 0.15, release: 0.1, sustain: false, amount: 0.5, velocity: false, toPitch: false }
    }, 0.8, 57)
    expect(crossingRate(slice(flat, 0.005, 0.105))).toBeCloseTo(220, -1)
  })

  it('its attack and decay times and its Velocity switch shape the modulation', () => {
    const fm = (configure: (layer: SynthLayerSound) => void, velocity = 0.8) =>
      play((layer) => {
        layer.osc.wave = SynthWave.Fm2Op
        layer.osc.ctrl = 0
        layer.filter.on = false
        layer.oscEnv = { attack: 0.001, decay: 0.15, release: 0.1, sustain: false, amount: 0.8, velocity: false, toPitch: false }
        configure(layer)
      }, 1, 57, velocity)
    // Slow attack: the brightness arrives late.
    const slow = fm((layer) => void (layer.oscEnv.attack = 0.4))
    expect(brightness(slice(slow, 0.3, 0.4))).toBeGreaterThan(brightness(slice(slow, 0.01, 0.05)) * 3)
    // Long decay: still bright late.
    expect(brightness(slice(fm((layer) => void (layer.oscEnv.decay = 3)), 0.6, 0.8))).toBeGreaterThan(brightness(slice(fm(() => undefined), 0.6, 0.8)) * 3)
    // Velocity: a soft key modulates less.
    const soft = brightness(slice(fm((layer) => void (layer.oscEnv.velocity = true), 0.2), 0.005, 0.04))
    const hard = brightness(slice(fm((layer) => void (layer.oscEnv.velocity = true), 1), 0.005, 0.04))
    expect(hard).toBeGreaterThan(soft * 3)
  })
})

describe('synth.filter-envelopes: the panel', () => {
  it('the filter knobs, the Type button, and Filter On set the canonical state the kernel plays', () => {
    const rig = makeRig()
    rig.press('synth-on')
    rig.set('synth-filter-freq', 7)
    rig.set('synth-filter-res', 2)
    rig.set('synth-filter-env-amt', 1)
    let filter = rig.sound().synth.layers[0].filter
    expect([filter.freq, filter.res, filter.envAmt]).toEqual([0.7, 0.2, 0.1])
    expect(rig.text('synth-filter-freq')).toBe('Filter Freq 2.6 kHz')
    // First press shows the filter page; further presses step the type.
    expect(filter.type).toBe(FilterType.LP24)
    rig.press('synth-filter-type')
    expect(rig.state().ui.synthPage).toBe('filter')
    expect(rig.led('synth-filter-type')).toBe('on')
    expect(rig.sound().synth.layers[0].filter.type).toBe(FilterType.LP24)
    rig.press('synth-filter-type')
    expect(rig.sound().synth.layers[0].filter.type).toBe(FilterType.HP)
    // On the filter page the three dials are Type, KB Track, Drive.
    rig.turn('synth-osc-dial-1', -2)
    rig.turn('synth-osc-dial-2', -2)
    rig.turn('synth-osc-dial-3', 2)
    filter = rig.sound().synth.layers[0].filter
    expect(filter.type).toBe(FilterType.LP12)
    expect(filter.track).toBeCloseTo(1 / 3)
    expect(filter.drive).toBe(2)
    expect(rig.state().notice).toBe('Synth A Filter LP12, KB Track 1/3, Drive 2')
    rig.press('synth-filter-on')
    expect(rig.sound().synth.layers[0].filter.on).toBe(false)
    expect(rig.led('synth-filter-on')).toBe('off')
    rig.dispose()
  })

  it('each Envelope button puts its envelope on the three dials: attack, decay, release', () => {
    const rig = makeRig()
    rig.press('synth-on')
    for (const [button, page, key] of [
      ['synth-osc-envelope', 'oscEnv', 'oscEnv'],
      ['synth-filter-envelope', 'filterEnv', 'filterEnv'],
      ['synth-amp-envelope', 'ampEnv', 'ampEnv'],
    ] as const) {
      rig.press(button)
      expect(rig.state().ui.synthPage).toBe(page)
      expect(rig.led(button)).toBe('on')
      const before = { ...rig.state().synth.layers[0][key] }
      rig.turn('synth-osc-dial-1', 3)
      rig.turn('synth-osc-dial-2', -4)
      rig.turn('synth-osc-dial-3', 5)
      const after = rig.state().synth.layers[0][key]
      expect(after.attack).toBe(before.attack + 3)
      expect(after.decay).toBe(before.decay - 4)
      expect(after.release).toBe(before.release + 5)
      const sound = rig.sound().synth.layers[0][key]
      expect(sound.attack).toBeCloseTo(attackSeconds(after.attack), 9)
      expect(sound.decay).toBeCloseTo(decaySeconds(after.decay), 9)
      expect(sound.release).toBeCloseTo(decaySeconds(after.release), 9)
      expect(sound.sustain).toBe(false)
    }
    // Decay turned all the way up is sustain.
    rig.turn('synth-osc-dial-2', ENV_STEPS)
    expect(rig.state().synth.layers[0].ampEnv.decay).toBe(ENV_STEPS)
    expect(rig.sound().synth.layers[0].ampEnv.sustain).toBe(true)
    expect(rig.state().notice).toBe('Synth A Amp Env decay Sustain')
    // The same button again goes back to the oscillator page.
    rig.press('synth-amp-envelope')
    expect(rig.state().ui.synthPage).toBe('osc')
    expect(rig.led('synth-amp-envelope')).toBe('off')
    rig.dispose()
  })

  it('Shift + an Envelope button is its Velocity setting; Shift + Pitch is Env To Pitch', () => {
    const rig = makeRig()
    rig.press('synth-on')
    rig.shiftPress('synth-osc-envelope')
    rig.shiftPress('synth-filter-envelope')
    rig.shiftPress('synth-osc-pitch')
    const layer = rig.sound().synth.layers[0]
    expect([layer.oscEnv.velocity, layer.filterEnv.velocity, layer.oscEnv.toPitch]).toEqual([true, true, true])
    expect([rig.led('synth-osc-velocity'), rig.led('synth-filter-velocity'), rig.led('synth-osc-env-to-pitch')]).toEqual(['on', 'on', 'on'])
    // Amp velocity steps Off, 1, 2, 3 on two LEDs.
    const seen: string[] = []
    for (let presses = 0; presses < 4; presses += 1) {
      rig.shiftPress('synth-amp-envelope')
      seen.push(`${rig.sound().synth.layers[0].ampEnv.velocity}:${rig.led('synth-amp-velocity-1')}/${rig.led('synth-amp-velocity-2')}`)
    }
    expect(seen).toEqual(['3:on/on', '0:off/off', '1:on/off', '2:off/on'])
    rig.dispose()
  })
})

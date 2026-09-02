/**
 * effects.processing — every unit and every listed type processes real audio and measurably changes a standardized
 * rendered signal. These tests run the exact src/dsp classes the AudioWorklet hosts, offline on Float32Arrays.
 */
import { describe, expect, it } from 'vitest'
import { AmpEqUnit } from '../src/dsp/ampEq'
import { bandFraction, magnitudeSpectrum, maxAbsDifference, maxStep, normalizedDifference, peak, rms, spectralCentroid, stereoCorrelation } from '../src/dsp/analysis'
import { CompressorUnit } from '../src/dsp/compressor'
import { DelayUnit } from '../src/dsp/delay'
import { MasterUnit } from '../src/dsp/master'
import { Mod1Unit } from '../src/dsp/mod1'
import { Mod2Unit } from '../src/dsp/mod2'
import { harmonicTone, impulse, makeChain, noiseBurst, renderThrough, sineBurst, type ChainOverrides, type StereoBuffer } from '../src/dsp/offline'
import { ReverbUnit } from '../src/dsp/reverb'
import { RotaryUnit } from '../src/dsp/rotary'
import { StringResUnit } from '../src/dsp/stringRes'
import { TimbreUnit, effectiveTimbreSetting } from '../src/dsp/timbre'
import {
  AMP_MODELS,
  MOD1_TYPES,
  MOD2_TYPES,
  REVERB_TYPES,
  masterKnobToGain,
  type AmpEqParams,
  type CompressorParams,
  type DelayParams,
  type Mod1Params,
  type Mod2Params,
  type ReverbParams,
  type RotaryParams,
  type StringResParams,
  type TimbreParams,
} from '../src/dsp/types'

const SR = 22050

const tone = (seconds = 1, midi = 60) => harmonicTone(midi, seconds, SR)
const noise = (seconds = 1, amplitude = 0.3) => noiseBurst(seconds, SR, 7, { amplitude })

function mod1(p: Mod1Params, input: Float32Array): StereoBuffer {
  const u = new Mod1Unit(SR)
  u.setParams(p)
  return renderThrough(u, input)
}
function mod2(p: Mod2Params, input: Float32Array): StereoBuffer {
  const u = new Mod2Unit(SR)
  u.setParams(p)
  return renderThrough(u, input)
}
const DELAY_BASE: DelayParams = { seconds: 0.1, feedback: 5, dryWet: 5, filter: 0, pingPong: false }
function delay(p: Partial<DelayParams>, input: Float32Array): StereoBuffer {
  const u = new DelayUnit(SR)
  u.setParams({ ...DELAY_BASE, ...p })
  return renderThrough(u, input)
}
const AMP_BASE: AmpEqParams = { model: 0, drive: 0, bass: 0, mid: 0, midFreq: 5, treble: 0 }
function amp(p: Partial<AmpEqParams>, input: Float32Array): StereoBuffer {
  const u = new AmpEqUnit(SR)
  u.setParams({ ...AMP_BASE, ...p })
  return renderThrough(u, input)
}
function comp(p: CompressorParams, input: Float32Array): StereoBuffer {
  const u = new CompressorUnit(SR)
  u.setParams(p)
  return renderThrough(u, input)
}
const REVERB_BASE: ReverbParams = { type: 4, dryWet: 6, tone: 0 }
function reverb(p: Partial<ReverbParams>, input: Float32Array): StereoBuffer {
  const u = new ReverbUnit(SR)
  u.setParams({ ...REVERB_BASE, ...p })
  return renderThrough(u, input)
}
function rotary(p: RotaryParams, input: Float32Array): StereoBuffer {
  const u = new RotaryUnit(SR)
  u.setParams(p)
  return renderThrough(u, input)
}
function timbre(p: TimbreParams, input: Float32Array): StereoBuffer {
  const u = new TimbreUnit(SR)
  u.setParams(p)
  return renderThrough(u, input)
}
function stringRes(p: StringResParams, input: Float32Array): StereoBuffer {
  const u = new StringResUnit(SR)
  u.setParams(p)
  return renderThrough(u, input)
}

function expectPairwiseDistinct(outs: StereoBuffer[], labels: readonly string[], threshold = 0.05) {
  for (let i = 0; i < outs.length; i++) {
    for (let j = i + 1; j < outs.length; j++) {
      expect(normalizedDifference(outs[i].l, outs[j].l), `${labels[i]} vs ${labels[j]}`).toBeGreaterThan(threshold)
    }
  }
}

/** Seconds until the 30 ms windowed rms has dropped `dbDrop` below its maximum. */
function decayTime(x: Float32Array, sr: number, dbDrop = 40): number {
  const win = Math.round(0.03 * sr)
  const levels: number[] = []
  for (let p = 0; p + win <= x.length; p += win) levels.push(rms(x, p, p + win))
  const max = Math.max(...levels)
  const maxIdx = levels.indexOf(max)
  const thr = max * Math.pow(10, -dbDrop / 20)
  for (let i = maxIdx; i < levels.length; i++) if (levels[i] < thr) return (i * win) / sr
  return x.length / sr
}

const window = (x: Float32Array, from: number, to: number) => x.subarray(Math.round(from * SR), Math.round(to * SR))

describe('effects.processing — Mod 1', () => {
  const input = tone(1)

  it('lists the six documented types and each one changes the signal and differs from the others', () => {
    expect(MOD1_TYPES).toEqual(['Ring Mod', 'Tremolo', 'A-Pan', 'A-Wah', 'Wah', 'Pump'])
    const outs = MOD1_TYPES.map((_, type) => mod1({ type, rate: 5, amount: 7 }, input))
    outs.forEach((o, i) => expect(normalizedDifference(input, o.l), MOD1_TYPES[i]).toBeGreaterThan(0.05))
    expectPairwiseDistinct(outs, MOD1_TYPES)
  })

  it('Rate and Amount change the output (tremolo, ring mod, wah)', () => {
    for (const type of [0, 1, 4]) {
      const slow = mod1({ type, rate: 2, amount: 7 }, input)
      const fast = mod1({ type, rate: 8, amount: 7 }, input)
      const little = mod1({ type, rate: 5, amount: 2 }, input)
      const lots = mod1({ type, rate: 5, amount: 9 }, input)
      expect(normalizedDifference(slow.l, fast.l), `${MOD1_TYPES[type]} rate`).toBeGreaterThan(0.03)
      expect(normalizedDifference(little.l, lots.l), `${MOD1_TYPES[type]} amount`).toBeGreaterThan(0.03)
    }
  })

  it('Tremolo is at full level at zero Amount', () => {
    const out = mod1({ type: 1, rate: 5, amount: 0 }, input)
    expect(maxAbsDifference(input, out.l)).toBeLessThan(1e-6)
  })

  it('A-Pan moves the sound between left and right', () => {
    const out = mod1({ type: 2, rate: 5, amount: 10 }, input) // 1 Hz LFO
    expect(rms(out.r, 0, Math.round(0.25 * SR))).toBeGreaterThan(rms(out.l, 0, Math.round(0.25 * SR)) * 1.1)
    expect(rms(out.l, Math.round(0.5 * SR), Math.round(0.75 * SR))).toBeGreaterThan(rms(out.r, Math.round(0.5 * SR), Math.round(0.75 * SR)) * 1.1)
  })

  it('A-Wah follows the playing level: a loud stroke opens the filter higher than a soft one', () => {
    const soft = mod1({ type: 3, rate: 5, amount: 10 }, harmonicTone(72, 1, SR, { amplitude: 0.02 }))
    const loud = mod1({ type: 3, rate: 5, amount: 10 }, harmonicTone(72, 1, SR, { amplitude: 0.5 }))
    expect(spectralCentroid(loud.l, SR)).toBeGreaterThan(spectralCentroid(soft.l, SR) * 1.3)
  })
})

describe('effects.processing — Mod 2', () => {
  const input = tone(1)

  it('lists the six documented types and each one changes the signal and differs from the others', () => {
    expect(MOD2_TYPES).toEqual(['Chorus', 'Flanger', 'Phaser', 'Vibe', 'Ensemble', 'Spin'])
    const outs = MOD2_TYPES.map((_, type) => mod2({ type, rate: 5, amount: 7 }, input))
    outs.forEach((o, i) => expect(normalizedDifference(input, o.l), MOD2_TYPES[i]).toBeGreaterThan(0.05))
    expectPairwiseDistinct(outs, MOD2_TYPES)
  })

  it('Rate and Amount change every type', () => {
    MOD2_TYPES.forEach((name, type) => {
      const slow = mod2({ type, rate: 1, amount: 7 }, input)
      const fast = mod2({ type, rate: 9, amount: 7 }, input)
      const little = mod2({ type, rate: 5, amount: 1 }, input)
      const lots = mod2({ type, rate: 5, amount: 9 }, input)
      expect(normalizedDifference(slow.l, fast.l), `${name} rate`).toBeGreaterThan(0.01)
      expect(normalizedDifference(little.l, lots.l), `${name} amount`).toBeGreaterThan(0.01)
    })
  })

  it('Chorus and Ensemble widen a mono source into a stereo image', () => {
    for (const type of [0, 4]) {
      const out = mod2({ type, rate: 5, amount: 8 }, input)
      expect(stereoCorrelation(out.l, out.r), MOD2_TYPES[type]).toBeLessThan(0.995)
    }
  })
})

describe('effects.processing — Delay', () => {
  const input = tone(1.5)

  it('produces repeats: on differs from dry, dry/wet 0 is dry only, dry/wet 10 is repeats only', () => {
    const on = delay({}, input)
    expect(normalizedDifference(input, on.l)).toBeGreaterThan(0.05)
    const dryOnly = delay({ dryWet: 0 }, input)
    expect(maxAbsDifference(input, dryOnly.l)).toBeLessThan(1e-6)
    const imp = impulse(0.5, SR)
    const wetOnly = delay({ dryWet: 10 }, imp)
    expect(Math.abs(wetOnly.l[0])).toBeLessThan(1e-6)
    expect(Math.abs(wetOnly.l[Math.round(0.1 * SR)])).toBeGreaterThan(0.3)
    expect(normalizedDifference(delay({ dryWet: 3 }, input).l, delay({ dryWet: 8 }, input).l)).toBeGreaterThan(0.05)
  })

  it('Feedback sets the number of repeats and Tempo the spacing', () => {
    const burst = harmonicTone(60, 0.2, SR, { length: 1.5 })
    const little = delay({ feedback: 2 }, burst)
    const lots = delay({ feedback: 8 }, burst)
    expect(rms(lots.l, Math.round(1.0 * SR), Math.round(1.5 * SR))).toBeGreaterThan(rms(little.l, Math.round(1.0 * SR), Math.round(1.5 * SR)) * 2)
    const imp = impulse(0.8, SR)
    const short = delay({ seconds: 0.1, dryWet: 10, feedback: 0 }, imp)
    const long = delay({ seconds: 0.3, dryWet: 10, feedback: 0 }, imp)
    expect(Math.abs(short.l[Math.round(0.1 * SR)])).toBeGreaterThan(0.5)
    expect(Math.abs(long.l[Math.round(0.1 * SR)])).toBeLessThan(1e-6)
    expect(Math.abs(long.l[Math.round(0.3 * SR)])).toBeGreaterThan(0.5)
  })

  it('the feedback filter processes the repeats, never the dry path, and each repeat is filtered again', () => {
    const imp = impulse(1, SR)
    const outs = [0, 1, 2, 3].map((filter) => delay({ filter, feedback: 7, dryWet: 5 }, imp))
    expectPairwiseDistinct(outs, ['Off', 'HP', 'BP', 'LP'], 0.02)
    // dry path (first 10 ms, before any repeat) is identical whatever the filter
    for (const o of outs) expect(maxAbsDifference(outs[0].l.subarray(0, 220), o.l.subarray(0, 220))).toBeLessThan(1e-7)
    const repeatCentroids = (o: StereoBuffer) => [1, 2, 3].map((k) => spectralCentroid(window(o.l, k * 0.1 - 0.01, (k + 1) * 0.1 - 0.01), SR))
    const lp = repeatCentroids(outs[3])
    const hp = repeatCentroids(outs[1])
    const off = repeatCentroids(outs[0])
    expect(lp[0]).toBeLessThan(off[0] * 0.9)
    expect(lp[1]).toBeLessThan(lp[0] * 0.97)
    expect(lp[2]).toBeLessThan(lp[1] * 0.97)
    expect(hp[0]).toBeGreaterThan(off[0] * 1.02)
    expect(hp[1]).toBeGreaterThan(hp[0] * 1.005)
    expect(hp[2]).toBeGreaterThan(hp[1] * 1.002)
  })

  it('ping-pong sends the repeats alternately left and right', () => {
    const out = delay({ pingPong: true, dryWet: 10, feedback: 7 }, impulse(0.5, SR))
    const at = (x: Float32Array, t: number) => rms(x, Math.round((t - 0.005) * SR), Math.round((t + 0.005) * SR))
    expect(at(out.l, 0.1)).toBeGreaterThan(at(out.r, 0.1) * 10)
    expect(at(out.r, 0.2)).toBeGreaterThan(at(out.l, 0.2) * 10)
    expect(at(out.l, 0.3)).toBeGreaterThan(at(out.r, 0.3) * 10)
  })
})

describe('effects.processing — Amp Sim / EQ', () => {
  const white = noise(1)

  it('neutral settings are close to transparent while Drive adds harmonics', () => {
    const sine = sineBurst(440, 1, SR, { amplitude: 0.5 })
    const clean = amp({}, sine)
    expect(normalizedDifference(sine, clean.l)).toBeLessThan(0.12)
    const driven = amp({ drive: 8 }, sine)
    expect(normalizedDifference(clean.l, driven.l)).toBeGreaterThan(0.05)
    expect(bandFraction(driven.l, SR, 1000, 5000)).toBeGreaterThan(bandFraction(clean.l, SR, 1000, 5000) * 10)
  })

  it('Bass, Mid and Treble boost and cut their bands (±15 dB)', () => {
    expect(bandFraction(amp({ bass: 15 }, white).l, SR, 40, 100)).toBeGreaterThan(bandFraction(amp({ bass: -15 }, white).l, SR, 40, 100) * 4)
    expect(bandFraction(amp({ treble: 15 }, white).l, SR, 5000, 11000)).toBeGreaterThan(bandFraction(amp({ treble: -15 }, white).l, SR, 5000, 11000) * 2)
    expect(bandFraction(amp({ mid: 15 }, white).l, SR, 1000, 1600)).toBeGreaterThan(bandFraction(amp({ mid: -15 }, white).l, SR, 1000, 1600) * 4)
  })

  it('the Mid FREQ knob moves the peak between 200 Hz and 8 kHz', () => {
    const low = amp({ mid: 12, midFreq: 2 }, white)
    const high = amp({ mid: 12, midFreq: 8 }, white)
    expect(bandFraction(low.l, SR, 300, 550)).toBeGreaterThan(bandFraction(high.l, SR, 300, 550) * 1.5)
    expect(bandFraction(high.l, SR, 3000, 5000)).toBeGreaterThan(bandFraction(low.l, SR, 3000, 5000) * 1.5)
  })

  it('Small, JC and Twin are distinct colourations; To Rotary leaves the tone to EQ + drive', () => {
    expect(AMP_MODELS).toEqual(['EQ only', 'Small', 'JC', 'Twin', 'To Rotary', 'LP24 Filter', 'HP24 Filter'])
    const outs = [0, 1, 2, 3].map((model) => amp({ model, drive: 3 }, white))
    expectPairwiseDistinct(outs, ['EQ only', 'Small', 'JC', 'Twin'])
    const eqOnly = amp({ model: 0, drive: 3, bass: 4, treble: -3 }, white)
    const toRotary = amp({ model: 4, drive: 3, bass: 4, treble: -3 }, white)
    expect(maxAbsDifference(eqOnly.l, toRotary.l)).toBeLessThan(1e-6)
  })

  it('LP24 darkens, HP24 brightens, and the Mid knob sets their resonance', () => {
    const flat = amp({}, white)
    const lp = amp({ model: 5 }, white)
    const hp = amp({ model: 6 }, white)
    const c0 = spectralCentroid(flat.l, SR)
    expect(spectralCentroid(lp.l, SR)).toBeLessThan(c0 * 0.6)
    expect(spectralCentroid(hp.l, SR)).toBeGreaterThan(c0 * 1.02)
    expect(bandFraction(hp.l, SR, 0, 600)).toBeLessThan(bandFraction(flat.l, SR, 0, 600) * 0.2)
    expect(bandFraction(lp.l, SR, 4000, 11000)).toBeLessThan(bandFraction(flat.l, SR, 4000, 11000) * 0.2)
    const resonant = amp({ model: 5, mid: 15 }, white)
    const damped = amp({ model: 5, mid: -15 }, white)
    expect(bandFraction(resonant.l, SR, 1100, 1450)).toBeGreaterThan(bandFraction(damped.l, SR, 1100, 1450) * 2)
  })
})

describe('effects.processing — Compressor', () => {
  const loudSoft = () => {
    const out = new Float32Array(SR)
    out.set(sineBurst(440, 0.4, SR, { amplitude: 0.8 }), 0)
    out.set(sineBurst(440, 0.4, SR, { amplitude: 0.05 }), Math.round(0.5 * SR))
    return out
  }

  it('Amount 0 is exact unity; higher amounts change the signal and reduce the dynamic range', () => {
    const x = loudSoft()
    expect(maxAbsDifference(x, comp({ amount: 0, fast: false }, x).l)).toBeLessThan(1e-9)
    const y = comp({ amount: 8, fast: false }, x)
    expect(normalizedDifference(x, y.l)).toBeGreaterThan(0.05)
    const ratio = (b: Float32Array) => rms(b, Math.round(0.1 * SR), Math.round(0.35 * SR)) / rms(b, Math.round(0.6 * SR), Math.round(0.85 * SR))
    expect(ratio(y.l)).toBeLessThan(ratio(x) * 0.5)
    const y3 = comp({ amount: 3, fast: false }, x)
    expect(ratio(y3.l)).toBeLessThan(ratio(x))
    expect(ratio(y3.l)).toBeGreaterThan(ratio(y.l))
  })

  it('FAST mode recovers quicker and pumps differently', () => {
    const x = loudSoft()
    const normal = comp({ amount: 8, fast: false }, x)
    const fast = comp({ amount: 8, fast: true }, x)
    expect(normalizedDifference(normal.l, fast.l)).toBeGreaterThan(0.02)
    // right after the loud burst ends the fast compressor has released further than the normal one
    const t = Math.round(0.43 * SR)
    expect(rms(fast.l, t, t + 200)).toBeGreaterThanOrEqual(rms(normal.l, t, t + 200))
  })

  it('reports gain reduction while a loud signal plays (ACTIVE LED)', () => {
    const u = new CompressorUnit(SR)
    u.setParams({ amount: 8, fast: false })
    const loud = sineBurst(440, 0.2, SR, { amplitude: 0.8 })
    renderThrough(u, loud)
    expect(u.gainReduction).toBeGreaterThan(3)
  })
})

describe('effects.processing — Reverb', () => {
  const input = tone(1)

  it('lists the six documented types; each changes the signal and differs from the others', () => {
    expect(REVERB_TYPES).toEqual(['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'])
    const outs = REVERB_TYPES.map((_, type) => reverb({ type, dryWet: 10 }, input))
    outs.forEach((o, i) => expect(normalizedDifference(input, o.l), REVERB_TYPES[i]).toBeGreaterThan(0.05))
    expectPairwiseDistinct(outs, REVERB_TYPES)
  })

  it('decay grows from Booth to Cathedral and Spring has its own band-limited character', () => {
    const burst = noiseBurst(0.15, SR, 3, { amplitude: 0.5, length: 4 })
    const tail = (type: number) => decayTime(reverb({ type, dryWet: 10 }, burst).l, SR, 40)
    const booth = tail(1)
    const room = tail(0)
    const stage = tail(3)
    const hall = tail(4)
    const cathedral = tail(5)
    expect(booth).toBeLessThan(room)
    expect(room).toBeLessThan(stage)
    expect(stage).toBeLessThan(hall)
    expect(hall).toBeLessThan(cathedral)
    const spring = reverb({ type: 2, dryWet: 10 }, burst)
    const stageOut = reverb({ type: 3, dryWet: 10 }, burst)
    expect(bandFraction(spring.l, SR, 5000, 11000)).toBeLessThan(bandFraction(stageOut.l, SR, 5000, 11000) * 0.5)
    expect(normalizedDifference(stageOut.l, spring.l)).toBeGreaterThan(0.3)
  })

  it('Dry/Wet blends up to fully wet and Bright/Dark change the tone of the reverb', () => {
    expect(normalizedDifference(reverb({ dryWet: 3 }, input).l, reverb({ dryWet: 8 }, input).l)).toBeGreaterThan(0.05)
    const imp = impulse(0.5, SR)
    expect(Math.abs(reverb({ dryWet: 10 }, imp).l[0])).toBeLessThan(1e-6)
    expect(reverb({ dryWet: 0 }, imp).l[0]).toBeCloseTo(1, 6)
    const burst = noiseBurst(0.15, SR, 5, { amplitude: 0.5, length: 2 })
    const centroid = (tone: number) => spectralCentroid(window(reverb({ dryWet: 10, tone }, burst).l, 0.3, 2), SR)
    expect(centroid(1)).toBeGreaterThan(centroid(0) * 1.05)
    expect(centroid(2)).toBeLessThan(centroid(0) * 0.95)
  })
})

describe('effects.processing — Rotary', () => {
  const input = tone(1.5, 55)

  it('Slow and Fast differ, Drive changes the tone, and the horn / rotor give a stereo image', () => {
    const slow = rotary({ fast: false, drive: 2 }, input)
    const fast = rotary({ fast: true, drive: 2 }, input)
    expect(normalizedDifference(input, slow.l)).toBeGreaterThan(0.05)
    expect(normalizedDifference(slow.l, fast.l)).toBeGreaterThan(0.05)
    const driven = rotary({ fast: false, drive: 9 }, input)
    expect(normalizedDifference(slow.l, driven.l)).toBeGreaterThan(0.05)
    expect(stereoCorrelation(fast.l, fast.r)).toBeLessThan(0.98)
  })

  it('speed changes accelerate smoothly towards the documented rotor rates', () => {
    const u = new RotaryUnit(SR)
    u.setParams({ fast: false, drive: 0 })
    const silence = new Float32Array(Math.round(0.5 * SR))
    renderThrough(u, silence)
    expect(u.hornRate).toBeCloseTo(0.8, 3)
    u.setParams({ fast: true, drive: 0 })
    renderThrough(u, silence)
    expect(u.hornRate).toBeGreaterThan(1)
    expect(u.hornRate).toBeLessThan(6.5) // still accelerating after 0.5 s
    renderThrough(u, new Float32Array(Math.round(8 * SR)))
    expect(u.hornRate).toBeCloseTo(6.8, 1)
    expect(Math.abs(u.rotorRate - 5.7)).toBeLessThan(0.6)
  })
})

describe('effects.processing — Master level and limiter', () => {
  it('Master Level scales the output and the limiter keeps peaks below full scale', () => {
    const small = sineBurst(440, 0.5, SR, { amplitude: 0.1 })
    const at = (level: number) => {
      const u = new MasterUnit(SR)
      u.setParams({ level })
      return renderThrough(u, small)
    }
    const ratio = rms(at(5).l) / rms(at(10).l)
    expect(ratio).toBeCloseTo(masterKnobToGain(5) / masterKnobToGain(10), 2)
    expect(rms(at(0).l)).toBe(0)
    const hot = sineBurst(440, 0.5, SR, { amplitude: 4 })
    const u = new MasterUnit(SR)
    u.setParams({ level: 10 })
    const limited = renderThrough(u, hot)
    expect(peak(limited.l)).toBeLessThanOrEqual(1)
    expect(u.gainReduction).toBeGreaterThan(6)
  })
})

describe('effects.processing — Piano Timbre and String Res', () => {
  const white = noise(1)

  it('acoustic Soft darkens, Bright brightens, Mid lifts the 1.2 kHz band; Off and the Dyno settings pass through', () => {
    const off = timbre({ family: 'acoustic', setting: 0 }, white)
    expect(maxAbsDifference(white, off.l)).toBe(0)
    expect(effectiveTimbreSetting('acoustic', 4)).toBe(0)
    expect(maxAbsDifference(white, timbre({ family: 'acoustic', setting: 4 }, white).l)).toBe(0)
    const c0 = spectralCentroid(white, SR)
    expect(spectralCentroid(timbre({ family: 'acoustic', setting: 1 }, white).l, SR)).toBeLessThan(c0 * 0.9)
    expect(spectralCentroid(timbre({ family: 'acoustic', setting: 3 }, white).l, SR)).toBeGreaterThan(c0 * 1.05)
    expect(bandFraction(timbre({ family: 'acoustic', setting: 2 }, white).l, SR, 1000, 1400)).toBeGreaterThan(bandFraction(white, SR, 1000, 1400) * 1.3)
  })

  it('electric Soft / Mid / Bright / Dyno 1 / Dyno 2 are distinct', () => {
    const outs = [0, 1, 2, 3, 4, 5].map((setting) => timbre({ family: 'electric', setting }, white))
    expectPairwiseDistinct(outs, ['Off', 'Soft', 'Mid', 'Bright', 'Dyno 1', 'Dyno 2'], 0.03)
    expect(bandFraction(outs[4].l, SR, 3000, 4000)).toBeGreaterThan(bandFraction(white, SR, 3000, 4000) * 1.5)
    expect(bandFraction(outs[5].l, SR, 40, 150)).toBeGreaterThan(bandFraction(outs[4].l, SR, 40, 150) * 1.3)
  })

  it('String Res lets a held string ring sympathetically after the played note stops', () => {
    const played = harmonicTone(55, 0.3, SR, { length: 1.5 }) // G3: its second partial is the held G4 string
    const off = stringRes({ on: false, strings: [67], pedal: false }, played)
    expect(maxAbsDifference(played, off.l)).toBe(0)
    const on = stringRes({ on: true, strings: [67], pedal: false }, played)
    const tailOn = rms(on.l, Math.round(0.5 * SR), Math.round(1.0 * SR))
    const tailOff = rms(off.l, Math.round(0.5 * SR), Math.round(1.0 * SR))
    expect(tailOn).toBeGreaterThan(tailOff * 20 + 1e-6)
    const spec = magnitudeSpectrum(window(on.l, 0.5, 1.0), SR)
    const peakBin = spec.mags.indexOf(Math.max(...Array.from(spec.mags.subarray(1))))
    expect(Math.abs(peakBin * spec.binHz - 392)).toBeLessThan(15)
    const pedal = stringRes({ on: true, strings: [67], pedal: true }, played)
    expect(rms(pedal.l, Math.round(0.5 * SR), Math.round(1.0 * SR))).toBeGreaterThan(tailOn)
    expect(normalizedDifference(played, on.l)).toBeGreaterThan(0.01)
  })
})

describe('effects.processing — chain bypass and click-free switching', () => {
  const ALL_OFF: ChainOverrides = {
    timbre: { setting: 0 },
    stringRes: { on: false, strings: [] },
    mod1: { on: false },
    mod2: { on: false },
    delay: { on: false },
    ampEq: { on: false },
    compressor: { on: false },
    reverb: { on: false },
  }

  it('every unit switched on through the chain changes the rendered signal versus the bypassed chain', () => {
    const white = noise(1, 0.3)
    const bypassed = renderThrough(makeChain(SR, ALL_OFF).chain, white)
    expect(maxAbsDifference(white, bypassed.l)).toBe(0)
    // String Res is a deliberately subtle addition (about −18 dB of narrow-band resonance), hence its own threshold;
    // its audible ringing is proven separately on a tonal signal above.
    const cases: [string, ChainOverrides, number][] = [
      ['timbre', { timbre: { setting: 1 } }, 0.05],
      ['stringRes', { stringRes: { on: true, strings: [55, 62] } }, 0.002],
      ['mod1', { mod1: { on: true, type: 1, rate: 5, amount: 8 } }, 0.05],
      ['mod2', { mod2: { on: true, type: 0, rate: 5, amount: 8 } }, 0.05],
      ['delay', { delay: { on: true, seconds: 0.08, feedback: 6, dryWet: 6 } }, 0.05],
      ['ampEq', { ampEq: { on: true, model: 3, drive: 5 } }, 0.05],
      ['compressor', { compressor: { on: true, amount: 8 } }, 0.05],
      ['reverb', { reverb: { on: true, type: 4, dryWet: 7 } }, 0.05],
    ]
    for (const [name, on, threshold] of cases) {
      const out = renderThrough(makeChain(SR, { ...ALL_OFF, ...on }).chain, white)
      expect(normalizedDifference(bypassed.l, out.l), name).toBeGreaterThan(threshold)
    }
  })

  it('Layer Effects ON off bypasses Mod 1 … Reverb together while Timbre and String Res stay active', () => {
    const white = noise(1, 0.3)
    const fxOff = renderThrough(makeChain(SR, { ...ALL_OFF, effectsOn: false, delay: { on: true }, reverb: { on: true, dryWet: 8 } }).chain, white)
    expect(maxAbsDifference(white, fxOff.l)).toBe(0)
    const timbreOn = renderThrough(makeChain(SR, { ...ALL_OFF, effectsOn: false, timbre: { setting: 3 }, reverb: { on: true } }).chain, white)
    expect(normalizedDifference(white, timbreOn.l)).toBeGreaterThan(0.05)
  })

  it('toggling a unit mid-signal cross-fades without a click and the bypassed chain is bit-transparent afterwards', () => {
    const sine = sineBurst(440, 1, SR, { amplitude: 0.5 })
    const half = Math.round(0.5 * SR)
    const { chain, params } = makeChain(SR, { ...ALL_OFF, delay: { on: true, seconds: 0.05, feedback: 5, dryWet: 6 }, reverb: { on: true, type: 3, dryWet: 5 } })
    const out = sine.slice()
    const outR = sine.slice()
    chain.process(out.subarray(0, half), outR.subarray(0, half), half)
    chain.setParams({ ...params, delay: { ...params.delay, on: false }, reverb: { ...params.reverb, on: false } })
    chain.process(out.subarray(half), outR.subarray(half), out.length - half)
    expect(maxStep(out)).toBeLessThan(maxStep(sine) * 2.5)
    // 40 ms after the switch every unit has faded out and been reset: the chain is transparent again
    const after = Math.round(0.6 * SR)
    expect(chain.transparent).toBe(true)
    expect(maxAbsDifference(sine.subarray(after), out.subarray(after))).toBe(0)
    // and the dry signal never dropped out during the fade
    expect(rms(out, half, half + 400)).toBeGreaterThan(rms(sine, half, half + 400) * 0.7)
  })
})

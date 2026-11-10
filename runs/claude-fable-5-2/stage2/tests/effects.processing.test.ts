import { describe, expect, it } from 'vitest'
import { FxChain, Rotor, RotaryPath } from '../src/audio/dsp/effects'
import {
  AmpType,
  DelayFilter,
  Mod1Type,
  Mod2Type,
  ReverbTone,
  ReverbType,
  filterFrequency,
  midFrequency,
  mod1Rate,
  ringFrequency,
  type ChainSound,
} from '../src/audio/dsp/params'
import { AMP_TYPES, MOD1_TYPES, MOD2_TYPES, REVERB_TYPES } from '../src/state/model'
import { bandLevel, burst, chainSound, db, envelope, impulse, noise, runChain, silence, through, tone } from './support/fxbench'
import { SR, magnitudeAt, mono, peak, rms, rmsAt, timeToSilence } from './support/signal'
import { change, difference, fx, makeStage, renderStage } from './support/stage'

/**
 * Feature: effects.processing
 * Every unit and listed type measurably changes rendered audio.
 *
 * The units under test are the production DSP classes. Each is fed a standard deterministic
 * signal (fixed-seed noise, a sine, a burst, an impulse) through a real FxChain, 128 frames at
 * a time, and judged by tolerant relationships — never by exact waveforms.
 */

const NOISE = noise(1)
/** 1 kHz, so a 4 ms or 10 ms envelope window always holds whole cycles. */
const TONE = tone(1000, 1)
const CARRIER = 1000

/** Cycles per second of a slow amplitude modulation, counted with hysteresis so ripple is ignored. */
function modulationRate(signal: Float32Array, windowSeconds = 0.01): number {
  const env = envelope(signal, windowSeconds)
  const high = Math.max(...env)
  const low = Math.min(...env)
  const upper = low + (high - low) * 0.65
  const lower = low + (high - low) * 0.35
  let armed = env[0] < lower
  let count = 0
  for (const value of env) {
    if (armed && value > upper) {
      count += 1
      armed = false
    } else if (!armed && value < lower) {
      armed = true
    }
  }
  return count / (signal.length / SR)
}

function only(configure: (chain: ChainSound) => void) {
  return (chain: ChainSound) => {
    for (const unit of [chain.mod1, chain.mod2, chain.delay, chain.amp, chain.comp, chain.reverb]) unit.on = false
    configure(chain)
  }
}

describe('effects.processing: a unit that is off does nothing at all', () => {
  it('passes the signal through bit for bit when every unit is off', () => {
    const out = runChain(NOISE, only(() => undefined))
    expect(difference(NOISE.left, out.left)).toBe(0)
    expect(difference(NOISE.right, out.right)).toBe(0)
  })

  it('every unit, switched on by itself, changes the standard signal', () => {
    const units: Array<[string, (chain: ChainSound) => void]> = [
      ['mod1', (c) => void (c.mod1.on = true)],
      ['mod2', (c) => void (c.mod2.on = true)],
      ['delay', (c) => void (c.delay.on = true)],
      ['amp', (c) => void (c.amp.on = true)],
      ['comp', (c) => void (c.comp.on = true)],
      ['reverb', (c) => void (c.reverb.on = true)],
    ]
    for (const [name, enable] of units) {
      const out = runChain(NOISE, only(enable))
      expect(difference(NOISE.left, out.left), name).toBeGreaterThan(0.05)
      expect(rms(out.left), name).toBeGreaterThan(0.01)
    }
  })
})

describe('effects.processing: Mod 1', () => {
  const run = (type: number, rate: number, amount: number, input = TONE) =>
    runChain(input, only((c) => {
      c.mod1 = { on: true, type, rate, amount }
    }))

  it('all six types change the signal, and no two do the same thing', () => {
    expect(MOD1_TYPES).toHaveLength(6)
    const outs = MOD1_TYPES.map((_, type) => run(type, 0.6, 0.8, NOISE))
    outs.forEach((out, type) => expect(difference(NOISE.left, out.left), MOD1_TYPES[type]).toBeGreaterThan(0.1))
    for (let a = 0; a < outs.length; a += 1) {
      for (let b = a + 1; b < outs.length; b += 1) {
        const apart = Math.max(difference(outs[a].left, outs[b].left), difference(outs[a].right, outs[b].right))
        expect(apart, `${MOD1_TYPES[a]} vs ${MOD1_TYPES[b]}`).toBeGreaterThan(0.1)
      }
    }
  })

  it('A-Pan moves the signal between left and right at the LFO rate', () => {
    const out = run(Mod1Type.APan, 0.5, 1)
    const left = envelope(out.left, 0.02)
    const right = envelope(out.right, 0.02)
    // When one side is loud the other is quiet.
    let opposed = 0
    for (let k = 0; k < left.length; k += 1) opposed += (left[k] - rms(out.left)) * (right[k] - rms(out.right))
    expect(opposed).toBeLessThan(0)
    expect(Math.max(...left) / Math.min(...left)).toBeGreaterThan(4)
    // No panning at zero amount: both sides equal the input.
    const still = run(Mod1Type.APan, 0.5, 0)
    expect(difference(TONE.left, still.left)).toBeLessThan(1e-3)
  })

  it('Tremolo is at full level at zero amount and dips deeper as Amount rises', () => {
    const none = run(Mod1Type.Tremolo, 0.6, 0)
    expect(difference(TONE.left, none.left)).toBeLessThan(1e-3)
    const half = envelope(run(Mod1Type.Tremolo, 0.6, 0.5).left, 0.01)
    const full = envelope(run(Mod1Type.Tremolo, 0.6, 1).left, 0.01)
    const flat = rms(TONE.left)
    // The peaks stay at full level; only the dips change.
    expect(Math.max(...half) / flat).toBeGreaterThan(0.95)
    expect(Math.max(...full) / flat).toBeGreaterThan(0.95)
    expect(Math.min(...half) / flat).toBeLessThan(0.65)
    expect(Math.min(...full)).toBeLessThan(Math.min(...half) * 0.5)
  })

  it('Tremolo and Pump follow the Rate knob', () => {
    for (const type of [Mod1Type.Tremolo, Mod1Type.Pump]) {
      const cycles = (rate: number) => modulationRate(run(type, rate, 1, tone(CARRIER, 8)).left)
      expect(Math.abs(cycles(0.5) - mod1Rate(0.5))).toBeLessThan(0.2)
      expect(Math.abs(cycles(0.8) - mod1Rate(0.8))).toBeLessThan(0.5)
      expect(cycles(0.8)).toBeGreaterThan(cycles(0.5) * 3)
    }
  })

  it('Ring Mod multiplies by a sine: the carrier is replaced by two sidebands set by Rate', () => {
    const rate = 0.5
    const out = mono(run(Mod1Type.RingMod, rate, 1))
    const f = ringFrequency(rate)
    const carrier = magnitudeAt(mono(TONE), CARRIER)
    expect(magnitudeAt(out, CARRIER)).toBeLessThan(carrier * 0.05)
    expect(magnitudeAt(out, CARRIER + f)).toBeGreaterThan(carrier * 0.3)
    expect(magnitudeAt(out, Math.abs(CARRIER - f))).toBeGreaterThan(carrier * 0.3)
    // A different Rate moves the sidebands.
    const other = mono(run(Mod1Type.RingMod, 0.7, 1))
    expect(magnitudeAt(other, CARRIER + f)).toBeLessThan(magnitudeAt(out, CARRIER + f) * 0.2)
  })

  it('A-Wah opens with the playing level: a loud input comes out brighter than a quiet one', () => {
    const colour = (level: number) => {
      const out = mono(run(Mod1Type.AWah, 0.6, 1, noise(1, level)))
      return bandLevel(out.subarray(SR / 4), 1500, 4000) / bandLevel(out.subarray(SR / 4), 250, 500)
    }
    expect(colour(0.3)).toBeGreaterThan(colour(0.01) * 3)
    // The Rate knob is the sensitivity.
    const sens = (rate: number) => {
      const out = mono(run(Mod1Type.AWah, rate, 1, noise(1, 0.05)))
      return bandLevel(out.subarray(SR / 4), 1500, 4000) / bandLevel(out.subarray(SR / 4), 250, 500)
    }
    expect(sens(1)).toBeGreaterThan(sens(0.1) * 2)
  })

  it('Wah sweeps a resonant low-pass: the treble comes and goes with the LFO', () => {
    const out = mono(run(Mod1Type.Wah, 0.45, 1, noise(2)))
    const window = Math.round(SR * 0.05)
    const levels: number[] = []
    for (let start = 0; start + window <= out.length; start += window) {
      levels.push(bandLevel(out.subarray(start, start + window), 2500, 6000, 4))
    }
    expect(Math.max(...levels) / Math.min(...levels)).toBeGreaterThan(4)
    // Amount is the dry/wet mix.
    expect(difference(NOISE.left, run(Mod1Type.Wah, 0.45, 0, NOISE).left)).toBeLessThan(1e-3)
  })

  it('Pump ducks quickly at the top of each cycle and recovers slowly', () => {
    const env = envelope(run(Mod1Type.Pump, 0.4, 1, tone(CARRIER, 3)).left, 0.004)
    const flat = rms(TONE.left)
    const lowest = env.indexOf(Math.min(...env.subarray(20)))
    expect(env[lowest] / flat).toBeLessThan(0.25)
    // Asymmetric: it takes far longer to come back up than it took to go down.
    let down = lowest
    while (down > 0 && env[down] < flat * 0.9) down -= 1
    let up = lowest
    while (up < env.length - 1 && env[up] < flat * 0.9) up += 1
    expect(up - lowest).toBeGreaterThan((lowest - down) * 3)
  })
})

describe('effects.processing: Mod 2', () => {
  const run = (type: number, rate: number, amount: number, input = NOISE) =>
    runChain(input, only((c) => {
      c.mod2 = { on: true, type, rate, amount }
    }))

  it('all six types change the signal, and no two do the same thing', () => {
    expect(MOD2_TYPES).toHaveLength(6)
    const outs = MOD2_TYPES.map((_, type) => run(type, 0.6, 0.6))
    outs.forEach((out, type) => expect(difference(NOISE.left, out.left), MOD2_TYPES[type]).toBeGreaterThan(0.15))
    for (let a = 0; a < outs.length; a += 1) {
      for (let b = a + 1; b < outs.length; b += 1) {
        expect(difference(outs[a].left, outs[b].left), `${MOD2_TYPES[a]} vs ${MOD2_TYPES[b]}`).toBeGreaterThan(0.15)
      }
    }
  })

  it('Amount changes every type', () => {
    MOD2_TYPES.forEach((name, type) => {
      const low = run(type, 0.6, 0.1)
      const high = run(type, 0.6, 0.9)
      expect(Math.max(difference(low.left, high.left), difference(low.right, high.right)), name).toBeGreaterThan(0.1)
    })
  })

  it('Rate changes every type', () => {
    MOD2_TYPES.forEach((name, type) => {
      const slow = run(type, 0.2, 0.6, noise(2))
      const fast = run(type, 0.8, 0.6, noise(2))
      expect(Math.max(difference(slow.left, fast.left), difference(slow.right, fast.right)), name).toBeGreaterThan(0.05)
    })
  })

  it('Chorus widens: left and right differ, and above half Amount a second voice thickens it', () => {
    const out = run(Mod2Type.Chorus, 0.9, 0.6, TONE)
    expect(difference(out.left, out.right)).toBeGreaterThan(0.2)
    // Detuning: energy appears beside the carrier.
    const side = (signal: Float32Array) => bandLevel(signal, 960, 990, 8) + bandLevel(signal, 1010, 1040, 8)
    expect(side(out.left)).toBeGreaterThan(side(TONE.left) * 3)
    const thin = run(Mod2Type.Chorus, 0.5, 0.5)
    const thick = run(Mod2Type.Chorus, 0.5, 1)
    expect(rms(thick.left)).toBeGreaterThan(rms(thin.left) * 1.05)
  })

  it('Flanger is a comb filter with feedback: static resonant peaks at zero Amount, a sweep above it', () => {
    const still = mono(run(Mod2Type.Flanger, 0.5, 0, noise(2)))
    // Delay 0.7 ms: peaks every ~1429 Hz, notches halfway between.
    const peakLevel = bandLevel(still, 1400, 1460, 4)
    const notchLevel = bandLevel(still, 690, 740, 4)
    expect(peakLevel / notchLevel).toBeGreaterThan(4)
    // Static: the first and second half have the same spectrum.
    const half = still.length / 2
    expect(bandLevel(still.subarray(0, half), 690, 740, 4) / bandLevel(still.subarray(half), 690, 740, 4)).toBeGreaterThan(0.6)
    const swept = mono(run(Mod2Type.Flanger, 0.5, 0.8, noise(2)))
    expect(bandLevel(swept, 1400, 1460, 4) / bandLevel(swept, 690, 740, 4)).toBeLessThan(peakLevel / notchLevel / 2)
  })

  it('Phaser sweeps notches, and Amount adds feedback colour (none at minimum)', () => {
    const plain = mono(run(Mod2Type.Phaser, 0.5, 0, noise(2)))
    const coloured = mono(run(Mod2Type.Phaser, 0.5, 1, noise(2)))
    const window = Math.round(SR * 0.05)
    const motion = (signal: Float32Array) => {
      const levels: number[] = []
      for (let start = 0; start + window <= signal.length; start += window) {
        levels.push(bandLevel(signal.subarray(start, start + window), 600, 800, 3))
      }
      return Math.max(...levels) / Math.min(...levels)
    }
    expect(motion(plain)).toBeGreaterThan(1.8)
    expect(motion(coloured)).toBeGreaterThan(motion(plain) * 1.3)
  })

  it('Vibe bends pitch as well as phase: a steady tone gains sidebands', () => {
    const out = mono(run(Mod2Type.Vibe, 1, 1, tone(CARRIER, 2)))
    const dry = mono(tone(CARRIER, 2))
    const side = (signal: Float32Array) => bandLevel(signal, 960, 992, 8) + bandLevel(signal, 1008, 1040, 8)
    expect(side(out)).toBeGreaterThan(side(dry) * 5)
  })

  it('Ensemble is three modulated lines: wide, and thicker than Chorus on a steady tone', () => {
    const ens = run(Mod2Type.Ensemble, 0.5, 0.7, tone(CARRIER, 2))
    expect(difference(ens.left, ens.right)).toBeGreaterThan(0.2)
    // The fast 5–6 Hz component of the modulation shows up as amplitude ripple.
    const env = envelope(ens.left, 0.01)
    expect(Math.max(...env.subarray(10)) / Math.min(...env.subarray(10))).toBeGreaterThan(1.15)
  })

  it('Spin ramps to a new Rate instead of jumping', () => {
    const spin = (rate: number) => chainSound(only((c) => {
      c.mod2 = { on: true, type: Mod2Type.Spin, rate, amount: 1 }
    }))
    // One chain, with the Rate knob turned up after two seconds.
    const chain = new FxChain(SR)
    chain.configure(spin(0.3))
    const turnAt = Math.round((2 * SR) / 128)
    const out = through(tone(CARRIER, 8), (left, right, frames, block) => {
      if (block === turnAt) chain.configure(spin(0.9))
      chain.process(left, right, frames, true)
    })
    const rateIn = (from: number, to: number) => modulationRate(out.left.subarray(from * SR, to * SR))
    const before = rateIn(0, 2)
    const justAfter = rateIn(2, 3)
    const later = rateIn(6, 8)
    expect(later).toBeGreaterThan(before * 4)
    // Still on its way up one second after the knob moved.
    expect(justAfter).toBeGreaterThan(before)
    expect(justAfter).toBeLessThan(later * 0.8)
  })
})

describe('effects.processing: Delay', () => {
  const run = (configure: (c: ChainSound) => void, input = impulse(3)) =>
    runChain(input, only((c) => {
      c.delay = { on: true, time: 0.25, feedback: 0.6, mix: 0.5, filter: DelayFilter.Off, pingPong: false }
      configure(c)
    }))
  const tapPeak = (signal: Float32Array, seconds: number) =>
    peak(signal.subarray(Math.round(seconds * SR) - 240, Math.round(seconds * SR) + 240))

  it('repeats the input after the set time, and again after each further interval', () => {
    const out = mono(run(() => undefined))
    expect(tapPeak(out, 0.25)).toBeGreaterThan(0.05)
    expect(tapPeak(out, 0.5)).toBeGreaterThan(0.02)
    expect(tapPeak(out, 0.375)).toBeLessThan(1e-4)
    // Tempo moves the repeats.
    const longer = mono(run((c) => void (c.delay.time = 0.4)))
    expect(tapPeak(longer, 0.25)).toBeLessThan(1e-4)
    expect(tapPeak(longer, 0.4)).toBeGreaterThan(0.05)
  })

  it('Feedback sets how many repeats there are: one at minimum, a long tail at maximum', () => {
    const none = mono(run((c) => void (c.delay.feedback = 0)))
    expect(tapPeak(none, 0.25)).toBeGreaterThan(0.05)
    expect(tapPeak(none, 0.5)).toBeLessThan(1e-5)
    const lots = mono(run((c) => void (c.delay.feedback = 1)))
    expect(tapPeak(lots, 2.5)).toBeGreaterThan(tapPeak(lots, 0.25) * 0.3)
    const some = mono(run((c) => void (c.delay.feedback = 0.5)))
    expect(tapPeak(some, 0.5) / tapPeak(some, 0.25)).toBeCloseTo(0.93 * 0.5, 1)
  })

  it('Dry/Wet balances the input against the repeats', () => {
    const dry = mono(run((c) => void (c.delay.mix = 0)))
    expect(dry[0]).toBeCloseTo(0.5, 3)
    expect(tapPeak(dry, 0.25)).toBeLessThan(1e-4)
    const wet = mono(run((c) => void (c.delay.mix = 1)))
    expect(Math.abs(wet[0])).toBeLessThan(1e-4)
    expect(tapPeak(wet, 0.25)).toBeGreaterThan(0.3)
  })

  it('each feedback filter gives a different tail', () => {
    const input = burst(0.03, 3)
    const outs = [DelayFilter.Off, DelayFilter.LP, DelayFilter.BP, DelayFilter.HP].map((filter) =>
      mono(run((c) => void (c.delay.filter = filter), input)),
    )
    for (let a = 0; a < outs.length; a += 1) {
      for (let b = a + 1; b < outs.length; b += 1) expect(difference(outs[a], outs[b]), `${a} vs ${b}`).toBeGreaterThan(0.1)
    }
  })

  it('Ping Pong sends alternate repeats to opposite sides', () => {
    const out = run((c) => void (c.delay.pingPong = true))
    const side = (seconds: number) => tapPeak(out.left, seconds) - tapPeak(out.right, seconds)
    expect(side(0.25)).toBeGreaterThan(0.05)
    expect(side(0.5)).toBeLessThan(-0.02)
    expect(side(0.75)).toBeGreaterThan(0.01)
    // Without it both sides carry every repeat.
    const plain = run(() => undefined)
    expect(Math.abs(tapPeak(plain.left, 0.25) - tapPeak(plain.right, 0.25))).toBeLessThan(1e-6)
  })
})

describe('effects.processing: Amp Sim / EQ', () => {
  const run = (configure: (c: ChainSound) => void, input = NOISE) =>
    runChain(input, only((c) => {
      c.amp = { on: true, type: AmpType.EqOnly, drive: 0, bass: 0, mid: 0, freq: 0.5, treble: 0 }
      configure(c)
    }))
  const gainDb = (out: Float32Array, low: number, high: number) =>
    db(bandLevel(out.subarray(SR / 10), low, high) / bandLevel(NOISE.left.subarray(SR / 10), low, high))

  it('all seven types are selectable; Twin, JC, Small, and the two filters each sound different', () => {
    expect(AMP_TYPES).toHaveLength(7)
    const outs = AMP_TYPES.map((_, type) => run((c) => {
      c.amp.type = type
      c.amp.drive = 0.5
      c.amp.mid = 4
    }).left)
    const audible = [AmpType.Twin, AmpType.JC, AmpType.Small, AmpType.LP24, AmpType.HP24, AmpType.EqOnly]
    for (const a of audible) {
      expect(difference(NOISE.left, outs[a]), AMP_TYPES[a]).toBeGreaterThan(0.1)
      for (const b of audible) {
        if (b > a) expect(difference(outs[a], outs[b]), `${AMP_TYPES[a]} vs ${AMP_TYPES[b]}`).toBeGreaterThan(0.15)
      }
    }
    // To Rotary is a routing choice: in the chain itself it is the plain EQ (the Rotary follows the Reverb).
    expect(difference(outs[AmpType.ToRotary], outs[AmpType.EqOnly])).toBe(0)
  })

  it('EQ only at flat settings and zero Drive is transparent', () => {
    expect(difference(NOISE.left, run(() => undefined).left)).toBeLessThan(1e-4)
  })

  it('Bass acts at 100 Hz and Treble at 4 kHz, by up to ±15 dB', () => {
    const bassUp = run((c) => void (c.amp.bass = 15)).left
    expect(gainDb(bassUp, 30, 60)).toBeGreaterThan(11)
    expect(Math.abs(gainDb(bassUp, 2000, 8000))).toBeLessThan(1.5)
    const bassDown = run((c) => void (c.amp.bass = -15)).left
    expect(gainDb(bassDown, 30, 60)).toBeLessThan(-11)
    const trebleUp = run((c) => void (c.amp.treble = 15)).left
    expect(gainDb(trebleUp, 9000, 15000)).toBeGreaterThan(11)
    expect(Math.abs(gainDb(trebleUp, 60, 300))).toBeLessThan(1.5)
    const trebleDown = run((c) => void (c.amp.treble = -15)).left
    expect(gainDb(trebleDown, 9000, 15000)).toBeLessThan(-11)
  })

  it('Mid is a sweepable band: Freq moves it between 200 Hz and 8 kHz', () => {
    expect(midFrequency(0)).toBeCloseTo(200, 6)
    expect(midFrequency(1)).toBeCloseTo(8000, 6)
    for (const knob of [0.1, 0.5, 0.9]) {
      const centre = midFrequency(knob)
      const out = run((c) => {
        c.amp.mid = 12
        c.amp.freq = knob
      }).left
      expect(gainDb(out, centre * 0.9, centre * 1.1), `boost at ${centre}`).toBeGreaterThan(8)
      const away = centre < 1000 ? centre * 8 : centre / 8
      expect(Math.abs(gainDb(out, away * 0.9, away * 1.1)), `flat at ${away}`).toBeLessThan(2.5)
    }
    const cut = run((c) => {
      c.amp.mid = -12
      c.amp.freq = 0.5
    }).left
    expect(gainDb(cut, midFrequency(0.5) * 0.9, midFrequency(0.5) * 1.1)).toBeLessThan(-8)
  })

  it('Drive adds harmonics to a pure tone, more the further it is turned', () => {
    const harmonics = (drive: number, type: number = AmpType.EqOnly) => {
      const out = run((c) => {
        c.amp.type = type
        c.amp.drive = drive
      }, tone(220, 1, 0.5)).left
      return (magnitudeAt(out, 660) + magnitudeAt(out, 1100)) / magnitudeAt(out, 220)
    }
    expect(harmonics(0)).toBeLessThan(1e-3)
    expect(harmonics(0.5)).toBeGreaterThan(0.03)
    expect(harmonics(1)).toBeGreaterThan(harmonics(0.5) * 1.3)
    // Each amp model overdrives too.
    for (const type of [AmpType.Twin, AmpType.JC, AmpType.Small]) {
      expect(harmonics(1, type), AMP_TYPES[type]).toBeGreaterThan(harmonics(0.1, type) * 1.5)
    }
  })

  it('the three amp models have distinct voicings', () => {
    const response = (type: number) => {
      const out = run((c) => {
        c.amp.type = type
        c.amp.drive = 0.1
      }).left
      return { low: gainDb(out, 80, 160), mid: gainDb(out, 800, 1400), high: gainDb(out, 5500, 9000) }
    }
    const twin = response(AmpType.Twin)
    const jc = response(AmpType.JC)
    const small = response(AmpType.Small)
    // Small: no bass and no top, a pronounced mid-range.
    expect(small.mid - small.low).toBeGreaterThan(8)
    expect(small.mid - small.high).toBeGreaterThan(10)
    // JC keeps far more treble than Twin; Twin keeps far more bass than Small.
    expect(jc.high - twin.high).toBeGreaterThan(3)
    expect(twin.low - small.low).toBeGreaterThan(6)
    // Twin scoops its mids relative to its treble region below the cabinet rolloff.
    expect(jc.high - small.high).toBeGreaterThan(10)
  })

  it('LP24 and HP24 are 24 dB/octave filters with Freq as cutoff and Res as resonance', () => {
    const cutoff = filterFrequency(0.5)
    const lp = run((c) => {
      c.amp.type = AmpType.LP24
      c.amp.mid = -15
    }).left
    // One octave above the cutoff is about 24 dB down; two octaves, about 48.
    expect(gainDb(lp, cutoff * 1.9, cutoff * 2.1)).toBeLessThan(-18)
    expect(gainDb(lp, cutoff * 1.9, cutoff * 2.1)).toBeGreaterThan(-32)
    expect(gainDb(lp, cutoff * 3.8, cutoff * 4.2)).toBeLessThan(-40)
    expect(Math.abs(gainDb(lp, cutoff / 8, cutoff / 4))).toBeLessThan(1.5)

    const hp = run((c) => {
      c.amp.type = AmpType.HP24
      c.amp.mid = -15
    }).left
    expect(gainDb(hp, cutoff / 2.1, cutoff / 1.9)).toBeLessThan(-18)
    expect(gainDb(hp, cutoff / 4.2, cutoff / 3.8)).toBeLessThan(-40)
    expect(Math.abs(gainDb(hp, cutoff * 4, cutoff * 8))).toBeLessThan(1.5)

    // Freq moves the cutoff.
    const lower = run((c) => {
      c.amp.type = AmpType.LP24
      c.amp.mid = -15
      c.amp.freq = 0.3
    }).left
    expect(gainDb(lower, cutoff * 0.9, cutoff * 1.1)).toBeLessThan(gainDb(lp, cutoff * 0.9, cutoff * 1.1) - 20)

    // Res raises a peak at the cutoff.
    const resonant = run((c) => {
      c.amp.type = AmpType.LP24
      c.amp.mid = 15
    }).left
    expect(gainDb(resonant, cutoff * 0.95, cutoff * 1.05)).toBeGreaterThan(gainDb(lp, cutoff * 0.95, cutoff * 1.05) + 10)
  })
})

describe('effects.processing: Compressor', () => {
  const run = (amount: number, fast: boolean, input: ReturnType<typeof tone>) =>
    runChain(input, only((c) => {
      c.comp = { on: true, amount, fast }
    }))
  const steady = (signal: Float32Array) => rmsAt(signal, 0.15, 0.1)

  it('higher amounts reduce dynamic range: loud and quiet come out closer together', () => {
    const loud = burst(0.3, 1, 0.8, 440)
    const quiet = burst(0.3, 1, 0.05, 440)
    const range = (amount: number) => db(steady(run(amount, false, loud).left) / steady(run(amount, false, quiet).left))
    const input = db(0.8 / 0.05)
    expect(range(0)).toBeLessThan(input - 1)
    expect(range(0.5)).toBeLessThan(range(0) - 6)
    expect(range(1)).toBeLessThan(range(0.5) - 2)
    expect(range(1)).toBeLessThan(8)
    // Quiet material comes up (make-up gain), loud material comes down.
    expect(steady(run(1, false, quiet).left)).toBeGreaterThan(steady(quiet.left) * 1.5)
    expect(steady(run(1, false, loud).left)).toBeLessThan(steady(loud.left) * 0.5)
  })

  it('Fast mode recovers sooner after a loud hit', () => {
    // A loud burst, then a quiet steady tone: how quickly does the quiet tone come back up?
    const signal = tone(440, 2, 0.05)
    const hit = burst(0.2, 2, 0.9, 440)
    for (let i = 0; i < Math.round(0.2 * SR); i += 1) {
      signal.left[i] = hit.left[i]
      signal.right[i] = hit.right[i]
    }
    const slow = run(1, false, signal).left
    const fast = run(1, true, signal).left
    const justAfter = (out: Float32Array) => rmsAt(out, 0.24, 0.05)
    const settled = (out: Float32Array) => rmsAt(out, 1.8, 0.1)
    expect(justAfter(fast)).toBeGreaterThan(justAfter(slow) * 1.5)
    expect(settled(fast) / settled(slow)).toBeGreaterThan(0.85)
    expect(settled(fast) / settled(slow)).toBeLessThan(1.2)
    // Both were pushed down by the hit and came back.
    expect(justAfter(slow)).toBeLessThan(settled(slow) * 0.8)
  })
})

describe('effects.processing: Reverb', () => {
  const run = (type: number, configure: (c: ChainSound) => void = () => undefined, input = burst(0.05, 8)) =>
    runChain(input, only((c) => {
      c.reverb = { on: true, type, tone: ReverbTone.Off, mix: 1 }
      configure(c)
    }))
  /** Seconds for the tail to fall 40 dB below its level just after the burst. */
  const decay = (out: Float32Array) => {
    const env = envelope(out, 0.02)
    const reference = Math.max(...env.subarray(3, 12))
    let last = 0
    for (let k = 3; k < env.length; k += 1) if (env[k] > reference * 0.01) last = k
    return last * 0.02
  }

  it('all six types are distinct', () => {
    expect(REVERB_TYPES).toHaveLength(6)
    const outs = REVERB_TYPES.map((_, type) => mono(run(type)))
    outs.forEach((out, type) => expect(rms(out), REVERB_TYPES[type]).toBeGreaterThan(1e-3))
    for (let a = 0; a < outs.length; a += 1) {
      for (let b = a + 1; b < outs.length; b += 1) {
        expect(difference(outs[a], outs[b]), `${REVERB_TYPES[a]} vs ${REVERB_TYPES[b]}`).toBeGreaterThan(0.3)
      }
    }
  })

  it('decay grows from Booth (very short) through Room, Stage, Hall to Cathedral (very long)', () => {
    const order = [ReverbType.Booth, ReverbType.Room, ReverbType.Stage, ReverbType.Hall, ReverbType.Cathedral]
    const times = order.map((type) => decay(mono(run(type))))
    for (let k = 1; k < times.length; k += 1) expect(times[k], REVERB_TYPES[order[k]]).toBeGreaterThan(times[k - 1] * 1.4)
    expect(times[0]).toBeLessThan(0.35)
    expect(times[4]).toBeGreaterThan(3)
  })

  it('Spring has its own character: band-limited, and it chirps', () => {
    const spring = mono(run(ReverbType.Spring, undefined, impulse(4)))
    const room = mono(run(ReverbType.Room, undefined, impulse(4)))
    // Band-limited: almost nothing at the top, unlike a room.
    const top = (out: Float32Array) => bandLevel(out, 8000, 14000) / bandLevel(out, 600, 1500)
    expect(top(spring)).toBeLessThan(top(room) * 0.2)
    // Dispersion ("boing"): in each echo the high frequencies arrive before the low ones.
    const arrival = (low: number, high: number) => {
      const window = Math.round(SR * 0.004)
      let best = 0
      let at = 0
      for (let start = 0; start < SR * 0.2; start += window / 2) {
        const level = bandLevel(spring.subarray(start, start + window), low, high, 3)
        if (level > best) {
          best = level
          at = start
        }
      }
      return at / SR
    }
    expect(arrival(300, 500)).toBeGreaterThan(arrival(2500, 3500) + 0.003)
    expect(decay(spring)).toBeGreaterThan(0.5)
  })

  it('Dry/Wet runs from all dry to fully wet at maximum', () => {
    const input = impulse(2)
    const dry = mono(run(ReverbType.Hall, (c) => void (c.reverb.mix = 0), input))
    expect(dry[0]).toBeCloseTo(0.5, 4)
    expect(rmsAt(dry, 0.05, 1)).toBeLessThan(1e-6)
    const wet = mono(run(ReverbType.Hall, (c) => void (c.reverb.mix = 1), input))
    // Fully wet: the direct impulse is gone, only the tail remains.
    expect(Math.abs(wet[0])).toBeLessThan(1e-6)
    expect(rmsAt(wet, 0.05, 1)).toBeGreaterThan(1e-3)
    const half = mono(run(ReverbType.Hall, (c) => void (c.reverb.mix = 0.5), input))
    expect(half[0]).toBeGreaterThan(0.3)
    expect(rmsAt(half, 0.05, 1)).toBeGreaterThan(rmsAt(wet, 0.05, 1) * 0.5)
  })

  it('Bright keeps the top and thins the bottom; Dark does the opposite', () => {
    const balance = (toneSetting: number) => {
      const out = mono(run(ReverbType.Hall, (c) => void (c.reverb.tone = toneSetting), noise(2)))
      return db(bandLevel(out, 4000, 9000) / bandLevel(out, 100, 250))
    }
    const off = balance(ReverbTone.Off)
    expect(balance(ReverbTone.Bright)).toBeGreaterThan(off + 4)
    expect(balance(ReverbTone.Dark)).toBeLessThan(off - 6)
  })
})

describe('effects.processing: Rotary', () => {
  function rotary(fast: boolean, stop: boolean, drive: number, input = tone(1500, 6)) {
    const rotor = new Rotor(SR)
    rotor.configure(fast, stop, drive)
    const path = new RotaryPath(SR, rotor)
    const out = through(input, (left, right, frames) => {
      rotor.advance(frames)
      path.process(left, right, frames, true)
    })
    return { out, rotor }
  }

  it('modulates level and pitch, in opposite phase on the two sides', () => {
    const { out } = rotary(true, false, 0, tone(1500, 3))
    const left = envelope(out.left.subarray(SR), 0.01)
    const right = envelope(out.right.subarray(SR), 0.01)
    expect(Math.max(...left) / Math.min(...left)).toBeGreaterThan(1.8)
    let opposed = 0
    const meanL = left.reduce((a, b) => a + b, 0) / left.length
    const meanR = right.reduce((a, b) => a + b, 0) / right.length
    for (let k = 0; k < left.length; k += 1) opposed += (left[k] - meanL) * (right[k] - meanR)
    expect(opposed).toBeLessThan(0)
    // Doppler: the tone is spread to either side of 1500 Hz.
    const side = (signal: Float32Array) => bandLevel(signal, 1470, 1495, 6) + bandLevel(signal, 1505, 1530, 6)
    expect(side(out.left.subarray(SR))).toBeGreaterThan(side(tone(1500, 2).left) * 5)
  })

  it('has a horn and a bass rotor: treble and bass are modulated at different speeds', () => {
    const { rotor } = rotary(true, false, 0, silence(8))
    expect(rotor.hornSpeed).toBeGreaterThan(6)
    expect(rotor.drumSpeed).toBeGreaterThan(4.5)
    expect(rotor.hornSpeed).toBeGreaterThan(rotor.drumSpeed + 0.3)
    const bass = rotary(true, false, 0, tone(150, 3)).out
    const env = envelope(bass.left.subarray(SR), 0.01)
    expect(Math.max(...env) / Math.min(...env)).toBeGreaterThan(1.3)
  })

  it('Slow and Fast are different speeds, and the change accelerates smoothly', () => {
    const slow = modulationRate(rotary(false, false, 0, tone(1500, 8)).out.left)
    expect(slow).toBeGreaterThan(0.6)
    expect(slow).toBeLessThan(1.1)
    const fast = modulationRate(rotary(true, false, 0, tone(1500, 8)).out.left.subarray(SR * 4))
    expect(fast).toBeGreaterThan(5.5)
    // Start slow, then switch to fast: the horn speed climbs over time rather than jumping.
    const rotor = new Rotor(SR)
    rotor.configure(true, false, 0)
    const speeds: number[] = []
    for (let block = 0; block < (SR * 6) / 128; block += 1) {
      rotor.advance(128)
      if (block % 75 === 0) speeds.push(rotor.hornSpeed)
    }
    expect(speeds[1]).toBeLessThan(3)
    expect(speeds[2]).toBeGreaterThan(speeds[1])
    for (let k = 1; k < speeds.length; k += 1) expect(speeds[k]).toBeGreaterThanOrEqual(speeds[k - 1])
    expect(speeds.at(-1)).toBeGreaterThan(6.5)
    // The heavy bass rotor takes much longer than the horn.
    const lag = new Rotor(SR)
    lag.configure(true, false, 0)
    for (let block = 0; block < SR / 128; block += 1) lag.advance(128)
    expect(lag.hornSpeed / 6.7).toBeGreaterThan((lag.drumSpeed / 5.9) * 1.5)
  })

  it('Stop Mode makes the slow position stop the rotors', () => {
    const { rotor, out } = rotary(false, true, 0, tone(1500, 30))
    expect(rotor.hornSpeed).toBeLessThan(0.01)
    expect(rotor.drumSpeed).toBeLessThan(0.01)
    const tail = envelope(out.left.subarray(SR * 29), 0.01)
    expect(Math.max(...tail) / Math.min(...tail)).toBeLessThan(1.02)
  })

  it('Drive overdrives the signal before the rotors', () => {
    const harmonics = (drive: number) => {
      const { out } = rotary(false, true, drive, tone(220, 12, 0.5))
      const settled = out.left.subarray(SR * 11)
      return magnitudeAt(settled, 660) / magnitudeAt(settled, 220)
    }
    expect(harmonics(0)).toBeLessThan(1e-3)
    expect(harmonics(1)).toBeGreaterThan(0.05)
  })
})

describe('effects.processing: inside the instrument', () => {
  it('every unit changes the rendered sound of a real piano note', async () => {
    const play = async (configure: (c: ChainSound) => void) => {
      const kernel = await makeStage()
      change(kernel, (sound) => configure(fx(sound)))
      kernel.noteOn(60, 0.8)
      kernel.noteOn(67, 0.8)
      return mono(renderStage(kernel, 1.2))
    }
    const dry = await play(() => undefined)
    expect(rms(dry)).toBeGreaterThan(0.01)
    const units: Array<[string, (c: ChainSound) => void]> = [
      ['Mod 1', (c) => void (c.mod1.on = true)],
      ['Mod 2', (c) => void (c.mod2.on = true)],
      ['Delay', (c) => void (c.delay.on = true)],
      ['Amp Sim/EQ', (c) => void (c.amp.on = true)],
      ['Compressor', (c) => void (c.comp.on = true)],
      ['Reverb', (c) => void (c.reverb.on = true)],
      ['Rotary', (c) => {
        c.amp.on = true
        c.amp.type = AmpType.ToRotary
      }],
    ]
    for (const [name, enable] of units) {
      const wet = await play(enable)
      expect(difference(dry, wet), name).toBeGreaterThan(0.05)
      expect(timeToSilence(wet, 1e-4), name).toBeGreaterThan(0.5)
    }
  })
})

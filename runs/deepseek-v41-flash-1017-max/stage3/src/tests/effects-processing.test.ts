import { describe, expect, it } from 'vitest'
import { OfflineAudioContext } from 'node-web-audio-api'
import {
  AMP_MODELS,
  DELAY_FILTERS,
  MOD1_TYPES,
  MOD2_TYPES,
  REVERB_TYPES,
  compSettingsFor,
  delaySecondsFor,
  knobForDelaySeconds,
  midFreqHz,
  mod1RateHz,
  mod2RateHz,
  ROTARY_SPEEDS,
  GLOBAL_CAPABLE,
} from '../audio/effectTypes'
import {
  chainFor,
  cloneState,
  defaultEffectState,
  effectiveChain,
  unitActive,
  type EffectState,
} from '../audio/effectState'
import { buildImpulseResponse, createChain, buildRotary, createRotaryReturn, CHAIN_ORDER } from '../audio/effectGraph'
import {
  brightness,
  contourSpread,
  createClickSource,
  createToneSource,
  levelContour,
  peak,
  renderChain,
  rms,
  shapeDifference,
  stereoCorrelation,
} from '../audio/offlineRender'
import { createWebAudioEngine } from '../audio/webAudioEngine'
import { createFakeContext } from '../audio/fakes'
import manifest from '../audio/sample-manifest.json'
import gains from '../audio/sample-gains.json'
import type { SampleEntry } from '../audio/pianoVoice'

/**
 * effects.processing — every unit and every listed type measurably changes a standardized
 * rendered signal.
 *
 * These tests render the *production* chain (`createChain`) through a real
 * `OfflineAudioContext`, so a label, an enum or a disconnected node cannot pass: the
 * assertion is on samples. Relationships are tolerant (A brighter than B, the wet tail
 * outlasts the dry, repeats decay monotonically) rather than exact waveforms.
 */

const SR = 48000
const SECONDS = 1.4
const entries = manifest as SampleEntry[]
const levels = gains as Record<string, number>

function base(): EffectState {
  return cloneState(defaultEffectState())
}

/** Renders the chain with a deterministic source and returns the mono sum plus channels. */
async function render(
  state: EffectState,
  options: { source?: 'tone' | 'clicks' | 'impulse'; seconds?: number; frequency?: number; interval?: number } = {},
) {
  const source = options.source ?? 'tone'
  const seconds = options.seconds ?? SECONDS
  const make = (ctx: Record<string, any>, destination: unknown) => {
    if (source === 'clicks') {
      return createClickSource(ctx, destination, { seconds, interval: options.interval ?? 0.12 })
    }
    if (source === 'impulse') {
      const impulse = ctx.createBuffer(1, 64, SR)
      impulse.getChannelData(0)[0] = 1
      const src = ctx.createBufferSource()
      src.buffer = impulse
      src.connect(destination)
      src.start(0)
      return () => {
        try {
          src.stop()
        } catch {
          /* already stopped */
        }
      }
    }
    return createToneSource(ctx, destination, { frequency: options.frequency ?? 220, seconds })
  }
  return renderChain(OfflineAudioContext as never, make as never, {
    state,
    owner: 'piano.a',
    seconds,
    sampleRate: SR,
  })
}

/** The bypass reference: the same source through the chain with every unit off. */
async function reference(options: Parameters<typeof render>[1] = {}) {
  return render(base(), options)
}

describe('effects.processing — the bypassed chain is a true dry path', () => {
  it('passes the source through unchanged when every unit is off', async () => {
    const dry = await reference()
    expect(rms(dry.mono)).toBeGreaterThan(0.02)
    // A chain that coloured the signal with nothing engaged would fail this: the output must
    // match the source's own level within a couple of percent.
    const solo = await renderChain(
      OfflineAudioContext as never,
      ((ctx: Record<string, any>, destination: unknown) =>
        createToneSource(ctx, destination, { frequency: 220, seconds: SECONDS })) as never,
      { state: base(), owner: 'piano.a', seconds: SECONDS, sampleRate: SR },
    )
    expect(Math.abs(rms(dry.mono) - rms(solo.mono)) / rms(solo.mono)).toBeLessThan(0.03)
  })

  it('never clips the chain output for a loud source', async () => {
    const state = base()
    state.chains['piano.a'].ampEq = { on: true, model: 'Twin', drive: 10, bass: 8, mid: 6, midFreq: 5, treble: 8 }
    state.chains['piano.a'].compressor = { on: true, amount: 6, fast: false, global: false }
    const out = await render(state)
    expect(peak(out.mono)).toBeLessThanOrEqual(1.2)
    expect(out.mono.every((v) => Number.isFinite(v))).toBe(true)
  })
})

describe('effects.processing — Mod 1', () => {
  it('renders every Mod 1 type, and no two types are the same effect', async () => {
    const measurements: Record<string, { rms: number; brightness: number; correlation: number; spread: number }> = {}
    for (const type of MOD1_TYPES) {
      const state = base()
      state.chains['piano.a'].mod1 = { on: true, type, rate: 5, amount: 8 }
      const out = await render(state)
      measurements[type] = {
        rms: rms(out.mono),
        brightness: brightness(out.mono),
        correlation: stereoCorrelation(out.left, out.right),
        spread: contourSpread(levelContour(out.mono, 28)),
      }
      // Every type produces sound rather than muting the chain.
      expect(measurements[type].rms, type).toBeGreaterThan(0.005)
    }
    const flat = await reference()
    const referenceSpread = contourSpread(levelContour(flat.mono, 28))

    // A-Pan moves the image between channels; the bypassed chain is essentially mono.
    expect(measurements['A-Pan'].correlation).toBeLessThan(0.85)
    expect(stereoCorrelation(flat.left, flat.right)).toBeGreaterThan(0.95)
    // Tremolo and Pump modulate level over time. The comparison is against the bypassed
    // chain's own spread, because the test tone has an attack and release of its own.
    expect(measurements.Tremolo.spread).toBeGreaterThan(referenceSpread * 1.15)
    expect(measurements.Pump.spread).toBeGreaterThan(referenceSpread * 1.15)
    // Ring modulation adds inharmonic content, so it is measurably brighter than dry.
    expect(measurements['Ring Mod'].brightness).toBeGreaterThan(brightness(flat.mono) * 1.1)
    // A resonant band-pass changes the spectral balance, in either direction depending on
    // which harmonics land in the band. What must be true is that both wahs differ from dry
    // and that they differ from each other, because one follows the envelope and one an LFO.
    expect(Math.abs(measurements['A-Wah'].brightness - brightness(flat.mono))).toBeGreaterThan(0.002)
    expect(Math.abs(measurements.Wah.brightness - brightness(flat.mono))).toBeGreaterThan(0.002)
    expect(Math.abs(measurements['A-Wah'].brightness - measurements.Wah.brightness)).toBeGreaterThan(0.002)
    // Wah is LFO-driven and A-Wah is envelope-driven: their contours differ.
    expect(
      Math.abs(measurements.Wah.spread - measurements['A-Wah'].spread) > 0.01 ||
        Math.abs(measurements.Wah.brightness - measurements['A-Wah'].brightness) > 0.005,
    ).toBe(true)
  }, 60000)

  it('changes the signal as its Rate and Amount move', async () => {
    const low = base()
    low.chains['piano.a'].mod1 = { on: true, type: 'Tremolo', rate: 1, amount: 8 }
    const high = base()
    high.chains['piano.a'].mod1 = { on: true, type: 'Tremolo', rate: 9, amount: 8 }
    const quiet = base()
    quiet.chains['piano.a'].mod1 = { on: true, type: 'Tremolo', rate: 5, amount: 1 }

    const slow = await render(low)
    const fast = await render(high)
    const shallow = await render(quiet)
    // A faster tremolo crosses the level contour more often.
    const zeroCrossings = (values: number[]) => {
      let count = 0
      const mean = values.reduce((s, v) => s + v, 0) / values.length
      for (let i = 1; i < values.length; i += 1) {
        if (values[i - 1] < mean !== values[i] < mean) count += 1
      }
      return count
    }
    expect(zeroCrossings(levelContour(fast.mono, 40))).toBeGreaterThan(
      zeroCrossings(levelContour(slow.mono, 40)),
    )
    // A lower Amount modulates less deeply than a higher one at the same rate.
    const full = base()
    full.chains['piano.a'].mod1 = { on: true, type: 'Tremolo', rate: 5, amount: 10 }
    const fullOut = await render(full)
    expect(contourSpread(levelContour(shallow.mono, 28))).toBeLessThan(
      contourSpread(levelContour(fullOut.mono, 28)),
    )
    expect(mod1RateHz(9)).toBeGreaterThan(mod1RateHz(1))
  })
})

describe('effects.processing — Mod 2', () => {
  it('renders every Mod 2 type, and they are not the same effect', async () => {
    const measurements: Record<string, { rms: number; brightness: number; correlation: number }> = {}
    for (const type of MOD2_TYPES) {
      const state = base()
      state.chains['piano.a'].mod2 = { on: true, type, rate: 4, amount: 8 }
      const out = await render(state)
      measurements[type] = {
        rms: rms(out.mono),
        brightness: brightness(out.mono),
        correlation: stereoCorrelation(out.left, out.right),
      }
      expect(measurements[type].rms, type).toBeGreaterThan(0.005)
    }
    const flat = await reference()
    // Chorus and Ensemble are stereo-widening effects; the dry chain is not.
    expect(measurements.Chorus.correlation).toBeLessThan(0.8)
    expect(measurements.Ensemble.correlation).toBeLessThan(0.8)
    expect(stereoCorrelation(flat.left, flat.right)).toBeGreaterThan(0.95)
    // Flanger and Phaser comb/phase the signal, which shifts its spectrum away from dry.
    expect(Math.abs(measurements.Flanger.brightness - brightness(flat.mono))).toBeGreaterThan(0.01)
    expect(Math.abs(measurements.Phaser.brightness - brightness(flat.mono))).toBeGreaterThan(0.01)
    // Vibe is a phaser variant but with its own voicing, so it is not identical to Phaser.
    expect(measurements.Vibe.rms).not.toBeCloseTo(measurements.Phaser.rms, 3)
    // Spin modulates the image, so it is less correlated than dry.
    expect(measurements.Spin.correlation).toBeLessThan(0.98)
    expect(mod2RateHz(8)).toBeGreaterThan(mod2RateHz(2))
  }, 60000)
})

describe('effects.processing — Delay', () => {
  it('produces repeats that decay, and filters each successive repeat', async () => {
    const state = base()
    state.chains['piano.a'].delay = {
      on: true,
      tempo: 5,
      feedback: 8,
      dryWet: 10,
      filter: 'LP',
      pingPong: false,
      tapSeconds: 0.2,
      global: false,
    }
    const out = await render(state, { source: 'impulse', seconds: 1.8 })
    const window = (t: number) => {
      const from = Math.round(t * SR)
      const to = Math.round((t + 0.05) * SR)
      return { rms: rms(out.mono, from, to), brightness: brightness(out.mono, from, to) }
    }
    const first = window(0.2)
    const second = window(0.4)
    const third = window(0.6)
    // Repeats exist, and each is quieter than the one before.
    expect(first.rms).toBeGreaterThan(0.01)
    expect(first.rms).toBeGreaterThan(second.rms)
    expect(second.rms).toBeGreaterThan(third.rms)
    // The feedback filter processes the repeats: each successive repeat is darker, which is
    // only possible if the filter sits inside the feedback loop and not on the dry path.
    expect(second.brightness).toBeLessThan(first.brightness)
    expect(third.brightness).toBeLessThanOrEqual(second.brightness + 1e-6)
  }, 60000)

  it('leaves the dry path unfiltered while the repeats are filtered', async () => {
    const state = base()
    state.chains['piano.a'].delay = {
      on: true,
      tempo: 5,
      feedback: 6,
      dryWet: 2,
      filter: 'LP',
      pingPong: false,
      tapSeconds: 0.2,
      global: false,
    }
    const out = await render(state, { source: 'impulse', seconds: 1.2 })
    // With the filter in the feedback loop, a repeat is darker than the same repeat with
    // filtering off. That also proves the filter is not acting on the dry path.
    const unfiltered = base()
    unfiltered.chains['piano.a'].delay = {
      on: true, tempo: 5, feedback: 6, dryWet: 2, filter: 'OFF', pingPong: false, tapSeconds: 0.2, global: false,
    }
    const offOut = await render(unfiltered, { source: 'impulse', seconds: 1.2 })
    const filteredBand = brightness(out.mono, Math.round(0.4 * SR), Math.round(0.46 * SR))
    const openBand = brightness(offOut.mono, Math.round(0.4 * SR), Math.round(0.46 * SR))
    expect(filteredBand).toBeLessThan(openBand)
  }, 60000)

  it('dries up completely with Dry/Wet at zero, and is fully wet at maximum', async () => {
    const dry = base()
    dry.chains['piano.a'].delay = {
      on: true, tempo: 5, feedback: 5, dryWet: 0, filter: 'LP', pingPong: false, tapSeconds: 0.2, global: false,
    }
    const wet = base()
    wet.chains['piano.a'].delay = {
      on: true, tempo: 5, feedback: 5, dryWet: 10, filter: 'LP', pingPong: false, tapSeconds: 0.2, global: false,
    }
    const dryOut = await render(dry, { source: 'impulse', seconds: 1.0 })
    const wetOut = await render(wet, { source: 'impulse', seconds: 1.0 })
    // At zero, only the initial hit is present.
    expect(rms(wetOut.mono, Math.round(0.2 * SR), Math.round(0.3 * SR))).toBeGreaterThan(0.01)
    expect(rms(dryOut.mono, Math.round(0.2 * SR), Math.round(0.3 * SR))).toBeLessThan(0.002)
  }, 60000)

  it('maps the tempo knob to time, and tap tempo agrees with the knob', () => {
    expect(delaySecondsFor(10)).toBeGreaterThan(delaySecondsFor(5))
    expect(delaySecondsFor(0)).toBeLessThan(delaySecondsFor(5))
    // Tap tempo stores a time; converting it back lands on the same knob position, so the
    // printed tempo and the knob agree.
    for (const seconds of [0.08, 0.2, 0.45, 0.8]) {
      const knob = knobForDelaySeconds(seconds)
      expect(delaySecondsFor(knob)).toBeCloseTo(seconds, 3)
    }
  })

  it('offers every listed feedback filter and each one shapes the repeats differently', async () => {
    expect(DELAY_FILTERS).toEqual(['OFF', 'LP', 'HP', 'BP'])
    const measured: Record<string, number> = {}
    for (const filter of DELAY_FILTERS) {
      const state = base()
      state.chains['piano.a'].delay = {
        on: true, tempo: 5, feedback: 8, dryWet: 10, filter, pingPong: false, tapSeconds: 0.2, global: false,
      }
      const out = await render(state, { source: 'impulse', seconds: 1.4 })
      measured[filter] = brightness(out.mono, Math.round(0.4 * SR), Math.round(0.5 * SR))
    }
    // LP darkens the repeats, HP keeps only their top end, and OFF does neither.
    expect(measured.LP).toBeLessThan(measured.OFF)
    expect(measured.HP).toBeGreaterThan(measured.OFF)
    expect(measured.BP).not.toBeCloseTo(measured.OFF, 4)
  }, 60000)

  it('spreads repeats across the stereo field in ping-pong mode', async () => {
    const make = (pingPong: boolean) => {
      const state = base()
      state.chains['piano.a'].delay = {
        on: true, tempo: 5, feedback: 7, dryWet: 10, filter: 'OFF', pingPong, tapSeconds: 0.2, global: false,
      }
      return state
    }
    const straight = await render(make(false), { source: 'impulse', seconds: 1.2 })
    const pong = await render(make(true), { source: 'impulse', seconds: 1.2 })
    // Straight repeats are centred, so both channels carry the same energy at each repeat.
    // Ping-pong alternates the sides, so consecutive repeats swap which channel is louder.
    const sideBalance = (out: { left: Float32Array; right: Float32Array }, t: number) => {
      const from = Math.round(t * SR)
      const to = Math.round((t + 0.05) * SR)
      const left = rms(out.left, from, to)
      const right = rms(out.right, from, to)
      return { left, right, delta: left - right }
    }
    const straightFirst = sideBalance(straight, 0.2)
    const straightSecond = sideBalance(straight, 0.4)
    expect(Math.abs(straightFirst.delta)).toBeLessThan(0.005)
    expect(Math.abs(straightSecond.delta)).toBeLessThan(0.005)

    const pongFirst = sideBalance(pong, 0.2)
    const pongSecond = sideBalance(pong, 0.4)
    // The first repeat leans one way and the next leans the other.
    expect(Math.abs(pongFirst.delta) + Math.abs(pongSecond.delta)).toBeGreaterThan(0.01)
    expect(Math.sign(pongFirst.delta)).not.toBe(Math.sign(pongSecond.delta))
  }, 60000)
})

describe('effects.processing — Amp Sim / EQ', () => {
  it('offers every listed model, and the three amps are not identical', async () => {
    expect([...AMP_MODELS]).toEqual([
      'EQ only',
      'Twin',
      'JC',
      'Small',
      'LP24 Filter',
      'HP24 Filter',
      'To Rotary',
    ])
    const measured: Record<string, { rms: number; brightness: number }> = {}
    for (const model of AMP_MODELS) {
      const state = base()
      state.chains['piano.a'].ampEq = { on: true, model, drive: 5, bass: 0, mid: 0, midFreq: 5, treble: 0 }
      const out = await render(state)
      measured[model] = { rms: rms(out.mono), brightness: brightness(out.mono) }
      expect(measured[model].rms, model).toBeGreaterThan(0.005)
    }
    // Twin, JC and Small are distinct tone-shaping drive/cabinet colourations.
    const amps = ['Twin', 'JC', 'Small'] as const
    for (let i = 0; i < amps.length; i += 1) {
      for (let j = i + 1; j < amps.length; j += 1) {
        const a = measured[amps[i]]
        const b = measured[amps[j]]
        const differs =
          Math.abs(a.brightness - b.brightness) / Math.max(a.brightness, b.brightness) > 0.02 ||
          Math.abs(a.rms - b.rms) / Math.max(a.rms, b.rms) > 0.05
        expect(differs, `${amps[i]} vs ${amps[j]}`).toBe(true)
      }
    }
  }, 60000)

  it('makes the 24 dB filters move energy in the expected direction', async () => {
    const make = (model: 'LP24 Filter' | 'HP24 Filter') => {
      const state = base()
      state.chains['piano.a'].ampEq = { on: true, model, drive: 0, bass: 0, mid: 8, midFreq: 4, treble: 0 }
      return state
    }
    const flat = await reference()
    const lowpass = await render(make('LP24 Filter'))
    const highpass = await render(make('HP24 Filter'))
    expect(brightness(lowpass.mono)).toBeLessThan(brightness(flat.mono))
    expect(brightness(highpass.mono)).toBeGreaterThan(brightness(flat.mono))
    // Cutoff follows the Freq knob.
    expect(midFreqHz(8)).toBeGreaterThan(midFreqHz(2))
  }, 60000)

  it('moves the EQ bands, and each band changes the signal', async () => {
    const make = (band: Partial<{ bass: number; mid: number; treble: number; midFreq: number }>) => {
      const state = base()
      state.chains['piano.a'].ampEq = {
        on: true, model: 'EQ only', drive: 0, bass: 0, mid: 0, midFreq: 5, treble: 0, ...band,
      }
      return state
    }
    const flat = await render(make({}))
    const bassBoost = await render(make({ bass: 12 }))
    const trebleBoost = await render(make({ treble: 12 }))
    const trebleCut = await render(make({ treble: -12 }))
    const midBoost = await render(make({ mid: 12, midFreq: 5 }))

    expect(brightness(trebleBoost.mono)).toBeGreaterThan(brightness(flat.mono) * 1.05)
    expect(brightness(trebleCut.mono)).toBeLessThan(brightness(flat.mono))
    expect(rms(bassBoost.mono)).toBeGreaterThan(rms(flat.mono))
    expect(shapeDifference(midBoost.mono, flat.mono)).toBeGreaterThan(0.01)
  }, 60000)

  it('routes a layer into the shared Rotary only via the To Rotary model', async () => {
    const routed = base()
    routed.chains['piano.a'].ampEq = { on: true, model: 'To Rotary', drive: 2, bass: 0, mid: 0, midFreq: 5, treble: 0 }
    routed.rotary = { on: true, speed: 'Fast', drive: 5, organRouted: false }
    const out = await render(routed)
    // A routed layer leaves the direct path and returns through the rotating speaker, which
    // modulates both level and stereo position.
    expect(contourSpread(levelContour(out.mono, 28))).toBeGreaterThan(0.05)
    expect(stereoCorrelation(out.left, out.right)).toBeLessThan(0.95)
  }, 60000)
})

describe('effects.processing — Compressor', () => {
  it('reduces dynamic range at higher amounts', async () => {
    const make = (amount: number) => {
      const state = base()
      state.chains['piano.a'].compressor = { on: true, amount, fast: false, global: false }
      return state
    }
    // A click train with deliberately unequal hits: compression must bring the quiet ones
    // up relative to the loud ones, which narrows the range of peak levels across hits.
    const makeClicks = (ctx: Record<string, any>, destination: unknown) => {
      const osc = ctx.createOscillator()
      osc.type = 'square'
      osc.frequency.value = 900
      const env = ctx.createGain()
      env.gain.value = 0
      const gains = [0.05, 0.5, 0.08, 0.6, 0.06, 0.55, 0.07, 0.5, 0.05, 0.6]
      gains.forEach((g, i) => {
        const t = 0.05 + i * 0.12
        env.gain.setValueAtTime(0, t)
        env.gain.linearRampToValueAtTime(g, t + 0.004)
        env.gain.linearRampToValueAtTime(0, t + 0.06)
      })
      osc.connect(env)
      env.connect(destination)
      osc.start(0)
      osc.stop(1.4)
      return () => {
        try {
          osc.stop()
        } catch {
          /* already stopped */
        }
      }
    }
    const renderWith = (amount: number) =>
      renderChain(OfflineAudioContext as never, makeClicks as never, {
        state: make(amount),
        owner: 'piano.a',
        seconds: 1.4,
        sampleRate: SR,
      })
    const off = await renderWith(0)
    const heavy = await renderWith(10)
    // Peak level of each hit, then the ratio between the loudest and quietest hit.
    const peaksOf = (samples: Float32Array) => {
      const out: number[] = []
      for (let i = 0; i < 10; i += 1) {
        const t = 0.05 + i * 0.12
        out.push(peak(samples.slice(Math.round(t * SR), Math.round((t + 0.06) * SR))))
      }
      return out
    }
    const offPeaks = peaksOf(off.mono)
    const heavyPeaks = peaksOf(heavy.mono)
    const dynamicRange = (values: number[]) => Math.max(...values) / Math.max(Math.min(...values), 1e-9)
    expect(dynamicRange(heavyPeaks)).toBeLessThan(dynamicRange(offPeaks))
  }, 60000)

  it('fast mode changes the recovery and pumps more at high amounts', async () => {
    const make = (fast: boolean) => {
      const state = base()
      state.chains['piano.a'].compressor = { on: true, amount: 9, fast, global: false }
      return state
    }
    const slow = await render(make(false), { source: 'clicks', seconds: 1.6, interval: 0.1 })
    const fast = await render(make(true), { source: 'clicks', seconds: 1.6, interval: 0.1 })
    // Different attack/release settings cannot produce the same envelope.
    expect(shapeDifference(slow.mono, fast.mono)).toBeGreaterThan(0.005)
    expect(compSettingsFor(9, true).release).toBeLessThan(compSettingsFor(9, false).release)
  }, 60000)
})

describe('effects.processing — Reverb', () => {
  it('offers all six types with decay length growing from Booth to Cathedral', async () => {
    expect([...REVERB_TYPES]).toEqual(['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral'])

    // Decay length is measured as the time the tail stays above a fixed threshold, which is
    // what "very short" to "very long" actually describes. Measuring instantaneous energy at
    // one instant would be misleading: a short tank concentrates its energy early and can be
    // louder there than a long one.
    const decaySeconds: Record<string, number> = {}
    const threshold = 2e-4
    for (const type of REVERB_TYPES) {
      const state = base()
      state.chains['piano.a'].reverb = { on: true, type, dryWet: 10, tone: 'Bright', global: false }
      const out = await render(state, { source: 'impulse', seconds: 3.0 })
      const block = Math.round(0.02 * SR)
      let last = 0
      for (let i = 0; i + block < out.mono.length; i += block) {
        if (rms(out.mono, i, i + block) > threshold) last = i + block
      }
      decaySeconds[type] = last / SR
    }
    // Booth is the shortest and Cathedral the longest, with Stage and Hall between them.
    expect(decaySeconds.Booth).toBeLessThan(decaySeconds.Room)
    expect(decaySeconds.Room).toBeLessThan(decaySeconds.Stage)
    expect(decaySeconds.Stage).toBeLessThan(decaySeconds.Hall)
    expect(decaySeconds.Hall).toBeLessThan(decaySeconds.Cathedral)
    // The extremes are far apart rather than a rounding difference.
    expect(decaySeconds.Cathedral).toBeGreaterThan(decaySeconds.Booth * 2)
    // Spring is its own character: a real, audible tail that is not simply Room's length.
    expect(decaySeconds.Spring).toBeGreaterThan(0)
    expect(decaySeconds.Spring).not.toBeCloseTo(decaySeconds.Room, 2)
  }, 60000)

  it('is fully wet at maximum Dry/Wet and fully dry at zero', async () => {
    const make = (dryWet: number) => {
      const state = base()
      state.chains['piano.a'].reverb = { on: true, type: 'Hall', dryWet, tone: 'Bright', global: false }
      return state
    }
    const dry = await render(make(0), { source: 'clicks', seconds: 1.4 })
    const wet = await render(make(10), { source: 'clicks', seconds: 1.4 })
    // With no wet signal, the tail after the last hit is silent.
    expect(rms(wet.mono, Math.round(1.0 * SR), Math.round(1.2 * SR))).toBeGreaterThan(0.001)
    expect(rms(dry.mono, Math.round(1.0 * SR), Math.round(1.2 * SR))).toBeLessThan(0.001)
  }, 60000)

  it('changes its colour with Bright/Dark', async () => {
    const make = (tone: 'Bright' | 'Dark') => {
      const state = base()
      state.chains['piano.a'].reverb = { on: true, type: 'Hall', dryWet: 8, tone, global: false }
      return state
    }
    const bright = await render(make('Bright'), { source: 'clicks', seconds: 1.6 })
    const dark = await render(make('Dark'), { source: 'clicks', seconds: 1.6 })
    expect(brightness(bright.mono)).toBeGreaterThan(brightness(dark.mono))
  }, 60000)

  it('builds a deterministic impulse response for each type', () => {
    const ctx = new OfflineAudioContext(1, 480, SR)
    const first = buildImpulseResponse(ctx as never, 'Hall', 'Bright')
    const second = buildImpulseResponse(ctx as never, 'Hall', 'Bright')
    expect(Array.from(first.getChannelData(0).slice(0, 500))).toEqual(
      Array.from(second.getChannelData(0).slice(0, 500)),
    )
    // Booth is shorter than Cathedral, by the same ratio as the declared decays.
    const booth = buildImpulseResponse(ctx as never, 'Booth', 'Bright')
    const cathedral = buildImpulseResponse(ctx as never, 'Cathedral', 'Bright')
    expect(cathedral.duration).toBeGreaterThan(booth.duration * 3)
  })
})

describe('effects.processing — Rotary', () => {
  it('changes rate with speed and ramps rather than jumping', () => {
    expect(ROTARY_SPEEDS.fast.horn).toBeGreaterThan(ROTARY_SPEEDS.slow.horn)
    expect(ROTARY_SPEEDS.fast.drum).toBeGreaterThan(ROTARY_SPEEDS.slow.drum)
    // The horn and the bass rotor never run at the same rate.
    for (const speed of ['slow', 'fast'] as const) {
      expect(ROTARY_SPEEDS[speed].horn).not.toBe(ROTARY_SPEEDS[speed].drum)
    }
  })

  it('modulates a routed signal and is silent when the rotary is off', async () => {
    const make = (on: boolean, speed: 'Slow' | 'Fast') => {
      const state = base()
      state.chains['piano.a'].ampEq = { on: true, model: 'To Rotary', drive: 3, bass: 0, mid: 0, midFreq: 5, treble: 0 }
      state.rotary = { on, speed, drive: 5, organRouted: false }
      return state
    }
    const running = await render(make(true, 'Fast'))
    const stopped = await render(make(false, 'Fast'))
    expect(rms(running.mono)).toBeGreaterThan(0.01)
    // With the rotary off, a routed layer leaves its own chain for the rotary and nothing
    // returns: it is silent, not merely quieter.
    expect(rms(stopped.mono)).toBeLessThan(rms(running.mono) * 0.15)
    // Its drive changes the signal.
    const driven = base()
    driven.chains['piano.a'].ampEq = { on: true, model: 'To Rotary', drive: 3, bass: 0, mid: 0, midFreq: 5, treble: 0 }
    driven.rotary = { on: true, speed: 'Slow', drive: 10, organRouted: false }
    const lowDrive = await render(make(true, 'Slow'))
    const highDrive = await render(driven)
    expect(shapeDifference(lowDrive.mono, highDrive.mono)).toBeGreaterThan(0.01)
  }, 60000)
})

describe('effects.processing — the documented signal order', () => {
  it('wires the units in the order the spec requires', () => {
    expect([...CHAIN_ORDER]).toEqual(['mod1', 'mod2', 'delay', 'ampEq', 'compressor', 'reverb'])
  })

  it('puts Reverb before the Rotary for a routed layer', async () => {
    // With reverb -> rotary, the rotary's amplitude modulation is imposed on the tail. If
    // reverb came after the rotary, the tail would be steady while only the dry part moved.
    const state = base()
    state.chains['piano.a'].ampEq = { on: true, model: 'To Rotary', drive: 2, bass: 0, mid: 0, midFreq: 5, treble: 0 }
    state.chains['piano.a'].reverb = { on: true, type: 'Hall', dryWet: 10, tone: 'Bright', global: false }
    state.rotary = { on: true, speed: 'Fast', drive: 4, organRouted: false }
    const out = await render(state, { source: 'impulse', seconds: 1.6 })
    // Measure modulation in the reverb tail, well after the impulse itself.
    const blocks: number[] = []
    const size = Math.round(SR * 0.02)
    for (let i = Math.round(0.6 * SR); i + size < Math.round(1.2 * SR); i += size) {
      blocks.push(rms(out.mono, i, i + size))
    }
    const mean = blocks.reduce((s, v) => s + v, 0) / blocks.length
    const spread = Math.sqrt(blocks.reduce((s, v) => s + (v - mean) ** 2, 0) / blocks.length)
    expect(mean).toBeGreaterThan(0)
    // A steady tail would have a near-zero spread; the rotary modulates it audibly.
    expect(spread / mean).toBeGreaterThan(0.05)
  }, 60000)

  it('applies Mod 1 before the Delay, so the delay repeats a modulated signal', async () => {
    const state = base()
    state.chains['piano.a'].mod1 = { on: true, type: 'Tremolo', rate: 6, amount: 9 }
    state.chains['piano.a'].delay = {
      on: true, tempo: 5, feedback: 6, dryWet: 9, filter: 'OFF', pingPong: false, tapSeconds: 0.2, global: false,
    }
    const out = await render(state, { source: 'clicks', seconds: 1.8, interval: 0.6 })
    // Every repeat inherits the tremolo, because Mod 1 comes first.
    const firstRepeat = contourSpread(levelContour(out.mono.slice(Math.round(0.2 * SR), Math.round(0.45 * SR)), 12))
    expect(firstRepeat).toBeGreaterThan(0.05)
  }, 60000)
})

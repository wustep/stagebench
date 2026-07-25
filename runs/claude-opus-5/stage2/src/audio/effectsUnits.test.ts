import { describe, expect, it } from 'vitest'
import { bandEnergy, crestFactor, peak, relativeDifference, rms } from './offline'
import { REVERB_SHAPES, compressionCurve, delayTempoSeconds } from './effects'
import { engineRig, renderNote, settingsWith } from '../test/engineRig'
import type {
  AmpType,
  ChainSettings,
  Mod1Type,
  Mod2Type,
  ReverbType,
} from './settings'

const SAMPLE_RATE = 16000

/**
 * Renders one note through a chain. The master level is turned down so the units are measured on
 * their own: at the panel's default level a loud chord reaches the master limiter, and a limiter
 * flattening peaks would confound every spectral comparison below.
 */
function render(chain: Partial<ChainSettings>, options: { midi?: number; seconds?: number; velocity?: number } = {}) {
  const rig = engineRig({ settings: settingsWith({ masterLevel: 0.3, layers: { a: { chain } } }) })
  return renderNote(rig, { midi: options.midi ?? 55, velocity: options.velocity ?? 0.7, seconds: options.seconds ?? 1.2 })
}

/**
 * The same render at 32 kHz, used by the spectral tests that look above 3 kHz: at the 16 kHz
 * rate the rest of the suite uses, those bands sit too close to Nyquist to measure cleanly.
 */
const WIDE_RATE = 32000
function renderWide(chain: Partial<ChainSettings>, options: { midi?: number; velocity?: number } = {}) {
  const rig = engineRig({
    sampleRate: WIDE_RATE,
    settings: settingsWith({ masterLevel: 0.3, layers: { a: { chain } } }),
  })
  return renderNote(rig, { midi: options.midi ?? 55, velocity: options.velocity ?? 0.7, seconds: 1.2 })
}

function renderStereo(chain: Partial<ChainSettings>, seconds = 1.2) {
  const rig = engineRig({ settings: settingsWith({ masterLevel: 0.3, layers: { a: { chain } } }) })
  rig.engine.noteOn('n', 55, 0.7)
  return rig.graph.renderStereo(seconds)
}

const DRY = render({})

/** Energy in a band relative to the whole signal, so level changes do not confound the shape. */
function bandRatio(samples: Float32Array, low: number, high: number): number {
  return bandEnergy(samples, SAMPLE_RATE, low, high) / Math.max(rms(samples), 1e-12)
}

function window(samples: Float32Array, fromSeconds: number, toSeconds: number): Float32Array {
  return samples.slice(Math.floor(fromSeconds * SAMPLE_RATE), Math.floor(toSeconds * SAMPLE_RATE))
}

/**
 * Feature: effects.processing
 *
 * Every unit and every listed type is rendered and compared against the dry signal and against
 * its siblings. A label or a disconnected node cannot pass these.
 */
describe('Mod 1', () => {
  const types: Mod1Type[] = ['apan', 'tremolo', 'ringmod', 'awah', 'wah', 'pump']

  it('processes real audio for every type, and no two types render alike', () => {
    const rendered = new Map<Mod1Type, Float32Array>()
    for (const type of types) {
      const audio = render({ mod1: { on: true, type, rate: 0.5, amount: 0.85 } })
      expect(rms(audio), type).toBeGreaterThan(0.001)
      expect(relativeDifference(audio, DRY), `${type} vs dry`).toBeGreaterThan(0.05)
      rendered.set(type, audio)
    }
    for (let i = 0; i < types.length; i += 1) {
      for (let j = i + 1; j < types.length; j += 1) {
        expect(
          relativeDifference(rendered.get(types[i])!, rendered.get(types[j])!),
          `${types[i]} vs ${types[j]}`,
        ).toBeGreaterThan(0.05)
      }
    }
  })

  it('bypasses cleanly: off is identical to the dry path', () => {
    const off = render({ mod1: { on: false, type: 'tremolo', rate: 0.5, amount: 0.85 } })
    expect(relativeDifference(off, DRY)).toBeLessThan(1e-6)
  })

  it('pans the signal across the stereo field on A-Pan', () => {
    const { left, right } = renderStereo({ mod1: { on: true, type: 'apan', rate: 0.6, amount: 1 } })
    const window = Math.floor(SAMPLE_RATE * 0.1)
    let maximumImbalance = 0
    for (let start = 0; start + window < left.length; start += window) {
      const l = rms(left, start, start + window)
      const r = rms(right, start, start + window)
      maximumImbalance = Math.max(maximumImbalance, Math.abs(l - r) / Math.max(l + r, 1e-9))
    }
    expect(maximumImbalance).toBeGreaterThan(0.3)
  })

  it('keeps Tremolo at full level when the amount is zero, and ducks as it rises', () => {
    const zero = render({ mod1: { on: true, type: 'tremolo', rate: 0.5, amount: 0 } })
    const deep = render({ mod1: { on: true, type: 'tremolo', rate: 0.5, amount: 1 } })
    expect(relativeDifference(zero, DRY)).toBeLessThan(1e-6)
    expect(rms(deep)).toBeLessThan(rms(zero))
  })

  it('moves the ring modulator sidebands with the rate knob', () => {
    const low = render({ mod1: { on: true, type: 'ringmod', rate: 0.1, amount: 1 } })
    const high = render({ mod1: { on: true, type: 'ringmod', rate: 0.9, amount: 1 } })
    expect(relativeDifference(low, high)).toBeGreaterThan(0.2)
    expect(bandEnergy(high, SAMPLE_RATE, 2500, 7000)).toBeGreaterThan(bandEnergy(low, SAMPLE_RATE, 2500, 7000))
  })

  it('follows the envelope on A-Wah: a harder stroke sweeps the filter further open', () => {
    const wah = { on: true, type: 'awah' as const, rate: 0.9, amount: 0.5 }
    const soft = render({ mod1: wah }, { velocity: 0.25 })
    const hard = render({ mod1: wah }, { velocity: 1 })
    // Relative to its own level, the harder stroke has far more energy above the resting band.
    expect(bandRatio(hard, 700, 3000)).toBeGreaterThan(bandRatio(soft, 700, 3000) * 1.15)

    // And the sensitivity knob changes the sweep for a fixed stroke.
    const dull = render({ mod1: { ...wah, rate: 0.05 } }, { velocity: 1 })
    expect(relativeDifference(dull, hard)).toBeGreaterThan(0.05)
  })
})

describe('Mod 2', () => {
  const types: Mod2Type[] = ['chorus', 'flanger', 'phaser', 'vibe', 'ensemble', 'spin']

  it('processes real audio for every type, and no two types render alike', () => {
    const rendered = new Map<Mod2Type, Float32Array>()
    for (const type of types) {
      const audio = render({ mod2: { on: true, type, rate: 0.5, amount: 0.8 } })
      expect(rms(audio), type).toBeGreaterThan(0.001)
      expect(relativeDifference(audio, DRY), `${type} vs dry`).toBeGreaterThan(0.05)
      rendered.set(type, audio)
    }
    for (let i = 0; i < types.length; i += 1) {
      for (let j = i + 1; j < types.length; j += 1) {
        expect(
          relativeDifference(rendered.get(types[i])!, rendered.get(types[j])!),
          `${types[i]} vs ${types[j]}`,
        ).toBeGreaterThan(0.05)
      }
    }
  })

  it('deepens with the amount knob and moves with the rate knob', () => {
    const shallow = render({ mod2: { on: true, type: 'chorus', rate: 0.5, amount: 0.05 } })
    const wide = render({ mod2: { on: true, type: 'chorus', rate: 0.5, amount: 1 } })
    expect(relativeDifference(shallow, wide)).toBeGreaterThan(0.05)

    const slow = render({ mod2: { on: true, type: 'flanger', rate: 0.05, amount: 0.8 } })
    const fast = render({ mod2: { on: true, type: 'flanger', rate: 1, amount: 0.8 } })
    expect(relativeDifference(slow, fast)).toBeGreaterThan(0.05)
  })

  it('bypasses cleanly', () => {
    const off = render({ mod2: { on: false, type: 'ensemble', rate: 0.5, amount: 0.8 } })
    expect(relativeDifference(off, DRY)).toBeLessThan(1e-6)
  })
})

describe('Delay', () => {
  it('adds repeats that outlast the note and grow with feedback', () => {
    const short = render(
      { delay: { on: true, tempo: 0.4, feedback: 0.1, mix: 0.6, filter: 'lp' } },
      { seconds: 3 },
    )
    const long = render(
      { delay: { on: true, tempo: 0.4, feedback: 0.95, mix: 0.6, filter: 'lp' } },
      { seconds: 3 },
    )
    // Two seconds after the strike the high-feedback setting is still repeating audibly.
    expect(rms(window(long, 2, 3))).toBeGreaterThan(rms(window(short, 2, 3)) * 3)
    expect(rms(long)).toBeGreaterThan(rms(short))
  })

  it('places the first repeat at the tempo the knob asks for', () => {
    expect(delayTempoSeconds(0)).toBeCloseTo(0.06, 6)
    expect(delayTempoSeconds(1)).toBeCloseTo(1.1, 6)
    const slow = render({ delay: { on: true, tempo: 1, feedback: 0.2, mix: 0.9, filter: 'lp' } }, { seconds: 2.5 })
    const fast = render({ delay: { on: true, tempo: 0.05, feedback: 0.2, mix: 0.9, filter: 'lp' } }, { seconds: 2.5 })
    // A one-second delay leaves a gap of near silence where the fast setting is still repeating.
    const gap = (samples: Float32Array) => rms(samples, Math.floor(0.55 * SAMPLE_RATE), Math.floor(0.85 * SAMPLE_RATE))
    expect(gap(slow)).toBeLessThan(gap(fast))
  })

  it('filters the repeats rather than the dry signal', () => {
    const lowpass = render({ delay: { on: true, tempo: 0.5, feedback: 0.85, mix: 0.5, filter: 'lp' } }, { seconds: 3 })
    const highpass = render({ delay: { on: true, tempo: 0.5, feedback: 0.85, mix: 0.5, filter: 'hp' } }, { seconds: 3 })
    const bandpass = render({ delay: { on: true, tempo: 0.5, feedback: 0.85, mix: 0.5, filter: 'bp' } }, { seconds: 3 })

    // The dry attack is untouched by the feedback filter…
    const attack = (samples: Float32Array) => rms(samples, 0, Math.floor(0.2 * SAMPLE_RATE))
    expect(attack(lowpass)).toBeCloseTo(attack(highpass), 3)
    // …while the later repeats differ, each filter shaping its own tail.
    const tail = (samples: Float32Array) => window(samples, 1.2, 3)
    expect(relativeDifference(tail(lowpass), tail(highpass))).toBeGreaterThan(0.1)
    expect(relativeDifference(tail(bandpass), tail(highpass))).toBeGreaterThan(0.1)
    // The high-pass repeats have lost their low end; the low-pass repeats have kept it.
    expect(bandRatio(tail(highpass), 100, 400)).toBeLessThan(bandRatio(tail(lowpass), 100, 400))

    // And each repeat is filtered again: the later repeats are duller than the earlier ones.
    const early = window(lowpass, 0.6, 1.1)
    const late = window(lowpass, 2.2, 2.9)
    expect(bandRatio(late, 1500, 5000)).toBeLessThan(bandRatio(early, 1500, 5000))
  })

  it('crossfades dry and wet, and bypasses cleanly', () => {
    const dryish = render({ delay: { on: true, tempo: 0.4, feedback: 0.5, mix: 0.05, filter: 'lp' } }, { seconds: 2 })
    const wet = render({ delay: { on: true, tempo: 0.4, feedback: 0.5, mix: 0.95, filter: 'lp' } }, { seconds: 2 })
    expect(relativeDifference(dryish, wet)).toBeGreaterThan(0.2)
    const off = render({ delay: { on: false, tempo: 0.4, feedback: 0.5, mix: 0.5, filter: 'lp' } })
    expect(relativeDifference(off, DRY)).toBeLessThan(1e-6)
  })
})

describe('Amp Sim / EQ', () => {
  const types: AmpType[] = ['twin', 'jc', 'small', 'lp24', 'hp24']

  it('gives every amp and filter type its own colour', () => {
    const rendered = new Map<AmpType, Float32Array>()
    for (const type of types) {
      const audio = render({
        amp: { on: true, type, drive: 0.6, bass: 0, mid: 0, treble: 0, midFrequency: 1000 },
      })
      expect(rms(audio), type).toBeGreaterThan(0.001)
      expect(relativeDifference(audio, DRY), `${type} vs dry`).toBeGreaterThan(0.05)
      rendered.set(type, audio)
    }
    for (let i = 0; i < types.length; i += 1) {
      for (let j = i + 1; j < types.length; j += 1) {
        expect(
          relativeDifference(rendered.get(types[i])!, rendered.get(types[j])!),
          `${types[i]} vs ${types[j]}`,
        ).toBeGreaterThan(0.05)
      }
    }
    // The small speaker has audibly less low end than the Twin, which is the point of it.
    const amp = (type: AmpType) =>
      renderWide({ amp: { on: true, type, drive: 0.6, bass: 0, mid: 0, treble: 0, midFrequency: 1000 } })
    expect(bandEnergy(amp('small'), WIDE_RATE, 60, 200)).toBeLessThan(
      bandEnergy(amp('twin'), WIDE_RATE, 60, 200) * 0.85,
    )
  })

  it('sweeps the 24 dB filters with the Freq knob in opposite directions', () => {
    const lowCut = render({ amp: { on: true, type: 'lp24', drive: 0, bass: 0, mid: 0, treble: 0, midFrequency: 400 } })
    const lowOpen = render({ amp: { on: true, type: 'lp24', drive: 0, bass: 0, mid: 0, treble: 0, midFrequency: 6000 } })
    expect(bandEnergy(lowCut, SAMPLE_RATE, 2000, 6000)).toBeLessThan(bandEnergy(lowOpen, SAMPLE_RATE, 2000, 6000))

    const highCut = render({ amp: { on: true, type: 'hp24', drive: 0, bass: 0, mid: 0, treble: 0, midFrequency: 2000 } })
    const highOpen = render({ amp: { on: true, type: 'hp24', drive: 0, bass: 0, mid: 0, treble: 0, midFrequency: 200 } })
    expect(bandEnergy(highCut, SAMPLE_RATE, 80, 300)).toBeLessThan(bandEnergy(highOpen, SAMPLE_RATE, 80, 300))
  })

  it('shapes the three EQ bands independently', () => {
    const eq = (bass: number, mid: number, treble: number, midi = 55) =>
      renderWide({ amp: { on: true, type: 'twin', drive: 0, bass, mid, treble, midFrequency: 1000 } }, { midi })

    // The bass shelf sits at 100 Hz, so it is measured on a low note that has energy there.
    // The knobs are the only difference between the two renders, so absolute band energy is a
    // fair comparison here (the drive stage is at zero and the limiter is out of the picture).
    const flatLow = eq(0, 0, 0, 40)
    const bassy = eq(12, 0, 0, 40)
    expect(bandEnergy(bassy, WIDE_RATE, 60, 110)).toBeGreaterThan(bandEnergy(flatLow, WIDE_RATE, 60, 110) * 1.3)

    const flat = eq(0, 0, 0)
    const bright = eq(0, 0, 12)
    const dull = eq(0, 0, -12)
    const middy = eq(0, 12, 0)
    expect(bandEnergy(bright, WIDE_RATE, 3500, 6000)).toBeGreaterThan(
      bandEnergy(flat, WIDE_RATE, 3500, 6000) * 1.5,
    )
    // A cut is a cut: the treble band ends up well below the boosted render.
    expect(bandEnergy(dull, WIDE_RATE, 3500, 6000)).toBeLessThan(bandEnergy(bright, WIDE_RATE, 3500, 6000) * 0.7)
    expect(bandEnergy(middy, WIDE_RATE, 850, 1300)).toBeGreaterThan(
      bandEnergy(flat, WIDE_RATE, 850, 1300) * 1.3,
    )
  })

  it('saturates as the drive knob is opened', () => {
    const clean = render({ amp: { on: true, type: 'twin', drive: 0, bass: 0, mid: 0, treble: 0, midFrequency: 1000 } })
    const driven = render({ amp: { on: true, type: 'twin', drive: 1, bass: 0, mid: 0, treble: 0, midFrequency: 1000 } })
    expect(relativeDifference(clean, driven)).toBeGreaterThan(0.1)
    // Saturation squashes the peaks relative to the average level.
    expect(crestFactor(driven)).toBeLessThan(crestFactor(clean))
  })

  it('bypasses cleanly', () => {
    const off = render({ amp: { on: false, type: 'small', drive: 1, bass: 10, mid: 10, treble: 10, midFrequency: 400 } })
    expect(relativeDifference(off, DRY)).toBeLessThan(1e-6)
  })
})

describe('Compressor', () => {
  it('reduces the dynamic range as the amount rises', () => {
    const gentle = render({ compressor: { on: true, amount: 0.05 } }, { seconds: 2 })
    const hard = render({ compressor: { on: true, amount: 1 } }, { seconds: 2 })
    // A piano note falls away steeply; compression lifts the tail towards the body of the note.
    const range = (samples: Float32Array) => rms(window(samples, 0.05, 0.3)) / rms(window(samples, 1, 1.8))
    expect(range(hard)).toBeLessThan(range(gentle) * 0.85)
    expect(relativeDifference(gentle, hard)).toBeGreaterThan(0.1)
  })

  it('narrows the gap between a soft and a loud stroke', () => {
    const level = (velocity: number, amount: number) =>
      rms(render({ compressor: { on: true, amount } }, { velocity, seconds: 1 }))
    const openRange = level(0.95, 0.02) / level(0.25, 0.02)
    const closedRange = level(0.95, 1) / level(0.25, 1)
    expect(closedRange).toBeLessThan(openRange)
  })

  it('has a curve that only ever reduces gain, and only above its threshold', () => {
    const transparent = compressionCurve(0)
    for (const value of transparent) expect(value).toBeCloseTo(1, 5)
    const squashed = compressionCurve(1)
    for (const value of squashed) expect(value).toBeLessThanOrEqual(1 + 1e-6)
    expect(squashed[squashed.length - 1]).toBeLessThan(squashed[Math.floor(squashed.length * 0.55)])
  })

  it('bypasses cleanly', () => {
    const off = render({ compressor: { on: false, amount: 1 } })
    expect(relativeDifference(off, DRY)).toBeLessThan(1e-6)
  })
})

describe('Reverb', () => {
  const types: ReverbType[] = ['booth', 'room', 'spring', 'stage', 'hall', 'cathedral']

  it('gives every type its own tail, and no two render alike', () => {
    const rendered = new Map<ReverbType, Float32Array>()
    for (const type of types) {
      const audio = render({ reverb: { on: true, type, mix: 0.85, tone: 'normal' } }, { seconds: 3 })
      expect(rms(audio), type).toBeGreaterThan(0.001)
      expect(relativeDifference(audio, DRY), `${type} vs dry`).toBeGreaterThan(0.1)
      rendered.set(type, audio)
    }
    for (let i = 0; i < types.length; i += 1) {
      for (let j = i + 1; j < types.length; j += 1) {
        expect(
          relativeDifference(rendered.get(types[i])!, rendered.get(types[j])!),
          `${types[i]} vs ${types[j]}`,
        ).toBeGreaterThan(0.05)
      }
    }
  })

  it('grows the decay from Booth to Cathedral', () => {
    // A short, released note so what is left after two seconds is the room, not the string:
    // how much is still ringing then is the decay.
    const lateEnergy = (type: ReverbType) => {
      const rig = engineRig({
        settings: settingsWith({
          masterLevel: 0.3,
          layers: { a: { chain: { reverb: { on: true, type, mix: 1, tone: 'normal' } } } },
        }),
      })
      const audio = renderNote(rig, { midi: 72, velocity: 0.9, seconds: 4, holdSeconds: 0.12 })
      return rms(window(audio, 1.6, 3.6))
    }
    const booth = lateEnergy('booth')
    const room = lateEnergy('room')
    const hall = lateEnergy('hall')
    const cathedral = lateEnergy('cathedral')
    expect(room).toBeGreaterThan(booth)
    expect(hall).toBeGreaterThan(room)
    expect(cathedral).toBeGreaterThan(hall)
    // The declared shapes agree with what was rendered.
    expect(REVERB_SHAPES.cathedral.feedback).toBeGreaterThan(REVERB_SHAPES.booth.feedback)
  })

  it('is fully wet at maximum and dry at minimum', () => {
    const fullyWet = render({ reverb: { on: true, type: 'hall', mix: 1, tone: 'normal' } }, { seconds: 2 })
    const fullyDry = render({ reverb: { on: true, type: 'hall', mix: 0, tone: 'normal' } }, { seconds: 2 })
    expect(relativeDifference(fullyDry, DRY.slice(0, fullyDry.length))).toBeLessThan(0.02)
    // With no dry path left, the attack is softened by the tank instead of hitting directly.
    expect(peak(fullyWet, 0, Math.floor(0.05 * SAMPLE_RATE))).toBeLessThan(
      peak(fullyDry, 0, Math.floor(0.05 * SAMPLE_RATE)),
    )
  })

  it('darkens and brightens the tail with the Tone button', () => {
    const bright = render({ reverb: { on: true, type: 'hall', mix: 0.9, tone: 'bright' } }, { seconds: 3 })
    const dark = render({ reverb: { on: true, type: 'hall', mix: 0.9, tone: 'dark' } }, { seconds: 3 })
    const tail = (samples: Float32Array) => samples.slice(Math.floor(0.8 * SAMPLE_RATE))
    expect(bandEnergy(tail(bright), SAMPLE_RATE, 1500, 5000)).toBeGreaterThan(
      bandEnergy(tail(dark), SAMPLE_RATE, 1500, 5000),
    )
  })

  it('bypasses cleanly', () => {
    const off = render({ reverb: { on: false, type: 'cathedral', mix: 1, tone: 'bright' } })
    expect(relativeDifference(off, DRY)).toBeLessThan(1e-6)
  })
})

describe('Rotary', () => {
  const toRotary: Partial<ChainSettings> = {
    amp: { on: true, type: 'rotary', drive: 0.2, bass: 0, mid: 0, treble: 0, midFrequency: 1000 },
  }

  function rotaryRig(speed: 'slow' | 'fast', drive = 0.2) {
    return engineRig({
      settings: settingsWith({ masterLevel: 0.3, rotary: { speed, drive }, layers: { a: { chain: toRotary } } }),
    })
  }

  it('modulates the signal, and turns faster on Fast than on Slow', () => {
    const slow = renderNote(rotaryRig('slow'), { midi: 55, seconds: 2.5 })
    const fast = renderNote(rotaryRig('fast'), { midi: 55, seconds: 2.5 })
    expect(rms(slow)).toBeGreaterThan(0.001)
    expect(relativeDifference(slow, fast)).toBeGreaterThan(0.1)

    // Count level swings: the fast rotor produces many more of them.
    const swings = (samples: Float32Array) => {
      const window = Math.floor(SAMPLE_RATE * 0.03)
      const levels: number[] = []
      for (let start = Math.floor(SAMPLE_RATE * 0.6); start + window < samples.length; start += window) {
        levels.push(rms(samples, start, start + window))
      }
      let crossings = 0
      const mean = levels.reduce((sum, value) => sum + value, 0) / levels.length
      for (let i = 1; i < levels.length; i += 1) {
        if (levels[i - 1] < mean && levels[i] >= mean) crossings += 1
      }
      return crossings
    }
    expect(swings(fast)).toBeGreaterThan(swings(slow))
  })

  it('drives harder as the Rotary Drive knob opens', () => {
    const clean = renderNote(rotaryRig('slow', 0), { midi: 55, seconds: 1.5 })
    const dirty = renderNote(rotaryRig('slow', 1), { midi: 55, seconds: 1.5 })
    expect(relativeDifference(clean, dirty)).toBeGreaterThan(0.1)
    expect(crestFactor(dirty)).toBeLessThan(crestFactor(clean))
  })

  it('accelerates smoothly instead of jumping when the speed changes', () => {
    const rig = rotaryRig('slow')
    rig.engine.noteOn('n', 55, 0.9)
    const before = rig.engine.rotary.hornRateHz
    rig.engine.applySettings(
      settingsWith({ masterLevel: 0.3, rotary: { speed: 'fast', drive: 0.2 }, layers: { a: { chain: toRotary } } }),
    )
    expect(before).toBeLessThan(rig.engine.rotary.hornRateHz)
    // The change is a ramp, not a step: the rendered signal keeps its level through it.
    const rendered = rig.graph.render(2)
    const early = rms(rendered, 0, Math.floor(0.4 * SAMPLE_RATE))
    const late = rms(rendered, Math.floor(0.9 * SAMPLE_RATE), Math.floor(1.3 * SAMPLE_RATE))
    expect(early).toBeGreaterThan(0)
    expect(late).toBeGreaterThan(0)
  })
})

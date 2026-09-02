import { describe, expect, it } from 'vitest'
import { audibleSeconds, bandEnergy, bandFraction, magnitudeSpectrum, maxAbsDifference, normalizedDifference, rms, spectralCentroid } from '../src/dsp/analysis'
import { renderEvents, type TimedEvent } from '../src/dsp/offline'
import { SynthLayerUnit } from '../src/dsp/synth'
import { defaultSynthLayerParams, envTimeSeconds, filterKnobToHz, type SynthEvent, type SynthLayerParams } from '../src/dsp/synthTypes'

const SR = 22050

type Overrides = { [K in keyof SynthLayerParams]?: SynthLayerParams[K] extends object ? Partial<SynthLayerParams[K]> : SynthLayerParams[K] }

/** Sustained sawtooth through the filter with all modulation off unless a test enables it. */
function patch(overrides: Overrides = {}): SynthLayerParams {
  const base = defaultSynthLayerParams({ on: true })
  const clean: Overrides = {
    wave: { type: 0, category: 0, index: 2, partial: 1 },
    filter: { on: true, type: 0, tracking: 0, drive: 0, freq: 5, res: 2, envAmount: 0 },
    filterEnv: { attack: 0, decay: 70, release: 40, velocity: false },
    lfo: { destination: 3 },
    vibrato: { mode: 0 },
    ampEnv: { attack: 0, decay: 127, release: 10, velocity: 0 },
    oscEnv: { attack: 0, decay: 80, release: 40, amount: 0, toPitch: false, velocity: false },
    arp: { run: false },
    unison: 0,
  }
  const out: Record<string, unknown> = { ...base }
  for (const layer of [clean, overrides]) {
    for (const [k, v] of Object.entries(layer)) {
      const cur = out[k]
      out[k] = v && typeof v === 'object' && cur && typeof cur === 'object' ? { ...(cur as object), ...(v as object) } : v
    }
  }
  return out as unknown as SynthLayerParams
}

function note(midi: number, at = 0, off = 0.3, velocity = 100): TimedEvent<SynthEvent>[] {
  return [
    { at, event: { type: 'on', midi, velocity, gain: 1 } },
    { at: off, event: { type: 'off', midi } },
  ]
}

function render(overrides: Overrides, events: TimedEvent<SynthEvent>[], seconds = 0.4): Float32Array {
  const unit = new SynthLayerUnit(SR)
  unit.setParams(patch(overrides))
  const buf = renderEvents(unit, events, seconds, SR)
  const out = new Float32Array(buf.l.length)
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (buf.l[i] + buf.r[i])
  return out
}

const slice = (x: Float32Array, from: number, to: number) => x.subarray(Math.round(from * SR), Math.round(to * SR))
const C3 = 48
const HELD = note(C3, 0, 0.35)
const steady = (x: Float32Array) => slice(x, 0.08, 0.3)

/** Fundamental estimate from zero crossings of a sine (Hz). */
function zeroCrossHz(x: Float32Array): number {
  let crossings = 0
  let first = -1
  let last = -1
  for (let i = 1; i < x.length; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      crossings++
      if (first < 0) first = i
      last = i
    }
  }
  if (crossings < 2) return 0
  return ((crossings - 1) * SR) / (last - first)
}

function peakHz(x: Float32Array): number {
  const s = magnitudeSpectrum(x, SR)
  let best = 1
  for (let i = 2; i < s.mags.length; i++) if (s.mags[i] > s.mags[best]) best = i
  return best * s.binHz
}

describe('synth.filter-envelopes — filter types / tracking / resonance / drive and the three envelopes have observable effects', () => {
  it('LP12, LP24, HP and BP are distinct: LP24 cuts highs harder than LP12, HP removes lows, BP is band-limited, off bypasses', () => {
    const type = (t: number) => steady(render({ filter: { type: t } }, HELD))
    const lp12 = type(0)
    const lp24 = type(1)
    const hp = type(2)
    const bp = type(3)
    const off = steady(render({ filter: { on: false } }, HELD))
    const cutoff = filterKnobToHz(5)
    expect(cutoff).toBeGreaterThan(500)
    expect(cutoff).toBeLessThan(900)
    const highs = (x: Float32Array) => bandEnergy(x, SR, 2500, 8000) / bandEnergy(x, SR, 0, SR / 2)
    const lows = (x: Float32Array) => bandFraction(x, SR, 0, 300)
    expect(highs(lp24)).toBeLessThan(highs(lp12) * 0.5)
    expect(highs(lp12)).toBeLessThan(highs(off) * 0.5)
    expect(lows(hp)).toBeLessThan(lows(lp12) * 0.3)
    expect(lows(bp)).toBeLessThan(lows(lp12) * 0.6)
    expect(highs(bp)).toBeLessThan(highs(hp) * 0.6)
    expect(bandFraction(bp, SR, cutoff / 2, cutoff * 2)).toBeGreaterThan(bandFraction(off, SR, cutoff / 2, cutoff * 2))
    const all = [lp12, lp24, hp, bp, off]
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(normalizedDifference(all[i], all[j])).toBeGreaterThan(0.1)
    for (const x of all) expect(rms(x)).toBeGreaterThan(0.01)
  })

  it('FREQ, RES, keyboard tracking and DRIVE each alter the rendered signal in the documented direction', () => {
    const dark = steady(render({ filter: { freq: 3 } }, HELD))
    const bright = steady(render({ filter: { freq: 8 } }, HELD))
    expect(spectralCentroid(bright, SR)).toBeGreaterThan(spectralCentroid(dark, SR) * 1.5)
    // resonance emphasises the band around the cutoff
    const cutoff = filterKnobToHz(5)
    const flat = steady(render({ filter: { res: 0 } }, HELD))
    const resonant = steady(render({ filter: { res: 9 } }, HELD))
    expect(bandFraction(resonant, SR, cutoff * 0.7, cutoff * 1.4)).toBeGreaterThan(bandFraction(flat, SR, cutoff * 0.7, cutoff * 1.4) * 1.3)
    // keyboard tracking moves the cutoff with the played note (manual p. 32)
    const high = note(72, 0, 0.35)
    const noTrack = steady(render({ filter: { tracking: 0 } }, high))
    const fullTrack = steady(render({ filter: { tracking: 3 } }, high))
    const twoThirds = steady(render({ filter: { tracking: 2 } }, high))
    expect(spectralCentroid(fullTrack, SR)).toBeGreaterThan(spectralCentroid(twoThirds, SR))
    expect(spectralCentroid(twoThirds, SR)).toBeGreaterThan(spectralCentroid(noTrack, SR))
    // a low note is unaffected by tracking relative to C4 in the same direction (cutoff falls below the base)
    const low = note(36, 0, 0.35)
    expect(spectralCentroid(steady(render({ filter: { tracking: 3 } }, low)), SR)).toBeLessThan(spectralCentroid(steady(render({ filter: { tracking: 0 } }, low)), SR))
    // drive: increasing saturation before the filter
    const open = { freq: 9, res: 0 }
    const clean = steady(render({ filter: { ...open, drive: 0 } }, HELD))
    const drives = [1, 2, 3].map((d) => normalizedDifference(clean, steady(render({ filter: { ...open, drive: d } }, HELD))))
    expect(drives[0]).toBeGreaterThan(0.05)
    expect(drives[1]).toBeGreaterThan(drives[0])
    expect(drives[2]).toBeGreaterThan(drives[1])
  })

  it('the filter envelope sweeps the cutoff over time by ENV AMT, with velocity when its Velocity option is on', () => {
    const early = (x: Float32Array) => slice(x, 0.005, 0.045)
    const late = (x: Float32Array) => slice(x, 0.28, 0.33)
    const still = render({ filter: { freq: 3, envAmount: 0 } }, HELD)
    const swept = render({ filter: { freq: 3, envAmount: 8 } }, HELD)
    expect(spectralCentroid(early(swept), SR)).toBeGreaterThan(spectralCentroid(late(swept), SR) * 1.5)
    expect(spectralCentroid(early(still), SR)).toBeLessThan(spectralCentroid(late(still), SR) * 1.2)
    expect(spectralCentroid(early(swept), SR)).toBeGreaterThan(spectralCentroid(early(still), SR) * 1.5)
    // a slower decay keeps the sweep open for longer
    const slow = render({ filter: { freq: 3, envAmount: 8 }, filterEnv: { decay: 100 } }, HELD)
    expect(spectralCentroid(late(slow), SR)).toBeGreaterThan(spectralCentroid(late(swept), SR) * 1.3)
    expect(envTimeSeconds(100)).toBeGreaterThan(envTimeSeconds(70) * 5)
    // velocity: off = same brightness for soft and hard strokes; on = a hard stroke opens the filter further
    const soft = note(C3, 0, 0.35, 30)
    const hard = note(C3, 0, 0.35, 127)
    const offSoft = render({ filter: { freq: 3, envAmount: 8 }, filterEnv: { velocity: false } }, soft)
    const offHard = render({ filter: { freq: 3, envAmount: 8 }, filterEnv: { velocity: false } }, hard)
    expect(maxAbsDifference(offSoft, offHard)).toBe(0)
    const onSoft = render({ filter: { freq: 3, envAmount: 8 }, filterEnv: { velocity: true } }, soft)
    const onHard = render({ filter: { freq: 3, envAmount: 8 }, filterEnv: { velocity: true } }, hard)
    expect(spectralCentroid(early(onHard), SR)).toBeGreaterThan(spectralCentroid(early(onSoft), SR) * 1.3)
  })

  it('the amplifier envelope: attack, decay (maximum = sustain), release and the four velocity levels', () => {
    const fast = render({ ampEnv: { attack: 0 } }, HELD)
    const slow = render({ ampEnv: { attack: 90 } }, HELD)
    expect(envTimeSeconds(90)).toBeGreaterThan(1)
    expect(rms(slice(slow, 0, 0.03))).toBeLessThan(rms(slice(fast, 0, 0.03)) * 0.1)
    expect(rms(slice(slow, 0.25, 0.3))).toBeGreaterThan(rms(slice(slow, 0.05, 0.1)))
    // decay: a short decay dies while the key is still held; decay 127 sustains
    const decaying = render({ ampEnv: { decay: 40 } }, HELD)
    const sustaining = render({ ampEnv: { decay: 127 } }, HELD)
    expect(rms(slice(decaying, 0.2, 0.3))).toBeLessThan(rms(slice(decaying, 0, 0.02)) * 0.05)
    expect(rms(slice(sustaining, 0.2, 0.3))).toBeGreaterThan(rms(slice(sustaining, 0, 0.02)) * 0.7)
    // release: longer release rings longer after the key is lifted at 0.15 s
    const events = note(C3, 0, 0.15)
    const shortRelease = render({ ampEnv: { release: 10 } }, events, 1.2)
    const longRelease = render({ ampEnv: { release: 100 } }, events, 1.2)
    expect(audibleSeconds(longRelease, SR)).toBeGreaterThan(audibleSeconds(shortRelease, SR) + 0.3)
    expect(audibleSeconds(shortRelease, SR)).toBeLessThan(0.3)
    // velocity levels: Off = same level; 1..3 = growing sensitivity
    const level = (velocityMode: number, velocity: number) => rms(steady(render({ ampEnv: { velocity: velocityMode } }, note(C3, 0, 0.35, velocity))))
    expect(Math.abs(level(0, 30) - level(0, 127))).toBeLessThan(1e-6)
    const ratios = [1, 2, 3].map((m) => level(m, 30) / level(m, 127))
    expect(ratios[0]).toBeLessThan(0.9)
    expect(ratios[1]).toBeLessThan(ratios[0])
    expect(ratios[2]).toBeLessThan(ratios[1])
  })

  it('the oscillator envelope modulates Osc Ctrl by its bipolar amount, or the pitch with Env To Pitch, with optional velocity', () => {
    // Sync Saw: Osc Ctrl is the synced oscillator's pitch, so an envelope on Osc Ctrl is a brightness sweep (manual p. 29, 33)
    const syncSaw = { type: 0, category: 1, index: 0, partial: 1 }
    const early = (x: Float32Array) => slice(x, 0.005, 0.05)
    const late = (x: Float32Array) => slice(x, 0.27, 0.33)
    const bright = (x: Float32Array) => spectralCentroid(x, SR)
    const flat = render({ wave: syncSaw, oscCtrl: 0, filter: { on: false }, oscEnv: { amount: 0 } }, HELD)
    const opened = render({ wave: syncSaw, oscCtrl: 0, filter: { on: false }, oscEnv: { amount: 10, decay: 80 } }, HELD)
    expect(bright(early(opened))).toBeGreaterThan(bright(early(flat)) * 1.3)
    expect(bright(early(opened))).toBeGreaterThan(bright(late(opened)) * 1.3)
    expect(bright(late(opened))).toBeLessThan(bright(early(flat)) * 1.3)
    expect(normalizedDifference(early(opened), early(flat))).toBeGreaterThan(0.1)
    // a negative amount pulls an open Osc Ctrl down early (bipolar knob, manual p. 33)
    const closed = render({ wave: syncSaw, oscCtrl: 8, filter: { on: false }, oscEnv: { amount: -10, decay: 80 } }, HELD)
    const open = render({ wave: syncSaw, oscCtrl: 8, filter: { on: false }, oscEnv: { amount: 0 } }, HELD)
    expect(bright(early(closed))).toBeLessThan(bright(early(open)) / 1.3)
    // Env To Pitch: the pitch starts high and glides down to the note as the envelope decays (manual p. 33)
    const sine = { type: 0, category: 0, index: 0, partial: 1 }
    const long = note(C3, 0, 0.58)
    const bent = render({ wave: sine, filter: { on: false }, oscEnv: { amount: 10, toPitch: true, decay: 80 } }, long, 0.6)
    const f0 = 130.81
    expect(zeroCrossHz(slice(bent, 0.0, 0.03))).toBeGreaterThan(f0 * 1.8)
    expect(Math.abs(zeroCrossHz(slice(bent, 0.45, 0.55)) - f0)).toBeLessThan(f0 * 0.08)
    const unbent = render({ wave: sine, filter: { on: false }, oscEnv: { amount: 0, toPitch: true } }, long, 0.6)
    expect(Math.abs(peakHz(steady(unbent)) - f0)).toBeLessThan(6)
    // velocity toggle: off = identical for soft and hard strokes; on = a hard stroke sweeps further
    const soft = note(C3, 0, 0.35, 30)
    const hard = note(C3, 0, 0.35, 127)
    const velOff = (e: TimedEvent<SynthEvent>[]) => render({ wave: syncSaw, oscCtrl: 0, filter: { on: false }, oscEnv: { amount: 10, decay: 80, velocity: false } }, e)
    const velOn = (e: TimedEvent<SynthEvent>[]) => render({ wave: syncSaw, oscCtrl: 0, filter: { on: false }, oscEnv: { amount: 10, decay: 80, velocity: true } }, e)
    expect(maxAbsDifference(velOff(soft), velOff(hard))).toBe(0)
    expect(normalizedDifference(early(velOn(soft)), early(velOn(hard)))).toBeGreaterThan(0.1)
    expect(bright(early(velOn(hard)))).toBeGreaterThan(bright(early(velOn(soft))) * 1.3)
  })
})

import { describe, expect, it } from 'vitest'
import { bandFraction, magnitudeSpectrum, maxAbsDifference, normalizedDifference, rms, spectralCentroid } from '../src/dsp/analysis'
import { renderEvents, type TimedEvent } from '../src/dsp/offline'
import { SynthLayerUnit } from '../src/dsp/synth'
import { ANALOG_CATEGORIES, ANALOG_WAVEFORMS, FM_PARTIALS, FM_WAVEFORMS, defaultSynthLayerParams, type SynthEvent, type SynthLayerParams } from '../src/dsp/synthTypes'
import { faderToGain } from '../src/dsp/types'
import { midiHz } from '../src/dsp/util'

const SR = 22050

type Overrides = { [K in keyof SynthLayerParams]?: SynthLayerParams[K] extends object ? Partial<SynthLayerParams[K]> : SynthLayerParams[K] }

/** A clean, sustained baseline patch: filter and modulation off so the oscillator itself is measured. */
function patch(overrides: Overrides = {}): SynthLayerParams {
  const base = defaultSynthLayerParams({ on: true })
  const clean: Overrides = {
    filter: { on: false },
    lfo: { destination: 3 },
    vibrato: { mode: 0 },
    ampEnv: { attack: 0, decay: 127, release: 10, velocity: 0 },
    oscEnv: { amount: 0, toPitch: false },
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

function note(midi: number, at = 0, off = 0.3, velocity = 100, gain = 1): TimedEvent<SynthEvent>[] {
  return [
    { at, event: { type: 'on', midi, velocity, gain } },
    { at: off, event: { type: 'off', midi } },
  ]
}

function render(overrides: Overrides, events: TimedEvent<SynthEvent>[], seconds = 0.4, blockSize = 128) {
  const unit = new SynthLayerUnit(SR)
  unit.setParams(patch(overrides))
  return renderEvents(unit, events, seconds, SR, blockSize)
}

function mono(buf: { l: Float32Array; r: Float32Array }): Float32Array {
  const out = new Float32Array(buf.l.length)
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (buf.l[i] + buf.r[i])
  return out
}

/** Frequency of the strongest spectral peak in Hz. */
function peakHz(x: Float32Array): number {
  const s = magnitudeSpectrum(x, SR)
  let best = 1
  for (let i = 2; i < s.mags.length; i++) if (s.mags[i] > s.mags[best]) best = i
  return best * s.binHz
}

/** Number of spectral bins carrying at least 5% of the peak magnitude below `maxHz` (spectral "spread"). */
function significantBins(x: Float32Array, maxHz: number): number {
  const s = magnitudeSpectrum(x, SR)
  const hi = Math.min(s.mags.length - 1, Math.floor(maxHz / s.binHz))
  let max = 0
  for (let i = 1; i <= hi; i++) max = Math.max(max, s.mags[i])
  let n = 0
  for (let i = 1; i <= hi; i++) if (s.mags[i] >= 0.05 * max) n++
  return n
}

/** Peak-to-trough ratio of the short-window RMS (beating / amplitude modulation detector). */
function windowRmsRatio(x: Float32Array, windowSeconds = 0.05, from = 0.05, to = 0.85): number {
  const w = Math.round(windowSeconds * SR)
  let min = Infinity
  let max = 0
  for (let start = Math.round(from * SR); start + w <= Math.min(x.length, Math.round(to * SR)); start += w) {
    const v = rms(x, start, start + w)
    min = Math.min(min, v)
    max = Math.max(max, v)
  }
  return min > 0 ? max / min : Infinity
}

const C3 = 48
const HELD = note(C3, 0, 0.35)
const steady = (x: Float32Array) => x.subarray(Math.round(0.05 * SR), Math.round(0.3 * SR))

describe('synth.sources — three layers, required waveforms distinct per category, Osc Ctrl per category', () => {
  it('every required Analog waveform and the FM-H algorithm is selectable and renders a non-silent tone', () => {
    const names: string[] = []
    ANALOG_WAVEFORMS.forEach((waves, category) => {
      waves.forEach((name, index) => {
        const out = mono(render({ wave: { type: 0, category, index, partial: 1 } }, HELD))
        expect(rms(out), `${ANALOG_CATEGORIES[category]} · ${name}`).toBeGreaterThan(0.02)
        expect(out.every((v) => Number.isFinite(v))).toBe(true)
        names.push(name)
      })
    })
    expect(names).toEqual(['Sine', 'Triangle', 'Saw', 'Square', 'Pulse 33', 'Pulse 10', 'White Noise', 'Sync Saw', 'Sync Square', 'Multi Saw', 'Multi Saw 8ve', 'Super Saw', 'Super Square'])
    const fm = mono(render({ wave: { type: 1, category: 0, index: 0, partial: 1 } }, HELD))
    expect(rms(fm), FM_WAVEFORMS[0][0]).toBeGreaterThan(0.02)
    expect(FM_PARTIALS[1]).toBe(1)
  })

  it('Pure waveforms are distinct: sine is pure, triangle is darker than saw, square / pulse widths and noise differ', () => {
    const wave = (index: number) => steady(mono(render({ wave: { type: 0, category: 0, index, partial: 1 } }, HELD)))
    const f0 = midiHz(C3)
    const sine = wave(0)
    const tri = wave(1)
    const saw = wave(2)
    const square = wave(3)
    const pulse33 = wave(4)
    const pulse10 = wave(5)
    const noise = wave(6)
    expect(bandFraction(sine, SR, 0, 1.5 * f0)).toBeGreaterThan(0.95)
    expect(Math.abs(peakHz(sine) - f0)).toBeLessThan(6)
    expect(spectralCentroid(tri, SR)).toBeLessThan(spectralCentroid(saw, SR))
    expect(spectralCentroid(sine, SR)).toBeLessThan(spectralCentroid(tri, SR))
    // square has (almost) no even harmonics, saw has them
    const even = (x: Float32Array) => bandFraction(x, SR, 1.9 * f0, 2.1 * f0)
    expect(even(square)).toBeLessThan(even(saw) * 0.2)
    expect(normalizedDifference(square, pulse33)).toBeGreaterThan(0.1)
    expect(normalizedDifference(pulse33, pulse10)).toBeGreaterThan(0.1)
    expect(bandFraction(noise, SR, 4000, 11000)).toBeGreaterThan(0.3)
    expect(rms(noise)).toBeGreaterThan(0.02)
    // seeded noise renders identically every time
    expect(maxAbsDifference(noise, wave(6))).toBe(0)
  })

  it('the five source categories (Pure, Sync, Multi, Super, FM-H) are pairwise distinct on the same note', () => {
    const reps: Record<string, Float32Array> = {
      pure: steady(mono(render({ wave: { type: 0, category: 0, index: 2, partial: 1 }, oscCtrl: 6 }, HELD))),
      sync: steady(mono(render({ wave: { type: 0, category: 1, index: 0, partial: 1 }, oscCtrl: 6 }, HELD))),
      multi: steady(mono(render({ wave: { type: 0, category: 2, index: 0, partial: 1 }, oscCtrl: 6 }, HELD))),
      super: steady(mono(render({ wave: { type: 0, category: 3, index: 0, partial: 1 }, oscCtrl: 6 }, HELD))),
      fm: steady(mono(render({ wave: { type: 1, category: 0, index: 0, partial: 3 }, oscCtrl: 6 }, HELD))),
    }
    const keys = Object.keys(reps)
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        expect(normalizedDifference(reps[keys[i]], reps[keys[j]]), `${keys[i]} vs ${keys[j]}`).toBeGreaterThan(0.15)
      }
    }
    // sync and FM push energy upward relative to the plain saw; multi / super widen the spectral lines
    expect(spectralCentroid(reps.sync, SR)).toBeGreaterThan(spectralCentroid(reps.pure, SR))
    expect(significantBins(reps.super, 2000)).toBeGreaterThan(significantBins(reps.pure, 2000))
  })

  it('Osc Ctrl has no effect on Pure waveforms (bit-identical), sets the synced pitch, the Multi detune, the Super width and the FM amount', () => {
    const f0 = midiHz(C3)
    // Pure: identical output for ctrl 0 and 10 (manual p. 29)
    for (const index of [0, 2, 3]) {
      const a = mono(render({ wave: { type: 0, category: 0, index, partial: 1 }, oscCtrl: 0 }, HELD))
      const b = mono(render({ wave: { type: 0, category: 0, index, partial: 1 }, oscCtrl: 10 }, HELD))
      expect(maxAbsDifference(a, b)).toBe(0)
    }
    // Sync: relative pitch of the synced oscillator rises with Osc Ctrl → brighter, still locked to the master pitch
    const sync0 = steady(mono(render({ wave: { type: 0, category: 1, index: 0, partial: 1 }, oscCtrl: 0 }, HELD)))
    const sync8 = steady(mono(render({ wave: { type: 0, category: 1, index: 0, partial: 1 }, oscCtrl: 8 }, HELD)))
    expect(spectralCentroid(sync8, SR)).toBeGreaterThan(spectralCentroid(sync0, SR) * 1.5)
    expect(normalizedDifference(sync0, sync8)).toBeGreaterThan(0.2)
    // Multi: Osc Ctrl = detune between the two saws → beating appears
    const multi0 = mono(render({ wave: { type: 0, category: 2, index: 0, partial: 1 }, oscCtrl: 0 }, note(C3, 0, 0.9), 1))
    const multi10 = mono(render({ wave: { type: 0, category: 2, index: 0, partial: 1 }, oscCtrl: 10 }, note(C3, 0, 0.9), 1))
    const periods = 10 / f0 // whole-period windows so a steady tone measures flat
    expect(windowRmsRatio(multi0, periods)).toBeLessThan(1.03)
    expect(windowRmsRatio(multi10, periods)).toBeGreaterThan(1.2)
    // Multi Saw 8ve puts the second saw an octave up
    const multi8ve = steady(mono(render({ wave: { type: 0, category: 2, index: 1, partial: 1 }, oscCtrl: 0 }, HELD)))
    expect(bandFraction(multi8ve, SR, 1.9 * f0, 2.1 * f0)).toBeGreaterThan(bandFraction(steady(multi0), SR, 1.9 * f0, 2.1 * f0) * 1.5)
    // Super: Osc Ctrl = detune / width of the stack → the spectral lines spread
    const super0 = steady(mono(render({ wave: { type: 0, category: 3, index: 0, partial: 1 }, oscCtrl: 0 }, HELD)))
    const super10 = steady(mono(render({ wave: { type: 0, category: 3, index: 0, partial: 1 }, oscCtrl: 10 }, HELD)))
    expect(significantBins(super10, 1500)).toBeGreaterThan(significantBins(super0, 1500))
    expect(normalizedDifference(super0, super10)).toBeGreaterThan(0.2)
    // FM-H: Osc Ctrl 0 = a pure sine carrier; higher amounts add sidebands and raise the centroid
    const fm0 = steady(mono(render({ wave: { type: 1, category: 0, index: 0, partial: 3 }, oscCtrl: 0 }, HELD)))
    const fm8 = steady(mono(render({ wave: { type: 1, category: 0, index: 0, partial: 3 }, oscCtrl: 8 }, HELD)))
    expect(bandFraction(fm0, SR, 0, 1.5 * f0)).toBeGreaterThan(0.95)
    expect(spectralCentroid(fm8, SR)).toBeGreaterThan(spectralCentroid(fm0, SR) * 2)
    // the Partial changes the sideband structure at the same amount
    const fm8p1 = steady(mono(render({ wave: { type: 1, category: 0, index: 0, partial: 1 }, oscCtrl: 8 }, HELD)))
    expect(normalizedDifference(fm8, fm8p1)).toBeGreaterThan(0.1)
  })

  it('pitch follows coarse / fine tune, octave shift and the pitch stick (only with PSTICK on)', () => {
    const sine = (o: Overrides) => steady(mono(render({ wave: { type: 0, category: 0, index: 0, partial: 1 }, ...o }, HELD)))
    const f0 = midiHz(C3)
    expect(Math.abs(peakHz(sine({})) - f0)).toBeLessThan(6)
    expect(Math.abs(peakHz(sine({ pitch: { coarse: 12, fine: 0 } })) - 2 * f0)).toBeLessThan(6)
    expect(Math.abs(peakHz(sine({ octave: 1 })) - 2 * f0)).toBeLessThan(6)
    expect(Math.abs(peakHz(sine({ pitch: { coarse: 7, fine: 0 } })) - midiHz(C3 + 7))).toBeLessThan(6)
    const fine = sine({ pitch: { coarse: 0, fine: 50 } })
    expect(peakHz(fine)).toBeGreaterThan(f0 * 1.015)
    expect(peakHz(fine)).toBeLessThan(f0 * 1.045)
    const bent = sine({ pstick: true, pitchBend: 1 })
    expect(Math.abs(peakHz(bent) - midiHz(C3 + 2))).toBeLessThan(6)
    expect(maxAbsDifference(sine({ pstick: false, pitchBend: 1 }), sine({}))).toBe(0)
  })

  it('level fader, note gain (zone crossfade) and layer on/off scale the output; Samples / Extern positions render like Analog', () => {
    const full = mono(render({ level: 100 }, HELD))
    const half = mono(render({ level: 50 }, HELD))
    const ratio = rms(half) / rms(full)
    expect(ratio).toBeGreaterThan(faderToGain(50) / faderToGain(100) - 0.03)
    expect(ratio).toBeLessThan(faderToGain(50) / faderToGain(100) + 0.03)
    const gained = mono(render({ level: 100 }, note(C3, 0, 0.35, 100, 0.5)))
    expect(rms(gained) / rms(full)).toBeGreaterThan(0.45)
    expect(rms(gained) / rms(full)).toBeLessThan(0.55)
    expect(rms(mono(render({ on: false }, HELD)))).toBe(0)
    const analog = mono(render({ mode: 0 }, HELD))
    expect(maxAbsDifference(analog, mono(render({ mode: 1 }, HELD)))).toBe(0)
    expect(maxAbsDifference(analog, mono(render({ mode: 2 }, HELD)))).toBe(0)
    // one voice at full velocity peaks around 0.35 before the fader
    let pk = 0
    for (const v of full) pk = Math.max(pk, Math.abs(v))
    expect(pk).toBeGreaterThan(0.2)
    expect(pk).toBeLessThan(0.6)
  })

  it('renders deterministically and independently of the host block size', () => {
    // events land on block boundaries (like worklet messages), so the note-off is placed on a boundary shared by every block size
    const aligned = note(C3, 0, (13 * 512) / SR)
    const a = render({ wave: { type: 0, category: 3, index: 0, partial: 1 }, unison: 2 }, aligned, 0.4, 128)
    const b = render({ wave: { type: 0, category: 3, index: 0, partial: 1 }, unison: 2 }, aligned, 0.4, 64)
    const c = render({ wave: { type: 0, category: 3, index: 0, partial: 1 }, unison: 2 }, aligned, 0.4, 512)
    expect(maxAbsDifference(a.l, b.l)).toBeLessThan(1e-6)
    expect(maxAbsDifference(a.r, c.r)).toBeLessThan(1e-6)
    expect(rms(a.l)).toBeGreaterThan(0.02)
  })
})

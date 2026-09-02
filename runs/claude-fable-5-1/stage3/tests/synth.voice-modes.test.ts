import { describe, expect, it } from 'vitest'
import { maxAbsDifference, normalizedDifference, rms, spectralCentroid, stereoCorrelation } from '../src/dsp/analysis'
import { renderEvents, type TimedEvent } from '../src/dsp/offline'
import { SynthLayerUnit } from '../src/dsp/synth'
import { LFO_SUBDIVISIONS, MAX_SYNTH_VOICES, defaultSynthLayerParams, subdivisionFromKnob, subdivisionSeconds, type SynthEvent, type SynthLayerParams } from '../src/dsp/synthTypes'
import { lfoKnobToHz } from '../src/dsp/types'
import { midiHz } from '../src/dsp/util'

const SR = 22050

type Overrides = { [K in keyof SynthLayerParams]?: SynthLayerParams[K] extends object ? Partial<SynthLayerParams[K]> : SynthLayerParams[K] }

/** Sustained sine with everything else off: pitch behaviour is measured from zero crossings. */
function patch(overrides: Overrides = {}): SynthLayerParams {
  const base = defaultSynthLayerParams({ on: true })
  const clean: Overrides = {
    wave: { type: 0, category: 0, index: 0, partial: 1 },
    filter: { on: false },
    lfo: { destination: 3, amount: 10, rate: 5, sync: false, wave: 0 },
    vibrato: { mode: 0, rate: 6, amount: 10, delay: 0.7 },
    ampEnv: { attack: 0, decay: 127, release: 10, velocity: 0 },
    oscEnv: { amount: 0, toPitch: false },
    voice: { mode: 0, priority: 0, glide: 0 },
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

const on = (midi: number, at: number, velocity = 100): TimedEvent<SynthEvent> => ({ at, event: { type: 'on', midi, velocity, gain: 1 } })
const off = (midi: number, at: number): TimedEvent<SynthEvent> => ({ at, event: { type: 'off', midi } })

function unitWith(overrides: Overrides): SynthLayerUnit {
  const unit = new SynthLayerUnit(SR)
  unit.setParams(patch(overrides))
  return unit
}

function render(overrides: Overrides, events: TimedEvent<SynthEvent>[], seconds = 0.5) {
  return renderEvents(unitWith(overrides), events, seconds, SR)
}

function mono(buf: { l: Float32Array; r: Float32Array }): Float32Array {
  const out = new Float32Array(buf.l.length)
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (buf.l[i] + buf.r[i])
  return out
}

const slice = (x: Float32Array, from: number, to: number) => x.subarray(Math.round(from * SR), Math.round(to * SR))

/** Fundamental estimate from rising zero crossings (Hz). */
function hz(x: Float32Array): number {
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

/** Frequency estimate per short window (Hz). */
function hzWindows(x: Float32Array, from: number, to: number, window = 0.04): number[] {
  const out: number[] = []
  for (let t = from; t + window <= to; t += window) out.push(hz(slice(x, t, t + window)))
  return out
}

/** Steps a unit through `seconds` in one-sample blocks, calling `probe` after every sample. */
function stepSamples(unit: SynthLayerUnit, seconds: number, probe: (sample: number) => void) {
  const l = new Float32Array(1)
  const r = new Float32Array(1)
  const total = Math.round(seconds * SR)
  for (let i = 0; i < total; i++) {
    unit.process(l, r, 1)
    probe(i)
  }
}

describe('synth.voice-modes — poly / mono / legato, priority, glide, unison, vibrato and LFO behaviour', () => {
  it('Poly plays every held note (up to 16, oldest stolen); Mono and Legato play one voice', () => {
    const chord = [48, 52, 55, 60]
    const poly = unitWith({ voice: { mode: 0 } })
    for (const m of chord) poly.handle({ type: 'on', midi: m, velocity: 100, gain: 1 })
    poly.process(new Float32Array(128), new Float32Array(128), 128)
    expect(poly.voiceCount).toBe(4)
    expect(poly.heldNotes()).toEqual(chord)
    for (let m = 24; m < 24 + MAX_SYNTH_VOICES + 4; m++) poly.handle({ type: 'on', midi: m, velocity: 100, gain: 1 })
    poly.process(new Float32Array(128), new Float32Array(128), 128)
    expect(poly.voiceCount).toBe(MAX_SYNTH_VOICES)
    for (const mode of [1, 2]) {
      const u = unitWith({ voice: { mode } })
      for (const m of chord) u.handle({ type: 'on', midi: m, velocity: 100, gain: 1 })
      u.process(new Float32Array(128), new Float32Array(128), 128)
      expect(u.voiceCount).toBe(1)
    }
    // the chord is audibly richer than a single note in Poly, identical in level to one note in Mono
    const polyOut = mono(render({ voice: { mode: 0 } }, chord.map((m) => on(m, 0))))
    const single = mono(render({ voice: { mode: 0 } }, [on(48, 0)]))
    expect(rms(polyOut)).toBeGreaterThan(rms(single) * 1.5)
  })

  it('note priority in Mono: Off = last note (and back on release), Low = lowest held, High = highest held', () => {
    const pitchAt = (o: Overrides, events: TimedEvent<SynthEvent>[], t: number) => hz(slice(mono(render(o, events, 0.7)), t, t + 0.06))
    const seq = [on(60, 0), on(67, 0.2), off(67, 0.4)]
    const last = { voice: { mode: 1, priority: 0 } }
    expect(Math.abs(pitchAt(last, seq, 0.1) - midiHz(60))).toBeLessThan(3)
    expect(Math.abs(pitchAt(last, seq, 0.3) - midiHz(67))).toBeLessThan(4)
    expect(Math.abs(pitchAt(last, seq, 0.5) - midiHz(60))).toBeLessThan(3)
    const low = { voice: { mode: 1, priority: 1 } }
    expect(Math.abs(pitchAt(low, seq, 0.3) - midiHz(60))).toBeLessThan(3)
    expect(Math.abs(pitchAt(low, [on(67, 0), on(60, 0.2)], 0.3) - midiHz(60))).toBeLessThan(3)
    const high = { voice: { mode: 1, priority: 2 } }
    expect(Math.abs(pitchAt(high, [on(67, 0), on(60, 0.2)], 0.3) - midiHz(67))).toBeLessThan(4)
    expect(Math.abs(pitchAt(high, seq, 0.3) - midiHz(67))).toBeLessThan(4)
    // priority has no effect on polyphonic playing: both notes sound
    const both = mono(render({ voice: { mode: 0, priority: 1 } }, [on(60, 0), on(67, 0)]))
    const one = mono(render({ voice: { mode: 0, priority: 1 } }, [on(60, 0)]))
    expect(rms(slice(both, 0.1, 0.3))).toBeGreaterThan(rms(slice(one, 0.1, 0.3)) * 1.2)
  })

  it('glide is a constant-rate portamento in Mono, and only for overlapping notes in Legato', () => {
    const overlapping = [on(48, 0), on(60, 0.2)]
    const glideOn = mono(render({ voice: { mode: 1, glide: 7 } }, overlapping, 1.2))
    const mid = hz(slice(glideOn, 0.3, 0.34))
    expect(mid).toBeGreaterThan(midiHz(48) * 1.1)
    expect(mid).toBeLessThan(midiHz(60) * 0.9)
    const later = hz(slice(glideOn, 0.5, 0.54))
    expect(later).toBeGreaterThan(mid)
    expect(Math.abs(hz(slice(glideOn, 1.1, 1.16)) - midiHz(60))).toBeLessThan(3)
    // no glide: the pitch jumps
    const glideOff = mono(render({ voice: { mode: 1, glide: 0 } }, overlapping, 0.6))
    expect(Math.abs(hz(slice(glideOff, 0.25, 0.29)) - midiHz(60))).toBeLessThan(3)
    // a bigger interval takes longer at the same rate (constant rate, manual p. 35)
    const wide = mono(render({ voice: { mode: 1, glide: 7 } }, [on(36, 0), on(60, 0.2)], 1.2))
    expect(hz(slice(wide, 0.5, 0.54))).toBeLessThan(hz(slice(glideOn, 0.5, 0.54)))
    // Legato: staccato notes jump even with glide; overlapping notes glide
    const staccato = [on(48, 0), off(48, 0.1), on(60, 0.2)]
    const legatoStaccato = mono(render({ voice: { mode: 2, glide: 7 } }, staccato, 0.6))
    expect(Math.abs(hz(slice(legatoStaccato, 0.25, 0.29)) - midiHz(60))).toBeLessThan(3)
    const legatoOverlap = mono(render({ voice: { mode: 2, glide: 7 } }, overlapping, 0.6))
    const legMid = hz(slice(legatoOverlap, 0.3, 0.34))
    expect(legMid).toBeGreaterThan(midiHz(48) * 1.1)
    expect(legMid).toBeLessThan(midiHz(60) * 0.9)
    // Mono glides even for staccato playing
    const monoStaccato = mono(render({ voice: { mode: 1, glide: 7 } }, staccato, 0.6))
    const monoMid = hz(slice(monoStaccato, 0.3, 0.34))
    expect(monoMid).toBeGreaterThan(midiHz(48) * 1.1)
    expect(monoMid).toBeLessThan(midiHz(60) * 0.9)
  })

  it('Mono restarts the envelopes on an overlapping note while Legato lets them continue', () => {
    const events = [on(48, 0), on(55, 0.2), off(48, 0.5), off(55, 0.5)]
    const decay = { ampEnv: { attack: 0, decay: 50, release: 10 } }
    const monoOut = mono(render({ ...decay, voice: { mode: 1 } }, events, 0.6))
    const legatoOut = mono(render({ ...decay, voice: { mode: 2 } }, events, 0.6))
    // by 0.2 s the first note has decayed away in both modes
    expect(rms(slice(monoOut, 0.15, 0.2))).toBeLessThan(0.01)
    expect(rms(slice(legatoOut, 0.15, 0.2))).toBeLessThan(0.01)
    // the second, overlapping note restarts the amplifier envelope only in Mono
    expect(rms(slice(monoOut, 0.2, 0.25))).toBeGreaterThan(0.02)
    expect(rms(slice(legatoOut, 0.2, 0.25))).toBeLessThan(0.005)
    expect(rms(slice(monoOut, 0.2, 0.25))).toBeGreaterThan(rms(slice(legatoOut, 0.2, 0.25)) * 5)
  })

  it('Unison Off is exactly mono; 1 / 2 / 3 add detuned copies with growing stereo width', () => {
    const events = [on(48, 0), off(48, 0.4)]
    const offBuf = render({ unison: 0 }, events)
    expect(maxAbsDifference(offBuf.l, offBuf.r)).toBe(0)
    const corr = [1, 2, 3].map((u) => {
      const b = render({ unison: u, wave: { type: 0, category: 0, index: 2, partial: 1 } }, events)
      return stereoCorrelation(slice(b.l, 0.05, 0.4), slice(b.r, 0.05, 0.4))
    })
    expect(corr[0]).toBeLessThan(0.995)
    expect(corr[1]).toBeLessThan(corr[0])
    expect(corr[2]).toBeLessThan(corr[1])
    const sawOff = mono(render({ unison: 0, wave: { type: 0, category: 0, index: 2, partial: 1 } }, events))
    const saw3 = mono(render({ unison: 3, wave: { type: 0, category: 0, index: 2, partial: 1 } }, events))
    expect(normalizedDifference(slice(sawOff, 0.05, 0.4), slice(saw3, 0.05, 0.4))).toBeGreaterThan(0.1)
    expect(rms(saw3)).toBeGreaterThan(rms(sawOff) * 0.5)
  })

  it('vibrato modes: On modulates the pitch, Wheel follows the wheel, Delay fades in after its delay time, Pedal follows the pedal, Aftertouch is inert', () => {
    const events = [on(60, 0), off(60, 1.5)]
    const plain = mono(render({ vibrato: { mode: 0 } }, events, 1.6))
    const vib = mono(render({ vibrato: { mode: 3 } }, events, 1.6))
    const spread = (x: Float32Array, from: number, to: number) => {
      const f = hzWindows(x, from, to, 0.02)
      return Math.max(...f) / Math.min(...f)
    }
    expect(spread(plain, 0.1, 0.6)).toBeLessThan(1.01)
    expect(spread(vib, 0.1, 0.6)).toBeGreaterThan(1.03)
    expect(normalizedDifference(plain, vib)).toBeGreaterThan(0.05)
    // Wheel: depth follows the modulation wheel (manual p. 37)
    expect(maxAbsDifference(mono(render({ vibrato: { mode: 1 }, wheel: 0 }, events, 1.6)), plain)).toBe(0)
    expect(spread(mono(render({ vibrato: { mode: 1 }, wheel: 1 }, events, 1.6)), 0.1, 0.6)).toBeGreaterThan(1.03)
    expect(spread(mono(render({ vibrato: { mode: 1 }, wheel: 0.3 }, events, 1.6)), 0.1, 0.6)).toBeLessThan(spread(vib, 0.1, 0.6))
    // Delay: no vibrato before the delay time, full vibrato later
    const delayed = mono(render({ vibrato: { mode: 2, delay: 0.7 } }, events, 1.6))
    expect(maxAbsDifference(slice(delayed, 0, 0.6), slice(plain, 0, 0.6))).toBe(0)
    expect(spread(delayed, 1.3, 1.5)).toBeGreaterThan(1.03)
    // Pedal follows the control pedal; Aftertouch has no source in a browser (inert)
    expect(spread(mono(render({ vibrato: { mode: 5 }, pedal: 1 }, events, 1.6)), 0.1, 0.6)).toBeGreaterThan(1.03)
    expect(maxAbsDifference(mono(render({ vibrato: { mode: 5 }, pedal: 0 }, events, 1.6)), plain)).toBe(0)
    expect(maxAbsDifference(mono(render({ vibrato: { mode: 4 } }, events, 1.6)), plain)).toBe(0)
    // rate and amount menu values change the modulation
    const slow = mono(render({ vibrato: { mode: 3, rate: 2 } }, events, 1.6))
    const fast = mono(render({ vibrato: { mode: 3, rate: 8 } }, events, 1.6))
    expect(normalizedDifference(slow, fast)).toBeGreaterThan(0.05)
    expect(spread(mono(render({ vibrato: { mode: 3, amount: 3 } }, events, 1.6)), 0.1, 0.6)).toBeLessThan(spread(vib, 0.1, 0.6))
  })

  it('LFO: five distinct waveforms, three destinations (pitch, Osc Ctrl, filter), off keeps its settings silent', () => {
    const events = [on(60, 0), off(60, 1.4)]
    const pitchLfo = (wave: number) => mono(render({ lfo: { destination: 0, wave, rate: 5, amount: 10 } }, events, 1.5))
    const shapes = [0, 1, 2, 3, 4].map(pitchLfo)
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) expect(normalizedDifference(shapes[i], shapes[j]), `LFO wave ${i} vs ${j}`).toBeGreaterThan(0.05)
    }
    // the pitch destination sweeps the fundamental over one LFO cycle (1 Hz at knob 5)
    expect(Math.abs(lfoKnobToHz(5) - 1)).toBeLessThan(1e-9)
    const f = hzWindows(shapes[0], 0.05, 1.05, 0.05)
    expect(Math.max(...f) / Math.min(...f)).toBeGreaterThan(2)
    // sample & hold is random but seeded: identical on every run
    expect(maxAbsDifference(shapes[4], pitchLfo(4))).toBe(0)
    // destination off = no modulation at all; amount 0 = no modulation either
    const plain = mono(render({ lfo: { destination: 3, amount: 10 } }, events, 1.5))
    expect(maxAbsDifference(plain, mono(render({ lfo: { destination: 0, amount: 0 } }, events, 1.5)))).toBe(0)
    expect(normalizedDifference(plain, shapes[0])).toBeGreaterThan(0.1)
    // Osc Ctrl destination on a Super Saw: the stack width breathes; filter destination: the brightness breathes
    const superSaw = { type: 0, category: 3, index: 0, partial: 1 }
    const ctrlLfo = mono(render({ wave: superSaw, oscCtrl: 5, lfo: { destination: 1, wave: 0, rate: 5, amount: 10 } }, events, 1.5))
    const ctrlStill = mono(render({ wave: superSaw, oscCtrl: 5, lfo: { destination: 3 } }, events, 1.5))
    expect(normalizedDifference(ctrlLfo, ctrlStill)).toBeGreaterThan(0.1)
    const filterLfo = mono(render({ wave: { type: 0, category: 0, index: 2, partial: 1 }, filter: { on: true, type: 0, freq: 4, res: 2 }, lfo: { destination: 2, wave: 0, rate: 5, amount: 10 } }, events, 1.5))
    const centroids = [0.05, 0.3, 0.55, 0.8].map((t) => spectralCentroid(slice(filterLfo, t, t + 0.1), SR))
    expect(Math.max(...centroids) / Math.min(...centroids)).toBeGreaterThan(1.5)
    const pitchOnly = pitchLfo(0)
    expect(normalizedDifference(pitchOnly, filterLfo)).toBeGreaterThan(0.1)
  })

  it('LFO Master Clock sync locks the period to the BPM subdivision and clock reset restarts the phase', () => {
    const flips = (unit: SynthLayerUnit, seconds: number) => {
      const out: number[] = []
      let last = unit.lfoValue
      stepSamples(unit, seconds, (i) => {
        const v = unit.lfoValue
        if (v !== last) out.push(i)
        last = v
      })
      return out
    }
    // square LFO: the value flips every half period
    const bpm = 120
    const synced = unitWith({ lfo: { destination: 0, wave: 3, sync: true, rate: 10 } , bpm })
    synced.handle({ type: 'on', midi: 60, velocity: 100, gain: 1 })
    const period = subdivisionSeconds(subdivisionFromKnob(LFO_SUBDIVISIONS, 10), bpm) * SR
    expect(subdivisionFromKnob(LFO_SUBDIVISIONS, 10).label).toBe('1/16')
    const f = flips(synced, 1)
    expect(f.length).toBeGreaterThan(6)
    for (let i = 1; i < f.length; i++) expect(Math.abs(f[i] - f[i - 1] - period / 2)).toBeLessThanOrEqual(1)
    // a slower subdivision at the same knob → longer period; a free-running LFO ignores the BPM
    const half = unitWith({ lfo: { destination: 0, wave: 3, sync: true, rate: 5 }, bpm })
    half.handle({ type: 'on', midi: 60, velocity: 100, gain: 1 })
    const h = flips(half, 1.2)
    expect(subdivisionFromKnob(LFO_SUBDIVISIONS, 5).label).toBe('1/2')
    expect(h.length).toBeGreaterThanOrEqual(1)
    expect(h.length).toBeLessThan(3)
    const free = unitWith({ lfo: { destination: 0, wave: 3, sync: false, rate: 10 }, bpm })
    const fr = flips(free, 1)
    expect(Math.abs(fr[1] - fr[0] - SR / lfoKnobToHz(10) / 2)).toBeLessThanOrEqual(1)
    // clock reset: the next flip happens exactly half a period after the reset
    const reset = unitWith({ lfo: { destination: 0, wave: 3, sync: true, rate: 10 }, bpm })
    reset.handle({ type: 'on', midi: 60, velocity: 100, gain: 1 })
    stepSamples(reset, 0.03, () => undefined)
    reset.handle({ type: 'clockReset' })
    const after = flips(reset, 0.5)
    expect(Math.abs(after[0] - period / 2)).toBeLessThanOrEqual(1)
  })
})

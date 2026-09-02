import { describe, expect, it } from 'vitest'
import { bandEnergy, magnitudeSpectrum, maxAbsDifference, normalizedDifference, peak, rms, spectralCentroid, type Spectrum } from '../src/dsp/analysis'
import { renderEvents, type TimedEvent } from '../src/dsp/offline'
import { OrganUnit } from '../src/dsp/organ'
import { DRAWBAR_RATIOS, ORGAN_MODELS, defaultOrganParams, type OrganEvent, type OrganLayerParams, type OrganParams } from '../src/dsp/organTypes'
import { faderToGain } from '../src/dsp/types'
import { midiHz } from '../src/dsp/util'

/**
 * Rendered-audio proofs for the organ engine (specs/nord-stage-4.organ.json acceptance): the very same OrganUnit the
 * AudioWorklet hosts is driven offline with timed note events and measured with tolerant spectral relationships.
 */
const SR = 22050
const B3 = 0
const VOX = 1
const FARF = 2
const PIPE1 = 3
const PIPE2 = 4
const B3_BASS = 5
const EIGHT_ONLY = [0, 0, 8, 0, 0, 0, 0, 0, 0]
const ALL_OUT = [8, 8, 8, 8, 8, 8, 8, 8, 8]

interface Overrides {
  on?: boolean
  A?: Partial<OrganLayerParams>
  B?: Partial<OrganLayerParams>
  vibratoMode?: number
  percussion?: Partial<OrganParams['percussion']>
  keyClick?: number
  pitchBend?: number
}

function params(o: Overrides = {}): OrganParams {
  const base = defaultOrganParams()
  return {
    ...base,
    on: o.on ?? true,
    layers: {
      A: { ...base.layers.A, on: true, level: 100, drawbars: [...EIGHT_ONLY], ...o.A },
      B: { ...base.layers.B, on: false, level: 100, drawbars: [...EIGHT_ONLY], ...o.B },
    },
    vibratoMode: o.vibratoMode ?? base.vibratoMode,
    percussion: { ...base.percussion, on: false, ...o.percussion },
    keyClick: o.keyClick ?? 0,
    pitchBend: o.pitchBend ?? 0,
  }
}

const on = (midi: number, at = 0, gain = 1, layer: 'A' | 'B' = 'A'): TimedEvent<OrganEvent> => ({ at, event: { type: 'on', layer, midi, velocity: 100, gain } })
const off = (midi: number, at: number, layer: 'A' | 'B' = 'A'): TimedEvent<OrganEvent> => ({ at, event: { type: 'off', layer, midi } })
const sustain = (state: boolean, at: number): TimedEvent<OrganEvent> => ({ at, event: { type: 'sustain', on: state } })
const allOff = (at: number): TimedEvent<OrganEvent> => ({ at, event: { type: 'allOff' } })

function render(p: OrganParams, events: TimedEvent<OrganEvent>[], seconds = 0.8, blockSize = 128): { x: Float32Array; unit: OrganUnit } {
  const unit = new OrganUnit(SR)
  unit.setParams(p)
  const out = renderEvents(unit, events, seconds, SR, blockSize)
  return { x: out.l, unit }
}

const seg = (x: Float32Array, t0: number, t1: number) => x.subarray(Math.round(t0 * SR), Math.round(t1 * SR))
/** Steady-state part of a held note (after the attack). */
const steady = (x: Float32Array, end = 0.78) => seg(x, 0.08, Math.min(end, x.length / SR))
const partial = (x: ArrayLike<number>, hz: number, spectrum?: Spectrum) => bandEnergy(x, SR, hz * 0.97, hz * 1.03, spectrum)
const BANDS = [60, 120, 240, 480, 960, 1920, 3840, 7680]
function bandVector(x: Float32Array): number[] {
  const s = magnitudeSpectrum(x, SR)
  const total = bandEnergy(x, SR, 20, SR / 2, s) || 1
  const out: number[] = []
  for (let i = 0; i < BANDS.length - 1; i++) out.push(bandEnergy(x, SR, BANDS[i], BANDS[i + 1], s) / total)
  return out
}
const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
const finite = (x: Float32Array) => x.every((v) => Number.isFinite(v))

describe('organ.models-drawbars — B3 / Vox / Farf / Pipe engines, drawbars, percussion, key click, vibrato/chorus (rendered audio)', () => {
  it('sounds while a key is held and returns to silence after release; the voice is freed', () => {
    const { x, unit } = render(params(), [on(60, 0), off(60, 0.5)], 1.0)
    expect(finite(x)).toBe(true)
    expect(rms(seg(x, 0.1, 0.4))).toBeGreaterThan(0.05)
    expect(rms(seg(x, 0.7, 1.0))).toBeLessThan(1e-4)
    expect(unit.voiceCount).toBe(0)
    expect(unit.heldNotes('A')).toEqual([])
  })

  it('B3, Vox, Farf and Pipe 1 have pairwise distinct spectra — not one renamed oscillator', () => {
    const registrations: Record<number, number[]> = { [B3]: ALL_OUT, [VOX]: [8, 8, 8, 8, 8, 8, 8, 0, 4], [FARF]: ALL_OUT, [PIPE1]: ALL_OUT }
    const rendered = [B3, VOX, FARF, PIPE1].map((model) => ({ model, x: steady(render(params({ A: { model, drawbars: registrations[model] } }), [on(48, 0)]).x) }))
    for (const r of rendered) expect(rms(r.x), ORGAN_MODELS[r.model]).toBeGreaterThan(0.02)
    const vectors = rendered.map((r) => bandVector(r.x))
    const centroids = rendered.map((r) => spectralCentroid(r.x, SR))
    for (let i = 0; i < rendered.length; i++) {
      for (let j = i + 1; j < rendered.length; j++) {
        const label = `${ORGAN_MODELS[rendered[i].model]} vs ${ORGAN_MODELS[rendered[j].model]}`
        expect(normalizedDifference(rendered[i].x, rendered[j].x), label).toBeGreaterThan(0.2)
        const bandsDiffer = maxDiff(vectors[i], vectors[j]) > 0.06
        const centroidsDiffer = Math.abs(centroids[i] - centroids[j]) / Math.max(centroids[i], centroids[j]) > 0.1
        expect(bandsDiffer || centroidsDiffer, `${label}: bands ${vectors[i].map((v) => v.toFixed(2))} / ${vectors[j].map((v) => v.toFixed(2))}, centroids ${centroids[i].toFixed(0)} / ${centroids[j].toFixed(0)}`).toBe(true)
      }
    }
  })

  it.each([
    ['B3', B3],
    ['Pipe 1', PIPE1],
  ])('%s: every one of the nine drawbars raises the energy at its partial as it is pulled 0 → 4 → 8', (_name, model) => {
    const f0 = midiHz(48)
    for (let r = 0; r < 9; r++) {
      const hz = f0 * DRAWBAR_RATIOS[r]
      const energy = (position: number) => {
        const drawbars = Array.from({ length: 9 }, () => 0)
        drawbars[r] = position
        return partial(steady(render(params({ A: { model, drawbars } }), [on(48, 0)]).x), hz)
      }
      const e0 = energy(0)
      const e4 = energy(4)
      const e8 = energy(8)
      expect(e4, `drawbar ${r} at 4`).toBeGreaterThan(1e-4)
      expect(e0, `drawbar ${r} at 0`).toBeLessThan(e4 * 0.01)
      expect(e8, `drawbar ${r} at 8 (3 dB per step)`).toBeGreaterThan(e4 * 6)
    }
  })

  it('Vox: the seven partial drawbars and the mix drawbar change the signal; drawbar 8 is unused', () => {
    const level = (drawbars: number[]) => rms(steady(render(params({ A: { model: VOX, drawbars } }), [on(48, 0)]).x))
    for (let r = 0; r < 7; r++) {
      const pulled = Array.from({ length: 9 }, () => 0)
      pulled[r] = 8
      expect(level(Array.from({ length: 9 }, () => 0)), 'all drawbars in').toBeLessThan(1e-6)
      expect(level(pulled), `Vox drawbar ${r}`).toBeGreaterThan(0.02)
    }
    const unused = Array.from({ length: 9 }, () => 0)
    unused[7] = 8
    expect(level(unused)).toBeLessThan(1e-6)
    const flute = steady(render(params({ A: { model: VOX, drawbars: [0, 8, 0, 0, 0, 0, 0, 0, 0] } }), [on(48, 0)]).x)
    const reed = steady(render(params({ A: { model: VOX, drawbars: [0, 8, 0, 0, 0, 0, 0, 0, 8] } }), [on(48, 0)]).x)
    expect(spectralCentroid(reed, SR)).toBeGreaterThan(spectralCentroid(flute, SR) * 1.3)
    expect(normalizedDifference(flute, reed)).toBeGreaterThan(0.2)
  })

  it('Farf: each register switches on when pulled past half (4 = off, 5 = on) and the registers have their own colour', () => {
    const tone = (drawbars: number[]) => steady(render(params({ A: { model: FARF, drawbars } }), [on(48, 0)]).x)
    const centroids: number[] = []
    for (let r = 0; r < 9; r++) {
      const at = (v: number) => {
        const d = Array.from({ length: 9 }, () => 0)
        d[r] = v
        return tone(d)
      }
      expect(rms(at(4)), `register ${r} at 4`).toBeLessThan(1e-6)
      const five = at(5)
      const eight = at(8)
      expect(rms(five), `register ${r} at 5`).toBeGreaterThan(0.01)
      expect(Math.abs(rms(eight) - rms(five)) / rms(five), `register ${r} is a switch, not a level`).toBeLessThan(0.02)
      centroids.push(spectralCentroid(eight, SR))
    }
    // Flute 8, Oboe 8, Trumpet 8 and Strings 8 share the 8′ pitch but differ in tone (manual p. 21).
    const eightFoot = [2, 3, 4, 5]
    for (let i = 0; i < eightFoot.length; i++) {
      for (let j = i + 1; j < eightFoot.length; j++) {
        const a = centroids[eightFoot[i]]
        const b = centroids[eightFoot[j]]
        expect(Math.abs(a - b) / Math.max(a, b), `registers ${eightFoot[i]} vs ${eightFoot[j]}`).toBeGreaterThan(0.15)
      }
    }
    expect(Math.abs(centroids[0] - centroids[1]) / Math.max(centroids[0], centroids[1])).toBeGreaterThan(0.15)
  })

  it('B3 Bass reads only the 16′ and 8′ drawbars', () => {
    const level = (drawbars: number[]) => rms(steady(render(params({ A: { model: B3_BASS, drawbars } }), [on(48, 0)]).x))
    expect(level([0, 0, 0, 8, 8, 8, 8, 8, 8])).toBeLessThan(1e-6)
    expect(level([0, 8, 0, 0, 0, 0, 0, 0, 0])).toBeLessThan(1e-6)
    expect(level([8, 0, 0, 0, 0, 0, 0, 0, 0])).toBeGreaterThan(0.02)
    expect(level([0, 0, 8, 0, 0, 0, 0, 0, 0])).toBeGreaterThan(0.02)
  })

  it('Pipe 2 is a brighter principal registration than Pipe 1', () => {
    const drawbars = [0, 0, 8, 8, 0, 0, 0, 0, 0]
    const pipe1 = steady(render(params({ A: { model: PIPE1, drawbars } }), [on(60, 0)]).x)
    const pipe2 = steady(render(params({ A: { model: PIPE2, drawbars } }), [on(60, 0)]).x)
    expect(spectralCentroid(pipe2, SR)).toBeGreaterThan(spectralCentroid(pipe1, SR) * 1.15)
    expect(normalizedDifference(pipe1, pipe2)).toBeGreaterThan(0.1)
  })

  it('B3 percussion adds a decaying attack on the 2nd or 3rd harmonic, with Soft and Fast variants', () => {
    const f0 = midiHz(60)
    const early = (o: Overrides) => seg(render(params(o), [on(60, 0)]).x, 0, 0.12)
    const late = (o: Overrides) => seg(render(params(o), [on(60, 0)]).x, 0.25, 0.5)
    const percOff = early({})
    const second = early({ percussion: { on: true, third: false, soft: false, fast: false } })
    const third = early({ percussion: { on: true, third: true, soft: false, fast: false } })
    const soft = early({ percussion: { on: true, third: false, soft: true, fast: false } })
    expect(partial(second, 2 * f0)).toBeGreaterThan(partial(percOff, 2 * f0) * 20 + 1e-6)
    expect(partial(third, 3 * f0)).toBeGreaterThan(partial(percOff, 3 * f0) * 20 + 1e-6)
    expect(partial(third, 2 * f0)).toBeLessThan(partial(second, 2 * f0) * 0.2)
    expect(partial(soft, 2 * f0)).toBeLessThan(partial(second, 2 * f0) * 0.5)
    expect(partial(soft, 2 * f0)).toBeGreaterThan(partial(percOff, 2 * f0) * 5 + 1e-6)
    const fast = late({ percussion: { on: true, third: false, soft: false, fast: true } })
    const slow = late({ percussion: { on: true, third: false, soft: false, fast: false } })
    expect(partial(fast, 2 * f0)).toBeLessThan(partial(slow, 2 * f0) * 0.2)
    // Percussion is only available for the B3 model (manual p. 20).
    const voxPerc = early({ A: { model: VOX, drawbars: [0, 8, 0, 0, 0, 0, 0, 0, 0] }, percussion: { on: true } })
    const voxDry = early({ A: { model: VOX, drawbars: [0, 8, 0, 0, 0, 0, 0, 0, 0] } })
    expect(maxAbsDifference(voxPerc, voxDry)).toBeLessThan(1e-6)
  })

  it('percussion is single-triggered (no percussion on a key added while others are held) unless POLY', () => {
    const events = [on(60, 0), on(64, 0.25), off(60, 0.5), off(64, 0.5), on(64, 0.6)]
    const f64 = midiHz(64)
    const single = render(params({ percussion: { on: true, third: false, fast: false } }), events, 0.8).x
    const poly = render(params({ percussion: { on: true, third: false, fast: false, poly: true } }), events, 0.8).x
    const added = (x: Float32Array) => partial(seg(x, 0.25, 0.35), 2 * f64)
    const fresh = (x: Float32Array) => partial(seg(x, 0.6, 0.7), 2 * f64)
    expect(added(poly)).toBeGreaterThan(1e-5)
    expect(added(single)).toBeLessThan(added(poly) * 0.1)
    expect(fresh(single)).toBeGreaterThan(fresh(poly) * 0.5)
    expect(fresh(single)).toBeGreaterThan(added(single) * 10)
  })

  it('B3 key click adds a broadband contact transient at note on', () => {
    const attack = (keyClick: number) => seg(render(params({ keyClick }), [on(60, 0)]).x, 0, 0.01)
    const withClick = attack(1)
    const without = attack(0)
    const high = (x: Float32Array) => bandEnergy(x, SR, 2500, 10000)
    expect(high(withClick)).toBeGreaterThan(high(without) * 5 + 1e-8)
    // the click is a transient: the steady state is unchanged
    expect(normalizedDifference(steady(render(params({ keyClick: 1 }), [on(60, 0)]).x), steady(render(params(), [on(60, 0)]).x))).toBeLessThan(0.02)
  })

  it('vibrato V1 and chorus C1 are distinct effects and depth grows V1 < V2 < V3 and C1 < C2 < C3', () => {
    const f0 = midiHz(60)
    const tone = (mode: number | null, extra: Overrides = {}) => steady(render(params({ ...extra, A: { vibrato: mode !== null, ...extra.A }, vibratoMode: mode ?? 0 }), [on(60, 0)], 1.0).x, 0.98)
    const dry = tone(null)
    // Energy of the vibrato sidebands (2.4 % .. 10 % away from the fundamental, clear of the window's main lobe)
    // relative to the whole ±15 % region around it.
    const sideband = (x: Float32Array) => {
      const s = magnitudeSpectrum(x, SR)
      const wide = bandEnergy(x, SR, f0 * 0.85, f0 * 1.15, s)
      const side = bandEnergy(x, SR, f0 * 1.024, f0 * 1.1, s) + bandEnergy(x, SR, f0 * 0.9, f0 * 0.976, s)
      return side / (wide || 1)
    }
    const v = [tone(0), tone(2), tone(4)]
    const c = [tone(1), tone(3), tone(5)]
    expect(normalizedDifference(dry, v[0])).toBeGreaterThan(0.05)
    expect(normalizedDifference(dry, c[0])).toBeGreaterThan(0.05)
    expect(normalizedDifference(v[0], c[0])).toBeGreaterThan(0.05)
    expect(sideband(v[0])).toBeGreaterThan(sideband(dry) * 3 + 1e-6)
    expect(sideband(v[1])).toBeGreaterThan(sideband(v[0]) * 1.2)
    expect(sideband(v[2])).toBeGreaterThan(sideband(v[1]) * 1.2)
    expect(sideband(c[1])).toBeGreaterThan(sideband(c[0]) * 1.2)
    expect(sideband(c[2])).toBeGreaterThan(sideband(c[1]) * 1.2)
    // Vox / Farf (pitch vibrato vs chorus) and Pipe (tremulant vs detune) also make V1 and C1 distinct.
    for (const [model, drawbars] of [
      [VOX, [0, 8, 0, 0, 0, 0, 0, 0, 4]],
      [FARF, [0, 0, 8, 0, 0, 0, 0, 0, 0]],
      [PIPE1, [0, 0, 8, 8, 0, 0, 0, 0, 0]],
    ] as [number, number[]][]) {
      const d = tone(null, { A: { model, drawbars } })
      const v1 = tone(0, { A: { model, drawbars } })
      const c1 = tone(1, { A: { model, drawbars } })
      expect(normalizedDifference(d, v1), `${ORGAN_MODELS[model]} V1 vs dry`).toBeGreaterThan(0.02)
      expect(normalizedDifference(d, c1), `${ORGAN_MODELS[model]} C1 vs dry`).toBeGreaterThan(0.02)
      expect(normalizedDifference(v1, c1), `${ORGAN_MODELS[model]} V1 vs C1`).toBeGreaterThan(0.02)
    }
  })

  it('layer level, octave shift, layer / section on-off and the note gain scale the rendered signal', () => {
    const f0 = midiHz(60)
    const full = steady(render(params(), [on(60, 0)]).x)
    const half = steady(render(params({ A: { level: 50 } }), [on(60, 0)]).x)
    expect(rms(half) / rms(full)).toBeCloseTo(faderToGain(50), 2)
    const up = steady(render(params({ A: { octave: 1 } }), [on(60, 0)]).x)
    expect(partial(up, 2 * f0)).toBeGreaterThan(partial(up, f0) * 20)
    expect(partial(full, f0)).toBeGreaterThan(partial(full, 2 * f0) * 20)
    expect(rms(render(params({ A: { on: false } }), [on(60, 0)]).x)).toBeLessThan(1e-6)
    expect(rms(render(params({ on: false }), [on(60, 0)]).x)).toBeLessThan(1e-6)
    const faded = steady(render(params(), [on(60, 0, 0.5)]).x)
    expect(rms(faded) / rms(full)).toBeCloseTo(0.5, 2)
  })

  it('sustain holds released keys only for layers with SUSTPED; pedal up and All Notes Off release them', () => {
    const held = render(params({ A: { sustped: true } }), [on(60, 0), sustain(true, 0.1), off(60, 0.3)], 1.0).x
    expect(rms(seg(held, 0.5, 0.9))).toBeGreaterThan(0.02)
    const ignored = render(params({ A: { sustped: false } }), [on(60, 0), sustain(true, 0.1), off(60, 0.3)], 1.0).x
    expect(rms(seg(ignored, 0.5, 0.9))).toBeLessThan(1e-4)
    const released = render(params({ A: { sustped: true } }), [on(60, 0), sustain(true, 0.1), off(60, 0.3), sustain(false, 0.6)], 1.0).x
    expect(rms(seg(released, 0.4, 0.55))).toBeGreaterThan(0.02)
    expect(rms(seg(released, 0.8, 1.0))).toBeLessThan(1e-4)
    const { x: panic, unit } = render(params(), [on(60, 0), on(64, 0), allOff(0.3)], 0.6)
    expect(rms(seg(panic, 0.1, 0.25))).toBeGreaterThan(0.05)
    expect(rms(seg(panic, 0.35, 0.6))).toBeLessThan(1e-4)
    expect(unit.heldNotes('A')).toEqual([])
    expect(unit.voiceCount).toBe(0)
  })

  it('turning a layer off mid-note releases its notes click-free', () => {
    const unit = new OrganUnit(SR)
    unit.setParams(params())
    unit.handle({ type: 'on', layer: 'A', midi: 60, velocity: 100, gain: 1 })
    const run = (seconds: number) => {
      const out = new Float32Array(Math.round(seconds * SR))
      const r = new Float32Array(out.length)
      for (let pos = 0; pos < out.length; pos += 128) {
        const n = Math.min(128, out.length - pos)
        unit.process(out.subarray(pos, pos + n), r.subarray(pos, pos + n), n)
      }
      return out
    }
    run(0.2)
    unit.setParams(params({ A: { on: false } }))
    const tail = run(0.2)
    expect(rms(tail.subarray(Math.round(0.1 * SR)))).toBeLessThan(1e-4)
    let maxStep = 0
    for (let i = 1; i < tail.length; i++) maxStep = Math.max(maxStep, Math.abs(tail[i] - tail[i - 1]))
    expect(maxStep).toBeLessThan(0.05)
    expect(unit.voiceCount).toBe(0)
  })

  it('two layers with different models sum into one output and voiceCount / heldNotes follow the notes', () => {
    const both = params({ A: { model: B3 }, B: { on: true, model: VOX, drawbars: [8, 8, 0, 0, 0, 0, 0, 0, 4] } })
    const events = [on(60, 0, 1, 'A'), on(64, 0, 1, 'B'), off(60, 0.4, 'A'), off(64, 0.4, 'B')]
    const { x: mixed, unit } = render(both, events, 0.7)
    const onlyA = render({ ...both, layers: { ...both.layers, B: { ...both.layers.B, on: false } } }, events, 0.7).x
    const onlyB = render({ ...both, layers: { ...both.layers, A: { ...both.layers.A, on: false } } }, events, 0.7).x
    const sum = onlyA.map((v, i) => v + onlyB[i])
    expect(rms(onlyA)).toBeGreaterThan(0.01)
    expect(rms(onlyB)).toBeGreaterThan(0.01)
    expect(maxAbsDifference(mixed, sum)).toBeLessThan(1e-6)
    expect(unit.voiceCount).toBe(0)
    const live = new OrganUnit(SR)
    live.setParams(both)
    live.handle({ type: 'on', layer: 'A', midi: 60, velocity: 100, gain: 1 })
    live.handle({ type: 'on', layer: 'B', midi: 64, velocity: 100, gain: 1 })
    const l = new Float32Array(256)
    live.process(l, new Float32Array(256), 256)
    expect(live.voiceCount).toBe(2)
    expect(live.heldNotes('A')).toEqual([60])
    expect(live.heldNotes('B')).toEqual([64])
  })

  it('is deterministic and block-size independent, and reset() silences everything', () => {
    const p = params({ A: { drawbars: [8, 6, 8, 4, 2, 0, 0, 0, 3], vibrato: true }, vibratoMode: 2, percussion: { on: true }, keyClick: 0.7 })
    const events = [on(48, 0), on(55, 0), on(60, 0)]
    const a = render(p, events, 0.5).x
    const b = render(p, events, 0.5).x
    expect(maxAbsDifference(a, b)).toBe(0)
    const c = render(p, events, 0.5, 64).x
    expect(maxAbsDifference(a, c)).toBeLessThan(1e-6)
    expect(finite(a)).toBe(true)
    const unit = new OrganUnit(SR)
    unit.setParams(p)
    for (const e of events) unit.handle(e.event)
    const l = new Float32Array(512)
    unit.process(l, new Float32Array(512), 512)
    expect(unit.voiceCount).toBe(3)
    unit.reset()
    expect(unit.voiceCount).toBe(0)
    const after = new Float32Array(512)
    unit.process(after, new Float32Array(512), 512)
    expect(peak(after)).toBe(0)
  })

  it('the pitch stick bends only layers with PSTICK (±2 semitones)', () => {
    const f0 = midiHz(60)
    const bent = f0 * Math.pow(2, 2 / 12)
    const withStick = steady(render(params({ A: { pstick: true }, pitchBend: 1 }), [on(60, 0)]).x)
    const without = steady(render(params({ A: { pstick: false }, pitchBend: 1 }), [on(60, 0)]).x)
    expect(partial(withStick, bent)).toBeGreaterThan(partial(withStick, f0) * 20)
    expect(partial(without, f0)).toBeGreaterThan(partial(without, bent) * 20)
  })

  it('keeps at most 16 voices per layer, stealing the oldest, and never produces NaN', () => {
    const unit = new OrganUnit(SR)
    unit.setParams(params({ A: { drawbars: ALL_OUT } }))
    for (let midi = 40; midi < 57; midi++) unit.handle({ type: 'on', layer: 'A', midi, velocity: 100, gain: 1 })
    const l = new Float32Array(2048)
    unit.process(l, new Float32Array(2048), 2048)
    expect(unit.voiceCount).toBe(16)
    expect(unit.heldNotes('A')).toHaveLength(16)
    expect(unit.heldNotes('A')).not.toContain(40)
    expect(finite(l)).toBe(true)
  })
})

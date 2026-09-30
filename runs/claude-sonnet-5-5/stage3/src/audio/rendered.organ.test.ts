// @vitest-environment node
import { OfflineAudioContext } from 'node-web-audio-api'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DRAWBARS, ORGAN_MODELS, drawbarGain, drawbarGraph, type OrganModel } from '../engine/organ'
import { setDrawbar, setOrganModel, setPercussion, setVibOn } from '../engine/edits'
import { defaultState, type EngineState } from '../engine/state'
import { bandEnergy, difference, rms, spectralCentroid } from '../test-utils/analysis'
import { FakeAudioContext, FakeScheduler } from '../test-utils/fakes'
import { SR, at, chain, disposeRigs, noPiano, organLayer, play, type Edit } from '../test-utils/scenario'
import type { AudioContextLike, AudioNodeLike } from './types'
import { OrganEngine } from './organ/engine'
import { organSpectrum, voxMix } from './organ/spectra'

afterEach(disposeRigs)

const organ = (model: OrganModel, drawbars?: number[], id: 'A' | 'B' = 'A'): Edit =>
  chain(noPiano, organLayer(id, { model, ...(drawbars ? { drawbars } : {}) }), (s) => ({ ...s, organFocus: id }))
const F0 = 261.6255653 // middle C: the 8-foot partial is the key's own pitch

/** energy of each harmonic of the 16-foot fundamental (note/2), 1..16 */
const harmonics = (x: Float32Array, from = at(0.3)) => Array.from({ length: 16 }, (_, i) => bandEnergy(x, SR, (F0 / 2) * (i + 1) * 0.985, (F0 / 2) * (i + 1) * 1.015, from, 16384))
const normalize = (v: number[]) => {
  const sum = Math.sqrt(v.reduce((a, b) => a + b, 0)) || 1
  return v.map((x) => Math.sqrt(x) / sum)
}
const cosine = (a: number[], b: number[]) => a.reduce((acc, x, i) => acc + x * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b) || 1)
const high = (x: Float32Array) => bandEnergy(x, SR, 1500, 7000, at(0.3), 16384) / (bandEnergy(x, SR, 100, 700, at(0.3), 16384) + 1e-12)

describe('organ.models-drawbars — the four engines (and the two that may reuse them) are audibly different sounds', () => {
  it('B3, Vox, Farf and Pipe 1 render distinct harmonic spectra at the same key', async () => {
    const shapes = new Map<OrganModel, number[]>()
    const ratios = new Map<OrganModel, number>()
    for (const model of ORGAN_MODELS) {
      const r = await play(1.2, [{ note: 60 }], organ(model))
      expect(rms(r.mono, at(0.3)), model).toBeGreaterThan(0.01)
      shapes.set(model, normalize(harmonics(r.mono)))
      ratios.set(model, high(r.mono))
    }
    // pairwise distinct: no two models are the same oscillator renamed
    for (let i = 0; i < ORGAN_MODELS.length; i++) {
      for (let j = i + 1; j < ORGAN_MODELS.length; j++) {
        const c = cosine(shapes.get(ORGAN_MODELS[i])!, shapes.get(ORGAN_MODELS[j])!)
        expect(c, `${ORGAN_MODELS[i]} vs ${ORGAN_MODELS[j]}`).toBeLessThan(0.985)
      }
    }
    // tonewheels are (nearly) pure sines: no high-frequency content; the transistor and pipe models are rich
    expect(ratios.get('B3')!).toBeLessThan(0.02)
    expect(ratios.get('Vox')!).toBeGreaterThan(ratios.get('B3')! * 10)
    expect(ratios.get('Farf')!).toBeGreaterThan(ratios.get('B3')! * 10)
    expect(ratios.get('Pipe 1')!).toBeGreaterThan(ratios.get('B3')! * 5)
    // Pipe 2 has the brighter principal registration
    expect(ratios.get('Pipe 2')!).toBeGreaterThan(ratios.get('Pipe 1')!)
  })

  it('Vox is built from odd harmonics (hollow square-ish), B3 from sines, Pipe rolls off smoothly', () => {
    const base = 130.8
    const vox = organSpectrum('Vox', [0, 8, 0, 0, 0, 0, 0, 0, 0], base) // the 8-foot register alone
    const b3 = organSpectrum('B3', [0, 0, 8, 0, 0, 0, 0, 0, 0], base)
    const pipe = organSpectrum('Pipe 1', [0, 8, 0, 0, 0, 0, 0, 0, 0], base)
    // 8' = partial 2 of the 16' fundamental: a Vox 8' register carries partials 2, 6, 10, 14 (odd multiples), never 4 or 8
    expect(vox[2]).toBeGreaterThan(0)
    expect(vox[6]).toBeGreaterThan(0)
    expect(vox[4]).toBe(0)
    expect(vox[8]).toBe(0)
    expect(b3[2]).toBeGreaterThan(0)
    expect(b3.reduce((a, x, i) => a + (i === 2 ? 0 : x), 0)).toBe(0)
    expect(pipe[2]).toBeGreaterThan(pipe[4])
    expect(pipe[4]).toBeGreaterThan(pipe[6])
    expect(pipe[6]).toBeGreaterThan(0)
  })

  it('B3 drawbars: each of the nine adds exactly its own partial to the rendered spectrum', async () => {
    const partials = [1, 3, 2, 4, 6, 8, 10, 12, 16] // 16' 5⅓' 8' 4' 2⅔' 2' 1⅗' 1⅓' 1'
    for (let i = 0; i < 9; i++) {
      // the 8-foot drawbar is always in, so a moved drawbar is compared against a real, sounding registration
      const base = [0, 0, 6, 0, 0, 0, 0, 0, 0]
      const pulled = [...base]
      pulled[i] = 8
      const a = await play(0.9, [{ note: 60 }], organ('B3', base))
      const b = await play(0.9, [{ note: 60 }], organ('B3', pulled))
      const hz = (F0 / 2) * partials[i]
      const band = (r: Awaited<ReturnType<typeof play>>) => bandEnergy(r.mono, SR, hz * 0.98, hz * 1.02, at(0.3), 16384)
      if (i === 2) continue // the 8' drawbar is the base itself: covered by the level test below
      expect(band(b), `drawbar ${i + 1} (${partials[i]}x)`).toBeGreaterThan(band(a) * 25)
    }
  })

  it('a drawbar position sets a level of about 3 dB per step, and position 0 is silent', async () => {
    expect(drawbarGain(8)).toBe(1)
    expect(20 * Math.log10(drawbarGain(6) / drawbarGain(7))).toBeCloseTo(-3, 0)
    expect(drawbarGain(0)).toBe(0)
    const levels: number[] = []
    for (const position of [3, 5, 8]) {
      const r = await play(0.9, [{ note: 60 }], organ('B3', [0, 0, position, 0, 0, 0, 0, 0, 0]))
      levels.push(bandEnergy(r.mono, SR, F0 * 0.98, F0 * 1.02, at(0.3), 16384))
    }
    expect(levels[1]).toBeGreaterThan(levels[0] * 2)
    expect(levels[2]).toBeGreaterThan(levels[1] * 1.5)
  })

  it('Vox: the two mix drawbars blend the dark (low-passed) path with the bright one', async () => {
    const dark = await play(0.9, [{ note: 60 }], organ('Vox', [0, 8, 0, 0, 0, 0, 0, 8, 0]))
    const bright = await play(0.9, [{ note: 60 }], organ('Vox', [0, 8, 0, 0, 0, 0, 0, 0, 8]))
    expect(spectralCentroid(bright.mono, SR, at(0.3))).toBeGreaterThan(spectralCentroid(dark.mono, SR, at(0.3)) * 1.1)
    expect(high(bright.mono)).toBeGreaterThan(high(dark.mono) * 3)
    expect(voxMix([0, 0, 0, 0, 0, 0, 0, 8, 0])).toEqual({ filtered: 1, unfiltered: 0 })
  })

  it('Farf: drawbars are register switches, on when pulled past half', async () => {
    const off = await play(0.9, [{ note: 60 }], organ('Farf', [0, 8, 0, 0, 0, 0, 0, 0, 4]))
    const on = await play(0.9, [{ note: 60 }], organ('Farf', [0, 8, 0, 0, 0, 0, 0, 0, 5]))
    expect(rms(on.mono, at(0.3))).toBeGreaterThan(rms(off.mono, at(0.3)) * 1.15) // the 9th switch (bass) crossed the half-way point
    expect(drawbarGraph('Farf', 5)).toBe(8)
    expect(drawbarGraph('Farf', 4)).toBe(0)
    expect(drawbarGraph('B3', 5)).toBe(5)
    // the switch position does not matter beyond the threshold
    const full = await play(0.9, [{ note: 60 }], organ('Farf', [0, 8, 0, 0, 0, 0, 0, 0, 8]))
    expect(difference(full.mono, on.mono)).toBeLessThan(0.05)
  })

  it('Pipe: nine ranks; drawing the mixture rank adds a bright cluster of partials', async () => {
    const plain = await play(0.9, [{ note: 60 }], organ('Pipe 1', [0, 8, 0, 0, 0, 0, 0, 0, 0]))
    const mixture = await play(0.9, [{ note: 60 }], organ('Pipe 1', [0, 8, 0, 0, 0, 0, 0, 0, 8]))
    expect(high(mixture.mono)).toBeGreaterThan(high(plain.mono) * 3)
  })

  it('B3 Bass has only the 16-foot and 8-foot drawbars; the others are unused', async () => {
    const a = await play(0.9, [{ note: 60 }], organ('B3 Bass', [8, 0, 8, 0, 0, 0, 0, 0, 0]))
    const b = await play(0.9, [{ note: 60 }], organ('B3 Bass', [8, 8, 8, 8, 8, 8, 8, 8, 8]))
    expect(difference(a.mono, b.mono)).toBeLessThan(0.05)
  })

  it('layers A and B can use different models at the same time', async () => {
    const both = chain(organ('B3', undefined, 'A'), organ('Vox', undefined, 'B'), (s) => ({ ...s, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, level: 0.5 }, B: { ...s.organ.layers.B, level: 0.5 } } } }))
    const r = await play(1, [{ note: 60 }], both)
    const onlyA = await play(1, [{ note: 60 }], chain(organ('B3', undefined, 'A'), (s) => ({ ...s, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, level: 0.5 } } } })))
    expect(high(r.mono)).toBeGreaterThan(high(onlyA.mono) * 10) // the Vox layer adds its rich upper partials
    expect(bandEnergy(r.mono, SR, F0 * 0.98, F0 * 1.02, at(0.3), 16384)).toBeGreaterThan(0)
  })

  it('switching model loads that model’s registration, and the drawbars of the previous model are kept for when it returns', () => {
    let s = organ('B3')(defaultState())
    s = setDrawbar(s, 3, 5)
    const custom = s.organ.layers.A.drawbars
    s = setOrganModel(s, 'Vox')
    expect(s.organ.layers.A.drawbars).toEqual(DEFAULT_DRAWBARS.Vox)
    expect(custom[3]).toBe(5)
  })
})

describe('organ.models-drawbars — B3 percussion, key click, vibrato and chorus', () => {
  const b3 = organ('B3', [8, 8, 8, 0, 0, 0, 0, 0, 0])
  const perc = (p: Partial<EngineState['organ']['perc']>): Edit => (s) => setPercussion(s, { on: true, ...p })

  it('percussion adds a decaying partial at the second or third harmonic of the key', async () => {
    const off = await play(1.4, [{ note: 60 }], b3)
    const second = await play(1.4, [{ note: 60 }], chain(b3, perc({ third: false, fast: false })))
    const third = await play(1.4, [{ note: 60 }], chain(b3, perc({ third: true, fast: false })))
    const band = (r: Awaited<ReturnType<typeof play>>, hz: number, from: number, size = 4096) => bandEnergy(r.mono, SR, hz * 0.985, hz * 1.015, at(from), size)
    expect(band(second, F0 * 2, 0.01)).toBeGreaterThan(band(off, F0 * 2, 0.01) * 10)
    expect(band(second, F0 * 3, 0.01)).toBeLessThan(band(second, F0 * 2, 0.01))
    expect(band(third, F0 * 3, 0.01)).toBeGreaterThan(band(off, F0 * 3, 0.01) * 4)
    // it decays: much less of it after half a second
    expect(band(second, F0 * 2, 0.9)).toBeLessThan(band(second, F0 * 2, 0.01) * 0.2)
  })

  it('percussion volume (soft) and decay (fast) change the level and the length', async () => {
    const normal = await play(1.2, [{ note: 60 }], chain(b3, perc({ fast: false, soft: false })))
    const soft = await play(1.2, [{ note: 60 }], chain(b3, perc({ fast: false, soft: true })))
    const fast = await play(1.2, [{ note: 60 }], chain(b3, perc({ fast: true, soft: false })))
    const e = (r: Awaited<ReturnType<typeof play>>, from: number) => bandEnergy(r.mono, SR, F0 * 2 * 0.985, F0 * 2 * 1.015, at(from), 4096)
    expect(e(soft, 0.01)).toBeLessThan(e(normal, 0.01) * 0.6)
    expect(e(fast, 0.4)).toBeLessThan(e(normal, 0.4) * 0.35)
  })

  it('percussion is single-triggered: a second key played while the first is held gets none, unless poly mode is on', async () => {
    const notes = [{ note: 60 }, { note: 67, at: 0.6 }]
    const single = await play(1.4, notes, chain(b3, perc({ third: false, fast: true })))
    const poly = await play(1.4, notes, chain(b3, perc({ third: false, fast: true, poly: true })))
    const e = (r: Awaited<ReturnType<typeof play>>) => bandEnergy(r.mono, SR, 784 * 0.985, 784 * 1.015, at(0.6), 4096) // G4 (392 Hz): its second harmonic
    expect(e(poly)).toBeGreaterThan(e(single) * 5)
  })

  it('the key click is a short random transient on every B3 attack (a fixed-level noise burst)', async () => {
    const context = (keyClick: boolean) => {
      const ctx = new OfflineAudioContext(2, Math.ceil(0.6 * SR), SR)
      const acx = ctx as unknown as AudioContextLike
      const out = acx.createGain()
      out.connect(ctx.destination as unknown as AudioNodeLike)
      const state = organ('B3', [0, 0, 8, 0, 0, 0, 0, 0, 0])(defaultState())
      const engine = new OrganEngine({ ctx: acx, scheduler: new FakeScheduler(), outputs: { A: out, B: out }, state }, { keyClick })
      engine.noteOn('A', 72, 100, 1)
      return { ctx, engine }
    }
    const withClick = context(true)
    const without = context(false)
    const a = (await withClick.ctx.startRendering()).getChannelData(0)
    const b = (await without.ctx.startRendering()).getChannelData(0)
    const burst = (x: Float32Array) => bandEnergy(x, SR, 1500, 6000, 0, 1024)
    expect(burst(a)).toBeGreaterThan(burst(b) * 20)
    // the click is short: after 40 ms the two are the same tone
    expect(difference(a.slice(at(0.1), at(0.5)), b.slice(at(0.1), at(0.5)))).toBeLessThan(0.05)
    // and random: a second attack does not repeat the first one exactly
    const two = context(true)
    two.engine.noteOn('A', 72, 100, 1)
    withClick.engine.dispose()
    without.engine.dispose()
    two.engine.dispose()
  })

  it('vibrato modulates pitch (V1 < V2 < V3 in depth); chorus (C1) keeps the original and is a different effect from V1', async () => {
    const withMode = (mode: EngineState['organ']['vibMode'], on = true): Edit =>
      chain(b3, (s) => setVibOn(s, on), (s) => ({ ...s, organ: { ...s.organ, vibMode: mode } }))
    const sidebands = (r: Awaited<ReturnType<typeof play>>) => bandEnergy(r.mono, SR, 236, 256, at(0.3), 32768) + bandEnergy(r.mono, SR, 268, 288, at(0.3), 32768)
    const off = await play(1.5, [{ note: 60 }], withMode('V3', false))
    const v1 = await play(1.5, [{ note: 60 }], withMode('V1'))
    const v2 = await play(1.5, [{ note: 60 }], withMode('V2'))
    const v3 = await play(1.5, [{ note: 60 }], withMode('V3'))
    const c1 = await play(1.5, [{ note: 60 }], withMode('C1'))
    expect(sidebands(v1)).toBeGreaterThan(sidebands(off) * 3)
    expect(sidebands(v2)).toBeGreaterThan(sidebands(v1))
    expect(sidebands(v3)).toBeGreaterThan(sidebands(v2))
    expect(difference(v1.mono.slice(at(0.3)), c1.mono.slice(at(0.3)))).toBeGreaterThan(0.2)
    // chorus keeps the un-swept signal: more energy exactly at the key pitch than the pure vibrato
    const carrier = (r: Awaited<ReturnType<typeof play>>) => bandEnergy(r.mono, SR, F0 * 0.995, F0 * 1.005, at(0.3), 32768)
    expect(carrier(c1)).toBeGreaterThan(carrier(v1))
  })

  it('vibrato/chorus is per layer: switching it on for A leaves B untouched', async () => {
    const both = chain(organ('B3', [0, 0, 8, 0, 0, 0, 0, 0, 0], 'A'), organ('B3', [0, 0, 8, 0, 0, 0, 0, 0, 0], 'B'), (s) => ({ ...s, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, vibOn: false }, B: { ...s.organ.layers.B, vibOn: true } }, vibMode: 'V3' as const } }))
    // layer A holds the octave up so the two layers are separable in frequency
    const setup = chain(both, (s) => ({ ...s, organ: { ...s.organ, layers: { ...s.organ.layers, A: { ...s.organ.layers.A, octave: 1 as const } } } }))
    const r = await play(1.5, [{ note: 60 }], setup)
    const around = (hz: number) => bandEnergy(r.mono, SR, hz * 0.94, hz * 0.985, at(0.3), 32768) + bandEnergy(r.mono, SR, hz * 1.015, hz * 1.06, at(0.3), 32768)
    const core = (hz: number) => bandEnergy(r.mono, SR, hz * 0.995, hz * 1.005, at(0.3), 32768)
    expect(around(F0) / core(F0)).toBeGreaterThan((around(F0 * 2) / core(F0 * 2)) * 5) // B (key pitch) is swept, A (octave up) is clean
  })
})

describe('organ.engine — cleanup', () => {
  it('disposing the engine frees every node and timer it created', () => {
    const ctx = new FakeAudioContext()
    const scheduler = new FakeScheduler()
    const out = ctx.createGain()
    const state = chain(organ('B3'), (s) => setVibOn(s, true), (s) => setPercussion(s, { on: true }))(defaultState())
    const engine = new OrganEngine({ ctx, scheduler, outputs: { A: out, B: out }, state })
    engine.noteOn('A', 60, 100, 1)
    engine.noteOn('A', 64, 100, 1)
    engine.noteOff('A', 60)
    expect(engine.liveVoiceCount()).toBe(2)
    expect(engine.pendingTimerCount()).toBeGreaterThan(0)
    scheduler.advance(1000)
    expect(engine.liveVoiceCount()).toBe(1)
    engine.panic()
    scheduler.advance(1000)
    expect(engine.liveVoiceCount()).toBe(0)
    engine.dispose()
    expect(engine.pendingTimerCount()).toBe(0)
    const leftovers = ctx.liveNodes().filter((n) => n !== (out as unknown as (typeof ctx.nodes)[number]))
    expect(leftovers).toHaveLength(0)
  })
})

import { describe, expect, it } from 'vitest'
import { InstrumentDSP } from './dsp'
import { arpIndex, arpNotes, envelope, lfo, waveform } from './extra-dsp'
import { fullState, waves, type ExtraId } from './system-state'
import type { InstrumentState } from './phase2-state'
const sr = 12000
function render(edit: (s: InstrumentState) => void, id: ExtraId = 'Sa', notes = [60], duration = .35, off = false) {
  const state = fullState(); state.layers.A.enabled = false; state.system!.synth.Sa.enabled = true; state.system!.organ.Oa.enabled = true; edit(state)
  const dsp = new InstrumentDSP(sr); dsp.message({ kind: 'state', state }); for (const [i, midi] of notes.entries()) dsp.message({ kind: 'extraOn', id: i + 1, layer: id, midi, velocity: 100 })
  const left = new Float32Array(Math.round(sr * duration)), right = new Float32Array(left.length); dsp.render(left, right)
  if (off) { for (let i = 0; i < notes.length; i++) dsp.message({ kind: 'off', id: i + 1 }); dsp.render(left, right) }
  return { left, right, dsp }
}
const energy = (x: Float32Array) => x.reduce((sum, v) => sum + v * v, 0) / x.length
const diff = (a: Float32Array, b: Float32Array) => energy(a.map((v, i) => v - b[i]))
describe('Rendered Organ engine and common graph', () => {
  it('renders distinct B3, Vox, Farf and Pipe harmonic spectra and both organ layers into their shared chain', () => {
    const results = [0, 2, 3, 4].map(model => render(s => { s.system!.organ.Oa.model = model }, 'Oa').left)
    for (const a of results) expect(energy(a)).toBeGreaterThan(1e-5)
    for (let i = 0; i < results.length; i++) for (let j = i + 1; j < results.length; j++) expect(diff(results[i], results[j])).toBeGreaterThan(1e-5)
    const b = render(s => { s.system!.organ.Ob.enabled = true; s.system!.organEffects.mod1 = { ...s.system!.organEffects.mod1, on: true, type: 2, amount: 1 } }, 'Ob'); expect(energy(b.left)).toBeGreaterThan(0); expect(b.dsp.extraChains.Organ).toBeDefined()
  })
  it('every drawbar, key click, percussion soft/fast/third, vibrato/chorus changes rendered audio', () => {
    const plain = render(() => {}, 'Oa').left
    for (let i = 0; i < 9; i++) expect(diff(plain, render(s => { s.system!.organ.Oa.drawbars[i] = 4 }, 'Oa').left)).toBeGreaterThan(1e-7)
    for (const patch of [{ click: false }, { percussion: true }, { percussion: true, soft: true }, { percussion: true, fast: true }, { percussion: true, third: true }, { vibrato: true, chorus: 0 }, { vibrato: true, chorus: 3 }]) expect(diff(plain, render(s => Object.assign(s.system!.organ.Oa, patch), 'Oa').left)).toBeGreaterThan(1e-8)
    const c = render(s => { s.system!.organ.Oa.vibrato = true }, 'Oa').left, v = render(s => { s.system!.organ.Oa.vibrato = true; s.system!.organ.Oa.chorus = 3 }, 'Oa').left; expect(diff(c, v)).toBeGreaterThan(1e-5)
  })
  it('Farf drawbars behave as register switches and percussion triggers only after all held notes release', () => {
    const a = render(s => { s.system!.organ.Oa.model = 3; s.system!.organ.Oa.drawbars[0] = 1 }, 'Oa').left
    const b = render(s => { s.system!.organ.Oa.model = 3; s.system!.organ.Oa.drawbars[0] = 4 }, 'Oa').left
    expect(diff(a, b)).toBe(0)
    const { dsp } = render(s => { s.system!.organ.Oa.percussion = true }, 'Oa', [60, 64]); expect([...dsp.extra.voices.values()].map(v => v.percussion)).toEqual([true, false])
  })
  it('rotary routes, accelerates through slow/fast/stop, drives and morphs in the inherited master path', () => {
    const dry = render(() => {}, 'Oa').left
    const rotary = render(s => { s.rotary.on = true; s.system!.organRotary = true; s.system!.rotarySpeed = 1; s.rotary.drive = .8 }, 'Oa')
    expect(diff(dry, rotary.left)).toBeGreaterThan(1e-5); expect(rotary.dsp.rotary.speed).toBeGreaterThan(.7); expect(rotary.dsp.rotary.speed).toBeLessThan(6.5)
    rotary.dsp.state.system!.rotaryStop = true; const before = rotary.dsp.rotary.speed; rotary.dsp.render(new Float32Array(sr), new Float32Array(sr)); expect(rotary.dsp.rotary.speed).toBeLessThan(before)
    expect(energy(render(s => { s.master = 0 }, 'Oa', [60], 1).left.slice(sr / 2))).toBeLessThan(1e-12)
  })
})
describe('Rendered Synth sources, filters, envelopes and modulation', () => {
  it('all fourteen required sources render distinct signals with category-correct Osc Ctrl', () => {
    const results = waves.map((_, wave) => render(s => { s.system!.synth.Sa.wave = wave }).left)
    for (const a of results) expect(energy(a)).toBeGreaterThan(1e-6)
    for (let i = 0; i < results.length; i++) for (let j = i + 1; j < results.length; j++) expect(diff(results[i], results[j])).toBeGreaterThan(1e-7)
    for (let wave = 0; wave < waves.length; wave++) { const a = Array.from({ length: 1000 }, (_, n) => waveform(wave, n * .2, .1, 440, sr, n)); const b = a.map((_, n) => waveform(wave, n * .2, .8, 440, sr, n)); expect(a.some((v, i) => v !== b[i])).toBe(wave >= 7) }
  })
  it('filter types, cutoff, resonance, tracking, drive, coarse and fine alter rendered audio', () => {
    const plain = render(() => {}).left
    for (const patch of [{ filter: 1 }, { filter: 2 }, { filter: 3 }, { cutoff: .2 }, { resonance: .8 }, { tracking: 3 }, { drive: 3 }, { coarse: 12 }, { fine: 40 }]) expect(diff(plain, render(s => Object.assign(s.system!.synth.Sa, patch), 'Sa', [72]).left)).toBeGreaterThan(1e-7)
    const different = [0, 1, 2, 3].map(filter => render(s => { s.system!.synth.Sa.filter = filter; s.system!.synth.Sa.cutoff = .4 }).left); for (let i = 1; i < 4; i++) expect(diff(different[0], different[i])).toBeGreaterThan(1e-6)
  })
  it('all three envelopes have audible attacks/decays/releases/velocity and oscillator pitch retarget', () => {
    for (const key of ['oscEnv', 'filterEnv', 'ampEnv'] as const) {
      const base = (s: InstrumentState) => { const p = s.system!.synth.Sa; p.wave = 13; p.cutoff = .3; p[key].amount = .8 }
      const plain = render(base).left
      for (const prop of ['attack', 'decay', 'velocity'] as const) { const changed = render(s => { base(s); s.system!.synth.Sa[key][prop] = prop === 'velocity' ? 1 : .6 }).left; expect(diff(plain, changed)).toBeGreaterThan(1e-8) }
      const short = render(s => { base(s); s.system!.synth.Sa[key].release = .05 }, 'Sa', [60], .2, true).left, long = render(s => { base(s); s.system!.synth.Sa[key].release = 1 }, 'Sa', [60], .2, true).left
      expect(diff(short, long)).toBeGreaterThan(1e-8)
    }
    const plain = render(() => {}).left; expect(diff(plain, render(s => { s.system!.synth.Sa.oscEnv.amount = .6; s.system!.synth.Sa.oscEnv.pitch = true }).left)).toBeGreaterThan(1e-5)
    expect(envelope({ attack: .1, decay: 4, release: .2, velocity: 0, amount: 1, pitch: false }, 10, -1, 1)).toBe(1)
  })
  it('LFO five waveforms and three destinations plus sync, unison and vibrato alter sound', () => {
    expect(new Set([0, 1, 2, 3, 4].map(w => JSON.stringify(Array.from({ length: 50 }, (_, i) => lfo(w, i / 13))))).size).toBe(5)
    const base = render(s => { s.system!.synth.Sa.wave = 13; s.system!.synth.Sa.cutoff = .4 }).left
    for (const dest of [0, 1, 2]) expect(diff(base, render(s => { const p = s.system!.synth.Sa; p.wave = 13; p.cutoff = .4; p.lfoDest = dest; p.lfoAmount = .8 }).left)).toBeGreaterThan(1e-6)
    for (const patch of [{ unison: 3 }, { vibrato: 1 }, { vibrato: 2 }]) expect(diff(base, render(s => { Object.assign(s.system!.synth.Sa, patch); s.system!.wheel = 1 }).left)).toBeGreaterThan(1e-6)
    const a = render(s => { s.system!.synth.Sa.lfoSync = true; s.system!.synth.Sa.lfoDest = 0; s.system!.synth.Sa.lfoAmount = 1; s.bpm = 60 }).left, b = render(s => { s.system!.synth.Sa.lfoSync = true; s.system!.synth.Sa.lfoDest = 0; s.system!.synth.Sa.lfoAmount = 1; s.bpm = 180 }).left; expect(diff(a, b)).toBeGreaterThan(1e-5)
  })
  it('mono, legato, note priority and constant-rate glide alter voice output', () => {
    const poly = render(() => {}, 'Sa', [60, 67]).left
    for (const patch of [{ mode: 1 }, { mode: 1, priority: 1 }, { mode: 2, glide: .5 }]) expect(diff(poly, render(s => Object.assign(s.system!.synth.Sa, patch), 'Sa', [60, 67]).left)).toBeGreaterThan(1e-5)
    const low = render(s => { s.system!.synth.Sa.mode = 1; s.system!.synth.Sa.priority = 1 }, 'Sa', [60, 67]).left, high = render(s => { s.system!.synth.Sa.mode = 1; s.system!.synth.Sa.priority = 2 }, 'Sa', [60, 67]).left; expect(diff(low, high)).toBeGreaterThan(1e-5)
  })
})
describe('Deterministic arp, routing and cleanup', () => {
  it('orders four directions and octave ranges deterministically', () => {
    expect(arpNotes([67, 60, 64], 2)).toEqual([60, 64, 67, 72, 76, 79]); expect([0, 1, 2, 3, 4, 5].map(n => arpIndex(n, 3, 2))).toEqual([0, 1, 2, 1, 0, 1]); expect([0, 1, 2].map(n => arpIndex(n, 3, 1))).toEqual([2, 1, 0]); expect(arpIndex(18, 5, 3)).toBe(arpIndex(18, 5, 3))
  })
  it('Arp/Poly/Gate, run, clock rate, range, direction and hold change rendered behavior', () => {
    const base = (s: InstrumentState) => { s.system!.synth.Sa.arp = true; s.system!.synth.Sa.arpRate = 300 }
    const plain = render(base, 'Sa', [60, 64, 67], 1.2).left
    for (const patch of [{ arpMode: 1 }, { arpMode: 2 }, { arp: false }, { arpRate: 100 }, { range: 3 }, { direction: 1 }, { direction: 2 }, { direction: 3 }, { arpSync: true, subdivision: 16 }]) expect(diff(plain, render(s => { base(s); Object.assign(s.system!.synth.Sa, patch) }, 'Sa', [60, 64, 67], 1.2).left)).toBeGreaterThan(1e-7)
    expect(diff(plain, render(base, 'Sa', [60, 64, 67], 1.2).left)).toBe(0)
    const held = render(s => { base(s); s.system!.synth.Sa.hold = true }, 'Sa', [60], .8, true), released = render(base, 'Sa', [60], .8, true); expect(energy(held.left.slice(sr / 2))).toBeGreaterThan(1e-5); expect(energy(released.left.slice(sr / 2))).toBeLessThan(1e-12)
  })
  it('splits, scenes, levels and morph endpoints affect audio, independent chains stay before master', () => {
    const dry = render(() => {}).left
    expect(energy(render(s => { s.system!.split = true; s.system!.zones.Sa = [0, 0] }).left)).toBe(0)
    expect(energy(render(s => { s.system!.synth.Sa.enabled = false }).left)).toBe(0)
    expect(energy(render(s => { s.system!.synth.Sa.level = .1 }).left)).toBeLessThan(energy(dry) * .1)
    const fx = render(s => { s.system!.synth.Sa.effects.delay.on = true; s.system!.synth.Sa.effects.delay.wet = .8 }).left; expect(diff(dry, fx)).toBeGreaterThan(1e-5)
    for (const id of ['Sa', 'Sb', 'Sc'] as const) expect(energy(render(s => { s.system!.synth[id].enabled = true; s.master = 0 }, id, [60], 1).left.slice(sr / 2))).toBeLessThan(1e-12)
    const result = render(s => { s.system!.synth.Sa.hold = true; s.system!.synth.Sa.arp = true }); result.dsp.message({ kind: 'clear' }); const l = new Float32Array(sr / 10); result.dsp.render(l, new Float32Array(l.length)); expect(energy(l)).toBe(0); expect(result.dsp.extra.voices.size).toBe(0); expect(result.dsp.voices.size).toBe(0)
  })
})

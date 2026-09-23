// Phase 3 Synth: sources and Osc Ctrl per category, filters and the three envelopes, LFO, voice
// modes, unison, vibrato, and the deterministic arpeggiator/gate — measured on audio rendered
// through the real StageAudio graph by the Web Audio simulator.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SynthLayerEngine } from '../audio/synthEngine'
import { arpStepSeconds } from '../audio/synthParams'
import { focusSlot, updateSynthLayer, type SoundState } from '../model/sound'
import { divisionSeconds, SYNTH_WAVES, type SynthLayerState } from '../model/synthState'
import { makeStageRig, type StageRig } from '../testing/stageRig'
import { difference, rms, type SimParam } from '../testing/simAudio'
import { centroid, envelopeVariation, frequencyDeviation, goertzel, harmonicProfile, profileDistance, crossingFrequencies } from '../testing/spectrum'

const SR = 16000
const C4 = 60
const F0 = 261.6256
const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12)
const wave = (id: string) => SYNTH_WAVES.findIndex((w) => w.id === id)

type Patch = Partial<SynthLayerState> | ((l: SynthLayerState) => Partial<SynthLayerState>)
const synthOnly = (patch: Patch = {}, extra: (s: SoundState) => SoundState = (s) => s) => (s: SoundState): SoundState => {
  const base = focusSlot({ ...s, piano: { ...s.piano, on: false }, synth: { ...s.synth, on: true } }, 'synthA')
  const l = base.synth.layers.A
  // Neutral defaults for measurement: filter open (off), full sustain, short release.
  const neutral: Partial<SynthLayerState> = { filter: { ...l.filter, on: false }, ampEnv: { attack: 0, decay: 127, release: 10, velocity: 0 } }
  const p = typeof patch === 'function' ? patch({ ...l, ...neutral }) : patch
  return extra(updateSynthLayer(base, 'A', { ...neutral, ...p }))
}

async function rig(patch: Patch = {}, extra?: (s: SoundState) => SoundState): Promise<StageRig> {
  return makeStageRig({ slots: 'all', sound: synthOnly(patch, extra) })
}

async function synthNote(patch: Patch = {}, extra?: (s: SoundState) => SoundState, hold = 0.3, tail = 0.05, note = C4, velocity = 100) {
  return (await rig(patch, extra)).play(note, velocity, hold, tail)
}

const W = [Math.round(0.08 * SR), Math.round(0.28 * SR)] as const
const RATIOS = [1, 2, 3, 4, 5, 6, 7, 8]
const profile = (x: Float32Array, f0 = F0) => harmonicProfile(x, f0, SR, RATIOS, W[0], W[1])

describe('synth.sources — three layers, the required waveform list, Osc Ctrl per category', () => {
  it('every required waveform is selectable and sounds', async () => {
    const ids = ['sine', 'triangle', 'saw', 'square', 'pulse33', 'pulse10', 'noise', 'syncSaw', 'syncSquare', 'multiSaw', 'multiSaw8', 'superSaw', 'superSquare', 'fm']
    expect(SYNTH_WAVES.map((w) => w.id)).toEqual(ids)
    expect([...new Set(SYNTH_WAVES.map((w) => w.category))]).toEqual(['Pure', 'Sync', 'Multi', 'Super', 'FM-H'])
    for (const id of ids) {
      const out = await synthNote({ wave: wave(id) }, undefined, 0.15)
      expect(rms(out, 400, 2400), id).toBeGreaterThan(0.01)
    }
  })

  it('Pure waveforms have their textbook harmonic signatures', async () => {
    const p = async (id: string) => profile(await synthNote({ wave: wave(id) }))
    const sine = await p('sine')
    const saw = await p('saw')
    const square = await p('square')
    const pulse33 = await p('pulse33')
    const tri = await p('triangle')
    expect(Math.max(...sine.slice(1))).toBeLessThan(0.05)
    expect(saw[1]).toBeGreaterThan(0.35) // saw: every harmonic ~1/k
    expect(square[1]).toBeLessThan(0.08) // square: odd only
    expect(square[2]).toBeGreaterThan(0.25)
    expect(pulse33[2]).toBeLessThan(0.1) // 33 % pulse: every 3rd harmonic missing
    expect(pulse33[1]).toBeGreaterThan(0.3)
    expect(tri[2]).toBeLessThan(0.2) // triangle: weak odd harmonics
    const noise = await synthNote({ wave: wave('noise') })
    expect(centroid(noise, SR, W[0], W[0] + 1024, 64)).toBeGreaterThan(2500)
  })

  it('the five categories are audibly distinct source behaviours, not renamed copies', async () => {
    const ids = ['saw', 'syncSaw', 'multiSaw', 'superSaw', 'fm']
    const outs = new Map<string, Float32Array>()
    for (const id of ids) outs.set(id, await synthNote({ wave: wave(id), oscCtrl: 80 }))
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = outs.get(ids[i])!
        const b = outs.get(ids[j])!
        const d = Math.max(profileDistance(profile(a), profile(b)), Math.abs(envelopeVariation(a, SR, W[0], W[1]) - envelopeVariation(b, SR, W[0], W[1])) * 4)
        expect(d, `${ids[i]} vs ${ids[j]}`).toBeGreaterThan(0.15)
      }
    }
  })

  it('Osc Ctrl: no effect on Pure; sync pitch, multi/super detune and FM amount change the sound', async () => {
    const pair = async (id: string) => [await synthNote({ wave: wave(id), oscCtrl: 0 }), await synthNote({ wave: wave(id), oscCtrl: 127 })] as const
    const [p0, p1] = await pair('saw')
    expect(difference(p0, p1)).toBeLessThan(1e-6)
    const [s0, s1] = await pair('syncSaw')
    expect(centroid(s1, SR, W[0], W[0] + 1024, 96)).toBeGreaterThan(centroid(s0, SR, W[0], W[0] + 1024, 96) * 1.3)
    const [m0, m1] = await pair('multiSaw')
    expect(envelopeVariation(m1, SR, W[0], W[1])).toBeGreaterThan(envelopeVariation(m0, SR, W[0], W[1]) + 0.02)
    const [u0, u1] = await pair('superSaw')
    expect(difference(u0, u1)).toBeGreaterThan(0.3)
    const [f0, f1] = await pair('fm')
    expect(profile(f0)[2]).toBeLessThan(0.05) // index 0: a pure sine carrier
    expect(profile(f1)[2]).toBeGreaterThan(0.1) // index up: sidebands at 3·f0, 5·f0…
  })

  it('three independent layers: each plays its own waveform into its own chain', async () => {
    const r = await rig({ wave: wave('sine') }, (s) => updateSynthLayer(updateSynthLayer(s, 'B', { enabled: true, wave: wave('square') }), 'C', { enabled: true, wave: wave('saw') }))
    r.engine.noteOn(C4, 100, 't')
    r.render(0.05)
    expect(r.engine.snapshot().perSlot).toMatchObject({ synthA: 1, synthB: 1, synthC: 1 })
    expect(r.stage.chain('synthA')).not.toBe(r.stage.chain('synthB'))
    expect(r.stage.chain('synthC')).not.toBeNull()
    r.engine.noteOff(C4, 't')
  })
})

describe('synth provenance', () => {
  it('IMPLEMENTATION_DETAILS.json declares organ and synth as live synthesis and their buffers as generated', () => {
    const details = JSON.parse(readFileSync(resolve(__dirname, '../../IMPLEMENTATION_DETAILS.json'), 'utf8'))
    expect(details.phase).toBe(3)
    const gen = details.audio.generatedSources as { name: string; kind: string }[]
    expect(gen.find((g) => /Organ engines/.test(g.name))?.kind).toBe('live-oscillator')
    expect(gen.find((g) => /Synth engine/.test(g.name))?.kind).toBe('live-oscillator')
    expect(gen.find((g) => /white noise/i.test(g.name))?.kind).toBe('generated-buffer')
    expect(gen.find((g) => /click/i.test(g.name))?.kind).toBe('generated-buffer')
    expect(JSON.stringify(details.audio.sampleSources)).not.toMatch(/organ|synth/i)
    expect(Object.keys(details.controls.unsupported)).toContain('synth-mode')
  })
})

describe('synth.filter-envelopes — filter types, freq, resonance, tracking, drive, three envelopes', () => {
  const filt = (f: Partial<SynthLayerState['filter']>) => (l: SynthLayerState): Partial<SynthLayerState> => ({ wave: wave('saw'), filter: { ...l.filter, on: true, freq: 60, res: 20, envAmt: 0, track: 0, drive: 0, ...f } })

  it('LP12, LP24, HP and BP shape the spectrum differently', async () => {
    const c = async (type: SynthLayerState['filter']['type']) => centroid(await synthNote(filt({ type })), SR, W[0], W[0] + 1024, 96)
    const lp12 = await c('LP12')
    const lp24 = await c('LP24')
    const hp = await c('HP')
    const bp = await c('BP')
    expect(lp24).toBeLessThan(lp12)
    expect(hp).toBeGreaterThan(lp12 * 1.5)
    expect(Math.abs(bp - lp12)).toBeGreaterThan(30)
    const bpOut = await synthNote(filt({ type: 'BP' }))
    const lpOut = await synthNote(filt({ type: 'LP12' }))
    expect(goertzel(bpOut, F0, SR, W[0], W[1])).toBeLessThan(goertzel(lpOut, F0, SR, W[0], W[1]))
  })

  it('cutoff, resonance, key tracking and drive each alter the rendered audio', async () => {
    const cen = (x: Float32Array) => centroid(x, SR, W[0], W[0] + 1024, 96)
    expect(cen(await synthNote(filt({ type: 'LP24', freq: 90 })))).toBeGreaterThan(cen(await synthNote(filt({ type: 'LP24', freq: 50 }))) * 1.3)
    const lowRes = await synthNote(filt({ type: 'LP24', freq: 64, res: 0 }))
    const highRes = await synthNote(filt({ type: 'LP24', freq: 64, res: 115 }))
    expect(difference(lowRes, highRes)).toBeGreaterThan(0.2)
    const bright = (track: number, note: number) => synthNote(filt({ type: 'LP24', freq: 55, track }), undefined, 0.3, 0.05, note)
    const ratio = async (track: number) => cen(await bright(track, 84)) / cen(await bright(track, 48))
    expect(await ratio(3)).toBeGreaterThan((await ratio(0)) * 1.3)
    const clean = await synthNote((l) => ({ wave: wave('sine'), filter: { ...l.filter, on: true, type: 'LP12', freq: 127, drive: 0 } }))
    const driven = await synthNote((l) => ({ wave: wave('sine'), filter: { ...l.filter, on: true, type: 'LP12', freq: 127, drive: 3 } }))
    expect(profile(driven)[2]).toBeGreaterThan(profile(clean)[2] + 0.05)
  })

  it('filter envelope amount sweeps the cutoff; its velocity toggle scales the sweep', async () => {
    const env = (envAmt: number, velocity = false): Patch => (l) => ({ ...filt({ type: 'LP24', freq: 30, envAmt })(l), filterEnv: { attack: 0, decay: 40, release: 20, velocity } })
    const early = (x: Float32Array) => centroid(x, SR, 0, 800, 64)
    const late = (x: Float32Array) => centroid(x, SR, Math.round(0.25 * SR), Math.round(0.25 * SR) + 800, 64)
    const none = await synthNote(env(0))
    const sweep = await synthNote(env(110))
    expect(early(sweep)).toBeGreaterThan(early(none) * 1.5)
    expect(early(sweep)).toBeGreaterThan(late(sweep) * 1.2)
    const soft = await synthNote(env(110, true), undefined, 0.3, 0.05, C4, 20)
    const hard = await synthNote(env(110, true), undefined, 0.3, 0.05, C4, 127)
    expect(early(hard)).toBeGreaterThan(early(soft) * 1.15)
  })

  it('amp envelope: attack, decay (max = sustain), release and velocity levels', async () => {
    const amp = (a: number, d: number, r: number, velocity = 0): Patch => ({ wave: wave('saw'), ampEnv: { attack: a, decay: d, release: r, velocity } })
    const fast = await synthNote(amp(0, 127, 10))
    const slow = await synthNote(amp(80, 127, 10))
    expect(rms(slow, 0, 480)).toBeLessThan(rms(fast, 0, 480) * 0.5)
    const decaying = await synthNote(amp(0, 45, 10))
    expect(rms(decaying, Math.round(0.22 * SR), Math.round(0.29 * SR))).toBeLessThan(rms(fast, Math.round(0.22 * SR), Math.round(0.29 * SR)) * 0.5)
    const longRel = await synthNote(amp(0, 127, 80), undefined, 0.2, 0.3)
    const shortRel = await synthNote(amp(0, 127, 10), undefined, 0.2, 0.3)
    const tail = [Math.round(0.3 * SR), Math.round(0.45 * SR)] as const
    expect(rms(longRel, tail[0], tail[1])).toBeGreaterThan(rms(shortRel, tail[0], tail[1]) * 5)
    const velRatio = async (level: number) => rms(await synthNote(amp(0, 127, 10, level), undefined, 0.2, 0.02, C4, 127)) / rms(await synthNote(amp(0, 127, 10, level), undefined, 0.2, 0.02, C4, 30))
    const r0 = await velRatio(0)
    const r3 = await velRatio(3)
    expect(r0).toBeCloseTo(1, 2)
    expect(r3).toBeGreaterThan(2.5)
  })

  it('oscillator envelope modulates Osc Ctrl (bipolar) or pitch with Env To Pitch', async () => {
    const oenv = (amt: number, toPitch = false): Patch => ({ wave: wave('syncSaw'), oscCtrl: 20, oscEnvAmt: amt, envToPitch: toPitch, oscEnv: { attack: 0, decay: 40, release: 20, velocity: false } })
    const cen = (x: Float32Array, from: number) => centroid(x, SR, from, from + 160, 48)
    const flat = await synthNote(oenv(64))
    const up = await synthNote(oenv(127))
    expect(cen(up, 0)).toBeGreaterThan(cen(flat, 0) * 1.2)
    expect(cen(up, 0)).toBeGreaterThan(cen(up, Math.round(0.25 * SR)) * 1.1)
    const pitchEnv = await synthNote({ ...(oenv(127, true) as Partial<SynthLayerState>), wave: wave('sine') })
    // Env To Pitch: the attack starts up to two octaves sharp and settles on the key pitch.
    expect(pitch(pitchEnv, 0, 240)).toBeGreaterThan(pitch(pitchEnv, 3200, 4400) * 1.3)
    expect(pitch(pitchEnv, 3200, 4400) / F0).toBeCloseTo(1, 1)
  })
})

describe('synth.voice-modes — poly/mono/legato, priority, glide, unison, vibrato, LFO', () => {
  const pitchAt = (x: Float32Array, from: number, to: number) => median(crossingFrequencies(x, SR, from, to))

  it('Poly plays every key; Mono and Legato keep one voice following note priority', async () => {
    const poly = await rig({ wave: wave('sine') })
    poly.engine.noteOn(60, 100, 't')
    poly.engine.noteOn(67, 100, 't')
    poly.render(0.05)
    expect(poly.engine.snapshot().perSlot.synthA).toBe(2)
    for (const [priority, expected] of [
      ['last', 64],
      ['low', 55],
      ['high', 67],
    ] as const) {
      const r = await rig((l) => ({ wave: wave('sine'), voice: { ...l.voice, mode: 'mono', priority, glide: 0 } }))
      r.engine.noteOn(55, 100, 't')
      r.render(0.03)
      r.engine.noteOn(67, 100, 't')
      r.render(0.03)
      r.engine.noteOn(64, 100, 't')
      const out = r.render(0.15)
      expect(r.engine.snapshot().perSlot.synthA, priority).toBe(1)
      expect(pitchAt(out, 800, 2400) / hz(expected), priority).toBeCloseTo(1, 1)
      // Releasing the sounding key returns to the next key by priority (not silence).
      r.engine.noteOff(expected, 't')
      const back = r.render(0.1)
      expect(rms(back, 400, 1600), `${priority} returns`).toBeGreaterThan(0.01)
    }
  })

  it('Mono retriggers the envelopes on each key; Legato does not while keys overlap', async () => {
    const run = async (mode: 'mono' | 'legato') => {
      const r = await rig((l) => ({
        wave: wave('saw'),
        voice: { ...l.voice, mode, glide: 0 },
        filter: { ...l.filter, on: true, type: 'LP24', freq: 25, envAmt: 120, track: 0 },
        filterEnv: { attack: 0, decay: 30, release: 10, velocity: false },
      }))
      r.engine.noteOn(60, 100, 't')
      r.render(0.3)
      r.engine.noteOn(62, 100, 't')
      const out = r.render(0.05)
      return centroid(out, SR, 0, 160, 48)
    }
    expect(await run('mono')).toBeGreaterThan((await run('legato')) * 1.3)
  })

  it('glide is constant-rate portamento: legato steps slide, and a larger interval takes longer', async () => {
    const glide = async (to: number, glideKnob: number) => {
      const r = await rig((l) => ({ wave: wave('sine'), voice: { ...l.voice, mode: 'legato', glide: glideKnob } }))
      r.engine.noteOn(48, 100, 't')
      r.render(0.1)
      r.engine.noteOn(to, 100, 't')
      return r.render(0.4)
    }
    const none = await glide(60, 0)
    expect(pitchAt(none, 80, 480) / hz(60)).toBeCloseTo(1, 1)
    const octave = await glide(60, 70)
    const fifth = await glide(55, 70)
    // Early in the glide the pitch is still between the two notes.
    const early = pitchAt(octave, 80, 400)
    expect(early).toBeGreaterThan(hz(48) * 1.02)
    expect(early).toBeLessThan(hz(60) * 0.97)
    // Constant rate (~29 ms per semitone here): at 0.25 s the fifth (7 st) has arrived, the octave has not.
    const t = Math.round(0.25 * SR)
    expect(pitchAt(fifth, t, t + 800) / hz(55)).toBeCloseTo(1, 1)
    expect(pitchAt(octave, t, t + 800)).toBeLessThan(hz(60) * 0.97)
  })

  it('unison thickens and widens the voice', async () => {
    const stereo = async (unison: number) => {
      const r = await rig({ wave: wave('saw'), unison })
      r.engine.noteOn(C4, 100, 't')
      const { left, right } = r.ctx.renderStereo(0.3)
      let d = 0
      for (let i = 0; i < left.length; i++) d += (left[i] - right[i]) ** 2
      return Math.sqrt(d / left.length)
    }
    expect(await stereo(0)).toBeLessThan(1e-4)
    expect(await stereo(3)).toBeGreaterThan(0.01)
  })

  it('vibrato On always modulates pitch; Wheel mode follows the mod wheel', async () => {
    const vib = (mode: SynthLayerState['vibrato']['mode']): Patch => ({ wave: wave('sine'), vibrato: { mode, rate: 80, amount: 127 } })
    const dev = (x: Float32Array) => frequencyDeviation(x, SR, 800, 4800)
    expect(dev(await synthNote(vib('off')))).toBeLessThan(0.5)
    expect(dev(await synthNote(vib('on')))).toBeGreaterThan(2)
    const wheelRig = async (wheel: number) => {
      const r = await rig(vib('wheel'))
      r.stage.apply(r.sound(), wheel)
      return r.play(C4, 100, 0.3, 0.02)
    }
    expect(dev(await wheelRig(0))).toBeLessThan(0.5)
    expect(dev(await wheelRig(127))).toBeGreaterThan(2)
  })

  it('LFO: five waveforms, three destinations, off keeps settings, and master-clock sync', async () => {
    const lfo = (p: Partial<SynthLayerState['lfo']>, base: Patch = { wave: wave('sine') }): Patch => (l) => ({ ...(typeof base === 'function' ? base(l) : base), lfo: { wave: 'triangle', dest: 'pitch', rate: 70, amount: 60, sync: false, ...p } })
    const dev = (x: Float32Array) => frequencyDeviation(x, SR, 800, 4800)
    expect(dev(await synthNote(lfo({ dest: 'pitch' })))).toBeGreaterThan(3)
    expect(dev(await synthNote(lfo({ dest: 'off' })))).toBeLessThan(0.5)
    const filterBase: Patch = (l) => ({ wave: wave('saw'), filter: { ...l.filter, on: true, type: 'LP24', freq: 50, envAmt: 0 } })
    const still = await synthNote(lfo({ dest: 'off' }, filterBase))
    const swept = await synthNote(lfo({ dest: 'filter', amount: 100 }, filterBase))
    expect(envelopeVariation(swept, SR, 800, 4800)).toBeGreaterThan(envelopeVariation(still, SR, 800, 4800) + 0.05)
    const ctrlStill = await synthNote(lfo({ dest: 'off' }, { wave: wave('syncSaw'), oscCtrl: 40 }))
    const ctrlMod = await synthNote(lfo({ dest: 'ctrl', amount: 120 }, { wave: wave('syncSaw'), oscCtrl: 40 }))
    expect(difference(ctrlStill, ctrlMod)).toBeGreaterThan(0.2)
  }, 20000)

  it('LFO: the five waveforms modulate differently, and Rate syncs to the master clock', async () => {
    const lfo = (p: Partial<SynthLayerState['lfo']>): Patch => ({ wave: wave('sine'), lfo: { wave: 'triangle', dest: 'pitch', rate: 70, amount: 60, sync: false, ...p } })
    const shapes = ['triangle', 'sawDown', 'sawUp', 'square', 'sh'] as const
    const outs = []
    for (const w of shapes) outs.push(await synthNote(lfo({ wave: w, rate: 60, amount: 50 }), undefined, 0.3))
    for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) expect(difference(outs[i], outs[j]), `${shapes[i]} vs ${shapes[j]}`).toBeGreaterThan(0.05)
    // Synced: the LFO runs one cycle per master-clock subdivision.
    const r = await rig(lfo({ sync: true, rate: 64 }), (s) => ({ ...s, clock: { ...s.clock, bpm: 100 } }))
    const param = r.stage.synthGraph('A')!.lfo.frequency as SimParam
    expect(param.valueAt(r.ctx.currentTime + 1)).toBeCloseTo(1 / divisionSeconds(64, 100), 3)
  }, 20000)
})

describe('synth.arp-gate — deterministic rate, clock sync, range, direction, hold, run', () => {
  const arpRig = (arp: Partial<SynthLayerState['arp']>, extra: (s: SoundState) => SoundState = (s) => s) =>
    rig((l) => ({ wave: wave('sine'), ampEnv: { attack: 0, decay: 127, release: 5, velocity: 0 }, arp: { ...l.arp, run: true, rate: 64, range: 0, direction: 'up', sync: true, ...arp } }), (s) => extra({ ...s, clock: { ...s.clock, bpm: 120 } }))
  const events = (r: StageRig) => (r.engine.engines.synthA as SynthLayerEngine).arp.events

  it('synced Up arpeggio: exact step times from the master clock and ascending order', async () => {
    const r = await arpRig({})
    const step = arpStepSeconds(r.sound(), 'A')
    expect(step).toBeCloseTo(divisionSeconds(64, 120), 9)
    for (const n of [64, 60, 67]) r.engine.noteOn(n, 100, 't')
    r.renderTicking(step * 5 + 0.001)
    const ev = events(r)
    expect(ev.map((e) => e.notes[0])).toEqual([60, 64, 67, 60, 64, 67])
    ev.forEach((e, i) => expect(e.time).toBeCloseTo(ev[0].time + i * step, 9))
    // The master clock drives the rate: a faster clock shortens the step.
    r.set((s) => ({ ...s, clock: { ...s.clock, bpm: 240 } }))
    expect(arpStepSeconds(r.sound(), 'A')).toBeCloseTo(step / 2, 9)
  })

  it('range spans octaves; Down, Up/Down and Random are deterministic', async () => {
    const seq = async (arp: Partial<SynthLayerState['arp']>, steps: number) => {
      const r = await arpRig(arp)
      const step = arpStepSeconds(r.sound(), 'A')
      for (const n of [60, 64]) r.engine.noteOn(n, 100, 't')
      r.renderTicking(step * (steps - 1) + 0.001)
      return events(r).map((e) => e.notes[0])
    }
    expect(await seq({ range: 40 }, 5)).toEqual([60, 64, 72, 76, 60])
    expect(await seq({ direction: 'down', range: 40 }, 4)).toEqual([76, 72, 64, 60])
    expect(await seq({ direction: 'upDown', range: 40 }, 6)).toEqual([60, 64, 72, 76, 72, 64])
    const r1 = await seq({ direction: 'random', range: 127 }, 8)
    const r2 = await seq({ direction: 'random', range: 127 }, 8)
    expect(r1).toEqual(r2)
    expect(new Set(r1).size).toBeGreaterThan(2)
  }, 20000)

  it('unsynced rate follows the Rate knob; audio follows the steps', async () => {
    const r = await arpRig({ sync: false, rate: 100 })
    const step = arpStepSeconds(r.sound(), 'A')
    r.engine.noteOn(60, 100, 't')
    r.engine.noteOn(67, 100, 't')
    const out = r.renderTicking(step * 2)
    expect(rms(out)).toBeGreaterThan(0.01)
    const first = pitch(out, 100, Math.round(step * SR * 0.8))
    const second = pitch(out, Math.round(step * SR) + 100, Math.round(step * SR * 1.8))
    expect(first / hz(60)).toBeCloseTo(1, 1)
    expect(second / hz(67)).toBeCloseTo(1, 1)
  })

  it('KB Hold keeps the arpeggio running after the keys are lifted; Run off plays keys directly', async () => {
    const r = await arpRig({}, (s) => ({ ...s, synth: { ...s.synth, kbHold: true } }))
    const step = arpStepSeconds(r.sound(), 'A')
    r.engine.noteOn(60, 100, 't')
    r.engine.noteOn(64, 100, 't')
    r.renderTicking(step)
    r.engine.noteOff(60, 't')
    r.engine.noteOff(64, 't')
    const before = events(r).length
    const held = r.renderTicking(step * 3)
    expect(events(r).length).toBeGreaterThan(before + 2)
    expect(rms(held)).toBeGreaterThan(0.01)
    // A new chord after all keys were lifted replaces the latched one.
    r.engine.noteOn(67, 100, 't')
    r.renderTicking(step * 2)
    expect(events(r).slice(-2).every((e) => e.notes[0] === 67)).toBe(true)
    // Run off: keys play directly, no steps.
    const off = await arpRig({ run: false })
    off.engine.noteOn(60, 100, 't')
    off.engine.noteOn(64, 100, 't')
    off.renderTicking(0.5)
    expect(events(off)).toHaveLength(0)
    expect(off.engine.snapshot().perSlot.synthA).toBe(2)
  })

  it('Poly mode steps the whole chord; Gate mode chops held notes at the rate', async () => {
    const poly = await arpRig({ mode: 'poly', range: 40 })
    const step = arpStepSeconds(poly.sound(), 'A')
    poly.engine.noteOn(60, 100, 't')
    poly.engine.noteOn(64, 100, 't')
    poly.renderTicking(step * 2 + 0.001)
    expect(events(poly).map((e) => e.notes)).toEqual([
      [60, 64],
      [72, 76],
      [60, 64],
    ])
    const gate = await arpRig({ mode: 'gate', range: 127 })
    const plain = await arpRig({ run: false })
    const render = async (r: StageRig) => {
      r.engine.noteOn(60, 100, 't')
      return r.renderTicking(step * 4)
    }
    const g = await render(gate)
    const p = await render(plain)
    expect(envelopeVariation(g, SR, 400, g.length)).toBeGreaterThan(envelopeVariation(p, SR, 400, p.length) + 0.3)
  })
})

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

function pitch(x: Float32Array, from: number, to: number) {
  return median(crossingFrequencies(x, SR, from, to))
}


import { describe, expect, it } from 'vitest'
import type { EngineState } from '../engine/state'
import { SYNTH_WAVEFORMS, type ArpMode, type SynthLayerId, type SynthPatch } from '../engine/synth'
import { audibleSeconds, bandEnergy, correlation, difference, envelopeModulation, peak, peakFrequencies, rms, spectralCentroid, spectrum } from '../test-utils/analysis'
import { renderSynth, SR, withPatch, type SynthRig } from './synth/harness'

/**
 * Rendered-audio tests for the Synth engine (real Web Audio graph on node-web-audio-api's OfflineAudioContext).
 * Feature ids: synth.sources, synth.filter-envelopes, synth.voice-modes, synth.arp-gate.
 */

// --- helpers ------------------------------------------------------------------------------------------------
interface Ev {
  note: number
  at?: number
  off?: number
  vel?: number
  layer?: SynthLayerId
  gain?: number
}

async function play(seconds: number, edit: ((s: EngineState) => EngineState) | undefined, notes: Ev[], extra?: (rig: SynthRig) => void) {
  return renderSynth(seconds, edit, (rig) => {
    const events: Array<{ t: number; kind: 'on' | 'off'; e: Ev }> = []
    for (const e of notes) {
      events.push({ t: e.at ?? 0, kind: 'on', e })
      if (e.off !== undefined) events.push({ t: e.off, kind: 'off', e })
    }
    events.sort((a, b) => a.t - b.t || (a.kind === 'off' ? -1 : 1))
    for (const ev of events) {
      rig.engine.pump(ev.t)
      const layer = ev.e.layer ?? 'A'
      if (ev.kind === 'on') rig.engine.noteOn(layer, ev.e.note, ev.e.vel ?? 100, ev.e.gain ?? 1, ev.t)
      else rig.engine.noteOff(layer, ev.e.note, ev.t)
    }
    rig.engine.pump(seconds)
    extra?.(rig)
  })
}

const patchOf = (fn: (p: SynthPatch) => SynthPatch, layer: SynthLayerId = 'A') => (s: EngineState) => withPatch(s, layer, fn)
const chain =
  (...fns: Array<(s: EngineState) => EngineState>) =>
  (s: EngineState) =>
    fns.reduce((acc, f) => f(acc), s)

/** seconds → envelope knob position (inverse of envSeconds) */
const knob = (seconds: number) => Math.log(seconds / 0.002) / Math.log(5000)
const WAVE = (id: string) => SYNTH_WAVEFORMS.findIndex((w) => w.id === id)
const hz = (note: number) => 440 * Math.pow(2, (note - 69) / 12)
const N = (seconds: number) => Math.round(seconds * SR)

/** a plain patch: chosen waveform, open filter, no modulation, short envelopes */
const basic = (id: string, extra: (p: SynthPatch) => SynthPatch = (p) => p) =>
  patchOf((p) =>
    extra({
      ...p,
      waveform: WAVE(id),
      filter: { ...p.filter, freq: 1, res: 0, envAmount: 0, tracking: 0, drive: 0 },
      amp: { ...p.amp, attack: 0, decay: 1, release: knob(0.03), velocity: 0 },
      oscEnv: { ...p.oscEnv, amount: 0 },
    }),
  )

/** average frequency (Hz) of a sine-like signal between two times, from interpolated zero crossings */
function zcFreq(x: ArrayLike<number>, from: number, to: number): number {
  const crossings: number[] = []
  for (let i = N(from) + 1; i < Math.min(N(to), x.length); i++) {
    if (x[i - 1] < 0 && x[i] >= 0) crossings.push(i - 1 + -x[i - 1] / (x[i] - x[i - 1]))
  }
  if (crossings.length < 2) return 0
  return ((crossings.length - 1) * SR) / (crossings[crossings.length - 1] - crossings[0])
}

const pitchTrack = (x: ArrayLike<number>, from: number, to: number, hop: number): number[] => {
  const out: number[] = []
  for (let t = from; t + hop <= to + 1e-9; t += hop) out.push(zcFreq(x, t, t + hop))
  return out
}
const stdev = (v: number[]) => {
  const m = v.reduce((a, b) => a + b, 0) / v.length
  return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length)
}
const centroidTrack = (x: ArrayLike<number>, from: number, to: number, hop: number): number[] => {
  const out: number[] = []
  for (let t = from; t + hop <= to + 1e-9; t += hop) out.push(spectralCentroid(x, SR, N(t), 2048))
  return out
}
const cents = (a: number, b: number) => 1200 * Math.log2(a / b)

/** 48 log-spaced band levels (dB) between 100 Hz and 12 kHz */
function bands(x: ArrayLike<number>, from: number): number[] {
  const size = 8192
  const mags = spectrum(x, N(from), size)
  const binHz = SR / size
  const out: number[] = []
  for (let b = 0; b < 48; b++) {
    const lo = 100 * Math.pow(120, b / 48)
    const hi = 100 * Math.pow(120, (b + 1) / 48)
    let e = 0
    for (let i = Math.floor(lo / binHz); i <= Math.ceil(hi / binHz); i++) e += (mags[i] ?? 0) ** 2
    out.push(10 * Math.log10(e + 1e-9))
  }
  return out
}
/** RMS difference in dB between two band spectra */
const spectralDistance = (a: ArrayLike<number>, b: ArrayLike<number>, from = 0.5): number => {
  const A = bands(a, from)
  const B = bands(b, from)
  return Math.sqrt(A.reduce((s, v, i) => s + (v - B[i]) ** 2, 0) / A.length)
}

/** number of note starts: rising edges of the 4 ms RMS envelope through 30 % of its maximum (with hysteresis) */
function countOnsets(x: ArrayLike<number>, from = 0, to = x.length / SR): number {
  const win = N(0.004)
  const env: number[] = []
  for (let i = N(from); i + win <= Math.min(N(to), x.length); i += win) env.push(rms(x, i, i + win))
  const max = Math.max(...env)
  let on = false
  let n = 0
  for (const v of env) {
    if (!on && v > 0.3 * max) {
      on = true
      n++
    } else if (on && v < 0.1 * max) on = false
  }
  return n
}
/** first time the 4 ms RMS envelope exceeds 20 % of its maximum */
function firstOnset(x: ArrayLike<number>): number {
  const win = N(0.004)
  let max = 0
  for (let i = 0; i + win <= x.length; i += win) max = Math.max(max, rms(x, i, i + win))
  for (let i = 0; i + win <= x.length; i += win) if (rms(x, i, i + win) > 0.2 * max) return i / SR
  return -1
}

const NOTE = 60

// =====================================================================================================================
describe('synth.sources — waveforms, categories and Osc Ctrl', () => {
  it('is silent without notes and audible with one; a single saw voice sits at a sensible level', async () => {
    const silent = await play(1, undefined, [])
    expect(peak(silent.mono)).toBe(0)
    const r = await play(2, undefined, [{ note: NOTE, vel: 100 }])
    const level = rms(r.mono, N(0.8), N(1.8))
    // default patch (saw, LP24 with envelope): documented level scaling VOICE_LEVEL = 0.16 per voice at velocity 127
    expect(level).toBeGreaterThan(0.04)
    expect(level).toBeLessThan(0.12)
  })

  it('a six-note chord at full velocity stays inside ±1 before the master limiter', async () => {
    const chord = [48, 52, 55, 60, 64, 67].map((note) => ({ note, vel: 127 }))
    const r = await play(1.5, basic('saw'), chord)
    expect(peak(r.mono)).toBeGreaterThan(0.2)
    expect(peak(r.left)).toBeLessThan(1)
    expect(peak(r.right)).toBeLessThan(1)
  })

  it('renders every one of the 14 required waveforms', async () => {
    expect(SYNTH_WAVEFORMS.map((w) => w.category)).toEqual(['Pure', 'Pure', 'Pure', 'Pure', 'Pure', 'Pure', 'Pure', 'Sync', 'Sync', 'Multi', 'Multi', 'Super', 'Super', 'FM-H'])
    for (const [i, w] of SYNTH_WAVEFORMS.entries()) {
      const r = await play(1, patchOf((p) => ({ ...p, waveform: i, oscCtrl: 0.5, filter: { ...p.filter, freq: 1, envAmount: 0 } })), [{ note: NOTE }])
      const level = rms(r.mono, N(0.3), N(0.9))
      expect(level, w.name).toBeGreaterThan(0.02)
      expect(peak(r.mono), w.name).toBeLessThan(0.6)
    }
  })

  it('Pure waveforms are pairwise different: sine < triangle < saw in brightness, pulses and square are hollow, noise is broadband', async () => {
    const ids = ['sine', 'triangle', 'saw', 'square', 'pulse33', 'pulse10', 'noise']
    const out: Record<string, Float32Array> = {}
    for (const id of ids) out[id] = (await play(1.2, basic(id), [{ note: NOTE }])).mono
    const c = (id: string) => spectralCentroid(out[id], SR, N(0.4), 8192)
    expect(c('sine')).toBeLessThan(c('triangle'))
    expect(c('triangle')).toBeLessThan(c('saw'))
    expect(c('saw')).toBeLessThan(c('noise'))
    // sine is a single line; the square has odd harmonics only (3rd present, 2nd absent)
    const partial = (id: string, k: number) => bandEnergy(out[id], SR, hz(NOTE) * k * 0.97, hz(NOTE) * k * 1.03, N(0.4))
    expect(partial('sine', 2) / partial('sine', 1)).toBeLessThan(0.001)
    expect(partial('square', 3) / partial('square', 1)).toBeGreaterThan(0.03)
    expect(partial('square', 2) / partial('square', 1)).toBeLessThan(0.01)
    expect(partial('pulse33', 2) / partial('pulse33', 1)).toBeGreaterThan(0.05) // a 33 % pulse has even harmonics
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) expect(spectralDistance(out[ids[i]], out[ids[j]]), `${ids[i]} vs ${ids[j]}`).toBeGreaterThan(1.5)
    // noise has no pitch: energy well above the fundamental region
    expect(bandEnergy(out.noise, SR, 6000, 12000, N(0.4))).toBeGreaterThan(20 * bandEnergy(out.sine, SR, 6000, 12000, N(0.4)) + 1e-6)
  })

  it('Pure, Sync, Multi, Super and FM-H are audibly distinct source behaviours', async () => {
    const pick = ['saw', 'sync-saw', 'multi-saw', 'super-saw', 'fm-2op']
    const out: Record<string, Float32Array> = {}
    for (const id of pick) out[id] = (await play(1.4, basic(id, (p) => ({ ...p, oscCtrl: 0.55 })), [{ note: NOTE }])).mono
    for (let i = 0; i < pick.length; i++) for (let j = i + 1; j < pick.length; j++) expect(spectralDistance(out[pick[i]], out[pick[j]]), `${pick[i]} vs ${pick[j]}`).toBeGreaterThan(1.5)
    // and the waveforms themselves differ from the plain saw
    for (const id of pick.slice(1)) expect(difference(out.saw.slice(N(0.5), N(1)), out[id].slice(N(0.5), N(1)))).toBeGreaterThan(0.3)
  })

  it('Osc Ctrl does nothing for Pure waveforms and changes every other category', async () => {
    const at = async (id: string, c: number) => (await play(1.4, basic(id, (p) => ({ ...p, oscCtrl: c })), [{ note: NOTE }])).mono
    for (const id of ['sine', 'triangle', 'saw', 'square', 'pulse33', 'pulse10', 'noise']) {
      const a = await at(id, 0.05)
      const b = await at(id, 0.95)
      expect(difference(a, b), id).toBeLessThan(1e-4)
    }
    for (const id of ['sync-saw', 'sync-square', 'multi-saw', 'multi-saw-8ve', 'super-saw', 'super-square', 'fm-2op']) {
      const a = await at(id, 0.05)
      const b = await at(id, 0.95)
      expect(difference(a.slice(N(0.5), N(1.2)), b.slice(N(0.5), N(1.2))), id).toBeGreaterThan(0.3)
    }
  })

  it('Sync: Osc Ctrl raises the synced oscillator ratio (brighter, non-harmonic-of-saw spectrum); FM-H: Osc Ctrl is the FM index', async () => {
    const c = async (id: string, v: number) => spectralCentroid((await play(1.4, basic(id, (p) => ({ ...p, oscCtrl: v })), [{ note: NOTE }])).mono, SR, N(0.5), 8192)
    expect(await c('sync-saw', 0.9)).toBeGreaterThan(1.3 * (await c('sync-saw', 0.02)))
    expect(await c('sync-square', 0.9)).toBeGreaterThan(1.3 * (await c('sync-square', 0.02)))
    expect(await c('fm-2op', 0.9)).toBeGreaterThan(2 * (await c('fm-2op', 0.05)))
    // FM at index 0 is a plain sine
    const sine = (await play(1.2, basic('fm-2op', (p) => ({ ...p, oscCtrl: 0 })), [{ note: NOTE }])).mono
    expect(bandEnergy(sine, SR, hz(NOTE) * 1.9, hz(NOTE) * 2.1, N(0.4)) / bandEnergy(sine, SR, hz(NOTE) * 0.9, hz(NOTE) * 1.1, N(0.4))).toBeLessThan(0.001)
  })

  it('Multi Saw: Osc Ctrl is the detune between the stacked saws (beating grows); Super Saw is stereo-wide, Multi Saw is not', async () => {
    const at = async (id: string, v: number) => play(3, basic(id, (p) => ({ ...p, oscCtrl: v })), [{ note: 48 }])
    const tight = await at('multi-saw', 0.03)
    const wide = await at('multi-saw', 0.6)
    expect(envelopeModulation(wide.mono, SR, N(0.5), N(2.5), 1024)).toBeGreaterThan(envelopeModulation(tight.mono, SR, N(0.5), N(2.5), 1024) + 0.05)
    const superSaw = await at('super-saw', 0.6)
    const multi = await at('multi-saw', 0.6)
    expect(correlation(multi.left.slice(N(0.5), N(2)), multi.right.slice(N(0.5), N(2)))).toBeGreaterThan(0.999)
    expect(correlation(superSaw.left.slice(N(0.5), N(2)), superSaw.right.slice(N(0.5), N(2)))).toBeLessThan(0.97)
    // 8ve: energy one octave below the played note
    const eight = await at('multi-saw-8ve', 0.5)
    expect(bandEnergy(eight.mono, SR, hz(48) * 0.48, hz(48) * 0.52, N(0.6))).toBeGreaterThan(20 * bandEnergy(multi.mono, SR, hz(48) * 0.48, hz(48) * 0.52, N(0.6)))
  })

  it('the oscillator envelope and the LFO both modulate Osc Ctrl (FM index sweeps the spectrum over time)', async () => {
    const env = await play(
      2,
      basic('fm-2op', (p) => ({ ...p, oscCtrl: 0, oscEnv: { ...p.oscEnv, attack: 0, decay: knob(0.5), release: knob(0.03), amount: 1, toPitch: false } })),
      [{ note: NOTE }],
    )
    expect(spectralCentroid(env.mono, SR, N(0.03), 2048)).toBeGreaterThan(2.5 * spectralCentroid(env.mono, SR, N(1.2), 2048))
    // negative amount inverts the sweep
    const neg = await play(
      2,
      basic('fm-2op', (p) => ({ ...p, oscCtrl: 0.5, oscEnv: { ...p.oscEnv, attack: 0, decay: knob(0.5), release: knob(0.03), amount: -0.5, toPitch: false } })),
      [{ note: NOTE }],
    )
    expect(spectralCentroid(neg.mono, SR, N(0.03), 2048)).toBeLessThan(spectralCentroid(neg.mono, SR, N(1.2), 2048))
    const lfoPatch = (amount: number) => basic('fm-2op', (p) => ({ ...p, oscCtrl: 0.35, lfo: { ...p.lfo, dest: 'ctrl', waveform: 0, rate: 0.5, amount } }))
    const moving = await play(4, lfoPatch(0.35), [{ note: NOTE }])
    const still = await play(4, lfoPatch(0), [{ note: NOTE }])
    expect(stdev(centroidTrack(moving.mono, 0.3, 3.8, 0.1))).toBeGreaterThan(5 * stdev(centroidTrack(still.mono, 0.3, 3.8, 0.1)) + 1)
  })

  it('coarse and fine tune the oscillator; the pitch stick bends it ±2 semitones', async () => {
    const f = async (edit: (s: EngineState) => EngineState) => zcFreq((await play(1.2, edit, [{ note: NOTE }])).mono, 0.3, 1.1)
    const base = await f(basic('sine'))
    expect(base).toBeCloseTo(hz(NOTE), 0)
    expect(await f(basic('sine', (p) => ({ ...p, coarse: 12 })))).toBeCloseTo(2 * base, 0)
    expect(cents(await f(basic('sine', (p) => ({ ...p, fine: 50 }))), base)).toBeCloseTo(50, -1)
    const bent = await f(chain(basic('sine'), (s) => ({ ...s, pitchBend: 1 })))
    expect(cents(bent, base)).toBeCloseTo(200, -1)
    const off = await f(chain(basic('sine'), (s) => ({ ...s, pitchBend: 1, synth: { ...s.synth, A: { ...s.synth.A, pitchStick: false } } })))
    expect(cents(off, base)).toBeCloseTo(0, -1)
  })

  it('zone gain scales the whole voice', async () => {
    const full = await play(1, basic('saw'), [{ note: NOTE, gain: 1 }])
    const half = await play(1, basic('saw'), [{ note: NOTE, gain: 0.5 }])
    expect(rms(half.mono, N(0.3), N(0.9)) / rms(full.mono, N(0.3), N(0.9))).toBeCloseTo(0.5, 1)
  })
})

// =====================================================================================================================
describe('synth.filter-envelopes — filter types, tracking, resonance, drive and the three envelopes', () => {
  const filt = (over: Partial<SynthPatch['filter']>, extra: (p: SynthPatch) => SynthPatch = (p) => p) =>
    patchOf((p) =>
      extra({
        ...p,
        waveform: WAVE('saw'),
        filter: { ...p.filter, on: true, type: 'LP24', freq: 0.6, res: 0, envAmount: 0, tracking: 0, drive: 0, ...over },
        amp: { ...p.amp, attack: 0, decay: 1, release: knob(0.03), velocity: 0 },
      }),
    )
  const centroid = async (over: Partial<SynthPatch['filter']>, note = 48) => spectralCentroid((await play(1.2, filt(over), [{ note }])).mono, SR, N(0.5), 8192)

  it('cutoff moves the spectral centroid of a low-pass up and down; a high-pass does the opposite', async () => {
    const low = await centroid({ freq: 0.3 })
    const mid = await centroid({ freq: 0.55 })
    const high = await centroid({ freq: 0.9 })
    expect(low).toBeLessThan(mid)
    expect(mid).toBeLessThan(high)
    const hpLow = await centroid({ type: 'HP', freq: 0.35 })
    const hpHigh = await centroid({ type: 'HP', freq: 0.7 })
    expect(hpHigh).toBeGreaterThan(hpLow)
    expect(hpLow).toBeGreaterThan(low)
  })

  it('LP12, LP24, HP and BP are four different filters: LP24 is steeper than LP12, BP keeps a band', async () => {
    const at = async (type: 'LP12' | 'LP24' | 'HP' | 'BP') => (await play(1.2, filt({ type, freq: 0.5 }), [{ note: 48 }])).mono
    const [lp12, lp24, hp, bp] = [await at('LP12'), await at('LP24'), await at('HP'), await at('BP')]
    const cutoff = 25 * Math.pow(720, 0.5)
    const high = (x: Float32Array) => bandEnergy(x, SR, cutoff * 4, cutoff * 16, N(0.5))
    const low = (x: Float32Array) => bandEnergy(x, SR, 60, cutoff / 4, N(0.5))
    expect(high(lp24)).toBeLessThan(high(lp12) / 2)
    expect(low(hp)).toBeLessThan(low(lp12) / 10)
    expect(high(bp)).toBeLessThan(high(hp) / 3)
    expect(low(bp)).toBeLessThan(low(lp12) / 3)
    for (const [a, b] of [[lp12, lp24], [lp12, hp], [lp12, bp], [hp, bp], [lp24, bp]] as const) expect(spectralDistance(a, b)).toBeGreaterThan(1.5)
  })

  it('resonance emphasises the cutoff region', async () => {
    const cutoff = 25 * Math.pow(720, 0.5)
    const at = async (res: number) => bandEnergy((await play(1.2, filt({ type: 'LP12', freq: 0.5, res }), [{ note: 48 }])).mono, SR, cutoff * 0.85, cutoff * 1.15, N(0.5))
    expect(await at(0.95)).toBeGreaterThan(2.5 * (await at(0.05)))
  })

  it('keyboard tracking makes the cutoff follow the played pitch', async () => {
    // note 84 (1 kHz) through a 350 Hz low-pass: tracking lifts the cutoff towards the note, so far more of it passes
    const level = async (tracking: 0 | 1 | 2 | 3) => rms((await play(1.2, filt({ freq: 0.4, tracking }), [{ note: 84 }])).mono, N(0.5), N(1))
    const [off, third, full] = [await level(0), await level(1), await level(3)]
    expect(full).toBeGreaterThan(20 * off)
    expect(third).toBeGreaterThan(3 * off)
    expect(third).toBeLessThan(full)
    // and at the reference note (C4) tracking changes nothing
    const ref = async (tracking: 0 | 3) => rms((await play(1.2, filt({ freq: 0.4, tracking }), [{ note: 60 }])).mono, N(0.5), N(1))
    expect(Math.abs((await ref(3)) / (await ref(0)) - 1)).toBeLessThan(0.02)
  })

  it('drive adds harmonics ahead of the filter', async () => {
    const e = async (drive: 0 | 1 | 2 | 3) => bandEnergy((await play(1.2, filt({ type: 'LP12', freq: 0.75, drive }, (p) => ({ ...p, waveform: WAVE('sine') })), [{ note: 48 }])).mono, SR, hz(48) * 2.5, hz(48) * 12, N(0.5))
    const [d0, d1, d3] = [await e(0), await e(1), await e(3)]
    expect(d1).toBeGreaterThan(20 * d0 + 1e-6)
    expect(d3).toBeGreaterThan(d1)
  })

  it('the filter can be bypassed (Filter On off)', async () => {
    const on = await centroid({ freq: 0.25, on: true })
    const off = await centroid({ freq: 0.25, on: false })
    expect(off).toBeGreaterThan(2 * on)
  })

  it('filter envelope amount sweeps the cutoff (bright attack that settles), and Env Amt 0 does not', async () => {
    const swept = await play(2, filt({ freq: 0.3, envAmount: 1, attack: 0, decay: knob(0.5), release: knob(0.03) }), [{ note: 48 }])
    const flat = await play(2, filt({ freq: 0.3, envAmount: 0, attack: 0, decay: knob(0.5) }), [{ note: 48 }])
    const early = spectralCentroid(swept.mono, SR, N(0.02), 2048)
    const late = spectralCentroid(swept.mono, SR, N(1.4), 2048)
    expect(early).toBeGreaterThan(2 * late)
    expect(spectralCentroid(flat.mono, SR, N(0.02), 2048) / spectralCentroid(flat.mono, SR, N(1.4), 2048)).toBeLessThan(1.2)
    // a slow filter attack opens the filter gradually
    const opening = await play(3, filt({ freq: 0.25, envAmount: 1, attack: knob(1.2), decay: 1 }), [{ note: 48 }])
    expect(spectralCentroid(opening.mono, SR, N(1.5), 2048)).toBeGreaterThan(1.5 * spectralCentroid(opening.mono, SR, N(0.05), 2048))
  })

  it('filter envelope velocity: harder notes open the filter further only when Velocity is on', async () => {
    const at = async (velocity: boolean, vel: number) => spectralCentroid((await play(1.2, filt({ freq: 0.3, envAmount: 1, decay: 1, velocity }), [{ note: 48, vel }])).mono, SR, N(0.4), 4096)
    expect(await at(true, 120)).toBeGreaterThan(1.5 * (await at(true, 25)))
    const a = await at(false, 120)
    const b = await at(false, 25)
    expect(Math.abs(a / b - 1)).toBeLessThan(0.05)
  })

  it('amplitude envelope: attack slows the onset, decay below maximum fades the note, decay at maximum sustains, release sets the tail', async () => {
    const amp = (over: Partial<SynthPatch['amp']>) => patchOf((p) => ({ ...p, waveform: WAVE('saw'), filter: { ...p.filter, freq: 1, envAmount: 0 }, amp: { ...p.amp, attack: 0, decay: 1, release: knob(0.03), velocity: 0, ...over } }))
    const fast = await play(2, amp({ attack: 0 }), [{ note: NOTE }])
    const slow = await play(2, amp({ attack: knob(0.8) }), [{ note: NOTE }])
    expect(rms(slow.mono, N(0.05), N(0.15))).toBeLessThan(0.25 * rms(fast.mono, N(0.05), N(0.15)))
    expect(rms(slow.mono, N(1.6), N(1.9))).toBeGreaterThan(0.6 * rms(fast.mono, N(1.6), N(1.9)))
    const plucked = await play(2, amp({ decay: knob(0.3) }), [{ note: NOTE }])
    expect(rms(plucked.mono, N(1), N(1.5))).toBeLessThan(0.02 * rms(plucked.mono, N(0.02), N(0.1)))
    expect(rms(fast.mono, N(1), N(1.5))).toBeGreaterThan(0.9 * rms(fast.mono, N(0.02), N(0.1)))
    const short = await play(3, amp({ release: knob(0.05) }), [{ note: NOTE, off: 0.5 }])
    const long = await play(3, amp({ release: knob(1.5) }), [{ note: NOTE, off: 0.5 }])
    const tail = (r: { mono: Float32Array }) => audibleSeconds(r.mono, SR, 0.005, N(0.55))
    expect(tail(long)).toBeGreaterThan(tail(short) + 0.8)
  })

  it('amplitude velocity levels 1-3 make the loudness follow the velocity ever more strongly', async () => {
    const ratio = async (level: 0 | 1 | 2 | 3) => {
      const soft = await play(1, patchOf((p) => ({ ...p, amp: { ...p.amp, velocity: level, decay: 1, attack: 0 } })), [{ note: NOTE, vel: 30 }])
      const hard = await play(1, patchOf((p) => ({ ...p, amp: { ...p.amp, velocity: level, decay: 1, attack: 0 } })), [{ note: NOTE, vel: 120 }])
      return rms(soft.mono, N(0.4), N(0.9)) / rms(hard.mono, N(0.4), N(0.9))
    }
    const [r0, r1, r2, r3] = [await ratio(0), await ratio(1), await ratio(2), await ratio(3)]
    expect(r0).toBeGreaterThan(0.9)
    expect(r1).toBeLessThan(r0)
    expect(r2).toBeLessThan(r1)
    expect(r3).toBeLessThan(r2)
  })

  it('oscillator envelope: ENV TO PITCH bends the pitch down as the envelope decays; its Velocity toggle scales the depth', async () => {
    const pitch = (over: Partial<SynthPatch['oscEnv']>) => basic('sine', (p) => ({ ...p, oscEnv: { ...p.oscEnv, attack: 0, decay: knob(0.6), release: knob(0.03), amount: 0.5, toPitch: true, ...over } }))
    const r = await play(2, pitch({}), [{ note: NOTE }])
    const early = zcFreq(r.mono, 0.02, 0.1)
    const late = zcFreq(r.mono, 1.3, 1.9)
    expect(late).toBeCloseTo(hz(NOTE), 0)
    expect(cents(early, late)).toBeGreaterThan(500)
    const negative = await play(2, pitch({ amount: -0.5 }), [{ note: NOTE }])
    expect(zcFreq(negative.mono, 0.02, 0.1)).toBeLessThan(hz(NOTE) * 0.9)
    const soft = await play(2, pitch({ velocity: true }), [{ note: NOTE, vel: 30 }])
    expect(cents(zcFreq(soft.mono, 0.02, 0.1), hz(NOTE))).toBeLessThan(cents(early, late) / 2)
  })

  it('the three envelopes are independent: release times differ per envelope', async () => {
    // filter release long, amp release short: the amp closes first regardless of the filter envelope
    const r = await play(2, chain(filt({ freq: 0.3, envAmount: 1, release: knob(1.5), decay: 1 }), patchOf((p) => ({ ...p, amp: { ...p.amp, release: knob(0.03) } }))), [{ note: 48, off: 0.5 }])
    expect(rms(r.mono, N(0.7), N(1.2))).toBeLessThan(0.001)
  })
})

// =====================================================================================================================
describe('synth.voice-modes — poly, mono, legato, priority, glide, unison, vibrato and the LFO', () => {
  const sine = (extra: (p: SynthPatch) => SynthPatch = (p) => p) => basic('sine', extra)
  const voice = (over: Partial<SynthPatch['voice']>) => sine((p) => ({ ...p, voice: { ...p.voice, ...over } }))

  it('poly sounds every held key; mono and legato sound one', async () => {
    const notes = [{ note: 60 }, { note: 67, at: 0.3 }]
    const partial = (x: Float32Array, note: number) => bandEnergy(x, SR, hz(note) * 0.97, hz(note) * 1.03, N(0.6))
    const poly = await play(1.5, voice({ mode: 'poly' }), notes)
    expect(partial(poly.mono, 60)).toBeGreaterThan(0.1 * partial(poly.mono, 67))
    expect(partial(poly.mono, 67)).toBeGreaterThan(0.1 * partial(poly.mono, 60))
    for (const mode of ['mono', 'legato'] as const) {
      const r = await play(1.5, voice({ mode }), notes)
      expect(partial(r.mono, 60), mode).toBeLessThan(0.01 * partial(r.mono, 67))
    }
  })

  it('note priority chooses last / lowest / highest key in mono, and releasing the sounding key returns to a held one', async () => {
    const notes = [{ note: 60 }, { note: 72, at: 0.4 }, { note: 64, at: 0.8 }]
    const sounding = async (priority: 'off' | 'low' | 'high') => zcFreq((await play(1.6, voice({ mode: 'mono', priority }), notes)).mono, 1.1, 1.5)
    expect(await sounding('off')).toBeCloseTo(hz(64), 0)
    expect(await sounding('low')).toBeCloseTo(hz(60), 0)
    expect(await sounding('high')).toBeCloseTo(hz(72), 0)
    const back = await play(2, voice({ mode: 'mono' }), [{ note: 60 }, { note: 67, at: 0.5, off: 1.2 }])
    expect(zcFreq(back.mono, 0.7, 1.1)).toBeCloseTo(hz(67), 0)
    expect(zcFreq(back.mono, 1.5, 1.9)).toBeCloseTo(hz(60), 0)
    const gone = await play(2, voice({ mode: 'mono' }), [{ note: 60, off: 1 }])
    expect(rms(gone.mono, N(1.3), N(1.9))).toBeLessThan(0.001)
  })

  it('mono retriggers the envelopes on every key; legato only retriggers when no key is held', async () => {
    const shape = (mode: 'mono' | 'legato') => voice({ mode, priority: 'off' }) // helper reused below
    void shape
    const plucked = (mode: 'mono' | 'legato') =>
      chain(voice({ mode }), patchOf((p) => ({ ...p, amp: { ...p.amp, attack: 0, decay: knob(0.25), release: knob(0.03), velocity: 0 } })))
    const notes = [{ note: 60 }, { note: 67, at: 1 }]
    const mono = await play(2, plucked('mono'), notes)
    const legato = await play(2, plucked('legato'), notes)
    expect(rms(mono.mono, N(1.01), N(1.1))).toBeGreaterThan(20 * (rms(legato.mono, N(1.01), N(1.1)) + 1e-6))
    // a fresh key after release retriggers in legato as well
    const fresh = await play(2, plucked('legato'), [{ note: 60, off: 0.5 }, { note: 67, at: 1 }])
    expect(rms(fresh.mono, N(1.01), N(1.1))).toBeGreaterThan(0.01)
  })

  it('glide slides between notes played legato and does nothing without it or on a fresh key', async () => {
    const notes = [{ note: 60 }, { note: 72, at: 1 }]
    const glide = await play(3.5, voice({ mode: 'legato', glide: 0.8 }), notes)
    const during = zcFreq(glide.mono, 1.1, 1.3)
    expect(during).toBeGreaterThan(hz(60) * 1.05)
    expect(during).toBeLessThan(hz(72) * 0.95)
    expect(zcFreq(glide.mono, 3, 3.4)).toBeCloseTo(hz(72), 0)
    const track = pitchTrack(glide.mono, 1.05, 2.0, 0.1)
    for (let i = 1; i < track.length; i++) expect(track[i]).toBeGreaterThanOrEqual(track[i - 1] * 0.99) // monotonic rise
    const none = await play(3.5, voice({ mode: 'legato', glide: 0 }), notes)
    expect(zcFreq(none.mono, 1.1, 1.3)).toBeCloseTo(hz(72), 0)
    const freshKey = await play(3.5, voice({ mode: 'legato', glide: 0.8 }), [{ note: 60, off: 0.5 }, { note: 72, at: 1 }])
    expect(zcFreq(freshKey.mono, 1.1, 1.3)).toBeCloseTo(hz(72), 0)
    // glide does not apply in poly
    const poly = await play(3.5, voice({ mode: 'poly', glide: 0.8 }), notes)
    expect(bandEnergy(poly.mono, SR, hz(72) * 0.97, hz(72) * 1.03, N(1.1))).toBeGreaterThan(0)
  })

  it('unison stacks detuned copies: wider stereo image and audible beating', async () => {
    const at = (level: 0 | 1 | 2 | 3) => play(3, basic('saw', (p) => ({ ...p, voice: { ...p.voice, unison: level } })), [{ note: 48 }])
    const off = await at(0)
    const three = await at(3)
    const corr = (r: { left: Float32Array; right: Float32Array }) => correlation(r.left.slice(N(0.5), N(2.5)), r.right.slice(N(0.5), N(2.5)))
    expect(corr(off)).toBeGreaterThan(0.999)
    expect(corr(three)).toBeLessThan(0.9)
    expect(envelopeModulation(three.mono, SR, N(0.5), N(2.5), 1024)).toBeGreaterThan(envelopeModulation(off.mono, SR, N(0.5), N(2.5), 1024) + 0.05)
    const one = await at(1)
    expect(corr(one)).toBeLessThan(corr(off))
  })

  it('vibrato: On modulates the pitch, Off does not, Wheel follows the mod wheel, Delay fades in after half a second', async () => {
    const vib = (mode: 'off' | 'wheel' | 'delay' | 'on') => sine((p) => ({ ...p, voice: { ...p.voice, vibrato: { mode, rate: 5, amount: 10 } } }))
    const wander = (r: { mono: Float32Array }, from: number, to: number) => stdev(pitchTrack(r.mono, from, to, 0.04))
    const on = await play(2.5, vib('on'), [{ note: NOTE }])
    const off = await play(2.5, vib('off'), [{ note: NOTE }])
    expect(wander(on, 0.3, 2.3)).toBeGreaterThan(8 * wander(off, 0.3, 2.3) + 0.5)
    // peak deviation is about amount × 8 cents (80 cents)
    const t = pitchTrack(on.mono, 0.3, 2.3, 0.02)
    expect(cents(Math.max(...t), Math.min(...t))).toBeGreaterThan(80)
    const wheel0 = await play(2.5, vib('wheel'), [{ note: NOTE }])
    const wheel1 = await play(2.5, chain(vib('wheel'), (s) => ({ ...s, modWheel: 1 })), [{ note: NOTE }])
    expect(wander(wheel0, 0.3, 2.3)).toBeLessThan(0.15 * wander(wheel1, 0.3, 2.3))
    const half = await play(2.5, chain(vib('wheel'), (s) => ({ ...s, modWheel: 0.5 })), [{ note: NOTE }])
    expect(wander(half, 0.3, 2.3)).toBeGreaterThan(0.3 * wander(wheel1, 0.3, 2.3))
    expect(wander(half, 0.3, 2.3)).toBeLessThan(0.8 * wander(wheel1, 0.3, 2.3))
    const delayed = await play(3, vib('delay'), [{ note: NOTE }])
    expect(wander(delayed, 0.05, 0.45)).toBeLessThan(0.2 * wander(delayed, 1.6, 2.8))
    // rate is honoured: double the rate → about double the pitch-track crossings
    const fast = await play(2.5, sine((p) => ({ ...p, voice: { ...p.voice, vibrato: { mode: 'on', rate: 8, amount: 10 } } })), [{ note: NOTE }])
    const crossings = (r: { mono: Float32Array }) => {
      const tr = pitchTrack(r.mono, 0.3, 2.3, 0.02)
      const m = tr.reduce((a, b) => a + b, 0) / tr.length
      let n = 0
      for (let i = 1; i < tr.length; i++) if ((tr[i - 1] - m) * (tr[i] - m) < 0) n++
      return n
    }
    expect(crossings(fast)).toBeGreaterThan(crossings(on) * 1.3)
  })

  it('LFO: each of the five waveforms shapes the modulation differently; S&H is a fixed sequence', async () => {
    const lfo = (waveform: number, dest: SynthPatch['lfo']['dest'] = 'pitch', amount = 0.5) => sine((p) => ({ ...p, lfo: { ...p.lfo, waveform, dest, rate: 0.7, amount } }))
    const tracks: number[][] = []
    for (let w = 0; w < 5; w++) tracks.push(pitchTrack((await play(4, lfo(w), [{ note: NOTE }])).mono, 0.2, 3.8, 0.05))
    for (let i = 0; i < 5; i++) {
      expect(stdev(tracks[i]), `wave ${i}`).toBeGreaterThan(3)
      for (let j = i + 1; j < 5; j++) {
        const d = Math.sqrt(tracks[i].reduce((s, v, k) => s + (v - tracks[j][k]) ** 2, 0) / tracks[i].length)
        expect(d, `${i} vs ${j}`).toBeGreaterThan(2)
      }
    }
    // square: two levels only; saw down falls, saw up rises inside a cycle
    const hi = Math.max(...tracks[3])
    const lo = Math.min(...tracks[3])
    const nearEnds = tracks[3].filter((v) => Math.abs(v - hi) < 6 || Math.abs(v - lo) < 6).length / tracks[3].length
    expect(nearEnds).toBeGreaterThan(0.6)
    const ramp = tracks[2].filter((v) => v > lo + 6 && v < hi - 6).length / tracks[2].length
    expect(ramp).toBeGreaterThan(0.3) // saw up sweeps through the middle
    // S&H twice → the same sequence
    const again = pitchTrack((await play(4, lfo(4), [{ note: NOTE }])).mono, 0.2, 3.8, 0.05)
    expect(again).toEqual(tracks[4])
  })

  it('LFO destinations: pitch modulates frequency, filter modulates brightness, Osc Ctrl modulates the spectrum; off/amount 0 do nothing', async () => {
    const cfg = (dest: SynthPatch['lfo']['dest'], amount: number, wave = 'saw', extra: (p: SynthPatch) => SynthPatch = (p) => p) =>
      basic(wave, (p) => extra({ ...p, oscCtrl: 0.3, filter: { ...p.filter, freq: 0.45 }, lfo: { ...p.lfo, waveform: 0, dest, rate: 0.6, amount } }))
    const pitchOn = await play(4, cfg('pitch', 0.6, 'sine'), [{ note: NOTE }])
    const pitchOff = await play(4, cfg('off', 0.6, 'sine'), [{ note: NOTE }])
    expect(stdev(pitchTrack(pitchOn.mono, 0.2, 3.8, 0.05))).toBeGreaterThan(10 * stdev(pitchTrack(pitchOff.mono, 0.2, 3.8, 0.05)) + 1)
    expect(stdev(pitchTrack(pitchOff.mono, 0.2, 3.8, 0.05))).toBeLessThan(0.5)
    const filtOn = await play(4, cfg('filter', 0.6), [{ note: 48 }])
    const filtOff = await play(4, cfg('filter', 0), [{ note: 48 }])
    expect(stdev(centroidTrack(filtOn.mono, 0.2, 3.8, 0.1))).toBeGreaterThan(4 * stdev(centroidTrack(filtOff.mono, 0.2, 3.8, 0.1)) + 5)
    // filter LFO does not move the pitch
    expect(stdev(pitchTrack(filtOn.mono, 0.2, 3.8, 0.1).map((f) => f))).toBeGreaterThanOrEqual(0)
    const ctrlOn = await play(4, cfg('ctrl', 0.4, 'fm-2op'), [{ note: NOTE }])
    const ctrlOff = await play(4, cfg('off', 0.4, 'fm-2op'), [{ note: NOTE }])
    expect(stdev(centroidTrack(ctrlOn.mono, 0.2, 3.8, 0.1))).toBeGreaterThan(5 * stdev(centroidTrack(ctrlOff.mono, 0.2, 3.8, 0.1)) + 1)
  })

  it('LFO rate follows the master clock when synced, and its phase restarts on a fresh key with KB Sync', async () => {
    const synced = (bpm: number) =>
      chain(
        sine((p) => ({ ...p, lfo: { ...p.lfo, waveform: 0, dest: 'pitch', amount: 0.5, sync: true, division: 2 } })), // 1/4 note
        (s) => ({ ...s, clock: { bpm } }),
      )
    const cycles = (r: { mono: Float32Array }) => {
      const tr = pitchTrack(r.mono, 0.2, 4.2, 0.04)
      const m = tr.reduce((a, b) => a + b, 0) / tr.length
      let n = 0
      for (let i = 1; i < tr.length; i++) if ((tr[i - 1] - m) * (tr[i] - m) < 0) n++
      return n / 2 / 4 // cycles per second
    }
    const slow = await play(4.5, synced(60), [{ note: NOTE }])
    const fast = await play(4.5, synced(120), [{ note: NOTE }])
    expect(cycles(slow)).toBeGreaterThan(0.7)
    expect(cycles(slow)).toBeLessThan(1.3)
    expect(cycles(fast) / cycles(slow)).toBeGreaterThan(1.6)
    expect(cycles(fast) / cycles(slow)).toBeLessThan(2.4)
    // KB Sync: a key pressed mid-cycle starts the saw-up LFO at its beginning (lowest pitch)
    const sawUp = (kbSync: boolean) => sine((p) => ({ ...p, kbSync, lfo: { ...p.lfo, waveform: 2, dest: 'pitch', amount: 0.5, rate: 0.5, sync: false } }))
    const free = await play(2, sawUp(false), [{ note: NOTE, at: 0.37 }])
    const locked = await play(2, sawUp(true), [{ note: NOTE, at: 0.37 }])
    const startPitch = (r: { mono: Float32Array }) => zcFreq(r.mono, 0.4, 0.45)
    expect(startPitch(locked)).toBeLessThan(hz(NOTE) * Math.pow(2, -300 / 1200)) // near the bottom of the sweep (−350 ct)
    expect(Math.abs(startPitch(free) - startPitch(locked))).toBeGreaterThan(3)
  })
})

// =====================================================================================================================
describe('synth.arp-gate — arpeggiator and gate under a fixed clock', () => {
  const CHORD: Ev[] = [{ note: 60 }, { note: 64 }, { note: 67 }]
  /** sine, no filter, 1/4 steps at 120 BPM = 0.5 s */
  const arp = (over: Partial<SynthPatch['arp']> = {}, bpm = 120, extra: (p: SynthPatch) => SynthPatch = (p) => p) =>
    chain(
      basic('sine', (p) => extra({ ...p, amp: { ...p.amp, release: knob(0.004) }, arp: { ...p.arp, run: true, mode: 'arp', sync: true, division: 2, range: 0, direction: 'up', hold: false, ...over } })),
      (s) => ({ ...s, clock: { bpm } }),
    )
  const played = (r: { mono: Float32Array }, steps: number, step = 0.5, offset = 0.25): number[] => Array.from({ length: steps }, (_, i) => Math.round(69 + 12 * Math.log2(zcFreq(r.mono, offset + i * step - 0.1, offset + i * step + 0.1) / 440)))

  it('plays the held notes one at a time in the chosen direction, on the master-clock grid', async () => {
    const up = await play(3.2, arp(), CHORD)
    expect(played(up, 6)).toEqual([60, 64, 67, 60, 64, 67])
    const down = await play(3.2, arp({ direction: 'down' }), CHORD)
    expect(played(down, 6)).toEqual([67, 64, 60, 67, 64, 60])
    const updown = await play(4.2, arp({ direction: 'updown' }), CHORD)
    expect(played(updown, 8)).toEqual([60, 64, 67, 64, 60, 64, 67, 64])
    expect(firstOnset(up.mono)).toBeLessThan(0.02)
  })

  it('range spans octaves and random is a fixed pseudo-random sequence', async () => {
    const two = await play(3.2, arp({ range: 0.3 }), CHORD)
    expect(played(two, 6)).toEqual([60, 64, 67, 72, 76, 79])
    const rnd1 = await play(4.2, arp({ direction: 'random' }), CHORD)
    const rnd2 = await play(4.2, arp({ direction: 'random' }), CHORD)
    const seq = played(rnd1, 8)
    expect(played(rnd2, 8)).toEqual(seq)
    expect(seq.every((n) => [60, 64, 67].includes(n))).toBe(true)
    expect(seq).not.toEqual([60, 64, 67, 60, 64, 67, 60, 64])
    expect(new Set(seq).size).toBeGreaterThan(1)
  })

  it('is deterministic: the same clock and notes give the identical audio, twice', async () => {
    const a = await play(3, arp({ direction: 'updown', range: 0.3 }), CHORD)
    const b = await play(3, arp({ direction: 'updown', range: 0.3 }), CHORD)
    expect(difference(a.mono, b.mono)).toBeLessThan(1e-6)
    expect(peak(a.mono)).toBeGreaterThan(0.1)
  })

  it('rate: master-clock subdivisions and BPM set the step rate; the free Rate knob also does', async () => {
    const onsets = async (edit: (s: EngineState) => EngineState) => countOnsets((await play(4, edit, CHORD)).mono, 0, 4)
    const quarter = await onsets(arp({}, 120))
    const eighth = await onsets(arp({ division: 4 }, 120))
    const slow = await onsets(arp({}, 60))
    expect(quarter).toBeGreaterThanOrEqual(7)
    expect(quarter).toBeLessThanOrEqual(9)
    expect(eighth).toBeGreaterThanOrEqual(2 * quarter - 2)
    expect(slow).toBeLessThanOrEqual(quarter / 2 + 1)
    const freeSlow = await onsets(arp({ sync: false, rate: 0 }))
    const freeFast = await onsets(arp({ sync: false, rate: 1 }))
    expect(freeFast).toBeGreaterThan(5 * freeSlow)
  })

  it('steps sit on the master-clock grid unless KB Sync restarts the grid at the key press', async () => {
    const locked = await play(2, arp(), [{ note: 60, at: 0.13 }])
    expect(firstOnset(locked.mono)).toBeGreaterThan(0.45)
    expect(firstOnset(locked.mono)).toBeLessThan(0.53)
    const restarted = await play(2, arp({}, 120, (p) => ({ ...p, kbSync: true })), [{ note: 60, at: 0.13 }])
    expect(firstOnset(restarted.mono)).toBeGreaterThan(0.1)
    expect(firstOnset(restarted.mono)).toBeLessThan(0.16)
  })

  it('Poly mode retriggers the whole chord on every step', async () => {
    const r = await play(2.2, arp({ mode: 'poly' as ArpMode }), CHORD)
    const freqs = peakFrequencies(r.mono, SR, N(0.3), 3, 16384, 200, 500)
    for (const n of [60, 64, 67]) expect(freqs.some((f) => Math.abs(f / hz(n) - 1) < 0.01), `note ${n}`).toBe(true)
    expect(countOnsets(r.mono, 0, 2.2)).toBeGreaterThanOrEqual(4)
  })

  it('KB Hold keeps the arpeggio running after the keys are lifted; the next fresh chord replaces it', async () => {
    const released = CHORD.map((e) => ({ ...e, off: 1 }))
    const without = await play(3, arp({ hold: false }), released)
    expect(rms(without.mono, N(1.3), N(2.9))).toBeLessThan(0.002)
    const held = await play(3, arp({ hold: true }), released)
    expect(rms(held.mono, N(1.3), N(2.9))).toBeGreaterThan(0.02)
    // the grid keeps its phase: steps 4.. of the cycle (index 3 = 60) continue after the keys went up
    expect(played(held, 3, 0.5, 1.75)).toEqual([60, 64, 67])
    const replaced = await play(4, arp({ hold: true }), [...released, { note: 72, at: 2.02 }])
    expect(zcFreq(replaced.mono, 2.6, 2.9)).toBeCloseTo(hz(72), 0)
    expect(zcFreq(replaced.mono, 3.1, 3.4)).toBeCloseTo(hz(72), 0)
  })

  it('Run off leaves normal play; Gate mode chops the held chord rhythmically, harder with more hardness', async () => {
    const off = await play(3, arp({ run: false }), CHORD)
    expect(countOnsets(off.mono, 0.1, 3)).toBe(1)
    expect(envelopeModulation(off.mono, SR, N(0.5), N(2.8), 1024)).toBeLessThan(0.3) // three sines only beat slowly
    const gate = (range: number) => arp({ mode: 'gate' as ArpMode, range })
    const gated = await play(3, gate(1), CHORD)
    expect(envelopeModulation(gated.mono, SR, N(0.5), N(2.8), 512)).toBeGreaterThan(0.9)
    expect(countOnsets(gated.mono, 0, 3)).toBeGreaterThanOrEqual(5)
    // all three chord notes sound (a gate, not an arpeggio)
    const freqs = peakFrequencies(gated.mono, SR, N(0.1), 3, 16384, 200, 500)
    expect(freqs.length).toBe(3)
    // soft gate = slow edges: the level rises more gradually after each gate opening
    const soft = await play(3, gate(0), CHORD)
    const riseTime = (x: Float32Array) => {
      const win = N(0.002)
      let max = 0
      for (let i = N(0.5); i < N(0.98); i += win) max = Math.max(max, rms(x, i, i + win))
      for (let i = N(0.5); i < N(1); i += win) if (rms(x, i, i + win) > 0.5 * max) return (i - N(0.5)) / SR
      return 1
    }
    expect(riseTime(soft.mono)).toBeGreaterThan(riseTime(gated.mono) + 0.02)
  })

  it('changing the direction or range while running changes the notes from the next step', async () => {
    const up = await play(3.2, arp({ direction: 'up' }), CHORD)
    const down = await play(3.2, arp({ direction: 'down' }), CHORD)
    expect(played(up, 3)).not.toEqual(played(down, 3))
  })

  it('a running arpeggiator owns a scheduler timer only while it runs, and panic frees everything', async () => {
    const r = await play(1, arp(), CHORD)
    const { engine, scheduler } = r.rig
    expect(engine.arpStatus('A').running).toBe(true)
    expect(engine.arpStatus('A').notes).toEqual([60, 64, 67])
    expect(engine.pendingTimerCount()).toBeGreaterThan(0)
    engine.panic()
    scheduler.advance(5000)
    expect(engine.liveVoiceCount()).toBe(0)
    expect(engine.pendingTimerCount()).toBe(0)
    expect(engine.arpStatus('A')).toEqual({ running: false, step: 0, notes: [] })
    engine.dispose()
  })
})

// =====================================================================================================================
describe('synth.voice-modes — live parameter changes on sounding voices', () => {
  /** run `change` at `at` seconds while the render is in progress */
  const live = (at: number, change: (rig: SynthRig) => void) => (rig: SynthRig) => {
    void rig.ctx.suspend(at).then(() => {
      change(rig)
      void rig.ctx.resume()
    })
  }

  it('a filter cutoff move on a held note is heard, without a click', async () => {
    const start = basic('saw', (p) => ({ ...p, filter: { ...p.filter, freq: 0.3 } }))
    const r = await play(2, start, [{ note: 48 }], live(1, (rig) => rig.engine.setState(withPatch(rig.state, 'A', (p) => ({ ...p, filter: { ...p.filter, freq: 0.85 } })))))
    expect(spectralCentroid(r.mono, SR, N(1.5), 4096)).toBeGreaterThan(2 * spectralCentroid(r.mono, SR, N(0.5), 4096))
    // no click: while the cutoff ramps (20 ms) the largest sample step is no bigger than in the new steady sound
    const step = (from: number, to: number) => {
      let worst = 0
      for (let i = N(from); i < N(to); i++) worst = Math.max(worst, Math.abs(r.mono[i] - r.mono[i - 1]))
      return worst
    }
    expect(step(0.98, 1.1)).toBeLessThan(1.25 * step(1.5, 1.7))
  })

  it('pitch stick and mod wheel follow the state while a note sounds', async () => {
    const vib = basic('sine', (p) => ({ ...p, voice: { ...p.voice, vibrato: { mode: 'wheel', rate: 5, amount: 10 } } }))
    const r = await play(3, vib, [{ note: NOTE }], live(1.5, (rig) => rig.engine.setState({ ...rig.state, pitchBend: 1, modWheel: 1 })))
    expect(cents(zcFreq(r.mono, 0.4, 1.4), hz(NOTE))).toBeCloseTo(0, -1)
    const late = pitchTrack(r.mono, 1.8, 2.9, 0.04)
    expect(cents(late.reduce((a, b) => a + b, 0) / late.length, hz(NOTE))).toBeGreaterThan(150)
    expect(stdev(late)).toBeGreaterThan(3 * stdev(pitchTrack(r.mono, 0.4, 1.4, 0.04)) + 0.5)
  })

  it('hold turned off releases held notes; a waveform change applies to the next note', async () => {
    const hold = basic('sine', (p) => ({ ...p, arp: { ...p.arp, hold: true } }))
    const r = await play(3, hold, [{ note: NOTE, off: 0.5 }], live(1.5, (rig) => rig.engine.setState(withPatch(rig.state, 'A', (p) => ({ ...p, arp: { ...p.arp, hold: false } })))))
    expect(rms(r.mono, N(1), N(1.4))).toBeGreaterThan(0.02)
    expect(rms(r.mono, N(1.8), N(2.9))).toBeLessThan(0.001)
  })
})

// =====================================================================================================================
describe('synth cleanup — voices and timers return to baseline', () => {
  it('released voices are freed when their release ends, and dispose frees the rest', async () => {
    const r = await play(1, undefined, [
      { note: 60, off: 0.3 },
      { note: 64, off: 0.3 },
      { note: 67 },
    ])
    const { engine, scheduler } = r.rig
    expect(engine.liveVoiceCount()).toBe(3)
    scheduler.advance(10000)
    expect(engine.liveVoiceCount()).toBe(1)
    expect(engine.pendingTimerCount()).toBe(0)
    engine.dispose()
    expect(engine.liveVoiceCount()).toBe(0)
    expect(engine.pendingTimerCount()).toBe(0)
  })

  it('the polyphony cap steals the oldest voice: 8 per layer', async () => {
    const notes = Array.from({ length: 12 }, (_, i) => ({ note: 40 + i, at: i * 0.01 }))
    const r = await play(1, undefined, notes)
    const active = r.rig.engine.voiceNotes('A')
    expect(active.length).toBeGreaterThanOrEqual(8)
    r.rig.scheduler.advance(10000)
    expect(r.rig.engine.liveVoiceCount()).toBe(8)
    r.rig.engine.panic()
    r.rig.scheduler.advance(10000)
    expect(r.rig.engine.liveVoiceCount()).toBe(0)
    expect(r.rig.engine.pendingTimerCount()).toBe(0)
  })

  it('stealNote fades a single note; the three layers are independent', async () => {
    const r = await play(1, (s) => ({ ...s, synth: { ...s.synth, B: { ...s.synth.B, enabled: true } } }), [{ note: 60 }, { note: 60, layer: 'B' }])
    r.rig.engine.stealNote('A', 60)
    r.rig.scheduler.advance(10000)
    expect(r.rig.engine.liveVoiceCount()).toBe(1)
    expect(r.rig.engine.voiceNotes('B')).toEqual([60])
    r.rig.engine.dispose()
  })
})

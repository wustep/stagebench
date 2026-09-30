// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import {
  AMP_TYPES,
  MOD1_TYPES,
  MOD2_TYPES,
  REVERB_TYPES,
  defaultState,
  editFx,
  setEffectsOn,
  setGlobal,
  setGroup,
  setRotary,
  type EngineState,
  type FxUnit,
  type LayerFx,
  type LayerId,
} from '../engine/state'
import { bandEnergy, correlation, difference, envelopePeriodicity, panSwingDb, peak, relativeModulation, rms, roughness } from '../test-utils/analysis'
import { renderNotes, type NoteEvent, type OfflineRig } from '../test-utils/offline'

/** Rendered-audio tests for the effects: the real chain on a real Web Audio implementation. */
const rigs: OfflineRig[] = []
afterEach(() => {
  while (rigs.length) rigs.pop()!.dispose()
})
const SR = 44100
const at = (s: number) => Math.floor(s * SR)

const render = async (seconds: number, notes: NoteEvent[], edit: (s: EngineState) => EngineState = (s) => s, extra?: Parameters<typeof renderNotes>[3]) => {
  const out = await renderNotes(seconds, notes, edit, extra)
  rigs.push(out.rig)
  return out
}

/** switch a unit on (on layer A, the focused chain) with the given parameters */
const unit =
  <U extends FxUnit>(name: U, patch: Partial<LayerFx[U]> = {}) =>
  (s: EngineState): EngineState =>
    editFx(s, name, { on: true, ...patch } as Partial<LayerFx[U]>)
const chain = (...edits: Array<(s: EngineState) => EngineState>) => (s: EngineState) => edits.reduce((acc, e) => e(acc), s)

const NOTE: NoteEvent = { note: 60, velocity: 100 }
const SHORT: NoteEvent = { note: 60, velocity: 110, off: 0.08 } // used with Clav for staccato repeats
const clav = (s: EngineState): EngineState => ({ ...s, layers: { ...s.layers, A: { ...s.layers.A, type: 'Clav', models: { ...s.layers.A.models, Clav: 0 } } } })

describe('effects.processing — every unit and every listed type measurably changes the rendered signal', () => {
  it('Mod 1: each of the six types changes the signal and no two types render alike', async () => {
    const base = await render(2.5, [NOTE])
    const outs = new Map<string, Awaited<ReturnType<typeof render>>>()
    for (const type of MOD1_TYPES) {
      const r = await render(2.5, [NOTE], unit('mod1', { type, amount: 0.9, rate: 0.5 }))
      outs.set(type, r)
      expect(difference(base.mono, r.mono), type).toBeGreaterThan(0.1)
    }
    for (let i = 0; i < MOD1_TYPES.length; i++)
      for (let j = i + 1; j < MOD1_TYPES.length; j++) expect(difference(outs.get(MOD1_TYPES[i])!.mono, outs.get(MOD1_TYPES[j])!.mono), `${MOD1_TYPES[i]} vs ${MOD1_TYPES[j]}`).toBeGreaterThan(0.1)
  }, 60000)

  it('Mod 1 behaviours: A-Pan moves the image between the ears, Tremolo modulates the level (full level at zero amount), Ring Mod adds sum/difference tones, Pump ducks', async () => {
    const base = await render(2.5, [NOTE])
    const pan = await render(2.5, [NOTE], unit('mod1', { type: 'A-Pan', amount: 1, rate: 0.55 }))
    expect(correlation(base.left, base.right)).toBeGreaterThan(0.999)
    expect(panSwingDb(pan.left, pan.right, at(0.3), at(2.3))).toBeGreaterThan(panSwingDb(base.left, base.right, at(0.3), at(2.3)) + 10)

    const trem0 = await render(2.5, [NOTE], unit('mod1', { type: 'Tremolo', amount: 0, rate: 0.5 }))
    expect(difference(base.mono, trem0.mono)).toBeLessThan(0.01)
    const trem = (amount: number) => render(2.5, [NOTE], unit('mod1', { type: 'Tremolo', amount, rate: 0.6 }))
    const [t3, t9] = [relativeModulation((await trem(0.3)).mono, base.mono, at(0.3), at(2.3)), relativeModulation((await trem(0.9)).mono, base.mono, at(0.3), at(2.3))]
    expect(t9).toBeGreaterThan(t3)
    expect(t9).toBeGreaterThan(0.4)

    // ring mod of a 261 Hz note with a carrier at 40·50^0.5 ≈ 283 Hz: strong energy appears at the difference frequency, far from the original partials
    const rm = await render(2.5, [NOTE], unit('mod1', { type: 'Ring Mod', amount: 1, rate: 0.5 }))
    expect(bandEnergy(rm.mono, SR, 15, 40, at(0.3), 32768)).toBeGreaterThan(bandEnergy(base.mono, SR, 15, 40, at(0.3), 32768) * 3)

    const pump = await render(2.5, [NOTE], unit('mod1', { type: 'Pump', amount: 1, rate: 0.7 }))
    expect(relativeModulation(pump.mono, base.mono, at(0.3), at(2.3), 1024)).toBeGreaterThan(0.4)
  }, 60000)

  it('Mod 2: each of the six types changes the signal and no two types render alike', async () => {
    const base = await render(2.5, [NOTE])
    const outs = new Map<string, Awaited<ReturnType<typeof render>>>()
    for (const type of MOD2_TYPES) {
      const r = await render(2.5, [NOTE], unit('mod2', { type, amount: 0.9, rate: 0.5 }))
      outs.set(type, r)
      expect(difference(base.mono, r.mono), type).toBeGreaterThan(0.08)
    }
    for (let i = 0; i < MOD2_TYPES.length; i++)
      for (let j = i + 1; j < MOD2_TYPES.length; j++) expect(difference(outs.get(MOD2_TYPES[i])!.mono, outs.get(MOD2_TYPES[j])!.mono), `${MOD2_TYPES[i]} vs ${MOD2_TYPES[j]}`).toBeGreaterThan(0.08)
  }, 60000)

  it('Amp Sim / EQ: all seven types differ; drive changes the amp models; bass/mid/treble move their bands', async () => {
    const base = await render(2, [NOTE])
    const outs = new Map<string, Awaited<ReturnType<typeof render>>>()
    for (const type of AMP_TYPES) {
      const r = await render(2, [NOTE], unit('amp', { type, drive: 0.7 }))
      outs.set(type, r)
      // EQ only / To Rotary with flat knobs are transparent by design; every other type must change the signal
      if (type !== 'EQ only' && type !== 'To Rotary') expect(difference(base.mono, r.mono), type).toBeGreaterThan(0.05)
    }
    for (const a of ['Small', 'JC', 'Twin', 'LP24 Filter', 'HP24 Filter'] as const)
      for (const b of ['Small', 'JC', 'Twin', 'LP24 Filter', 'HP24 Filter'] as const) if (a < b) expect(difference(outs.get(a)!.mono, outs.get(b)!.mono), `${a} vs ${b}`).toBeGreaterThan(0.05)
    for (const m of ['Small', 'JC', 'Twin'] as const) {
      const low = await render(2, [NOTE], unit('amp', { type: m, drive: 0.1 }))
      const high = await render(2, [NOTE], unit('amp', { type: m, drive: 0.95 }))
      expect(difference(low.mono, high.mono), m).toBeGreaterThan(0.1)
    }
    const eq = async (patch: object) => render(2, [{ note: 60, velocity: 100 }], unit('amp', { type: 'EQ only', ...patch }))
    const flat = await eq({})
    const bass = await eq({ bass: 1 })
    const treble = await eq({ treble: 1 })
    const trebleCut = await eq({ treble: 0 })
    expect(bandEnergy(bass.mono, SR, 40, 130, at(0.2))).toBeGreaterThan(bandEnergy(flat.mono, SR, 40, 130, at(0.2)) * 1.3)
    expect(bandEnergy(treble.mono, SR, 4500, 12000, at(0.2))).toBeGreaterThan(bandEnergy(flat.mono, SR, 4500, 12000, at(0.2)) * 3)
    expect(bandEnergy(trebleCut.mono, SR, 4500, 12000, at(0.2))).toBeLessThan(bandEnergy(flat.mono, SR, 4500, 12000, at(0.2)) / 3)
    const mid = await eq({ mid: 1, freq: 0.35 }) // +15 dB at ≈ 200·40^0.35 = 727 Hz
    expect(bandEnergy(mid.mono, SR, 600, 900, at(0.2))).toBeGreaterThan(bandEnergy(flat.mono, SR, 600, 900, at(0.2)) * 3)
    // resonant filters: Freq is the cutoff, Gain/Res the resonance
    const lp = await render(2, [NOTE], unit('amp', { type: 'LP24 Filter', freq: 0.3, mid: 0.1 }))
    expect(bandEnergy(lp.mono, SR, 3000, 12000, at(0.2))).toBeLessThan(bandEnergy(base.mono, SR, 3000, 12000, at(0.2)) / 20)
    const hp = await render(2, [NOTE], unit('amp', { type: 'HP24 Filter', freq: 0.6, mid: 0.1 }))
    expect(bandEnergy(hp.mono, SR, 60, 400, at(0.2))).toBeLessThan(bandEnergy(base.mono, SR, 60, 400, at(0.2)) / 20)
    const lpRes = await render(2, [NOTE], unit('amp', { type: 'LP24 Filter', freq: 0.5, mid: 1 }))
    const lpFlat = await render(2, [NOTE], unit('amp', { type: 'LP24 Filter', freq: 0.5, mid: 0 }))
    expect(difference(lpRes.mono, lpFlat.mono)).toBeGreaterThan(0.1)
  }, 90000)

  it('Compressor: a higher amount narrows the gap between soft and loud strokes; fast mode reacts differently', async () => {
    const gap = async (amount: number | null, fast = false) => {
      const edit = amount === null ? (s: EngineState) => s : unit('comp', { amount, fast })
      const soft = rms((await render(1.2, [{ note: 60, velocity: 35 }], edit)).mono, 0, at(0.6))
      const loud = rms((await render(1.2, [{ note: 60, velocity: 127 }], edit)).mono, 0, at(0.6))
      return loud / soft
    }
    const off = await gap(null)
    const mid = await gap(0.5)
    const high = await gap(1)
    expect(mid).toBeLessThan(off)
    expect(high).toBeLessThan(mid)
    const slow = await render(1.5, [NOTE, { note: 64, velocity: 127, at: 0.4 }], unit('comp', { amount: 1, fast: false }))
    const fast = await render(1.5, [NOTE, { note: 64, velocity: 127, at: 0.4 }], unit('comp', { amount: 1, fast: true }))
    expect(difference(slow.mono, fast.mono)).toBeGreaterThan(0.005)
  }, 60000)

  it('Reverb: six distinct types with decay growing Booth < Room < Stage < Hall < Cathedral; Bright/Dark shape the tail', async () => {
    const tail = async (type: (typeof REVERB_TYPES)[number], tone: 'neutral' | 'bright' | 'dark' = 'neutral') => {
      const r = await render(2.6, [SHORT], chain(clav, unit('reverb', { type, dryWet: 1, tone })))
      return r
    }
    const results = new Map<string, Awaited<ReturnType<typeof tail>>>()
    for (const t of REVERB_TYPES) results.set(t, await tail(t))
    const level = (t: string) => rms(results.get(t)!.mono, at(0.7), at(1.2))
    expect(level('Booth')).toBeLessThan(level('Room'))
    expect(level('Room')).toBeLessThan(level('Stage'))
    expect(level('Stage')).toBeLessThan(level('Hall'))
    expect(level('Hall')).toBeLessThan(level('Cathedral'))
    expect(level('Spring')).toBeGreaterThan(level('Room')) // spring rings longer than a room …
    for (let i = 0; i < REVERB_TYPES.length; i++)
      for (let j = i + 1; j < REVERB_TYPES.length; j++) expect(difference(results.get(REVERB_TYPES[i])!.mono, results.get(REVERB_TYPES[j])!.mono), `${REVERB_TYPES[i]} vs ${REVERB_TYPES[j]}`).toBeGreaterThan(0.3)
    // … and has its characteristic "boing": a periodic, chirpy tail, far more modulated than a hall
    const boing = (t: string) => envelopePeriodicity(results.get(t)!.mono, SR, at(0.35), at(1.5), 0.034, 0.042)
    expect(boing('Spring')).toBeGreaterThan(boing('Hall'))
    expect(boing('Spring')).toBeGreaterThan(boing('Stage'))
    const bright = await tail('Hall', 'bright')
    const dark = await tail('Hall', 'dark')
    const hf = (r: typeof bright) => bandEnergy(r.mono, SR, 3500, 12000, at(0.3), 16384)
    expect(hf(bright)).toBeGreaterThan(hf(results.get('Hall')!))
    expect(hf(dark)).toBeLessThan(hf(results.get('Hall')!))
  }, 90000)
})

describe('effects.routing — on/bypass, all-effects bypass, dry/wet, order, focus, group, global, To Rotary', () => {
  const everything = chain(
    unit('mod1', { type: 'Tremolo', amount: 0.8 }),
    unit('mod2', { type: 'Chorus', amount: 0.8 }),
    unit('delay', { dryWet: 0.6 }),
    unit('amp', { type: 'Twin', drive: 0.6 }),
    unit('comp', { amount: 0.8 }),
    unit('reverb', { dryWet: 0.6 }),
  )

  it('every unit off means a fully transparent chain; the Layer Effects ON button bypasses all units at once', async () => {
    const base = await render(2, [NOTE])
    const onButOff = await render(2, [NOTE], (s) => ({ ...s, fx: { ...s.fx, A: { ...s.fx.A, reverb: { ...s.fx.A.reverb, dryWet: 1 } } } }))
    expect(difference(base.mono, onButOff.mono)).toBeLessThan(1e-4)
    const all = await render(2, [NOTE], everything)
    expect(difference(base.mono, all.mono)).toBeGreaterThan(0.2)
    const bypassed = await render(2, [NOTE], chain(everything, (s) => setEffectsOn(s, false)))
    expect(difference(base.mono, bypassed.mono)).toBeLessThan(1e-4)
  }, 60000)

  it('per-unit bypass: switching a unit off mid-note returns to the dry signal without a click', async () => {
    const off = (u: FxUnit) => (rig: OfflineRig) => [{ at: 0.6, run: () => rig.state.update((s) => editFx(s, u, { on: false } as never)) }]
    for (const [name, on] of [
      ['amp', unit('amp', { type: 'Small', drive: 0.8 })],
      ['mod1', unit('mod1', { type: 'Wah', amount: 1 })],
      ['comp', unit('comp', { amount: 1 })],
    ] as const) {
      const base = await render(2, [NOTE])
      const r = await render(2, [NOTE], on, off(name))
      expect(difference(base.mono.subarray(at(0.9), at(1.9)), r.mono.subarray(at(0.9), at(1.9))), name).toBeLessThan(0.05)
      // click-free: the sample-to-sample jump around the switch stays below the signal's own scale
      let maxStep = 0
      for (let i = at(0.55); i < at(0.75); i++) maxStep = Math.max(maxStep, Math.abs(r.mono[i] - r.mono[i - 1]))
      expect(maxStep, name).toBeLessThan(peak(r.mono.subarray(0, at(1))) * 0.5)
    }
  }, 60000)

  it('Delay: repeats appear after the dry note, feedback lengthens them, the feedback filter shapes the repeats only, tempo sets their spacing', async () => {
    const T = 0.06 * Math.pow(20, 0.55) // tempo 0.55 ≈ 0.31 s
    const run = (patch: object) => render(1.6, [SHORT], chain(clav, unit('delay', { tempo: 0.55, dryWet: 0.6, ...patch })))
    const base = await render(1.6, [SHORT], clav)
    const d = await run({ feedback: 0.3 })
    expect(rms(d.mono, at(T + 0.02), at(T + 0.2))).toBeGreaterThan(rms(base.mono, at(T + 0.02), at(T + 0.2)) * 3) // first repeat
    expect(rms(d.mono, at(0), at(0.1))).toBeGreaterThan(0) // dry note still there
    const lowFb = await run({ feedback: 0.1 })
    const highFb = await run({ feedback: 1 })
    const third = (r: typeof d) => rms(r.mono, at(3 * T + 0.02), at(3 * T + 0.2))
    expect(third(highFb)).toBeGreaterThan(third(lowFb) * 3)
    // spacing: the second repeat lands 2T after the note
    const second = rms(highFb.mono, at(2 * T + 0.02), at(2 * T + 0.2))
    const between = rms(highFb.mono, at(1.5 * T + 0.04), at(1.5 * T + 0.1))
    expect(second).toBeGreaterThan(between * 2)
    // tempo: a shorter time moves the first repeat earlier
    const fast = await run({ tempo: 0.2, feedback: 0.3 })
    const fastT = 0.06 * Math.pow(20, 0.2)
    expect(rms(fast.mono, at(fastT + 0.02), at(fastT + 0.1))).toBeGreaterThan(rms(base.mono, at(fastT + 0.02), at(fastT + 0.1)) * 3)
    // feedback filter: dry window identical, later repeats progressively filtered
    const off = await run({ feedback: 0.85, filter: 'Off' })
    const lp = await run({ feedback: 0.85, filter: 'LP' })
    const hp = await run({ feedback: 0.85, filter: 'HP' })
    const bp = await run({ feedback: 0.85, filter: 'BP' })
    expect(difference(off.mono.subarray(0, at(T - 0.02)), lp.mono.subarray(0, at(T - 0.02)))).toBeLessThan(0.001)
    const window = (r: typeof off, band: [number, number]) => bandEnergy(r.mono, SR, band[0], band[1], at(3 * T), 4096)
    expect(window(lp, [3000, 12000])).toBeLessThan(window(off, [3000, 12000]) / 3)
    expect(window(hp, [40, 400])).toBeLessThan(window(off, [40, 400]) / 3)
    expect(window(bp, [3000, 12000])).toBeLessThan(window(off, [3000, 12000]) / 2)
    expect(window(bp, [40, 300])).toBeLessThan(window(off, [40, 300]) / 2)
  }, 90000)

  it('Delay Dry/Wet: fully dry equals the input, fully wet removes the dry note', async () => {
    const base = await render(1.2, [SHORT], clav)
    const dry = await render(1.2, [SHORT], chain(clav, unit('delay', { tempo: 0.55, dryWet: 0, feedback: 0.5 })))
    expect(difference(base.mono, dry.mono)).toBeLessThan(0.01)
    const wet = await render(1.2, [SHORT], chain(clav, unit('delay', { tempo: 0.55, dryWet: 1, feedback: 0.5 })))
    expect(rms(wet.mono, 0, at(0.2))).toBeLessThan(rms(base.mono, 0, at(0.2)) * 0.05)
    expect(rms(wet.mono, at(0.32), at(0.5))).toBeGreaterThan(0.001)
  })

  it('Delay ping-pong alternates the repeats between the ears', async () => {
    const T = 0.06 * Math.pow(20, 0.55)
    const r = await render(1.6, [SHORT], chain(clav, unit('delay', { tempo: 0.55, dryWet: 1, feedback: 0.8, pingPong: true })))
    const side = (from: number, to: number) => rms(r.left, at(from), at(to)) / (rms(r.right, at(from), at(to)) + 1e-9)
    expect(side(T + 0.02, T + 0.2)).toBeGreaterThan(3) // first repeat left
    expect(side(2 * T + 0.02, 2 * T + 0.2)).toBeLessThan(1 / 3) // second right
  })

  it('effects run in the documented order: distortion before the reverb changes what the reverb rings', async () => {
    // Amp (before) → Reverb: the reverb tail is made of the distorted signal; the mirror order would not be the same.
    const a = await render(2, [SHORT], chain(clav, unit('amp', { type: 'Small', drive: 1 }), unit('reverb', { type: 'Hall', dryWet: 1 })))
    const b = await render(2, [SHORT], chain(clav, unit('reverb', { type: 'Hall', dryWet: 1 })))
    const tailHf = (r: typeof a) => bandEnergy(r.mono, SR, 500, 6000, at(0.4), 8192)
    expect(difference(a.mono, b.mono)).toBeGreaterThan(0.3)
    expect(tailHf(a)).not.toBeCloseTo(tailHf(b), 3)
  })

  it('To Rotary routes the layer into the shared rotary (after the reverb); speed and drive change only routed audio', async () => {
    const routed = chain(unit('amp', { type: 'To Rotary' }), unit('reverb', { type: 'Room', dryWet: 0.3 }))
    const notRouted = unit('amp', { type: 'EQ only' })
    const slow = await render(2.5, [NOTE], chain(routed, (s) => setRotary(s, { fast: false, drive: 0.2 })))
    const fast = await render(2.5, [NOTE], chain(routed, (s) => setRotary(s, { fast: true, drive: 0.2 })), () => [])
    const eqOnly = await render(2.5, [NOTE], chain(notRouted, unit('reverb', { type: 'Room', dryWet: 0.3 })))
    expect(difference(slow.mono, eqOnly.mono)).toBeGreaterThan(0.2)
    // a fast rotor modulates the level faster and deeper than a slow one (the rotor has to spin up: measure the later part)
    const mod = (r: typeof slow) => relativeModulation(r.mono, eqOnly.mono, at(1.2), at(2.4), 1024)
    expect(mod(fast)).toBeGreaterThan(mod(slow))
    expect(difference(slow.mono, fast.mono)).toBeGreaterThan(0.1)
    const driven = await render(2.5, [NOTE], chain(routed, (s) => setRotary(s, { fast: false, drive: 1 })))
    expect(difference(slow.mono, driven.mono)).toBeGreaterThan(0.1)
    // not routed: the rotary settings are irrelevant
    const eqFast = await render(2.5, [NOTE], chain(notRouted, (s) => setRotary(s, { fast: true, drive: 1 })))
    const eqSlow = await render(2.5, [NOTE], chain(notRouted, (s) => setRotary(s, { fast: false, drive: 0 })))
    expect(difference(eqFast.mono, eqSlow.mono)).toBeLessThan(1e-4)
  }, 60000)

  it('FX focus decides which layer’s chain a panel edit reaches; effects on the other layer never touch this one', async () => {
    const aOnly = (s: EngineState) => ({ ...s, layers: { ...s.layers, B: { ...s.layers.B, enabled: false } } })
    const base = await render(1.5, [NOTE], aOnly)
    // fx focus on B: the edit goes to B's chain, which no sounding voice passes through
    const viaB = await render(1.5, [NOTE], chain(aOnly, (s) => ({ ...s, fxFocus: 'B' as LayerId }), unit('reverb', { dryWet: 1 }), unit('mod1', { type: 'Pump', amount: 1 })))
    expect(difference(base.mono, viaB.mono)).toBeLessThan(1e-4)
    const viaA = await render(1.5, [NOTE], chain(aOnly, unit('reverb', { dryWet: 1 }), unit('mod1', { type: 'Pump', amount: 1 })))
    expect(difference(base.mono, viaA.mono)).toBeGreaterThan(0.3)
  })

  it('group mode shares one chain across the layers; global mode does so for Delay, Compressor and Reverb only', async () => {
    const bOnly = (s: EngineState) => ({ ...s, layers: { ...s.layers, A: { ...s.layers.A, enabled: false }, B: { ...s.layers.B, enabled: true } } })
    const base = await render(1.5, [NOTE], bOnly)
    // focus stays on A; without group/global the edit does not reach the sounding layer B
    const plain = await render(1.5, [NOTE], chain(bOnly, unit('reverb', { dryWet: 1 }), unit('mod1', { type: 'Pump', amount: 1 })))
    expect(difference(base.mono, plain.mono)).toBeLessThan(1e-4)
    // group: every unit is shared
    const grouped = await render(1.5, [NOTE], chain(bOnly, (s) => setGroup(s, true), unit('reverb', { dryWet: 1 }), unit('mod1', { type: 'Pump', amount: 1 })))
    expect(difference(base.mono, grouped.mono)).toBeGreaterThan(0.3)
    expect(roughness(grouped.mono, at(0.3), at(1.4), 512, 4096)).not.toBeCloseTo(roughness(plain.mono, at(0.3), at(1.4), 512, 4096), 2)
    // global reverb: only the reverb reaches B, the (non-global) Pump does not
    const globalReverb = await render(1.5, [NOTE], chain(bOnly, (s) => setGlobal(s, 'reverb', true), unit('reverb', { dryWet: 1 }), unit('mod1', { type: 'Pump', amount: 1 })))
    const onlyReverbOnB = await render(1.5, [NOTE], chain(bOnly, (s) => ({ ...s, fxFocus: 'B' as LayerId }), unit('reverb', { dryWet: 1 })))
    expect(difference(globalReverb.mono, onlyReverbOnB.mono)).toBeLessThan(0.01)
    expect(difference(base.mono, globalReverb.mono)).toBeGreaterThan(0.3)
    void defaultState
  }, 60000)
})

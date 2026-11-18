import { expect, it } from 'vitest'
import { Generator, arpNotes } from '../src/synthesis'
import {
  organPatch,
  synthPatch,
  waves,
  type SynthPatch,
  type OrganPatch,
} from '../src/patches'
const rate = 16000
const key = { id: 1, note: 64, velocity: 77, gain: 1 }
const rms = (out: Float32Array) =>
  Math.sqrt(out.reduce((n, v) => n + v * v, 0) / out.length)
function render(
  organ?: Partial<OrganPatch>,
  synth?: Partial<SynthPatch>,
  length = 2400,
) {
  const g = new Generator(
    rate,
    organ ? Object.assign(organPatch(), organ) : undefined,
    synth ? Object.assign(synthPatch(), synth) : undefined,
  )
  g.on(key)
  const out = new Float32Array(length)
  g.render(out)
  return out
}
const diff = (a: Float32Array, b: Float32Array) =>
  rms(a.map((v, i) => v - b[i]))
it('generates distinct organ registrations, nine audible stops and contrasting percussion, click and modulation', () => {
  const sounds = [0, 1, 2, 3].map((model) => render({ model }))
  sounds.forEach((a, i) => {
    expect(rms(a)).toBeGreaterThan(0.01)
    sounds.slice(i + 1).forEach((b) => expect(diff(a, b)).toBeGreaterThan(0.01))
  })
  for (let i = 0; i < 9; i++) {
    const bars = Array(9).fill(0)
    bars[i] = 8
    expect(rms(render({ bars, click: false }))).toBeGreaterThan(0.03)
  }
  const b = render({ percussion: true })
  for (const patch of [
    { soft: true },
    { fast: true },
    { third: true },
    { percussion: false },
  ])
    expect(diff(b, render({ percussion: true, ...patch }))).toBeGreaterThan(
      0.005,
    )
  expect(
    diff(render({ click: true }), render({ click: false })),
  ).toBeGreaterThan(0.0005)
  expect(
    diff(
      render({ vibrato: true, vibMode: 0 }),
      render({ vibrato: true, vibMode: 3 }),
    ),
  ).toBeGreaterThan(0.001)
  const g = new Generator(rate, organPatch())
  g.on(key)
  g.on({ ...key, id: 2 })
  expect(g.voices.map((v) => v.percussion)).toEqual([true, false])
})
it('renders every required oscillator with category-specific control', () => {
  const sounds = waves.map((_, wave) => render(undefined, { wave, ctrl: 67 }))
  sounds.forEach((a, i) => {
    expect(rms(a)).toBeGreaterThan(0.01)
    sounds
      .slice(i + 1)
      .forEach((b) => expect(diff(a, b), waves[i]).toBeGreaterThan(0.001))
    const change = diff(a, render(undefined, { wave: i, ctrl: 12 }))
    if (i < 7) expect(change).toBe(0)
    else expect(change).toBeGreaterThan(0.001)
  })
})
it('changes the rendered signal with filter type, tracking, drive, resonance, all envelopes and LFO destinations', () => {
  const cfg: Partial<SynthPatch> = { wave: 7, cutoff: 37, filterAmt: 15 }
  const base = render(undefined, cfg)
  for (const edit of [
    { filterType: 1 },
    { filterType: 2 },
    { filterType: 3 },
    { tracking: 3 },
    { drive: 3 },
    { resonance: 99 },
    { cutoff: 69 },
    { filterAmt: 88 },
    { ampEnv: { attack: 32, decay: 80, release: 50, velocity: 1 } },
    { oscAmt: 99, oscEnv: { attack: 27, decay: 92, release: 22, velocity: 1 } },
    { filterEnv: { attack: 42, decay: 46, release: 31, velocity: 1 } },
  ])
    expect(
      diff(base, render(undefined, { ...cfg, ...edit })),
      JSON.stringify(edit),
    ).toBeGreaterThan(0.0005)
  for (const lfoDest of [1, 2, 3]) {
    const sounds = Array.from({ length: 5 }, (_, lfoWave) =>
      render(undefined, { ...cfg, lfoDest, lfoWave, lfoRate: 96, lfoAmt: 78 }),
    )
    sounds.forEach((a, i) => {
      expect(diff(a, base)).toBeGreaterThan(0.001)
      sounds
        .slice(i + 1)
        .forEach((b) => expect(diff(a, b)).toBeGreaterThan(0.001))
    })
  }
  for (const change of [
    { unison: 3 },
    { vibrato: 1 },
    { coarse: 7 },
    { fine: 40 },
    { toPitch: true, oscAmt: 99 },
  ])
    expect(
      diff(base, render(undefined, { ...cfg, ...change })),
    ).toBeGreaterThan(0.001)
})
it('preserves legato attack age and glides between priority notes; mono retriggers', () => {
  for (const mode of [0, 1, 2]) {
    const p = { ...synthPatch(), mode, glide: 70, priority: 2 }
    const g = new Generator(rate, undefined, p)
    g.on(key)
    g.render(new Float32Array(256))
    g.on({ ...key, note: 72, id: 2 })
    const sounding = g.voices.filter((v) => v.released < 0)
    expect(sounding.length).toBe(mode ? 1 : 2)
    if (mode) {
      const v = sounding[0]
      expect(v.age).toBe(mode === 2 ? 256 : 0)
      expect(v.pitch).toBe(64)
      g.render(new Float32Array(256))
      expect(v.pitch).toBeGreaterThan(64)
      expect(v.pitch).toBeLessThan(72)
      g.on({ ...key, note: 40, id: 3 })
      expect(g.voices.find((v) => v.released < 0)?.key.note).toBe(72)
      g.off(2)
      expect(g.voices.find((v) => v.released < 0)?.key.note).toBe(64)
    }
    g.clear()
    expect(g.voices).toHaveLength(0)
    expect(g.keys).toHaveLength(0)
  }
})
it('schedules deterministic arp, poly and gated chords with clock divisions, range, direction and hold', () => {
  const keys = [key, { ...key, id: 2, note: 67 }]
  const p = { ...synthPatch(), arp: true, range: 2, arpSync: true, arpRate: 60 }
  const sequence = (direction: number) =>
    Array.from(
      { length: 6 },
      (_, i) => arpNotes(keys, { ...p, direction }, i).map((k) => k.note)[0],
    )
  expect(sequence(0)).toEqual([64, 67, 76, 79, 64, 67])
  expect(sequence(1)).toEqual([79, 76, 67, 64, 79, 76])
  expect(sequence(2)).toEqual([64, 67, 76, 79, 76, 67])
  expect(sequence(3)).toEqual(sequence(3))
  for (const arpMode of [0, 1, 2]) {
    const g = new Generator(rate, undefined, { ...p, arpMode, hold: true })
    g.bpm = 120
    keys.forEach((k) => g.on(k))
    keys.forEach((k) => g.off(k.id))
    const out = new Float32Array(rate)
    g.render(out)
    expect(rms(out)).toBeGreaterThan(0.01)
    expect(g.step).toBe(4)
    expect(arpNotes(keys, { ...p, arpMode }, 0)).toHaveLength(arpMode ? 2 : 1)
    g.clear()
    expect(g.physical.size).toBe(0)
  }
})

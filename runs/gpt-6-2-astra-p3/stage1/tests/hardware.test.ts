import { expect, it } from 'vitest'
import { controls, keys, sections, groups } from '../src/hardware'
it('models each semitone of the E1–E7 hammer action with a contiguous 43-white-key footprint', () => {
  expect(keys.map((k) => k.midi)).toEqual(
    Array.from({ length: 73 }, (_, i) => 28 + i),
  )
  expect([keys[0].name, keys.at(-1)?.name]).toEqual(['E1', 'E7'])
  expect(keys.filter((k) => !k.black).map((k) => k.index)).toEqual(
    Array.from({ length: 43 }, (_, i) => i),
  )
  for (const k of keys)
    expect(k.black).toBe([1, 3, 6, 8, 10].includes(k.midi % 12))
})
it('places photo-specific hardware in the six measured bands', () => {
  expect(sections.map((s) => s.id)).toEqual([
    'performance',
    'organ',
    'piano',
    'program',
    'synth',
    'effects',
  ])
  for (const [i, s] of sections.entries()) {
    expect(s.width / 1730).toBeCloseTo(
      [0.14, 0.2, 0.085, 0.125, 0.25, 0.2][i],
      2,
    )
    for (const c of controls.filter((c) => c.section === s.id))
      expect(c.x).toBeGreaterThanOrEqual(s.x)
  }
  expect(new Set(controls.map((c) => c.id)).size).toBe(controls.length)
  expect(controls.filter((c) => c.kind === 'drawbar')).toHaveLength(9)
  expect(
    groups.filter((g) => g.section === 'effects').map((g) => g.title),
  ).toEqual(['MOD 1', 'MOD 2', 'AMP SIM / EQ', 'DELAY', 'COMP', 'REVERB'])
  expect(controls.filter((c) => /^Program [1-8]$/.test(c.name))).toHaveLength(8)
})

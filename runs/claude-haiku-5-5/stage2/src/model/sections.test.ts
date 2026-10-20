import { describe, expect, it } from 'vitest'
import { DECK_HEIGHT_FRACTION, KEYBED_HEIGHT_FRACTION, SECTIONS } from './sections'

describe('surface sections (visual spec)', () => {
  it('lists the six sections in order with the documented fractions', () => {
    expect(SECTIONS.map((section) => section.id)).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    expect(SECTIONS.map((section) => section.fraction)).toEqual([0.14, 0.2, 0.085, 0.125, 0.25, 0.2])
  })

  it('sums to the full instrument width within the spec rounding', () => {
    const total = SECTIONS.reduce((sum, section) => sum + section.fraction, 0)
    expect(Math.abs(total - 1)).toBeLessThanOrEqual(0.001)
  })

  it('splits the instrument 54/46 between deck and keybed', () => {
    expect(DECK_HEIGHT_FRACTION).toBe(0.54)
    expect(KEYBED_HEIGHT_FRACTION).toBe(0.46)
    expect(DECK_HEIGHT_FRACTION + KEYBED_HEIGHT_FRACTION).toBeCloseTo(1, 10)
  })

  it('gives performance and program the exposed chassis, and the others a dark inset plate', () => {
    const surfaces = Object.fromEntries(SECTIONS.map((section) => [section.id, section.surface]))
    expect(surfaces).toEqual({
      performance: 'exposed-chassis',
      organ: 'dark-inset',
      piano: 'dark-inset',
      program: 'exposed-chassis',
      synth: 'dark-inset',
      effects: 'dark-inset',
    })
  })
})

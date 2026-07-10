import { describe, expect, it } from 'vitest'
import { SECTION_LAYOUT, VERTICAL_ALLOCATION } from '../src/model/hardware'

describe('visual.section-layout', () => {
  it('defines six ordered sections with documented widths', () => {
    expect(SECTION_LAYOUT).toHaveLength(6)
    expect(SECTION_LAYOUT.map((s) => s.id)).toEqual([
      'performance',
      'organ',
      'piano',
      'program',
      'synth',
      'effects',
    ])
    expect(SECTION_LAYOUT[0].fraction).toBe(0.14)
    expect(SECTION_LAYOUT[1].fraction).toBe(0.2)
    expect(SECTION_LAYOUT[2].fraction).toBe(0.085)
    expect(SECTION_LAYOUT[3].fraction).toBe(0.125)
    expect(SECTION_LAYOUT[4].fraction).toBe(0.25)
    expect(SECTION_LAYOUT[5].fraction).toBe(0.2)
    const sum = SECTION_LAYOUT.reduce((a, s) => a + s.fraction, 0)
    expect(sum).toBeCloseTo(1, 5)
  })

  it('uses 54/46 deck/keybed split', () => {
    expect(VERTICAL_ALLOCATION.controlDeck).toBe(0.54)
    expect(VERTICAL_ALLOCATION.keybed).toBe(0.46)
    expect(VERTICAL_ALLOCATION.controlDeck + VERTICAL_ALLOCATION.keybed).toBe(1)
  })
})

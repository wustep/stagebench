import { describe, expect, it } from 'vitest'
import { SECTIONS, VARIANT } from './variant'

describe('visual.section-layout', () => {
  it('uses the photo-corrected six-section fractions and the 54/46 split', () => {
    expect(SECTIONS.map((section) => section.id)).toEqual([
      'performance',
      'organ',
      'piano',
      'program',
      'synth',
      'effects',
    ])
    expect(SECTIONS.map((section) => section.fraction)).toEqual([0.14, 0.2, 0.085, 0.125, 0.25, 0.2])
    const sum = SECTIONS.reduce((total, section) => total + section.fraction, 0)
    expect(sum).toBeCloseTo(1, 6)
    expect(VARIANT.vertical.controlDeck).toBeCloseTo(0.54, 3)
    expect(VARIANT.vertical.keybed).toBeCloseTo(0.46, 3)
    expect(VARIANT.vertical.controlDeck + VARIANT.vertical.keybed).toBeCloseTo(1, 6)
    expect(VARIANT.aspectRatio).toBeCloseTo(3.0951, 4)
    expect(SECTIONS.filter((section) => section.hasOled).map((section) => section.id)).toEqual(['program', 'synth'])
    expect(SECTIONS.find((section) => section.id === 'performance')?.insetPlate).toBe(false)
  })
})

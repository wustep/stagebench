import { describe, expect, it } from 'vitest'
import {
  DECK_FRACTION,
  DESKTOP_WIDTH_FRACTION,
  KEYBED_FRACTION,
  REFERENCE_COLORS,
  SECTION_LAYOUT,
  VERTICAL_TOLERANCE,
  sectionOffsets,
} from './layout'
import { VARIANT } from './variant'

/** Feature: visual.section-layout */
describe('deck geometry', () => {
  it('splits the chassis 54/46 between deck and keybed', () => {
    expect(DECK_FRACTION).toBe(0.54)
    expect(KEYBED_FRACTION).toBe(0.46)
    expect(DECK_FRACTION + KEYBED_FRACTION).toBeCloseTo(1, 10)
    expect(Math.abs(DECK_FRACTION - 0.54)).toBeLessThanOrEqual(VERTICAL_TOLERANCE)
  })

  it('lists the six sections in panel order', () => {
    expect(SECTION_LAYOUT.map((section) => section.id)).toEqual([
      'performance',
      'organ',
      'piano',
      'program',
      'synth',
      'effects',
    ])
  })

  it('uses the corrected v1.2.0 section fractions, which sum to exactly one deck', () => {
    const byId = Object.fromEntries(SECTION_LAYOUT.map((section) => [section.id, section.fraction]))
    expect(byId).toEqual({
      performance: 0.14,
      organ: 0.2,
      piano: 0.085,
      program: 0.125,
      synth: 0.25,
      effects: 0.2,
    })
    const total = SECTION_LAYOUT.reduce((sum, section) => sum + section.fraction, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('lays the sections out left to right with no gaps or overlaps', () => {
    const offsets = sectionOffsets()
    expect(offsets[0].left).toBe(0)
    offsets.forEach((entry, index) => {
      if (index === 0) return
      const previous = offsets[index - 1]
      expect(entry.left).toBeCloseTo(previous.left + previous.width, 10)
    })
    const last = offsets.at(-1)!
    expect(last.left + last.width).toBeCloseTo(1, 10)
  })

  it('gives Program and Synth the only primary OLEDs', () => {
    const withOled = SECTION_LAYOUT.filter((section) => section.primaryOled).map((section) => section.id)
    expect(withOled).toEqual(['program', 'synth'])
  })

  it('keeps Performance on exposed red chassis, never an inset plate', () => {
    const performance = SECTION_LAYOUT.find((section) => section.id === 'performance')
    expect(performance?.surface).toBe('red')
    expect(performance?.primaryOled).toBe(false)
  })

  it('carries the reference colour palette from the visual spec', () => {
    expect(REFERENCE_COLORS).toEqual({
      chassisMid: '#851a25',
      chassisDark: '#5a0c13',
      panelBlueGray: '#3c424d',
      keyBlack: '#0b0b0b',
      keyWhite: '#dcdcdc',
    })
  })

  it('keeps the variant silhouette at the measured aspect ratio', () => {
    expect(VARIANT.aspectRatio).toBeCloseTo(3.0951, 4)
    expect(DESKTOP_WIDTH_FRACTION.minimum).toBe(0.88)
    expect(DESKTOP_WIDTH_FRACTION.maximum).toBe(0.97)
  })
})

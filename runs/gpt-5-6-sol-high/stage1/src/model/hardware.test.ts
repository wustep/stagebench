import { describe, expect, it } from 'vitest'
import { HARDWARE_SECTIONS, KEYS } from './hardware'

describe('73-key Stage 4 hardware model', () => {
  it('models E1 through E7 as 43 white and 30 black keys', () => {
    expect(KEYS).toHaveLength(73)
    expect(KEYS.filter((key) => !key.black)).toHaveLength(43)
    expect(KEYS.filter((key) => key.black)).toHaveLength(30)
    expect(KEYS[0]).toMatchObject({ note: 'E1', midi: 28, black: false })
    expect(KEYS.at(-1)).toMatchObject({ note: 'E7', midi: 100, black: false })
  })

  it('follows the chromatic black-key pattern without black keys between E/F or B/C', () => {
    const blackPitchClasses = new Set([1, 3, 6, 8, 10])
    for (const key of KEYS) {
      expect(key.black).toBe(blackPitchClasses.has(key.midi % 12))
    }
  })
})

describe('normalized panel map', () => {
  it('contains the six measured sections in physical order', () => {
    expect(HARDWARE_SECTIONS.map((section) => section.id)).toEqual([
      'performance',
      'organ',
      'piano',
      'program',
      'synth',
      'effects',
    ])
    expect(HARDWARE_SECTIONS.map((section) => section.fraction)).toEqual([
      0.13, 0.21, 0.15, 0.09, 0.21, 0.21,
    ])
    expect(HARDWARE_SECTIONS.reduce((sum, section) => sum + section.fraction, 0)).toBeCloseTo(1)
  })

  it('has dense section-specific inventories with globally stable IDs', () => {
    const controls = HARDWARE_SECTIONS.flatMap((section) => section.controls)
    expect(controls.length).toBeGreaterThanOrEqual(80)
    expect(new Set(controls.map((control) => control.id)).size).toBe(controls.length)
    expect(HARDWARE_SECTIONS.find((section) => section.id === 'organ')?.controls.filter((control) => control.type === 'fader')).toHaveLength(9)
    expect(HARDWARE_SECTIONS.find((section) => section.id === 'program')?.controls.some((control) => control.type === 'display')).toBe(true)
    expect(HARDWARE_SECTIONS.find((section) => section.id === 'synth')?.controls.some((control) => control.type === 'knob')).toBe(true)
  })
})

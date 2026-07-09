import { describe, expect, it } from 'vitest'
import { ALL_CONTROLS, KEYS, SECTION_WIDTHS } from './hardware'

describe('Stage 4 73 hardware model', () => {
  it('models the exact E1 to E7 hammer-action keybed', () => {
    expect(KEYS).toHaveLength(73)
    expect(KEYS.filter((key) => !key.black)).toHaveLength(43)
    expect(KEYS.filter((key) => key.black)).toHaveLength(30)
    expect(KEYS[0]).toMatchObject({ midi: 28, note: 'E', octave: 1 })
    expect(KEYS.at(-1)).toMatchObject({ midi: 100, note: 'E', octave: 7 })
  })

  it('uses the corrected six-section geometry and stable unique control IDs', () => {
    expect(Object.entries(SECTION_WIDTHS)).toEqual([
      ['performance', 14], ['organ', 20], ['piano', 8.5], ['program', 12.5], ['synth', 25], ['effects', 20],
    ])
    expect(Object.values(SECTION_WIDTHS).reduce((sum, width) => sum + width, 0)).toBe(100)
    expect(new Set(ALL_CONTROLS.map((control) => control.id)).size).toBe(ALL_CONTROLS.length)
    expect(ALL_CONTROLS.length).toBeGreaterThan(120)
  })
})

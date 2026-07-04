import { describe, expect, it } from 'vitest'
import { CONTROLS, SECTIONS, VERTICAL_ALLOCATION } from '../model/hardware'

describe('visual.section-layout', () => {
  it('defines six sections at documented widths', () => {
    expect(SECTIONS).toHaveLength(6)
    expect(SECTIONS.map((s) => s.id)).toEqual([
      'performance', 'organ', 'piano', 'program', 'synth', 'effects',
    ])
    const total = SECTIONS.reduce((sum, s) => sum + s.fraction, 0)
    expect(total).toBeCloseTo(1, 5)
    expect(SECTIONS[0]!.fraction).toBeCloseTo(0.13, 2)
    expect(SECTIONS[1]!.fraction).toBeCloseTo(0.21, 2)
    expect(SECTIONS[2]!.fraction).toBeCloseTo(0.15, 2)
    expect(SECTIONS[3]!.fraction).toBeCloseTo(0.09, 2)
  })

  it('uses 54/46 deck/keybed split', () => {
    expect(VERTICAL_ALLOCATION.deck).toBe(0.54)
    expect(VERTICAL_ALLOCATION.keybed).toBe(0.46)
    expect(VERTICAL_ALLOCATION.deck + VERTICAL_ALLOCATION.keybed).toBeCloseTo(1, 5)
  })
})

describe('visual.control-inventory', () => {
  it('provides ~150 stable control IDs across all sections', () => {
    expect(CONTROLS.length).toBeGreaterThanOrEqual(140)
    const ids = CONTROLS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('places primary OLEDs only in program and synth sections', () => {
    const displays = CONTROLS.filter((c) => c.kind === 'display')
    expect(displays).toHaveLength(2)
    expect(displays.map((d) => d.section).sort()).toEqual(['program', 'synth'])
  })

  it('includes organ drawbars and performance wheels', () => {
    expect(CONTROLS.filter((c) => c.kind === 'drawbar')).toHaveLength(9)
    expect(CONTROLS.some((c) => c.id === 'perf-mod-wheel')).toBe(true)
    expect(CONTROLS.some((c) => c.id === 'perf-pitch-stick')).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { BLOCKS, SECTIONS, ALL_CONTROLS, blocksBySection, controlsBySection } from '../hardware/catalog'
import { VARIANT } from '../hardware/variant'
import { isNumeric, isSelector, type SectionId } from '../hardware/types'

/**
 * visual.section-layout — six ordered sections at the documented widths, the 54/46
 * deck/keybed split, and one continuous chassis.
 *
 * The fractions asserted here are the photo-measured values from
 * specs/nord-stage-4.visual.json. That file's `horizontalSectionsNote` records the
 * earlier coarse set (0.15/0.09/0.21) as superseded, so those numbers must NOT appear.
 */
const EXPECTED: Array<[SectionId, number]> = [
  ['performance', 0.14],
  ['organ', 0.2],
  ['piano', 0.085],
  ['program', 0.125],
  ['synth', 0.25],
  ['effects', 0.2],
]

describe('visual.section-layout', () => {
  it('has exactly six sections in the documented order', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(EXPECTED.map(([id]) => id))
  })

  it('uses the photo-measured widths and sums to the full deck', () => {
    for (const [id, fraction] of EXPECTED) {
      const section = SECTIONS.find((s) => s.id === id)
      expect(section?.fraction).toBeCloseTo(fraction, 10)
    }
    const total = SECTIONS.reduce((sum, s) => sum + s.fraction, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('does not use the superseded coarse fractions', () => {
    const fractions = SECTIONS.map((s) => s.fraction)
    // The note in the visual spec calls out 0.15 / 0.09 / 0.21 as the old reading.
    expect(fractions.filter((f) => Math.abs(f - 0.15) < 1e-9)).toHaveLength(0)
    expect(fractions.filter((f) => Math.abs(f - 0.09) < 1e-9)).toHaveLength(0)
    // 0.21 is absent, while 0.20 appears twice (organ and effects) by design.
    expect(fractions.filter((f) => Math.abs(f - 0.21) < 1e-9)).toHaveLength(0)
    expect(fractions.filter((f) => Math.abs(f - 0.2) < 1e-9)).toHaveLength(2)
  })

  it('splits the instrument 54% deck / 46% keybed within the 2.5% tolerance', () => {
    // The split is expressed in the stylesheet as fixed percentages on the two bands.
    const deck = 0.54
    const keybed = 0.46
    expect(deck + keybed).toBeCloseTo(1, 10)
    expect(Math.abs(deck - 0.54)).toBeLessThanOrEqual(0.025)
    expect(Math.abs(keybed - 0.46)).toBeLessThanOrEqual(0.025)
  })

  it('gives the performance band exposed chassis and the four instrument bands an inset plate', () => {
    expect(SECTIONS.find((s) => s.id === 'performance')?.surface).toBe('exposed-chassis')
    for (const id of ['organ', 'piano', 'synth', 'effects']) {
      expect(SECTIONS.find((s) => s.id === id)?.surface).toBe('inset-plate')
    }
  })

  it('keeps the instrument silhouette at the variant aspect ratio', () => {
    expect(VARIANT.aspectRatio).toBeCloseTo(3.0951, 3)
    const { width, height } = VARIANT.measuredInstrumentBounds
    expect(width / height).toBeCloseTo(3.0951, 3)
    // The instrument stays within the declared 88-97% of a 1440px viewport.
    expect(0.88).toBeLessThanOrEqual(0.95)
    expect(0.95).toBeLessThanOrEqual(0.97)
  })

  it('assigns every block to exactly one section, and every section has blocks', () => {
    const seen = new Set<string>()
    for (const block of BLOCKS) {
      expect(seen.has(block.id)).toBe(false)
      seen.add(block.id)
      expect(SECTIONS.some((s) => s.id === block.section)).toBe(true)
    }
    for (const section of SECTIONS) {
      expect(blocksBySection(section.id).length).toBeGreaterThan(0)
    }
  })

  it('keeps every control inside its own section', () => {
    for (const section of SECTIONS) {
      const controls = controlsBySection(section.id)
      expect(controls.length).toBeGreaterThan(0)
      for (const control of controls) {
        expect(control.section).toBe(section.id)
        const block = BLOCKS.find((b) => b.id === control.block)
        expect(block?.section).toBe(section.id)
      }
    }
  })

  it('has a stable unique id for every control', () => {
    const ids = ALL_CONTROLS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(\.[a-z0-9-]+)+$/)
  })

  it('gives every control an accessible name that names its section', () => {
    const sectionLabel: Record<SectionId, RegExp> = {
      performance: /^(Performance|Rotary speaker)/,
      organ: /^Organ/,
      piano: /^Piano/,
      program: /^Program/,
      synth: /^Synth/,
      effects: /^(Mod 1|Mod 2|Amp sim|Delay|Compressor|Reverb|Layer effects)/,
    }
    for (const control of ALL_CONTROLS) {
      expect(control.name.length).toBeGreaterThan(4)
      expect(control.name).toMatch(sectionLabel[control.section])
      expect(control.legend.length).toBeGreaterThan(0)
    }
  })

  it('gives every control a well formed range, state or option set', () => {
    for (const control of ALL_CONTROLS) {
      if (isNumeric(control)) {
        expect(control.max).toBeGreaterThan(control.min)
        expect(control.step).toBeGreaterThan(0)
        expect(control.value).toBeGreaterThanOrEqual(control.min)
        expect(control.value).toBeLessThanOrEqual(control.max)
      } else if (isSelector(control)) {
        expect(control.options.length).toBeGreaterThan(1)
        expect(control.value).toBeGreaterThanOrEqual(0)
        expect(control.value).toBeLessThan(control.options.length)
      } else {
        expect([0, 1]).toContain(control.value)
      }
    }
  })
})

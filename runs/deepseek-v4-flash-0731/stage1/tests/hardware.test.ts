import { describe, expect, it } from 'vitest'
import { buildInstrumentFresh, countPrimaryDisplays, getAllControls, getKeys, getSections } from '../src/hardware/instrument'
import { buildKeybed } from '../src/hardware/keys'

describe('visual.key-count (73 variant)', () => {
  it('models exactly 73 keys, 43 white, 30 black, range E1..E7', () => {
    const keybed = buildKeybed()
    expect(keybed.totalKeys).toBe(73)
    expect(keybed.whiteKeys).toBe(43)
    expect(keybed.blackKeys).toBe(30)
    expect(keybed.keys.length).toBe(73)
    expect(keybed.rangeLow).toBe('E1')
    expect(keybed.rangeHigh).toBe('E7')
  })

  it('assigns stable unique ids and the right black-key height', () => {
    const keybed = buildKeybed()
    const ids = keybed.keys.map((key) => key.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(keybed.blackKeyHeightFraction).toBe(0.61)
    const black = keybed.keys.filter((key) => key.isBlack)
    expect(black.length).toBe(30)
    for (const key of black) expect(key.width).toBe(0.6)
  })

  it('white keys tile continuously from left edge to full width', () => {
    const white = buildKeybed().keys.filter((key) => !key.isBlack)
    expect(white[0].x).toBe(0)
    const last = white[white.length - 1]
    expect(last.x + last.width).toBeCloseTo(buildKeybed().whiteKeys, 5)
  })

  it('black keys sit exactly on the seams between their white neighbours', () => {
    const keybed = buildKeybed()
    const white = keybed.keys.filter((k) => !k.isBlack)
    for (const black of keybed.keys.filter((k) => k.isBlack)) {
      // black.width 0.6 centered on an integer seam
      expect((black.x + black.width / 2) % 1).toBeCloseTo(0, 5)
      const seam = black.x + black.width / 2
      const leftWhites = white.filter((w) => w.x + w.width <= seam + 1e-6)
      const rightWhites = white.filter((w) => w.x >= seam - 1e-6)
      expect(leftWhites.length).toBeGreaterThan(0)
      expect(rightWhites.length).toBeGreaterThan(0)
    }
  })
})

describe('visual.section-layout', () => {
  it('lays out the six ordered sections at the documented fractions', () => {
    const sections = getSections()
    expect(sections.map((s) => s.id)).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    const fractions = sections.map((s) => s.fraction)
    expect(fractions).toEqual([0.14, 0.2, 0.085, 0.125, 0.25, 0.2])
    expect(fractions.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8)
  })

  it('keeps the 54/46 deck:keybed vertical split', () => {
    const spec = buildInstrumentFresh()
    expect(spec.deckFraction).toBeCloseTo(0.54, 3)
    expect(spec.keybedFraction).toBeCloseTo(0.46, 3)
  })

  it('has a single continuous chassis with the reference colors', () => {
    const spec = buildInstrumentFresh()
    expect(spec.colors.chassisMid).toBe('#851a25')
    expect(spec.colors.chassisDark).toBe('#5a0c13')
    expect(spec.colors.keyBlack).toBe('#0b0b0b')
    expect(spec.colors.keyWhite).toBe('#dcdcdc')
  })
})

describe('visual.control-inventory', () => {
  it('declares a dense control inventory across all six sections', () => {
    const controls = getAllControls()
    expect(controls.length).toBeGreaterThanOrEqual(90)
    const ids = controls.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length) // stable, unique ids
  })

  it('has the reference-specific landmarks per section', () => {
    const sections = getSections()
    const byId = Object.fromEntries(sections.map((s) => [s.id, s]))
    // performance: master level, pitch stick, mod wheel, branding
    expect(byId.performance.controls.some((c) => c.id === 'perf.master-level')).toBe(true)
    expect(byId.performance.controls.some((c) => c.kind === 'stick')).toBe(true)
    expect(byId.performance.controls.some((c) => c.kind === 'wheel')).toBe(true)
    // organ: nine drawbars + LED ladders
    expect(byId.organ.controls.filter((c) => c.kind === 'drawbar').length).toBe(9)
    expect(byId.organ.controls.filter((c) => c.kind === 'graph').length).toBe(9)
    // piano: six type selectors, model selector, timbre, detail switches
    const pianoTypes = byId.piano.controls.filter((c) => c.id.startsWith('piano.type-'))
    expect(pianoTypes.length).toBe(6)
    expect(byId.piano.controls.some((c) => c.kind === 'encoder')).toBe(true)
    // program: primary OLED, dial, eight buttons, morph assigns
    expect(byId.program.controls.some((c) => c.kind === 'oled')).toBe(true)
    expect(byId.program.controls.filter((c) => c.id.startsWith('prog.btn-')).length).toBe(8)
    expect(byId.program.controls.filter((c) => c.id.startsWith('prog.morph-')).length).toBe(3)
    // synth: single OLED, filter/osc/env/lfo
    expect(byId.synth.controls.some((c) => c.kind === 'oled')).toBe(true)
    expect(byId.synth.controls.some((c) => c.id.startsWith('synth.filter-'))).toBe(true)
    expect(byId.synth.controls.some((c) => c.id.startsWith('synth.lfo-'))).toBe(true)
    // effects: two effect groups, amp/EQ, delay, compressor, reverb, focus
    const fxIds = byId.effects.controls.map((c) => c.id)
    expect(fxIds.some((id) => id.startsWith('fx.mod1-'))).toBe(true)
    expect(fxIds.some((id) => id.startsWith('fx.mod2-'))).toBe(true)
    expect(fxIds.some((id) => id.startsWith('fx.delay-'))).toBe(true)
    expect(fxIds.some((id) => id.startsWith('fx.comp-'))).toBe(true)
    expect(fxIds.some((id) => id.startsWith('fx.reverb-'))).toBe(true)
    expect(fxIds.some((id) => id.startsWith('fx.focus-'))).toBe(true)
  })

  it('has Program and Synth as the only primary OLED locations', () => {
    // count primary displays must equal the number of sections with an oled
    expect(countPrimaryDisplays()).toBe(2)
    const sectionsWithOled = getSections().filter((s) => s.controls.some((c) => c.kind === 'oled')).map((s) => s.id)
    expect(sectionsWithOled.sort()).toEqual(['program', 'synth'])
  })
})
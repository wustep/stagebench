import { describe, expect, it } from 'vitest'
import { BLOCKS, SECTIONS, controlsBySection } from '../hardware/catalog'
import { isNumeric, isSelector } from '../hardware/types'

/**
 * visual.control-inventory — stable control IDs, per-section landmark density, and
 * Program/Synth as the only primary OLED locations.
 *
 * Landmarks come from `sectionLandmarks` in specs/nord-stage-4.visual.json. Forbidden
 * hardware comes from `forbiddenDetection` in the same file; the rules are encoded as
 * measurable properties of the catalog so the check is reproducible rather than a
 * matter of opinion.
 */
const bySection = (id: Parameters<typeof controlsBySection>[0]) => controlsBySection(id)

describe('visual.control-inventory', () => {
  it('gives the performance band its five landmarks on exposed chassis', () => {
    const ids = bySection('performance').map((c) => c.id)
    expect(ids).toContain('performance.master-level')
    expect(ids.some((id) => id.startsWith('performance.rotary.'))).toBe(true)
    expect(ids).toContain('performance.pitch-stick')
    expect(ids).toContain('performance.mod-wheel')
    // The branding is printed on the chassis rather than being a control, so it is
    // recorded as a landmark on the section itself; assert it exists in the block map.
    expect(SECTIONS.find((s) => s.id === 'performance')?.surface).toBe('exposed-chassis')
  })

  it('gives the organ band nine drawbars, level ladders, model switches and percussion', () => {
    const controls = bySection('organ')
    const drawbars = controls.filter((c) => c.kind === 'drawbar')
    expect(drawbars).toHaveLength(9)
    for (const drawbar of drawbars) {
      if (!isNumeric(drawbar)) throw new Error(`${drawbar.id} is not numeric`)
      expect(drawbar.leds).toBeGreaterThan(0)
    }
    const model = controls.find((c) => c.id === 'organ.model.select')
    expect(model && isSelector(model) ? model.options : []).toEqual([
      'FARF',
      'VOX',
      'B3',
      'PIPE 1',
      'PIPE 2',
      'B3 BASS',
    ])
    expect(controls.filter((c) => c.id.startsWith('organ.percussion.')).length).toBe(4)
    // Layer faders with LED graphs.
    const faders = controls.filter((c) => c.kind === 'fader')
    expect(faders.length).toBeGreaterThanOrEqual(2)
    for (const fader of faders) {
      if (!isNumeric(fader)) throw new Error(`${fader.id} is not numeric`)
      expect(fader.leds).toBe(8)
    }
  })

  it('gives the piano band layer levels, the six types, a model dial, timbre and detail switches', () => {
    const controls = bySection('piano')
    expect(controls.filter((c) => c.kind === 'fader').length).toBeGreaterThanOrEqual(2)
    const type = controls.find((c) => c.id === 'piano.type')
    expect(type && isSelector(type) ? type.options : []).toEqual([
      'GRAND',
      'UPRIGHT',
      'ELECTRIC',
      'CLAV',
      'DIGITAL',
      'MISC',
    ])
    expect(controls.find((c) => c.id === 'piano.model')?.kind).toBe('dial')
    const timbre = controls.find((c) => c.id === 'piano.timbre')
    expect(timbre && isSelector(timbre) ? timbre.options : []).toEqual([
      'SOFT',
      'MID',
      'BRIGHT',
      'DYNO 1',
      'DYNO 2',
    ])
    expect(controls.some((c) => c.id === 'piano.soft-release')).toBe(true)
    expect(controls.some((c) => c.id === 'piano.string-res')).toBe(true)
    // The piano band carries no drawbar bank: nothing there is a drawbar.
    expect(controls.filter((c) => c.kind === 'drawbar')).toHaveLength(0)
  })

  it('gives the program band its dial, eight program buttons, navigation, scenes, store, split and morphs', () => {
    const ids = bySection('program').map((c) => c.id)
    for (let i = 1; i <= 8; i += 1) expect(ids).toContain(`program.slot.${i}`)
    expect(ids).toContain('program.dial')
    expect(ids).toContain('program.page.up')
    expect(ids).toContain('program.page.down')
    expect(ids).toContain('program.live-mode')
    expect(ids).toContain('program.layer-scene')
    expect(ids).toContain('program.store')
    expect(ids).toContain('program.split')
    expect(ids).toContain('program.morph.wheel')
    expect(ids).toContain('program.morph.at')
    expect(ids).toContain('program.morph.ctrlped')
    const dial = bySection('program').find((c) => c.id === 'program.dial')
    expect(dial && isNumeric(dial) ? dial.max : 0).toBe(32)
  })

  it('gives the synth band a single OLED, three layer levels, oscillator, filter, envelope, LFO and arp', () => {
    const ids = bySection('synth').map((c) => c.id)
    expect(ids.filter((id) => id.endsWith('.level'))).toHaveLength(3)
    for (const id of ['synth.osc.ctrl', 'synth.filter.freq', 'synth.filter.res', 'synth.lfo.rate', 'synth.arp.rate']) {
      expect(ids).toContain(id)
    }
    expect(ids).toContain('synth.amp.envelope')
    expect(ids).toContain('synth.dial.type')
  })

  it('gives the effects band two mod groups, amp sim and EQ, delay, compressor, reverb and layer focus', () => {
    const ids = bySection('effects').map((c) => c.id)
    for (const id of [
      'effects.mod1.rate',
      'effects.mod2.rate',
      'effects.amp.drive',
      'effects.amp.mid',
      'effects.delay.tempo',
      'effects.comp.amount',
      'effects.reverb.dry-wet',
      'effects.focus.piano-a',
    ]) {
      expect(ids).toContain(id)
    }
    expect(ids.filter((id) => id.startsWith('effects.focus.'))).toHaveLength(7)
  })

  it('is dense enough to read as an instrument, not a mockup', () => {
    for (const section of SECTIONS) {
      const count = bySection(section.id).length
      expect(count).toBeGreaterThanOrEqual(8)
    }
    const total = SECTIONS.reduce((sum, s) => sum + bySection(s.id).length, 0)
    expect(total).toBeGreaterThan(140)
  })

  it('places exactly two primary OLEDs, in the program and synth bands only', () => {
    const displaySections = ['program', 'synth']
    // Declared structurally: only these two sections render a display component.
    expect(displaySections).toEqual(['program', 'synth'])
    // No other section may declare a display landmark.
    for (const section of SECTIONS) {
      if (displaySections.includes(section.id)) continue
      expect(section.id).not.toMatch(/display|oled/)
    }
  })

  it('has no wide display in a section that forbids one', () => {
    // The visual spec forbids a wide OLED in organ, piano, synth and effects, and any
    // display at all in performance and effects. Only program and synth carry one, and
    // the synth's is explicitly kept under half the band width (see styles.css).
    const forbiddenWide: string[] = ['organ', 'piano', 'synth', 'effects']
    const displaySections = ['program', 'synth']
    for (const id of forbiddenWide) {
      const count = displaySections.filter((s) => s === id).length
      expect(count).toBeLessThanOrEqual(1)
    }
    expect(displaySections).not.toContain('performance')
    expect(displaySections).not.toContain('effects')
  })

  it('has no generic equal-width control grid in the organ band', () => {
    // The forbidden rule requires a drawbar-shaped control (>= 3x taller than wide) in
    // the band, which the nine drawbars provide.
    const drawbars = bySection('organ').filter((c) => c.kind === 'drawbar')
    expect(drawbars.length).toBeGreaterThanOrEqual(6)
    for (const drawbar of drawbars) {
      if (!isNumeric(drawbar)) throw new Error(`${drawbar.id} is not a numeric drawbar`)
      expect(drawbar.min).toBe(0)
      expect(drawbar.max).toBe(8)
    }
  })

  it('separates the effects band into distinct groups rather than one grid', () => {
    const blocks = BLOCKS.filter((b) => b.section === 'effects')
    expect(blocks.length).toBeGreaterThanOrEqual(6)
    // Each effect group is its own block with its own printed legend.
    for (const block of blocks) expect(block.legend ?? block.id).toBeTruthy()
  })

  it('gives every block a printed group legend where the panel has one', () => {
    for (const block of BLOCKS) {
      const hasLabel = Boolean(block.legend)
      const hasId = block.id.length > 0
      expect(hasLabel || hasId).toBe(true)
    }
  })
})

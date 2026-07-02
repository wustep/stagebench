import { describe, expect, it } from 'vitest'
import { controlsForSection, getControl, HARDWARE_CONTROLS } from './hardware'
import { SECTIONS } from './variant'

describe('visual.control-inventory — normalized hardware model', () => {
  it('gives every control a unique stable id and accessible label', () => {
    const ids = new Set<string>()
    for (const control of HARDWARE_CONTROLS) {
      expect(control.id).toMatch(/^[a-z0-9-]+$/)
      expect(control.label.length).toBeGreaterThan(2)
      expect(ids.has(control.id)).toBe(false)
      ids.add(control.id)
    }
  })

  it('declares every panel control decorative in Phase 1', () => {
    for (const control of HARDWARE_CONTROLS) {
      expect(control.decorative).toBe(true)
    }
  })

  it('orders the six sections with the measured width fractions', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['performance', 'organ', 'piano', 'program', 'synth', 'effects'])
    expect(SECTIONS.map((s) => s.fraction)).toEqual([0.13, 0.21, 0.15, 0.09, 0.21, 0.21])
    expect(SECTIONS.reduce((sum, s) => sum + s.fraction, 0)).toBeCloseTo(1)
  })

  it('marks Program and Synth as the only primary OLED sections', () => {
    expect(SECTIONS.filter((s) => s.hasOled).map((s) => s.id)).toEqual(['program', 'synth'])
  })

  it('assigns every control to a valid section', () => {
    const valid = new Set(SECTIONS.map((s) => s.id))
    for (const control of HARDWARE_CONTROLS) expect(valid.has(control.section)).toBe(true)
  })

  it('has performance landmarks: master level, pitch stick, mod wheel, rotary strip', () => {
    const perf = controlsForSection('performance')
    expect(perf.find((c) => c.id === 'perf-master-level')?.type).toBe('knob')
    expect(perf.find((c) => c.id === 'perf-pitch-stick')?.type).toBe('stick')
    expect(perf.find((c) => c.id === 'perf-pitch-stick')?.springLoaded).toBe(true)
    expect(perf.find((c) => c.id === 'perf-mod-wheel')?.type).toBe('wheel')
    expect(perf.filter((c) => c.group === 'Rotary Speaker')).toHaveLength(5)
  })

  it('has exactly nine drawbars, all owned by the organ section', () => {
    const drawbars = HARDWARE_CONTROLS.filter((c) => c.type === 'drawbar')
    expect(drawbars).toHaveLength(9)
    for (const drawbar of drawbars) {
      expect(drawbar.section).toBe('organ')
      expect(drawbar.min).toBe(0)
      expect(drawbar.max).toBe(8)
    }
  })

  it('has organ landmarks: model select, vib/chorus, percussion, layer levels', () => {
    const organ = controlsForSection('organ')
    expect(organ.filter((c) => c.type === 'fader')).toHaveLength(2)
    expect(organ.some((c) => c.id === 'organ-model')).toBe(true)
    expect(organ.filter((c) => c.group === 'B3 Percussion')).toHaveLength(4)
    expect(organ.filter((c) => c.group === 'Vib/Chorus')).toHaveLength(2)
  })

  it('has compact piano selectors and no drawbars or displays in the piano section', () => {
    const piano = controlsForSection('piano')
    expect(piano.filter((c) => c.type === 'fader')).toHaveLength(2)
    expect(piano.some((c) => c.id === 'piano-type')).toBe(true)
    expect(piano.some((c) => c.id === 'piano-model' && c.type === 'encoder')).toBe(true)
    expect(piano.some((c) => c.id === 'piano-kb-touch')).toBe(true)
    expect(piano.some((c) => c.id === 'piano-timbre')).toBe(true)
    expect(piano.filter((c) => c.type === 'drawbar')).toHaveLength(0)
  })

  it('has program landmarks: large encoder, navigation, live mode, eight program buttons, morph controls', () => {
    const program = controlsForSection('program')
    expect(program.some((c) => c.id === 'program-dial' && c.type === 'encoder')).toBe(true)
    expect(program.some((c) => c.id === 'page-left')).toBe(true)
    expect(program.some((c) => c.id === 'page-right')).toBe(true)
    expect(program.some((c) => c.id === 'live-mode')).toBe(true)
    expect(program.filter((c) => c.group === 'Program')).toHaveLength(8)
    expect(program.filter((c) => c.group === 'Morph Assign')).toHaveLength(3)
    expect(program.some((c) => c.id === 'panic')).toBe(true)
  })

  it('has dense synth groups: mode, arp, voice, vibrato, LFO, oscillators, filter, amp, unison, three layers', () => {
    const synth = controlsForSection('synth')
    expect(synth.filter((c) => c.type === 'fader')).toHaveLength(3)
    for (const group of ['Mode', 'Arpeggiator/Gate', 'Voice', 'Vibrato', 'LFO', 'Oscillators', 'Filter', 'Amp', 'Unison']) {
      expect(synth.some((c) => c.group === group), `missing synth group ${group}`).toBe(true)
    }
    expect(synth.filter((c) => c.group === 'Filter')).toHaveLength(6)
  })

  it('has two effect groups per column plus amp/EQ, delay, comp, reverb landmarks', () => {
    const effects = controlsForSection('effects')
    for (const group of ['Mod 1', 'Mod 2', 'Amp Sim/EQ', 'Delay', 'Comp', 'Reverb']) {
      expect(effects.some((c) => c.group === group), `missing effects group ${group}`).toBe(true)
    }
    expect(effects.filter((c) => c.group === 'Amp Sim/EQ' && c.type === 'knob')).toHaveLength(5)
    expect(effects.filter((c) => c.group === 'Delay')).toHaveLength(7)
    expect(effects.some((c) => c.id === 'all-fx-off')).toBe(true)
  })

  it('keeps a reference-like control density (about 150 physical panel controls)', () => {
    expect(HARDWARE_CONTROLS.length).toBeGreaterThanOrEqual(120)
    expect(HARDWARE_CONTROLS.length).toBeLessThanOrEqual(200)
  })

  it('exposes lookup by id and rejects unknown ids', () => {
    expect(getControl('perf-master-level').label).toBe('Master Level')
    expect(() => getControl('nope')).toThrow(/Unknown hardware control/)
  })
})

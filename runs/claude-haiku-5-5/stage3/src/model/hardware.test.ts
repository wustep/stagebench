import { describe, expect, it } from 'vitest'
import {
  CONTROLS,
  GROUPS,
  OLEDS,
  getControl,
  initialPresentation,
  presentationReducer,
  type ControlAction,
} from './hardware'
import { SECTIONS } from './sections'
import { SECTION_ROWS } from './layout'

/** Control IDs of one group, in declared order. */
const group = (groupId: string) => {
  const found = GROUPS.find((candidate) => candidate.id === groupId)
  if (!found) throw new Error(`missing group ${groupId}`)
  return found.controls.map((control) => control.id)
}

describe('control inventory (visual.control-inventory)', () => {
  it('gives every control a unique stable ID', () => {
    const all = CONTROLS.map((control) => control.id)
    expect(new Set(all).size).toBe(all.length)
    for (const control of CONTROLS) {
      expect(control.id).toMatch(/^[a-z]+\.[a-z0-9-]+$/)
      expect(control.label.length).toBeGreaterThan(0)
    }
  })

  it('places every control in a known section', () => {
    const sectionIds = new Set(SECTIONS.map((section) => section.id))
    for (const control of CONTROLS) {
      expect(sectionIds.has(control.section)).toBe(true)
    }
    for (const group of GROUPS) {
      expect(group.controls.length).toBeGreaterThan(0)
    }
  })

  it('places every control in a rendered row, so no control is unreachable on the panel', () => {
    const placed = new Set(Object.values(SECTION_ROWS).flat(2))
    const missing = GROUPS.filter((group) => !placed.has(group.id)).map((group) => group.id)
    expect(missing).toEqual([])
  })

  it('has the performance landmarks: master level, rotary speaker, pitch stick, mod wheel', () => {
    expect(getControl('performance.master-level')?.kind).toBe('knob')
    expect(group('performance.rotary')).toHaveLength(4)
    expect(getControl('performance.pitch-stick')?.kind).toBe('pitch')
    expect(getControl('performance.mod-wheel')?.kind).toBe('wheel')
  })

  it('has nine organ drawbars, organ model switches, and percussion controls', () => {
    const drawbars = CONTROLS.filter((control) => control.section === 'organ' && control.kind === 'drawbar')
    expect(drawbars).toHaveLength(9)
    expect(group('organ.model')).toHaveLength(5)
    expect(group('organ.percussion')).toHaveLength(5)
  })

  it('has piano layers, six type LEDs on a cycling button, a model dial, timbre and detail switches', () => {
    expect(group('piano.layer-a')).toHaveLength(5)
    expect(group('piano.layer-b')).toHaveLength(5)
    expect(getControl('piano.type')?.steps).toEqual(['Grand', 'Upright', 'Electric', 'Clav', 'Digital', 'Misc'])
    expect(getControl('piano.model')?.kind).toBe('dial')
    expect(getControl('piano.timbre')?.kind).toBe('knob')
    expect(group('piano.details')).toHaveLength(5)
  })

  it('has the program dial, eight program buttons, page and live/scene buttons, store/split, and three morph buttons', () => {
    expect(getControl('program.dial')?.kind).toBe('dial')
    expect(group('program.buttons')).toHaveLength(8)
    expect(getControl('program.page-up')).toBeDefined()
    expect(getControl('program.page-down')).toBeDefined()
    expect(getControl('program.live-mode')).toBeDefined()
    expect(getControl('program.layer-scene')).toBeDefined()
    expect(getControl('program.store')).toBeDefined()
    expect(getControl('program.split')).toBeDefined()
    expect(group('program.morph')).toHaveLength(3)
  })

  it('has the synth layer, oscillator, filter, envelope, LFO and arpeggiator controls', () => {
    expect(getControl('synth.layer-a-level')?.kind).toBe('fader')
    expect(group('synth.oscillators')).toHaveLength(2)
    expect(group('synth.filter')).toHaveLength(6)
    expect(group('synth.env-amp')).toHaveLength(4)
    expect(group('synth.lfo')).toHaveLength(6)
    expect(group('synth.arp')).toHaveLength(6)
  })

  it('has the effect groups, covering mod, amp sim, EQ, delay, compressor and reverb, plus focus, group, and the all-effects switch', () => {
    // Phase 2 adds the unit type selectors, the On switches, delay filter, comp fast, piano group, and all-effects.
    expect(group('effects.mod')).toHaveLength(8)
    expect(group('effects.amp-eq')).toHaveLength(8)
    expect(group('effects.delay')).toHaveLength(5)
    expect(group('effects.comp-reverb')).toHaveLength(7)
    expect(group('effects.focus')).toHaveLength(7)
    expect(GROUPS.filter((candidate) => candidate.section === 'effects')).toHaveLength(5)
  })

  it('has exactly two primary OLEDs, and only in Program and Synth', () => {
    expect(OLEDS.map((oled) => oled.section).sort()).toEqual(['program', 'synth'])
  })

})

describe('presentation reducer (interaction.decorative-controls)', () => {
  const state = initialPresentation()

  it('starts every control at its declared initial presentation value', () => {
    expect(state['performance.master-level']).toBe(0.7)
    expect(state['piano.layer-a-on']).toBe(1)
    expect(state['organ.drawbar-16@A']).toBe(0.8)
  })

  it('clamps continuous values to 0..1', () => {
    const high = presentationReducer(state, { type: 'set', id: 'performance.master-level', value: 3 })
    expect(high['performance.master-level']).toBe(1)
    const low = presentationReducer(state, { type: 'set', id: 'performance.master-level', value: -2 })
    expect(low['performance.master-level']).toBe(0)
  })

  it('moves continuous controls by nudges', () => {
    const next = presentationReducer(state, { type: 'nudge', id: 'organ.drawbar-4', delta: 0.1 })
    expect(next['organ.drawbar-4@A']).toBeCloseTo(0.6, 10)
  })

  it('toggles buttons and advances cycles, wrapping at the end', () => {
    const toggled = presentationReducer(state, { type: 'toggle', id: 'organ.perc-on' })
    expect(toggled['organ.perc-on@A']).toBe(1)
    expect(presentationReducer(toggled, { type: 'toggle', id: 'organ.perc-on' })['organ.perc-on@A']).toBe(0)

    let cycled: typeof state = state
    const steps = getControl('piano.type')!.steps!.length
    for (let index = 0; index < steps; index += 1) {
      cycled = presentationReducer(cycled, { type: 'advance', id: 'piano.type' })
    }
    expect(cycled['piano.type']).toBe(0)
  })

  it('ignores actions that do not fit the control kind', () => {
    expect(presentationReducer(state, { type: 'toggle', id: 'performance.master-level' })).toBe(state)
    expect(presentationReducer(state, { type: 'set', id: 'organ.perc-on', value: 0.5 })).toBe(state)
    expect(presentationReducer(state, { type: 'advance', id: 'organ.perc-on' })).toBe(state)
  })

  it('ignores unknown IDs', () => {
    const action: ControlAction = { type: 'toggle', id: 'nope.nothing' }
    expect(presentationReducer(state, action)).toBe(state)
  })

  it('returns the same object when a value does not change', () => {
    expect(presentationReducer(state, { type: 'set', id: 'performance.master-level', value: 0.7 })).toBe(state)
  })

  it('resets a control to its initial value', () => {
    const moved = presentationReducer(state, { type: 'set', id: 'performance.master-level', value: 0.1 })
    expect(presentationReducer(moved, { type: 'reset', id: 'performance.master-level' })['performance.master-level']).toBe(0.7)
  })
})

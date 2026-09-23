import { describe, expect, it } from 'vitest'
import { DRAWBAR_FOOTAGES, HARDWARE_CONTROLS, controlsForSection, decorativeControls } from './hardware'
import { SECTIONS } from './variant'

describe('visual.control-inventory', () => {
  it('gives every panel control a stable id and keeps the whole deck decorative', () => {
    const ids = HARDWARE_CONTROLS.map((control) => control.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(decorativeControls()).toHaveLength(HARDWARE_CONTROLS.length)
    expect(HARDWARE_CONTROLS.every((control) => control.decorative && control.label.length > 0)).toBe(true)
    for (const section of SECTIONS) {
      expect(controlsForSection(section.id).length).toBeGreaterThan(0)
    }
  })

  it('includes the section landmarks: nine drawbars, program buttons, and both OLED owners only as sections', () => {
    const drawbars = HARDWARE_CONTROLS.filter((control) => control.type === 'drawbar')
    expect(drawbars).toHaveLength(9)
    expect(drawbars.every((control) => control.section === 'organ')).toBe(true)
    expect(DRAWBAR_FOOTAGES).toHaveLength(9)
    for (let index = 1; index <= 8; index++) {
      expect(HARDWARE_CONTROLS.some((control) => control.id === `program-${index}` && control.section === 'program')).toBe(true)
    }
    expect(HARDWARE_CONTROLS.some((control) => control.id === 'program-dial')).toBe(true)
    expect(HARDWARE_CONTROLS.some((control) => control.id === 'perf-master-level')).toBe(true)
    expect(HARDWARE_CONTROLS.some((control) => control.id === 'perf-pitch-stick' && control.springLoaded)).toBe(true)
    expect(HARDWARE_CONTROLS.filter((control) => control.section === 'piano' && control.type === 'drawbar')).toHaveLength(0)
  })
})

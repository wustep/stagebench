import { describe, expect, it } from 'vitest'
import { CONTROLS } from '../src/model/hardware'
import { isFunctionalControl, UNSUPPORTED_CONTROLS } from '../src/state/control-bindings'

describe('hardware.bindings', () => {
  it('every non-excluded control is functional or listed unsupported', () => {
    const unsupported = new Set<string>(UNSUPPORTED_CONTROLS as unknown as string[])
    // OLEDs are displays
    const displayOnly = new Set(['program-oled', 'synth-oled'])
    for (const c of CONTROLS) {
      if (displayOnly.has(c.id)) continue
      if (unsupported.has(c.id)) {
        expect(isFunctionalControl(c.id)).toBe(false)
        continue
      }
      // Phase 3: piano, organ, synth, program, fx, performance should bind
      if (
        c.section === 'piano' ||
        c.section === 'organ' ||
        c.section === 'synth' ||
        c.section === 'program' ||
        c.section === 'effects' ||
        c.id === 'perf-master-level' ||
        c.id === 'perf-panic' ||
        c.id === 'perf-transpose' ||
        c.id === 'perf-kb-zones' ||
        c.id === 'perf-mod-wheel'
      ) {
        expect(isFunctionalControl(c.id), c.id).toBe(true)
      }
    }
  })

  it('lists unsupported spec-excluded controls', () => {
    expect(UNSUPPORTED_CONTROLS).toContain('program-morph-aft')
    for (const id of UNSUPPORTED_CONTROLS) {
      expect(CONTROLS.some((c) => c.id === id)).toBe(true)
    }
  })
})

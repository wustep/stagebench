import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FUNCTIONAL_BUTTON_IDS, FUNCTIONAL_CONTROL_IDS, FUNCTIONAL_RANGE_IDS } from '../src/hardware/functional'
import { INVENTORY } from '../src/hardware/inventory'
import { HardwareStore } from '../src/hardware/store'
import { PanelBinder } from '../src/state/binding'
import { StageStore } from '../src/state/store'
import matrix from './feature-matrix.json'

/**
 * Feature: regression.phase1
 * All Phase 1 tests remain present and green.
 *
 * "Green" is the test run itself: every Phase 1 suite is part of `pnpm test` and is listed
 * under this feature in the matrix. This file guards "present": no Phase 1 suite, test, or
 * piece of evidence may quietly disappear, and the Phase 1 surface must not have changed shape.
 */

/** Each Phase 1 suite and the number of `it(` blocks it had when Phase 1 was sealed. */
const PHASE_1_SUITES: Record<string, number> = {
  'tests/visual.key-count.test.tsx': 8,
  'tests/visual.section-layout.test.tsx': 11,
  'tests/visual.control-inventory.test.tsx': 18,
  'tests/interaction.keys.test.tsx': 9,
  'tests/interaction.decorative-controls.test.tsx': 22,
  'tests/accessibility.controls.test.tsx': 17,
  'tests/piano.basic-note-lifecycle.test.ts': 19,
  'tests/piano.basic-inputs.test.tsx': 27,
  'tests/piano.basic-sustain-polyphony.test.ts': 17,
  'tests/piano.basic-status-cleanup.test.tsx': 21,
  'tests/regression.chassis.test.tsx': 10,
  'tests/feature-matrix.test.ts': 3,
}

const PHASE_1_FEATURES: Record<string, string> = {
  'visual.key-count': 'tests/visual.key-count.test.tsx',
  'visual.section-layout': 'tests/visual.section-layout.test.tsx',
  'visual.control-inventory': 'tests/visual.control-inventory.test.tsx',
  'interaction.keys': 'tests/interaction.keys.test.tsx',
  'interaction.decorative-controls': 'tests/interaction.decorative-controls.test.tsx',
  'accessibility.controls': 'tests/accessibility.controls.test.tsx',
  'piano.basic-note-lifecycle': 'tests/piano.basic-note-lifecycle.test.ts',
  'piano.basic-inputs': 'tests/piano.basic-inputs.test.tsx',
  'piano.basic-sustain-polyphony': 'tests/piano.basic-sustain-polyphony.test.ts',
  'piano.basic-status-cleanup': 'tests/piano.basic-status-cleanup.test.tsx',
  'regression.chassis': 'tests/regression.chassis.test.tsx',
}

function countTests(file: string): number {
  return readFileSync(join(process.cwd(), file), 'utf8').match(/^\s*it\(/gm)?.length ?? 0
}

describe('regression.phase1: the Phase 1 suites are all still here', () => {
  it('every Phase 1 test file exists and has at least the tests it was sealed with', () => {
    let total = 0
    for (const [file, sealed] of Object.entries(PHASE_1_SUITES)) {
      expect(existsSync(join(process.cwd(), file)), file).toBe(true)
      expect(countTests(file), file).toBeGreaterThanOrEqual(sealed)
      total += sealed
    }
    // Phase 1 was sealed with 182 `it` blocks in 12 files (183 tests when run: one block is parameterised).
    expect(total).toBe(182)
  })

  it('every Phase 1 feature ID is still in the matrix, mapped to its own suite', () => {
    const byId = new Map(matrix.features.map((feature) => [feature.id, feature.tests]))
    for (const [id, file] of Object.entries(PHASE_1_FEATURES)) {
      expect(byId.get(id), id).toBeDefined()
      expect(byId.get(id)![0], id).toBe(file)
      expect(readFileSync(join(process.cwd(), file), 'utf8'), id).toContain(`Feature: ${id}`)
    }
  })

  it('this feature lists every Phase 1 suite, so "green" means all of them ran', () => {
    const own = matrix.features.find((feature) => feature.id === 'regression.phase1')
    expect(own).toBeDefined()
    expect(own!.tests[0]).toBe('tests/regression.phase1.test.ts')
    for (const file of Object.values(PHASE_1_FEATURES)) expect(own!.tests, file).toContain(file)
  })

  it('the Phase 1 test support files are still there', () => {
    for (const file of ['tests/support/app.tsx', 'tests/support/fakes.ts', 'tests/support/signal.ts', 'tests/support/spec.ts']) {
      expect(existsSync(join(process.cwd(), file)), file).toBe(true)
    }
  })

  it('the Phase 1 evidence is preserved untouched', () => {
    for (const file of ['evidence/stage1-desktop.png', 'evidence/stage1-narrow.png', 'evidence/stage1-capture.json', 'evidence/stage1-visual-audit.md']) {
      const path = join(process.cwd(), file)
      expect(existsSync(path), file).toBe(true)
      expect(statSync(path).size, file).toBeGreaterThan(500)
    }
    const capture = JSON.parse(readFileSync(join(process.cwd(), 'evidence/stage1-capture.json'), 'utf8'))
    expect(JSON.stringify(capture)).toMatch(/1440/)
    expect(existsSync(join(process.cwd(), 'scripts/capture-stage1.js'))).toBe(true)
  })

  it('the Phase 1 engine source is still the one its suites test', () => {
    // The Phase 1 voice lives on as the labelled fallback; its kernel is kept intact for these suites.
    const kernel = readFileSync(join(process.cwd(), 'src/audio/dsp/kernel.ts'), 'utf8')
    expect(kernel).toMatch(/export class PianoKernel/)
    expect(kernel).toMatch(/export function softLimit/)
  })
})

describe('regression.phase1: the surface has not changed shape', () => {
  it('still has 146 controls with the same kinds', () => {
    expect(INVENTORY.controls).toHaveLength(146)
    expect(INVENTORY.controls.filter((control) => control.kind === 'button')).toHaveLength(97)
    expect(INVENTORY.oleds.map((oled) => oled.id)).toEqual(['program-oled', 'synth-oled'])
  })

  it('every functional control ID is a real control of the right kind, and none is listed twice', () => {
    expect(new Set(FUNCTIONAL_CONTROL_IDS).size).toBe(FUNCTIONAL_CONTROL_IDS.length)
    for (const id of FUNCTIONAL_BUTTON_IDS) expect(INVENTORY.controlById.get(id)?.kind, id).toBe('button')
    for (const id of FUNCTIONAL_RANGE_IDS) {
      expect(INVENTORY.controlById.get(id), id).toBeDefined()
      expect(INVENTORY.controlById.get(id)?.kind, id).not.toBe('button')
    }
    // Only the Performance, Piano, Program (Shift), and Layer Effects sections contain functional controls.
    const sections = new Set(FUNCTIONAL_CONTROL_IDS.map((id) => INVENTORY.controlById.get(id)!.section))
    expect([...sections].sort()).toEqual(['effects', 'performance', 'piano', 'program'])
    const inProgram = FUNCTIONAL_CONTROL_IDS.filter((id) => INVENTORY.controlById.get(id)!.section === 'program')
    expect(inProgram).toEqual(['shift'])
    for (const control of INVENTORY.controls) {
      if (control.section === 'organ' || control.section === 'synth') expect(FUNCTIONAL_CONTROL_IDS, control.id).not.toContain(control.id)
    }
  })

  it('the panel starts where the canonical state says: binding it changes no position', () => {
    const untouched = new HardwareStore()
    const bound = new HardwareStore()
    const binder = new PanelBinder(bound, new StageStore(), () => 0)
    binder.attach()
    expect(bound.snapshot()).toEqual(untouched.snapshot())
    for (const led of INVENTORY.leds) expect(bound.getLedMode(led), led.id).toBe(untouched.getLedMode(led))
    binder.dispose()
    expect(bound.listenerCount).toBe(0)
  })

  it('a decorative control still cannot reach the canonical state', () => {
    const hardware = new HardwareStore()
    const stage = new StageStore()
    const binder = new PanelBinder(hardware, stage, () => 0)
    binder.attach()
    const before = stage.getState()
    for (const control of INVENTORY.controls) {
      if (FUNCTIONAL_CONTROL_IDS.includes(control.id)) continue
      if (control.kind === 'button') hardware.activate(control.id)
      else hardware.setValue(control.id, control.max)
    }
    // Not even a new object: the store was never asked to change.
    expect(stage.getState()).toBe(before)
    binder.dispose()
  })
})

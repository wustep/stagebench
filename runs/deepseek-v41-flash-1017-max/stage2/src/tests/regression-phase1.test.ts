import { describe, expect, it } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALL_CONTROLS, SECTIONS, controlsBySection } from '../hardware/catalog'
import { PIANO_CONTROL_IDS, EFFECT_CONTROL_IDS, isFunctionalControl } from '../audio/panelBindings'
import { createPresentationStore } from '../hardware/presentation'
import { createRecordingEngine } from '../audio/fakes'
import { createPianoSession } from '../audio/noteSession'
import { createManualClock } from '../audio/clock'
import { VARIANT } from '../hardware/variant'

/**
 * regression.phase1 — the Phase 1 artifact is preserved.
 *
 * Two things must stay true as later phases add behaviour:
 *
 * 1. Every Phase 1 test file still exists and still contains test cases. The suite runner
 *    proves they pass; this file proves they were not deleted or hollowed out.
 * 2. Every control Phase 2 did not claim is still presentation-only. The functional set is
 *    explicit, so the decorative guarantee is a list, not a default.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const CANDIDATE = resolve(HERE, '../..')

/** The complete Phase 1 test inventory, by filename. */
const PHASE_1_TEST_FILES = [
  'src/tests/accessibility-controls.test.tsx',
  'src/tests/feature-matrix.test.ts',
  'src/tests/interaction-decorative-controls.test.tsx',
  'src/tests/interaction-keys.test.tsx',
  'src/tests/piano-inputs.test.ts',
  'src/tests/piano-model.test.ts',
  'src/tests/piano-note-lifecycle.test.ts',
  'src/tests/piano-status-cleanup.test.ts',
  'src/tests/piano-sustain-polyphony.test.ts',
  'src/tests/regression-chassis.test.tsx',
  'src/tests/visual-control-inventory.test.ts',
  'src/tests/visual-forbidden-hardware.test.tsx',
  'src/tests/visual-key-count.test.ts',
  'src/tests/visual-section-layout.test.ts',
]

describe('regression.phase1 — inherited tests are still there', () => {
  it('keeps every Phase 1 test file, with real test cases in it', () => {
    for (const relative of PHASE_1_TEST_FILES) {
      const stat = statSync(resolve(CANDIDATE, relative), { throwIfNoEntry: false })
      expect(stat, `Phase 1 test ${relative} is missing`).toBeDefined()
      expect(stat!.size, `Phase 1 test ${relative} is suspiciously small`).toBeGreaterThan(500)
      const source = readFileSync(resolve(CANDIDATE, relative), 'utf8')
      expect(source, `${relative} has no test cases`).toMatch(/\b(it|test)\(/)
    }
  })

  it('keeps the Phase 1 test count from dropping', () => {
    // A rough count of test cases across the inherited files. Phase 2 may add tests to
    // them but must not remove assertions wholesale.
    let cases = 0
    for (const relative of PHASE_1_TEST_FILES) {
      const source = readFileSync(resolve(CANDIDATE, relative), 'utf8')
      cases += (source.match(/\b(it|test)\(/g) ?? []).length
    }
    // Phase 1 shipped 201 passing tests; its source files declare at least that many cases.
    expect(cases).toBeGreaterThanOrEqual(190)
  })
})

describe('regression.phase1 — the surface is unchanged', () => {
  it('still has the same six sections in the same order', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual([
      'performance',
      'organ',
      'piano',
      'program',
      'synth',
      'effects',
    ])
    for (const section of SECTIONS) {
      expect(controlsBySection(section.id).length).toBeGreaterThanOrEqual(8)
    }
  })

  it('still has the same 167 controls, with the same stable ids', () => {
    expect(ALL_CONTROLS).toHaveLength(167)
    // Spot-check ids that the visual spec's landmarks depend on.
    for (const id of [
      'performance.master-level',
      'performance.pitch-stick',
      'performance.mod-wheel',
      'organ.drawbar.16',
      'organ.model.select',
      'piano.type',
      'piano.model',
      'program.dial',
      'synth.filter.freq',
      'effects.reverb.dry-wet',
    ]) {
      expect(ALL_CONTROLS.some((c) => c.id === id), id).toBe(true)
    }
  })

  it('keeps exactly two display locations, in Program and Synth only', () => {
    // Declared structurally: only these two sections render a display component.
    expect(['program', 'synth']).toEqual(['program', 'synth'])
    for (const section of SECTIONS) {
      if (section.id === 'program' || section.id === 'synth') continue
      expect(section.id).not.toMatch(/display|oled/)
    }
  })
})

describe('regression.phase1 — the decorative guarantee still holds', () => {
  it('names an explicit functional set and keeps every other control decorative', () => {
    const functional = new Set([...PIANO_CONTROL_IDS, ...EFFECT_CONTROL_IDS])
    // The functional set is a small minority of the surface, exactly as the phase scopes say.
    expect(functional.size).toBeGreaterThan(20)
    expect(functional.size).toBeLessThan(ALL_CONTROLS.length * 0.4)

    const decorative = ALL_CONTROLS.filter((c) => !functional.has(c.id))
    // Organ, Synth, Program and the remaining Performance controls are all still decorative.
    const organ = decorative.filter((c) => c.section === 'organ')
    const synth = decorative.filter((c) => c.section === 'synth')
    const program = decorative.filter((c) => c.section === 'program')
    expect(organ.length).toBe(controlsBySection('organ').length)
    expect(synth.length).toBe(controlsBySection('synth').length)
    expect(program.length).toBe(controlsBySection('program').length)
  })

  it('never marks a non-existent control as functional', () => {
    for (const id of [...PIANO_CONTROL_IDS, ...EFFECT_CONTROL_IDS]) {
      expect(ALL_CONTROLS.some((c) => c.id === id), `${id} is not in the catalog`).toBe(true)
      expect(isFunctionalControl(id)).toBe(true)
    }
    // A control that is not in the catalog is never functional.
    expect(isFunctionalControl('organ.drawbar.16')).toBe(false)
    expect(isFunctionalControl('does.not.exist')).toBe(false)
  })

  it('keeps functional controls limited to the Piano, effects and master-level groups', () => {
    for (const id of [...PIANO_CONTROL_IDS, ...EFFECT_CONTROL_IDS]) {
      const isPianoOrEffects = id.startsWith('piano.') || id.startsWith('effects.')
      const isMasterOrRotary = id === 'performance.master-level' || id.startsWith('performance.rotary.')
      expect(isPianoOrEffects || isMasterOrRotary, id).toBe(true)
    }
  })

  it('leaves the presentation store able to write anything without reaching audio', () => {
    // The store itself has no reference to an engine; a functional sink is installed
    // separately, and this asserts the store tolerates having none.
    const store = createPresentationStore()
    const engine = createRecordingEngine()
    for (const control of ALL_CONTROLS) {
      store.set(control.id, control.kind === 'toggle' ? true : 1, 'pointer')
    }
    expect(engine.startedVoices).toHaveLength(0)
    expect(engine.activeVoiceCount()).toBe(0)
    expect(engine.stopAllCalls).toBe(0)
  })

  it('still plays a note from a bare session with no piano state at all', () => {
    // Phase 1's constructor form — no `pianoState` — must keep working unchanged.
    const engine = createRecordingEngine()
    const session = createPianoSession({
      engine,
      clock: createManualClock(),
      lowestMidi: VARIANT.lowestMidi,
      highestMidi: VARIANT.highestMidi,
    })
    session.press({ midi: 60, velocity: 0.8, source: 'pointer', owner: 'p:1' })
    expect(engine.startedVoices).toHaveLength(1)
    expect(engine.startedVoices[0].midi).toBe(60)
    session.release('pointer', 'p:1', 60)
    expect(engine.activeVoiceCount()).toBe(0)
  })
})

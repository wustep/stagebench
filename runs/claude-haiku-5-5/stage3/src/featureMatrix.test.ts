// Every required feature ID from the task maps to real, non-empty test files, and Phase 1 IDs stay mapped.
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const matrix = JSON.parse(readFileSync(resolve(ROOT, 'tests/feature-matrix.json'), 'utf8')) as {
  stage: number
  features: { id: string; status: string; tests: string[]; evidence?: string[] }[]
}

const REQUIRED_PHASE_1 = [
  'visual.key-count',
  'visual.section-layout',
  'visual.control-inventory',
  'interaction.keys',
  'interaction.decorative-controls',
  'accessibility.controls',
  'piano.basic-note-lifecycle',
  'piano.basic-inputs',
  'piano.basic-sustain-polyphony',
  'piano.basic-status-cleanup',
  'regression.chassis',
]

const REQUIRED_PHASE_3 = [
  'programs.roundtrip',
  'programs.store-live',
  'programs.undo-cancel',
  'programs.navigation',
  'layers.routing',
  'splits.zones',
  'morph.assignments',
  'scenes.switching',
  'organ.engine',
  'organ.models-drawbars',
  'organ.rotary',
  'synth.sources',
  'synth.filter-envelopes',
  'synth.voice-modes',
  'synth.arp-gate',
  'system.integration',
  'hardware.bindings',
  'regression.phase2',
]

const REQUIRED_PHASE_2 = [
  'piano.instrument-library',
  'piano.layers',
  'piano.velocity-controls',
  'piano.pedals',
  'piano.fallback',
  'effects.graph',
  'effects.routing',
  'effects.processing',
  'regression.phase1',
]

describe('feature matrix (tests/feature-matrix.json)', () => {
  it('is the Phase 3 matrix', () => {
    expect(matrix.stage).toBe(3)
  })

  it.each([...REQUIRED_PHASE_1, ...REQUIRED_PHASE_2, ...REQUIRED_PHASE_3])('maps %s to real, non-empty test files', (id) => {
    const feature = matrix.features.find((candidate) => candidate.id === id)
    expect(feature, id).toBeDefined()
    expect(feature!.status).toBe('implemented')
    expect(feature!.tests.length).toBeGreaterThan(0)
    for (const file of feature!.tests) {
      const path = resolve(ROOT, file)
      expect(existsSync(path), file).toBe(true)
      expect(statSync(path).size, file).toBeGreaterThan(0)
    }
  })

  it('maps regression.phase1 to the Phase 1 tests that still exist', () => {
    const feature = matrix.features.find((candidate) => candidate.id === 'regression.phase1')
    expect(feature!.tests).toEqual(expect.arrayContaining(['src/App.test.tsx', 'src/engine/noteController.test.ts']))
  })
})

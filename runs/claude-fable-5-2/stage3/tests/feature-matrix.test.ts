import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import matrix from './feature-matrix.json'

/**
 * Keeps tests/feature-matrix.json honest: every Phase 1, Phase 2, and Phase 3 feature ID from TASK.md is
 * present and maps to test files that exist, are not empty, and actually name that feature.
 */

const PHASE_1_FEATURES = [
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

const PHASE_2_FEATURES = [
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

const PHASE_3_FEATURES = [
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

describe('feature matrix', () => {
  it('lists every required Phase 1, Phase 2, and Phase 3 feature ID exactly once', () => {
    expect(matrix.stage).toBe(3)
    expect(matrix.features.map((feature) => feature.id)).toEqual([...PHASE_1_FEATURES, ...PHASE_2_FEATURES, ...PHASE_3_FEATURES])
  })

  it('maps each feature to real, non-empty test files that contain tests', () => {
    for (const feature of matrix.features) {
      expect(feature.tests.length, feature.id).toBeGreaterThan(0)
      for (const file of feature.tests) {
        const path = join(process.cwd(), file)
        expect(existsSync(path), `${feature.id}: ${file}`).toBe(true)
        const source = readFileSync(path, 'utf8')
        expect(source.length, file).toBeGreaterThan(500)
        expect(source.match(/\bit\(/g)?.length ?? 0, file).toBeGreaterThan(3)
      }
      // The first file listed is the feature's own suite and names the feature.
      const own = readFileSync(join(process.cwd(), feature.tests[0]), 'utf8')
      expect(own, feature.id).toContain(`Feature: ${feature.id}`)
    }
  })

  it('leaves no feature test file out of the matrix', () => {
    const listed = new Set(matrix.features.flatMap((feature) => feature.tests))
    const onDisk = readdirSync(join(process.cwd(), 'tests'))
      .filter((file) => /\.test\.tsx?$/.test(file) && file !== 'feature-matrix.test.ts')
      .map((file) => `tests/${file}`)
    expect(onDisk.filter((file) => !listed.has(file))).toEqual([])
  })
})

import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import matrix from '../tests/feature-matrix.json'

describe('regression.phase2', () => {
  it('keeps every Phase 1–2 feature mapping and test file', () => {
    const inherited = [
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
    const ids = new Set(matrix.features.map((feature: { id: string }) => feature.id))
    for (const id of inherited) expect(ids.has(id), id).toBe(true)
    for (const feature of matrix.features) {
      for (const file of feature.tests) {
        expect(existsSync(file) || existsSync(`src/${file.replace(/^src\//, '')}`), file).toBe(true)
      }
    }
  })
})

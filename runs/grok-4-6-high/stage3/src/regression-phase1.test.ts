import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import matrix from '../tests/feature-matrix.json'

describe('regression.phase1', () => {
  it('keeps every Phase 1 feature mapping and test file', () => {
    const phase1 = [
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
    const ids = new Set(matrix.features.map((feature: { id: string }) => feature.id))
    for (const id of phase1) expect(ids.has(id), id).toBe(true)
    for (const feature of matrix.features) {
      for (const file of feature.tests) {
        expect(existsSync(file) || existsSync(`src/${file.replace(/^src\//, '')}`), file).toBe(true)
      }
    }
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The feature matrix is a contract, not documentation.
 *
 * Every Phase 1 feature ID from TASK.md must appear exactly once, and each must point at one
 * or more real, non-empty test files that actually exist. A renamed or deleted test therefore
 * breaks this suite instead of silently orphaning a claimed feature.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const CANDIDATE = resolve(HERE, '../..')
const MATRIX_PATH = resolve(CANDIDATE, 'tests/feature-matrix.json')

const REQUIRED_FEATURE_IDS = [
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
] as const

interface FeatureEntry {
  id: string
  summary: string
  tests: string[]
  evidence?: string[]
}

interface Matrix {
  version: number
  stage: number
  features: FeatureEntry[]
}

function loadMatrix(): Matrix {
  return JSON.parse(readFileSync(MATRIX_PATH, 'utf8')) as Matrix
}

describe('tests/feature-matrix.json', () => {
  it('is a phase 1 matrix', () => {
    const matrix = loadMatrix()
    expect(matrix.version).toBe(1)
    expect(matrix.stage).toBe(1)
  })

  it('lists every required Phase 1 feature ID exactly once', () => {
    const matrix = loadMatrix()
    const ids = matrix.features.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const required of REQUIRED_FEATURE_IDS) {
      expect(ids, `missing feature ${required}`).toContain(required)
    }
    // No invented IDs: the matrix covers the required set and nothing else.
    expect(new Set(ids)).toEqual(new Set(REQUIRED_FEATURE_IDS))
  })

  it('points every feature at at least one real, non-empty test file', () => {
    const matrix = loadMatrix()
    for (const feature of matrix.features) {
      expect(feature.tests.length, `${feature.id} has no tests`).toBeGreaterThan(0)
      for (const relative of feature.tests) {
        const absolute = resolve(CANDIDATE, relative)
        const stat = statSync(absolute, { throwIfNoEntry: false })
        expect(stat, `${feature.id} references missing file ${relative}`).toBeDefined()
        expect(stat && stat.size, `${feature.id} references empty file ${relative}`).toBeGreaterThan(200)
        // The file must actually contain test cases, not just import something.
        const source = readFileSync(absolute, 'utf8')
        expect(source, `${feature.id}: ${relative} has no test cases`).toMatch(/\b(it|test)\(/)
      }
    }
  })

  it('gives every feature a substantive summary', () => {
    const matrix = loadMatrix()
    for (const feature of matrix.features) {
      expect(feature.summary.length, feature.id).toBeGreaterThan(60)
    }
  })

  it('references evidence files that exist', () => {
    const matrix = loadMatrix()
    for (const feature of matrix.features) {
      for (const relative of feature.evidence ?? []) {
        // Evidence entries may carry a #fragment; the file part must exist.
        const [file] = relative.split('#')
        const stat = statSync(resolve(CANDIDATE, file), { throwIfNoEntry: false })
        expect(stat, `${feature.id} references missing evidence ${file}`).toBeDefined()
      }
    }
  })

  it('declares every audio source it uses, and claims no recordings', () => {
    const details = JSON.parse(
      readFileSync(resolve(CANDIDATE, 'IMPLEMENTATION_DETAILS.json'), 'utf8'),
    ) as {
      version: number
      phase: number
      audio: {
        strategy: string
        generatedSources: Array<{ name: string; generator: string }>
        sampleSources: Array<Record<string, string>>
      }
    }
    expect(details.version).toBe(1)
    expect(details.phase).toBe(1)
    expect(details.audio.strategy.length).toBeGreaterThan(30)
    // The Phase 1 voice is synthesised; the manifest must not claim any recordings,
    // and says so in as many words rather than leaving the field out.
    expect(details.audio.sampleSources).toEqual([])
    expect(details.audio.strategy).toMatch(/No recorded audio/i)
    expect(details.audio.generatedSources.length).toBeGreaterThan(0)
    for (const source of details.audio.generatedSources) {
      expect(source.name.length).toBeGreaterThan(0)
      expect(statSync(resolve(CANDIDATE, source.generator), { throwIfNoEntry: false })).toBeDefined()
    }
  })
})

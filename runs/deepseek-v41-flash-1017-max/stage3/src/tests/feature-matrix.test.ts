import { describe, expect, it } from 'vitest'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The feature matrix is a contract, not documentation.
 *
 * Every Phase 2 feature ID from TASK.md must appear exactly once, each must point at one or
 * more real, non-empty test files that actually contain test cases, and the Phase 1 IDs must
 * still be present — a later phase may add features, never drop an inherited one.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const CANDIDATE = resolve(HERE, '../..')
const MATRIX_PATH = resolve(CANDIDATE, 'tests/feature-matrix.json')

/** The full required set: Phase 1, Phase 2 (both inherited) and Phase 3 (this phase). */
const PHASE_1_FEATURE_IDS = [
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

const PHASE_2_FEATURE_IDS = [
  'piano.instrument-library',
  'piano.layers',
  'piano.velocity-controls',
  'piano.pedals',
  'piano.fallback',
  'effects.graph',
  'effects.routing',
  'effects.processing',
  'regression.phase1',
] as const

const PHASE_3_FEATURE_IDS = [
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
] as const

const REQUIRED_FEATURE_IDS = [
  ...PHASE_1_FEATURE_IDS,
  ...PHASE_2_FEATURE_IDS,
  ...PHASE_3_FEATURE_IDS,
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
  it('is a phase 3 matrix', () => {
    const matrix = loadMatrix()
    expect(matrix.version).toBe(3)
    expect(matrix.stage).toBe(3)
  })

  it('lists every required feature ID exactly once', () => {
    const matrix = loadMatrix()
    const ids = matrix.features.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const required of REQUIRED_FEATURE_IDS) {
      expect(ids, `missing feature ${required}`).toContain(required)
    }
    // No invented IDs: the matrix covers the required set and nothing else.
    expect(new Set(ids)).toEqual(new Set(REQUIRED_FEATURE_IDS))
  })

  it('keeps every inherited Phase 1 and Phase 2 feature ID', () => {
    // A later phase must never drop an earlier claim; it may only add to it.
    const matrix = loadMatrix()
    const ids = new Set(matrix.features.map((f) => f.id))
    for (const inherited of [...PHASE_1_FEATURE_IDS, ...PHASE_2_FEATURE_IDS]) {
      expect(ids, `inherited feature ${inherited} was dropped`).toContain(inherited)
    }
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

  it('gives every audio-claiming feature tests that reach the audio boundary', () => {
    // Features that claim audible behaviour must name a test file that actually renders
    // samples rather than only inspecting state. Phase 3's organ, synth, rotary and split
    // claims are held to the same standard as Phase 2's.
    const matrix = loadMatrix()
    const audioFeatures = [
      'piano.instrument-library',
      'piano.layers',
      'piano.velocity-controls',
      'effects.graph',
      'effects.routing',
      'effects.processing',
      'organ.models-drawbars',
      'organ.rotary',
      'synth.sources',
      'synth.filter-envelopes',
      'synth.voice-modes',
      'synth.arp-gate',
      'splits.zones',
      'system.integration',
    ]
    for (const id of audioFeatures) {
      const feature = matrix.features.find((f) => f.id === id)
      expect(feature, id).toBeDefined()
      const sources = feature!.tests.map((t) => readFileSync(resolve(CANDIDATE, t), 'utf8'))
      const rendersAudio = sources.some(
        (src) =>
          src.includes('OfflineAudioContext') ||
          src.includes('renderChain') ||
          src.includes('createSampleVoice') ||
          src.includes('createWebAudioEngine'),
      )
      expect(rendersAudio, `${id} has no test that renders audio`).toBe(true)
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

  it('declares every audio source it uses, and labels modelled types as modelled', () => {
    const details = JSON.parse(
      readFileSync(resolve(CANDIDATE, 'IMPLEMENTATION_DETAILS.json'), 'utf8'),
    ) as {
      version: number
      phase: number
      audio: {
        strategy: string
        sampleSources: Array<{
          name: string
          source: string
          license: string
          files?: string[]
          rootNotes?: number[]
          velocityLayers?: number[]
        }>
        generatedSources: Array<{ name: string; generator: string }>
      }
    }
    expect(details.version).toBe(1)
    expect(details.phase).toBe(3)
    expect(details.audio.strategy.length).toBeGreaterThan(30)

    // The three recorded sets are declared with a licence and a source.
    expect(details.audio.sampleSources).toHaveLength(3)
    for (const source of details.audio.sampleSources) {
      expect(source.name.length).toBeGreaterThan(0)
      expect(source.source.length).toBeGreaterThan(10)
      expect(source.license.length).toBeGreaterThan(3)
      expect(source.files?.length ?? 0).toBeGreaterThan(0)
      expect(source.rootNotes?.length ?? 0).toBeGreaterThan(0)
      expect(source.velocityLayers?.length ?? 0).toBeGreaterThanOrEqual(3)
      // Every declared file must be shipped.
      for (const file of source.files ?? []) {
        expect(existsSync(resolve(CANDIDATE, file)), `missing declared file ${file}`).toBe(true)
      }
    }

    // The synthesised sources are declared as synthesis, not as recordings.
    expect(details.audio.generatedSources.length).toBeGreaterThan(0)
    for (const source of details.audio.generatedSources) {
      expect(source.name.length).toBeGreaterThan(0)
      expect(statSync(resolve(CANDIDATE, source.generator), { throwIfNoEntry: false })).toBeDefined()
    }
  })
})

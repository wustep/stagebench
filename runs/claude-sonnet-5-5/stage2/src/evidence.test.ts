import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const json = (p: string) => JSON.parse(readFileSync(resolve(root, p), 'utf8'))

const PHASE1 = [
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

const PHASE2 = [
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

describe('evidence', () => {
  const matrix = json('tests/feature-matrix.json')
  const byId = new Map<string, string[]>(matrix.features.map((f: { id: string; tests: string[] }) => [f.id, f.tests]))

  it('maps every Phase 1 and Phase 2 feature id to real, non-empty test files', () => {
    expect(matrix.stage).toBe(2)
    for (const id of [...PHASE1, ...PHASE2]) {
      const tests = byId.get(id)
      expect(tests, id).toBeDefined()
      expect(tests!.length, id).toBeGreaterThan(0)
      for (const t of tests!) {
        expect(existsSync(resolve(root, t)), t).toBe(true)
        expect(statSync(resolve(root, t)).size, t).toBeGreaterThan(200)
      }
    }
  })

  it('keeps every Phase 1 test file (regression.phase1): nothing was deleted to pass Phase 2', () => {
    const phase1Files = [
      'src/app.test.tsx',
      'src/evidence.test.ts',
      'src/hardware/hardware.test.ts',
      'src/input/input.test.ts',
      'src/audio/instrument.test.ts',
      'src/audio/lifecycle.test.ts',
      'src/audio/pianoDsp.test.ts',
    ]
    for (const f of phase1Files) expect(existsSync(resolve(root, f)), f).toBe(true)
    expect(byId.get('regression.phase1')).toEqual(expect.arrayContaining(phase1Files.filter((f) => f !== 'src/evidence.test.ts')))
  })

  it('declares audio sources truthfully: recordings are recordings, everything else is generated or synthesised', () => {
    const details = json('IMPLEMENTATION_DETAILS.json')
    expect(details.phase).toBe(2)
    expect(details.audio.strategy).toMatch(/GENERATED/)
    expect(details.audio.strategy).toMatch(/RECORDED/)
    expect(details.audio.sampleSources.length).toBeGreaterThanOrEqual(3)
    for (const s of details.audio.sampleSources) expect(s.isRecording, s.name).toBe(true)
    expect(details.audio.generatedSources.length).toBeGreaterThan(0)
    for (const s of details.audio.generatedSources) expect(s.isRecording, s.name).toBe(false)
    for (const s of details.audio.liveSynthesis) expect(s.isRecording, s.name).toBe(false)
  })

  it('ships the Phase 2 evidence files', () => {
    for (const f of ['evidence/stage2-visual-audit.md', 'evidence/stage2-desktop.png', 'evidence/stage2-narrow.png', 'evidence/stage2-capture.json', 'IMPLEMENTATION_PLAN.md']) {
      expect(existsSync(resolve(root, f)), f).toBe(true)
    }
    const plan = readFileSync(resolve(root, 'IMPLEMENTATION_PLAN.md'), 'utf8')
    for (const spec of ['nord-stage-4.visual.json', 'nord-stage-4.piano.json', 'nord-stage-4.effects.json']) expect(plan).toContain(spec)
    expect(plan).toMatch(/Hard gates/i)
  })
})

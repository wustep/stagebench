import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const json = (p: string) => JSON.parse(readFileSync(resolve(root, p), 'utf8'))

const REQUIRED = [
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

describe('evidence', () => {
  it('maps every Phase 1 feature id to real, non-empty test files', () => {
    const matrix = json('tests/feature-matrix.json')
    const byId = new Map<string, string[]>(matrix.features.map((f: { id: string; tests: string[] }) => [f.id, f.tests]))
    for (const id of REQUIRED) {
      const tests = byId.get(id)
      expect(tests, id).toBeDefined()
      expect(tests!.length, id).toBeGreaterThan(0)
      for (const t of tests!) {
        expect(existsSync(resolve(root, t)), t).toBe(true)
        expect(statSync(resolve(root, t)).size, t).toBeGreaterThan(200)
      }
    }
  })

  it('declares the audio source truthfully: generated buffers, no recordings', () => {
    const details = json('IMPLEMENTATION_DETAILS.json')
    expect(details.phase).toBe(1)
    expect(details.audio.sampleSources).toEqual([])
    expect(details.audio.generatedSources.length).toBeGreaterThan(0)
    for (const s of details.audio.generatedSources) expect(s.isRecording).toBe(false)
    expect(details.audio.strategy).toMatch(/GENERATED/)
  })
})

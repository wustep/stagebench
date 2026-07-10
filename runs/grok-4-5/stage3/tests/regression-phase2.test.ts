import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PianoEngine } from '../src/audio/piano-engine'
import { createMockContextFactory } from '../src/test/mock-audio'

describe('regression.phase2', () => {
  it('Phase 1–2 feature-matrix entries map to existing tests', () => {
    const matrixPath = path.join(process.cwd(), 'tests/feature-matrix.json')
    const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8')) as {
      stage: number
      features: { id: string; tests: string[] }[]
    }
    expect(matrix.stage).toBe(3)
    const required = [
      'visual.key-count',
      'piano.instrument-library',
      'piano.layers',
      'effects.graph',
      'effects.routing',
      'effects.processing',
      'regression.phase1',
      'programs.roundtrip',
      'organ.engine',
      'synth.sources',
      'system.integration',
    ]
    for (const id of required) {
      const feat = matrix.features.find((f) => f.id === id)
      expect(feat, id).toBeTruthy()
      for (const t of feat!.tests) {
        expect(fs.existsSync(path.join(process.cwd(), t)), t).toBe(true)
      }
    }
  })

  it('piano and effects still work after Phase 3 expansion', async () => {
    const { createContext } = createMockContextFactory()
    const engine = new PianoEngine({ useInlineSamples: true, createContext })
    await engine.init()
    expect(engine.getStatus()).toBe('ready')
    engine.setPianoState({ type: 'Grand', sectionOn: true })
    engine.noteOn(60, 0.8)
    expect(engine.getActiveVoiceCount()).toBe(1)
    engine.updateChain('PianoA', (c) => ({
      ...c,
      reverb: { ...c.reverb, on: true, mix: 0.5 },
    }))
    const e = await engine.measureEnergy({ velocity: 0.8 })
    expect(e).toBeGreaterThan(0)
    engine.allNotesOff()
    engine.dispose()
  })
})

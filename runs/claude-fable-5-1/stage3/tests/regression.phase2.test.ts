import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')

const PHASE1_IDS = ['visual.key-count', 'visual.section-layout', 'visual.control-inventory', 'interaction.keys', 'interaction.decorative-controls', 'accessibility.controls', 'piano.basic-note-lifecycle', 'piano.basic-inputs', 'piano.basic-sustain-polyphony', 'piano.basic-status-cleanup', 'regression.chassis']
const PHASE2_IDS = ['piano.instrument-library', 'piano.layers', 'piano.velocity-controls', 'piano.pedals', 'piano.fallback', 'effects.graph', 'effects.routing', 'effects.processing', 'regression.phase1']
const PHASE3_IDS = ['programs.roundtrip', 'programs.store-live', 'programs.undo-cancel', 'programs.navigation', 'layers.routing', 'splits.zones', 'morph.assignments', 'scenes.switching', 'organ.engine', 'organ.models-drawbars', 'organ.rotary', 'synth.sources', 'synth.filter-envelopes', 'synth.voice-modes', 'synth.arp-gate', 'system.integration', 'hardware.bindings', 'regression.phase2']

/** Phase 2 test files and the describe titles they carried when sealed. */
const PHASE2_TESTS: Record<string, string> = {
  'tests/piano.instrument-library.test.tsx': 'piano.instrument-library — six types, three recorded sets, truthful provenance, offline',
  'tests/piano.layers.test.tsx': 'piano.layers — two layers with enable, focus, level, octave and correct voice ownership',
  'tests/piano.velocity-controls.test.ts': 'piano.velocity-controls',
  'tests/piano.pedals.test.tsx': 'piano.pedals',
  'tests/piano.fallback.test.tsx': 'piano.fallback — asset failure enters a labelled, playable fallback and never reports the library ready',
  'tests/effects.graph.test.tsx': 'effects.graph — one AudioContext, layer buses, ordered effects, master gain/limiter, one destination, cleanup',
  'tests/effects.routing.test.tsx': 'effects.routing — focus, group, global, bypass, dry/wet, order, delay feedback path, To Rotary',
  'tests/effects.processing.test.ts': 'effects.processing',
  'tests/dsp.chain.test.ts': 'dsp.chain',
  'tests/regression.phase1.test.ts': 'regression.phase1 — every Phase 1 test, mapping and evidence file is preserved',
}

describe('regression.phase2 — every Phase 1–2 test, mapping and evidence file is preserved next to the Phase 3 work', () => {
  it('keeps every Phase 2 test file with its sealed describe block, non-empty', () => {
    for (const [file, title] of Object.entries(PHASE2_TESTS)) {
      const p = path.join(root, file)
      expect(existsSync(p), `${file} is missing`).toBe(true)
      const text = readFileSync(p, 'utf8')
      expect(text.length).toBeGreaterThan(500)
      expect(text).toContain(title)
      expect(text).toMatch(/\bit\(/)
    }
  })

  it('maps every Phase 1, 2 and 3 feature id to real, non-empty test files', () => {
    const matrix = JSON.parse(readFileSync(path.join(root, 'tests/feature-matrix.json'), 'utf8')) as { stage: number; features: { id: string; tests: string[] }[] }
    expect(matrix.stage).toBe(3)
    const ids = matrix.features.map((f) => f.id)
    for (const id of [...PHASE1_IDS, ...PHASE2_IDS, ...PHASE3_IDS]) expect(ids, `feature ${id} missing`).toContain(id)
    for (const f of matrix.features) {
      expect(f.tests.length).toBeGreaterThan(0)
      for (const t of f.tests) {
        const p = path.join(root, t)
        expect(existsSync(p), `${t} (for ${f.id}) is missing`).toBe(true)
        expect(statSync(p).size).toBeGreaterThan(500)
        expect(readFileSync(p, 'utf8')).toMatch(/\bit\(/)
      }
    }
  })

  it('keeps the sealed Phase 1 and Phase 2 evidence next to the Phase 3 evidence', () => {
    for (const stage of ['stage1', 'stage2']) {
      for (const f of [`${stage}-desktop.png`, `${stage}-narrow.png`, `${stage}-capture.json`, `${stage}-visual-audit.md`]) {
        expect(existsSync(path.join(root, 'evidence', f)), `evidence/${f}`).toBe(true)
      }
    }
  })

  it('IMPLEMENTATION_DETAILS.json declares Phase 3, keeps every bundled sample set, and describes organ / synth as live synthesis', () => {
    const details = JSON.parse(readFileSync(path.join(root, 'IMPLEMENTATION_DETAILS.json'), 'utf8'))
    expect(details.phase).toBe(3)
    const index = JSON.parse(readFileSync(path.join(root, 'public/samples/index.json'), 'utf8')) as { sets: { id: string }[] }
    for (const set of index.sets) expect(details.audio.sampleSources.some((d: { setId?: string }) => d.setId === set.id), set.id).toBe(true)
    const generated = details.audio.generatedSources as { name: string; kind: string; description: string; generator: string }[]
    const organ = generated.find((g) => /organ/i.test(g.name))!
    const synth = generated.find((g) => /synth/i.test(g.name))!
    expect(organ.kind).toBe('live-synthesis')
    expect(synth.kind).toBe('live-synthesis')
    expect(organ.generator).toContain('src/dsp/organ.ts')
    expect(synth.generator).toContain('src/dsp/synth.ts')
    for (const g of generated) expect(g.description).not.toMatch(/\bis a recording\b|\brecorded (at|by|with)\b/i)
    expect(details.controls.unsupported.length).toBeGreaterThan(5)
  })
})

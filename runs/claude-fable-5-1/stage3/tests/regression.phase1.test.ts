import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')
const PHASE1_IDS = [
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
const PHASE2_IDS = ['piano.instrument-library', 'piano.layers', 'piano.velocity-controls', 'piano.pedals', 'piano.fallback', 'effects.graph', 'effects.routing', 'effects.processing', 'regression.phase1']

/** Phase 1 test files and the describe titles they carried when sealed. */
const PHASE1_TESTS: Record<string, string> = {
  'tests/visual.key-count.test.tsx': 'visual.key-count — Stage 4 73 keybed',
  'tests/visual.section-layout.test.tsx': 'visual.section-layout — six sections, 54/46 split, continuous chassis',
  'tests/visual.control-inventory.test.tsx': 'visual.control-inventory — stable ids, landmarks, density, displays',
  'tests/interaction.keys.test.tsx': 'interaction.keys — pointer, touch, keyboard press / release / cancel / blur',
  'tests/interaction.decorative-controls.test.tsx': 'interaction.decorative-controls — every visible control moves or presses, presentation only',
  'tests/accessibility.controls.test.tsx': 'accessibility.controls — names, roles, values, keyboard operation, visible focus',
  'tests/piano.note-lifecycle.test.ts': 'piano.basic-note-lifecycle — one deterministic note lifecycle',
  'tests/piano.audio-signal.test.ts': 'piano audio signal — deterministic relationships on real sample data',
  'tests/piano.inputs.test.tsx': 'piano.basic-inputs — pointer, multi-touch, computer keyboard, MIDI',
  'tests/piano.sustain-polyphony.test.ts': 'piano.basic-sustain-polyphony — sustain transitions, concurrent voices, stealing, velocity',
  'tests/piano.status-cleanup.test.tsx': 'piano.basic-status-cleanup — truthful status and complete cleanup',
  'tests/regression.chassis.test.tsx': 'regression.chassis — no hero, no detached rails, no missing keys, no overflow or clipping',
}

describe('regression.phase1 — every Phase 1 test, mapping and evidence file is preserved', () => {
  it('keeps every Phase 1 test file with its sealed describe block, non-empty', () => {
    for (const [file, title] of Object.entries(PHASE1_TESTS)) {
      const p = path.join(root, file)
      expect(existsSync(p), `${file} is missing`).toBe(true)
      const text = readFileSync(p, 'utf8')
      expect(text.length).toBeGreaterThan(500)
      expect(text).toContain(title)
      expect(text).toMatch(/\bit\(/)
    }
  })

  it('maps every Phase 1 and Phase 2 feature id to real, non-empty test files', () => {
    const matrix = JSON.parse(readFileSync(path.join(root, 'tests/feature-matrix.json'), 'utf8')) as { stage: number; features: { id: string; tests: string[] }[] }
    expect(matrix.stage).toBe(3) // Phase 3 keeps every Phase 1 / 2 id and adds its own
    const ids = matrix.features.map((f) => f.id)
    for (const id of [...PHASE1_IDS, ...PHASE2_IDS]) expect(ids, `feature ${id} missing`).toContain(id)
    for (const f of matrix.features) {
      expect(f.tests.length).toBeGreaterThan(0)
      for (const t of f.tests) {
        const p = path.join(root, t)
        expect(existsSync(p), `${t} (for ${f.id}) is missing`).toBe(true)
        expect(statSync(p).size).toBeGreaterThan(500)
      }
    }
  })

  it('keeps the sealed Phase 1 evidence next to the Phase 2 evidence', () => {
    for (const f of ['stage1-desktop.png', 'stage1-narrow.png', 'stage1-capture.json', 'stage1-visual-audit.md']) {
      expect(existsSync(path.join(root, 'evidence', f)), `evidence/${f}`).toBe(true)
    }
  })

  it('IMPLEMENTATION_DETAILS.json declares the current phase with every bundled set, its licence, and truthful source kinds', () => {
    const details = JSON.parse(readFileSync(path.join(root, 'IMPLEMENTATION_DETAILS.json'), 'utf8'))
    expect(details.version).toBe(1)
    expect(details.phase).toBe(3)
    expect(typeof details.audio.strategy).toBe('string')
    const index = JSON.parse(readFileSync(path.join(root, 'public/samples/index.json'), 'utf8')) as { sets: { id: string; license: string }[] }
    const declared = details.audio.sampleSources as { name: string; source: string; license: string; setId?: string; files?: string[] }[]
    for (const set of index.sets) {
      const entry = declared.find((d) => d.setId === set.id)
      expect(entry, `sample source ${set.id} not declared`).toBeTruthy()
      expect(entry!.license).toBe(set.license)
      expect(entry!.files?.length ?? 0).toBeGreaterThan(0)
    }
    for (const g of details.audio.generatedSources as { name: string; kind: string; description: string }[]) {
      expect(g.kind).toMatch(/generated|synthesis/)
      // generated sources are described as generated / synthesised, never as recordings
      expect(g.description).toMatch(/generated|synthes|algorithmic|oscillator/i)
      expect(g.description).not.toMatch(/^\s*(a |the )?record(ed|ing)\b|\bis a recording\b|\brecorded (at|by|with)\b/i)
    }
    expect(details.unsupported ?? details.excluded).toBeTruthy()
  })
})

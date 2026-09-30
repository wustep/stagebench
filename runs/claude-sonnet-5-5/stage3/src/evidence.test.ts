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

const PHASE3 = [
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

describe('evidence', () => {
  const matrix = json('tests/feature-matrix.json')
  const byId = new Map<string, string[]>(matrix.features.map((f: { id: string; tests: string[] }) => [f.id, f.tests]))

  it('maps every Phase 1, Phase 2 and Phase 3 feature id to real, non-empty test files', () => {
    expect(matrix.stage).toBe(3)
    for (const id of [...PHASE1, ...PHASE2, ...PHASE3]) {
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
    const phase2Files = ['src/audio/rendered.piano.test.ts', 'src/audio/rendered.effects.test.ts', 'src/audio/graph.test.ts', 'src/audio/library.test.ts', 'src/audio/fallback.test.ts', 'src/engine/state.test.ts', 'src/engine/panelBindings.test.ts', 'src/app.phase2.test.tsx']
    for (const f of phase2Files) expect(existsSync(resolve(root, f)), f).toBe(true)
    expect(byId.get('regression.phase2')).toEqual(expect.arrayContaining(phase2Files))
  })

  it('declares audio sources truthfully: recordings are recordings, everything else is generated or synthesised', () => {
    const details = json('IMPLEMENTATION_DETAILS.json')
    expect(details.phase).toBe(3)
    expect(details.audio.strategy).toMatch(/GENERATED/)
    expect(details.audio.strategy).toMatch(/RECORDED/)
    expect(details.audio.sampleSources.length).toBeGreaterThanOrEqual(3)
    for (const s of details.audio.sampleSources) expect(s.isRecording, s.name).toBe(true)
    expect(details.audio.generatedSources.length).toBeGreaterThan(0)
    for (const s of details.audio.generatedSources) expect(s.isRecording, s.name).toBe(false)
    for (const s of details.audio.liveSynthesis) expect(s.isRecording, s.name).toBe(false)
    // Phase 3: the organ models and the synth are declared as live synthesis, never as recordings
    const names = details.audio.liveSynthesis.map((s: { name: string }) => s.name).join(' | ')
    for (const model of ['Organ B3', 'Organ Vox', 'Organ Farf', 'Organ Pipe', 'Synth engine']) expect(names).toContain(model)
    expect(details.audio.sampleSources.map((s: { id: string }) => s.id)).not.toContain('organ')
  })

  it('ships the Phase 3 evidence and a plan with the verbatim Phase 3 hard gates', () => {
    for (const f of ['evidence/stage3-visual-audit.md', 'evidence/stage3-desktop.png', 'evidence/stage3-narrow.png', 'evidence/stage3-capture.json', 'evidence/stage3-organ-zoom.png', 'evidence/stage3-synth-zoom.png', 'evidence/stage3-program-zoom.png']) {
      expect(existsSync(resolve(root, f)), f).toBe(true)
    }
    const plan = readFileSync(resolve(root, 'IMPLEMENTATION_PLAN.md'), 'utf8')
    for (const spec of ['nord-stage-4.visual.json', 'nord-stage-4.piano.json', 'nord-stage-4.effects.json', 'nord-stage-4.programs.json', 'nord-stage-4.organ.json', 'nord-stage-4.synth.json']) expect(plan).toContain(spec)
    // the Phase 3 hard gates of specs/benchmark-phases.json, verbatim (Oxford commas included)
    const gates = [
      'Program save/load round-trips all supported state across the 32 slots and 8 Live slots.',
      'Splits, crossfades, scenes, morphs, and layer routing are editable from the panel and observable in audio.',
      'B3, Vox, Farf, and Pipe organ engines and the required Synth source categories are audibly distinct, not renamed copies of one oscillator.',
      'Organ and Synth route through the Phase 2 graph with no separate AudioContext.',
      'All inherited visual, piano, effects, and input behavior remains regression-free.',
    ]
    for (const gate of gates) expect(plan, gate).toContain(`- [x] ${gate}`)
    const capture = json('evidence/stage3-capture.json')
    // Seal capture schema (bench/lib/run/capture.mjs): profiles with pageErrors/consoleMessages.
    expect(Array.isArray(capture.captures)).toBe(true)
    expect(capture.captures.length).toBeGreaterThanOrEqual(2)
    for (const shot of capture.captures) {
      expect(shot.pageErrors ?? []).toEqual([])
      expect((shot.consoleMessages ?? []).filter((m: { type?: string }) => m.type === 'error')).toEqual([])
    }
    const audit = readFileSync(resolve(root, 'evidence/stage3-visual-audit.md'), 'utf8')
    expect(audit).toMatch(/\b73\b/)
    expect(audit).toMatch(/0 unreachable at 1440/i)
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

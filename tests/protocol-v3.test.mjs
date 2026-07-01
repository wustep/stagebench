import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createBlindEvaluationBundle } from '../.agents/skills/run-nord-benchmark/lib/blind-evaluation.mjs'
import { createPhaseBundle, importPhaseBundle } from '../.agents/skills/run-nord-benchmark/lib/phase-bundle.mjs'
import {
  createRun,
  loadRun,
  markStage,
  prepareStage,
  recordRunTelemetry,
  reindexRegistry,
} from '../.agents/skills/run-nord-benchmark/lib/run-store.mjs'
import { readJson, writeJson } from '../.agents/skills/run-nord-benchmark/lib/cli.mjs'
import { hashTree } from '../.agents/skills/run-nord-benchmark/lib/protocol.mjs'
import { validateRepositoryData } from '../scripts/validate-data.mjs'

const sourceRoot = path.resolve(import.meta.dirname, '..')

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-v3-'))
  for (const directory of ['specs', 'prompts', 'evaluation/rubrics', 'src/data', 'schemas', 'runs']) fs.mkdirSync(path.join(root, directory), { recursive: true })
  for (const relative of [
    'BENCHMARK.md', 'TESTING.md', 'package.json',
    'specs/benchmark-phases.json', 'specs/nord-stage-4.variants.json', 'specs/nord-stage-4.visual.json', 'specs/nord-stage-4.piano.json', 'specs/nord-stage-4.effects.json', 'specs/nord-stage-4.programs.json', 'specs/nord-stage-4.organ.json', 'specs/nord-stage-4.synth.json',
    'prompts/stage1.md', 'prompts/stage2.md', 'prompts/stage3.md', 'evaluation/rubrics/v3.json',
    'schemas/assessment.schema.json', 'schemas/feature-matrix.schema.json', 'schemas/implementation-details.schema.json', 'schemas/capture.schema.json',
  ]) {
    const destination = path.join(root, relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(sourceRoot, relative), destination)
  }
  writeJson(path.join(root, 'src/data/runs.json'), [])
  return root
}

test('v3 target selection, state machine, telemetry, registry, isolation, and blinding work together', () => {
  const root = fixtureRoot()
  try {
    const created = createRun(root, { model: 'Fixture Model', provider: 'Fixture Provider', targetPhase: 3, reasoning: 'test' }, new Date('2026-01-01T00:00:00.000Z'))
    assert.deepEqual(created.selectedPhases, [1, 2, 3])
    assert.equal(created.run.classification.kind, 'exploratory')
    assert.equal(readJson(path.join(root, 'src/data/runs.json')).length, 0, 'create must not dual-write the generated registry')

    prepareStage(root, created.id, 1)
    markStage(root, created.id, 1, 'running')
    assert.throws(() => prepareStage(root, created.id, 2), /must be complete/)
    const bundle = createPhaseBundle(root, created.id, 1)
    assert.ok(fs.existsSync(path.join(bundle.inputs, 'prompts/stage1.md')))
    assert.ok(!fs.existsSync(path.join(bundle.inputs, 'prompts/stage2.md')), 'future prompt must be absent')
    assert.ok(!fs.existsSync(path.join(bundle.workspace, 'runs')), 'other solutions must be absent')
    fs.writeFileSync(path.join(bundle.candidate, 'index.html'), '<h1>candidate</h1>')
    const imported = importPhaseBundle(root, created.id, 1)
    assert.match(imported.candidateDigest, /^[a-f0-9]{64}$/)
    assert.ok(fs.existsSync(path.join(created.stageDir, 'index.html')))
    writeJson(path.join(root, 'runs', created.id, 'verifications', 'stage1.json'), { passed: true, artifactDigest: hashTree(created.stageDir).digest })
    markStage(root, created.id, 1, 'complete')
    prepareStage(root, created.id, 2)
    assert.equal(loadRun(root, created.id).stages[1].status, 'prepared')

    recordRunTelemetry(root, created.id, { phase: 1, wallTimeSeconds: 120, inputTokens: 1000, kind: 'measured' })
    const telemetry = loadRun(root, created.id).telemetry
    assert.equal(telemetry.totals.wallTimeSeconds.value, 120)
    assert.equal(telemetry.totals.inputTokens.kind, 'measured')

    const blind = createBlindEvaluationBundle(root, created.id, 1)
    assert.match(blind.blindId, /^trial-[a-f0-9]{16}$/)
    assert.ok(!fs.existsSync(path.join(blind.bundle, 'run.json')))
    assert.equal(readJson(blind.mapping).runId, created.id)

    const indexed = reindexRegistry(root)
    assert.equal(indexed.count, 1)
    assert.equal(readJson(path.join(root, 'src/data/runs.json'))[0].id, created.id)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('repository persisted data validates against the schema suite', () => {
  const result = validateRepositoryData(sourceRoot)
  assert.equal(result.ok, true)
  assert.ok(result.checks > 20)
})

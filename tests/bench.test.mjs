import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readJson, writeJson } from '../bench/lib/shared.mjs'
import { createRun, loadRun, markSealed, recordTelemetry, registerEvaluation, registryEntry, reindexRegistry, statusSummary } from '../bench/lib/run/store.mjs'
import { importWorkspace, startPhase } from '../bench/lib/run/workspace.mjs'
import { REQUIRED_FEATURES, runChecks, verifyPhase } from '../bench/lib/run/verify.mjs'
import { loadRubric } from '../bench/lib/eval/evaluate.mjs'
import { aggregateStageEvaluations, createAssessmentTemplate, scoreAssessment } from '../bench/lib/eval/scoring.mjs'
import { renderRunReportHtml, renderRunReportMarkdown } from '../bench/lib/eval/report.mjs'
import { collectImplementationDetails, validateImplementationManifest } from '../bench/lib/implementation-details.mjs'

const sourceRoot = path.resolve(import.meta.dirname, '..')

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-bench-'))
  for (const relative of [
    'BENCHMARK.md', 'package.json',
    'specs/benchmark-phases.json', 'specs/nord-stage-4.variants.json', 'specs/nord-stage-4.visual.json', 'specs/nord-stage-4.piano.json',
    'prompts/stage1.md',
    'bench/schemas/implementation-details.schema.json',
    'bench/starter/package.json', 'bench/starter/index.html',
  ]) {
    const destination = path.join(root, relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(sourceRoot, relative), destination)
  }
  writeJson(path.join(root, 'src/data/runs.json'), [])
  return root
}

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).copy(bytes)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function writePassingCandidate(root, candidate) {
  const manifest = readJson(path.join(root, 'specs', 'benchmark-phases.json'))
  const contract = manifest.phases.find((entry) => entry.number === 1)
  fs.rmSync(candidate, { recursive: true, force: true })
  fs.mkdirSync(path.join(candidate, 'src'), { recursive: true })
  fs.mkdirSync(path.join(candidate, 'tests'), { recursive: true })
  fs.mkdirSync(path.join(candidate, 'evidence'), { recursive: true })
  fs.writeFileSync(path.join(candidate, 'package.json'), JSON.stringify({
    packageManager: 'pnpm@11.7.0',
    scripts: { test: 'true', typecheck: 'true', lint: 'true', build: 'true' },
  }))
  fs.writeFileSync(path.join(candidate, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
  fs.writeFileSync(path.join(candidate, 'IMPLEMENTATION_PLAN.md'), [
    '# Plan', '',
    `Specs: ${contract.specs.map((spec) => path.basename(spec)).join(', ')}`, '',
    '## Hard gates', '',
    ...contract.hardGates.map((gate) => `- [x] ${gate}`), '',
  ].join('\n'))
  writeJson(path.join(candidate, 'IMPLEMENTATION_DETAILS.json'), {
    version: 1,
    phase: 1,
    audio: { strategy: 'Generated basic piano voice', generatedSources: [{ name: 'Basic piano', method: 'Web Audio synthesis' }], sampleSources: [], notes: [] },
  })
  fs.writeFileSync(path.join(candidate, 'src', 'benchmark.test.js'), 'export const covered = true\n')
  writeJson(path.join(candidate, 'tests', 'feature-matrix.json'), {
    version: 1,
    stage: 1,
    features: REQUIRED_FEATURES[1].map((id) => ({ id, tests: ['src/benchmark.test.js'] })),
  })
  fs.writeFileSync(path.join(candidate, 'evidence', 'stage1-visual-audit.md'), 'Measured and exercised the fixture candidate.')
}

test('a run flows new → start → seal → score with sealed digests and a scored registry entry', () => {
  const root = fixtureRoot()
  try {
    const created = createRun(root, { model: 'Fixture Model', provider: 'fixture', target: '1' }, new Date('2026-01-01T00:00:00.000Z'))
    assert.deepEqual(created.selectedPhases, [1])
    assert.equal(created.run.schemaVersion, 4)
    assert.equal(created.run.status, 'in-progress')

    // start: isolated workspace with only this phase's inputs
    const started = startPhase(root, created.id)
    assert.equal(started.phase, 1)
    assert.ok(fs.existsSync(path.join(started.inputs, 'prompts/stage1.md')))
    assert.ok(!fs.existsSync(path.join(started.inputs, 'prompts/stage2.md')), 'future prompts must be absent')
    assert.ok(!fs.existsSync(path.join(started.workspace, 'runs')), 'other solutions must be absent')
    assert.equal(loadRun(root, created.id).stages[0].status, 'running')
    assert.match(statusSummary(loadRun(root, created.id)).next, /seal/)

    // the "agent" produces a passing candidate
    writePassingCandidate(root, started.candidate)

    // seal: import, check, verify (evidence pre-captured for the fixture), mark complete
    importWorkspace(root, created.id, 1)
    const stageDir = path.join(root, 'runs', created.id, 'stage1')
    fs.mkdirSync(path.join(stageDir, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(stageDir, 'dist', 'index.html'), '<h1>candidate</h1>')
    fs.writeFileSync(path.join(stageDir, 'evidence', 'stage1-desktop.png'), pngHeader(1440, 900))
    fs.writeFileSync(path.join(stageDir, 'evidence', 'stage1-narrow.png'), pngHeader(390, 844))
    writeJson(path.join(stageDir, 'evidence', 'stage1-capture.json'), { version: 1, phase: 1, captures: [] })

    const checks = runChecks(stageDir)
    assert.ok(checks.every((check) => check.passed), JSON.stringify(checks.filter((check) => !check.passed)))
    const verification = verifyPhase(root, created.id, 1, { checks })
    assert.equal(verification.passed, true)
    assert.match(verification.artifactDigest, /^[a-f0-9]{64}$/)
    assert.equal(verification.featureMatrix.requiredFeatures, REQUIRED_FEATURES[1].length)
    writeJson(path.join(root, 'runs', created.id, 'verifications', 'stage1.json'), verification)

    markSealed(root, created.id, 1, verification)
    const sealed = loadRun(root, created.id)
    assert.equal(sealed.stages[0].status, 'complete')
    assert.equal(sealed.status, 'complete')
    assert.equal(sealed.previews['1'], `/previews/${created.id}/stage1/index.html`)
    assert.ok(fs.existsSync(path.join(root, 'public', 'previews', created.id, 'stage1', 'index.html')))

    // wall time is recorded automatically; usage is recorded explicitly and
    // rolled up into run totals
    assert.equal(typeof sealed.stages[0].telemetry.wallTimeSeconds, 'number')
    recordTelemetry(root, created.id, 1, { costUsd: '12.5', inputTokens: 1_200_000, outputTokens: 300000, toolCalls: 42 })
    const withUsage = loadRun(root, created.id)
    assert.equal(withUsage.stages[0].telemetry.costUsd, 12.5)
    assert.equal(withUsage.telemetry.costUsd, 12.5)
    assert.equal(withUsage.telemetry.inputTokens, 1_200_000)
    assert.equal(withUsage.telemetry.reasoningTokens, null, 'unrecorded telemetry stays null, never zero')
    assert.throws(() => recordTelemetry(root, created.id, 1, { costUsd: -1 }), /non-negative/)

    // tampering after sealing is detected
    fs.writeFileSync(path.join(stageDir, 'tampered.txt'), 'oops')
    assert.throws(() => markSealed(root, created.id, 1, verification), /must be running/)
    fs.rmSync(path.join(stageDir, 'tampered.txt'))

    // score: template → filled assessment → deterministic score, no grades
    const rubric = loadRubric()
    const assessment = createAssessmentTemplate(rubric, created.id, 1)
    assessment.evaluator = 'Fixture evaluator'
    assessment.evaluatedAt = '2026-01-02T00:00:00.000Z'
    assessment.summary = 'Synthetic assessment for the pipeline test.'
    for (const category of assessment.categories) {
      for (const criterion of category.criteria) {
        criterion.rating = 3
        criterion.evidence = ['Fixture evidence']
      }
    }
    const evaluation = scoreAssessment(rubric, assessment, [{ id: 'build', passed: true }])
    assert.equal(evaluation.score, 75)
    assert.equal('grade' in evaluation, false, 'grades are no longer part of evaluations')

    const capped = scoreAssessment(rubric, assessment, [{ id: 'build', passed: false }])
    assert.equal(capped.score, 59)
    assert.equal(capped.rawScore, 75)

    const aggregate = { ...aggregateStageEvaluations(rubric, [evaluation]), reportPath: `/reports/${created.id}/index.html` }
    assert.equal(aggregate.score, 75)
    registerEvaluation(root, created.id, 1, {
      status: 'complete', score: evaluation.score, rawScore: evaluation.rawScore,
      evaluatedAt: evaluation.evaluatedAt, rubricVersion: evaluation.rubricVersion,
      path: `runs/${created.id}/evaluations/stage1.json`, reportPath: `${aggregate.reportPath}#stage-1`,
      categoryScores: {},
    }, aggregate)

    // reports render scores without grade labels
    const scoredRun = loadRun(root, created.id)
    const html = renderRunReportHtml(scoredRun, [evaluation], collectImplementationDetails(root, scoredRun))
    const markdown = renderRunReportMarkdown(scoredRun, [evaluation], null)
    assert.match(html, /\/100/)
    assert.doesNotMatch(html, /competent|exceptional|developing/i)
    assert.match(markdown, /\*\*75\/100\*\*/)

    // reindex: uniform projection for the gallery
    const indexed = reindexRegistry(root)
    assert.equal(indexed.count, 1)
    const entry = readJson(path.join(root, 'src', 'data', 'runs.json'))[0]
    assert.equal(entry.legacy, false)
    assert.equal(entry.status, 'complete')
    assert.equal(entry.score, 75)
    assert.equal(entry.stages[0].score, 75)
    assert.equal(entry.telemetry.costUsd, 12.5)
    assert.equal(entry.telemetry.outputTokens, 300000)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('pre-v4 run records project into frozen legacy registry entries', () => {
  const legacy = registryEntry({
    schemaVersion: 3,
    id: 'old-run',
    model: 'old-model',
    title: 'Old Run',
    variant: 'stage-4-73',
    target: 'Stage 4 73',
    status: 'complete',
    validity: 'valid',
    classification: { kind: 'exploratory', comparable: false },
    startedAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    previewPath: '/previews/old-run/stage2/index.html',
    previewStage: 2,
    previews: { 1: '/previews/old-run/stage1/index.html', 2: '/previews/old-run/stage2/index.html' },
    evaluation: { score: 96, grade: 'exceptional', reportPath: '/reports/old-run/index.html' },
    telemetry: { status: 'partial', totals: { wallTimeSeconds: { value: 16031, kind: 'measured' }, outputTokens: { value: 848941, kind: 'measured' }, costUsd: { value: null, kind: 'unavailable' } } },
    stages: [
      { number: 1, status: 'complete', evaluation: { score: 96, grade: 'exceptional', reportPath: '/reports/old-run/index.html#stage-1' } },
      { number: 2, status: 'verifying' },
    ],
  })
  assert.equal(legacy.legacy, true)
  assert.equal(legacy.status, 'legacy')
  assert.equal(legacy.score, 96)
  assert.equal(legacy.reportPath, '/reports/old-run/index.html')
  assert.equal(legacy.telemetry.wallTimeSeconds, 16031)
  assert.equal(legacy.telemetry.outputTokens, 848941)
  assert.equal(legacy.telemetry.costUsd, null)
  assert.deepEqual(legacy.stages, [
    { number: 1, status: 'complete', score: 96, reportPath: '/reports/old-run/index.html#stage-1' },
    { number: 2, status: 'running', score: null, reportPath: null },
  ])
  assert.equal('grade' in legacy, false)
})

test('implementation manifest validation rejects dishonest or malformed declarations', () => {
  assert.throws(() => validateImplementationManifest({ version: 1, phase: 2, audio: { strategy: 'x', sampleSources: [] } }, 1), /phase must be 1/)
  assert.throws(() => validateImplementationManifest({ version: 1, phase: 1, audio: { strategy: '', sampleSources: [] } }, 1), /strategy/)
  assert.throws(() => validateImplementationManifest({ version: 1, phase: 1, audio: { strategy: 'x', sampleSources: [{ name: 'a', source: 'b' }] } }, 1), /license/)
})

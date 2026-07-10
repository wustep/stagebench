import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { blindRunCode, hashTree, readJson, workspaceRoot, writeJson } from '../bench/lib/shared.mjs'
import { createRun, loadRun, markSealed, promoteRun, recordTelemetry, registerEvaluation, registryEntry, reindexRegistry, statusSummary } from '../bench/lib/run/store.mjs'
import { exportRun, __internals as exportInternals } from '../bench/lib/run/export.mjs'
import { importWorkspace, startPhase } from '../bench/lib/run/workspace.mjs'
import { REQUIRED_FEATURES, runChecks, verifyPhase } from '../bench/lib/run/verify.mjs'
import { loadRubric } from '../bench/lib/eval/evaluate.mjs'
import { createEvalWorkspace, removeEvalWorkspace } from '../bench/lib/eval/workspace.mjs'
import { aggregateStageEvaluations, createAssessmentTemplate, mergeAssessments, scoreAssessment } from '../bench/lib/eval/scoring.mjs'
import { renderRunReportHtml, renderRunReportMarkdown } from '../bench/lib/eval/report.mjs'
import { collectImplementationDetails, validateImplementationManifest } from '../bench/lib/implementation-details.mjs'

const sourceRoot = path.resolve(import.meta.dirname, '..')

// Transient workspaces live outside the repo under STAGEBENCH_HOME; point it at
// a temp dir so tests never touch the real ~/.stagebench and clean up after.
const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-home-'))
process.env.STAGEBENCH_HOME = homeRoot
after(() => fs.rmSync(homeRoot, { recursive: true, force: true }))

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-bench-'))
  for (const relative of [
    'BENCHMARK.md', 'TASK.md', 'package.json',
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

test('a run flows new → start → seal → score with sealed digests and a scored registry entry', async () => {
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
    assert.ok(!fs.existsSync(path.join(started.inputs, 'BENCHMARK.md')), 'harness and scoring docs must be absent')
    const task = fs.readFileSync(path.join(started.inputs, 'TASK.md'), 'utf8')
    assert.match(task, /`piano\.basic-note-lifecycle`/, 'current-phase feature IDs are present')
    assert.doesNotMatch(task, /piano\.instrument-library/, 'future-phase feature IDs are filtered out')
    assert.doesNotMatch(task, /stagebench:phase/, 'filter markers are stripped')
    const workspaceManifest = readJson(path.join(started.inputs, 'specs/benchmark-phases.json'))
    assert.deepEqual(workspaceManifest.phases.map((entry) => entry.number), [1], 'future phase contracts are filtered out')
    assert.equal('selection' in workspaceManifest, false, 'harness bookkeeping is dropped')
    const workspaceVariants = readJson(path.join(started.inputs, 'specs/nord-stage-4.variants.json'))
    assert.deepEqual(workspaceVariants.variants.map((entry) => entry.id), ['stage-4-73'], 'only the assigned variant is included')
    assert.equal(workspaceManifest.defaultVariant, 'stage-4-73', 'projected defaultVariant names a variant the candidate can see')
    // Workspaces live outside the repo tree so a candidate cannot reach runs/
    // or other solutions with a relative ../..
    assert.ok(!started.workspace.startsWith(`${root}${path.sep}`), 'the implementation workspace is outside the repo')
    assert.ok(started.workspace.startsWith(`${homeRoot}${path.sep}`), 'the workspace lives under STAGEBENCH_HOME')
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

    const checks = await runChecks(stageDir)
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
    recordTelemetry(root, created.id, 1, { costUsd: '12.5', totalTokens: 1_500_000, inputTokens: 1_200_000, outputTokens: 300000, toolCalls: 42 })
    const withUsage = loadRun(root, created.id)
    assert.equal(withUsage.stages[0].telemetry.costUsd, 12.5)
    assert.equal(withUsage.telemetry.costUsd, 12.5)
    assert.equal(withUsage.telemetry.inputTokens, 1_200_000)
    assert.equal(withUsage.telemetry.totalTokens, 1_500_000)
    assert.equal(withUsage.telemetry.reasoningTokens, null, 'unrecorded telemetry stays null, never zero')
    assert.throws(() => recordTelemetry(root, created.id, 1, { costUsd: -1 }), /non-negative/)

    // tampering after sealing is detected
    fs.writeFileSync(path.join(stageDir, 'tampered.txt'), 'oops')
    assert.throws(() => markSealed(root, created.id, 1, verification), /must be running/)
    fs.rmSync(path.join(stageDir, 'tampered.txt'))

    // score: isolated evaluator workspace → filled assessment → deterministic
    // score, no grades
    const rubric = loadRubric()
    const evalWorkspace = createEvalWorkspace(root, {
      id: created.id,
      phase: 1,
      variantId: 'stage-4-73',
      stageDir,
      verificationPath: path.join(root, 'runs', created.id, 'verifications', 'stage1.json'),
      expectedDigest: verification.artifactDigest,
      rubric,
    })
    assert.ok(fs.existsSync(path.join(evalWorkspace.artifact, 'package.json')), 'the evaluator gets a copy of the sealed artifact')
    assert.ok(fs.existsSync(path.join(evalWorkspace.artifact, 'dist', 'index.html')), 'the built app is included')
    assert.ok(fs.existsSync(path.join(evalWorkspace.workspace, 'EVAL.md')), 'evaluator instructions are included')
    assert.ok(fs.existsSync(path.join(evalWorkspace.inputs, 'rubric.json')), 'the rubric is scoped to the evaluator, not the candidate')
    assert.ok(fs.existsSync(path.join(evalWorkspace.inputs, 'verification.json')), 'the sealed verification record is included')
    assert.doesNotMatch(fs.readFileSync(path.join(evalWorkspace.inputs, 'TASK.md'), 'utf8'), /piano\.instrument-library/, 'the evaluator task is filtered to the scored phase')
    // Isolation + blinding: the evaluator workspace is outside the repo and its
    // path carries the blind handle, not the model id.
    assert.ok(!evalWorkspace.workspace.startsWith(`${root}${path.sep}`), 'the evaluator workspace is outside the repo')
    assert.equal(evalWorkspace.blindId, blindRunCode(created.id))
    assert.ok(!evalWorkspace.workspace.includes(created.id), 'the model id is not printed in the evaluator path')
    assert.ok(fs.readFileSync(path.join(evalWorkspace.workspace, 'EVAL.md'), 'utf8').includes('blind'), 'EVAL.md states the evaluation is blind')
    assert.equal(readJson(evalWorkspace.assessment).runId, blindRunCode(created.id), 'the template is identified by the blind handle')

    const assessment = readJson(evalWorkspace.assessment)
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
    removeEvalWorkspace(root, created.id, 1)
    assert.ok(!fs.existsSync(evalWorkspace.workspace), 'the evaluator workspace is removed after registration')

    // reports render scores without grade labels
    const scoredRun = loadRun(root, created.id)
    const html = renderRunReportHtml(scoredRun, [evaluation], collectImplementationDetails(root, scoredRun))
    const markdown = renderRunReportMarkdown(scoredRun, [evaluation], null)
    assert.match(html, /\/100/)
    assert.doesNotMatch(html, /competent|exceptional|developing/i)
    assert.match(markdown, /\*\*75\/100\*\*/)

    // reindex: uniform projection for the gallery
    const indexed = await reindexRegistry(root)
    assert.equal(indexed.count, 1)
    const entry = readJson(path.join(root, 'src', 'data', 'runs.json'))[0]
    assert.equal(entry.legacy, false)
    assert.equal(entry.status, 'complete')
    assert.equal(entry.score, 75)
    assert.equal(entry.stages[0].score, 75)
    assert.equal(entry.telemetry.costUsd, 12.5)
    assert.equal(entry.telemetry.totalTokens, 1_500_000)
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

test('promote replaces an obsolete run and preserves sealed stage contents', async () => {
  const root = fixtureRoot()
  try {
    const obsolete = createRun(root, { model: 'clean-id', target: '1' })
    const replacement = createRun(root, { model: 'replacement-model', target: '1' })
    const replacementRun = loadRun(root, replacement.id)
    replacementRun.status = 'complete'
    replacementRun.previewPath = `/previews/${replacement.id}/stage1/index.html`
    replacementRun.previews = { 1: replacementRun.previewPath }
    replacementRun.evaluation = { reportPath: `/reports/${replacement.id}/index.html` }
    replacementRun.stages[0].status = 'complete'
    replacementRun.stages[0].verificationPath = `runs/${replacement.id}/verifications/stage1.json`
    replacementRun.stages[0].evaluation = {
      path: `runs/${replacement.id}/evaluations/stage1.json`,
      reportPath: `/reports/${replacement.id}/index.html#stage-1`,
    }
    writeJson(path.join(root, 'runs', replacement.id, 'run.json'), replacementRun)

    fs.mkdirSync(path.join(root, 'runs', replacement.id, 'stage1'), { recursive: true })
    fs.writeFileSync(path.join(root, 'runs', replacement.id, 'stage1', 'sealed.txt'), replacement.id)
    writeJson(path.join(root, 'runs', replacement.id, 'evaluations', 'stage1.json'), { runId: replacement.id })
    writeJson(path.join(root, 'runs', replacement.id, 'verifications', 'stage1.json'), { runId: replacement.id })
    fs.mkdirSync(path.join(root, 'public', 'previews', replacement.id, 'stage1'), { recursive: true })
    fs.writeFileSync(path.join(root, 'public', 'previews', replacement.id, 'stage1', 'index.html'), '<h1>replacement</h1>')
    fs.mkdirSync(path.join(root, 'public', 'reports', replacement.id), { recursive: true })
    fs.writeFileSync(path.join(root, 'public', 'reports', replacement.id, 'index.html'), replacement.id)

    const promoted = promoteRun(root, replacement.id, obsolete.id, { replace: true })
    assert.equal(promoted.id, obsolete.id)
    assert.equal(loadRun(root, obsolete.id).model, 'replacement-model')
    assert.equal(loadRun(root, obsolete.id).previewPath, `/previews/${obsolete.id}/stage1/index.html`)
    assert.equal(readJson(path.join(root, 'runs', obsolete.id, 'evaluations', 'stage1.json')).runId, obsolete.id)
    assert.equal(readJson(path.join(root, 'runs', obsolete.id, 'verifications', 'stage1.json')).runId, obsolete.id)
    assert.equal(fs.readFileSync(path.join(root, 'public', 'reports', obsolete.id, 'index.html'), 'utf8'), obsolete.id)
    assert.equal(fs.readFileSync(path.join(root, 'runs', obsolete.id, 'stage1', 'sealed.txt'), 'utf8'), replacement.id, 'sealed stage contents are not rewritten')
    assert.ok(!fs.existsSync(path.join(root, 'runs', replacement.id)))

    await reindexRegistry(root)
    assert.deepEqual(readJson(path.join(root, 'src', 'data', 'runs.json')).map((run) => run.id), [obsolete.id])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the evaluator workspace rejects a sealed artifact whose digest drifted', () => {
  const root = fixtureRoot()
  try {
    const created = createRun(root, { model: 'Digest Fixture', target: '1' })
    const stageDir = path.join(root, 'runs', created.id, 'stage1')
    fs.mkdirSync(stageDir, { recursive: true })
    fs.writeFileSync(path.join(stageDir, 'index.html'), '<h1>sealed</h1>')
    const rubric = loadRubric()
    // The wrong digest is caught before any template is written.
    assert.throws(() => createEvalWorkspace(root, {
      id: created.id, phase: 1, variantId: 'stage-4-73', stageDir, rubric,
      expectedDigest: '0'.repeat(64),
    }), /changed since sealing/)
    // The matching digest builds the workspace out of the repo under the blind handle.
    const built = createEvalWorkspace(root, {
      id: created.id, phase: 1, variantId: 'stage-4-73', stageDir, rubric,
      expectedDigest: hashTree(stageDir).digest,
    })
    assert.ok(built.workspace.startsWith(`${workspaceRoot(root, 'eval')}${path.sep}`))
    assert.ok(built.workspace.includes(blindRunCode(created.id)))
    removeEvalWorkspace(root, created.id, 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a panel merges to the per-criterion median rating with unioned evidence', () => {
  const rubric = loadRubric()
  const make = (evaluator, rating) => {
    const template = createAssessmentTemplate(rubric, 'run-blind', 1)
    template.evaluator = evaluator
    template.evaluatedAt = '2026-01-02T00:00:00.000Z'
    template.summary = `Summary from ${evaluator}.`
    for (const category of template.categories) {
      for (const criterion of category.criteria) {
        criterion.rating = rating
        criterion.evidence = [`${evaluator} saw rating ${rating}`]
      }
    }
    return template
  }

  // A single-evaluator panel is a passthrough.
  const solo = mergeAssessments(rubric, [make('Solo', 3)])
  assert.equal(solo.evaluator, 'Solo')

  // Odd panel: median of {1,3,4} is 3.
  const merged = mergeAssessments(rubric, [make('A', 1), make('B', 3), make('C', 4)])
  for (const category of merged.categories) {
    for (const criterion of category.criteria) {
      assert.equal(criterion.rating, 3, `${category.id}.${criterion.id} takes the median`)
      assert.equal(criterion.evidence.length, 3, 'evidence from every evaluator is retained')
      assert.ok(criterion.evidence.every((item) => /^\[(A|B|C)\]/.test(item)), 'evidence is attributed')
    }
  }
  assert.match(merged.evaluator, /Panel median of 3/)
  assert.equal(merged.panel.length, 3)
  // The merged assessment scores like any other and is deterministic.
  const evaluation = scoreAssessment(rubric, { ...merged, runId: 'real-run' }, [{ id: 'build', passed: true }])
  assert.equal(evaluation.score, 75)
})

test('implementation manifest validation rejects dishonest or malformed declarations', () => {
  assert.throws(() => validateImplementationManifest({ version: 1, phase: 2, audio: { strategy: 'x', sampleSources: [] } }, 1), /phase must be 1/)
  assert.throws(() => validateImplementationManifest({ version: 1, phase: 1, audio: { strategy: '', sampleSources: [] } }, 1), /strategy/)
  assert.throws(() => validateImplementationManifest({ version: 1, phase: 1, audio: { strategy: 'x', sampleSources: [{ name: 'a', source: 'b' }] } }, 1), /license/)
})

// Parse a store-only ZIP's central directory into { name -> { data, crc } }.
function readZip(buffer) {
  const eocdSignature = 0x06054b50
  let eocd = buffer.length - 22
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== eocdSignature) eocd -= 1
  assert.ok(eocd >= 0, 'ZIP end-of-central-directory record must exist')
  const total = buffer.readUInt16LE(eocd + 10)
  let pointer = buffer.readUInt32LE(eocd + 16)
  const entries = {}
  for (let i = 0; i < total; i += 1) {
    assert.equal(buffer.readUInt32LE(pointer), 0x02014b50, 'central directory header signature')
    const crc = buffer.readUInt32LE(pointer + 16)
    const size = buffer.readUInt32LE(pointer + 24)
    const nameLength = buffer.readUInt16LE(pointer + 28)
    const extraLength = buffer.readUInt16LE(pointer + 30)
    const commentLength = buffer.readUInt16LE(pointer + 32)
    const localOffset = buffer.readUInt32LE(pointer + 42)
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength)
    // Read the stored (uncompressed) bytes straight after the local header.
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    entries[name] = { data: buffer.subarray(dataStart, dataStart + size), crc }
    pointer += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

test('export bundles run artifacts into a valid ZIP and never includes reference material', () => {
  const root = fixtureRoot()
  try {
    // A minimal run on disk with run.json plus an evaluations report.
    const runId = 'export-fixture'
    const runDir = path.join(root, 'runs', runId)
    fs.mkdirSync(path.join(runDir, 'evaluations'), { recursive: true })
    writeJson(path.join(runDir, 'run.json'), {
      schemaVersion: 4, id: runId, model: 'export-model', title: 'Export Fixture',
      protocol: { version: '1.0.0' }, status: 'complete', startedAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z', stages: [{ number: 1, status: 'complete' }],
    })
    fs.writeFileSync(path.join(runDir, 'evaluations', 'report.md'), '# Report\n')
    // Published report + preview.
    fs.mkdirSync(path.join(root, 'public', 'reports', runId), { recursive: true })
    fs.writeFileSync(path.join(root, 'public', 'reports', runId, 'index.html'), '<html>report</html>')
    fs.mkdirSync(path.join(root, 'public', 'previews', runId), { recursive: true })
    fs.writeFileSync(path.join(root, 'public', 'previews', runId, 'index.html'), '<html>preview</html>')
    // Copyrighted reference material that must never enter the bundle.
    fs.mkdirSync(path.join(root, 'reference'), { recursive: true })
    fs.writeFileSync(path.join(root, 'reference', 'manual.pdf'), 'SECRET COPYRIGHTED MANUAL')

    const result = exportRun(root, runId, { out: `runs/${runId}/${runId}.zip` })
    const zip = readZip(fs.readFileSync(path.join(root, result.output)))
    const names = Object.keys(zip)

    // Required contents are present under the run-id prefix.
    assert.ok(names.includes(`${runId}/run.json`), 'run.json is bundled')
    assert.ok(names.includes(`${runId}/evaluations/report.md`), 'evaluations are bundled')
    assert.ok(names.includes(`${runId}/report/index.html`), 'static report is bundled')
    assert.ok(names.includes(`${runId}/preview/index.html`), 'preview build is bundled')
    assert.ok(names.includes(`${runId}/manifest.json`), 'manifest is bundled')

    // No reference/ material and no bytes matching the decoy manual anywhere.
    assert.ok(!names.some((name) => /reference/i.test(name) || /manual\.pdf$/i.test(name)), 'no reference paths')
    for (const { data } of Object.values(zip)) {
      assert.ok(!data.includes(Buffer.from('SECRET COPYRIGHTED MANUAL')), 'no copyrighted bytes leak in')
    }

    // Stored entries carry a correct CRC-32 so the archive is not corrupt.
    for (const { data, crc } of Object.values(zip)) {
      assert.equal(exportInternals.crc32(data), crc, 'stored entry CRC matches')
    }

    // Manifest records identity and protocol version.
    const manifest = JSON.parse(zip[`${runId}/manifest.json`].data.toString())
    assert.equal(manifest.runId, runId)
    assert.equal(manifest.protocolVersion, '1.0.0')
    assert.ok(typeof manifest.exportedAt === 'string')

    // An unknown run id fails loudly rather than producing an empty archive.
    assert.throws(() => exportRun(root, 'no-such-run'), /Unknown run/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { blindRunCode, hashTree, readJson, workspaceRoot, writeJson } from '../bench/lib/shared.mjs'
import { createRun, loadRun, markSealed, promoteRun, recordTelemetry, registerEvaluation, registryEntry, reindexRegistry, retargetRun, statusSummary } from '../bench/lib/run/store.mjs'
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

// Fill the run-level panel axis with values that sit inside every tolerance,
// so a test that isn't about the gate never trips it by accident. `overrides`
// substitutes specific measurements for the tests that are about the gate.
function fillRunAxis(rubric, assessment, overrides = {}) {
  const block = assessment[rubric.runAxis.category.id]
  if (!block) return assessment
  const perfect = {
    chassisGeometry: { deckFraction: 0.54, keybedFraction: 0.46, widthFraction: 0.92, aspectRatio: 3.0951, sectionFractionMaxDeviation: 0 },
    hardwareInventory: { requiredLandmarksPresent: 33, requiredLandmarksTotal: 33, controlsReachable: 100, controlsTotal: 100, forbiddenPresent: 0 },
    keybedFidelity: { keysInsideKeybed: 73, keyCount: 73, whiteKeys: 43, blackKeys: 30, blackKeyHeightFraction: 0.61 },
    colorFidelity: { referenceColorsMatched: 5, referenceColorsTotal: 5 },
  }
  for (const criterion of block.criteria) {
    criterion.evidence = ['Fixture evidence with a measurement: 0.5400']
    if (criterion.scoring === 'computed') Object.assign(criterion.measurements, perfect[criterion.id], overrides[criterion.id] ?? {})
    else criterion.rating = 3
  }
  return assessment
}

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).copy(bytes)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

// Hard-wrap a gate across markdown lines the way a candidate reasonably would,
// without changing a single word of it.
function wrapText(text, width = 60) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && `${line} ${word}`.length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.join('\n      ')
}

function writePassingCandidate(root, candidate, { wrapGates = false } = {}) {
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
    ...contract.hardGates.map((gate) => `- [x] ${wrapGates ? wrapText(gate) : gate}`), '',
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

test('the phase contract accepts hard gates copied verbatim but hard-wrapped across lines', async () => {
  const root = fixtureRoot()
  try {
    const created = createRun(root, { model: 'wrap-fixture', target: '1' }, new Date('2026-01-01T00:00:00.000Z'))
    const started = startPhase(root, created.id)
    writePassingCandidate(root, started.candidate, { wrapGates: true })
    importWorkspace(root, created.id, 1)

    const stageDir = path.join(root, 'runs', created.id, 'stage1')
    const plan = fs.readFileSync(path.join(stageDir, 'IMPLEMENTATION_PLAN.md'), 'utf8')
    const contract = readJson(path.join(root, 'specs', 'benchmark-phases.json')).phases.find((entry) => entry.number === 1)
    const wrapped = contract.hardGates.filter((gate) => !plan.includes(gate))
    assert.ok(wrapped.length > 0, 'the fixture actually wraps at least one gate across lines')

    fs.mkdirSync(path.join(stageDir, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(stageDir, 'dist', 'index.html'), '<h1>candidate</h1>')
    fs.writeFileSync(path.join(stageDir, 'evidence', 'stage1-desktop.png'), pngHeader(1440, 900))
    fs.writeFileSync(path.join(stageDir, 'evidence', 'stage1-narrow.png'), pngHeader(390, 844))
    writeJson(path.join(stageDir, 'evidence', 'stage1-capture.json'), { version: 1, phase: 1, captures: [] })

    const checks = await runChecks(stageDir)
    const verification = verifyPhase(root, created.id, 1, { checks })
    assert.equal(verification.passed, true, 'a wrapped verbatim checklist is still a verbatim checklist')
    assert.equal(verification.phaseContract.hardGates, contract.hardGates.length)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the phase contract still rejects a plan that omits a hard gate', async () => {
  const root = fixtureRoot()
  try {
    const created = createRun(root, { model: 'omit-fixture', target: '1' }, new Date('2026-01-01T00:00:00.000Z'))
    const started = startPhase(root, created.id)
    writePassingCandidate(root, started.candidate)

    // drop the last gate from the checklist entirely
    const planPath = path.join(started.candidate, 'IMPLEMENTATION_PLAN.md')
    const contract = readJson(path.join(root, 'specs', 'benchmark-phases.json')).phases.find((entry) => entry.number === 1)
    const dropped = contract.hardGates.at(-1)
    fs.writeFileSync(planPath, fs.readFileSync(planPath, 'utf8').replace(`- [x] ${dropped}\n`, ''))
    importWorkspace(root, created.id, 1)

    const stageDir = path.join(root, 'runs', created.id, 'stage1')
    fs.mkdirSync(path.join(stageDir, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(stageDir, 'dist', 'index.html'), '<h1>candidate</h1>')
    fs.writeFileSync(path.join(stageDir, 'evidence', 'stage1-desktop.png'), pngHeader(1440, 900))
    fs.writeFileSync(path.join(stageDir, 'evidence', 'stage1-narrow.png'), pngHeader(390, 844))
    writeJson(path.join(stageDir, 'evidence', 'stage1-capture.json'), { version: 1, phase: 1, captures: [] })

    const checks = await runChecks(stageDir)
    assert.throws(() => verifyPhase(root, created.id, 1, { checks }), /must include the hard gate/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

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
    // The artifact is source; the build is derived and comes from the
    // published preview, so every evaluator measures the same bits instead of
    // each building its own.
    assert.ok(!fs.existsSync(path.join(evalWorkspace.artifact, 'dist')), 'dist is not part of the sealed artifact')
    assert.ok(fs.existsSync(path.join(evalWorkspace.workspace, 'EVAL.md')), 'evaluator instructions are included')
    // Sealed evidence is read-only so a build cannot be run inside it.
    assert.throws(
      () => fs.writeFileSync(path.join(evalWorkspace.artifact, 'intruder.txt'), 'x'),
      /EACCES|EPERM/,
      'artifact/ is not writable',
    )
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
    assert.equal(readJson(path.join(evalWorkspace.inputs, 'verification.json')).runId, evalWorkspace.blindId, 'the verification record is re-identified by the blind handle')
    // No harness-written file in the evaluator workspace may name the real run.
    // artifact/ is exempt: it is the candidate's own sealed bytes, pinned by the
    // digest check, so the harness cannot rewrite it.
    const harnessFiles = []
    const collectHarnessFiles = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (full !== evalWorkspace.artifact) collectHarnessFiles(full)
        } else harnessFiles.push(full)
      }
    }
    collectHarnessFiles(evalWorkspace.workspace)
    assert.ok(harnessFiles.some((file) => file.endsWith('verification.json')), 'the blinding sweep covers the verification record')
    for (const file of harnessFiles) {
      assert.ok(!fs.readFileSync(file).includes(created.id), `${path.relative(evalWorkspace.workspace, file)} leaks the run id`)
    }

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
    // Phase 1 is the only sealed phase here, so it carries the run-level axis.
    assert.ok(assessment.panelFidelity, 'the highest sealed phase carries the run-level panel axis')
    fillRunAxis(rubric, assessment)

    const evaluation = scoreAssessment(rubric, assessment, [{ id: 'build', passed: true }])
    assert.equal(evaluation.score, 75)
    assert.equal('grade' in evaluation, false, 'grades are no longer part of evaluations')
    assert.equal(evaluation.runAxis.id, 'panelFidelity')

    const capped = scoreAssessment(rubric, assessment, [{ id: 'build', passed: false }])
    assert.equal(capped.score, 59)
    assert.equal(capped.rawScore, 75)

    // The aggregate is the panel axis plus the phase-weighted remainder.
    const aggregate = { ...aggregateStageEvaluations(rubric, [evaluation], evaluation.runAxis), reportPath: `/reports/${created.id}/index.html` }
    const expected = Math.round(((rubric.runAxis.weight / 100) * evaluation.runAxis.score + ((100 - rubric.runAxis.weight) / 100) * 75) * 10) / 10
    assert.equal(aggregate.score, expected)
    assert.equal(aggregate.phaseWeightedScore, 75)
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
    // The gallery score is the aggregate: panel axis + phase-weighted remainder,
    // so it is not the phase score.
    assert.equal(entry.score, expected)
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

test('retarget appends later phases as queued without touching sealed stages', () => {
  const root = fixtureRoot()
  try {
    const created = createRun(root, { model: 'retarget-fixture', target: '1' }, new Date('2026-01-01T00:00:00.000Z'))
    // Simulate a completed target-1 run without running the whole pipeline.
    const run = loadRun(root, created.id)
    run.status = 'complete'
    run.stages[0].status = 'complete'
    run.stages[0].artifactDigest = 'a'.repeat(64)
    writeJson(path.join(root, 'runs', created.id, 'run.json'), run)

    assert.throws(() => retargetRun(root, created.id, 1), /must extend/)

    const result = retargetRun(root, created.id, 3)
    assert.deepEqual(result.addedPhases, [2, 3])
    const extended = loadRun(root, created.id)
    assert.equal(extended.targetPhase, 3)
    assert.deepEqual(extended.selectedPhases, [1, 2, 3])
    assert.equal(extended.status, 'in-progress')
    assert.deepEqual(extended.stages.map((stage) => [stage.number, stage.status]), [[1, 'complete'], [2, 'queued'], [3, 'queued']])
    assert.equal(extended.stages[0].artifactDigest, 'a'.repeat(64), 'the sealed stage record is untouched')
    assert.match(statusSummary(extended).next, /start/)
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

test('the pinned evaluator model is required, recorded, and uniform across a panel', () => {
  const rubric = loadRubric()
  const pinned = rubric.evaluator.model
  const fill = (template) => {
    template.evaluator = 'blind evaluator'
    template.evaluatedAt = '2026-01-02T00:00:00.000Z'
    template.summary = 'Summary.'
    for (const category of template.categories) {
      for (const criterion of category.criteria) {
        criterion.rating = 3
        criterion.evidence = ['aspect-ratio 3.0951 measured against the spec']
      }
    }
    return template
  }

  // The template carries the pin, so an evaluator that follows EVAL.md passes.
  const good = fill(createAssessmentTemplate(rubric, 'run-blind', 1))
  assert.equal(good.evaluatorModel, pinned, 'the template pre-fills the pinned model')
  const evaluation = scoreAssessment(rubric, good, [{ id: 'build', passed: true }])
  assert.equal(evaluation.evaluatorModel, pinned, 'the scored record keeps the model')

  // A different model, or none at all, is refused rather than silently scored.
  for (const value of ['claude-opus-4-8', '', undefined]) {
    const off = fill(createAssessmentTemplate(rubric, 'run-blind', 1))
    off.evaluatorModel = value
    assert.throws(() => scoreAssessment(rubric, off, []), /evaluatorModel must be/)
  }

  // The escape hatch exists for re-registering an older evaluation.
  const legacy = fill(createAssessmentTemplate(rubric, 'run-blind', 1))
  legacy.evaluatorModel = 'claude-opus-4-8'
  assert.equal(scoreAssessment(rubric, legacy, [], { allowEvaluatorModel: true }).evaluatorModel, 'claude-opus-4-8')

  // A panel averages evaluator noise, not model differences.
  const mixed = fill(createAssessmentTemplate(rubric, 'run-blind', 1))
  mixed.evaluatorModel = 'claude-opus-4-8'
  assert.throws(
    () => mergeAssessments(rubric, [fill(createAssessmentTemplate(rubric, 'run-blind', 1)), mixed], { allowEvaluatorModel: true }),
    /same evaluator model/,
  )
})

test('computed criteria score from measurements, and the hard gate keys on the measurement', () => {
  const rubric = loadRubric()
  const build = (overrides) => {
    const a = createAssessmentTemplate(rubric, 'run-blind', 3, { includeRunAxis: true })
    a.evaluator = 'blind evaluator'
    a.evaluatorModel = rubric.evaluator.model
    a.evaluatedAt = '2026-01-02T00:00:00.000Z'
    a.summary = 'Summary.'
    for (const category of a.categories) {
      for (const criterion of category.criteria) { criterion.rating = 3; criterion.evidence = ['measured 0.5400'] }
    }
    return fillRunAxis(rubric, a, overrides)
  }

  // A panel measured exactly on spec scores full marks on the computed criteria.
  const perfect = scoreAssessment(rubric, build({}), []).runAxis
  for (const id of ['chassisGeometry', 'hardwareInventory', 'keybedFidelity', 'colorFidelity']) {
    assert.equal(perfect.criteria.find((c) => c.id === id).score, 100, `${id} is on spec`)
  }
  assert.deepEqual(perfect.hardGate.tripped, [], 'nothing trips on a correct panel')

  // The regression this test exists for: a keybed with the right key count,
  // the right split and the right height ratio whose keys simply do not lay
  // out inside it. Averaging five measurements turns that into a pass, so the
  // gate keys on the measurement instead of the criterion score.
  const blank = scoreAssessment(rubric, build({ keybedFidelity: { keysInsideKeybed: 1 } }), []).runAxis
  assert.ok(blank.rawScore > rubric.runAxis.hardGate.scoreCap, 'the averaged criterion score alone would pass')
  assert.deepEqual(blank.hardGate.tripped, ['keybedFidelity.keysInsideKeybed'])
  assert.equal(blank.score, rubric.runAxis.hardGate.scoreCap, 'the gate caps the axis')

  // Ratios are curved: a panel with 58% of its controls reachable is not 58%
  // of a working panel.
  const clipped = scoreAssessment(rubric, build({ hardwareInventory: { controlsReachable: 94, controlsTotal: 161 } }), []).runAxis
  const reach = clipped.criteria.find((c) => c.id === 'hardwareInventory').measurements.find((m) => m.id === 'controlsReachable')
  assert.ok(reach.score < 40, `curved reachability scores ${reach.score}, not the linear 58`)
})

test('a computed criterion re-normalises over the measurements actually reported', () => {
  const rubric = loadRubric()
  const a = createAssessmentTemplate(rubric, 'run-blind', 3, { includeRunAxis: true })
  a.evaluator = 'e'; a.evaluatorModel = rubric.evaluator.model
  a.evaluatedAt = '2026-01-02T00:00:00.000Z'; a.summary = 'S'
  for (const category of a.categories) for (const c of category.criteria) { c.rating = 2; c.evidence = ['m'] }
  fillRunAxis(rubric, a)
  // Drop one measurement: a null is honest and must not read as a zero.
  const geometry = a.panelFidelity.criteria.find((c) => c.id === 'chassisGeometry')
  geometry.measurements.aspectRatio = null
  const axis = scoreAssessment(rubric, a, []).runAxis
  assert.equal(axis.criteria.find((c) => c.id === 'chassisGeometry').score, 100, 'an unreported measurement is dropped, not scored zero')

  // But a criterion with nothing reported cannot be scored at all.
  for (const key of Object.keys(geometry.measurements)) geometry.measurements[key] = null
  assert.throws(() => scoreAssessment(rubric, a, []), /no usable measurements/)
})

test('assessment issues are constrained to one shape', () => {
  const rubric = loadRubric()
  const build = (issues) => {
    const template = createAssessmentTemplate(rubric, 'run-blind', 1)
    template.evaluator = 'blind evaluator'
    template.evaluatedAt = '2026-01-02T00:00:00.000Z'
    template.summary = 'Summary.'
    template.issues = issues
    for (const category of template.categories) {
      for (const criterion of category.criteria) {
        criterion.rating = 2
        criterion.evidence = ['measured against inputs/specs/nord-stage-4.visual.json']
      }
    }
    return template
  }

  const ok = scoreAssessment(rubric, build([{ severity: 'critical', title: 'Keybed blank', detail: '72 of 73 keys lay out beyond the keybed.' }]), [])
  assert.equal(ok.issues.length, 1)

  // The shapes that reached the archived assessments and forced the report to
  // guess at keys are now rejected at the source.
  assert.throws(() => scoreAssessment(rubric, build(['a bare string issue']), []), /must be an object/)
  assert.throws(() => scoreAssessment(rubric, build([{ severity: 'moderate', title: 'x', detail: 'y' }]), []), /severity must be one of/)
  assert.throws(() => scoreAssessment(rubric, build([{ severity: 'minor', description: 'no title or detail' }]), []), /title is required/)
})

test('package stores are not part of a sealed artifact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-artifact-'))
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'export const a = 1\n')
    const bare = hashTree(root).digest

    // A committed pnpm store made one run's sealed phase 139 MB against ~1 MB
    // for every other run, and handed its evaluator an artifact/ that was
    // almost entirely vendor source.
    for (const dir of ['node_modules', '.pnpm-store', '.yarn', '.turbo', '.next']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true })
      fs.writeFileSync(path.join(root, dir, 'vendor.js'), 'module.exports = {}\n')
    }
    assert.equal(hashTree(root).digest, bare, 'dependency trees and package stores never move the digest')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
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

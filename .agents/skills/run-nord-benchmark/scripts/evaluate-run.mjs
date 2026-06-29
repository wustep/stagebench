#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  aggregateStageEvaluations,
  createAssessmentTemplate,
  scoreAssessment,
  validateRubric,
} from '../../../../evaluation/lib/scoring.mjs'
import { collectImplementationDetails } from '../../../../evaluation/lib/implementation-details.mjs'
import { renderRunReportHtml, renderRunReportMarkdown } from '../../../../evaluation/lib/report.mjs'
import { findRepoRoot, parseArgs, readJson, writeJson } from '../lib/cli.mjs'

function resolveFromRoot(root, value, fallback) {
  const candidate = value || fallback
  return path.isAbsolute(candidate) ? candidate : path.join(root, candidate)
}

function getStage(options) {
  const stage = Number(options.phase ?? options.stage)
  if (![1, 2, 3, 4].includes(stage)) throw new Error('--phase must be 1, 2, 3, or 4')
  return stage
}

function loadRubric(root) {
  return validateRubric(readJson(path.join(root, 'evaluation', 'rubrics', 'v2.json')))
}

function loadRun(root, id) {
  if (!id) throw new Error('--id is required')
  const filePath = path.join(root, 'runs', id, 'run.json')
  if (!fs.existsSync(filePath)) throw new Error(`Unknown run: ${id}`)
  return readJson(filePath)
}

function saveRun(root, run) {
  const runPath = path.join(root, 'runs', run.id, 'run.json')
  const registryPath = path.join(root, 'src', 'data', 'runs.json')
  const registry = readJson(registryPath)
  const nextRegistry = registry.some((entry) => entry.id === run.id)
    ? registry.map((entry) => entry.id === run.id ? run : entry)
    : [run, ...registry]
  writeJson(runPath, run)
  writeJson(registryPath, nextRegistry)
}

function commandForPackageManager(stageDir, script) {
  assert.ok(fs.existsSync(path.join(stageDir, 'pnpm-lock.yaml')), 'Missing pnpm-lock.yaml; benchmark phases must use pnpm')
  assert.ok(!fs.existsSync(path.join(stageDir, 'package-lock.json')), 'package-lock.json is not allowed; benchmark phases must use pnpm')
  assert.ok(!fs.existsSync(path.join(stageDir, 'yarn.lock')), 'yarn.lock is not allowed; benchmark phases must use pnpm')
  const packageJson = readJson(path.join(stageDir, 'package.json'))
  assert.match(packageJson.packageManager ?? '', /^pnpm@/, 'package.json must declare a pnpm packageManager')
  return { executable: 'pnpm', args: ['run', script] }
}

function outputTail(value, length = 1600) {
  return String(value || '').trim().slice(-length)
}

function runTechnicalChecks(root, runId, stageNumber, rubric) {
  const stageDir = path.join(root, 'runs', runId, `stage${stageNumber}`)
  const packagePath = path.join(stageDir, 'package.json')
  if (!fs.existsSync(packagePath)) {
    return [{ id: 'artifact', label: 'Runnable phase artifact', passed: false, detail: `Missing ${packagePath}` }]
  }

  const packageJson = readJson(packagePath)
  const checks = rubric.technicalGate.requiredChecks.map((script) => {
    if (!packageJson.scripts?.[script]) {
      return { id: script, label: script, passed: false, detail: `Missing package script: ${script}` }
    }
    const command = commandForPackageManager(stageDir, script)
    const startedAt = Date.now()
    const result = spawnSync(command.executable, command.args, {
      cwd: stageDir,
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, CI: '1' },
    })
    const passed = result.status === 0 && !result.error
    return {
      id: script,
      label: script,
      passed,
      command: [command.executable, ...command.args].join(' '),
      durationMs: Date.now() - startedAt,
      detail: passed ? 'Passed' : outputTail(result.stderr || result.stdout || result.error?.message),
    }
  })
  const artifactPath = path.join(stageDir, 'dist', 'index.html')
  checks.push({
    id: 'artifact',
    label: 'Built phase artifact',
    passed: fs.existsSync(artifactPath),
    detail: fs.existsSync(artifactPath) ? path.relative(root, artifactPath) : `Missing ${path.relative(root, artifactPath)}`,
  })
  return checks
}

function skippedTechnicalChecks(root, runId, stageNumber, rubric) {
  const stageDir = path.join(root, 'runs', runId, `stage${stageNumber}`)
  const artifactPath = path.join(stageDir, 'dist', 'index.html')
  return [
    ...rubric.technicalGate.requiredChecks.map((id) => ({ id, label: id, passed: true, detail: 'Skipped by explicit option' })),
    { id: 'artifact', label: 'Built phase artifact', passed: fs.existsSync(artifactPath), detail: fs.existsSync(artifactPath) ? path.relative(root, artifactPath) : `Missing ${path.relative(root, artifactPath)}` },
  ]
}

function assessmentPathFor(root, id, stageNumber) {
  return path.join(root, 'runs', id, 'evaluations', `stage${stageNumber}.assessment.json`)
}

function evaluationPathFor(root, id, stageNumber) {
  return path.join(root, 'runs', id, 'evaluations', `stage${stageNumber}.json`)
}

function writeImplementationDetails(root, run) {
  const details = collectImplementationDetails(root, run)
  const implementationDetailsPath = path.join(root, 'runs', run.id, 'evaluations', 'implementation-details.json')
  const publicImplementationDetailsPath = path.join(root, 'public', 'reports', run.id, 'implementation-details.json')
  writeJson(implementationDetailsPath, details)
  writeJson(publicImplementationDetailsPath, details)
  return { details, implementationDetailsPath, publicImplementationDetailsPath }
}

function writeReadableReport(root, run) {
  const evaluations = [1, 2, 3, 4]
    .map((stage) => evaluationPathFor(root, run.id, stage))
    .filter((filePath) => fs.existsSync(filePath))
    .map(readJson)
  if (evaluations.length === 0) throw new Error(`Run ${run.id} has no scored evaluations`)
  const reportPath = `/reports/${run.id}/index.html`
  const markdownPath = path.join(root, 'runs', run.id, 'evaluations', 'report.md')
  const htmlPath = path.join(root, 'public', 'reports', run.id, 'index.html')
  const { details: implementationDetails, implementationDetailsPath, publicImplementationDetailsPath } = writeImplementationDetails(root, run)
  writeJson(path.join(root, 'public', 'reports', run.id, 'report.json'), {
    runId: run.id,
    generatedAt: new Date().toISOString(),
    implementationDetails: `/reports/${run.id}/implementation-details.json`,
    evaluations: evaluations.map(({ stage, score, grade }) => ({ stage, score, grade })),
  })
  fs.mkdirSync(path.dirname(markdownPath), { recursive: true })
  fs.writeFileSync(markdownPath, renderRunReportMarkdown(run, evaluations, implementationDetails))
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true })
  fs.writeFileSync(htmlPath, renderRunReportHtml(run, evaluations, implementationDetails))
  run.stages = run.stages.map((stage) => stage.evaluation
    ? { ...stage, evaluation: { ...stage.evaluation, reportPath: `${reportPath}#stage-${stage.number}` } }
    : stage)
  if (run.evaluation) run.evaluation = { ...run.evaluation, reportPath }
  return { reportPath, markdownPath, htmlPath, implementationDetailsPath, publicImplementationDetailsPath }
}

function createTemplate(root, options) {
  const stage = getStage(options)
  const run = loadRun(root, options.id)
  const rubric = loadRubric(root)
  const output = resolveFromRoot(root, options.output, assessmentPathFor(root, run.id, stage))
  if (fs.existsSync(output) && options.force !== 'true') throw new Error(`Assessment already exists: ${output}. Use --force true to replace it.`)
  const template = createAssessmentTemplate(rubric, run.id, stage)
  writeJson(output, template)
  return { runId: run.id, stage, rubricVersion: rubric.version, assessmentPath: output }
}

function scoreRun(root, options) {
  const stage = getStage(options)
  const run = loadRun(root, options.id)
  const stageState = run.stages.find((entry) => entry.number === stage)
  if (stageState?.status !== 'complete') throw new Error(`Phase ${stage} must be complete before it can be scored`)
  const rubric = loadRubric(root)
  const assessmentPath = resolveFromRoot(root, options.assessment, assessmentPathFor(root, run.id, stage))
  if (!fs.existsSync(assessmentPath)) throw new Error(`Missing assessment: ${assessmentPath}`)
  const assessment = readJson(assessmentPath)
  assert.equal(assessment.runId, run.id, 'Assessment runId does not match the selected run')
  assert.equal(assessment.stage, stage, 'Assessment phase does not match --phase')

  const technicalChecks = options['skip-checks'] === 'true'
    ? skippedTechnicalChecks(root, run.id, stage, rubric)
    : runTechnicalChecks(root, run.id, stage, rubric)
  const evaluation = scoreAssessment(rubric, assessment, technicalChecks)
  const outputPath = resolveFromRoot(root, options.output, evaluationPathFor(root, run.id, stage))
  writeJson(outputPath, evaluation)

  const evaluationSummary = {
    status: evaluation.status,
    score: evaluation.score,
    rawScore: evaluation.rawScore,
    grade: evaluation.grade,
    evaluatedAt: evaluation.evaluatedAt,
    rubricVersion: evaluation.rubricVersion,
    path: path.relative(root, outputPath),
    categoryScores: Object.fromEntries(evaluation.categories.map((category) => [category.id, category.score])),
  }
  run.stages = run.stages.map((entry) => entry.number === stage ? { ...entry, evaluation: evaluationSummary } : entry)
  const availableEvaluations = run.stages
    .filter((entry) => entry.evaluation?.status === 'complete')
    .map((entry) => ({ stage: entry.number, status: entry.evaluation.status, score: entry.evaluation.score }))
  run.evaluation = aggregateStageEvaluations(rubric, availableEvaluations)
  run.updatedAt = new Date().toISOString()
  const report = writeReadableReport(root, run)
  saveRun(root, run)
  return { evaluationPath: outputPath, evaluation, aggregate: run.evaluation, report }
}

function rebuildReport(root, options) {
  const run = loadRun(root, options.id)
  const report = writeReadableReport(root, run)
  run.updatedAt = new Date().toISOString()
  saveRun(root, run)
  return { runId: run.id, aggregate: run.evaluation, report }
}

function rebuildImplementationDetails(root, options) {
  const run = loadRun(root, options.id)
  const { details, implementationDetailsPath, publicImplementationDetailsPath } = writeImplementationDetails(root, run)
  return {
    runId: run.id,
    phases: details.phases.length,
    implementationDetailsPath,
    publicImplementationDetailsPath,
  }
}

function rubricSummary(root, options) {
  const rubric = loadRubric(root)
  if (options.stage) {
    const stage = getStage(options)
    return { version: rubric.version, stage, ...rubric.stages[String(stage)] }
  }
  return {
    version: rubric.version,
    ratingScale: rubric.ratingScale,
    aggregateStageWeights: rubric.aggregateStageWeights,
    stages: Object.fromEntries(Object.entries(rubric.stages).map(([stage, value]) => [stage, {
      name: value.name,
      categoryWeights: Object.fromEntries(value.categories.map((category) => [category.id, category.weight])),
    }])),
  }
}

function selfTest(root) {
  const rubric = loadRubric(root)
  const stageOne = createAssessmentTemplate(rubric, 'self-test', 1)
  stageOne.evaluator = 'Stagebench self-test'
  stageOne.evaluatedAt = '2026-01-01T00:00:00.000Z'
  stageOne.summary = 'Synthetic assessment used to verify deterministic scoring.'
  for (const category of stageOne.categories) {
    for (const criterion of category.criteria) {
      criterion.rating = 3
      criterion.evidence = ['Synthetic evidence']
    }
  }
  const evaluation = scoreAssessment(rubric, stageOne, [{ id: 'build', passed: true }])
  assert.equal(evaluation.score, 75)
  assert.equal(evaluation.grade, 'competent')

  const capped = scoreAssessment(rubric, stageOne, [{ id: 'build', passed: false }])
  assert.equal(capped.score, 59)
  assert.equal(capped.rawScore, 75)
  const aggregate = aggregateStageEvaluations(rubric, [evaluation])
  assert.equal(aggregate.score, 75)

  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-evaluator-'))
  try {
    fs.mkdirSync(path.join(testRoot, 'evaluation', 'rubrics'), { recursive: true })
    fs.copyFileSync(path.join(root, 'evaluation', 'rubrics', 'v2.json'), path.join(testRoot, 'evaluation', 'rubrics', 'v2.json'))
    fs.mkdirSync(path.join(testRoot, 'src', 'data'), { recursive: true })
    fs.mkdirSync(path.join(testRoot, 'runs', 'pipeline-test', 'stage1', 'dist'), { recursive: true })
    fs.writeFileSync(path.join(testRoot, 'BENCHMARK.md'), '# Test\n')
    fs.writeFileSync(path.join(testRoot, 'runs', 'pipeline-test', 'stage1', 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.7.0', scripts: { typecheck: 'true', lint: 'true', build: 'true' } }))
    fs.writeFileSync(path.join(testRoot, 'runs', 'pipeline-test', 'stage1', 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    writeJson(path.join(testRoot, 'runs', 'pipeline-test', 'stage1', 'IMPLEMENTATION_DETAILS.json'), {
      version: 1,
      phase: 1,
      audio: { strategy: 'None', generatedSources: [], sampleSources: [], notes: ['Visual-only phase.'] },
    })
    fs.writeFileSync(path.join(testRoot, 'runs', 'pipeline-test', 'stage1', 'dist', 'index.html'), '<h1>test</h1>')
    const testRun = {
      id: 'pipeline-test',
      model: 'Pipeline Test',
      status: 'partial',
      startedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      stages: [{ number: 1, status: 'complete' }, { number: 2, status: 'queued' }, { number: 3, status: 'queued' }, { number: 4, status: 'queued' }],
    }
    writeJson(path.join(testRoot, 'runs', testRun.id, 'run.json'), testRun)
    writeJson(path.join(testRoot, 'src', 'data', 'runs.json'), [testRun])
    createTemplate(testRoot, { id: testRun.id, stage: '1' })
    const testAssessmentPath = assessmentPathFor(testRoot, testRun.id, 1)
    const testAssessment = readJson(testAssessmentPath)
    testAssessment.evaluator = stageOne.evaluator
    testAssessment.evaluatedAt = stageOne.evaluatedAt
    testAssessment.summary = stageOne.summary
    for (const category of testAssessment.categories) {
      for (const criterion of category.criteria) {
        criterion.rating = 3
        criterion.evidence = ['Pipeline self-test evidence']
      }
    }
    writeJson(testAssessmentPath, testAssessment)
    const recorded = scoreRun(testRoot, { id: testRun.id, stage: '1', 'skip-checks': 'true' })
    assert.equal(recorded.evaluation.score, 75)
    assert.equal(readJson(path.join(testRoot, 'runs', testRun.id, 'run.json')).evaluation.score, 75)
  } finally {
    fs.rmSync(testRoot, { recursive: true, force: true })
  }
  return { ok: true, checks: 6, rubricVersion: rubric.version }
}

function printHelp() {
  console.log(`Usage:
  evaluate-run.mjs rubric [--phase <1|2|3|4>]
  evaluate-run.mjs template --id <run-id> --phase <1|2|3|4> [--output <path>] [--force true]
  evaluate-run.mjs score --id <run-id> --phase <1|2|3|4> [--assessment <path>] [--output <path>] [--skip-checks true]
  evaluate-run.mjs details --id <run-id>
  evaluate-run.mjs report --id <run-id>
  evaluate-run.mjs self-test`)
}

try {
  const { command, options } = parseArgs(process.argv.slice(2))
  const root = findRepoRoot(options.root)
  let result
  if (command === 'rubric') result = rubricSummary(root, options)
  else if (command === 'template') result = createTemplate(root, options)
  else if (command === 'score') result = scoreRun(root, options)
  else if (command === 'details') result = rebuildImplementationDetails(root, options)
  else if (command === 'report') result = rebuildReport(root, options)
  else if (command === 'self-test') result = selfTest(root)
  else {
    printHelp()
    process.exitCode = command ? 1 : 0
  }
  if (result) console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`evaluate-run: ${error.message}`)
  process.exitCode = 1
}

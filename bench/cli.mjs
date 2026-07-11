#!/usr/bin/env node
// The Stagebench benchmark CLI. One run is:
//
//   pnpm bench new --model <id> --target <1|2|3>
//   then per phase:  bench start <id>  →  agent implements  →  bench seal <id>
//   then per phase:  bench score <id>  (twice: template, then register)
//
// The run side (bench/lib/run) mutates run state; the eval side
// (bench/lib/eval) is pure over sealed artifacts. This file is the only
// place the two meet.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { findRepoRoot, hashTree, loadProtocol, parseArgs, readJson, workspaceRoot, writeJson } from './lib/shared.mjs'
import {
  createRun,
  ensureInstalled,
  loadRun,
  nextPhase,
  markSealed,
  pathsFor,
  recordTelemetry,
  registerEvaluation,
  reindexRegistry,
  promoteRun,
  renameRun,
  stageDirFor,
  stageState,
  statusSummary,
} from './lib/run/store.mjs'
import { importWorkspace, removeWorkspace, runInContainer, startPhase, workspaceDir } from './lib/run/workspace.mjs'
import { createEvalWorkspace, evalAssessmentPath, evalWorkspaceDir, removeEvalWorkspace } from './lib/eval/workspace.mjs'
import { exportRun } from './lib/run/export.mjs'
import { runChecks, verifyPhase } from './lib/run/verify.mjs'
import { captureEvidence, serveDirectory } from './lib/run/capture.mjs'
import { collectImplementationDetails } from './lib/implementation-details.mjs'
import { loadRubric, runGates } from './lib/eval/evaluate.mjs'
import { aggregateStageEvaluations, mergeAssessments, scoreAssessment } from './lib/eval/scoring.mjs'
import { renderRunReportHtml, renderRunReportMarkdown } from './lib/eval/report.mjs'
import { fetchReference } from './lib/fetch-reference.mjs'
import { TELEMETRY_FLAGS } from '../src/telemetry-fields.mjs'

const COMMANDS = {
  new: 'Create a run: --model <id> [--target 1|2|3] [--variant <id>] [--title ...] [--provider ...] [--reasoning ...] [--notes ...]',
  promote: 'promote <run-id> --to <clean-id> [--replace] — move a completed run to a canonical id',
  rename: 'rename <run-id> --title "..." — update a run’s gallery title',
  start: 'start <run-id> — create the next phase workspace for the implementation agent',
  exec: 'exec <run-id> --command "..." — run a command in the workspace inside Docker [--network none|registry] [--image ...]',
  seal: 'seal <run-id> — import, check, capture, verify, and seal the running phase [--cost-usd N --input-tokens N --output-tokens N --reasoning-tokens N --tool-calls N]',
  telemetry: 'telemetry <run-id> --phase N — record or correct usage after the fact (same flags as seal)',
  score: 'score <run-id> [--phase N] — build the isolated evaluator workspace, or register its filled assessment',
  status: 'status <run-id> — show run state, telemetry, and the next command',
  clean: 'clean [<run-id>] — remove transient work/eval/gates workspaces [--all] [--force to remove a running phase]',
  export: 'export <run-id> [--out <path>] — bundle run.json, evaluations, report, and preview into a ZIP',
  showcase: 'Check, build, and publish showcase/ to public/previews/showcase',
  reindex: 'Regenerate src/data/runs.json from runs/*/run.json',
  fetch: 'Download the Nord manual and product photos into ./reference [--force] [--timeout <ms>]',
  help: 'Show this help',
}

function telemetryFromFlags(options) {
  const values = {}
  for (const [flag, field] of Object.entries(TELEMETRY_FLAGS)) {
    if (options[flag] !== undefined) values[field] = options[flag]
  }
  return values
}

function preflight(root, variantId) {
  for (const command of ['git', 'pnpm']) {
    const probe = spawnSync(command, ['--version'], { encoding: 'utf8' })
    if (probe.status !== 0) throw new Error(`${command} is required on PATH`)
  }
  const { value: protocol } = loadProtocol(root)
  const variants = readJson(path.join(root, 'specs', 'nord-stage-4.variants.json'))
  const variant = variants.variants.find((entry) => entry.id === (variantId ?? variants.default))
  if (!variant) throw new Error(`Unknown variant "${variantId}"`)
  const missing = [protocol.manual.path, variant.referenceImage].filter((file) => !fs.existsSync(path.join(root, file)))
  if (missing.length > 0) throw new Error(`Missing reference material: ${missing.join(', ')}. Run pnpm bench fetch first.`)
}

async function seal(root, id, options) {
  const run = loadRun(root, id)
  const stage = nextPhase(run)
  if (!stage || stage.status !== 'running') throw new Error(`${id} has no running phase to seal (next: ${statusSummary(run).next})`)
  const phase = stage.number

  console.error(`→ importing workspace candidate into runs/${id}/stage${phase}`)
  importWorkspace(root, id, phase)
  const stageDir = stageDirFor(root, id, phase)

  console.error('→ installing dependencies')
  ensureInstalled(stageDir)

  console.error('→ running test, typecheck, lint, build')
  const checks = await runChecks(stageDir)
  const failed = checks.filter((check) => !check.passed)
  if (failed.length > 0) {
    throw new Error(`Package checks failed (${failed.map((check) => check.id).join(', ')}). Fix in the workspace, then seal again.\n${failed.map((check) => `--- ${check.id} ---\n${check.detail}`).join('\n')}`)
  }

  console.error('→ capturing canonical screenshots')
  const server = await serveDirectory(path.join(stageDir, 'dist'))
  try {
    await captureEvidence(root, { id, phase, url: server.url })
  } finally {
    await server.close()
  }

  // Keep the sealed tree pristine: it carries source + dist + evidence, never
  // installed node_modules. hashTree ignores node_modules regardless, so the
  // digest is unaffected — this just stops the committed evidence directory
  // from holding an install tree.
  fs.rmSync(path.join(stageDir, 'node_modules'), { recursive: true, force: true })

  console.error('→ verifying phase contract and evidence')
  const verification = verifyPhase(root, id, phase, { checks })
  writeJson(path.join(root, 'runs', id, 'verifications', `stage${phase}.json`), verification)
  if (!verification.passed) {
    const failures = [...verification.checks, ...verification.evidence].filter((check) => !check.passed)
    throw new Error(`Phase ${phase} verification failed: ${failures.map((check) => check.detail ?? check.id).join('; ')}`)
  }

  markSealed(root, id, phase, verification)
  const usage = telemetryFromFlags(options)
  if (Object.keys(usage).length > 0) recordTelemetry(root, id, phase, usage)
  removeWorkspace(root, id, phase)
  await reindexRegistry(root)
  const sealed = loadRun(root, id)
  return {
    id,
    phase,
    artifactDigest: verification.artifactDigest,
    preview: sealed.previews?.[String(phase)],
    telemetry: sealed.stages.find((entry) => entry.number === phase)?.telemetry ?? null,
    next: statusSummary(sealed).next,
  }
}

function archivedAssessmentPathFor(root, id, phase) {
  return path.join(root, 'runs', id, 'evaluations', `stage${phase}.assessment.json`)
}

function writeReports(root, run) {
  const evaluations = run.stages
    .map((entry) => path.join(root, 'runs', run.id, 'evaluations', `stage${entry.number}.json`))
    .filter((filePath) => fs.existsSync(filePath))
    .map(readJson)
  const details = collectImplementationDetails(root, run)
  const reportsDir = path.join(pathsFor(root).reports, run.id)
  writeJson(path.join(reportsDir, 'implementation-details.json'), details)
  writeJson(path.join(root, 'runs', run.id, 'evaluations', 'implementation-details.json'), details)
  fs.mkdirSync(reportsDir, { recursive: true })
  fs.writeFileSync(path.join(reportsDir, 'index.html'), renderRunReportHtml(run, evaluations, details))
  fs.writeFileSync(path.join(root, 'runs', run.id, 'evaluations', 'report.md'), renderRunReportMarkdown(run, evaluations, details))
  return `/reports/${run.id}/index.html`
}

async function score(root, id, options) {
  const run = loadRun(root, id)
  const rubric = loadRubric()
  const phase = options.phase
    ? Number(options.phase)
    : run.stages.filter((entry) => entry.status === 'complete' && !entry.evaluation).map((entry) => entry.number)[0]
      ?? run.stages.filter((entry) => entry.status === 'complete').map((entry) => entry.number).at(-1)
  if (!phase) throw new Error(`${id} has no sealed phase to score`)
  const stage = stageState(run, phase)
  if (stage.status !== 'complete') throw new Error(`Phase ${phase} must be sealed before scoring`)

  // Evaluation is an isolated flow: the first call builds an evaluator
  // workspace (artifact copy + scoring inputs + template) under
  // .stagebench/eval; the second call registers the filled assessment.
  const assessmentPath = evalAssessmentPath(root, id, phase)
  if (!fs.existsSync(assessmentPath)) {
    const created = createEvalWorkspace(root, {
      id,
      phase,
      variantId: run.variant,
      stageDir: stageDirFor(root, id, phase),
      verificationPath: path.join(root, 'runs', id, 'verifications', `stage${phase}.json`),
      expectedDigest: stage.artifactDigest,
      rubric,
    })
    return {
      action: 'eval-workspace-created',
      workspace: created.workspace,
      assessmentPath: created.assessment,
      next: `Spawn a fresh evaluator agent whose working directory is ${created.workspace} — it reads EVAL.md, inspects artifact/ against inputs/ (blind to model identity), and fills every rating in assessment.json with evidence. Then run: pnpm bench score ${id} --phase ${phase}`,
    }
  }

  // A panel: the primary assessment.json plus any assessment.<n>.json filled
  // by additional independent evaluators. One evaluator is the common case and
  // merges to itself.
  const workspace = evalWorkspaceDir(root, id, phase)
  const panelFiles = fs.readdirSync(workspace)
    .filter((name) => /^assessment(\.\d+)?\.json$/.test(name))
    .sort()
  const panel = panelFiles.map((name) => {
    const filePath = path.join(workspace, name)
    const value = readJson(filePath)
    if (value.categories.some((category) => category.criteria.some((criterion) => criterion.rating === null))) {
      throw new Error(`The assessment at ${filePath} still has unrated criteria. Have the evaluator fill it in, then score again.`)
    }
    return value
  })
  const assessment = mergeAssessments(rubric, panel)
  // Map the blind handle the evaluators saw back to the real run id.
  assessment.runId = id

  const stageDir = stageDirFor(root, id, phase)
  if (stage.artifactDigest) {
    const currentDigest = hashTree(stageDir).digest
    if (currentDigest !== stage.artifactDigest) throw new Error(`Phase ${phase} changed after sealing; run seal again before scoring`)
  }
  // Gates run against a throwaway copy out of the repo, so the sealed stage
  // directory is never mutated. --sandbox (or STAGEBENCH_SANDBOX=1) runs them
  // in Docker.
  const technicalChecks = await runGates(root, stageDir, rubric, {
    skip: options['skip-checks'] === 'true',
    sandbox: options.sandbox === 'true' || process.env.STAGEBENCH_SANDBOX === '1',
  })
  const evaluation = scoreAssessment(rubric, assessment, technicalChecks)
  const evaluationPath = path.join(root, 'runs', id, 'evaluations', `stage${phase}.json`)
  // Archive the filled assessment as part of the run record before the
  // evaluator workspace is removed.
  writeJson(archivedAssessmentPathFor(root, id, phase), assessment)
  writeJson(evaluationPath, evaluation)

  const reportPath = `/reports/${id}/index.html#stage-${phase}`
  const stageSummary = {
    status: evaluation.status,
    score: evaluation.score,
    rawScore: evaluation.rawScore,
    evaluatedAt: evaluation.evaluatedAt,
    rubricVersion: evaluation.rubricVersion,
    path: path.relative(root, evaluationPath).split(path.sep).join('/'),
    reportPath,
    categoryScores: Object.fromEntries(evaluation.categories.map((category) => [category.id, category.score])),
  }
  const updated = loadRun(root, id)
  const summaries = updated.stages.map((entry) => entry.number === phase
    ? { stage: phase, status: 'complete', score: evaluation.score }
    : entry.evaluation ? { stage: entry.number, status: 'complete', score: entry.evaluation.score } : null).filter(Boolean)
  const aggregate = { ...aggregateStageEvaluations(rubric, summaries), reportPath: `/reports/${id}/index.html` }
  registerEvaluation(root, id, phase, stageSummary, aggregate)
  writeReports(root, loadRun(root, id))
  await reindexRegistry(root)
  removeEvalWorkspace(root, id, phase)
  return { action: 'scored', phase, score: evaluation.score, aggregate: aggregate.score, evaluationPath, report: aggregate.reportPath }
}

// Existing transient workspaces for a run: the implementation workspace (any
// phase) and per-phase evaluator workspaces. Used by `status` (surface
// leftovers) and `clean` (remove them).
function runWorkspaces(root, run) {
  const work = []
  const evaluations = []
  for (const stage of run.stages ?? []) {
    const workDir = workspaceDir(root, run.id, stage.number)
    if (fs.existsSync(workDir)) work.push({ phase: stage.number, path: workDir })
    const evalDir = evalWorkspaceDir(root, run.id, stage.number)
    if (fs.existsSync(evalDir)) evaluations.push({ phase: stage.number, path: evalDir })
  }
  return { work, eval: evaluations }
}

// Remove a run's transient workspaces. Evaluator and gates workspaces are
// always safe to drop (regenerable). An implementation workspace for a phase
// that is still `running` holds unsealed work, so it is kept unless --force.
function cleanWorkspaces(root, run, { force = false } = {}) {
  const runningPhases = new Set((run.stages ?? []).filter((stage) => stage.status === 'running').map((stage) => stage.number))
  const removed = []
  const kept = []
  const { work, eval: evaluations } = runWorkspaces(root, run)
  for (const entry of work) {
    if (runningPhases.has(entry.phase) && !force) {
      kept.push({ ...entry, kind: 'work', reason: 'phase is running; pass --force to remove unsealed work' })
      continue
    }
    removeWorkspace(root, run.id, entry.phase)
    removed.push({ ...entry, kind: 'work' })
  }
  for (const entry of evaluations) {
    removeEvalWorkspace(root, run.id, entry.phase)
    removed.push({ ...entry, kind: 'eval' })
  }
  return { id: run.id, removed, kept }
}

function printHelp() {
  console.log('Stagebench bench CLI\n')
  console.log('Usage: pnpm bench <command> [args]\n')
  for (const [command, description] of Object.entries(COMMANDS)) console.log(`  ${command.padEnd(8)} ${description}`)
  console.log('\nA phase flows: start → implement in the workspace → seal → score (twice).')
}

try {
  const { positional, options } = parseArgs(process.argv.slice(2))
  const [command, id] = positional
  if (!command || command === 'help') {
    printHelp()
  } else if (!COMMANDS[command]) {
    throw new Error(`Unknown command: ${command} (try pnpm bench help)`)
  } else {
    const root = findRepoRoot(options.root)
    let result
    if (command === 'new') {
      preflight(root, options.variant)
      result = createRun(root, options)
      await reindexRegistry(root)
      result = { id: result.id, targetPhase: result.targetPhase, selectedPhases: result.selectedPhases, next: `pnpm bench start ${result.id}` }
    } else if (command === 'promote') {
      result = promoteRun(root, id, options.to, { replace: options.replace === 'true' })
      await reindexRegistry(root)
    } else if (command === 'rename') {
      result = renameRun(root, id, options.title)
      await reindexRegistry(root)
    } else if (command === 'start') {
      result = startPhase(root, id)
      result.next = `Point the implementation agent at ${result.workspace}/WORKSPACE.md, then run pnpm bench seal ${id}`
    } else if (command === 'exec') {
      const run = loadRun(root, id)
      const stage = nextPhase(run)
      if (!stage || stage.status !== 'running') throw new Error(`${id} has no running phase; run pnpm bench start ${id} first`)
      result = runInContainer(root, id, stage.number, options.command, { image: options.image, network: options.network })
    } else if (command === 'seal') {
      result = await seal(root, id, options)
    } else if (command === 'telemetry') {
      if (!options.phase) throw new Error('--phase is required')
      result = recordTelemetry(root, id, options.phase, telemetryFromFlags(options))
      await reindexRegistry(root)
    } else if (command === 'score') {
      result = await score(root, id, options)
    } else if (command === 'status') {
      const run = loadRun(root, id)
      const workspaces = runWorkspaces(root, run)
      result = {
        ...statusSummary(run),
        telemetry: run.telemetry ?? null,
        stages: run.stages.map(({ number, status, evaluation, telemetry }) => ({ number, status, score: evaluation?.score ?? null, telemetry: telemetry ?? null })),
        workspaces: (workspaces.work.length || workspaces.eval.length) ? workspaces : null,
      }
    } else if (command === 'clean') {
      if (options.all === 'true') {
        const base = path.dirname(workspaceRoot(root, 'work'))
        for (const kind of ['work', 'eval', 'gates']) fs.rmSync(workspaceRoot(root, kind), { recursive: true, force: true })
        result = { cleaned: 'all', base }
      } else {
        if (!id) throw new Error('clean requires a run id (or --all)')
        fs.rmSync(path.join(workspaceRoot(root, 'gates')), { recursive: true, force: true })
        result = cleanWorkspaces(root, loadRun(root, id), { force: options.force === 'true' })
      }
    } else if (command === 'export') {
      if (!id) throw new Error('export requires a run id')
      result = exportRun(root, id, { out: options.out })
    } else if (command === 'showcase') {
      // The showcase is not a run: it iterates on the best sealed artifact
      // beyond the benchmark rules, but must still pass its own four gates
      // before publishing.
      const showcaseDir = path.join(root, 'showcase')
      if (!fs.existsSync(path.join(showcaseDir, 'package.json'))) throw new Error('Missing showcase/ directory')
      ensureInstalled(showcaseDir)
      const checks = await runChecks(showcaseDir)
      const failed = checks.filter((check) => !check.passed)
      if (failed.length > 0) throw new Error(`Showcase checks failed (${failed.map((check) => check.id).join(', ')}):\n${failed.map((check) => check.detail).join('\n')}`)
      const destination = path.join(pathsFor(root).previews, 'showcase')
      fs.rmSync(destination, { recursive: true, force: true })
      fs.cpSync(path.join(showcaseDir, 'dist'), destination, { recursive: true })
      result = { published: '/previews/showcase/index.html', checks: checks.map(({ id, passed }) => ({ id, passed })) }
    } else if (command === 'reindex') {
      result = await reindexRegistry(root)
    } else if (command === 'fetch') {
      result = await fetchReference(root, { force: options.force === 'true', timeout: options.timeout })
      if (result.failed > 0) process.exitCode = 1
    }
    if (result) console.log(JSON.stringify(result, null, 2))
  }
} catch (error) {
  console.error(`bench: ${error.message}`)
  process.exitCode = 1
}

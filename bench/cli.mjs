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
import { ARTIFACT_DIGEST_VERSION, findRepoRoot, hashTree, loadProtocol, parseArgs, readJson, workspaceRoot, writeJson } from './lib/shared.mjs'
import {
  createRun,
  ensureInstalled,
  loadRun,
  saveRun,
  nextPhase,
  markSealed,
  pathsFor,
  recordTelemetry,
  registerEvaluation,
  reindexRegistry,
  promoteRun,
  renameRun,
  retargetRun,
  stageDirFor,
  stageState,
  statusSummary,
} from './lib/run/store.mjs'
import { importWorkspace, removeWorkspace, startPhase, workspaceDir } from './lib/run/workspace.mjs'
import { createEvalWorkspace, evalAssessmentPath, evalWorkspaceDir, removeEvalWorkspace } from './lib/eval/workspace.mjs'
import { exportRun } from './lib/run/export.mjs'
import { runChecks, verifyPhase } from './lib/run/verify.mjs'
import { captureEvidence, serveDirectory } from './lib/run/capture.mjs'
import { generateThumbnails } from './lib/run/thumbnail.mjs'
import { collectImplementationDetails } from './lib/implementation-details.mjs'
import { loadRubric, runGates } from './lib/eval/evaluate.mjs'
import { aggregateStageEvaluations, mergeAssessments, scoreAssessment } from './lib/eval/scoring.mjs'
import { renderRunReportHtml, renderRunReportMarkdown } from './lib/eval/report.mjs'
import { fetchReference } from './lib/fetch-reference.mjs'
import { tokenCoverageFromStages } from '../src/token-coverage.mjs'
import { TELEMETRY_FLAGS } from '../src/telemetry-fields.mjs'
import { parseSubagentTelemetryFiles, telemetryValuesFromParse } from './lib/telemetry-jsonl.mjs'
// Transcript archiving (sidecar records under runs/<id>/transcripts/, never
// part of the sealed artifact). Hooked into start/seal/score below.
import { appendOperatorEvent, parseTranscriptList, recordPhaseTranscripts } from './lib/run/transcripts.mjs'

const COMMANDS = {
  new: 'Create a run: --model <id> [--target 1|2|3] [--variant <id>] [--title ...] [--provider ...] [--harness ...] [--reasoning ...] [--notes ...] [--isolation lockdown|none] (lockdown is the default)',
  promote: 'promote <run-id> --to <clean-id> [--replace] — move a completed run to a canonical id',
  retarget: 'retarget <run-id> --to <2|3> — extend a run to a later target phase; sealed phases are untouched',
  rename: 'rename <run-id> --title "..." — update a run’s gallery title',
  start: 'start <run-id> — create the next phase workspace for the implementation agent',
  agent: 'agent <run-id> --harness <codex|claude|custom> — run the implementation agent inside the lockdown [--model ...] [--effort ...] [--prompt "..."|--prompt-file f] [--interactive] [--auth <mode>] [--pin-models a,b] [--timeout-minutes N]; rerun with --prompt to send a follow-up',
  exec: 'exec <run-id> --command "..." — run a shell command in the phase\'s lockdown box (candidate/ is the working directory; registry mirror only)',
  'lockdown-setup': 'Create the dedicated container VM if needed, build the lockdown images, and report what the boundary looks like [--rebuild]',
  redteam: 'redteam — attack the lockdown from inside and record the results [--agent <codex|claude>] [--out <dir>]',
  seal: 'seal <run-id> — import (a locked phase is exported from its container volume and its gates run in the box), check, capture, verify, and seal the running phase, then archive its agent transcripts into runs/<id>/transcripts/ [--unlocked to seal host-side work for a run that requires the lockdown; recorded as isolation none] [--cost-usd N --input-tokens N --output-tokens N --reasoning-tokens N --tool-calls N] [--transcripts <file[,file...]> to add sessions auto-discovery misses]',
  transcripts: 'transcripts <run-id> --phase N [--eval] [--transcripts <file[,file...]>] [--workspace <path>] — archive (scrubbed, zstd) agent transcripts for a sealed phase after the fact; discovers Codex/Claude Code/Cursor sessions by workspace cwd when no files are given',
  telemetry: 'telemetry <run-id> --phase N — record or correct usage after the fact (same flags as seal, or --from-jsonl <a.jsonl[,b.jsonl...]> to recompute tokens/cost from Claude Code subagent transcripts; comma-separate multiple files)',
  score: 'score <run-id> [--phase N] — build the isolated evaluator workspace, or register its filled assessment',
  status: 'status <run-id> — show run state, telemetry, and the next command',
  clean: 'clean [<run-id>] — remove transient work/eval/gates workspaces and lockdown sessions [--all] [--force to remove a running phase]',
  export: 'export <run-id> [--out <path>] — bundle run.json, evaluations, report, and preview into a ZIP',
  showcase: 'Check, build, and publish showcase/ to public/previews/showcase',
  thumbs: 'Regenerate gallery hover thumbnails from the published previews [<run-id>]',
  redigest: 'redigest [<run-id>] — re-record sealed artifact digests under the current artifact definition [--apply] (dry run by default)',
  reindex: 'Regenerate src/data/runs.json from runs/*/run.json',
  fetch: 'Download the Nord manual and product photos into ./reference [--force] [--timeout <ms>] [--photos-only]',
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

  // A run created to require the lockdown cannot be sealed from a host
  // workspace: the candidate tree has to come out of the box.
  const lockdown = await import('./lockdown/seal.mjs')
  const locked = lockdown.hasSession(root, id, phase)
  const progress = (text) => process.stderr.write(text)
  if (!locked && lockdown.requiredIsolation(run) === 'lockdown' && options.unlocked !== 'true') {
    throw new Error(`${id} requires the lockdown, but Phase ${phase} has no lockdown session. Run the agent with: pnpm bench agent ${id} --harness <codex|claude|custom>. (To seal work done outside the box anyway — recorded as isolation "none" — pass --unlocked.)`)
  }
  let exported = null
  if (locked) {
    console.error('→ exporting the candidate tree from the lockdown volume')
    exported = await lockdown.exportLockedCandidate(root, { id, phase, workspace: workspaceDir(root, id, phase), onOutput: progress })
  } else {
    console.error(`! sealing Phase ${phase} WITHOUT the lockdown: the candidate ran with whatever access its harness allowed, and the gates run on this host`)
  }

  console.error(`→ importing workspace candidate into runs/${id}/stage${phase}`)
  importWorkspace(root, id, phase)
  const stageDir = stageDirFor(root, id, phase)

  let checks
  let gates = null
  if (locked) {
    // Candidate-authored code (install scripts, tests, the build) never
    // executes on the host for a locked phase.
    console.error('→ running install, test, typecheck, lint, build inside the lockdown')
    gates = await lockdown.runLockedChecks(root, stageDir, { onOutput: progress })
    checks = gates.checks
    const blockers = lockdown.sealBlockers(root, id, phase, exported, gates, stageDir)
    if (blockers.length > 0) throw new Error(`Phase ${phase} cannot be sealed from this lockdown session: ${blockers.join('; ')}`)
  } else {
    console.error('→ installing dependencies')
    ensureInstalled(stageDir)

    console.error('→ running test, typecheck, lint, build')
    checks = await runChecks(stageDir)
  }
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
  verification.isolation = locked ? lockdown.attestation(root, id, phase, exported, gates) : lockdown.unlockedAttestation()
  if (locked) verification.evidence.push(...lockdown.lockdownEvidence(exported))
  // Advisory: are any bundled assets byte-identical to ones that already exist
  // in another run or a known local library?
  const { assetProvenance, assetProvenanceCheck, blindArtifactCheck } = await import('./lockdown/provenance.mjs')
  const provenance = assetProvenance(root, id, stageDir)
  verification.assetProvenance = { ...provenance, files: undefined }
  verification.evidence.push(assetProvenanceCheck(provenance))
  // Advisory: does the artifact itself say which run (and so which model) it is?
  const { findStrings } = await import('./lockdown/session.mjs')
  verification.evidence.push(blindArtifactCheck(stageDir, id, [...new Set(findStrings(stageDir, [id], { minLength: 3 }).map((hit) => hit.path))].filter((file) => !file.startsWith('dist/') && !file.startsWith('node_modules/'))))
  writeJson(path.join(root, 'runs', id, 'verifications', `stage${phase}.json`), verification)
  if (!verification.passed) {
    const failures = [...verification.checks, ...verification.evidence].filter((check) => !check.passed)
    throw new Error(`Phase ${phase} verification failed: ${failures.map((check) => check.detail ?? check.id).join('; ')}`)
  }

  markSealed(root, id, phase, verification)
  const usage = telemetryFromFlags(options)
  if (Object.keys(usage).length > 0) recordTelemetry(root, id, phase, usage)
  // Record how the phase was contained next to its digest.
  const sealedRun = loadRun(root, id)
  const sealedStage = stageState(sealedRun, phase)
  sealedStage.isolation = locked
    ? { mode: 'lockdown', gatewayHead: verification.isolation.gateway.head, denied: verification.isolation.gateway.denied, record: `runs/${id}/lockdown/stage${phase}.json` }
    : { mode: 'none' }
  saveRun(root, sealedRun)
  // Archive the agent sessions that produced this phase (scrubbed + zstd) as
  // sidecar records in runs/<id>/transcripts/ — after the digest is recorded
  // and outside stage<N>/, so they are never part of the sealed artifact.
  // Missing transcripts warn and record a gap; they never fail the seal.
  // A locked phase's sessions were written inside the box, not under the
  // operator's home, so they are handed over explicitly from the export.
  console.error('→ archiving agent transcripts')
  const transcripts = recordPhaseTranscripts(root, id, {
    kind: 'candidate',
    phase,
    workspace: workspaceDir(root, id, phase),
    explicit: [...parseTranscriptList(options.transcripts), ...(locked ? lockdown.sessionTranscriptFiles(exported) : [])],
    since: Date.parse(stage.startedAt) || null,
    command: 'seal',
  })
  // Keep the boundary's own record with the run, then close the box.
  if (locked) lockdown.archiveAndClose(root, id, phase, verification.isolation, gates)
  removeWorkspace(root, id, phase)
  await reindexRegistry(root)
  const sealed = loadRun(root, id)
  return {
    id,
    phase,
    artifactDigest: verification.artifactDigest,
    preview: sealed.previews?.[String(phase)],
    isolation: verification.isolation.mode,
    ...(locked ? { lockdown: { gatewayHead: verification.isolation.gateway.head, deniedEgress: verification.isolation.gateway.denied, honeytoken: verification.isolation.honeytoken, droppedOnExport: verification.isolation.export.dropped.length } } : {}),
    assetProvenance: { assets: provenance.assets, matched: provenance.matched, matchedOrigins: provenance.matchedOrigins },
    telemetry: sealed.stages.find((entry) => entry.number === phase)?.telemetry ?? null,
    transcripts,
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
  // The run-level panel axis is carried by the highest sealed phase, so the
  // workspace builder needs to know which phases are sealed, not just this one.
  const sealedPhases = run.stages.filter((entry) => entry.status === 'complete').map((entry) => entry.number)
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
      sealedPhases,
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
  const evaluatorOptions = { allowEvaluatorModel: options['allow-evaluator-model'] === 'true' }
  const assessment = mergeAssessments(rubric, panel, evaluatorOptions)
  // Map the blind handle the evaluators saw back to the real run id.
  assessment.runId = id

  const stageDir = stageDirFor(root, id, phase)
  if (stage.artifactDigest) {
    const currentDigest = hashTree(stageDir).digest
    if (currentDigest !== stage.artifactDigest) throw new Error(`Phase ${phase} changed after sealing; run seal again before scoring`)
  }
  // Gates run against a throwaway copy out of the repo, so the sealed stage
  // directory is never mutated. For a run that requires the lockdown — or with
  // --sandbox / STAGEBENCH_SANDBOX=1 — they run inside the lockdown box, so
  // candidate code never executes on this machine (--host-gates opts out).
  const technicalChecks = await runGates(root, stageDir, rubric, {
    skip: options['skip-checks'] === 'true',
    sandbox: options.sandbox === 'true' || process.env.STAGEBENCH_SANDBOX === '1' || (run.isolation === 'lockdown' && options['host-gates'] !== 'true'),
  })
  // Boxed gates come back with the log of what they fetched; keep it with the run.
  if (technicalChecks.gateway?.events) {
    const lockdownDir = path.join(root, 'runs', id, 'lockdown')
    fs.mkdirSync(lockdownDir, { recursive: true })
    fs.writeFileSync(path.join(lockdownDir, `stage${phase}.score-gates.gateway.jsonl`), technicalChecks.gateway.events)
  }
  const evaluation = scoreAssessment(rubric, assessment, technicalChecks, evaluatorOptions)
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
    evaluatorModel: evaluation.evaluatorModel,
    rubricVersion: evaluation.rubricVersion,
    path: path.relative(root, evaluationPath).split(path.sep).join('/'),
    reportPath,
    categoryScores: Object.fromEntries(evaluation.categories.map((category) => [category.id, category.score])),
    ...(evaluation.runAxis ? { runAxis: { id: evaluation.runAxis.id, label: evaluation.runAxis.label, score: evaluation.runAxis.score, rawScore: evaluation.runAxis.rawScore, hardGate: evaluation.runAxis.hardGate } } : {}),
  }
  const updated = loadRun(root, id)
  const summaries = updated.stages.map((entry) => entry.number === phase
    ? { stage: phase, status: 'complete', score: evaluation.score }
    : entry.evaluation ? { stage: entry.number, status: 'complete', score: entry.evaluation.score } : null).filter(Boolean)
  // The panel axis is scored once, on the top phase. Reuse the freshly scored
  // one when this call is that phase; otherwise recover it from the record so
  // scoring an earlier phase doesn't silently drop 40% of the aggregate.
  const runAxis = evaluation.runAxis
    ?? updated.stages.map((entry) => entry.evaluation?.runAxis).filter(Boolean).at(-1)
    ?? null
  const aggregate = { ...aggregateStageEvaluations(rubric, summaries, runAxis), reportPath: `/reports/${id}/index.html` }
  registerEvaluation(root, id, phase, stageSummary, aggregate)
  writeReports(root, loadRun(root, id))
  await reindexRegistry(root)
  // Evaluator/reviewer sessions ran in the blind workspace; archive them under
  // transcripts/eval/phase-N before that workspace is removed. Never fatal.
  const transcripts = recordPhaseTranscripts(root, id, {
    kind: 'eval',
    phase,
    workspace,
    explicit: parseTranscriptList(options.transcripts),
    since: Date.parse(stage.completedAt) || null,
    command: 'score',
  })
  removeEvalWorkspace(root, id, phase)
  return { action: 'scored', phase, score: evaluation.score, aggregate: aggregate.score, evaluationPath, report: aggregate.reportPath, transcripts }
}

// Sealed digests recorded under an older artifact definition can never
// validate — `dist/` was inside the digest but matched .gitignore at every
// depth, so it was never committed. Re-record them against the current
// definition and stamp the version, so a stale digest stays an auditable fact
// rather than a check everyone learns to skip. Dry run unless --apply.
function redigest(root, id, { apply = false } = {}) {
  const ids = id ? [id] : fs.readdirSync(path.join(root, 'runs')).filter((entry) => fs.existsSync(path.join(root, 'runs', entry, 'run.json')))
  const stages = []
  for (const runId of ids) {
    const runPath = path.join(root, 'runs', runId, 'run.json')
    const run = readJson(runPath)
    if (run.schemaVersion !== 4) continue
    let changed = false
    for (const stage of run.stages) {
      if (stage.status !== 'complete') continue
      const stageDir = path.join(root, 'runs', runId, `stage${stage.number}`)
      if (!fs.existsSync(stageDir)) continue
      const current = hashTree(stageDir).digest
      const matches = current === stage.artifactDigest
      const alreadyStamped = stage.artifactDigestVersion === ARTIFACT_DIGEST_VERSION
      stages.push({ run: runId, phase: stage.number, matches, alreadyStamped, recorded: stage.artifactDigest?.slice(0, 12) ?? null, current: current.slice(0, 12) })
      if (matches && alreadyStamped) continue
      if (apply) {
        stage.artifactDigest = current
        stage.artifactDigestVersion = ARTIFACT_DIGEST_VERSION
        changed = true
      }
    }
    if (changed) writeJson(runPath, run)
  }
  const stale = stages.filter((entry) => !entry.matches)
  return {
    action: apply ? 'redigested' : 'redigest-dry-run',
    digestVersion: ARTIFACT_DIGEST_VERSION,
    checked: stages.length,
    stale: stale.length,
    ...(apply ? {} : { next: 'Re-run with --apply to record these digests' }),
    stages: stale,
  }
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
async function cleanWorkspaces(root, run, { force = false } = {}) {
  const runningPhases = new Set((run.stages ?? []).filter((stage) => stage.status === 'running').map((stage) => stage.number))
  const removed = []
  const kept = []
  const { work, eval: evaluations } = runWorkspaces(root, run)
  const { loadSession, destroySession } = await import('./lockdown/session.mjs')
  for (const entry of work) {
    if (runningPhases.has(entry.phase) && !force) {
      kept.push({ ...entry, kind: 'work', reason: 'phase is running; pass --force to remove unsealed work' })
      continue
    }
    // A locked phase's source lives in container volumes, not in the workspace.
    if (loadSession(root, run.id, entry.phase)) {
      destroySession(root, run.id, entry.phase, { keepState: false })
      removed.push({ ...entry, kind: 'lockdown-session' })
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
  for (const [command, description] of Object.entries(COMMANDS)) console.log(`  ${command.padEnd(14)} ${description}`)
  console.log('\nA phase flows: start → agent (implements inside the lockdown) → seal → score (twice).')
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
      result = { id: result.id, targetPhase: result.targetPhase, selectedPhases: result.selectedPhases, isolation: result.run.isolation, next: `pnpm bench start ${result.id}` }
    } else if (command === 'promote') {
      result = promoteRun(root, id, options.to, { replace: options.replace === 'true' })
      await reindexRegistry(root)
    } else if (command === 'retarget') {
      preflight(root, loadRun(root, id).variant)
      result = retargetRun(root, id, options.to)
      await reindexRegistry(root)
    } else if (command === 'rename') {
      result = renameRun(root, id, options.title)
      await reindexRegistry(root)
    } else if (command === 'start') {
      result = startPhase(root, id)
      result.isolation = loadRun(root, id).isolation ?? 'none'
      appendOperatorEvent(root, id, { command: 'start', phase: result.phase, workspace: result.workspace, reused: result.reused, isolation: result.isolation })
      result.next = result.isolation === 'lockdown'
        ? `Run the implementation agent inside the lockdown: pnpm bench agent ${id} --harness <codex|claude|custom> [--model ...]. Then run pnpm bench seal ${id}`
        : `Point the implementation agent at ${result.workspace}/WORKSPACE.md, then run pnpm bench seal ${id}`
    } else if (command === 'agent') {
      const run = loadRun(root, id)
      const stage = nextPhase(run)
      if (!stage || stage.status !== 'running') throw new Error(`${id} has no running phase; run pnpm bench start ${id} first`)
      if (!options.harness) throw new Error('--harness is required (codex, claude, or custom)')
      const { launchAgent } = await import('./lockdown/session.mjs')
      const launched = await launchAgent(root, {
        id, phase: stage.number, workspace: workspaceDir(root, id, stage.number), harness: options.harness, options,
        onOutput: (text) => process.stderr.write(text),
      })
      result = {
        id,
        phase: stage.number,
        session: launched.session,
        harness: launched.launch.harnessLabel,
        harnessVersion: launched.launch.harnessVersion ?? null,
        exitCode: launched.launch.exitCode,
        log: launched.logFile,
        gateway: { chainOk: launched.gateway.chainOk, head: launched.gateway.head, modelRequests: launched.gateway.modelRequests, strippedTools: launched.gateway.strippedTools, deniedEgress: launched.gateway.denied, deniedTargets: launched.gateway.deniedTargets, usage: launched.gateway.usage },
        next: launched.launch.exitCode === 0
          ? `pnpm bench seal ${id}   (or send a follow-up: pnpm bench agent ${id} --harness ${options.harness} --prompt "...")`
          : `The agent exited ${launched.launch.exitCode}. Read ${launched.logFile}, then relaunch or follow up with pnpm bench agent ${id} --harness ${options.harness} --prompt "..."`,
      }
      // Every launch — and so every message an operator sends a boxed
      // candidate — lands in the run's operator log.
      appendOperatorEvent(root, id, {
        command: 'agent',
        phase: stage.number,
        isolation: 'lockdown',
        session: launched.session,
        harness: launched.launch.harnessLabel,
        harnessVersion: launched.launch.harnessVersion ?? null,
        kind: launched.launch.kind,
        interactive: launched.launch.interactive,
        promptSha256: launched.launch.promptSha256,
        ...(launched.launch.kind === 'follow-up' ? { operatorMessage: launched.launch.prompt } : {}),
        exitCode: launched.launch.exitCode,
        gatewayHead: launched.gateway.head,
        deniedEgress: launched.gateway.denied,
      })
      if (launched.launch.exitCode !== 0) process.exitCode = 1
    } else if (command === 'exec') {
      const run = loadRun(root, id)
      const stage = nextPhase(run)
      if (!stage || stage.status !== 'running') throw new Error(`${id} has no running phase; run pnpm bench start ${id} first`)
      if (!options.command?.length) throw new Error('A command is required after --command')
      const { execInSession } = await import('./lockdown/session.mjs')
      const executed = await execInSession(root, {
        id, phase: stage.number, workspace: workspaceDir(root, id, stage.number), command: options.command,
        onOutput: (text) => process.stderr.write(text),
      })
      if (executed.status !== 0) throw new Error(`Command exited ${executed.status} inside the lockdown`)
      result = { ok: true, isolation: 'lockdown', command: options.command }
    } else if (command === 'lockdown-setup') {
      const { setupLockdown } = await import('./lockdown/setup.mjs')
      result = await setupLockdown({ rebuild: options.rebuild === 'true', onOutput: (text) => process.stderr.write(text) })
    } else if (command === 'redteam') {
      const { runRedTeam } = await import('./lockdown/redteam/run.mjs')
      result = await runRedTeam(root, { ...options, onOutput: (text) => process.stderr.write(text) })
      if (!result.passed) process.exitCode = 1
    } else if (command === 'seal') {
      result = await seal(root, id, options)
    } else if (command === 'telemetry') {
      if (!options.phase) throw new Error('--phase is required')
      let usage = telemetryFromFlags(options)
      if (options['from-jsonl']) {
        // parseArgs is last-wins per flag, so multiple transcripts are passed
        // as one comma-separated list (repeating the flag would silently drop
        // all but the last file).
        const files = String(options['from-jsonl']).split(',').map((file) => file.trim()).filter(Boolean)
        const parsed = parseSubagentTelemetryFiles(files)
        if (!parsed.ok) throw new Error(`--from-jsonl: ${parsed.reason} in ${files.join(', ')}`)
        // Recomputed values first; any explicit flag (e.g. a known cost) wins.
        usage = { ...telemetryValuesFromParse(parsed), ...usage }
      }
      result = recordTelemetry(root, id, options.phase, usage)
      await reindexRegistry(root)
    } else if (command === 'transcripts') {
      // After-the-fact archiving for a sealed phase (or its evaluation), e.g.
      // a session discovery missed at seal time. Additive: never drops files
      // already archived for the phase.
      if (!options.phase) throw new Error('--phase is required')
      const run = loadRun(root, id)
      const stage = stageState(run, options.phase)
      if (stage.status !== 'complete') throw new Error(`Phase ${stage.number} is not sealed; seal archives its transcripts`)
      const kind = options.eval === 'true' ? 'eval' : 'candidate'
      const workspace = options.workspace ?? (kind === 'eval' ? evalWorkspaceDir(root, id, stage.number) : workspaceDir(root, id, stage.number))
      result = recordPhaseTranscripts(root, id, {
        kind,
        phase: stage.number,
        workspace,
        explicit: parseTranscriptList(options.transcripts),
        since: Date.parse(kind === 'eval' ? stage.completedAt : stage.startedAt) || null,
        command: 'transcripts',
      })
    } else if (command === 'score') {
      result = await score(root, id, options)
    } else if (command === 'status') {
      const run = loadRun(root, id)
      const workspaces = runWorkspaces(root, run)
      result = {
        ...statusSummary(run),
        telemetry: run.telemetry ?? null,
        tokenCoverage: tokenCoverageFromStages(run.stages),
        stages: run.stages.map(({ number, status, evaluation, telemetry }) => ({ number, status, score: evaluation?.score ?? null, telemetry: telemetry ?? null })),
        workspaces: (workspaces.work.length || workspaces.eval.length) ? workspaces : null,
      }
    } else if (command === 'clean') {
      if (options.all === 'true') {
        const base = path.dirname(workspaceRoot(root, 'work'))
        for (const kind of ['work', 'eval', 'gates']) fs.rmSync(workspaceRoot(root, kind), { recursive: true, force: true })
        // Locked phases keep their source in container volumes; drop those too
        // when an engine is reachable.
        const lockdownRuntime = await import('./lockdown/runtime.mjs')
        if (lockdownRuntime.detectRuntime()) (await import('./lockdown/session.mjs')).destroyAllSessions(root)
        result = { cleaned: 'all', base }
      } else {
        if (!id) throw new Error('clean requires a run id (or --all)')
        fs.rmSync(path.join(workspaceRoot(root, 'gates')), { recursive: true, force: true })
        result = await cleanWorkspaces(root, loadRun(root, id), { force: options.force === 'true' })
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
    } else if (command === 'thumbs') {
      // Hover thumbnails are derived from the published preview build, so the
      // gallery can address one as previewPath with index.html swapped for
      // thumb.jpg — no new field in the run record.
      const locations = pathsFor(root)
      const ids = id
        ? [id]
        : fs.readdirSync(path.join(root, 'runs')).filter((entry) => fs.existsSync(path.join(root, 'runs', entry, 'run.json')))
      const targets = []
      for (const runId of ids) {
        const run = loadRun(root, runId)
        if (!run.previewPath) continue
        const stage = `stage${run.previewStage}`
        const directory = path.join(locations.previews, run.id, stage)
        if (!fs.existsSync(path.join(directory, 'index.html'))) continue
        targets.push({ id: `${run.id}/${stage}`, directory, output: path.join(directory, 'thumb.jpg') })
      }
      if (targets.length === 0) throw new Error('No published previews found to thumbnail')
      result = { thumbnails: await generateThumbnails(targets) }
    } else if (command === 'redigest') {
      result = redigest(root, id, { apply: options.apply === 'true' })
    } else if (command === 'reindex') {
      result = await reindexRegistry(root)
    } else if (command === 'fetch') {
      result = await fetchReference(root, { force: options.force === 'true', timeout: options.timeout, photosOnly: options['photos-only'] === 'true' })
      if (result.failed > 0) process.exitCode = 1
    }
    if (result) console.log(JSON.stringify(result, null, 2))
  }
} catch (error) {
  console.error(`bench: ${error.message}`)
  process.exitCode = 1
}

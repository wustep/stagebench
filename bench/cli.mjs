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
import { ARTIFACT_DIGEST_VERSION, findRepoRoot, hashFile, hashTree, isStrictProtocol, loadProtocol, parseArgs, readJson, sha256, workspaceRoot, writeJson } from './lib/shared.mjs'
import { BudgetSpent, budgetRecord, nextLaunchAllowance, runRules, sealFailureRelays } from './lib/run/rules.mjs'
import { loadPrices, readGatewayEvents, summarizeUsage } from './lib/usage.mjs'
import {
  addFootnote,
  createRun,
  ensureInstalled,
  forkRun,
  removeFootnote,
  runFootnotes,
  loadRun,
  saveRun,
  nextPhase,
  markSealed,
  pathsFor,
  recordTelemetry,
  recomputeRunTelemetry,
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
import { EVAL_BLINDING_VERSION, checkEvalWorkspace } from './lib/eval/blinding.mjs'
import { createEvalWorkspace, evalAssessmentPath, evalWorkspaceDir, removeEvalWorkspace } from './lib/eval/workspace.mjs'
import { exportRun } from './lib/run/export.mjs'
import {
  blindArtifactEvidence, collectFeatureTestsOnHost, featureExecution, featureExecutionEvidence, findAgentInstructionFiles, findProducerNames, materialDigests, readFeatureMatrix, runChecks, verifyPhase,
} from './lib/run/verify.mjs'
import { appendLedger, readLedger, sealedEntry, treeDifference, verifySealedRun } from './lib/run/ledger.mjs'
import { applyMatchResults, checkSampleProvenance, sampleProvenanceEvidence } from './lib/run/sample-provenance.mjs'
import { checkSamplePack, fetchSamplePack, loadSamplePack } from './lib/sample-pack.mjs'
import { captureEvidence, serveDirectory } from './lib/run/capture.mjs'
import { generateThumbnails } from './lib/run/thumbnail.mjs'
import { collectImplementationDetails } from './lib/implementation-details.mjs'
import { loadRubric, rubricVersionForRun, runGates } from './lib/eval/evaluate.mjs'
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
  new: 'Create a run: --model <id> [--target 1|2|3] [--variant <id>] [--title ...] [--provider ...] [--harness ...] [--reasoning ...] [--notes ...] [--isolation lockdown|none] (lockdown is the default; none is recorded and footnoted)',
  promote: 'promote <run-id> --to <clean-id> [--replace] — move a completed run to a canonical id',
  retarget: 'retarget <run-id> --to <2|3> — extend a run to a later target phase; sealed phases are untouched',
  rename: 'rename <run-id> --title "..." — update a run’s gallery title',
  start: 'start <run-id> — create the next phase workspace for the implementation agent',
  agent: 'agent <run-id> --harness <codex|claude|omp|custom> — run the implementation agent inside the lockdown [--model ...] (omp: --model <AI Gateway model>, e.g. google/gemini-4-neon) [--effort ...] [--interactive] [--auth <mode>] [--pin-models a,b] [--timeout-minutes N]; rerun with --message <continue|seal-failure> to send a follow-up (fixed templates; --off-protocol-message "..." sends your own words and marks the phase)',
  exec: 'exec <run-id> --command "..." — run a shell command in the phase\'s lockdown box (candidate/ is the working directory; no network)',
  evaluator: 'evaluator <run-id> [--phase N] --harness <claude|codex|custom> [--model ...] [--slot N] — run the evaluator inside a lockdown box whose only contents are the blind evaluator workspace, then bring its assessment back [--message <continue|review>]',
  'lockdown-setup': 'Create the dedicated container VM if needed, build the lockdown images (offline npm mirror and Chromium included), and report what the boundary looks like [--rebuild] [--omp to also build the image --harness omp runs in (Bun and Oh My Pi); an omp launch builds it on demand otherwise]',
  redteam: 'redteam — attack the lockdown from inside and record the results [--agent <codex|claude>] [--out <dir>]',
  seal: 'seal <run-id> — export the phase from its container volume, run its gates, canonical capture, audio measurement, and sample check in a box with no network, verify, and seal it, with its agent transcripts and its gateway-derived token usage and cost [--unlocked to seal host-side work for a run that requires the lockdown; recorded as isolation none] [--as-failed to seal the phase as it stands, marked failed (an operator decision, recorded; a failing seal does this by itself once an official phase has used its seal-failure rounds or its budget)] [--cost-usd N --input-tokens N ... are recorded as operator-entered and non-official; a boxed phase\'s figures come from its gateway log] [--transcripts <file[,file...]> to add sessions auto-discovery misses]',
  fork: 'fork <run-id> --to <new-id> --reason "..." [--from-phase N] — start an operator-patched copy of a sealed run as a NEW, labelled run; sealed evidence is never edited or re-sealed in place',
  footnote: 'footnote <run-id> [--add "text" [--phase N] [--kind audit|note]] [--remove <index>] — list, attach, or remove a note shown beside the run in the gallery',
  'verify-sealed': 'verify-sealed [<run-id>] — re-hash every sealed stage against run.json and the seal ledger; exits 1 if a sealed tree or its record was changed',
  transcripts: 'transcripts <run-id> --phase N [--eval] [--transcripts <file[,file...]>] [--workspace <path>] — archive (scrubbed, zstd) agent transcripts for a sealed phase after the fact; discovers Codex/Claude Code/Cursor sessions by workspace cwd when no files are given',
  telemetry: 'telemetry <run-id> --phase N — record usage after the fact, as operator-entered (it never replaces a boxed phase\'s gateway-derived figures) (same flags as seal, or --from-jsonl <a.jsonl[,b.jsonl...]> to recompute tokens/cost from Claude Code subagent transcripts; comma-separate multiple files)',
  score: 'score <run-id> [--phase N] — build the blind evaluator workspace, or register its filled assessment',
  status: 'status <run-id> — show run state, telemetry, and the next command',
  clean: 'clean [<run-id>] — remove transient work/eval/gates workspaces and lockdown sessions [--all] [--force to remove a running phase]',
  export: 'export <run-id> [--out <path>] — bundle run.json, evaluations, report, and preview into a ZIP',
  showcase: 'Check, build, and publish showcase/ to public/previews/showcase',
  thumbs: 'Regenerate gallery hover thumbnails from the published previews [<run-id>]',
  redigest: 'redigest [<run-id>] — re-record sealed artifact digests when the artifact DEFINITION changed [--apply] (dry run by default; never moves a digest recorded under the current definition)',
  reindex: 'Regenerate src/data/runs.json from runs/*/run.json',
  fetch: 'Download the Nord manual, the product photos, and the sample pack (each file checked against its sha256) [--force] [--timeout <ms>] [--photos-only] [--samples-only]',
  'offline-lock': 'Maintainer: re-resolve the offline npm mirror from bench/lockdown/offline/packages.json and the starter, and rewrite its hashed lock (needs network; changes the image)',
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

// Protocol 3 gives every candidate the same recordings. A phase does not start
// without them: an offline candidate has nowhere else to get any.
async function requireSamplePack(root) {
  const pack = loadSamplePack(root)
  if (!pack) throw new Error('sample-pack/manifest.json is missing from this checkout')
  const state = await checkSamplePack(root, { deep: false })
  if (!state.present) throw new Error(`The sample pack is incomplete (${state.problems.length} problem(s), e.g. ${state.problems[0]}). Run pnpm bench fetch.`)
  return pack
}

// A seal error that is the operator's to fix (the checkout, the box, the
// price table, the transcript archive), not the candidate's. It is never
// relayed to the candidate and never counts against the seal-failure rounds.
function operatorError(message) {
  const error = new Error(message)
  error.operatorSide = true
  return error
}

// Seal the running phase. A failure is recorded in the harness's own words, so
// that what the operator relays to the candidate afterwards is the seal's
// output and not a paraphrase of it.
//
// An official run (protocol 3, in the lockdown, with the protocol's rules) gets
// a fixed number of seal-failure relays per phase. Once they are used, or once
// the phase's budget leaves no room for another launch, a seal that fails seals
// the phase anyway: the artifact as it stands is frozen, marked failed, with
// what failed. A phase is never left unsealed for want of another round.
async function seal(root, id, options) {
  const run = loadRun(root, id)
  const stage = nextPhase(run)
  if (!stage || stage.status !== 'running') throw new Error(`${id} has no running phase to seal (next: ${statusSummary(run).next})`)
  const phase = stage.number
  // Sealed evidence is never re-sealed, whatever run.json has been made to say.
  const prior = sealedEntry(root, id, phase)
  if (prior) {
    throw new Error(`Phase ${phase} of ${id} was already sealed at ${prior.at} (digest ${String(prior.artifactDigest).slice(0, 12)}). A sealed phase is never sealed again. To change a sealed artifact, fork it into a new, labelled run: pnpm bench fork ${id} --to <new-id> --reason "<what you are changing and why>"`)
  }
  const lockdown = await import('./lockdown/seal.mjs')
  const { sessionStateDir, loadSession } = await import('./lockdown/session.mjs')
  const { recordSealFailure, neutralizeFailure } = await import('./lockdown/messages.mjs')
  const locked = lockdown.hasSession(root, id, phase)
  // A run created to require the lockdown cannot be sealed from a host
  // workspace: the candidate tree has to come out of the box. An operator
  // patch is the exception by construction — it is the operator's own edit,
  // made on this machine, and the run says so everywhere.
  if (!locked && !stage.patchOf && lockdown.requiredIsolation(run) === 'lockdown' && options.unlocked !== 'true') {
    throw new Error(`${id} requires the lockdown, but Phase ${phase} has no lockdown session. Run the agent with: pnpm bench agent ${id} --harness <codex|claude|omp|custom>. (To seal work done outside the box anyway — recorded as isolation "none" and footnoted in the gallery — pass --unlocked.)`)
  }
  const rules = locked ? runRules(run) : null
  const launches = locked ? (loadSession(root, id, phase)?.launches ?? []) : []
  const attempts = readLedger(root, id).entries.filter((entry) => entry.kind === 'seal-attempt' && entry.phase === phase).length + 1
  const relays = sealFailureRelays(launches)
  // Would a failure now be the last word? Then this seal finalizes the phase.
  let finalize = null
  if (options['as-failed'] === 'true') finalize = { by: 'operator', detail: 'the operator chose to seal the phase as it stands' }
  else if (rules) {
    if (relays >= rules.sealFailureRounds) finalize = { by: 'seal-failure-rounds', detail: `all ${rules.sealFailureRounds} seal-failure rounds have been used` }
    else {
      try {
        const spent = summarizeUsage(readGatewayEvents(path.join(sessionStateDir(root, id, phase), 'gateway', 'events.jsonl'))).outputTokens
        nextLaunchAllowance(rules, { launches, outputTokensSpent: spent })
      } catch (error) {
        if (error instanceof BudgetSpent) finalize = { by: 'budget', detail: error.message }
        else throw error
      }
    }
  }
  const counts = { attempts, relays, limit: rules?.sealFailureRounds ?? null }
  try {
    return await sealPhase(root, run, stage, { options, lockdown, locked, rules, launches, finalize, counts })
  } catch (error) {
    const context = { root, id, stageDir: stageDirFor(root, id, phase), names: [run.model, run.title, run.agent?.model].filter(Boolean) }
    if (error.operatorSide) {
      try { appendOperatorEvent(root, id, { command: 'seal', phase, outcome: 'operator-error', failure: neutralizeFailure(error.message, context).slice(0, 4000) }) } catch { /* the failure below is the one that matters */ }
      error.message = `${error.message}\n\nThis is not the candidate's to fix: it is not recorded for relay and does not count as a seal-failure round.`
      throw error
    }
    const failure = locked ? recordSealFailure(sessionStateDir(root, id, phase), error.message, context) : neutralizeFailure(error.message, context)
    try {
      appendOperatorEvent(root, id, { command: 'seal', phase, outcome: 'failed', failure: failure.slice(0, 4000) })
      // Every failed attempt is in the ledger too: how many rounds a phase took is part of its record.
      if (locked) appendLedger(root, id, { kind: 'seal-attempt', phase, attempt: attempts, outcome: 'failed', failureSha256: sha256(failure), sealFailureRelays: relays, sealFailureLimit: rules?.sealFailureRounds ?? null })
    } catch { /* the failure below is the one that matters */ }
    if (locked) {
      const left = rules ? rules.sealFailureRounds - relays : null
      error.message = `${error.message}\n\nThis output is saved. To relay it to the candidate exactly as printed (and nothing else): pnpm bench agent ${id} --harness <same harness> --message seal-failure${left !== null ? `   (seal-failure round ${relays + 1} of ${rules.sealFailureRounds}; after the last one, a failing seal seals the phase as failed)` : ''}`
    }
    throw error
  }
}

async function sealPhase(root, run, stage, { options, lockdown, locked, rules = null, launches = [], finalize = null, counts = {} }) {
  const id = run.id
  const phase = stage.number
  const strict = isStrictProtocol(run)
  const patch = stage.patchOf ?? null
  const workspace = workspaceDir(root, id, phase)
  const progress = (text) => process.stderr.write(text)
  // What the candidate can fix, collected rather than thrown one at a time, so
  // one relayed message carries everything that is wrong. Thrown together at
  // the end unless this seal finalizes the phase.
  const failures = []
  let exported = null
  if (locked) {
    console.error('→ exporting the candidate tree from the lockdown volume')
    exported = await lockdown.exportLockedCandidate(root, { id, phase, workspace, onOutput: progress })
  } else if (patch) {
    console.error(`! sealing Phase ${phase} as an OPERATOR PATCH of ${patch.run}: this is the operator's edit, not a candidate's work`)
  } else {
    console.error(`! sealing Phase ${phase} WITHOUT the lockdown: the candidate ran with whatever access its harness allowed, and the gates run on this host`)
  }
  if (finalize) console.error(`! this seal finalizes Phase ${phase} (${finalize.detail}): if it fails, the phase is sealed as it stands and marked failed`)
  const workspaceRecord = fs.existsSync(path.join(workspace, 'workspace.json')) ? readJson(path.join(workspace, 'workspace.json')) : {}

  console.error(`→ importing workspace candidate into runs/${id}/stage${phase}`)
  importWorkspace(root, id, phase)
  const stageDir = stageDirFor(root, id, phase)

  let checks = []
  let gates = null
  let featureReport = null
  if (locked) {
    // Candidate-authored code (install scripts, tests, the build) never
    // executes on the host for a locked phase, and never with a network.
    console.error('→ running install, test, typecheck, lint, build inside the lockdown (no network)')
    try {
      gates = await lockdown.runLockedChecks(root, stageDir, { onOutput: progress, featureTests: strict })
      checks = gates.checks
      featureReport = gates.featureTests
    } catch (error) {
      // An install that fails offline is the candidate's lockfile, not the box.
      if (!/pnpm install failed/.test(error.message)) throw error
      failures.push(error.message)
    }
    // A broken record of the boundary is never sealed, failed or not.
    const blockers = lockdown.sealBlockers(root, id, phase, exported, gates ?? { network: 'none' }, stageDir)
    if (blockers.length > 0) throw operatorError(`Phase ${phase} cannot be sealed from this lockdown session: ${blockers.join('; ')}`)
  } else {
    console.error('→ installing dependencies')
    ensureInstalled(stageDir)

    console.error('→ running test, typecheck, lint, build')
    checks = await runChecks(stageDir)
    if (strict && checks.find((check) => check.id === 'test')?.passed) {
      console.error('→ collecting which test files ran')
      featureReport = await collectFeatureTestsOnHost(stageDir)
    }
  }
  const failed = checks.filter((check) => !check.passed)
  if (failed.length > 0) {
    failures.push(`Package checks failed (${failed.map((check) => check.id).join(', ')}). Fix in the workspace, then seal again.\n${failed.map((check) => `--- ${check.id} ---\n${check.detail}`).join('\n')}`)
  }
  const built = fs.existsSync(path.join(stageDir, 'dist', 'index.html'))

  // Canonical capture. For a locked phase it happens in the image — its
  // Chromium, its fonts, no network — so every run is measured by the same bits.
  let capture = null
  if (built) {
    console.error(`→ capturing canonical screenshots${locked ? ' inside the lockdown' : ''}`)
    try {
      if (locked) {
        capture = await lockdown.captureLocked(root, { id, phase, stageDir, onOutput: progress })
      } else {
        const server = await serveDirectory(path.join(stageDir, 'dist'))
        try {
          await captureEvidence(root, { id, phase, url: server.url })
        } finally {
          await server.close()
        }
        capture = { where: 'host' }
      }
    } catch (error) {
      failures.push(error.message)
    }
  } else {
    capture = { skipped: 'no build' }
  }

  // Harness-measured audio (rubric 3): fixed test notes played through the
  // build over Web MIDI, rendered and measured. Evidence, not a gate: an app
  // that makes no sound is measured as making no sound. A measurement the
  // harness itself could not take is the operator's problem.
  let audio = null
  if (strict && built) {
    console.error(`→ measuring the build's audio with the fixed test notes${locked ? ' inside the lockdown' : ''}`)
    audio = await measureAudioEvidence(root, { phase, stageDir, locked, lockdown, onOutput: progress })
    if (audio.status === 'failed' && audio.failure?.kind === 'harness-error') {
      throw operatorError(`The audio measurement could not run (${audio.failure.detail}). Nothing about the candidate is known from it; fix the box or the browser and seal again.`)
    }
  }

  // Keep the sealed tree pristine: it carries source + dist + evidence, never
  // installed node_modules. hashTree ignores node_modules regardless, so the
  // digest is unaffected — this just stops the committed evidence directory
  // from holding an install tree.
  fs.rmSync(path.join(stageDir, 'node_modules'), { recursive: true, force: true })

  // What protocol 3 asks of an artifact beyond the contract: its feature tests
  // really ran, its samples really come from the pack, and it does not say who
  // made it. Each is a seal failure with a message the candidate can act on.
  const evidence = []
  let sampleReport = null
  if (strict) {
    evidence.push(featureExecutionEvidence(featureExecution(readFeatureMatrix(stageDir), featureReport)))

    console.error('→ checking where every bundled sample comes from')
    const pack = loadSamplePack(root)
    const given = workspaceRecord.samplePack ?? null
    if (pack && given && given.manifestSha256 !== pack.digest) {
      throw operatorError(`The sample pack in this checkout (${pack.digest.slice(0, 12)}) is not the one this phase was started with (${String(given.manifestSha256).slice(0, 12)}). Restore the pack the phase was given before sealing.`)
    }
    const detailsPath = path.join(stageDir, 'IMPLEMENTATION_DETAILS.json')
    let details = null
    try { details = readJson(detailsPath) } catch { details = null }
    sampleReport = checkSampleProvenance({ stageDir, details, pack: given ? pack : null })
    if (sampleReport.problems.length === 0 && sampleReport.toMatch.length > 0) {
      const match = await lockdown.matchSamples(root, {
        stageDir, packDir: path.join(workspace, 'inputs', 'samples'), packDigest: pack.digest, entries: sampleReport.toMatch, onOutput: progress,
      })
      if (!match) throw operatorError('The acoustic sample check could not run on this machine (no container engine and no ffmpeg)')
      applyMatchResults(sampleReport, match)
      sampleReport.acoustic.where = match.where
    }
    evidence.push(...sampleProvenanceEvidence(sampleReport))
    evidence.push(blindArtifactEvidence(findProducerNames(stageDir, [id, run.model, run.title, run.agent?.model].filter(Boolean))))
  }
  const instructionFiles = findAgentInstructionFiles(stageDir).filter((file) => !file.startsWith('dist/'))
  evidence.push({
    id: 'agent instruction files',
    advisory: true,
    passed: instructionFiles.length === 0,
    detail: instructionFiles.length === 0
      ? 'The artifact carries no agent instruction files'
      : `The artifact carries agent instruction files (${instructionFiles.slice(0, 6).join(', ')}). They are removed from the copy a grader is given`,
  })

  console.error('→ verifying phase contract and evidence')
  let verification
  try {
    verification = verifyPhase(root, id, phase, { checks, evidence, protocolVersion: run.protocol?.version ?? null })
  } catch (error) {
    // The contract itself is broken (no feature matrix, no implementation
    // details, …): the candidate's to fix, and a finalizing seal records it.
    failures.push(`Phase ${phase} contract: ${error.message}`)
    verification = { version: 4, runId: id, stage: phase, ...(run.protocol?.version ? { protocolVersion: run.protocol.version } : {}), verifiedAt: new Date().toISOString(), passed: false, contractError: error.message, materials: materialDigests(root), checks, evidence }
  }
  verification.isolation = locked
    ? lockdown.attestation(root, id, phase, exported, gates ?? { network: 'none' }, { capture })
    : lockdown.unlockedAttestation(patch ? { operatorPatch: true } : {})
  if (locked) verification.evidence.push(...lockdown.lockdownEvidence(exported))
  if (sampleReport) {
    const { toMatch: _toMatch, ...record } = sampleReport
    verification.sampleProvenance = record
  }
  if (audio) verification.audio = { file: `evidence/stage${phase}-audio.json`, plan: audio.plan, status: audio.status, failure: audio.failure ?? null, scores: audio.scores ?? null }
  // Advisory: are any bundled assets byte-identical to ones that already exist
  // in another run or a known local library?
  const { assetProvenance, assetProvenanceCheck, blindArtifactCheck } = await import('./lockdown/provenance.mjs')
  const provenance = assetProvenance(root, id, stageDir)
  verification.assetProvenance = { ...provenance, files: undefined }
  verification.evidence.push(assetProvenanceCheck(provenance))
  if (!strict) {
    // Before protocol 3 this is advisory: does the artifact say which run it is?
    const { findStrings } = await import('./lockdown/session.mjs')
    verification.evidence.push(blindArtifactCheck(stageDir, id, [...new Set(findStrings(stageDir, [id], { minLength: 3 }).map((hit) => hit.path))].filter((file) => !file.startsWith('dist/') && !file.startsWith('node_modules/'))))
  }
  // An operator patch is recorded as what it is: exactly which files differ
  // from the sealed artifact it started from.
  if (patch) {
    const changes = treeDifference(stageDirFor(root, patch.run, patch.phase), stageDir, { ignored: ['node_modules', '.git', '.vite', 'dist', '.pnpm-store', 'evidence'] })
    if (changes.length === 0) throw new Error(`Nothing differs from ${patch.run} Phase ${patch.phase}. An operator patch has to change something; otherwise score the original run.`)
    verification.operatorPatch = { of: patch, reason: run.derivedFrom?.reason ?? null, changes }
    writeJson(path.join(root, 'runs', id, 'patches', `stage${phase}.json`), verification.operatorPatch)
  }
  if (!verification.passed && !verification.contractError) {
    const unmet = [...verification.checks, ...verification.evidence].filter((check) => !check.passed && !check.advisory && !failed.includes(check))
    if (unmet.length > 0) failures.push(`Phase ${phase} verification failed:\n${unmet.map((check) => `- ${check.detail ?? check.id}`).join('\n')}`)
  }
  // The usage record: from the gateway's log for a boxed phase, priced with
  // the pinned table. Figures an operator types are kept apart and labelled.
  let usage = null
  if (locked) {
    const { sessionStateDir } = await import('./lockdown/session.mjs')
    usage = summarizeUsage(readGatewayEvents(path.join(sessionStateDir(root, id, phase), 'gateway', 'events.jsonl')), loadPrices(root))
  }
  const budget = rules ? budgetRecord(rules, { launches, usage }) : null
  const outcome = failures.length > 0 ? 'failed' : 'passed'
  verification.seal = { outcome, attempts: counts.attempts ?? 1, sealFailureRelays: counts.relays ?? 0, sealFailureLimit: counts.limit ?? null, ...(finalize && outcome === 'failed' ? { finalizedBy: finalize.by, finalizedBecause: finalize.detail, failures } : {}) }
  if (usage) verification.usage = usage
  if (budget) verification.budget = budget
  // A phase sealed as failed is still frozen and hashed, like any other.
  if (failures.length > 0 && finalize && !verification.artifactDigest) {
    const tree = hashTree(stageDir)
    verification.artifactDigest = tree.digest
    verification.artifactFiles = tree.files
  }
  writeJson(path.join(root, 'runs', id, 'verifications', `stage${phase}.json`), verification)
  if (failures.length > 0 && !finalize) throw new Error(failures.join('\n\n'))
  if (failures.length > 0) console.error(`! Phase ${phase} is sealed as FAILED (${finalize.detail}):\n${failures.map((text) => `  - ${text.split('\n')[0]}`).join('\n')}`)

  // Archive the agent sessions that produced this phase (scrubbed + zstd) as
  // sidecar records in runs/<id>/transcripts/, outside stage<N>/ and so never
  // part of the sealed artifact. Under protocol 3 a phase is not sealed without
  // them: half of the past runs can no longer be audited because nobody kept
  // the transcript. A locked phase's sessions were written inside the box, so
  // they are handed over from the export, with the launcher's console logs.
  let transcripts
  if (patch) {
    transcripts = { status: 'not-applicable', reason: 'operator patch: no agent session', sessions: 0 }
  } else {
    console.error('→ archiving agent transcripts')
    const boxed = locked ? lockdown.sessionTranscriptFiles(exported) : { all: [] }
    transcripts = recordPhaseTranscripts(root, id, {
      kind: 'candidate',
      phase,
      workspace,
      explicit: [...parseTranscriptList(options.transcripts), ...boxed.all],
      since: Date.parse(stage.startedAt) || null,
      command: 'seal',
    })
    if (strict && !['archived', 'kept'].includes(transcripts.status)) {
      throw operatorError(`Phase ${phase} cannot be sealed without its agent transcript (${transcripts.error ?? 'none was found'}). Protocol 3 requires the session that produced a phase to be archived with it: pass --transcripts <file[,file...]> for sessions stored where discovery does not look.`)
    }
  }

  markSealed(root, id, phase, verification, { outcome })
  const operatorUsage = telemetryFromFlags(options)
  // Without a gateway, typed figures are all there is; they are recorded as typed.
  if (!locked && Object.keys(operatorUsage).length > 0) recordTelemetry(root, id, phase, operatorUsage, { source: 'operator' })
  // Record how the phase was contained, and what the operator said, next to its digest.
  const sealedRun = loadRun(root, id)
  const sealedStage = stageState(sealedRun, phase)
  sealedStage.isolation = locked
    ? { mode: 'lockdown', gatewayHead: verification.isolation.gateway.head, denied: verification.isolation.gateway.denied, record: `runs/${id}/lockdown/stage${phase}.json` }
    : { mode: 'none', ...(patch ? { operatorPatch: true } : {}) }
  if (locked) {
    const operator = verification.isolation.operator
    sealedStage.operator = { followUps: operator.followUps, offProtocol: operator.offProtocol, templates: operator.messages.map((message) => message.template) }
  }
  sealedStage.seal = verification.seal
  if (usage) {
    // The official figures for a boxed phase are the gateway's, and replace
    // anything typed. What an operator typed is kept, labelled, and never shown
    // as the run's cost.
    sealedStage.usage = {
      source: 'gateway', requests: usage.requests, responsesWithUsage: usage.responsesWithUsage, incompleteResponses: usage.incompleteResponses,
      inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, cacheWriteTokens: usage.cacheWriteTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens,
      totalTokens: usage.totalTokens, costUsd: usage.costUsd, byModel: usage.byModel, efforts: usage.efforts, prices: usage.prices, unpriced: usage.unpriced,
    }
    sealedStage.telemetry = {
      ...sealedStage.telemetry,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
      ...(usage.reasoningTokens !== null ? { reasoningTokens: usage.reasoningTokens } : {}),
      ...(usage.costUsd !== null ? { costUsd: usage.costUsd } : {}),
    }
    sealedStage.telemetrySource = 'gateway'
    if (Object.keys(operatorUsage).length > 0) sealedStage.operatorTelemetry = { ...operatorUsage, source: 'operator', official: false, at: new Date().toISOString() }
  } else if (Object.keys(operatorUsage).length > 0) {
    sealedStage.telemetrySource = 'operator'
  }
  if (budget) sealedStage.budget = { ...budget, agentMinutes: Math.round(budget.used.agentSeconds / 60) }
  if (audio) sealedStage.audio = { status: audio.status, failure: audio.failure ?? null, plan: audio.plan, scores: audio.scores ?? null }
  sealedStage.official = officialStatus(sealedRun, sealedStage, { locked, rules, budget, usage, finalize: outcome === 'failed' ? finalize : null })
  sealedStage.transcripts = { status: transcripts.status, sessions: transcripts.sessions ?? 0 }
  if (workspaceRecord.samplePack) sealedStage.samplePack = { id: workspaceRecord.samplePack.id, version: workspaceRecord.samplePack.version, manifestSha256: workspaceRecord.samplePack.manifestSha256 }
  recomputeRunTelemetry(sealedRun)
  saveRun(root, sealedRun)
  // The seal goes in the ledger: from here this phase cannot be sealed again.
  appendLedger(root, id, {
    kind: 'seal',
    phase,
    outcome,
    artifactDigest: verification.artifactDigest,
    artifactDigestVersion: ARTIFACT_DIGEST_VERSION,
    verificationSha256: hashFile(path.join(root, 'runs', id, 'verifications', `stage${phase}.json`)),
    isolation: verification.isolation.mode,
    protocolVersion: run.protocol?.version ?? null,
    sealAttempts: verification.seal.attempts,
    sealFailureRelays: verification.seal.sealFailureRelays,
    sealFailureLimit: verification.seal.sealFailureLimit,
    ...(verification.seal.finalizedBy ? { finalizedBy: verification.seal.finalizedBy } : {}),
    ...(usage ? { usage: { source: 'gateway', inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, costUsd: usage.costUsd, pricesAsOf: usage.prices?.asOf ?? null, pricesSha256: usage.prices?.sha256 ?? null } } : {}),
    ...(budget ? { budget: { status: budget.status, stoppedBy: budget.stoppedBy, agentSeconds: budget.used.agentSeconds, outputTokens: budget.used.outputTokens } } : {}),
    ...(audio ? { audio: { status: audio.status, sha256: hashFile(path.join(stageDir, 'evidence', `stage${phase}-audio.json`)) } } : {}),
    official: sealedStage.official.official,
    ...(patch ? { operatorPatchOf: patch } : {}),
  })
  // Keep the boundary's own record with the run, then close the box.
  if (locked) lockdown.archiveAndClose(root, id, phase, verification.isolation, gates)
  removeWorkspace(root, id, phase)
  await reindexRegistry(root)
  const sealed = loadRun(root, id)
  return {
    id,
    phase,
    outcome,
    ...(outcome === 'failed' ? { failures: failures.map((text) => text.split('\n')[0]), finalizedBy: finalize.by } : {}),
    artifactDigest: verification.artifactDigest,
    preview: sealed.previews?.[String(phase)] ?? null,
    isolation: verification.isolation.mode,
    official: sealedStage.official,
    seal: verification.seal,
    ...(locked ? { lockdown: { network: verification.isolation.network, gatewayHead: verification.isolation.gateway.head, deniedEgress: verification.isolation.gateway.denied, honeytoken: verification.isolation.honeytoken, droppedOnExport: verification.isolation.export.dropped.length, operator: sealedStage.operator } } : {}),
    ...(patch ? { operatorPatch: { of: patch, changedFiles: verification.operatorPatch.changes.length } } : {}),
    ...(sampleReport ? { samples: { bundled: sampleReport.bundled, fromPack: sampleReport.fromPack, generated: sampleReport.generated, sources: sampleReport.sources, acoustic: sampleReport.acoustic } } : {}),
    ...(audio ? { audio: sealedStage.audio } : {}),
    ...(usage ? { usage: { inputTokens: usage.inputTokens, cachedInputTokens: usage.cachedInputTokens, outputTokens: usage.outputTokens, reasoningTokens: usage.reasoningTokens, costUsd: usage.costUsd, pricesAsOf: usage.prices?.asOf, unpriced: usage.unpriced, incompleteResponses: usage.incompleteResponses } } : {}),
    ...(budget ? { budget: sealedStage.budget } : {}),
    assetProvenance: { assets: provenance.assets, matched: provenance.matched, matchedOrigins: provenance.matchedOrigins },
    telemetry: sealed.stages.find((entry) => entry.number === phase)?.telemetry ?? null,
    transcripts,
    footnotes: runFootnotes(sealed).map((note) => note.text),
    next: statusSummary(sealed).next,
  }
}

// Run the fixed audio test plan against the sealed build, in the box when the
// phase was boxed, and write the record into the phase's evidence.
async function measureAudioEvidence(root, { phase, stageDir, locked, lockdown, onOutput }) {
  const evidenceDir = path.join(stageDir, 'evidence')
  const file = path.join(evidenceDir, `stage${phase}-audio.json`)
  let record
  try {
    if (locked) {
      record = await lockdown.measureAudioLocked(root, { phase, stageDir, onOutput })
    } else {
      const { measureAudio } = await import('./lib/run/audio-measure.mjs')
      const { chromium } = await import('playwright')
      const server = await serveDirectory(path.join(stageDir, 'dist'))
      try {
        record = await measureAudio({ url: server.url, chromium, phase })
      } finally {
        await server.close()
      }
      record.where = 'host'
    }
  } catch (error) {
    record = { version: 1, phase, status: 'failed', failure: { kind: 'harness-error', detail: String(error.message ?? error).slice(0, 1500) } }
  }
  fs.mkdirSync(evidenceDir, { recursive: true })
  writeJson(file, record)
  return record
}

// Is this phase an official protocol-3 result, and if not, why not.
function officialStatus(run, stage, { locked, rules, budget, usage, finalize }) {
  const reasons = []
  if (!isStrictProtocol(run)) reasons.push(`built under protocol ${run.protocol?.version ?? 'unknown'}`)
  if (!locked) reasons.push(stage.patchOf ? 'an operator patch' : 'sealed outside the lockdown')
  if (locked && !rules) reasons.push('the run carries no official rules (created before they were recorded)')
  if ((stage.operator?.offProtocol ?? 0) > 0) reasons.push('the operator sent a message outside the fixed templates')
  if (budget?.status === 'exceeded') reasons.push(`the budget was exceeded or overridden${budget.offProtocol?.length ? ` (${budget.offProtocol.join('; ')})` : ''}`)
  if (budget && budget.effort && !budget.effort.ok) reasons.push(`a launch ran at another effort than the pinned ${budget.rules?.effort}`)
  if (finalize?.by === 'operator') reasons.push('the operator sealed it as failed before the protocol required it')
  if (locked && usage && usage.requests > 0 && usage.responsesWithUsage === 0) reasons.push('the gateway recorded no token usage for any model turn')
  return { official: reasons.length === 0, reasons }
}

// Anything that names the producer is taken out of the grader's copy.
const producerNamesOf = (run) => [run.model, run.title, run.agent?.model].filter(Boolean)

// The blinding guard as run before an evaluator is launched and before an
// assessment is registered: the workspace was built under the current
// blinding, and nothing the harness put in it for the grader names a model or
// run (bench/lib/eval/blinding.mjs). Throws, so both fail closed.
function guardEvalWorkspace(root, run, phase, rubric) {
  const verificationPath = path.join(root, 'runs', run.id, 'verifications', `stage${phase}.json`)
  return checkEvalWorkspace(root, {
    id: run.id,
    workspace: evalWorkspaceDir(root, run.id, phase),
    producerNames: producerNamesOf(run),
    record: fs.existsSync(verificationPath) ? readJson(verificationPath) : null,
    rubric,
  })
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
  // The rubric the run was created under, never simply the newest one.
  const rubric = loadRubric(rubricVersionForRun(run))
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
    // A run that requires the lockdown is graded in one too: the evaluator's
    // box holds this workspace and nothing else.
    const boxed = run.isolation === 'lockdown' && options.unboxed !== 'true'
    const created = createEvalWorkspace(root, {
      id,
      phase,
      variantId: run.variant,
      stageDir: stageDirFor(root, id, phase),
      verificationPath: path.join(root, 'runs', id, 'verifications', `stage${phase}.json`),
      expectedDigest: stage.artifactDigest,
      rubric,
      sealedPhases,
      producerNames: producerNamesOf(run),
      boxed,
    })
    appendOperatorEvent(root, id, { command: 'score', phase, action: 'eval-workspace-created', blindHandle: created.blindId, boxed, blinding: created.blinding })
    return {
      action: 'eval-workspace-created',
      workspace: created.workspace,
      assessmentPath: created.assessment,
      blinding: { version: created.blinding.version, strippedInstructionFiles: created.blinding.stripped.length + (created.blinding.strippedFromBuild?.length ?? 0), filesWithProducerNameRedacted: created.blinding.redacted.length, inputsChecked: created.blinding.guard.filesChecked },
      next: boxed
        ? `Run the evaluator inside the lockdown: pnpm bench evaluator ${id} --phase ${phase} --harness claude   (model ${rubric.evaluator?.model ?? 'as pinned by the rubric'}; its box holds this workspace and nothing else). Then run: pnpm bench score ${id} --phase ${phase}`
        : `Spawn a fresh evaluator agent whose working directory is ${created.workspace} — it reads EVAL.md, inspects artifact/ against inputs/ (blind to model identity), and fills every rating in assessment.json with evidence. Then run: pnpm bench score ${id} --phase ${phase}`,
    }
  }

  // Nothing is registered from a workspace whose inputs could have told the
  // grader who made the artifact.
  const blindingGuard = guardEvalWorkspace(root, run, phase, rubric)

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
    if (currentDigest !== stage.artifactDigest) {
      throw new Error(`runs/${id}/stage${phase} no longer matches its sealed digest (${currentDigest.slice(0, 12)} ≠ ${stage.artifactDigest.slice(0, 12)}). Sealed evidence is immutable: restore the sealed tree (git checkout), or, if the change is deliberate, make it a new labelled run with pnpm bench fork ${id} --to <new-id> --reason "..."`)
    }
  }
  // Gates run against a throwaway copy out of the repo, so the sealed stage
  // directory is never mutated. For a run that requires the lockdown — or with
  // --sandbox / STAGEBENCH_SANDBOX=1 — they run inside the lockdown box, so
  // candidate code never executes on this machine (--host-gates opts out).
  const technicalChecks = await runGates(root, stageDir, rubric, {
    skip: options['skip-checks'] === 'true',
    sandbox: options.sandbox === 'true' || process.env.STAGEBENCH_SANDBOX === '1' || (run.isolation === 'lockdown' && options['host-gates'] !== 'true'),
    // A protocol-3 artifact installs from the mirror in the image, with no
    // network. One sealed earlier names packages that mirror does not carry, so
    // its gates get the read-only package mirror instead (and nothing else).
    network: isStrictProtocol(run) ? 'none' : 'legacy-mirror',
  })
  // Boxed gates come back with the log of what they fetched; keep it with the run.
  if (technicalChecks.gateway?.events) {
    const lockdownDir = path.join(root, 'runs', id, 'lockdown')
    fs.mkdirSync(lockdownDir, { recursive: true })
    fs.writeFileSync(path.join(lockdownDir, `stage${phase}.score-gates.gateway.jsonl`), technicalChecks.gateway.events)
  }
  // Harness-measured criteria (rubric 3) are scored from the record the seal
  // wrote into the sealed evidence; nothing the evaluator said enters them.
  const audioRecordPath = path.join(stageDir, 'evidence', `stage${phase}-audio.json`)
  const harness = { audio: fs.existsSync(audioRecordPath) ? readJson(audioRecordPath) : null }
  const evaluation = scoreAssessment(rubric, assessment, technicalChecks, { ...evaluatorOptions, harness })
  // Which model graded, as the provider reported it, read from the evaluator
  // boxes' gateway logs before they are closed.
  const lockdown = await import('./lockdown/seal.mjs')
  const pinnedGrader = rubric.evaluator?.pinnedId ?? rubric.evaluator?.model ?? null
  const grader = lockdown.graderRecord(root, id, phase, { requested: rubric.evaluator?.model ?? null, pinned: pinnedGrader })
  const { requestIdList, ...graderSummary } = grader
  evaluation.grader = graderSummary
  // Which blinding the grader's inputs were built and checked under.
  evaluation.blinding = { version: blindingGuard.version, inputsChecked: blindingGuard.filesChecked }
  if (grader.drift) console.error(`! grader drift: requests for ${grader.requested} were served as ${grader.drift.map((entry) => `${entry.servedAs} (${entry.requests})`).join(', ')}, not the pinned ${grader.pinned}. Recorded in the evaluation and the ledger.`)
  if (grader.unverified > 0) console.error(`! grader unverified: ${grader.unverified} response(s) to requests for ${grader.requested} did not say which model served them. Recorded in the evaluation and the ledger.`)
  // When the harness registered it, as opposed to when the grader says it
  // graded: two leaderboard rows carried hand-entered evaluation times.
  evaluation.registeredAt = new Date().toISOString()
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
    grader: { version: grader.version, pinned: grader.pinned, boxed: grader.boxed, served: Object.keys(grader.served), requestIds: grader.requestIds.count, drift: grader.drift, unverified: grader.unverified },
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
  appendLedger(root, id, {
    kind: 'score', phase, score: evaluation.score, evaluationSha256: hashFile(evaluationPath), evaluatorModel: evaluation.evaluatorModel ?? null, rubricVersion: evaluation.rubricVersion ?? null, panel: panel.length, blinding: EVAL_BLINDING_VERSION,
    // The grader as the provider reported it: the id it served the pinned
    // model's requests as, and its request ids (all of them, hashed; the list
    // is in runs/<id>/lockdown/stage<N>.evaluators.json).
    grader: { version: grader.version, pinned: grader.pinned, requested: grader.requested, boxed: grader.boxed, served: grader.served, notServed: grader.notServed, drift: grader.drift, unverified: grader.unverified, requestIds: grader.requestIds, harness: grader.sessions.flatMap((entry) => entry.harness) },
  })
  // Evaluator/reviewer sessions ran in the blind workspace (or, boxed, in a
  // container that held only that workspace); archive them under
  // transcripts/eval/phase-N before the workspace is removed. Never fatal.
  const { evaluatorSessions, sessionStateDir } = await import('./lockdown/session.mjs')
  const boxedFiles = evaluatorSessions(root, id, phase).flatMap((kind) => {
    const stateDir = sessionStateDir(root, id, phase, kind)
    const logs = fs.readdirSync(stateDir).filter((name) => /^launch-\d+\.log$/.test(name)).sort().map((name) => path.join(stateDir, name))
    return lockdown.sessionTranscriptFiles({ transcripts: path.join(stateDir, 'transcripts'), consoleLogs: logs }, { prefix: `lockdown-${kind}-console` }).all
  })
  const transcripts = recordPhaseTranscripts(root, id, {
    kind: 'eval',
    phase,
    workspace,
    explicit: [...parseTranscriptList(options.transcripts), ...boxedFiles],
    since: Date.parse(stage.completedAt) || null,
    command: 'score',
  })
  // What the grader's own boundary observed, kept with the run; then close its boxes.
  const evaluatorBoxes = lockdown.closeEvaluatorSessions(root, id, phase)
  if (evaluatorBoxes.length > 0) writeJson(path.join(root, 'runs', id, 'lockdown', `stage${phase}.evaluators.json`), { mode: 'lockdown', evaluators: evaluatorBoxes, grader: { ...graderSummary, requestIdList } })
  removeEvalWorkspace(root, id, phase)
  return { action: 'scored', phase, score: evaluation.score, aggregate: aggregate.score, rubricVersion: rubric.version, evaluationPath, report: aggregate.reportPath, evaluation: evaluatorBoxes.length > 0 ? `boxed (${evaluatorBoxes.length} evaluator session(s))` : 'not boxed', grader: { pinned: grader.pinned, served: grader.served, requestIds: grader.requestIds.count, drift: grader.drift, unverified: grader.unverified }, transcripts }
}

// Sealed digests recorded under an older artifact definition can never
// validate — `dist/` was inside the digest but matched .gitignore at every
// depth, so it was never committed. Re-record them against the current
// definition and stamp the version, so a stale digest stays an auditable fact
// rather than a check everyone learns to skip. Dry run unless --apply.
//
// That is ALL this does. A digest already recorded under the current
// definition that no longer matches its tree means the sealed evidence (or its
// record) was changed; re-recording it would launder the change, which is how
// one run came to carry digests matching neither its sealed nor its committed
// tree. Those are reported as `modified` and never touched.
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
      // Already under the current definition and not matching: not a definition change.
      const modified = !matches && alreadyStamped
      stages.push({ run: runId, phase: stage.number, matches, alreadyStamped, modified, recorded: stage.artifactDigest?.slice(0, 12) ?? null, current: current.slice(0, 12) })
      if ((matches && alreadyStamped) || modified) continue
      if (apply) {
        if (!matches && readLedger(root, runId).exists) appendLedger(root, runId, { kind: 'redigest', phase: stage.number, from: stage.artifactDigest ?? null, to: current, fromVersion: stage.artifactDigestVersion ?? 1, toVersion: ARTIFACT_DIGEST_VERSION })
        stage.artifactDigest = current
        stage.artifactDigestVersion = ARTIFACT_DIGEST_VERSION
        changed = true
      }
    }
    if (changed) writeJson(runPath, run)
  }
  const stale = stages.filter((entry) => !entry.matches && !entry.modified)
  const modified = stages.filter((entry) => entry.modified)
  return {
    action: apply ? 'redigested' : 'redigest-dry-run',
    digestVersion: ARTIFACT_DIGEST_VERSION,
    checked: stages.length,
    stale: stale.length,
    modified: modified.length,
    ...(apply ? {} : { next: 'Re-run with --apply to record these digests' }),
    stages: stale,
    ...(modified.length > 0 ? { modifiedStages: modified, modifiedNote: 'These digests were recorded under the current artifact definition and no longer match their sealed trees. They are not re-recorded: restore the sealed tree, or fork the run (pnpm bench fork).' } : {}),
  }
}

// Re-hash sealed stages against run.json and the ledger.
function verifySealed(root, id) {
  const ids = id ? [id] : fs.readdirSync(path.join(root, 'runs')).filter((entry) => fs.existsSync(path.join(root, 'runs', entry, 'run.json'))).sort()
  const runs = ids.map((runId) => verifySealedRun(root, runId)).filter((entry) => !entry.legacy)
  const flat = runs.flatMap((entry) => entry.stages.map((stage) => ({ run: entry.id, ...stage })))
  const count = (state) => flat.filter((stage) => stage.state === state).length
  const brokenLedgers = runs.filter((entry) => entry.ledger.exists && !entry.ledger.ok).map((entry) => ({ run: entry.id, error: entry.ledger.error }))
  return {
    checked: flat.length,
    intact: count('intact'),
    unledgered: count('unledgered'),
    modified: count('modified'),
    missing: count('missing'),
    brokenLedgers,
    modifiedStages: flat.filter((stage) => stage.state === 'modified' || stage.state === 'missing'),
    note: 'intact: matches run.json and the seal ledger. unledgered: matches run.json; sealed before the ledger existed (protocol 2 and earlier). modified: the sealed tree, run.json, or the ledger was changed after sealing.',
    passed: count('modified') === 0 && count('missing') === 0 && brokenLedgers.length === 0,
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
  // An evaluator's box can outlive its workspace; drop those sessions too.
  const { evaluatorSessions } = await import('./lockdown/session.mjs')
  for (const stage of run.stages ?? []) {
    for (const kind of evaluatorSessions(root, run.id, stage.number)) {
      destroySession(root, run.id, stage.number, { keepState: false, kind })
      removed.push({ phase: stage.number, kind: `lockdown-${kind}-session` })
    }
  }
  return { id: run.id, removed, kept }
}

function printHelp() {
  console.log('Stagebench bench CLI\n')
  console.log('Usage: pnpm bench <command> [args]\n')
  for (const [command, description] of Object.entries(COMMANDS)) console.log(`  ${command.padEnd(14)} ${description}`)
  console.log('\nA phase flows: start → agent (implements inside the lockdown, offline) → seal → score → evaluator (grades inside a lockdown) → score.')
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
      const pack = await requireSamplePack(root)
      result = createRun(root, options)
      await reindexRegistry(root)
      result = {
        id: result.id, targetPhase: result.targetPhase, selectedPhases: result.selectedPhases,
        protocol: result.run.protocol.version, isolation: result.run.isolation, samplePack: `${pack.id}@${pack.version}`,
        ...(result.run.isolation === 'none' ? { warning: 'Created with --isolation none: not an official protocol 3 run. It is recorded and footnoted in the gallery.' } : {}),
        next: `pnpm bench start ${result.id}`,
      }
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
      const starting = loadRun(root, id)
      if (isStrictProtocol(starting)) await requireSamplePack(root)
      result = startPhase(root, id)
      const started = loadRun(root, id)
      const patch = stageState(started, result.phase).patchOf ?? null
      result.isolation = started.isolation ?? 'none'
      appendOperatorEvent(root, id, { command: 'start', phase: result.phase, workspace: result.workspace, reused: result.reused, isolation: result.isolation, ...(patch ? { operatorPatchOf: patch } : {}) })
      result.next = patch
        ? `This phase is an operator patch of ${patch.run} Phase ${patch.phase}: ${result.candidate} holds that sealed artifact. Apply your change there, then run pnpm bench seal ${id}`
        : result.isolation === 'lockdown'
          ? `Run the implementation agent inside the lockdown: pnpm bench agent ${id} --harness <codex|claude|omp|custom> [--model ...]. Then run pnpm bench seal ${id}`
          : `Point the implementation agent at ${result.workspace}/WORKSPACE.md, then run pnpm bench seal ${id}`
    } else if (command === 'agent') {
      const run = loadRun(root, id)
      const stage = nextPhase(run)
      if (!stage || stage.status !== 'running') throw new Error(`${id} has no running phase; run pnpm bench start ${id} first`)
      if (!options.harness) throw new Error('--harness is required (codex, claude, omp, or custom)')
      if (stage.patchOf) throw new Error(`Phase ${stage.number} of ${id} is an operator patch; no agent runs in it. Apply the change in the workspace and seal.`)
      const { launchAgent } = await import('./lockdown/session.mjs')
      const launched = await launchAgent(root, {
        id, phase: stage.number, workspace: workspaceDir(root, id, stage.number), harness: options.harness, options,
        // Protocol 3: an operator picks a template; they do not write the message.
        messagePolicy: isStrictProtocol(run) ? 'template' : 'free',
        // An official run's fixed rules: the seal-failure rounds and the budget.
        rules: runRules(run),
        onOutput: (text) => process.stderr.write(text),
      })
      result = {
        id,
        phase: stage.number,
        session: launched.session,
        harness: launched.launch.harnessLabel,
        harnessVersion: launched.launch.harnessVersion ?? null,
        exitCode: launched.launch.exitCode,
        message: { template: launched.launch.message.template, offProtocol: launched.launch.message.offProtocol },
        effort: launched.launch.effort ?? null,
        ...(launched.launch.budget ? { budget: { ...launched.launch.budget, stoppedBy: launched.launch.stoppedBy ?? null, outputTokensThisLaunch: launched.launch.outputTokens ?? null, offProtocol: launched.launch.budgetOffProtocol ?? [] } } : {}),
        log: launched.logFile,
        gateway: { chainOk: launched.gateway.chainOk, head: launched.gateway.head, modelRequests: launched.gateway.modelRequests, strippedTools: launched.gateway.strippedTools, deniedEgress: launched.gateway.denied, deniedTargets: launched.gateway.deniedTargets, mirrorFetches: launched.gateway.mirrorArtifacts, usage: { requests: launched.gateway.usage.requests, inputTokens: launched.gateway.usage.inputTokens, cachedInputTokens: launched.gateway.usage.cachedInputTokens, outputTokens: launched.gateway.usage.outputTokens, reasoningTokens: launched.gateway.usage.reasoningTokens, efforts: launched.gateway.usage.efforts } },
        next: launched.launch.exitCode === 0 || launched.launch.stoppedBy
          ? `pnpm bench seal ${id}${launched.launch.stoppedBy ? `   (the phase budget stopped the agent: ${launched.launch.stoppedBy}; seal it as it stands)` : ''}`
          : `The agent exited ${launched.launch.exitCode}. Read ${launched.logFile}; to have it pick up where it stopped: pnpm bench agent ${id} --harness ${options.harness} --message continue`,
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
        messageTemplate: launched.launch.message.template,
        offProtocol: launched.launch.message.offProtocol,
        ...(launched.launch.kind === 'follow-up' || launched.launch.message.offProtocol ? { operatorMessage: launched.launch.prompt } : {}),
        exitCode: launched.launch.exitCode,
        effort: launched.launch.effort ?? null,
        ...(launched.launch.stoppedBy ? { stoppedBy: launched.launch.stoppedBy } : {}),
        ...(launched.launch.budgetOffProtocol?.length ? { budgetOffProtocol: launched.launch.budgetOffProtocol } : {}),
        gatewayHead: launched.gateway.head,
        deniedEgress: launched.gateway.denied,
      })
      if (launched.launch.exitCode !== 0 && !launched.launch.stoppedBy) process.exitCode = 1
    } else if (command === 'evaluator') {
      // The grader in a box: its only volumes are the blind evaluator workspace
      // (artifact, build, and inputs read-only), its only network its own model.
      const run = loadRun(root, id)
      const rubric = loadRubric(rubricVersionForRun(run))
      const phase = options.phase
        ? Number(options.phase)
        : run.stages.filter((entry) => entry.status === 'complete' && fs.existsSync(evalWorkspaceDir(root, id, entry.number))).map((entry) => entry.number)[0]
      if (!phase) throw new Error(`${id} has no evaluator workspace; run pnpm bench score ${id} first`)
      if (stageState(run, phase).status !== 'complete') throw new Error(`Phase ${phase} must be sealed before it is evaluated`)
      if (!options.harness) throw new Error('--harness is required (claude, codex, or custom)')
      const workspace = evalWorkspaceDir(root, id, phase)
      const slot = Number(options.slot ?? 1)
      // The box gets these inputs as they are now; nothing in them may name the producer.
      guardEvalWorkspace(root, run, phase, rubric)
      const { launchEvaluator, exportEvalSession } = await import('./lockdown/session.mjs')
      const launched = await launchEvaluator(root, {
        id, phase, workspace, slot, harness: options.harness,
        // The rubric pins the evaluator model; the operator does not choose it.
        options: { ...options, model: options.model ?? rubric.evaluator?.model ?? null },
        onOutput: (text) => process.stderr.write(text),
      })
      const exported = launched.launch.exitCode === 0 ? await exportEvalSession(root, { id, phase, workspace, slot, onOutput: (text) => process.stderr.write(text) }) : null
      appendOperatorEvent(root, id, {
        command: 'evaluator', phase, slot, isolation: 'lockdown', session: launched.session,
        harness: launched.launch.harnessLabel, harnessVersion: launched.launch.harnessVersion ?? null, model: launched.launch.model,
        messageTemplate: launched.launch.message.template, offProtocol: launched.launch.message.offProtocol,
        ...(launched.launch.kind === 'follow-up' || launched.launch.message.offProtocol ? { operatorMessage: launched.launch.prompt } : {}),
        exitCode: launched.launch.exitCode, gatewayHead: launched.gateway.head, models: launched.gateway.models, deniedEgress: launched.gateway.denied,
        decoysRead: exported?.decoysRead ?? null,
      })
      result = {
        id, phase, slot, session: launched.session, harness: launched.launch.harnessLabel, model: launched.launch.model,
        exitCode: launched.launch.exitCode, log: launched.logFile,
        gateway: { chainOk: launched.gateway.chainOk, modelRequests: launched.gateway.modelRequests, models: launched.gateway.models, strippedTools: launched.gateway.strippedTools, deniedEgress: launched.gateway.denied },
        assessment: exported?.assessment ?? null,
        next: exported
          ? `pnpm bench score ${id} --phase ${phase}   (or an independent review first: pnpm bench evaluator ${id} --phase ${phase} --harness ${options.harness} --message review; or another panel member: --slot ${slot + 1})`
          : `The evaluator exited ${launched.launch.exitCode}. Read ${launched.logFile}, then: pnpm bench evaluator ${id} --phase ${phase} --harness ${options.harness} --message continue`,
      }
      if (launched.launch.exitCode !== 0) process.exitCode = 1
    } else if (command === 'fork') {
      if (!id) throw new Error('fork requires the run id to fork from')
      result = forkRun(root, id, { to: options.to, reason: options.reason, fromPhase: options['from-phase'] })
      appendLedger(root, result.id, { kind: 'fork', from: id, fromPhase: result.derivedFrom.fromPhase, reason: result.derivedFrom.reason, inheritedPhases: result.inheritedPhases })
      appendOperatorEvent(root, result.id, { command: 'fork', from: id, fromPhase: result.derivedFrom.fromPhase, reason: result.derivedFrom.reason })
      await reindexRegistry(root)
    } else if (command === 'footnote') {
      if (!id) throw new Error('footnote requires a run id')
      if (options.add !== undefined) {
        addFootnote(root, id, { text: options.add, phase: options.phase ?? null, kind: options.kind ?? 'note' })
        appendOperatorEvent(root, id, { command: 'footnote', action: 'add', text: options.add, phase: options.phase ?? null, kind: options.kind ?? 'note' })
        await reindexRegistry(root)
      } else if (options.remove !== undefined) {
        removeFootnote(root, id, options.remove)
        appendOperatorEvent(root, id, { command: 'footnote', action: 'remove', index: Number(options.remove) })
        await reindexRegistry(root)
      }
      const noted = loadRun(root, id)
      result = { id, stored: noted.footnotes ?? [], shown: runFootnotes(noted) }
    } else if (command === 'verify-sealed') {
      result = verifySealed(root, id)
      if (!result.passed) process.exitCode = 1
    } else if (command === 'offline-lock') {
      const { writeOfflineLock } = await import('./lockdown/offline/lock.mjs')
      result = await writeOfflineLock(root)
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
      result = { ok: true, isolation: 'lockdown', network: 'none', command: options.command }
    } else if (command === 'lockdown-setup') {
      const { setupLockdown } = await import('./lockdown/setup.mjs')
      result = await setupLockdown({ rebuild: options.rebuild === 'true', omp: options.omp === 'true', onOutput: (text) => process.stderr.write(text) })
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
      const ledger = readLedger(root, id)
      result = {
        ...statusSummary(run),
        protocol: run.protocol?.version ?? null,
        footnotes: run.schemaVersion === 4 ? runFootnotes(run).map((note) => note.text) : [],
        ledger: ledger.exists ? { ok: ledger.ok, entries: ledger.entries.length, ...(ledger.ok ? {} : { error: ledger.error }) } : null,
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
      result = options['samples-only'] === 'true' ? { downloaded: 0, failed: 0 } : await fetchReference(root, { force: options.force === 'true', timeout: options.timeout, photosOnly: options['photos-only'] === 'true' })
      if (options['photos-only'] !== 'true' && loadSamplePack(root)) {
        // The sample pack: each file from its pinned upstream commit, checked
        // against the sha256 in sample-pack/manifest.json, and kept in its
        // stored form (WAV recordings as FLAC-coded samples).
        console.error('→ sample pack')
        const samples = await fetchSamplePack(root, { force: options.force === 'true' })
        const state = await checkSamplePack(root, { deep: true })
        const megabytes = (value) => Number((value / 1024 / 1024).toFixed(1))
        result.samplePack = {
          id: samples.id, version: samples.version, files: samples.files, downloaded: samples.downloaded, megabytesDownloaded: megabytes(samples.downloadedBytes),
          megabytesPublished: megabytes(state.pack.manifest.totals.bytes), megabytesStored: megabytes(state.storedBytes ?? 0),
          ...(state.uncompressed ? { keptUncompressed: state.uncompressed, note: 'flac was not found, so these WAV recordings are kept as published; install flac and fetch again to store them compressed' } : {}),
          verified: state.present, problems: [...samples.failed, ...state.problems].slice(0, 10),
        }
        if (!state.present) result.failed += 1
      }
      if (result.failed > 0) process.exitCode = 1
    }
    if (result) console.log(JSON.stringify(result, null, 2))
  }
} catch (error) {
  console.error(`bench: ${error.message}`)
  process.exitCode = 1
}

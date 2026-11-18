// Run state: creation, phase transitions, preview publication, evaluation
// registration, and the generated gallery index. runs/<id>/run.json is the
// only mutable source of truth; src/data/runs.json is a generated projection.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ARTIFACT_DIGEST_VERSION, blindRunCode, hashTree, isStrictProtocol, loadProtocol, protocolMajor, readJson, selectedPhases, workspaceRoot, writeJson } from '../shared.mjs'
import { tokenCoverageFromStages } from '../../../src/token-coverage.mjs'
import { TELEMETRY_FIELDS, roundTelemetryValue } from '../../../src/telemetry-fields.mjs'
import { rulesFromManifest } from './rules.mjs'

export function pathsFor(root) {
  return {
    registry: path.join(root, 'src', 'data', 'runs.json'),
    protocol: path.join(root, 'src', 'data', 'protocol.json'),
    runs: path.join(root, 'runs'),
    previews: path.join(root, 'public', 'previews'),
    reports: path.join(root, 'public', 'reports'),
  }
}

// Phase display names for protocol versions the spec file does not describe.
// The active protocol's names are derived from specs/benchmark-phases.json
// (shortTitle), but pre-3.x legacy runs used earlier phase layouts that no
// longer exist in the spec, so their names are pinned here explicitly.
const LEGACY_PHASE_NAMES = ['Visual', 'Piano', 'Complete']
const V2_PHASE_NAMES = ['Visual', 'Piano', 'Programs + FX', 'Organ + Synth']

// Generate src/data/protocol.json so the gallery derives current phase names
// from the single source of truth (the phase manifest) at reindex time,
// instead of hardcoding them alongside the runtime constants in App.tsx.
// What each protocol generation guaranteed about how a candidate was contained
// and what it was given. Scores are comparable within a rubric version; these
// notes say what else differed, in a sentence the gallery prints beside every
// run of that generation.
export const PROTOCOL_NOTES = {
  1: 'Protocol 1.x: the workspace sat inside the repository in 1.0 (candidates could reach other runs and were handed the benchmark\'s own scoring notes); 1.1 moved it out. No enforced isolation; candidates sourced samples from the internet.',
  2: 'Protocol 2.0: workspace outside the repository, but no enforced isolation — a candidate could read whatever its harness\'s own sandbox allowed, including this machine\'s disk and the internet. Candidates sourced their own samples.',
  3: 'Protocol 3.0: candidates run in a lockdown with none of the operator\'s filesystem and no internet (only their own model API), are not told which model or run they are, and work under a fixed budget with at most two seal-failure rounds per phase; packages come from a fixed offline mirror and recorded samples from one shared raw pack; tokens and cost come from the gateway\'s log; grading is blind and boxed, and sound is measured by the harness. Phases graded before grader blinding 2 (2026-11-18) gave the grader a copy of the seal record that still named the producing model and its token usage, so their grading was not fully blind; their scores stand as graded.',
}

function rubricVersionOf(root) {
  try {
    return readJson(path.join(root, 'bench', 'rubric.json')).version ?? null
  } catch {
    return null
  }
}

export function protocolConstants(root) {
  const { value: manifest } = loadProtocol(root)
  return {
    version: manifest.version,
    // Scores are comparable within a rubric version; the protocol version says
    // under which conditions the artifact was built.
    rubricVersion: rubricVersionOf(root) ?? manifest.version,
    phaseNames: manifest.phases.map((phase) => phase.shortTitle ?? phase.title),
    legacyPhaseNames: LEGACY_PHASE_NAMES,
    v2PhaseNames: V2_PHASE_NAMES,
    protocolNotes: PROTOCOL_NOTES,
  }
}

function writeProtocolConstants(root) {
  writeJson(pathsFor(root).protocol, protocolConstants(root))
}

export function stageDirFor(root, id, phase) {
  return path.join(pathsFor(root).runs, id, `stage${phase}`)
}

function slugify(value) {
  return value.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'model'
}

export function loadRun(root, id) {
  if (!id) throw new Error('A run id is required')
  const runPath = path.join(pathsFor(root).runs, id, 'run.json')
  if (!fs.existsSync(runPath)) throw new Error(`Unknown run: ${id}`)
  return readJson(runPath)
}

export function saveRun(root, run) {
  run.updatedAt = new Date().toISOString()
  writeJson(path.join(pathsFor(root).runs, run.id, 'run.json'), run)
  return run
}

export function isLegacyRun(run) {
  return run.schemaVersion !== 4
}


// Human-friendly harness label for a run, derived from the driving agent's
// provider string. The gallery shows this as the harness livery pill. A run
// may also record an explicit --harness override (highest precedence).
const HARNESS_BY_PROVIDER = {
  anthropic: 'Claude Code',
  claude: 'Claude Code',
  opencode: 'opencode',
  cursor: 'Cursor',
  codex: 'Codex',
  omp: 'Omp',
  orca: 'Omp',
}
function deriveHarness(provider, explicit) {
  if (explicit && String(explicit).trim()) return String(explicit).trim()
  return HARNESS_BY_PROVIDER[String(provider ?? '').toLowerCase()] ?? null
}
function resolveIsolation(requested) {
  const mode = String(requested ?? (process.env.STAGEBENCH_ISOLATION === 'none' ? 'none' : 'lockdown')).trim()
  if (!['lockdown', 'none'].includes(mode)) throw new Error(`--isolation must be "lockdown" or "none" (got "${mode}")`)
  return mode
}

export function createRun(root, metadata = {}, now = new Date()) {
  if (!metadata.model?.trim()) throw new Error('--model is required')
  const { value: protocol, digest } = loadProtocol(root)
  const targetPhase = Number(metadata.target ?? metadata.targetPhase ?? 3)
  const selected = selectedPhases(protocol, targetPhase)
  const variants = readJson(path.join(root, 'specs', 'nord-stage-4.variants.json'))
  const variantId = (metadata.variant ?? variants.default).trim()
  const variant = variants.variants.find((entry) => entry.id === variantId)
  if (!variant) throw new Error(`Unknown variant "${variantId}". Valid variants: ${variants.variants.map((entry) => entry.id).join(', ')}`)

  const locations = pathsFor(root)
  const base = slugify(metadata.model.trim())
  let id = base
  let suffix = 2
  while (fs.existsSync(path.join(locations.runs, id))) id = `${base}-${suffix++}`

  const timestamp = now.toISOString()
  const run = {
    schemaVersion: 4,
    id,
    model: metadata.model.trim(),
    title: metadata.title?.trim() || metadata.model.trim(),
    variant: variant.id,
    target: variant.label,
    targetPhase,
    selectedPhases: selected,
    status: 'in-progress',
    startedAt: timestamp,
    updatedAt: timestamp,
    ...(metadata.notes ? { notes: String(metadata.notes) } : {}),
    // How the candidate must be contained. New runs are locked down unless the
    // operator opts out at creation, and the opt-out is part of the record.
    isolation: resolveIsolation(metadata.isolation),
    agent: {
      provider: metadata.provider ?? 'unknown',
      harness: deriveHarness(metadata.provider, metadata.harness),
      model: metadata.model.trim(),
      reasoning: metadata.reasoning ?? 'unspecified',
    },
    protocol: {
      version: protocol.version,
      digest,
      // The rubric is versioned on its own, and a run is scored by the rubric
      // that was current when it was created (see loadRubric).
      rubricVersion: rubricVersionOf(root) ?? protocol.version,
      // The fixed rules an official run is held to (seal-failure rounds, the
      // budget), copied so that a later edit to the manifest never reaches it.
      ...(protocolMajor(protocol.version) >= 3 && protocol.officialRules ? { rules: rulesFromManifest(protocol) } : {}),
    },
    stages: selected.map((number) => ({ number, status: 'queued', startedAt: null, completedAt: null })),
  }
  fs.mkdirSync(path.join(locations.runs, id), { recursive: true })
  saveRun(root, run)
  return { id, targetPhase, selectedPhases: selected, runDir: path.join(locations.runs, id), run }
}

// Extend a run to a later target phase. Sealed stages, their digests, and
// their evaluations are untouched; the newly selected phases are appended as
// queued and the run returns to in-progress. The recorded protocol keeps its
// creation provenance — the added phases run under the current materials.
export function retargetRun(root, id, target) {
  const run = loadRun(root, id)
  if (isLegacyRun(run)) throw new Error(`${id} is a legacy run; create a new run instead`)
  const { value: protocol } = loadProtocol(root)
  const targetPhase = Number(target)
  const selected = selectedPhases(protocol, targetPhase)
  if (!(targetPhase > Number(run.targetPhase))) throw new Error(`--to must extend the run beyond its current target (${run.targetPhase})`)
  const existing = new Set(run.stages.map((entry) => entry.number))
  const added = selected.filter((number) => !existing.has(number))
  run.targetPhase = targetPhase
  run.selectedPhases = selected
  run.stages.push(...added.map((number) => ({ number, status: 'queued', startedAt: null, completedAt: null })))
  if (run.status === 'complete') run.status = 'in-progress'
  saveRun(root, run)
  return { id, targetPhase, addedPhases: added, next: `pnpm bench start ${id}` }
}

// Update the human-facing run label without changing its model identity,
// artifacts, evaluations, or telemetry.
export function renameRun(root, id, title) {
  const run = loadRun(root, id)
  if (isLegacyRun(run)) throw new Error(`${id} is a legacy run; its title is frozen`)
  const cleaned = String(title ?? '').trim()
  if (!cleaned) throw new Error('--title is required')
  run.title = cleaned
  saveRun(root, run)
  return { id: run.id, title: run.title }
}

function replaceRunId(value, sourceId, targetId) {
  return typeof value === 'string' ? value.replaceAll(sourceId, targetId) : value
}

function rewriteRunMetadataTree(directory, sourceId, targetId) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      rewriteRunMetadataTree(entryPath, sourceId, targetId)
      continue
    }
    if (!entry.isFile() || !/\.(?:html|json|md)$/.test(entry.name)) continue
    const before = fs.readFileSync(entryPath, 'utf8')
    const after = before.replaceAll(sourceId, targetId)
    if (after !== before) fs.writeFileSync(entryPath, after)
  }
}

// Promote a completed run to a cleaner id. With `replace`, an existing run at
// the target id and its published preview/report are removed first. Sealed
// stage contents are moved without rewriting so their artifact digests remain
// valid; only run metadata and generated reports receive the new id.
export function promoteRun(root, sourceId, targetId, { replace = false } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(targetId ?? ''))) throw new Error('--to must be a lowercase run id containing only letters, numbers, and hyphens')
  if (sourceId === targetId) throw new Error('Source and target run ids must differ')
  const sourceRun = loadRun(root, sourceId)
  if (isLegacyRun(sourceRun)) throw new Error(`${sourceId} is a legacy run; its id is frozen`)
  if (sourceRun.status !== 'complete') throw new Error(`${sourceId} must be complete before it can be promoted`)

  const locations = pathsFor(root)
  const pairs = [
    [path.join(locations.runs, sourceId), path.join(locations.runs, targetId)],
    [path.join(locations.previews, sourceId), path.join(locations.previews, targetId)],
    [path.join(locations.reports, sourceId), path.join(locations.reports, targetId)],
  ]
  const targetRunDir = pairs[0][1]
  if (fs.existsSync(targetRunDir) && !replace) throw new Error(`Target run ${targetId} already exists; pass --replace to remove it`)

  if (replace) {
    for (const [, target] of pairs) fs.rmSync(target, { recursive: true, force: true })
  }
  for (const [source, target] of pairs) {
    if (fs.existsSync(source)) fs.renameSync(source, target)
  }

  const run = readJson(path.join(targetRunDir, 'run.json'))
  run.id = targetId
  run.previews = Object.fromEntries(Object.entries(run.previews ?? {}).map(([phase, preview]) => [phase, replaceRunId(preview, sourceId, targetId)]))
  run.previewPath = replaceRunId(run.previewPath, sourceId, targetId)
  if (run.evaluation) run.evaluation.reportPath = replaceRunId(run.evaluation.reportPath, sourceId, targetId)
  for (const stage of run.stages ?? []) {
    stage.verificationPath = replaceRunId(stage.verificationPath, sourceId, targetId)
    if (stage.evaluation) {
      stage.evaluation.path = replaceRunId(stage.evaluation.path, sourceId, targetId)
      stage.evaluation.reportPath = replaceRunId(stage.evaluation.reportPath, sourceId, targetId)
    }
  }
  saveRun(root, run)

  rewriteRunMetadataTree(path.join(targetRunDir, 'evaluations'), sourceId, targetId)
  rewriteRunMetadataTree(path.join(targetRunDir, 'verifications'), sourceId, targetId)
  rewriteRunMetadataTree(path.join(locations.reports, targetId), sourceId, targetId)

  // Drop transient workspaces for both ids: implementation workspaces are keyed
  // by run id, evaluator workspaces by the blind handle.
  for (const runId of [sourceId, targetId]) {
    fs.rmSync(path.join(workspaceRoot(root, 'work'), runId), { recursive: true, force: true })
    fs.rmSync(path.join(workspaceRoot(root, 'eval'), blindRunCode(runId)), { recursive: true, force: true })
  }
  return { id: targetId, replaced: replace, model: run.model, title: run.title }
}

export function stageState(run, phase) {
  const state = run.stages.find((entry) => entry.number === Number(phase))
  if (!state) throw new Error(`Phase ${phase} is not selected for run ${run.id} (target ${run.targetPhase})`)
  return state
}

// The next phase to work on: the first stage that is not complete.
export function nextPhase(run) {
  return run.stages.find((entry) => entry.status !== 'complete') ?? null
}

export function markRunning(root, id, phase, now = new Date()) {
  const run = loadRun(root, id)
  if (isLegacyRun(run)) throw new Error(`${id} is a legacy run; create a new run instead`)
  const current = stageState(run, phase)
  const index = run.stages.findIndex((entry) => entry.number === Number(phase))
  const previous = index > 0 ? run.stages[index - 1] : null
  if (previous && previous.status !== 'complete') throw new Error(`Phase ${previous.number} must be sealed before Phase ${phase} starts`)
  if (!['queued', 'running'].includes(current.status)) throw new Error(`Phase ${phase} cannot start from status "${current.status}"`)
  current.status = 'running'
  current.startedAt ??= now.toISOString()
  saveRun(root, run)
  return run
}

// Sum per-stage telemetry into run totals. A total is null until at least one
// stage reports that field — never silently zero. That sum is only full-run
// usage when every phase recorded the field; the gallery checks coverage
// (tokenCoverageFromStages) before presenting it as the Tokens column.
export function recomputeRunTelemetry(run) {
  recomputeTelemetry(run)
  return run
}

function recomputeTelemetry(run) {
  const totals = {}
  for (const field of TELEMETRY_FIELDS) {
    const values = run.stages.map((stage) => stage.telemetry?.[field]).filter((value) => typeof value === 'number')
    totals[field] = values.length > 0 ? roundTelemetryValue(values.reduce((sum, value) => sum + value, 0)) : null
  }
  run.telemetry = totals
}

// Record usage for a phase (cost, tokens, tool calls) that an operator or an
// orchestrating agent supplies. Wall time is recorded automatically at seal.
//
// A boxed phase's tokens and cost come from the gateway's own log at seal and
// are the official figures. Anything typed in afterwards for such a phase is
// kept beside them, as `operatorTelemetry`, labelled operator-entered and
// non-official, and never replaces them. For a phase with no gateway record,
// typed figures are all there is: they become its telemetry, marked as typed.
export function recordTelemetry(root, id, phase, values, { source = 'operator' } = {}) {
  const run = loadRun(root, id)
  if (isLegacyRun(run)) throw new Error(`${id} is a legacy run; telemetry is frozen`)
  const current = stageState(run, phase)
  const cleaned = {}
  for (const field of TELEMETRY_FIELDS) {
    if (values[field] === undefined) continue
    const value = Number(values[field])
    if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number`)
    cleaned[field] = value
  }
  if (current.telemetrySource === 'gateway' && source !== 'gateway') {
    current.operatorTelemetry = { ...current.operatorTelemetry, ...cleaned, source: 'operator', official: false, at: new Date().toISOString() }
    saveRun(root, run)
    return { phase: Number(phase), telemetry: current.telemetry, operatorTelemetry: current.operatorTelemetry, note: 'This phase has gateway-derived figures; what you entered is kept as operator-entered and does not replace them.' }
  }
  current.telemetry = { ...current.telemetry, ...cleaned }
  if (Object.keys(cleaned).some((field) => field !== 'wallTimeSeconds')) current.telemetrySource = source
  recomputeTelemetry(run)
  saveRun(root, run)
  return { phase: Number(phase), telemetry: current.telemetry, totals: run.telemetry, source }
}

// Seal a phase: requires the passing verification produced for the current
// artifact tree. Records the digest, wall time, and publishes the preview.
//
// `outcome: 'failed'` is the one exception: an official phase whose last
// allowed seal failed is frozen as it stands, with its failing verification,
// so it is never left unsealed. Its preview is published only if it built.
export function markSealed(root, id, phase, verification, { outcome = 'passed' } = {}, now = new Date()) {
  const run = loadRun(root, id)
  const current = stageState(run, phase)
  if (current.status !== 'running') throw new Error(`Phase ${phase} must be running before it can be sealed`)
  if (!verification?.artifactDigest || (outcome === 'passed' && !verification.passed)) throw new Error(`Phase ${phase} requires a passing verification before sealing`)
  const currentDigest = hashTree(stageDirFor(root, id, phase)).digest
  if (currentDigest !== verification.artifactDigest) throw new Error(`Phase ${phase} changed after verification; run seal again`)
  current.status = 'complete'
  current.completedAt = now.toISOString()
  current.artifactDigest = verification.artifactDigest
  current.artifactDigestVersion = ARTIFACT_DIGEST_VERSION
  current.verificationPath = `runs/${id}/verifications/stage${phase}.json`
  if (current.startedAt) {
    const wallTimeSeconds = Math.max(0, Math.round((now.getTime() - Date.parse(current.startedAt)) / 1000))
    current.telemetry = { wallTimeSeconds, ...current.telemetry }
  }
  current.sealOutcome = outcome
  recomputeTelemetry(run)
  if (outcome === 'passed' || fs.existsSync(path.join(stageDirFor(root, id, phase), 'dist', 'index.html'))) publishPreview(root, run, Number(phase))
  if (run.stages.every((entry) => entry.status === 'complete')) run.status = 'complete'
  saveRun(root, run)
  return run
}

function publishPreview(root, run, phase) {
  const locations = pathsFor(root)
  const source = path.join(stageDirFor(root, run.id, phase), 'dist')
  if (!fs.existsSync(path.join(source, 'index.html'))) throw new Error(`Missing Phase ${phase} build: ${source}/index.html`)
  const destination = path.join(locations.previews, run.id, `stage${phase}`)
  fs.rmSync(destination, { recursive: true, force: true })
  fs.cpSync(source, destination, { recursive: true })
  run.previews = { ...run.previews, [String(phase)]: `/previews/${run.id}/stage${phase}/index.html` }
  const latest = Math.max(...Object.keys(run.previews).map(Number))
  run.previewStage = latest
  run.previewPath = run.previews[String(latest)]
}

// Attach a scored evaluation to a stage. The CLI computes the summary and
// aggregate on the eval side and passes plain data in; this function only
// records it.
export function registerEvaluation(root, id, phase, stageSummary, aggregate) {
  const run = loadRun(root, id)
  const current = stageState(run, phase)
  if (current.status !== 'complete') throw new Error(`Phase ${phase} must be sealed before its evaluation is registered`)
  current.evaluation = stageSummary
  run.evaluation = aggregate
  saveRun(root, run)
  return run
}

// --- footnotes ---------------------------------------------------------------

// What a reader of the leaderboard should know about a run before comparing
// its score with another's. Some follow from the record and are derived here
// every time (so they cannot be forgotten or quietly dropped); the rest are
// notes an operator attached with `bench footnote`.
export function runFootnotes(run) {
  const notes = []
  const sealed = (run.stages ?? []).filter((stage) => stage.status === 'complete')
  if (run.derivedFrom) {
    notes.push({ kind: 'operator-patch', text: `Operator-patched fork of ${run.derivedFrom.run} from Phase ${run.derivedFrom.fromPhase}: ${run.derivedFrom.reason} This is not the model's sealed output; the original run keeps its own score.` })
  }
  if (isStrictProtocol(run)) {
    const unlocked = sealed.filter((stage) => stage.isolation?.mode === 'none' && !stage.patchOf).map((stage) => stage.number)
    if (unlocked.length > 0) notes.push({ kind: 'isolation', phases: unlocked, text: `Phase ${unlocked.join(', ')} sealed outside the lockdown: the candidate ran with whatever access its harness allowed. Not an official protocol ${protocolMajor(run.protocol?.version)} result.` })
    else if (run.isolation === 'none' && sealed.length === 0) notes.push({ kind: 'isolation', text: 'Created with --isolation none: not an official protocol 3 run.' })
    const offProtocol = sealed.filter((stage) => (stage.operator?.offProtocol ?? 0) > 0).map((stage) => stage.number)
    if (offProtocol.length > 0) notes.push({ kind: 'off-protocol', phases: offProtocol, text: `Phase ${offProtocol.join(', ')}: the operator sent the candidate a message outside the fixed templates (recorded in the run).` })
    const relayed = sealed.filter((stage) => (stage.operator?.followUps ?? 0) > 0).map((stage) => `${stage.number} (${stage.operator.followUps})`)
    if (relayed.length > 0) notes.push({ kind: 'operator', text: `Template follow-ups sent by the operator, by phase: ${relayed.join(', ')}.` })
    for (const stage of sealed) {
      const rounds = stage.seal?.sealFailureRelays ?? 0
      if (stage.sealOutcome === 'failed') {
        const why = { 'seal-failure-rounds': `after all ${stage.seal?.sealFailureLimit ?? ''} seal-failure rounds`.replace('  ', ' '), budget: 'when its budget left no room for another launch', operator: 'by the operator' }[stage.seal?.finalizedBy] ?? ''
        notes.push({ kind: 'sealed-failed', phases: [stage.number], text: `Phase ${stage.number} was sealed as it stood, marked failed, ${why}: ${(stage.seal?.failures ?? []).map((failure) => String(failure).split('\n')[0]).slice(0, 3).join(' ') || 'its last seal did not pass'}` })
      } else if (rounds > 0) {
        notes.push({ kind: 'seal-failure-rounds', phases: [stage.number], text: `Phase ${stage.number} passed its seal after ${rounds} seal-failure round${rounds === 1 ? '' : 's'}${stage.seal?.sealFailureLimit ? ` (of ${stage.seal.sealFailureLimit} allowed)` : ''}.` })
      }
      if (stage.budget?.status === 'stopped') notes.push({ kind: 'budget', phases: [stage.number], text: `Phase ${stage.number} was stopped by its ${stage.budget.stoppedBy === 'tokens' ? 'generated-token' : 'agent-time'} budget and sealed as it stood.` })
      const extra = (stage.official?.reasons ?? []).filter((reason) => !/outside the lockdown|operator patch|outside the fixed templates|built under protocol/.test(reason))
      if (stage.official && !stage.official.official && extra.length > 0) notes.push({ kind: 'non-official', phases: [stage.number], text: `Phase ${stage.number} is not an official protocol ${protocolMajor(run.protocol?.version)} result: ${extra.join('; ')}.` })
      if (stage.operatorTelemetry) notes.push({ kind: 'operator-telemetry', phases: [stage.number], text: `Phase ${stage.number}: usage figures an operator entered by hand are kept in the record, labelled, and not shown; the figures shown come from the gateway log.` })
      if (stage.evaluation?.grader?.drift) notes.push({ kind: 'grader-drift', phases: [stage.number], text: `Phase ${stage.number}: the grader's requests for ${stage.evaluation.grader.pinned} were served as ${stage.evaluation.grader.drift.map((entry) => entry.servedAs).join(', ')}.` })
    }
  }
  for (const note of run.footnotes ?? []) notes.push({ kind: note.kind ?? 'note', ...(note.phase ? { phases: [note.phase] } : {}), text: note.text, ...(note.at ? { at: note.at } : {}) })
  return notes
}

export function addFootnote(root, id, { text, phase = null, kind = 'note' }, now = new Date()) {
  const run = loadRun(root, id)
  if (isLegacyRun(run)) throw new Error(`${id} is a legacy run; it is read-only to the CLI`)
  const cleaned = String(text ?? '').trim()
  if (!cleaned) throw new Error('--add needs the footnote text')
  if (phase !== null) stageState(run, phase)
  run.footnotes = [...(run.footnotes ?? []), { text: cleaned, kind: String(kind), ...(phase !== null ? { phase: Number(phase) } : {}), at: now.toISOString() }]
  saveRun(root, run)
  return { id, footnotes: run.footnotes }
}

export function removeFootnote(root, id, index) {
  const run = loadRun(root, id)
  if (isLegacyRun(run)) throw new Error(`${id} is a legacy run; it is read-only to the CLI`)
  const position = Number(index)
  if (!Number.isInteger(position) || position < 0 || position >= (run.footnotes ?? []).length) throw new Error(`--remove needs an index between 0 and ${(run.footnotes ?? []).length - 1}`)
  run.footnotes = run.footnotes.filter((_, at) => at !== position)
  saveRun(root, run)
  return { id, footnotes: run.footnotes }
}

// How a run was contained, for the gallery: one word for the run, and the
// mode each sealed phase actually had.
export function isolationSummary(run) {
  const sealed = (run.stages ?? []).filter((stage) => stage.status === 'complete')
  const modes = sealed.map((stage) => stage.isolation?.mode ?? 'none')
  const required = ['lockdown', 'none'].includes(run.isolation) ? run.isolation : 'none'
  const mode = modes.length === 0 ? required : modes.every((value) => value === 'lockdown') ? 'lockdown' : modes.every((value) => value === 'none') ? 'none' : 'mixed'
  return { mode, required, stages: Object.fromEntries(sealed.map((stage, index) => [stage.number, modes[index]])) }
}

// --- operator patches ----------------------------------------------------------

function copyTree(source, destination) {
  if (fs.existsSync(source)) fs.cpSync(source, destination, { recursive: true, dereference: false })
}

// A sealed phase is never patched in place. When an operator changes an
// artifact — a one-line fix, a replaced asset, anything — the result is a new
// run that says so: this copies the phases before `fromPhase` as they were
// sealed, and reopens `fromPhase` onward, each starting from the source run's
// sealed artifact for that same phase. The operator applies the change in the
// workspace and seals; the fork is graded on its own, and labelled everywhere
// as an operator patch. The source run is not touched.
export function forkRun(root, sourceId, { to, reason, fromPhase }, now = new Date()) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(to ?? ''))) throw new Error('--to must be a lowercase run id containing only letters, numbers, and hyphens')
  const cleanedReason = String(reason ?? '').trim()
  if (cleanedReason.length < 12) throw new Error('--reason must say what the operator is changing and why (it is shown on the leaderboard)')
  const source = loadRun(root, sourceId)
  if (isLegacyRun(source)) throw new Error(`${sourceId} is a legacy run; it cannot be forked`)
  const first = Number(fromPhase ?? source.stages.find((stage) => stage.status === 'complete')?.number)
  const locations = pathsFor(root)
  if (fs.existsSync(path.join(locations.runs, to))) throw new Error(`Run ${to} already exists`)
  const patched = source.stages.filter((stage) => stage.number >= first)
  if (patched.length === 0) throw new Error(`--from-phase ${first} is not a phase of ${sourceId}`)
  const unsealed = patched.filter((stage) => stage.status !== 'complete')
  if (unsealed.length > 0) throw new Error(`Phase ${unsealed.map((stage) => stage.number).join(', ')} of ${sourceId} is not sealed; only sealed phases can be forked`)

  const timestamp = now.toISOString()
  const run = {
    ...source,
    id: to,
    title: `${source.title ?? source.model} (operator patch)`,
    status: 'in-progress',
    startedAt: timestamp,
    updatedAt: timestamp,
    // The patch is the operator's work on this machine, not a boxed candidate's.
    isolation: 'none',
    derivedFrom: { run: sourceId, fromPhase: first, reason: cleanedReason.endsWith('.') ? cleanedReason : `${cleanedReason}.`, at: timestamp },
    footnotes: [...(source.footnotes ?? [])],
    stages: source.stages.map((stage) => (stage.number < first
      ? { ...stage, inheritedFrom: sourceId, ...(stage.evaluation ? { evaluation: { ...stage.evaluation, inheritedFrom: sourceId } } : {}) }
      : { number: stage.number, status: 'queued', startedAt: null, completedAt: null, patchOf: { run: sourceId, phase: stage.number, artifactDigest: stage.artifactDigest ?? null } })),
  }
  delete run.evaluation
  delete run.telemetry
  delete run.previewPath
  delete run.previewStage
  run.previews = {}
  const targetDir = path.join(locations.runs, to)
  fs.mkdirSync(targetDir, { recursive: true })
  for (const stage of run.stages.filter((entry) => entry.status === 'complete')) {
    const name = `stage${stage.number}`
    copyTree(path.join(locations.runs, sourceId, name), path.join(targetDir, name))
    for (const sidecar of [`verifications/${name}.json`, `evaluations/${name}.json`, `evaluations/${name}.assessment.json`]) {
      const from = path.join(locations.runs, sourceId, sidecar)
      if (fs.existsSync(from)) {
        fs.mkdirSync(path.dirname(path.join(targetDir, sidecar)), { recursive: true })
        fs.copyFileSync(from, path.join(targetDir, sidecar))
      }
    }
    copyTree(path.join(locations.previews, sourceId, name), path.join(locations.previews, to, name))
    stage.verificationPath = `runs/${to}/verifications/${name}.json`
    if (stage.evaluation?.path) stage.evaluation.path = stage.evaluation.path.replace(`runs/${sourceId}/`, `runs/${to}/`)
    if (fs.existsSync(path.join(locations.previews, to, name, 'index.html'))) run.previews[String(stage.number)] = `/previews/${to}/${name}/index.html`
  }
  if (Object.keys(run.previews).length > 0) {
    run.previewStage = Math.max(...Object.keys(run.previews).map(Number))
    run.previewPath = run.previews[String(run.previewStage)]
  }
  recomputeTelemetry(run)
  saveRun(root, run)
  return { id: to, derivedFrom: run.derivedFrom, inheritedPhases: run.stages.filter((stage) => stage.status === 'complete').map((stage) => stage.number), patchPhases: patched.map((stage) => stage.number), next: `pnpm bench start ${to}   (the workspace holds ${sourceId}'s sealed Phase ${first}; apply the change in candidate/, then pnpm bench seal ${to})` }
}

export function statusSummary(run) {
  if (isLegacyRun(run)) return { id: run.id, legacy: true, next: 'Legacy run; read-only.' }
  const stage = nextPhase(run)
  if (!stage) {
    const unscored = run.stages.find((entry) => !entry.evaluation)
    return { id: run.id, status: run.status, next: unscored ? `pnpm bench score ${run.id} --phase ${unscored.number}` : 'Done: all phases sealed and scored.' }
  }
  const implement = stage.patchOf
    ? `apply the operator patch in the workspace's candidate/, then pnpm bench seal ${run.id}`
    : run.isolation === 'lockdown'
      ? `pnpm bench agent ${run.id} --harness <codex|claude|custom>, then pnpm bench seal ${run.id}`
      : `implement in the workspace, then pnpm bench seal ${run.id}`
  const next = stage.status === 'queued' ? `pnpm bench start ${run.id}` : implement
  return { id: run.id, status: run.status, isolation: run.isolation ?? 'none', phase: stage.number, phaseStatus: stage.status, next }
}

const LEGACY_STAGE_STATUS = {
  queued: 'queued', prepared: 'queued',
  running: 'running', verifying: 'running', verified: 'running',
  complete: 'complete',
  failed: 'failed', invalid: 'failed', 'budget-exceeded': 'failed',
}

// Legacy runs stored telemetry as totals.<field>.{value, kind}; current runs
// store flat per-stage numbers rolled up into run.telemetry.
function telemetrySummary(run) {
  const totals = isLegacyRun(run)
    ? Object.fromEntries(TELEMETRY_FIELDS.map((field) => [field, run.telemetry?.totals?.[field]?.value ?? null]))
    : { ...Object.fromEntries(TELEMETRY_FIELDS.map((field) => [field, null])), ...run.telemetry }
  return TELEMETRY_FIELDS.some((field) => typeof totals[field] === 'number') ? totals : null
}

// Project one run.json (current or legacy) into the flat entry the gallery
// renders. Legacy runs keep only what the gallery needs: identity, scores,
// previews, and links to their frozen static HTML reports.
export function registryEntry(run) {
  const legacy = isLegacyRun(run)
  return {
    id: run.id,
    model: run.model,
    title: run.title ?? run.model,
    variant: run.variant ?? null,
    target: run.target ?? null,
    targetPhase: run.targetPhase ?? null,
    harness: run.agent?.harness ?? null,
    protocolVersion: run.protocol?.version ?? run.benchmarkVersion ?? null,
    // How the candidate was contained: 'lockdown', 'none', or 'mixed' across
    // phases. Runs from before the lockdown existed are 'none'.
    isolation: legacy ? 'none' : isolationSummary(run).mode,
    // What a reader should know before comparing this score with another's.
    footnotes: legacy ? [] : runFootnotes(run),
    derivedFrom: run.derivedFrom ? { run: run.derivedFrom.run, fromPhase: run.derivedFrom.fromPhase } : null,
    legacy,
    status: legacy ? 'legacy' : run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    score: run.evaluation?.score ?? null,
    // Protocol 2.0 panel-fidelity axis, scored once per run (not per phase).
    // Null on legacy/v1 records that have no run axis.
    panelVisuals: typeof run.evaluation?.runAxis?.score === 'number' ? run.evaluation.runAxis.score : null,
    // The rubric that produced the score, not the one current when the run was
    // created. Scores from different rubrics are not comparable, so the gallery
    // ranks them in separate tiers rather than in one list.
    rubricVersion: run.evaluation?.rubricVersion ?? null,
    reportPath: run.evaluation?.reportPath ?? null,
    telemetry: telemetrySummary(run),
    // Phase lists for each token field, so the gallery can tell a full-run
    // total from a sum of the phases that happened to record one.
    tokenCoverage: tokenCoverageFromStages(run.stages),
    previewPath: run.previewPath ?? null,
    previewStage: run.previewStage ?? null,
    previews: run.previews ?? null,
    // Gateway-derived usage, summed over the phases that have it (protocol 3,
    // boxed). Null where any phase's figures are only what an operator typed.
    usage: legacy ? null : usageSummary(run),
    // An official protocol-3 result: every sealed phase boxed, inside its
    // budget, no message outside the templates.
    official: legacy ? false : officialSummary(run),
    stages: (run.stages ?? []).map((stage) => ({
      number: stage.number,
      status: legacy ? (LEGACY_STAGE_STATUS[stage.status] ?? 'queued') : stage.status,
      score: stage.evaluation?.score ?? null,
      reportPath: stage.evaluation?.reportPath ?? null,
      ...(!legacy && stage.status === 'complete' ? {
        isolation: stage.isolation?.mode ?? 'none',
        sealOutcome: stage.sealOutcome ?? 'passed',
        ...(stage.seal ? { sealFailureRelays: stage.seal.sealFailureRelays ?? 0, sealFailureLimit: stage.seal.sealFailureLimit ?? null } : {}),
        ...(stage.budget ? { budget: { status: stage.budget.status, stoppedBy: stage.budget.stoppedBy ?? null, agentMinutes: stage.budget.agentMinutes ?? null, outputTokens: stage.budget.used?.outputTokens ?? null, limits: stage.budget.rules ?? null } } : {}),
        ...(stage.usage ? { usage: { source: stage.usage.source, inputTokens: stage.usage.inputTokens, cachedInputTokens: stage.usage.cachedInputTokens, outputTokens: stage.usage.outputTokens, reasoningTokens: stage.usage.reasoningTokens, costUsd: stage.usage.costUsd, pricesAsOf: stage.usage.prices?.asOf ?? null } } : {}),
        ...(stage.audio ? { audio: { status: stage.audio.status, failure: stage.audio.failure?.kind ?? null, scores: stage.audio.scores ?? null } } : {}),
        ...(stage.evaluation?.grader ? { grader: { pinned: stage.evaluation.grader.pinned ?? null, served: stage.evaluation.grader.served ?? [], drift: Boolean(stage.evaluation.grader.drift) } } : {}),
        official: stage.official?.official ?? false,
      } : {}),
    })),
  }
}

function usageSummary(run) {
  const sealed = (run.stages ?? []).filter((stage) => stage.status === 'complete')
  const metered = sealed.filter((stage) => stage.usage?.source === 'gateway')
  if (metered.length === 0) return null
  const sum = (field) => metered.reduce((total, stage) => (typeof stage.usage[field] === 'number' && total !== null ? total + stage.usage[field] : total), 0)
  return {
    source: 'gateway',
    phases: metered.map((stage) => stage.number),
    complete: metered.length === sealed.length,
    inputTokens: sum('inputTokens'),
    cachedInputTokens: sum('cachedInputTokens'),
    outputTokens: sum('outputTokens'),
    reasoningTokens: metered.some((stage) => typeof stage.usage.reasoningTokens === 'number') ? sum('reasoningTokens') : null,
    costUsd: metered.every((stage) => typeof stage.usage.costUsd === 'number') ? Math.round(sum('costUsd') * 100) / 100 : null,
    pricesAsOf: [...new Set(metered.map((stage) => stage.usage.prices?.asOf).filter(Boolean))].join(', ') || null,
  }
}

function officialSummary(run) {
  const sealed = (run.stages ?? []).filter((stage) => stage.status === 'complete')
  return isStrictProtocol(run) && sealed.length > 0 && sealed.every((stage) => stage.official?.official === true)
}

// Cache the projected entry for each run.json keyed by mtime, so an unchanged
// run is neither read nor re-projected on the next reindex. Lives under the
// gitignored node_modules so it never enters the tree; a stale or missing
// cache only costs a full read (it never changes the output).
function reindexCachePath(root) {
  return path.join(root, 'node_modules', '.cache', 'stagebench-reindex.json')
}

// The cache is keyed on each run.json's mtime, which catches content changes
// but not changes to the projection itself — a new field silently kept its old
// shape until something touched the run. Bump this whenever registryEntry's
// output shape changes.
const REGISTRY_PROJECTION_VERSION = 6

function readReindexCache(root) {
  try {
    const cache = JSON.parse(fs.readFileSync(reindexCachePath(root), 'utf8'))
    if (cache.__projection !== REGISTRY_PROJECTION_VERSION) return { __projection: REGISTRY_PROJECTION_VERSION }
    return cache
  } catch {
    return { __projection: REGISTRY_PROJECTION_VERSION }
  }
}

function writeReindexCache(root, cache) {
  try {
    const cachePath = reindexCachePath(root)
    fs.mkdirSync(path.dirname(cachePath), { recursive: true })
    fs.writeFileSync(cachePath, JSON.stringify(cache))
  } catch {
    // A cache write failure is non-fatal; the next reindex just re-reads.
  }
}

export async function reindexRegistry(root) {
  const locations = pathsFor(root)
  const cache = readReindexCache(root)
  const nextCache = { __projection: REGISTRY_PROJECTION_VERSION }
  let entries = []

  if (fs.existsSync(locations.runs)) {
    const directories = (await fs.promises.readdir(locations.runs, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
    entries = (await Promise.all(directories.map(async (dir) => {
      const runPath = path.join(locations.runs, dir.name, 'run.json')
      let stat
      try {
        stat = await fs.promises.stat(runPath)
      } catch {
        return null // No run.json in this directory.
      }
      const key = path.relative(root, runPath).split(path.sep).join('/')
      const cached = cache[key]
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        nextCache[key] = cached
        return cached.entry
      }
      const entry = registryEntry(JSON.parse(await fs.promises.readFile(runPath, 'utf8')))
      nextCache[key] = { mtimeMs: stat.mtimeMs, entry }
      return entry
    }))).filter((entry) => entry !== null)
  }

  entries.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || a.id.localeCompare(b.id))
  writeJson(locations.registry, entries)
  writeProtocolConstants(root)
  writeReindexCache(root, nextCache)
  return { count: entries.length, ids: entries.map((run) => run.id), registry: locations.registry }
}

export function ensureInstalled(stageDir) {
  if (fs.existsSync(path.join(stageDir, 'node_modules'))) return { installed: false }
  const result = spawnSync('pnpm', ['install', '--prefer-offline'], { cwd: stageDir, encoding: 'utf8', timeout: 600_000, env: { ...process.env, CI: '1' } })
  if (result.status !== 0 || result.error) {
    throw new Error(`pnpm install failed in ${stageDir}: ${String(result.stderr || result.stdout || result.error?.message).trim().slice(-2000)}`)
  }
  return { installed: true }
}

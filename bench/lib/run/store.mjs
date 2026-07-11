// Run state: creation, phase transitions, preview publication, evaluation
// registration, and the generated gallery index. runs/<id>/run.json is the
// only mutable source of truth; src/data/runs.json is a generated projection.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { blindRunCode, hashTree, loadProtocol, readJson, selectedPhases, workspaceRoot, writeJson } from '../shared.mjs'
import { TELEMETRY_FIELDS, roundTelemetryValue } from '../../../src/telemetry-fields.mjs'

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
export function protocolConstants(root) {
  const { value: manifest } = loadProtocol(root)
  return {
    version: manifest.version,
    phaseNames: manifest.phases.map((phase) => phase.shortTitle ?? phase.title),
    legacyPhaseNames: LEGACY_PHASE_NAMES,
    v2PhaseNames: V2_PHASE_NAMES,
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
    agent: {
      provider: metadata.provider ?? 'unknown',
      model: metadata.model.trim(),
      reasoning: metadata.reasoning ?? 'unspecified',
    },
    protocol: {
      version: protocol.version,
      digest,
      rubricVersion: protocol.version,
    },
    stages: selected.map((number) => ({ number, status: 'queued', startedAt: null, completedAt: null })),
  }
  fs.mkdirSync(path.join(locations.runs, id), { recursive: true })
  saveRun(root, run)
  return { id, targetPhase, selectedPhases: selected, runDir: path.join(locations.runs, id), run }
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
// stage reports that field — never silently zero.
function recomputeTelemetry(run) {
  const totals = {}
  for (const field of TELEMETRY_FIELDS) {
    const values = run.stages.map((stage) => stage.telemetry?.[field]).filter((value) => typeof value === 'number')
    totals[field] = values.length > 0 ? roundTelemetryValue(values.reduce((sum, value) => sum + value, 0)) : null
  }
  run.telemetry = totals
}

// Record measured usage for a phase (cost, tokens, tool calls). Wall time is
// recorded automatically at seal; everything else comes from the operator or
// orchestrating agent, and stays null when unavailable.
export function recordTelemetry(root, id, phase, values) {
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
  current.telemetry = { ...current.telemetry, ...cleaned }
  recomputeTelemetry(run)
  saveRun(root, run)
  return { phase: Number(phase), telemetry: current.telemetry, totals: run.telemetry }
}

// Seal a phase: requires the passing verification produced for the current
// artifact tree. Records the digest, wall time, and publishes the preview.
export function markSealed(root, id, phase, verification, now = new Date()) {
  const run = loadRun(root, id)
  const current = stageState(run, phase)
  if (current.status !== 'running') throw new Error(`Phase ${phase} must be running before it can be sealed`)
  if (!verification?.passed || !verification.artifactDigest) throw new Error(`Phase ${phase} requires a passing verification before sealing`)
  const currentDigest = hashTree(stageDirFor(root, id, phase)).digest
  if (currentDigest !== verification.artifactDigest) throw new Error(`Phase ${phase} changed after verification; run seal again`)
  current.status = 'complete'
  current.completedAt = now.toISOString()
  current.artifactDigest = verification.artifactDigest
  current.verificationPath = `runs/${id}/verifications/stage${phase}.json`
  if (current.startedAt) {
    const wallTimeSeconds = Math.max(0, Math.round((now.getTime() - Date.parse(current.startedAt)) / 1000))
    current.telemetry = { wallTimeSeconds, ...current.telemetry }
  }
  recomputeTelemetry(run)
  publishPreview(root, run, Number(phase))
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

export function statusSummary(run) {
  if (isLegacyRun(run)) return { id: run.id, legacy: true, next: 'Legacy run; read-only.' }
  const stage = nextPhase(run)
  if (!stage) {
    const unscored = run.stages.find((entry) => !entry.evaluation)
    return { id: run.id, status: run.status, next: unscored ? `pnpm bench score ${run.id} --phase ${unscored.number}` : 'Done: all phases sealed and scored.' }
  }
  const next = stage.status === 'queued' ? `pnpm bench start ${run.id}` : `implement in the workspace, then pnpm bench seal ${run.id}`
  return { id: run.id, status: run.status, phase: stage.number, phaseStatus: stage.status, next }
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
    legacy,
    status: legacy ? 'legacy' : run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    score: run.evaluation?.score ?? null,
    reportPath: run.evaluation?.reportPath ?? null,
    telemetry: telemetrySummary(run),
    previewPath: run.previewPath ?? null,
    previewStage: run.previewStage ?? null,
    previews: run.previews ?? null,
    stages: (run.stages ?? []).map((stage) => ({
      number: stage.number,
      status: legacy ? (LEGACY_STAGE_STATUS[stage.status] ?? 'queued') : stage.status,
      score: stage.evaluation?.score ?? null,
      reportPath: stage.evaluation?.reportPath ?? null,
    })),
  }
}

// Cache the projected entry for each run.json keyed by mtime, so an unchanged
// run is neither read nor re-projected on the next reindex. Lives under the
// gitignored node_modules so it never enters the tree; a stale or missing
// cache only costs a full read (it never changes the output).
function reindexCachePath(root) {
  return path.join(root, 'node_modules', '.cache', 'stagebench-reindex.json')
}

function readReindexCache(root) {
  try {
    return JSON.parse(fs.readFileSync(reindexCachePath(root), 'utf8'))
  } catch {
    return {}
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
  const nextCache = {}
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

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { readJson, writeJson } from './cli.mjs'
import { hashTree, loadProtocol, selectedPhases, sha256 } from './protocol.mjs'
import { emptyTelemetry, recomputeTotals, recordMeasurement } from './telemetry.mjs'

const DEFAULT_VARIANT = 'stage-4-73'
const VARIANT_FALLBACK = {
  'stage-4-88': 'Stage 4 88',
  'stage-4-73': 'Stage 4 73',
  'stage-4-compact-73': 'Stage 4 Compact 73',
}

export function pathsFor(root) {
  return {
    registry: path.join(root, 'src', 'data', 'runs.json'),
    runs: path.join(root, 'runs'),
    previews: path.join(root, 'public', 'previews'),
    reports: path.join(root, 'public', 'reports'),
  }
}

function slugify(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'model'
}

function commandOutput(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : 'unavailable'
}

function gitSource(root) {
  const status = commandOutput('git', ['status', '--porcelain'], root)
  const dirty = status !== '' && status !== 'unavailable'
  const patchMaterial = dirty ? `${status}\n${commandOutput('git', ['diff', '--binary', 'HEAD'], root)}` : ''
  return {
    gitCommit: commandOutput('git', ['rev-parse', 'HEAD'], root),
    branch: commandOutput('git', ['branch', '--show-current'], root),
    dirty,
    patchDigest: dirty ? sha256(patchMaterial) : null,
  }
}

function resolveVariant(root, variantId) {
  const id = (variantId || DEFAULT_VARIANT).trim()
  const registryPath = path.join(root, 'specs', 'nord-stage-4.variants.json')
  if (fs.existsSync(registryPath)) {
    const registry = readJson(registryPath)
    const match = registry.variants?.find((variant) => variant.id === id)
    if (!match) throw new Error(`Unknown variant "${id}". Valid variants: ${registry.variants.map((variant) => variant.id).join(', ')}`)
    return { id: match.id, label: match.label }
  }
  if (!VARIANT_FALLBACK[id]) throw new Error(`Unknown variant "${id}"`)
  return { id, label: VARIANT_FALLBACK[id] }
}

export function saveRun(root, run) {
  run.updatedAt = run.updatedAt ?? new Date().toISOString()
  writeJson(path.join(pathsFor(root).runs, run.id, 'run.json'), run)
  return run
}

export function loadRun(root, id) {
  if (!id) throw new Error('--id is required')
  const runPath = path.join(pathsFor(root).runs, id, 'run.json')
  if (!fs.existsSync(runPath)) throw new Error(`Unknown run: ${id}`)
  return readJson(runPath)
}

export function createRun(root, metadata = {}, now = new Date()) {
  if (!metadata.model?.trim()) throw new Error('--model is required')
  if (metadata.official === true) {
    const required = ['provider', 'modelSnapshot', 'reasoning', 'agentVersion', 'toolBundle', 'browser', 'networkPolicy', 'budgetTrack']
    const missing = required.filter((field) => !metadata[field] || ['unknown', 'unspecified'].includes(String(metadata[field])))
    if (missing.length > 0) throw new Error(`Official runs require complete provenance: ${missing.join(', ')}`)
    if (metadata.budgetTrack === 'exploratory') throw new Error('Official runs require a non-exploratory budget track')
  }
  const { value: protocol, manifest, digest } = loadProtocol(root)
  const targetPhase = Number(metadata.targetPhase ?? 3)
  const selected = selectedPhases(protocol, targetPhase)
  const variant = resolveVariant(root, metadata.variant)
  const locations = pathsFor(root)
  const base = slugify(metadata.model.trim())
  let id = base
  let suffix = 2
  while (fs.existsSync(path.join(locations.runs, id))) id = `${base}-${suffix++}`
  const timestamp = now.toISOString()
  const classificationKind = metadata.official === true ? 'official' : 'exploratory'
  const run = {
    $schema: '../../schemas/run.schema.json',
    schemaVersion: 3,
    benchmarkVersion: protocol.version,
    id,
    model: metadata.model.trim(),
    title: metadata.title?.trim() || metadata.model.trim(),
    variant: variant.id,
    target: variant.label,
    targetPhase,
    selectedPhases: selected,
    classification: {
      kind: classificationKind,
      comparable: classificationKind === 'official',
      comparisonGroup: classificationKind === 'official' ? `stagebench-${protocol.version}-${metadata.budgetTrack ?? 'exploratory'}` : null,
      reason: classificationKind === 'official' ? 'Created under the official protocol track.' : 'Exploratory runs are not included in official comparisons.',
    },
    validity: 'pending',
    isTest: metadata.isTest === true,
    status: 'created',
    startedAt: timestamp,
    updatedAt: timestamp,
    protocol: {
      version: protocol.version,
      manifest: path.relative(root, manifest).split(path.sep).join('/'),
      digest,
      rubricVersion: '3.0.0',
      selectionMode: protocol.selectionMode,
    },
    agent: {
      provider: metadata.provider ?? 'unknown',
      model: metadata.model.trim(),
      modelSnapshot: metadata.modelSnapshot ?? 'unknown',
      reasoning: metadata.reasoning ?? 'unspecified',
      agentVersion: metadata.agentVersion ?? 'unknown',
      toolBundle: metadata.toolBundle ?? 'unknown',
      orchestrationPolicy: 'run-nord-benchmark/v3',
      contextPolicy: 'fresh-agent-per-phase',
      responseModelIds: [],
    },
    environment: {
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      node: process.version,
      pnpm: commandOutput('pnpm', ['--version'], root),
      browser: metadata.browser ?? 'unavailable',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown',
      networkPolicy: metadata.networkPolicy ?? 'unknown',
    },
    budget: {
      track: metadata.budgetTrack ?? 'exploratory',
      limits: {
        wallTimeSeconds: metadata.wallTimeSeconds ?? null,
        inputTokens: metadata.inputTokens ?? null,
        outputTokens: metadata.outputTokens ?? null,
        costUsd: metadata.costUsd ?? null,
        implementationAttemptsPerPhase: metadata.implementationAttemptsPerPhase ?? 1,
        verifierRepairsPerPhase: metadata.verifierRepairsPerPhase ?? 2,
        subagents: metadata.subagents ?? null,
      },
    },
    source: gitSource(root),
    telemetry: emptyTelemetry(),
    stages: selected.map((number) => ({ number, status: 'queued', attempts: 0, startedAt: null, completedAt: null })),
  }
  const stageDir = path.join(locations.runs, id, 'stage1')
  fs.mkdirSync(stageDir, { recursive: true })
  saveRun(root, run)
  return { id, targetPhase, selectedPhases: selected, runDir: path.join(locations.runs, id), stageDir, run }
}

function isV3(run) {
  return run.schemaVersion === 3 && run.protocol?.version === '3.0.0'
}

function stageState(run, phase) {
  const state = run.stages.find((entry) => entry.number === phase)
  if (!state) throw new Error(`Phase ${phase} is not selected for run ${run.id}; target Phase ${run.targetPhase ?? 'legacy'}`)
  return state
}

function precedingStage(run, phase) {
  const index = run.stages.findIndex((entry) => entry.number === phase)
  return index > 0 ? run.stages[index - 1] : null
}

export function prepareStage(root, id, phaseValue) {
  const phase = Number(phaseValue)
  const run = loadRun(root, id)
  const current = stageState(run, phase)
  if (phase === 1) {
    if (!['queued', 'prepared'].includes(current.status)) throw new Error(`Phase 1 cannot be prepared from ${current.status}`)
    current.status = 'prepared'
    run.status = 'running'
    run.updatedAt = new Date().toISOString()
    saveRun(root, run)
    return { id, phase, stageDir: path.join(pathsFor(root).runs, id, 'stage1') }
  }
  const previous = precedingStage(run, phase)
  if (isV3(run) && previous?.status !== 'complete') throw new Error(`Phase ${phase - 1} must be complete before preparing Phase ${phase}`)
  if (!['queued', 'prepared'].includes(current.status)) throw new Error(`Phase ${phase} cannot be prepared from ${current.status}`)
  const runRoot = path.join(pathsFor(root).runs, id)
  const source = path.join(runRoot, `stage${phase - 1}`)
  const destination = path.join(runRoot, `stage${phase}`)
  if (!fs.existsSync(source)) throw new Error(`Missing source phase directory: ${source}`)
  if (fs.existsSync(destination)) throw new Error(`Destination already exists: ${destination}`)
  const excluded = new Set(['node_modules', 'dist', '.git', '.vite', 'evaluations', 'verifications'])
  fs.cpSync(source, destination, { recursive: true, filter: (item) => !excluded.has(path.basename(item)) })
  current.status = 'prepared'
  run.status = 'running'
  run.updatedAt = new Date().toISOString()
  saveRun(root, run)
  return { id, phase, source, stageDir: destination }
}

function verificationFor(root, run, phase) {
  const filePath = path.join(pathsFor(root).runs, run.id, 'verifications', `stage${phase}.json`)
  if (!fs.existsSync(filePath)) return null
  return { filePath, value: readJson(filePath) }
}

export function markStage(root, id, phaseValue, status, now = new Date()) {
  const phase = Number(phaseValue)
  const validStatuses = new Set(['queued', 'prepared', 'running', 'verifying', 'verified', 'complete', 'failed', 'invalid', 'budget-exceeded'])
  if (!validStatuses.has(status)) throw new Error(`Unknown phase status: ${status}`)
  const run = loadRun(root, id)
  const current = stageState(run, phase)
  const previous = precedingStage(run, phase)
  if (isV3(run)) {
    if (status === 'running') {
      if (previous && previous.status !== 'complete') throw new Error(`Phase ${previous.number} must be complete before Phase ${phase} starts`)
      if (!['queued', 'prepared', 'running', 'verifying', 'complete'].includes(current.status)) throw new Error(`Phase ${phase} cannot start from ${current.status}`)
      // Reopening a complete phase regenerates evidence for re-verification; it is not a new implementation attempt.
      const nextAttempts = (current.attempts ?? 0) + (['running', 'verifying', 'complete'].includes(current.status) ? 0 : 1)
      const allowedAttempts = run.budget?.limits?.implementationAttemptsPerPhase
      if (allowedAttempts && nextAttempts > allowedAttempts) throw new Error(`Phase ${phase} exceeds its ${allowedAttempts}-attempt implementation budget`)
      current.attempts = nextAttempts
      current.startedAt ??= now.toISOString()
    }
    if (status === 'verifying' && current.status !== 'running') throw new Error(`Phase ${phase} must be running before verification`)
    if (status === 'verified' || status === 'complete') {
      const verification = verificationFor(root, run, phase)
      if (!verification?.value.passed || !verification.value.artifactDigest) throw new Error(`Phase ${phase} requires a passing sealed verification before ${status}`)
      const currentDigest = hashTree(path.join(pathsFor(root).runs, id, `stage${phase}`)).digest
      if (currentDigest !== verification.value.artifactDigest) throw new Error(`Phase ${phase} changed after verification; verify again before ${status}`)
      current.verificationPath = path.relative(root, verification.filePath).split(path.sep).join('/')
      current.artifactDigest = verification.value.artifactDigest
    }
    if (status === 'complete' && !['running', 'verifying', 'verified'].includes(current.status)) throw new Error(`Phase ${phase} cannot complete from ${current.status}`)
  }
  current.status = status
  if (status === 'complete') current.completedAt = now.toISOString()
  if (status === 'failed') run.status = 'failed'
  else if (status === 'invalid') { run.status = 'invalid'; run.validity = 'invalid-technical' }
  else if (status === 'budget-exceeded') { run.status = 'budget-exceeded'; run.validity = 'budget-exceeded' }
  else if (run.stages.every((entry) => entry.status === 'complete')) { run.status = 'complete'; run.validity = 'valid' }
  else run.status = 'running'
  run.updatedAt = now.toISOString()
  saveRun(root, run)
  return run
}

export function recordRunTelemetry(root, id, options) {
  const run = loadRun(root, id)
  const known = ['wallTimeSeconds', 'inputTokens', 'outputTokens', 'reasoningTokens', 'costUsd', 'toolCalls', 'subagents', 'implementationAttempts', 'verifierRepairs']
  const values = Object.fromEntries(known.filter((key) => options[key] !== undefined).map((key) => [key, options[key]]))
  run.telemetry = recordMeasurement(run.telemetry, options.phase ? Number(options.phase) : null, values, options.kind ?? 'measured')
  if (options.phase) {
    run.telemetry = recomputeTotals(run.telemetry)
    run.telemetry.status = Object.keys(run.telemetry.phases).length >= run.stages.length ? 'complete' : 'partial'
  } else {
    run.telemetry.status = 'partial'
  }
  const limitPairs = [
    ['wallTimeSeconds', 'wallTimeSeconds'],
    ['inputTokens', 'inputTokens'],
    ['outputTokens', 'outputTokens'],
    ['costUsd', 'costUsd'],
  ]
  const exceeded = limitPairs.filter(([field, limit]) => {
    const used = run.telemetry.totals[field]?.value
    const maximum = run.budget?.limits?.[limit]
    return used !== null && used !== undefined && maximum !== null && maximum !== undefined && used > maximum
  })
  if (exceeded.length > 0) {
    run.status = 'budget-exceeded'
    run.validity = 'budget-exceeded'
    if (options.phase) {
      const stage = run.stages.find((entry) => entry.number === Number(options.phase))
      if (stage && stage.status !== 'complete') stage.status = 'budget-exceeded'
    }
  }
  run.updatedAt = new Date().toISOString()
  saveRun(root, run)
  return run.telemetry
}

export function recordAgentIdentity(root, id, options) {
  const run = loadRun(root, id)
  if (!run.agent) throw new Error('This legacy run does not have a protocol-v3 agent identity block')
  for (const [option, field] of [['provider', 'provider'], ['model', 'model'], ['modelSnapshot', 'modelSnapshot'], ['reasoning', 'reasoning'], ['agentVersion', 'agentVersion'], ['toolBundle', 'toolBundle']]) {
    if (options[option] !== undefined) run.agent[field] = String(options[option])
  }
  if (options.responseModelId) {
    const value = String(options.responseModelId)
    if (!run.agent.responseModelIds.includes(value)) run.agent.responseModelIds.push(value)
  }
  run.updatedAt = new Date().toISOString()
  saveRun(root, run)
  return run.agent
}

export function publishPhasePreviews(root, run, includeRootAlias = false) {
  const locations = pathsFor(root)
  const destination = path.join(locations.previews, run.id)
  const completed = run.stages.filter((entry) => entry.status === 'complete').map((entry) => entry.number)
  if (completed.length === 0) throw new Error('At least one phase must be complete before preview publication')
  fs.rmSync(destination, { recursive: true, force: true })
  fs.mkdirSync(destination, { recursive: true })
  const previews = {}
  for (const phase of completed) {
    const source = path.join(locations.runs, run.id, `stage${phase}`, 'dist')
    if (!fs.existsSync(path.join(source, 'index.html'))) throw new Error(`Missing Phase ${phase} build: ${path.join(source, 'index.html')}`)
    fs.cpSync(source, path.join(destination, `stage${phase}`), { recursive: true })
    previews[String(phase)] = `/previews/${run.id}/stage${phase}/index.html`
  }
  const latestPhase = Math.max(...completed)
  if (includeRootAlias) fs.cpSync(path.join(locations.runs, run.id, `stage${latestPhase}`, 'dist'), destination, { recursive: true })
  return { destination, latestPhase, previews }
}

export function previewRun(root, id) {
  const run = loadRun(root, id)
  const published = publishPhasePreviews(root, run)
  Object.assign(run, { previewPath: published.previews[String(published.latestPhase)], previewStage: published.latestPhase, previews: published.previews, updatedAt: new Date().toISOString() })
  saveRun(root, run)
  return run
}

export function publishRun(root, id) {
  const run = loadRun(root, id)
  if (!run.stages.every((entry) => entry.status === 'complete')) throw new Error('Every selected phase must be complete before publication')
  if (isV3(run) && run.classification?.kind === 'official' && !run.stages.every((entry) => entry.evaluation?.status === 'complete')) {
    throw new Error('Every selected phase of an official run must be evaluated before publication')
  }
  if (isV3(run) && run.classification?.kind === 'official' && run.agent.responseModelIds.length === 0) throw new Error('Official publication requires at least one verified response model ID')
  if (isV3(run) && run.classification?.kind === 'official' && run.telemetry?.status !== 'complete') throw new Error('Official publication requires complete per-phase telemetry')
  const published = publishPhasePreviews(root, run, true)
  Object.assign(run, { previewPath: published.previews[String(published.latestPhase)], previewStage: published.latestPhase, previews: published.previews, status: 'complete', validity: run.validity === 'pending' ? 'valid' : run.validity, updatedAt: new Date().toISOString() })
  saveRun(root, run)
  return { id, previewPath: run.previewPath, previews: run.previews, destination: published.destination }
}

export function finishPartialRun(root, id) {
  const run = previewRun(root, id)
  if (run.stages.some((entry) => ['running', 'verifying'].includes(entry.status))) throw new Error('A running phase must finish or fail before ending a partial run')
  run.status = 'partial'
  run.validity = 'incomplete'
  run.classification = { kind: run.classification?.kind ?? 'exploratory', comparable: false, comparisonGroup: null, reason: 'Partial runs are not official comparison results.' }
  run.updatedAt = new Date().toISOString()
  saveRun(root, run)
  return run
}

export function reindexRegistry(root) {
  const locations = pathsFor(root)
  const runs = fs.existsSync(locations.runs)
    ? fs.readdirSync(locations.runs, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
      const runPath = path.join(locations.runs, entry.name, 'run.json')
      if (!fs.existsSync(runPath)) return []
      const run = readJson(runPath)
      if (!run.classification) {
        run.classification = { kind: 'legacy', comparable: false, comparisonGroup: null, reason: 'Predates explicit Stagebench v3 classification.' }
        run.validity ??= 'legacy-unverified'
      }
      return [run]
    })
    : []
  runs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || a.id.localeCompare(b.id))
  writeJson(locations.registry, runs)
  return { count: runs.length, ids: runs.map((run) => run.id), registry: locations.registry }
}

export function retargetRun(root, id, targetPhaseValue) {
  const targetPhase = Number(targetPhaseValue)
  const run = loadRun(root, id)
  if (!isV3(run)) throw new Error('retarget requires a protocol v3 run')
  if (!Number.isInteger(targetPhase) || targetPhase <= (run.targetPhase ?? 0)) {
    throw new Error(`retarget only extends a run upward; current target is Phase ${run.targetPhase}`)
  }
  const { value: protocol } = loadProtocol(root)
  const selected = selectedPhases(protocol, targetPhase)
  run.targetPhase = targetPhase
  run.selectedPhases = selected
  for (const number of selected) {
    if (!run.stages.some((stage) => stage.number === number)) {
      run.stages.push({ number, status: 'queued', attempts: 0, startedAt: null, completedAt: null })
    }
  }
  run.stages.sort((a, b) => a.number - b.number)
  if (run.status === 'complete' || run.status === 'published') run.status = 'running'
  run.updatedAt = new Date().toISOString()
  saveRun(root, run)
  return { id, targetPhase, selectedPhases: selected, stages: run.stages.map(({ number, status }) => ({ number, status })) }
}

export function resumePlan(root, id) {
  const run = loadRun(root, id)
  const stage = run.stages.find((entry) => entry.status !== 'complete')
  if (!stage) return { id, complete: true, next: run.classification?.kind === 'official' ? 'evaluate/publish any missing phase evaluations' : 'publish' }
  const next = {
    queued: `prepare Phase ${stage.number}`,
    prepared: `open/create the Phase ${stage.number} isolated bundle and mark running`,
    running: `continue Phase ${stage.number}, capture, then verify`,
    verifying: `finish verification for Phase ${stage.number}`,
    verified: `mark Phase ${stage.number} complete`,
    failed: `inspect the recorded failure; start a new attempt only within budget`,
    invalid: `the phase is invalid and cannot resume as the same official attempt`,
    'budget-exceeded': `the phase exceeded budget and cannot resume as the same official attempt`,
  }[stage.status]
  return { id, complete: false, phase: stage.number, status: stage.status, next }
}

export function archiveRunCaches(root, id) {
  const run = loadRun(root, id)
  if (run.stages.some((entry) => ['running', 'verifying'].includes(entry.status))) throw new Error('Cannot archive caches while a phase is running or verifying')
  let removedBytes = 0
  const removed = []
  for (const stage of run.stages) {
    const stageDir = path.join(pathsFor(root).runs, id, `stage${stage.number}`)
    for (const name of ['node_modules', '.vite']) {
      const target = path.join(stageDir, name)
      if (!fs.existsSync(target)) continue
      const sizeOf = (current) => fs.statSync(current).isDirectory()
        ? fs.readdirSync(current).reduce((sum, entry) => sum + sizeOf(path.join(current, entry)), 0)
        : fs.statSync(current).size
      removedBytes += sizeOf(target)
      fs.rmSync(target, { recursive: true, force: true })
      removed.push(path.relative(root, target).split(path.sep).join('/'))
    }
  }
  run.archivedAt = new Date().toISOString()
  run.cacheArchive = { removed, removedBytes }
  run.updatedAt = run.archivedAt
  saveRun(root, run)
  return { id, removed, removedBytes }
}

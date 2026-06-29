#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const VALID_STATUSES = new Set(['queued', 'running', 'complete', 'failed'])

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index]
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`)
    const key = token.slice(2)
    const value = rest[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
    options[key] = value
    index += 1
  }
  return { command, options }
}

function findRepoRoot(start = process.cwd()) {
  let current = path.resolve(start)
  while (true) {
    if (fs.existsSync(path.join(current, 'BENCHMARK.md')) && fs.existsSync(path.join(current, 'package.json'))) return current
    const parent = path.dirname(current)
    if (parent === current) throw new Error('Could not find a repository containing BENCHMARK.md and package.json')
    current = parent
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.tmp`
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(temporaryPath, filePath)
}

function slugify(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'model'
}

function pathsFor(root) {
  return {
    registry: path.join(root, 'src', 'data', 'runs.json'),
    runs: path.join(root, 'runs'),
    previews: path.join(root, 'public', 'previews'),
  }
}

function saveRun(root, run) {
  const locations = pathsFor(root)
  const registry = readJson(locations.registry, [])
  const next = registry.some((entry) => entry.id === run.id)
    ? registry.map((entry) => entry.id === run.id ? run : entry)
    : [run, ...registry]
  writeJson(locations.registry, next)
  writeJson(path.join(locations.runs, run.id, 'run.json'), run)
}

function loadRun(root, id) {
  if (!id) throw new Error('--id is required')
  const runPath = path.join(pathsFor(root).runs, id, 'run.json')
  if (!fs.existsSync(runPath)) throw new Error(`Unknown run: ${id}`)
  return readJson(runPath)
}

function createRun(root, model, now = new Date(), metadata = {}) {
  if (!model?.trim()) throw new Error('--model is required')
  const locations = pathsFor(root)
  const base = slugify(model.trim())
  let id = base
  let suffix = 2
  while (fs.existsSync(path.join(locations.runs, id))) id = `${base}-${suffix++}`
  const timestamp = now.toISOString()
  const run = {
    benchmarkVersion: '2.0.0',
    id,
    model: model.trim(),
    title: metadata.title?.trim() || model.trim(),
    isTest: metadata.isTest === true,
    status: 'running',
    startedAt: timestamp,
    updatedAt: timestamp,
    stages: [1, 2, 3, 4].map((number) => ({ number, status: 'queued' })),
  }
  const stageDir = path.join(locations.runs, id, 'stage1')
  fs.mkdirSync(stageDir, { recursive: true })
  saveRun(root, run)
  return { id, model: run.model, title: run.title, isTest: run.isTest, runDir: path.join(locations.runs, id), stageDir }
}

function publishPhasePreviews(root, run, includeRootAlias = false) {
  const locations = pathsFor(root)
  const destination = path.join(locations.previews, run.id)
  const completedPhases = run.stages.filter((entry) => entry.status === 'complete').map((entry) => entry.number)
  const previews = {}

  fs.rmSync(destination, { recursive: true, force: true })
  fs.mkdirSync(destination, { recursive: true })

  for (const phase of completedPhases) {
    const source = path.join(locations.runs, run.id, `stage${phase}`, 'dist')
    const indexFile = path.join(source, 'index.html')
    if (!fs.existsSync(indexFile)) throw new Error(`Missing Phase ${phase} build: ${indexFile}`)
    fs.cpSync(source, path.join(destination, `stage${phase}`), { recursive: true })
    previews[String(phase)] = `/previews/${run.id}/stage${phase}/index.html`
  }

  const latestPhase = Math.max(...completedPhases)
  if (includeRootAlias) {
    fs.cpSync(path.join(locations.runs, run.id, `stage${latestPhase}`, 'dist'), destination, { recursive: true })
  }

  return { destination, latestPhase, previews }
}

function markStage(root, id, stageNumber, status, now = new Date()) {
  const stage = Number(stageNumber)
  if (![1, 2, 3, 4].includes(stage)) throw new Error('--phase must be 1, 2, 3, or 4')
  if (!VALID_STATUSES.has(status)) throw new Error('--status must be queued, running, complete, or failed')
  const run = loadRun(root, id)
  run.stages = run.stages.map((entry) => entry.number === stage ? { ...entry, status } : entry)
  run.updatedAt = now.toISOString()
  if (status === 'failed') run.status = 'failed'
  else if (run.stages.every((entry) => entry.status === 'complete')) run.status = 'complete'
  else run.status = 'running'
  saveRun(root, run)
  return run
}

function prepareStage(root, id, stageNumber) {
  const stage = Number(stageNumber)
  if (![2, 3, 4].includes(stage)) throw new Error('prepare --phase must be 2, 3, or 4')
  loadRun(root, id)
  const runRoot = path.join(pathsFor(root).runs, id)
  const source = path.join(runRoot, `stage${stage - 1}`)
  const destination = path.join(runRoot, `stage${stage}`)
  if (!fs.existsSync(source)) throw new Error(`Missing source phase directory: ${source}`)
  if (fs.existsSync(destination)) throw new Error(`Destination already exists: ${destination}`)
  const excluded = new Set(['node_modules', 'dist', '.git', '.vite'])
  fs.cpSync(source, destination, { recursive: true, filter: (item) => !excluded.has(path.basename(item)) })
  return { id, stage, source, stageDir: destination }
}

function publishRun(root, id, now = new Date()) {
  const run = loadRun(root, id)
  if (!run.stages.every((entry) => entry.status === 'complete')) throw new Error('All four phases must be complete before publishing')
  const { destination, latestPhase, previews } = publishPhasePreviews(root, run, true)
  run.previewPath = previews[String(latestPhase)]
  run.previewStage = latestPhase
  run.previews = previews
  run.status = 'complete'
  run.updatedAt = now.toISOString()
  saveRun(root, run)
  return { id, previewPath: run.previewPath, previews, destination }
}

function finishPartialRun(root, id, now = new Date()) {
  const run = loadRun(root, id)
  if (!run.stages.some((entry) => entry.status === 'complete')) {
    throw new Error('At least one phase must be complete before finishing a partial run')
  }
  if (run.stages.some((entry) => entry.status === 'running')) {
    throw new Error('A running phase must be completed or failed before finishing a partial run')
  }
  const { latestPhase, previews } = publishPhasePreviews(root, run)
  run.status = 'partial'
  run.previewPath = previews[String(latestPhase)]
  run.previewStage = latestPhase
  run.previews = previews
  run.updatedAt = now.toISOString()
  saveRun(root, run)
  return run
}

function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-run-manager-'))
  try {
    fs.mkdirSync(path.join(root, 'src', 'data'), { recursive: true })
    fs.writeFileSync(path.join(root, 'BENCHMARK.md'), '# Test\n')
    fs.writeFileSync(path.join(root, 'package.json'), '{}\n')
    writeJson(path.join(root, 'src', 'data', 'runs.json'), [])
    const created = createRun(root, 'Model / Test', new Date('2026-01-01T00:00:00.000Z'))
    assert.equal(created.id, 'model-test')
    fs.writeFileSync(path.join(created.stageDir, 'artifact.txt'), 'stage one')
    fs.mkdirSync(path.join(created.stageDir, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(created.stageDir, 'dist', 'index.html'), '<h1>phase one</h1>')
    markStage(root, created.id, 1, 'complete')
    prepareStage(root, created.id, 2)
    assert.equal(fs.readFileSync(path.join(root, 'runs', created.id, 'stage2', 'artifact.txt'), 'utf8'), 'stage one')
    fs.mkdirSync(path.join(root, 'runs', created.id, 'stage2', 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, 'runs', created.id, 'stage2', 'dist', 'index.html'), '<h1>phase two</h1>')
    markStage(root, created.id, 2, 'complete')
    prepareStage(root, created.id, 3)
    fs.mkdirSync(path.join(root, 'runs', created.id, 'stage3', 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, 'runs', created.id, 'stage3', 'dist', 'index.html'), '<h1>phase three</h1>')
    markStage(root, created.id, 3, 'complete')
    prepareStage(root, created.id, 4)
    fs.mkdirSync(path.join(root, 'runs', created.id, 'stage4', 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, 'runs', created.id, 'stage4', 'dist', 'index.html'), '<h1>ok</h1>')
    markStage(root, created.id, 4, 'complete')
    const published = publishRun(root, created.id)
    assert.equal(published.previewPath, '/previews/model-test/stage4/index.html')
    assert.deepEqual(Object.keys(published.previews), ['1', '2', '3', '4'])
    assert.ok(fs.existsSync(path.join(root, 'public', 'previews', created.id, 'index.html')))
    assert.equal(readJson(path.join(root, 'src', 'data', 'runs.json'))[0].status, 'complete')
    const partial = createRun(root, 'Partial Model')
    fs.mkdirSync(path.join(partial.stageDir, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(partial.stageDir, 'dist', 'index.html'), '<h1>partial</h1>')
    markStage(root, partial.id, 1, 'complete')
    const partialRun = finishPartialRun(root, partial.id)
    assert.equal(partialRun.status, 'partial')
    assert.equal(partialRun.previewStage, 1)
    assert.ok(fs.existsSync(path.join(root, 'public', 'previews', partial.id, 'stage1', 'index.html')))
    return { ok: true, checks: 12 }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function printHelp() {
  console.log(`Usage:
  manage-run.mjs create --model "model-id" [--title "Display title"] [--test true]
  manage-run.mjs mark --id <run-id> --phase <1|2|3|4> --status <queued|running|complete|failed>
  manage-run.mjs prepare --id <run-id> --phase <2|3|4>
  manage-run.mjs partial --id <run-id>
  manage-run.mjs publish --id <run-id>
  manage-run.mjs self-test`)
}

try {
  const { command, options } = parseArgs(process.argv.slice(2))
  const root = command === 'self-test' ? undefined : findRepoRoot(options.root)
  let result
  if (command === 'create') result = createRun(root, options.model, undefined, { title: options.title, isTest: options.test === 'true' })
  else if (command === 'mark') result = markStage(root, options.id, options.phase ?? options.stage, options.status)
  else if (command === 'prepare') result = prepareStage(root, options.id, options.phase ?? options.stage)
  else if (command === 'partial') result = finishPartialRun(root, options.id)
  else if (command === 'publish') result = publishRun(root, options.id)
  else if (command === 'self-test') result = selfTest()
  else { printHelp(); process.exitCode = command ? 1 : 0 }
  if (result) console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`manage-run: ${error.message}`)
  process.exitCode = 1
}

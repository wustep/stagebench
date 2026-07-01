import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { readJson, writeJson } from './cli.mjs'
import { hashFile, hashTree } from './protocol.mjs'
import { loadRun } from './run-store.mjs'

const COPY_EXCLUDES = new Set(['node_modules', 'dist', '.git', '.vite', 'evaluations', 'verifications'])

function copyTree(source, destination) {
  if (!fs.existsSync(source)) return
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: false,
    filter: (entry) => !COPY_EXCLUDES.has(path.basename(entry)),
  })
}

function copyInput(root, relativePath, inputRoot) {
  const source = path.resolve(root, relativePath)
  if (!source.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Input escapes repository: ${relativePath}`)
  if (!fs.existsSync(source)) throw new Error(`Missing phase input: ${relativePath}`)
  const destination = path.join(inputRoot, relativePath)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
  return { path: relativePath, sha256: hashFile(source), bytes: fs.statSync(source).size }
}

export function createPhaseBundle(root, id, phaseValue, options = {}) {
  const phase = Number(phaseValue)
  const run = loadRun(root, id)
  if (!run.selectedPhases?.includes(phase)) throw new Error(`Phase ${phase} is not selected for ${id}`)
  const protocol = readJson(path.join(root, 'specs', 'benchmark-phases.json'))
  const contract = protocol.phases.find((entry) => entry.number === phase)
  if (!contract) throw new Error(`Missing Phase ${phase} protocol contract`)
  const workspace = path.join(root, '.stagebench', 'workspaces', id, `phase${phase}`)
  if (fs.existsSync(workspace) && options.force !== true) throw new Error(`Bundle already exists: ${workspace}; pass --force true to replace it`)
  fs.rmSync(workspace, { recursive: true, force: true })
  const candidate = path.join(workspace, 'candidate')
  const inputs = path.join(workspace, 'inputs')
  fs.mkdirSync(candidate, { recursive: true })
  fs.mkdirSync(inputs, { recursive: true })

  const stageSource = path.join(root, 'runs', id, `stage${phase}`)
  const starter = path.join(root, 'benchmark', 'starter')
  if (phase === 1 && fs.readdirSync(stageSource).length === 0 && fs.existsSync(starter)) copyTree(starter, candidate)
  else copyTree(stageSource, candidate)

  const files = [
    'BENCHMARK.md',
    'TESTING.md',
    'specs/benchmark-phases.json',
    'specs/nord-stage-4.variants.json',
    'schemas/feature-matrix.schema.json',
    'schemas/implementation-details.schema.json',
    'schemas/capture.schema.json',
    contract.prompt,
    ...contract.specs,
  ]
  const referenceRegistry = readJson(path.join(root, 'specs', 'nord-stage-4.variants.json'))
  const variant = referenceRegistry.variants.find((entry) => entry.id === run.variant)
  if (!variant) throw new Error(`Unknown run variant: ${run.variant}`)
  for (const reference of [protocol.manual.path, variant.referenceImage]) {
    if (fs.existsSync(path.join(root, reference))) files.push(reference)
  }
  const manifestFiles = [...new Set(files)].map((file) => copyInput(root, file, inputs))
  const manifest = {
    version: 1,
    runBlindLabel: `candidate-${run.protocol?.digest?.slice(0, 8) ?? 'legacy'}`,
    phase,
    variant: run.variant,
    protocolVersion: run.protocol?.version ?? run.benchmarkVersion,
    networkPolicy: run.environment?.networkPolicy ?? 'unknown',
    candidateDirectory: 'candidate',
    inputDirectory: 'inputs',
    futurePromptsIncluded: false,
    priorSolutionsIncluded: false,
    files: manifestFiles,
    createdAt: new Date().toISOString(),
  }
  writeJson(path.join(workspace, 'bundle-manifest.json'), manifest)
  const candidateHash = hashTree(candidate)
  return { workspace, candidate, inputs, manifest: path.join(workspace, 'bundle-manifest.json'), candidateHash }
}

export function importPhaseBundle(root, id, phaseValue) {
  const phase = Number(phaseValue)
  const run = loadRun(root, id)
  const stage = run.stages.find((entry) => entry.number === phase)
  if (!stage || stage.status !== 'running') throw new Error(`Phase ${phase} must be running before importing candidate output`)
  const workspace = path.join(root, '.stagebench', 'workspaces', id, `phase${phase}`)
  const candidate = path.join(workspace, 'candidate')
  const bundleManifest = path.join(workspace, 'bundle-manifest.json')
  if (!fs.existsSync(candidate) || !fs.existsSync(bundleManifest)) throw new Error(`Missing isolated Phase ${phase} bundle`)
  const destination = path.join(root, 'runs', id, `stage${phase}`)
  const temporary = `${destination}.importing`
  fs.rmSync(temporary, { recursive: true, force: true })
  fs.mkdirSync(temporary, { recursive: true })
  copyTree(candidate, temporary)
  const imported = hashTree(temporary)
  fs.rmSync(destination, { recursive: true, force: true })
  fs.renameSync(temporary, destination)
  return {
    id,
    phase,
    destination,
    candidateDigest: imported.digest,
    candidateFiles: imported.files,
    bundleManifest,
  }
}

export function runInContainer(root, id, phaseValue, command, options = {}) {
  const phase = Number(phaseValue)
  const workspace = path.join(root, '.stagebench', 'workspaces', id, `phase${phase}`)
  const candidate = path.join(workspace, 'candidate')
  const inputs = path.join(workspace, 'inputs')
  if (!fs.existsSync(candidate) || !fs.existsSync(inputs)) throw new Error('Create the isolated phase bundle before executing it')
  if (!command?.length) throw new Error('A command is required after --command')
  const image = options.image ?? 'node:24-bookworm-slim'
  const network = options.network === 'registry-only' ? 'bridge' : 'none'
  const args = [
    'run', '--rm', '--init', `--network=${network}`,
    '--memory=4g', '--cpus=2',
    '--mount', `type=bind,source=${candidate},target=/workspace/candidate`,
    '--mount', `type=bind,source=${inputs},target=/workspace/inputs,readonly`,
    '--workdir', '/workspace/candidate',
    image,
    'sh', '-lc', command,
  ]
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', stdio: options.inherit ? 'inherit' : 'pipe' })
  if (result.error) throw new Error(`Docker execution failed: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Sandboxed command failed with exit ${result.status}: ${result.stderr || result.stdout || ''}`)
  return { ok: true, image, network, command }
}

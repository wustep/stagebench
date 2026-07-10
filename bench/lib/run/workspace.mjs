// Isolated per-phase workspaces. A candidate agent works in
// .stagebench/work/<id>/stage<N>/candidate with read-only-intended inputs
// beside it, and never sees runs/, other solutions, future phase details,
// unassigned variants, or scoring materials.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { hashTree, loadProtocol, readJson, workspaceRoot, writeJson } from '../shared.mjs'
import { filterTaskToPhase, projectProtocol, projectVariants } from '../materials.mjs'
import { loadRun, markRunning, nextPhase, stageDirFor } from './store.mjs'

const COPY_EXCLUDES = new Set(['node_modules', 'dist', '.git', '.vite', 'evaluations', 'verifications'])

function copyTree(source, destination) {
  if (!fs.existsSync(source)) return
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: false,
    filter: (entry) => !COPY_EXCLUDES.has(path.basename(entry)),
  })
}

export function workspaceDir(root, id, phase) {
  return path.join(workspaceRoot(root, 'work'), id, `stage${phase}`)
}

function copyInput(root, relativePath, inputRoot) {
  const source = path.resolve(root, relativePath)
  if (!source.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Input escapes repository: ${relativePath}`)
  if (!fs.existsSync(source)) throw new Error(`Missing phase input: ${relativePath}`)
  const destination = path.join(inputRoot, relativePath)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
  return relativePath
}

// Create (or reuse) the workspace for the run's next phase and mark it
// running. Phase 1 starts from bench/starter; later phases start from the
// preceding sealed artifact.
export function startPhase(root, id) {
  const run = loadRun(root, id)
  const stage = nextPhase(run)
  if (!stage) throw new Error(`${id} has no remaining phases; run pnpm bench score ${id}`)
  const phase = stage.number
  const workspace = workspaceDir(root, id, phase)
  const candidate = path.join(workspace, 'candidate')
  const inputs = path.join(workspace, 'inputs')
  const { value: protocol } = loadProtocol(root)
  const contract = protocol.phases.find((entry) => entry.number === phase)

  if (stage.status === 'running' && fs.existsSync(candidate)) {
    return { id, phase, workspace, candidate, inputs, prompt: path.join(inputs, contract.prompt), reused: true }
  }

  fs.rmSync(workspace, { recursive: true, force: true })
  fs.mkdirSync(candidate, { recursive: true })
  fs.mkdirSync(inputs, { recursive: true })

  const source = phase === 1 ? path.join(root, 'bench', 'starter') : stageDirFor(root, id, phase - 1)
  if (phase > 1 && !fs.existsSync(source)) throw new Error(`Missing sealed Phase ${phase - 1} artifact: ${source}`)
  copyTree(source, candidate)

  const variants = readJson(path.join(root, 'specs', 'nord-stage-4.variants.json'))
  const variant = variants.variants.find((entry) => entry.id === run.variant)
  if (!variant) throw new Error(`Unknown run variant: ${run.variant}`)
  const files = [
    'bench/schemas/implementation-details.schema.json',
    contract.prompt,
    ...contract.specs,
  ]
  for (const reference of [protocol.manual.path, variant.referenceImage]) {
    if (fs.existsSync(path.join(root, reference))) files.push(reference)
  }
  const copied = [...new Set(files)].map((file) => copyInput(root, file, inputs))
  // Generated projections: the task and phase manifest filtered to phases ≤
  // the current one, and only the assigned variant.
  fs.writeFileSync(path.join(inputs, 'TASK.md'), filterTaskToPhase(fs.readFileSync(path.join(root, 'TASK.md'), 'utf8'), phase))
  writeJson(path.join(inputs, 'specs', 'benchmark-phases.json'), projectProtocol(protocol, phase, run.variant))
  writeJson(path.join(inputs, 'specs', 'nord-stage-4.variants.json'), projectVariants(variants, run.variant))
  writeJson(path.join(workspace, 'workspace.json'), {
    version: 1,
    runId: id,
    phase,
    variant: run.variant,
    protocolVersion: protocol.version,
    inputs: [...copied, 'TASK.md', 'specs/benchmark-phases.json', 'specs/nord-stage-4.variants.json'].sort(),
    createdAt: new Date().toISOString(),
  })
  fs.writeFileSync(path.join(workspace, 'WORKSPACE.md'), [
    `# Stagebench Phase ${phase} workspace — ${id}`,
    '',
    `Implement Phase ${phase} inside \`candidate/\` only. Everything you need is in \`inputs/\`:`,
    '',
    `1. Read \`inputs/${contract.prompt}\` — the phase instructions.`,
    `2. Read \`inputs/TASK.md\` and the assigned specs under \`inputs/specs/\`.`,
    `3. Variant: **${variant.label}** (\`inputs/${variant.referenceImage}\` if fetched).`,
    '',
    'Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` inside `candidate/` before finishing.',
    `When done, the operator runs \`pnpm bench seal ${id}\` from the repository.`,
    '',
  ].join('\n'))

  markRunning(root, id, phase)
  return { id, phase, workspace, candidate, inputs, prompt: path.join(inputs, contract.prompt), reused: false }
}

// Copy the candidate's output back into runs/<id>/stage<N> atomically.
export function importWorkspace(root, id, phase) {
  const workspace = workspaceDir(root, id, phase)
  const candidate = path.join(workspace, 'candidate')
  if (!fs.existsSync(candidate)) throw new Error(`Missing Phase ${phase} workspace: ${candidate}. Run pnpm bench start ${id} first.`)
  const destination = stageDirFor(root, id, phase)
  const temporary = `${destination}.importing`
  fs.rmSync(temporary, { recursive: true, force: true })
  fs.mkdirSync(temporary, { recursive: true })
  copyTree(candidate, temporary)
  const imported = hashTree(temporary)
  fs.rmSync(destination, { recursive: true, force: true })
  fs.renameSync(temporary, destination)
  return { id, phase, destination, candidateDigest: imported.digest, candidateFiles: imported.files }
}

export function removeWorkspace(root, id, phase) {
  fs.rmSync(workspaceDir(root, id, phase), { recursive: true, force: true })
}

// Run a command inside the phase workspace in a Docker sandbox: the candidate
// directory is writable, the inputs are read-only, the host repository is not
// mounted, and the network is off unless the registry track is requested.
export function runInContainer(root, id, phase, command, options = {}) {
  const workspace = workspaceDir(root, id, phase)
  const candidate = path.join(workspace, 'candidate')
  const inputs = path.join(workspace, 'inputs')
  if (!fs.existsSync(candidate) || !fs.existsSync(inputs)) throw new Error(`Missing Phase ${phase} workspace; run pnpm bench start ${id} first`)
  if (!command?.length) throw new Error('A command is required after --command')
  const image = options.image ?? 'node:24-bookworm-slim'
  const network = options.network === 'registry' ? 'bridge' : 'none'
  const args = [
    'run', '--rm', '--init', `--network=${network}`,
    '--memory=16g', '--cpus=8',
    '--mount', `type=bind,source=${candidate},target=/workspace/candidate`,
    '--mount', `type=bind,source=${inputs},target=/workspace/inputs,readonly`,
    '--workdir', '/workspace/candidate',
    image,
    'sh', '-lc', command,
  ]
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', stdio: 'inherit' })
  if (result.error) throw new Error(`Docker execution failed: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`Sandboxed command failed with exit ${result.status}`)
  return { ok: true, image, network, command }
}

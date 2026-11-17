// Isolated per-phase workspaces. A candidate agent works in
// .stagebench/work/<id>/stage<N>/candidate with read-only-intended inputs
// beside it, and never sees runs/, other solutions, future phase details,
// unassigned variants, or scoring materials.
import fs from 'node:fs'
import path from 'node:path'
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

// The phase prompts tell candidates to "use the parent capture harness". That
// harness lives in bench/, which a candidate must never read — and inside the
// lockdown cannot. So a self-contained copy travels with the inputs: the same
// capture code, with its one harness import inlined.
const CAPTURE_HARNESS_IMPORT = "import { writeJson } from '../shared.mjs'\n"
const CAPTURE_HARNESS_INLINE = [
  '// Self-contained copy of the benchmark capture harness, shipped in inputs/harness/.',
  'function writeJson(filePath, value) {',
  '  fs.mkdirSync(path.dirname(filePath), { recursive: true })',
  "  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\\n`)",
  '}',
  '',
].join('\n')

export function captureHarnessSource() {
  // The harness's own copy, beside this module — what seal itself runs.
  const source = fs.readFileSync(path.join(import.meta.dirname, 'capture.mjs'), 'utf8')
  if (!source.includes(CAPTURE_HARNESS_IMPORT)) throw new Error('bench/lib/run/capture.mjs no longer imports only writeJson from shared.mjs; update captureHarnessSource so the shipped copy stays self-contained')
  const shipped = source.replace(CAPTURE_HARNESS_IMPORT, CAPTURE_HARNESS_INLINE)
  if (/from '\.\.?\//.test(shipped)) throw new Error('The shipped capture harness still has a relative import')
  return shipped
}

// One command for a candidate to run the canonical capture against its own
// build. It loads Playwright from the candidate's dependencies (this file sits
// outside the candidate's node_modules) and writes where the verifier looks.
const CAPTURE_COMMAND = `#!/usr/bin/env node
// Canonical evidence capture for a candidate build.
//
//   cd candidate && pnpm build && node ../inputs/harness/capture-evidence.mjs --phase <N>
//
// Serves ./dist and writes, into ./evidence/:
//   stage<N>-desktop.png (1440x900), stage<N>-narrow.png (390x844), stage<N>-capture.json
// Needs \`playwright\` in the candidate's devDependencies.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { captureEvidence, serveDirectory } from './capture.mjs'

const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(\`--\${name}\`) ? args[args.indexOf(\`--\${name}\`) + 1] : fallback)
const phase = Number(option('phase'))
const dist = path.resolve(option('dist', 'dist'))
const out = path.resolve(option('out', 'evidence'))
if (![1, 2, 3].includes(phase)) {
  console.error('usage: node ../inputs/harness/capture-evidence.mjs --phase <1|2|3> [--dist dist] [--out evidence]')
  process.exit(2)
}
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error(\`No build at \${dist}; run pnpm build first.\`)
  process.exit(1)
}
let chromium
try {
  ;({ chromium } = createRequire(path.join(process.cwd(), 'package.json'))('playwright'))
} catch {
  console.error('Playwright is not installed here. Add it to the candidate: pnpm add -D playwright')
  process.exit(1)
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-'))
const server = await serveDirectory(dist)
try {
  await captureEvidence(scratch, { id: 'local', phase, url: server.url, chromium })
} finally {
  await server.close()
}
const produced = path.join(scratch, 'runs', 'local', \`stage\${phase}\`, 'evidence')
fs.mkdirSync(out, { recursive: true })
for (const name of fs.readdirSync(produced)) {
  fs.copyFileSync(path.join(produced, name), path.join(out, name))
  console.log(path.relative(process.cwd(), path.join(out, name)))
}
fs.rmSync(scratch, { recursive: true, force: true })
`

function writeCaptureHarness(inputRoot) {
  const directory = path.join(inputRoot, 'harness')
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(directory, 'capture.mjs'), captureHarnessSource())
  fs.writeFileSync(path.join(directory, 'capture-evidence.mjs'), CAPTURE_COMMAND)
  fs.writeFileSync(path.join(directory, 'README.md'), [
    '# Capture harness',
    '',
    'This is the benchmark\'s canonical screenshot harness: the "parent capture harness" the phase prompt refers to.',
    'It is the same code the operator runs at seal time, which re-captures the canonical evidence under its own control',
    'whatever is produced here.',
    '',
    'From `candidate/`, after a build, with `playwright` in your dev dependencies:',
    '',
    '```sh',
    'node ../inputs/harness/capture-evidence.mjs --phase <N>',
    '```',
    '',
    'It serves `dist/` and writes `evidence/stage<N>-desktop.png`, `evidence/stage<N>-narrow.png`, and',
    '`evidence/stage<N>-capture.json`. Phase evidence lives in `evidence/` at the top of `candidate/`; your',
    '`stage<N>-visual-audit.md` goes there too.',
    '',
    '`capture.mjs` is the library behind the command (`captureEvidence`, `serveDirectory`) if you want to drive it yourself.',
    '',
  ].join('\n'))
  return ['harness/README.md', 'harness/capture-evidence.mjs', 'harness/capture.mjs']
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
  copied.push(...writeCaptureHarness(inputs))
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
    // The candidate is not told which run it is: a run id is a model slug, and
    // anything the candidate writes into its artifact reaches the grader.
    `# Stagebench Phase ${phase} workspace`,
    '',
    `Implement Phase ${phase} inside \`candidate/\` only. Everything you need is in \`inputs/\`:`,
    '',
    `1. Read \`inputs/${contract.prompt}\` — the phase instructions.`,
    `2. Read \`inputs/TASK.md\` and the assigned specs under \`inputs/specs/\`.`,
    `3. Variant: **${variant.label}** (\`inputs/${variant.referenceImage}\` if fetched).`,
    '4. The capture harness the prompt refers to: from `candidate/`, run `node ../inputs/harness/capture-evidence.mjs --phase ' + phase + '` after a build. Evidence lives in `candidate/evidence/` (see `inputs/harness/README.md`).',
    '',
    'Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` inside `candidate/` before finishing.',
    'When done, the operator seals the phase.',
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

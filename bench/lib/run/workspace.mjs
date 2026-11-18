// Isolated per-phase workspaces. A candidate agent works in
// .stagebench/work/<id>/stage<N>/candidate with read-only-intended inputs
// beside it, and never sees runs/, other solutions, future phase details,
// unassigned variants, or scoring materials.
import fs from 'node:fs'
import path from 'node:path'
import { hashTree, isStrictProtocol, loadProtocol, readJson, workspaceRoot, writeJson } from '../shared.mjs'
import { filterTaskToPhase, projectProtocol, projectVariants } from '../materials.mjs'
import { loadSamplePack, materializeSamplePack } from '../sample-pack.mjs'
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

// The phase prompts tell candidates to use the capture harness. The harness's
// own copy lives in bench/, which a candidate must never read — and inside the
// lockdown cannot — and two thirds of the audited candidates went looking for
// it in the repository. So a self-contained copy travels with the inputs: the
// same capture code, with its one harness import inlined. Nothing in the
// candidate's materials points at the parent repository.
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
    'This is the benchmark\'s canonical screenshot harness: the capture harness the phase prompt refers to.',
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

// The phase's hard gates as a block to paste. The seal looks for every gate
// sentence word for word, and candidates paraphrased them often enough that
// operators ended up pasting the text in by hand. Now it ships ready-made.
export function hardGatesDocument(contract) {
  return [
    `# Phase ${contract.number} hard gates`,
    '',
    'Paste the checklist below into `IMPLEMENTATION_PLAN.md` exactly as it is. The seal checks that every sentence',
    'appears there word for word (line wrapping does not matter; rewording does), and that the plan names each',
    'assigned spec file.',
    '',
    '```markdown',
    `## Phase ${contract.number} hard gates`,
    '',
    ...(contract.hardGates ?? []).map((gate) => `- [ ] ${gate}`),
    '',
    `Assigned specs: ${contract.specs.map((spec) => `\`${path.basename(spec)}\``).join(', ')}`,
    '```',
    '',
  ].join('\n')
}

// What a candidate in the lockdown can install, said once and up front.
function offlineDocument() {
  const lockPath = path.join(import.meta.dirname, '..', '..', 'lockdown', 'image', 'npm-mirror.lock.json')
  if (!fs.existsSync(lockPath)) return null
  const lock = readJson(lockPath)
  const requested = Object.keys(lock.requested ?? {}).sort()
  return [
    '# This workspace is offline',
    '',
    'There is no internet here: no registry, no CDN, no web search, no git remote. Nothing outside this workspace is',
    'yours to read, and nothing can be downloaded. What you have:',
    '',
    `- **Packages.** \`pnpm install\` and \`pnpm add <name>\` work, against a fixed mirror inside this machine. Only the`,
    '  packages in the table below (and their dependencies) exist, at the versions shown. Anything else answers `404`:',
    '  choose from the list or write the code yourself. Do not change `packageManager` in `package.json`.',
    `- **A browser.** Chromium for Playwright ${lock.pinned?.playwright ?? ''} is installed. \`pnpm add -D playwright\` gives you the matching`,
    '  library; there is no browser download.',
    '- **Recorded samples.** `inputs/samples/` is the only source of recordings (see its `README.md`).',
    '- **Tools.** `node`, `pnpm`, `git`, `rg`, `jq`, `python3`, `ffmpeg`, `ffprobe`, `sox`, `curl` (loopback only).',
    '',
    '| Package | Version |',
    '| --- | --- |',
    ...requested.filter((name) => lock.packages[name]).map((name) => `| \`${name}\` | ${Object.keys(lock.packages[name].versions).join(', ')} |`),
    '',
  ].join('\n')
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

  // An operator-patch phase starts from the sealed artifact it patches (the
  // same phase of the run it was forked from), not from the phase before it.
  const source = stage.patchOf
    ? stageDirFor(root, stage.patchOf.run, stage.patchOf.phase)
    : phase === 1 ? path.join(root, 'bench', 'starter') : stageDirFor(root, id, phase - 1)
  if (stage.patchOf) {
    if (!fs.existsSync(source)) throw new Error(`Missing the sealed artifact this phase patches: ${source}`)
    if (stage.patchOf.artifactDigest && hashTree(source).digest !== stage.patchOf.artifactDigest) throw new Error(`${stage.patchOf.run} Phase ${stage.patchOf.phase} no longer matches the digest it was forked at; refusing to patch a tree that has changed`)
  }
  if (!stage.patchOf && phase > 1 && !fs.existsSync(source)) throw new Error(`Missing sealed Phase ${phase - 1} artifact: ${source}`)
  copyTree(source, candidate)
  const strict = isStrictProtocol(run)

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
  // Protocol 3 materials: the hard gates ready to paste, what can be installed
  // offline, and the one sample pack.
  let samplePack = null
  if (strict) {
    fs.writeFileSync(path.join(inputs, 'hard-gates.md'), hardGatesDocument(contract))
    copied.push('hard-gates.md')
    const offline = run.isolation === 'lockdown' ? offlineDocument() : null
    if (offline) {
      fs.writeFileSync(path.join(inputs, 'OFFLINE.md'), offline)
      copied.push('OFFLINE.md')
    }
    if (loadSamplePack(root)) {
      samplePack = materializeSamplePack(root, path.join(inputs, 'samples'))
      copied.push('samples/')
    }
  }
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
    protocolVersion: run.protocol?.version ?? protocol.version,
    samplePack: samplePack ? { id: samplePack.id, version: samplePack.version, manifestSha256: samplePack.digest, files: samplePack.files, bytes: samplePack.bytes } : null,
    ...(stage.patchOf ? { patchOf: stage.patchOf } : {}),
    inputs: [...copied, 'TASK.md', 'specs/benchmark-phases.json', 'specs/nord-stage-4.variants.json'].sort(),
    createdAt: new Date().toISOString(),
  })
  const offline = strict && run.isolation === 'lockdown'
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
    ...(strict ? [
      `5. \`inputs/hard-gates.md\` — the Phase ${phase} hard gates as a ready-made checklist. Paste it into \`IMPLEMENTATION_PLAN.md\` unchanged; the seal looks for each sentence word for word.`,
      ...(samplePack ? ['6. `inputs/samples/` — the sample pack: raw, licensed piano recordings, and the only recordings you may bundle. Read `inputs/samples/README.md` before you use any; it says how each bundled audio file must be declared.'] : []),
      ...(offline ? [`${samplePack ? 7 : 6}. \`inputs/OFFLINE.md\` — this workspace has no internet. It lists the packages you can install and the tools you have.`] : []),
    ] : []),
    '',
    'Do not look outside this workspace. Do not read the parent repository, other runs, other projects, scoring materials, or the harness. Do not reuse sample banks or assets from other projects on this machine. Do not modify files outside `candidate/`. Do not change benchmark prompts, specs, or anything under `inputs/`.',
    ...(strict ? [
      '',
      'Your work is graded blind. Do not write your own model name, vendor, or any run name anywhere in `candidate/` (source, documents, evidence, commit metadata); the seal refuses an artifact that names its producer.',
    ] : []),
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

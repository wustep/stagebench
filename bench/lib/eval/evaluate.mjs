// Evaluator-side helpers: the active rubric, assessment templates, and the
// technical checks rerun at scoring time. Everything here operates on a
// sealed stage directory and never imports run state or writes run.json —
// the CLI bridges the two sides.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readJson, runCommand, workspaceRoot } from '../shared.mjs'
import { validateRubric } from './scoring.mjs'

const GATE_COPY_EXCLUDES = new Set(['node_modules', '.git', '.vite'])

export function loadRubric() {
  const rubricPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'rubric.json')
  return validateRubric(readJson(rubricPath))
}

function outputTail(value, length = 1600) {
  return String(value || '').trim().slice(-length)
}

// Rerun the package gates against the sealed artifact so the recorded score
// reflects checks the scorer executed, not checks the candidate claimed.
export async function runTechnicalChecks(stageDir, rubric) {
  const packagePath = path.join(stageDir, 'package.json')
  if (!fs.existsSync(packagePath)) {
    return [{ id: 'artifact', label: 'Runnable phase artifact', passed: false, detail: `Missing ${packagePath}` }]
  }
  const packageJson = readJson(packagePath)
  const checks = []
  for (const script of rubric.technicalGate.requiredChecks) {
    if (!packageJson.scripts?.[script]) {
      checks.push({ id: script, label: script, passed: false, detail: `Missing package script: ${script}` })
      continue
    }
    const startedAt = Date.now()
    process.stderr.write(`  · ${script} … `)
    const result = await runCommand('pnpm', ['run', script], {
      cwd: stageDir,
      timeout: 240_000,
      env: { ...process.env, CI: '1' },
      onOutput: (text) => process.stderr.write(text),
    })
    const passed = result.status === 0 && !result.error
    process.stderr.write(passed ? `${script} passed\n` : `${script} failed\n`)
    checks.push({
      id: script,
      label: script,
      passed,
      durationMs: Date.now() - startedAt,
      detail: passed ? 'Passed' : outputTail(result.stderr || result.stdout || result.error?.message),
    })
  }
  const artifactPath = path.join(stageDir, 'dist', 'index.html')
  checks.push({
    id: 'artifact',
    label: 'Built phase artifact',
    passed: fs.existsSync(artifactPath),
    detail: fs.existsSync(artifactPath) ? 'dist/index.html present' : 'Missing dist/index.html',
  })
  return checks
}

export function skippedTechnicalChecks(stageDir, rubric) {
  const artifactPath = path.join(stageDir, 'dist', 'index.html')
  return [
    ...rubric.technicalGate.requiredChecks.map((id) => ({ id, label: id, passed: true, detail: 'Skipped by explicit option' })),
    { id: 'artifact', label: 'Built phase artifact', passed: fs.existsSync(artifactPath), detail: fs.existsSync(artifactPath) ? 'dist/index.html present' : 'Missing dist/index.html' },
  ]
}

function installDependencies(dir) {
  const result = spawnSync('pnpm', ['install', '--prefer-offline'], { cwd: dir, encoding: 'utf8', timeout: 600_000, env: { ...process.env, CI: '1' } })
  if (result.status !== 0 || result.error) {
    throw new Error(`pnpm install failed in ${dir}: ${String(result.stderr || result.stdout || result.error?.message).trim().slice(-2000)}`)
  }
}

// The platform TypeScript types the in-repo evaluation environment made
// available by directory walk-up to the repo's node_modules. The starter never
// declared @types/node, so every candidate's typecheck resolved it ambiently;
// the out-of-repo gate must provide the same or it would silently fail a
// candidate that (like the starter) relies on it. Returns the source dir, or
// null when the repo has no @types/node to mirror.
function ambientNodeTypes(root) {
  const source = path.join(root, 'node_modules', '@types', 'node')
  return fs.existsSync(source) ? source : null
}

// Place @types/node into the copy's own node_modules, after install so pnpm's
// frozen-lockfile pass does not prune it. `pnpm run <script>` never prunes, so
// it persists through the gates.
function provisionNodeTypes(scratch, source) {
  if (!source) return
  const destination = path.join(scratch, 'node_modules', '@types', 'node')
  fs.rmSync(destination, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.cpSync(source, destination, { recursive: true, dereference: true })
}

// Run the required gates inside Docker: the scratch copy mounted writable,
// registry network for the install, no repository mounted. Coarse per-gate
// results are parsed from GATE-marker lines so one failing gate does not hide
// the others. Requires a working Docker daemon.
async function runGatesInDocker(scratch, rubric, image, nodeTypes) {
  const scripts = rubric.technicalGate.requiredChecks
  const probe = spawnSync('docker', ['version'], { encoding: 'utf8' })
  if (probe.status !== 0) throw new Error('--sandbox requires Docker, but `docker version` failed')
  const program = [
    'pnpm install --prefer-offline || { echo "GATE::install::FAIL"; exit 3; }',
    // Mirror the ambient platform types after install (see provisionNodeTypes).
    ...(nodeTypes ? ['mkdir -p node_modules/@types && cp -RL /ambient/node node_modules/@types/node'] : []),
    ...scripts.map((script) => `if pnpm run ${script}; then echo "GATE::${script}::PASS"; else echo "GATE::${script}::FAIL"; fi`),
  ].join('\n')
  const args = [
    'run', '--rm', '--init', '--network=bridge', '--memory=16g', '--cpus=8',
    '--mount', `type=bind,source=${scratch},target=/workspace`,
    ...(nodeTypes ? ['--mount', `type=bind,source=${nodeTypes},target=/ambient/node,readonly`] : []),
    '--workdir', '/workspace',
    image, 'sh', '-lc', program,
  ]
  let output = ''
  const result = await runCommand('docker', args, { timeout: 900_000, onOutput: (text) => { output += text } })
  if (/GATE::install::FAIL/.test(output)) throw new Error(`Sandboxed install failed:\n${outputTail(output)}`)
  const checks = scripts.map((script) => {
    const passed = new RegExp(`GATE::${script}::PASS`).test(output)
    return { id: script, label: script, passed, detail: passed ? 'Passed (sandboxed)' : outputTail(output) }
  })
  if (result.error && !checks.some((check) => !check.passed)) checks.push({ id: 'test', label: 'test', passed: false, detail: outputTail(result.error.message) })
  const artifactPath = path.join(scratch, 'dist', 'index.html')
  checks.push({ id: 'artifact', label: 'Built phase artifact', passed: fs.existsSync(artifactPath), detail: fs.existsSync(artifactPath) ? 'dist/index.html present' : 'Missing dist/index.html' })
  return checks
}

// Run the technical gates against a throwaway copy of the sealed artifact,
// out of the repository tree, so the sealed runs/<id>/stage<N> directory is
// never mutated (no node_modules written into it) and candidate code never
// executes inside the working tree. Cleans up the copy afterward.
export async function runGates(root, stageDir, rubric, { skip = false, sandbox = false, image = 'node:24-bookworm-slim' } = {}) {
  if (skip) return skippedTechnicalChecks(stageDir, rubric)
  const scratch = path.join(workspaceRoot(root, 'gates'), `${path.basename(path.dirname(stageDir))}-${path.basename(stageDir)}`)
  fs.rmSync(scratch, { recursive: true, force: true })
  fs.mkdirSync(scratch, { recursive: true })
  try {
    fs.cpSync(stageDir, scratch, { recursive: true, dereference: false, filter: (entry) => !GATE_COPY_EXCLUDES.has(path.basename(entry)) })
    const nodeTypes = ambientNodeTypes(root)
    if (sandbox) return await runGatesInDocker(scratch, rubric, image, nodeTypes)
    installDependencies(scratch)
    provisionNodeTypes(scratch, nodeTypes)
    return await runTechnicalChecks(scratch, rubric)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

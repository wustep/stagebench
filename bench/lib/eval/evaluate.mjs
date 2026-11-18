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

// A `lint` script that exits 0 without ever reading the candidate's own sources
// is not a gate. Artifacts that ship no ignore config let oxlint walk
// node_modules and report on bundled dependencies instead of src/ — three
// sealed runs pass `lint` that way, one of them emitting ~45k warnings from a
// vendored typescript.js while only 4 came from its own code.
//
// Coverage is probed rather than inferred from the output, because a lint that
// covers everything and finds nothing prints nothing either: drop a file that
// violates near-universal defaults beside a real source file, rerun the script,
// and see whether the candidate's own tooling names it. Recorded as an advisory
// check (see scoreAssessment) so a vacuous lint is visible in the report
// without re-capping runs scored before this existed.
const LINT_PROBE_STEM = '__stagebench_lint_coverage_probe'
const LINT_PROBE_SOURCE = `// Temporary Stagebench lint-coverage probe. Deleted after the check runs.
var stagebenchProbeUnused = 1
function stagebenchProbeFn() { var shadowed = 2; return shadowed == '2' }
`
const LINT_PROBE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const LINT_PROBE_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vite', 'coverage', 'build'])

// The probe has to land where the candidate's own lint globs already point, so
// it is placed beside a real source file rather than at a guessed path.
// Shallowest-first: a file directly under src/ is a better bet than one buried
// in a fixtures directory the lint script may exclude.
function findSourceSample(dir, depth = 0) {
  if (depth > 4) return null
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (entry.name.startsWith(LINT_PROBE_STEM)) continue
    if (LINT_PROBE_EXTENSIONS.has(path.extname(entry.name))) return path.join(dir, entry.name)
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || LINT_PROBE_SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
    const found = findSourceSample(path.join(dir, entry.name), depth + 1)
    if (found) return found
  }
  return null
}

// Resolves where the probe should go, relative to the artifact root, or null
// when the artifact has no lint script or no source file to sit beside. Shared
// so the Docker path can place the probe on the host and lint it in the
// container against the same bind-mounted copy.
function lintProbePathFor(stageDir, packageJson) {
  if (!packageJson.scripts?.lint) return null
  const sourceRoot = fs.existsSync(path.join(stageDir, 'src')) ? path.join(stageDir, 'src') : stageDir
  const sample = findSourceSample(sourceRoot)
  if (!sample) return null
  const probePath = path.join(path.dirname(sample), `${LINT_PROBE_STEM}${path.extname(sample)}`)
  if (fs.existsSync(probePath)) return null
  return path.relative(stageDir, probePath).split(path.sep).join('/')
}

async function probeLintCoverage(stageDir, packageJson) {
  const label = 'Lint covers candidate sources'
  if (!packageJson.scripts?.lint) return null
  const relative = lintProbePathFor(stageDir, packageJson)
  if (!relative) {
    return { id: 'lint-coverage', label, advisory: true, passed: false, detail: 'No candidate source file found to place the probe beside' }
  }
  const probePath = path.join(stageDir, relative)
  fs.writeFileSync(probePath, LINT_PROBE_SOURCE)
  try {
    const result = await runCommand('pnpm', ['run', 'lint'], { cwd: stageDir, timeout: 240_000, env: { ...process.env, CI: '1' } })
    const output = `${result.stdout || ''}${result.stderr || ''}`
    const named = output.includes(LINT_PROBE_STEM)
    const scannedDeps = /node_modules[/\\]/.test(output)
    const contaminated = scannedDeps ? ' Its output cites node_modules, so the gate also lints vendored dependencies and its result turns partly on code the candidate did not write.' : ''
    return {
      id: 'lint-coverage',
      label,
      advisory: true,
      passed: named,
      scannedDependencies: scannedDeps,
      detail: named
        ? `Lint reported the probe at ${relative}, so the script covers the candidate's own sources.${contaminated}`
        : `Lint did not report a deliberate violation at ${relative}, so the script exits without checking the candidate's own sources.${contaminated}`,
    }
  } finally {
    fs.rmSync(probePath, { force: true })
  }
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
  // Runs last: the probe writes into the candidate's tree, so the required
  // gates see the artifact exactly as sealed.
  const lintCoverage = await probeLintCoverage(stageDir, packageJson)
  if (lintCoverage) checks.push(lintCoverage)
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

// Legacy fallback. The starter now declares @types/node, so a current
// candidate's frozen install provides the platform types itself. Artifacts
// sealed before that (their frozen lockfiles omit @types/node) still resolved
// it ambiently from the repo's node_modules, so the out-of-repo gate mirrors
// the repo's copy for them — otherwise it would silently fail an honest legacy
// candidate. Returns the repo's @types/node dir, or null when absent.
function ambientNodeTypes(root) {
  const source = path.join(root, 'node_modules', '@types', 'node')
  return fs.existsSync(source) ? source : null
}

// Place @types/node into the copy's own node_modules, after install so pnpm's
// frozen-lockfile pass does not prune it. Skips when the artifact already
// installed it (every current run), so only pre-@types/node legacy artifacts
// fall back to the repo's copy. `pnpm run <script>` never prunes, so it
// persists through the gates. The "installed" predicate checks for the
// package's own package.json — a bare directory (interrupted install, hoist
// stub) must not count, or an honest legacy candidate would skip the fallback
// and fail its typecheck on missing platform types.
function provisionNodeTypes(scratch, source) {
  if (!source) return
  const destination = path.join(scratch, 'node_modules', '@types', 'node')
  if (fs.existsSync(path.join(destination, 'package.json'))) return // artifact installed its own
  fs.rmSync(destination, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.cpSync(source, destination, { recursive: true, dereference: true })
}

// Run the required gates inside the lockdown box (bench/lockdown): a copy of
// the scratch tree in a fresh volume, no network, nothing of this machine
// mounted. Each gate is its own container, so pass or
// fail is the process exit status rather than anything the candidate's scripts
// print. The build is copied back into the scratch tree for the artifact check.
async function runGatesInLockdown(root, scratch, rubric, nodeTypes, network = 'none') {
  const { runGatesInBox } = await import('../../lockdown/session.mjs')
  const packageJson = fs.existsSync(path.join(scratch, 'package.json')) ? readJson(path.join(scratch, 'package.json')) : {}
  const lintProbeRelative = lintProbePathFor(scratch, packageJson)
  let lintCovered = null
  const { checks: gates, gateway } = await runGatesInBox(root, scratch, {
    // 'none' for a protocol-3 artifact (it installs from the mirror in the
    // image); 'legacy-mirror' for one sealed earlier, whose lockfile names
    // packages that mirror does not carry.
    network,
    scripts: rubric.technicalGate.requiredChecks,
    onOutput: (text) => process.stderr.write(text),
    // Legacy fallback only: mirror the ambient platform types after install if
    // the artifact didn't install its own (see provisionNodeTypes — the
    // package.json check rejects a bare/partial directory).
    afterInstall: async ({ run, runWritable, copyDirectory }) => {
      if (!nodeTypes) return
      const present = await run(['test', '-f', 'node_modules/@types/node/package.json'], 'types-probe', 60_000)
      if (present.status === 0) return
      await runWritable(['rm', '-rf', 'node_modules/@types/node'], 'types-clear', 60_000)
      await copyDirectory(nodeTypes, 'node_modules/@types/node')
    },
    // Advisory lint-coverage probe, after the required gates so they see the
    // artifact as sealed.
    afterGates: async ({ run, writeFiles }) => {
      if (!lintProbeRelative) return
      // Advisory: a probe that cannot be placed is a probe that did not report,
      // not a reason for the required gates to be lost.
      try {
        writeFiles([{ path: lintProbeRelative, content: LINT_PROBE_SOURCE }])
      } catch {
        lintCovered = false
        return
      }
      // Grep inside the box: a lint that walks node_modules can print far more
      // than is worth streaming back just to find one filename.
      const linted = await run(['sh', '-c', `pnpm run lint 2>&1 | grep -q ${LINT_PROBE_STEM}`], 'lint-probe', 300_000)
      lintCovered = linted.status === 0
    },
  })
  const checks = gates.map((gate) => ({ id: gate.id, label: gate.id, passed: gate.passed, durationMs: gate.durationMs, detail: gate.passed ? 'Passed (lockdown)' : outputTail(gate.detail) }))
  const artifactPath = path.join(scratch, 'dist', 'index.html')
  checks.push({ id: 'artifact', label: 'Built phase artifact', passed: fs.existsSync(artifactPath), detail: fs.existsSync(artifactPath) ? 'dist/index.html present' : 'Missing dist/index.html' })
  if (lintProbeRelative) {
    checks.push({
      id: 'lint-coverage',
      label: 'Lint covers candidate sources',
      advisory: true,
      passed: lintCovered === true,
      detail: lintCovered
        ? `Lint reported the probe at ${lintProbeRelative}, so the script covers the candidate's own sources (lockdown)`
        : `Lint did not report a deliberate violation at ${lintProbeRelative}, so the script exits without checking the candidate's own sources (lockdown)`,
    })
  }
  // Not a check: the hash-chained log of what the gates fetched, for the caller to keep.
  Object.defineProperty(checks, 'gateway', { value: gateway, enumerable: false })
  return checks
}

// Run the technical gates against a throwaway copy of the sealed artifact,
// out of the repository tree, so the sealed runs/<id>/stage<N> directory is
// never mutated (no node_modules written into it) and candidate code never
// executes inside the working tree. With `sandbox`, it never executes on this
// machine at all. Cleans up the copy afterward.
export async function runGates(root, stageDir, rubric, { skip = false, sandbox = false, network = 'none' } = {}) {
  if (skip) return skippedTechnicalChecks(stageDir, rubric)
  const scratch = path.join(workspaceRoot(root, 'gates'), `${path.basename(path.dirname(stageDir))}-${path.basename(stageDir)}`)
  fs.rmSync(scratch, { recursive: true, force: true })
  fs.mkdirSync(scratch, { recursive: true })
  try {
    fs.cpSync(stageDir, scratch, { recursive: true, dereference: false, filter: (entry) => !GATE_COPY_EXCLUDES.has(path.basename(entry)) })
    const nodeTypes = ambientNodeTypes(root)
    if (sandbox) return await runGatesInLockdown(root, scratch, rubric, nodeTypes, network)
    installDependencies(scratch)
    provisionNodeTypes(scratch, nodeTypes)
    return await runTechnicalChecks(scratch, rubric)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

// Exposed for tests: the lint-coverage probe is the one gate helper whose
// failure mode (a lint that exits 0 having read nothing) cannot be observed
// from the gate's own exit code.
export const __internals = { probeLintCoverage, lintProbePathFor, findSourceSample, LINT_PROBE_STEM }

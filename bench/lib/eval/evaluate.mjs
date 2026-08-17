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

// Run the required gates inside Docker: the scratch copy mounted writable,
// registry network for the install, no repository mounted. Coarse per-gate
// results are parsed from GATE-marker lines so one failing gate does not hide
// the others. Requires a working Docker daemon.
async function runGatesInDocker(scratch, rubric, image, nodeTypes) {
  const scripts = rubric.technicalGate.requiredChecks
  const probe = spawnSync('docker', ['version'], { encoding: 'utf8' })
  if (probe.status !== 0) throw new Error('--sandbox requires Docker, but `docker version` failed')
  const packageJson = fs.existsSync(path.join(scratch, 'package.json')) ? readJson(path.join(scratch, 'package.json')) : {}
  const lintProbeRelative = lintProbePathFor(scratch, packageJson)
  const program = [
    'pnpm install --prefer-offline || { echo "GATE::install::FAIL"; exit 3; }',
    // Legacy fallback only: mirror the ambient platform types after install if
    // the artifact didn't install its own (see provisionNodeTypes — the
    // package.json check rejects a bare/partial directory).
    ...(nodeTypes ? ['[ -f node_modules/@types/node/package.json ] || { rm -rf node_modules/@types/node && mkdir -p node_modules/@types && cp -RL /ambient/node node_modules/@types/node; }'] : []),
    ...scripts.map((script) => `if pnpm run ${script}; then echo "GATE::${script}::PASS"; else echo "GATE::${script}::FAIL"; fi`),
    // Advisory lint-coverage probe, after the required gates so they see the
    // artifact as sealed. The path is resolved on the host against the same
    // bind-mounted copy. Quoted heredoc: the probe is literal, not expanded.
    ...(lintProbeRelative
      ? [
        `cat > ${JSON.stringify(lintProbeRelative)} <<'STAGEBENCH_PROBE_EOF'`,
        LINT_PROBE_SOURCE.trimEnd(),
        'STAGEBENCH_PROBE_EOF',
        `if pnpm run lint 2>&1 | grep -q ${LINT_PROBE_STEM}; then echo "GATE::lint-coverage::PASS"; else echo "GATE::lint-coverage::FAIL"; fi`,
        `rm -f ${JSON.stringify(lintProbeRelative)}`,
      ]
      : []),
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
  if (lintProbeRelative) {
    const covered = /GATE::lint-coverage::PASS/.test(output)
    checks.push({
      id: 'lint-coverage',
      label: 'Lint covers candidate sources',
      advisory: true,
      passed: covered,
      detail: covered
        ? `Lint reported the probe at ${lintProbeRelative}, so the script covers the candidate's own sources (sandboxed)`
        : `Lint did not report a deliberate violation at ${lintProbeRelative}, so the script exits without checking the candidate's own sources (sandboxed)`,
    })
  }
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

// Exposed for tests: the lint-coverage probe is the one gate helper whose
// failure mode (a lint that exits 0 having read nothing) cannot be observed
// from the gate's own exit code.
export const __internals = { probeLintCoverage, lintProbePathFor, findSourceSample, LINT_PROBE_STEM }

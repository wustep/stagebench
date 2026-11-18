// Benchmark-owned verification of a phase artifact: package gates, feature
// matrix, phase contract, implementation provenance, and evidence. Pure over
// the stage directory — the store records the result.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { hashFile, hashTree, readJson, runCommand } from '../shared.mjs'
import { validateImplementationManifest } from '../implementation-details.mjs'

export const REQUIRED_FEATURES = {
  1: [
    'visual.key-count',
    'visual.section-layout',
    'visual.control-inventory',
    'interaction.keys',
    'interaction.decorative-controls',
    'accessibility.controls',
    'piano.basic-note-lifecycle',
    'piano.basic-inputs',
    'piano.basic-sustain-polyphony',
    'piano.basic-status-cleanup',
    'regression.chassis',
  ],
  2: [
    'piano.instrument-library',
    'piano.layers',
    'piano.velocity-controls',
    'piano.pedals',
    'piano.fallback',
    'effects.graph',
    'effects.routing',
    'effects.processing',
    'regression.phase1',
  ],
  3: [
    'programs.roundtrip',
    'programs.store-live',
    'programs.undo-cancel',
    'programs.navigation',
    'layers.routing',
    'splits.zones',
    'morph.assignments',
    'scenes.switching',
    'organ.engine',
    'organ.models-drawbars',
    'organ.rotary',
    'synth.sources',
    'synth.filter-envelopes',
    'synth.voice-modes',
    'synth.arp-gate',
    'system.integration',
    'hardware.bindings',
    'regression.phase2',
  ],
}

function packageCommand(stageDir, script) {
  assert.ok(fs.existsSync(path.join(stageDir, 'pnpm-lock.yaml')), 'Missing pnpm-lock.yaml; benchmark phases must use pnpm')
  assert.ok(!fs.existsSync(path.join(stageDir, 'package-lock.json')), 'package-lock.json is not allowed; benchmark phases must use pnpm')
  assert.ok(!fs.existsSync(path.join(stageDir, 'yarn.lock')), 'yarn.lock is not allowed; benchmark phases must use pnpm')
  const packageJson = readJson(path.join(stageDir, 'package.json'))
  assert.match(packageJson.packageManager ?? '', /^pnpm@/, 'package.json must declare a pnpm packageManager')
  return { executable: 'pnpm', args: ['run', script] }
}

export async function runChecks(stageDir) {
  const packagePath = path.join(stageDir, 'package.json')
  assert.ok(fs.existsSync(packagePath), 'Missing package.json')
  const packageJson = readJson(packagePath)
  const results = []
  for (const script of ['test', 'typecheck', 'lint', 'build']) {
    assert.ok(packageJson.scripts?.[script], `Missing package script: ${script}`)
    const command = packageCommand(stageDir, script)
    const startedAt = Date.now()
    process.stderr.write(`  · ${script} … `)
    const result = await runCommand(command.executable, command.args, {
      cwd: stageDir,
      timeout: 240_000,
      env: { ...process.env, CI: '1' },
      onOutput: (text) => process.stderr.write(text),
    })
    const passed = result.status === 0 && !result.error
    process.stderr.write(passed ? `${script} passed\n` : `${script} failed\n`)
    results.push({
      id: script,
      command: [command.executable, ...command.args].join(' '),
      passed,
      durationMs: Date.now() - startedAt,
      detail: passed ? 'Passed' : String(result.stderr || result.stdout || result.error?.message || 'Unknown failure').trim().slice(-2400),
    })
  }
  return results
}

// Which of a feature's tests actually ran. A feature matrix only says a test
// file exists; two audited artifacts mapped a required feature to nothing the
// seal ever executed — a suite wrapped in `describe.runIf(env)` that skipped
// itself without the environment variable, and a standalone browser script the
// test runner never loads. `report` is the per-file summary of a real run of
// the candidate's tests (summarizeVitestReport): a feature counts as covered
// only if at least one of its test files ran and had a test pass.
export function featureExecution(matrix, report) {
  const normalize = (file) => path.posix.normalize(String(file).split(path.sep).join('/')).replace(/^\.\//, '')
  if (!report || !Array.isArray(report.files)) {
    return { collected: false, uncovered: [], detail: `The seal could not collect per-file test results (${report?.error ? String(report.error).slice(-300) : 'no report'}). Feature tests must run under Vitest with no special environment: \`pnpm exec vitest run\` has to work in candidate/` }
  }
  const ran = new Map(report.files.map((file) => [normalize(file.file), file]))
  const uncovered = []
  const idle = new Set()
  for (const feature of matrix.features ?? []) {
    const states = (feature.tests ?? []).map((testPath) => {
      const result = ran.get(normalize(testPath))
      if (!result) return { test: testPath, state: 'not-run' }
      if (result.passed > 0) return { test: testPath, state: 'ran' }
      return { test: testPath, state: result.failed > 0 ? 'failed' : 'skipped' }
    })
    for (const entry of states) if (entry.state !== 'ran') idle.add(`${entry.test} (${entry.state})`)
    if (!states.some((entry) => entry.state === 'ran')) uncovered.push({ id: feature.id, tests: states })
  }
  const describe = (entry) => `${entry.id} → ${entry.tests.map((test) => `${test.test}: ${test.state === 'not-run' ? 'not executed by the test runner' : test.state === 'skipped' ? 'every test skipped' : 'no passing test'}`).join(', ')}`
  return {
    collected: true,
    files: report.files.length,
    uncovered,
    idleTests: [...idle].sort(),
    detail: uncovered.length === 0
      ? `Every feature in tests/feature-matrix.json maps to at least one test file that the seal's own test run executed with a passing test (${report.files.length} files ran)`
      : `${uncovered.length} feature(s) map only to tests the seal's test run did not execute or that skipped every test: ${uncovered.slice(0, 8).map(describe).join('; ')}${uncovered.length > 8 ? '; …' : ''}. Each feature needs a test that \`pnpm exec vitest run\` executes with no special environment variables — not a suite behind runIf/skipIf, and not a standalone script`,
  }
}

export function featureExecutionEvidence(execution, { blocking = true } = {}) {
  return { id: 'feature tests executed', ...(blocking ? {} : { advisory: true }), passed: execution.collected && execution.uncovered.length === 0, detail: execution.detail }
}

// The same question asked on this machine, for a phase sealed outside the box.
export async function collectFeatureTestsOnHost(stageDir) {
  const reportPath = path.join(stageDir, 'node_modules', '.stagebench-vitest.json')
  fs.rmSync(reportPath, { force: true })
  const result = await runCommand('pnpm', ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${reportPath}`], { cwd: stageDir, timeout: 300_000, env: { ...process.env, CI: '1' } })
  let files = null
  try {
    files = readJson(reportPath).testResults.map((file) => {
      const counts = { passed: 0, failed: 0, skipped: 0 }
      for (const assertion of file.assertionResults ?? []) counts[assertion.status === 'passed' ? 'passed' : assertion.status === 'failed' ? 'failed' : 'skipped'] += 1
      const name = fs.existsSync(file.name) ? fs.realpathSync(file.name) : file.name
      return { file: path.relative(fs.realpathSync(stageDir), name).split(path.sep).join('/'), ...counts }
    })
  } catch {
    files = null
  }
  fs.rmSync(reportPath, { force: true })
  return { runner: 'vitest', exitStatus: result.status, files, ...(files ? {} : { error: String(result.stderr || result.stdout || result.error?.message || '').trim().slice(-800) }) }
}

export function readFeatureMatrix(stageDir) {
  const matrixPath = path.join(stageDir, 'tests', 'feature-matrix.json')
  return fs.existsSync(matrixPath) ? readJson(matrixPath) : { features: [] }
}

// Agent instruction files a harness loads on its own. In a sealed artifact
// they are addressed to whoever opens it next, which is the grader.
export const AGENT_INSTRUCTION_FILES = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'AGENTS.override.md', 'GEMINI.md', '.cursorrules', '.windsurfrules', '.clinerules', '.mcp.json', 'opencode.json', 'copilot-instructions.md']
export const AGENT_INSTRUCTION_DIRS = ['.claude', '.codex', '.cursor', '.agents', '.gemini', '.opencode', '.windsurf']

export function findAgentInstructionFiles(directory) {
  const found = []
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (['node_modules', '.git'].includes(entry.name)) continue
      const absolute = path.join(current, entry.name)
      const relative = path.relative(directory, absolute).split(path.sep).join('/')
      if (entry.isDirectory()) {
        if (AGENT_INSTRUCTION_DIRS.includes(entry.name)) found.push(`${relative}/`)
        else visit(absolute)
      } else if (AGENT_INSTRUCTION_FILES.includes(entry.name)) {
        found.push(relative)
      }
    }
  }
  if (fs.existsSync(directory)) visit(directory)
  return found.sort()
}

// Does the artifact say who made it? Compared with punctuation and case
// removed, so "GPT 6.2 Sol", "gpt-6.2-sol", and the run id "gpt-6-2-sol" are
// one name. Returns the files that carry it.
export function findProducerNames(stageDir, names) {
  const squash = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '')
  const needles = [...new Set(names.map(squash).filter((needle) => needle.length >= 5))]
  if (needles.length === 0) return []
  const hits = []
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (['node_modules', '.git', '.vite', '.pnpm-store'].includes(entry.name)) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        visit(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const relative = path.relative(stageDir, absolute).split(path.sep).join('/')
      const { size } = fs.statSync(absolute)
      let found = needles.some((needle) => squash(relative).includes(needle))
      if (!found && size <= 24 * 1024 * 1024) {
        const buffer = fs.readFileSync(absolute)
        // Binary files are searched as they are; text is searched squashed.
        const text = buffer.subarray(0, 4096).includes(0) ? buffer.toString('latin1').toLowerCase() : squash(buffer.toString('utf8'))
        found = needles.some((needle) => text.includes(needle))
      }
      if (found) hits.push(relative)
    }
  }
  visit(stageDir)
  return hits.sort()
}

export function blindArtifactEvidence(hits, { blocking = true } = {}) {
  const check = { id: 'artifact does not name its producer', ...(blocking ? {} : { advisory: true }) }
  if (hits.length === 0) return { ...check, passed: true, detail: 'Neither the run id nor the model name appears in the sealed artifact or its build' }
  return {
    ...check,
    passed: false,
    detail: `The artifact names the model or run that produced it in ${hits.length} file(s): ${hits.slice(0, 6).join(', ')}${hits.length > 6 ? ', …' : ''}. Grading is blind. Remove every mention of your own model, vendor product name, or run name from candidate/ (source, documents, evidence, and anything the build embeds), then seal again`,
  }
}

function verifyFeatureMatrix(stageDir, phase) {
  const matrixPath = path.join(stageDir, 'tests', 'feature-matrix.json')
  assert.ok(fs.existsSync(matrixPath), 'Missing tests/feature-matrix.json')
  const matrix = readJson(matrixPath)
  assert.equal(matrix.stage, phase, `Feature matrix stage must be ${phase}`)
  assert.ok(Array.isArray(matrix.features), 'Feature matrix features must be an array')
  const entries = new Map()
  for (const feature of matrix.features) {
    assert.equal(typeof feature.id, 'string', 'Every feature needs an id')
    assert.ok(!entries.has(feature.id), `Duplicate feature id: ${feature.id}`)
    assert.ok(Array.isArray(feature.tests) && feature.tests.length > 0, `${feature.id} must name at least one test`)
    for (const testPath of feature.tests) {
      const absoluteTestPath = path.resolve(stageDir, testPath)
      assert.ok(absoluteTestPath.startsWith(`${stageDir}${path.sep}`), `${feature.id} test escapes the stage directory`)
      assert.ok(fs.existsSync(absoluteTestPath), `${feature.id} points to missing test: ${testPath}`)
      assert.ok(fs.statSync(absoluteTestPath).size > 0, `${feature.id} points to an empty test: ${testPath}`)
    }
    entries.set(feature.id, feature)
  }
  const required = Object.entries(REQUIRED_FEATURES)
    .filter(([number]) => Number(number) <= phase)
    .flatMap(([, features]) => features)
  const missing = required.filter((id) => !entries.has(id))
  assert.deepEqual(missing, [], `Missing required feature coverage: ${missing.join(', ')}`)
  return { coveredFeatures: entries.size, requiredFeatures: required.length }
}

function verifyPhaseContract(root, stageDir, phase) {
  const manifest = readJson(path.join(root, 'specs', 'benchmark-phases.json'))
  const contract = manifest.phases?.find((entry) => entry.number === phase)
  assert.ok(contract, `Missing Phase ${phase} contract in specs/benchmark-phases.json`)
  const planPath = path.join(stageDir, 'IMPLEMENTATION_PLAN.md')
  assert.ok(fs.existsSync(planPath) && fs.statSync(planPath).size > 0, 'Missing IMPLEMENTATION_PLAN.md')
  // Collapse whitespace on both sides: a gate copied verbatim but hard-wrapped
  // across markdown lines is still a verbatim copy.
  const flatten = (text) => text.replace(/\s+/g, ' ').toLowerCase()
  const plan = flatten(fs.readFileSync(planPath, 'utf8'))
  assert.ok(plan.includes('hard gate'), 'IMPLEMENTATION_PLAN.md must acknowledge the phase hard gates')
  for (const specPath of contract.specs) {
    assert.ok(plan.includes(path.basename(specPath).toLowerCase()), `IMPLEMENTATION_PLAN.md must cite ${path.basename(specPath)}`)
  }
  for (const gate of contract.hardGates ?? []) {
    assert.ok(plan.includes(flatten(gate)), `IMPLEMENTATION_PLAN.md must include the hard gate, word for word: "${gate}" (the ready-made checklist is in inputs/hard-gates.md; paste it in unchanged)`)
  }
  return { specs: contract.specs, hardGates: contract.hardGates?.length ?? 0 }
}

function verifyImplementationDetails(stageDir, phase) {
  const manifestPath = path.join(stageDir, 'IMPLEMENTATION_DETAILS.json')
  assert.ok(fs.existsSync(manifestPath), 'Missing IMPLEMENTATION_DETAILS.json')
  const manifest = validateImplementationManifest(readJson(manifestPath), phase)
  return {
    audioStrategy: manifest.audio.strategy,
    generatedSources: manifest.audio.generatedSources?.length ?? 0,
    sampleSources: manifest.audio.sampleSources.length,
  }
}

function evidenceChecks(stageDir, phase) {
  const requiredPng = {
    [`evidence/stage${phase}-desktop.png`]: { width: 1440, height: 900 },
    [`evidence/stage${phase}-narrow.png`]: { width: 390, height: 844 },
  }
  const checks = Object.entries(requiredPng).map(([relativePath, expected]) => {
    const absolutePath = path.join(stageDir, relativePath)
    let detail = `Missing ${relativePath}`
    let passed = false
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).size >= 24) {
      const header = fs.readFileSync(absolutePath).subarray(0, 24)
      const isPng = header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      const dimensions = isPng ? { width: header.readUInt32BE(16), height: header.readUInt32BE(20) } : null
      passed = isPng && dimensions.width === expected.width && dimensions.height === expected.height
      detail = `${relativePath} · ${dimensions ? `${dimensions.width}x${dimensions.height}` : 'invalid PNG'}`
    }
    return { id: relativePath, passed, detail }
  })
  for (const relativePath of [`evidence/stage${phase}-visual-audit.md`, `evidence/stage${phase}-capture.json`]) {
    const absolutePath = path.join(stageDir, relativePath)
    checks.push({
      id: relativePath,
      passed: fs.existsSync(absolutePath) && fs.statSync(absolutePath).size > 0,
      detail: fs.existsSync(absolutePath) ? relativePath : `Missing ${relativePath}`,
    })
  }
  checks.push(documentModeCheck(stageDir))
  return checks
}

// A built index.html with no doctype puts the browser in quirks mode, where
// the box model differs from standards mode — and every panel-fidelity
// measurement is geometry taken from a real browser. Several sealed artifacts
// ship a doctype-less fragment, so their chassis numbers were measured under
// different layout rules than the rest of the field.
//
// Advisory rather than blocking: this describes how measurable the artifact is,
// and making it a seal requirement now would retroactively invalidate runs
// sealed before the check existed. Promote it by dropping the `advisory` flag.
function documentModeCheck(stageDir) {
  const id = 'dist/index.html standards mode'
  const documentPath = path.join(stageDir, 'dist', 'index.html')
  if (!fs.existsSync(documentPath)) {
    return { id, advisory: true, passed: false, detail: 'Missing dist/index.html' }
  }
  // The doctype must lead the document; anything before it (other than
  // whitespace or a BOM) still triggers quirks mode.
  const head = fs.readFileSync(documentPath, 'utf8').replace(/^﻿/, '').trimStart().slice(0, 200)
  const passed = /^<!doctype\s+html\b/i.test(head)
  return {
    id,
    advisory: true,
    passed,
    detail: passed
      ? 'dist/index.html opens with <!doctype html>, so the browser measures it in standards mode'
      : 'dist/index.html has no leading <!doctype html>, so a browser renders it in quirks mode and its geometry is not comparable to artifacts measured in standards mode',
  }
}

// Every spec whose contents change what an artifact is scored against, with
// its declared version and a digest of its bytes. Recorded at seal so a later
// scoring pass can tell whether the materials moved underneath a run.
const MATERIAL_SPECS = [
  'specs/benchmark-phases.json',
  'specs/nord-stage-4.visual.json',
  'specs/nord-stage-4.variants.json',
  'bench/rubric.json',
]

export function materialDigests(root) {
  const materials = {}
  for (const relative of MATERIAL_SPECS) {
    const file = path.join(root, relative)
    if (!fs.existsSync(file)) continue
    let version = null
    try { version = readJson(file).version ?? null } catch { version = null }
    materials[relative] = { version, digest: hashFile(file) }
  }
  return materials
}

// Verify a phase artifact in place. Throws on contract violations; returns a
// structured result (with the sealing digest when everything passed).
export function verifyPhase(root, id, phase, options = {}) {
  const stageDir = path.join(root, 'runs', id, `stage${phase}`)
  assert.ok(fs.existsSync(stageDir), `Missing phase directory: ${stageDir}`)
  const phaseContract = verifyPhaseContract(root, stageDir, phase)
  const featureMatrix = verifyFeatureMatrix(stageDir, phase)
  const implementationDetails = verifyImplementationDetails(stageDir, phase)
  // Callers run the (now async) package checks and pass the results in, so
  // verifyPhase itself stays synchronous over the sealed stage directory.
  assert.ok(options.checks, 'verifyPhase requires precomputed package checks (call runChecks first)')
  const checks = options.checks
  const evidence = [...evidenceChecks(stageDir, phase), ...(options.evidence ?? [])]
  // Advisory evidence describes how measurable the artifact is rather than
  // whether it meets the contract, so it is recorded but never blocks a seal.
  const passed = checks.every((check) => check.passed) && evidence.every((check) => check.passed || check.advisory)
  const artifact = passed ? hashTree(stageDir) : null
  return {
    version: 4,
    runId: id,
    stage: phase,
    ...(options.protocolVersion ? { protocolVersion: options.protocolVersion } : {}),
    verifiedAt: new Date().toISOString(),
    passed,
    artifactDigest: artifact?.digest,
    artifactFiles: artifact?.files,
    // Which spec bytes this artifact was actually built against. The section
    // fractions in the visual spec were once corrected without a version bump,
    // so a run built to the old numbers was later scored against the new ones
    // with nothing in its record to show it. A digest makes that detectable
    // even when someone forgets to bump the version.
    materials: materialDigests(root),
    phaseContract,
    featureMatrix,
    implementationDetails,
    checks,
    evidence,
  }
}

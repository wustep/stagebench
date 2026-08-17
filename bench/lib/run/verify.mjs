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
    assert.ok(plan.includes(flatten(gate)), `IMPLEMENTATION_PLAN.md must include the hard gate: ${gate}`)
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
  const evidence = evidenceChecks(stageDir, phase)
  // Advisory evidence describes how measurable the artifact is rather than
  // whether it meets the contract, so it is recorded but never blocks a seal.
  const passed = checks.every((check) => check.passed) && evidence.every((check) => check.passed || check.advisory)
  const artifact = passed ? hashTree(stageDir) : null
  return {
    version: 3,
    runId: id,
    stage: phase,
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

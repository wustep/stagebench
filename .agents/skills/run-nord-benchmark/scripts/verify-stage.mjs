#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { validateImplementationManifest } from '../../../../evaluation/lib/implementation-details.mjs'
import { checkContamination } from '../lib/contamination.mjs'
import { findRepoRoot, parseArgs, readJson, writeJson } from '../lib/cli.mjs'
import { hashTree } from '../lib/protocol.mjs'

const LEGACY_REQUIRED_FEATURES = {
  1: [
    'visual.key-count',
    'visual.section-layout',
    'visual.control-inventory',
    'interaction.keys',
    'interaction.buttons-leds',
    'interaction.knobs',
    'accessibility.controls',
    'regression.chassis',
  ],
  2: [
    'piano.note-lifecycle',
    'piano.sustain',
    'piano.polyphony',
    'piano.velocity',
    'piano.keyboard-map',
    'piano.midi',
    'piano.volume-reverb',
    'piano.fallback',
    'regression.stage1',
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
    'effects.graph',
    'effects.routing',
    'effects.processing',
    'regression.stage2',
  ],
  4: [
    'organ.engine',
    'organ.models',
    'organ.drawbars',
    'organ.rotary',
    'synth.sources',
    'synth.filter-envelopes',
    'synth.voice-modes',
    'synth.arp-gate',
    'system.integration',
    'hardware.bindings',
    'regression.stage3',
  ],
}

const V3_REQUIRED_FEATURES = {
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

function isV3Run(run) {
  return run?.schemaVersion === 3 || String(run?.protocol?.version ?? run?.benchmarkVersion ?? '').startsWith('3.')
}


function packageCommand(stageDir, script) {
  assert.ok(fs.existsSync(path.join(stageDir, 'pnpm-lock.yaml')), 'Missing pnpm-lock.yaml; benchmark phases must use pnpm')
  assert.ok(!fs.existsSync(path.join(stageDir, 'package-lock.json')), 'package-lock.json is not allowed; benchmark phases must use pnpm')
  assert.ok(!fs.existsSync(path.join(stageDir, 'yarn.lock')), 'yarn.lock is not allowed; benchmark phases must use pnpm')
  const packageJson = readJson(path.join(stageDir, 'package.json'))
  assert.match(packageJson.packageManager ?? '', /^pnpm@/, 'package.json must declare a pnpm packageManager')
  return { executable: 'pnpm', args: ['run', script] }
}

function verifyFeatureMatrix(stageDir, stage, run) {
  const matrixPath = path.join(stageDir, 'tests', 'feature-matrix.json')
  assert.ok(fs.existsSync(matrixPath), `Missing ${path.relative(stageDir, matrixPath)}`)
  const matrix = readJson(matrixPath)
  assert.equal(matrix.stage, stage, `Feature matrix stage must be ${stage}`)
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
  const registry = isV3Run(run) ? V3_REQUIRED_FEATURES : LEGACY_REQUIRED_FEATURES
  const required = Object.entries(registry)
    .filter(([phase]) => Number(phase) <= stage)
    .flatMap(([, features]) => features)
  const missing = required.filter((id) => !entries.has(id))
  assert.deepEqual(missing, [], `Missing required feature coverage: ${missing.join(', ')}`)
  return { path: path.relative(stageDir, matrixPath), coveredFeatures: entries.size, requiredFeatures: required.length }
}

function verifyPhaseContract(root, stageDir, stage, run) {
  const manifestPath = isV3Run(run)
    ? path.join(root, 'specs', 'benchmark-phases.json')
    : path.join(root, 'specs', 'protocols', 'v2', 'benchmark-phases.json')
  assert.ok(fs.existsSync(manifestPath), `Missing ${path.relative(root, manifestPath)}`)
  const manifest = readJson(manifestPath)
  assert.equal(manifest.phaseCount, isV3Run(run) ? 3 : 4, `Benchmark phase manifest must define ${isV3Run(run) ? 'three' : 'four'} phases`)
  const phase = manifest.phases?.find((entry) => entry.number === stage)
  assert.ok(phase, `Missing Phase ${stage} contract in specs/benchmark-phases.json`)
  assert.ok(Array.isArray(phase.specs) && phase.specs.length > 0, `Phase ${stage} must assign at least one spec`)
  for (const specPath of phase.specs) assert.ok(fs.existsSync(path.join(root, specPath)), `Missing assigned spec: ${specPath}`)

  const planPath = path.join(stageDir, 'IMPLEMENTATION_PLAN.md')
  assert.ok(fs.existsSync(planPath) && fs.statSync(planPath).size > 0, 'Missing IMPLEMENTATION_PLAN.md')
  const plan = fs.readFileSync(planPath, 'utf8').toLowerCase()
  assert.ok(plan.includes('hard gate'), 'IMPLEMENTATION_PLAN.md must acknowledge the phase hard gates')
  for (const specPath of phase.specs) {
    assert.ok(plan.includes(path.basename(specPath).toLowerCase()), `IMPLEMENTATION_PLAN.md must cite ${path.basename(specPath)}`)
  }
  for (const gate of phase.hardGates ?? []) {
    assert.ok(plan.includes(gate.toLowerCase()), `IMPLEMENTATION_PLAN.md must include the hard gate: ${gate}`)
  }
  return {
    manifest: path.relative(root, manifestPath),
    specs: phase.specs,
    hardGates: phase.hardGates?.length ?? 0,
    acknowledgedHardGates: phase.hardGates?.length ?? 0,
    plan: path.relative(stageDir, planPath),
  }
}

function verifyImplementationDetails(stageDir, stage) {
  const manifestPath = path.join(stageDir, 'IMPLEMENTATION_DETAILS.json')
  assert.ok(fs.existsSync(manifestPath), 'Missing IMPLEMENTATION_DETAILS.json')
  const manifest = validateImplementationManifest(readJson(manifestPath), stage)
  return {
    path: path.relative(stageDir, manifestPath),
    audioStrategy: manifest.audio.strategy,
    generatedSources: manifest.audio.generatedSources?.length ?? 0,
    sampleSources: manifest.audio.sampleSources.length,
  }
}

function runChecks(stageDir) {
  const packagePath = path.join(stageDir, 'package.json')
  assert.ok(fs.existsSync(packagePath), 'Missing package.json')
  const packageJson = readJson(packagePath)
  return ['test', 'typecheck', 'lint', 'build'].map((script) => {
    assert.ok(packageJson.scripts?.[script], `Missing package script: ${script}`)
    const command = packageCommand(stageDir, script)
    const startedAt = Date.now()
    const result = spawnSync(command.executable, command.args, {
      cwd: stageDir,
      encoding: 'utf8',
      timeout: 240_000,
      env: { ...process.env, CI: '1' },
    })
    const passed = result.status === 0 && !result.error
    return {
      id: script,
      command: [command.executable, ...command.args].join(' '),
      passed,
      durationMs: Date.now() - startedAt,
      detail: passed ? 'Passed' : String(result.stderr || result.stdout || result.error?.message || 'Unknown failure').trim().slice(-2400),
    }
  })
}

function evidenceChecks(stageDir, stage, run) {
  const required = [
    `evidence/stage${stage}-desktop.png`,
    `evidence/stage${stage}-narrow.png`,
    `evidence/stage${stage}-visual-audit.md`,
  ]
  const checks = required.map((relativePath) => {
    const absolutePath = path.join(stageDir, relativePath)
    const isPng = relativePath.endsWith('.png')
    let dimensions = null
    let validImage = !isPng
    if (isPng && fs.existsSync(absolutePath) && fs.statSync(absolutePath).size >= 24) {
      const header = fs.readFileSync(absolutePath).subarray(0, 24)
      validImage = header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      if (validImage) dimensions = { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
      const expected = relativePath.includes('desktop') ? { width: 1440, height: 900 } : { width: 390, height: 844 }
      validImage = validImage && dimensions.width === expected.width && dimensions.height === expected.height
    }
    return {
      id: relativePath,
      passed: fs.existsSync(absolutePath) && fs.statSync(absolutePath).size > 0 && validImage,
      detail: !fs.existsSync(absolutePath) ? `Missing ${relativePath}` : isPng ? `${relativePath} · ${dimensions ? `${dimensions.width}x${dimensions.height}` : 'invalid PNG'}` : relativePath,
    }
  })
  if (isV3Run(run)) {
    const metadataPath = path.join(stageDir, 'evidence', `stage${stage}-capture.json`)
    checks.push({
      id: `evidence/stage${stage}-capture.json`,
      passed: fs.existsSync(metadataPath) && fs.statSync(metadataPath).size > 0,
      detail: fs.existsSync(metadataPath) ? path.relative(stageDir, metadataPath) : `Missing evidence/stage${stage}-capture.json`,
    })
  }
  return checks
}

function verify(root, options) {
  if (!options.id) throw new Error('--id is required')
  const runPath = path.join(root, 'runs', options.id, 'run.json')
  assert.ok(fs.existsSync(runPath), `Missing run manifest: ${runPath}`)
  const run = readJson(runPath)
  const stage = Number(options.phase ?? options.stage)
  const allowed = isV3Run(run) ? [1, 2, 3] : [1, 2, 3, 4]
  if (!allowed.includes(stage)) throw new Error(`--phase must be ${allowed.join(', ')}`)
  const stageDir = path.join(root, 'runs', options.id, `stage${stage}`)
  assert.ok(fs.existsSync(stageDir), `Missing phase directory: ${stageDir}`)
  const phaseContract = verifyPhaseContract(root, stageDir, stage, run)
  const featureMatrix = verifyFeatureMatrix(stageDir, stage, run)
  const implementationDetails = verifyImplementationDetails(stageDir, stage)
  const checks = runChecks(stageDir)
  const evidence = evidenceChecks(stageDir, stage, run)
  const contamination = checkContamination(root, options.id, stage)
  const runStage = run.stages.find((entry) => entry.number === stage)
  const verifierAttempts = (runStage?.verifierAttempts ?? 0) + 1
  const allowedRepairs = run.budget?.limits?.verifierRepairsPerPhase
  const budgetExceeded = isV3Run(run) && allowedRepairs !== undefined && verifierAttempts > allowedRepairs + 1
  const passed = checks.every((check) => check.passed) && evidence.every((check) => check.passed) && contamination.passed && !budgetExceeded
  const artifact = passed ? hashTree(stageDir) : null
  const result = {
    version: 1,
    runId: options.id,
    stage,
    verifiedAt: new Date().toISOString(),
    passed,
    artifactDigest: artifact?.digest,
    artifactFiles: artifact?.files,
    verifierAttempts,
    verifierRepairBudget: allowedRepairs ?? null,
    budgetExceeded,
    phaseContract,
    featureMatrix,
    implementationDetails,
    checks,
    evidence,
    contamination,
  }
  const outputPath = path.join(root, 'runs', options.id, 'verifications', `stage${stage}.json`)
  writeJson(outputPath, result)
  if (runStage) {
    runStage.verifierAttempts = verifierAttempts
    if (budgetExceeded) {
      runStage.status = 'budget-exceeded'
      run.status = 'budget-exceeded'
      run.validity = 'budget-exceeded'
    }
    run.updatedAt = new Date().toISOString()
    writeJson(runPath, run)
  }
  if (!passed) throw new Error(`Phase ${stage} verification failed; see ${outputPath}`)
  return { ...result, outputPath }
}

function selfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-stage-verifier-'))
  try {
    fs.writeFileSync(path.join(root, 'BENCHMARK.md'), '# Test\n')
    fs.writeFileSync(path.join(root, 'TESTING.md'), '# Test\n')
    fs.mkdirSync(path.join(root, 'specs'), { recursive: true })
    writeJson(path.join(root, 'specs', 'visual.json'), { version: 1 })
    writeJson(path.join(root, 'specs', 'benchmark-phases.json'), {
      phaseCount: 3,
      phases: [{ number: 1, specs: ['specs/visual.json'], hardGates: ['Test gate'] }],
    })
    const stageDir = path.join(root, 'runs', 'test-run', 'stage1')
    fs.mkdirSync(path.join(stageDir, 'src'), { recursive: true })
    fs.mkdirSync(path.join(stageDir, 'tests'), { recursive: true })
    fs.mkdirSync(path.join(stageDir, 'evidence'), { recursive: true })
    fs.writeFileSync(path.join(stageDir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.7.0', scripts: { test: 'true', typecheck: 'true', lint: 'true', build: 'true' } }))
    fs.writeFileSync(path.join(stageDir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    writeJson(path.join(stageDir, 'IMPLEMENTATION_DETAILS.json'), {
      version: 1,
      phase: 1,
      audio: { strategy: 'None', generatedSources: [], sampleSources: [], notes: ['Visual-only phase.'] },
    })
    fs.writeFileSync(path.join(stageDir, 'IMPLEMENTATION_PLAN.md'), '# Plan\n\nSpecs: visual.json\n\nHard gates: Test gate\n')
    fs.writeFileSync(path.join(stageDir, 'src', 'benchmark.test.js'), 'export const covered = true\n')
    const features = V3_REQUIRED_FEATURES[1].map((id) => ({ id, tests: ['src/benchmark.test.js'] }))
    writeJson(path.join(stageDir, 'tests', 'feature-matrix.json'), { version: 1, stage: 1, features })
    const pngHeader = (width, height) => {
      const bytes = Buffer.alloc(24)
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).copy(bytes)
      bytes.writeUInt32BE(width, 16)
      bytes.writeUInt32BE(height, 20)
      return bytes
    }
    fs.writeFileSync(path.join(stageDir, 'evidence', 'stage1-desktop.png'), pngHeader(1440, 900))
    fs.writeFileSync(path.join(stageDir, 'evidence', 'stage1-narrow.png'), pngHeader(390, 844))
    fs.writeFileSync(path.join(stageDir, 'evidence', 'stage1-visual-audit.md'), 'evidence')
    writeJson(path.join(stageDir, 'evidence', 'stage1-capture.json'), { version: 1, captures: [] })
    writeJson(path.join(root, 'runs', 'test-run', 'run.json'), {
      schemaVersion: 3,
      benchmarkVersion: '3.0.0',
      protocol: { version: '3.0.0' },
      id: 'test-run',
      stages: [{ number: 1, status: 'running' }],
    })
    const result = verify(root, { id: 'test-run', stage: '1' })
    assert.equal(result.passed, true)
    assert.equal(result.featureMatrix.requiredFeatures, V3_REQUIRED_FEATURES[1].length)
    assert.match(result.artifactDigest, /^[a-f0-9]{64}$/)
    const invalidDir = path.join(root, 'invalid-package-manager')
    fs.mkdirSync(invalidDir)
    fs.writeFileSync(path.join(invalidDir, 'package.json'), JSON.stringify({ packageManager: 'npm@11.0.0' }))
    fs.writeFileSync(path.join(invalidDir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    assert.throws(() => packageCommand(invalidDir, 'test'), /must declare a pnpm packageManager/)
    assert.equal(result.phaseContract.hardGates, 1)
    return { ok: true, checks: 5 }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function printHelp() {
  console.log(`Usage:
  verify-stage.mjs verify --id <run-id> --phase <1|2|3|4>
  verify-stage.mjs self-test`)
}

try {
  const { command, options } = parseArgs(process.argv.slice(2))
  const root = command === 'self-test' ? undefined : findRepoRoot(options.root)
  let result
  if (command === 'verify') result = verify(root, options)
  else if (command === 'self-test') result = selfTest()
  else {
    printHelp()
    process.exitCode = command ? 1 : 0
  }
  if (result) console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`verify-stage: ${error.message}`)
  process.exitCode = 1
}

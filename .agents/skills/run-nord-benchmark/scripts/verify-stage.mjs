#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { validateImplementationManifest } from '../../../../evaluation/lib/implementation-details.mjs'
import { findRepoRoot, parseArgs, readJson, writeJson } from '../lib/cli.mjs'

const REQUIRED_FEATURES = {
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


function packageCommand(stageDir, script) {
  assert.ok(fs.existsSync(path.join(stageDir, 'pnpm-lock.yaml')), 'Missing pnpm-lock.yaml; benchmark phases must use pnpm')
  assert.ok(!fs.existsSync(path.join(stageDir, 'package-lock.json')), 'package-lock.json is not allowed; benchmark phases must use pnpm')
  assert.ok(!fs.existsSync(path.join(stageDir, 'yarn.lock')), 'yarn.lock is not allowed; benchmark phases must use pnpm')
  const packageJson = readJson(path.join(stageDir, 'package.json'))
  assert.match(packageJson.packageManager ?? '', /^pnpm@/, 'package.json must declare a pnpm packageManager')
  return { executable: 'pnpm', args: ['run', script] }
}

function verifyFeatureMatrix(stageDir, stage) {
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
  const required = [
    ...REQUIRED_FEATURES[1],
    ...(stage >= 2 ? REQUIRED_FEATURES[2] : []),
    ...(stage >= 3 ? REQUIRED_FEATURES[3] : []),
    ...(stage >= 4 ? REQUIRED_FEATURES[4] : []),
  ]
  const missing = required.filter((id) => !entries.has(id))
  assert.deepEqual(missing, [], `Missing required feature coverage: ${missing.join(', ')}`)
  return { path: path.relative(stageDir, matrixPath), coveredFeatures: entries.size, requiredFeatures: required.length }
}

function verifyPhaseContract(root, stageDir, stage) {
  const manifestPath = path.join(root, 'specs', 'benchmark-phases.json')
  assert.ok(fs.existsSync(manifestPath), 'Missing specs/benchmark-phases.json')
  const manifest = readJson(manifestPath)
  assert.equal(manifest.phaseCount, 4, 'Benchmark phase manifest must define four phases')
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

function evidenceChecks(stageDir, stage) {
  const required = [
    `evidence/stage${stage}-desktop.png`,
    `evidence/stage${stage}-narrow.png`,
    `evidence/stage${stage}-visual-audit.md`,
  ]
  return required.map((relativePath) => {
    const absolutePath = path.join(stageDir, relativePath)
    return {
      id: relativePath,
      passed: fs.existsSync(absolutePath) && fs.statSync(absolutePath).size > 0,
      detail: fs.existsSync(absolutePath) ? relativePath : `Missing ${relativePath}`,
    }
  })
}

function verify(root, options) {
  if (!options.id) throw new Error('--id is required')
  const stage = Number(options.phase ?? options.stage)
  if (![1, 2, 3, 4].includes(stage)) throw new Error('--phase must be 1, 2, 3, or 4')
  const stageDir = path.join(root, 'runs', options.id, `stage${stage}`)
  assert.ok(fs.existsSync(stageDir), `Missing phase directory: ${stageDir}`)
  const phaseContract = verifyPhaseContract(root, stageDir, stage)
  const featureMatrix = verifyFeatureMatrix(stageDir, stage)
  const implementationDetails = verifyImplementationDetails(stageDir, stage)
  const checks = runChecks(stageDir)
  const evidence = evidenceChecks(stageDir, stage)
  const passed = checks.every((check) => check.passed) && evidence.every((check) => check.passed)
  const result = {
    version: 1,
    runId: options.id,
    stage,
    verifiedAt: new Date().toISOString(),
    passed,
    phaseContract,
    featureMatrix,
    implementationDetails,
    checks,
    evidence,
  }
  const outputPath = path.join(root, 'runs', options.id, 'verifications', `stage${stage}.json`)
  writeJson(outputPath, result)
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
      phaseCount: 4,
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
    const features = REQUIRED_FEATURES[1].map((id) => ({ id, tests: ['src/benchmark.test.js'] }))
    writeJson(path.join(stageDir, 'tests', 'feature-matrix.json'), { version: 1, stage: 1, features })
    for (const file of ['stage1-desktop.png', 'stage1-narrow.png', 'stage1-visual-audit.md']) fs.writeFileSync(path.join(stageDir, 'evidence', file), 'evidence')
    const result = verify(root, { id: 'test-run', stage: '1' })
    assert.equal(result.passed, true)
    assert.equal(result.featureMatrix.requiredFeatures, REQUIRED_FEATURES[1].length)
    const invalidDir = path.join(root, 'invalid-package-manager')
    fs.mkdirSync(invalidDir)
    fs.writeFileSync(path.join(invalidDir, 'package.json'), JSON.stringify({ packageManager: 'npm@11.0.0' }))
    fs.writeFileSync(path.join(invalidDir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
    assert.throws(() => packageCommand(invalidDir, 'test'), /must declare a pnpm packageManager/)
    assert.equal(result.phaseContract.hardGates, 1)
    return { ok: true, checks: 4 }
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

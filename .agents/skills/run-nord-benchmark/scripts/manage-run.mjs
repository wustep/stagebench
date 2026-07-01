#!/usr/bin/env node

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findRepoRoot, parseArgs, writeJson } from '../lib/cli.mjs'
import { hashTree } from '../lib/protocol.mjs'
import {
  createRun,
  finishPartialRun,
  loadRun,
  markStage,
  prepareStage,
  previewRun,
  publishRun,
  recordRunTelemetry,
  reindexRegistry,
} from '../lib/run-store.mjs'

function numberOption(value) {
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`Expected a number, received ${value}`)
  return number
}

function createOptions(options) {
  return {
    model: options.model,
    title: options.title,
    variant: options.variant,
    targetPhase: numberOption(options['target-phase'] ?? options.phase),
    official: options.official === 'true',
    isTest: options.test === 'true',
    provider: options.provider,
    modelSnapshot: options['model-snapshot'],
    reasoning: options.reasoning,
    agentVersion: options['agent-version'],
    toolBundle: options['tool-bundle'],
    browser: options.browser,
    networkPolicy: options['network-policy'],
    budgetTrack: options['budget-track'],
    wallTimeSeconds: numberOption(options['wall-time-seconds']),
    inputTokens: numberOption(options['input-tokens']),
    outputTokens: numberOption(options['output-tokens']),
    costUsd: numberOption(options['cost-usd']),
    implementationAttemptsPerPhase: numberOption(options['implementation-attempts']),
    verifierRepairsPerPhase: numberOption(options['verifier-repairs']),
    subagents: numberOption(options.subagents),
  }
}

function telemetryOptions(options) {
  const result = { phase: options.phase, kind: options.kind }
  const fields = ['wall-time-seconds', 'input-tokens', 'output-tokens', 'reasoning-tokens', 'cost-usd', 'tool-calls', 'subagents', 'implementation-attempts', 'verifier-repairs']
  for (const field of fields) {
    if (options[field] !== undefined) {
      const camel = field.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      result[camel] = numberOption(options[field])
    }
  }
  return result
}

function selfTest(sourceRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-run-manager-'))
  try {
    fs.writeFileSync(path.join(root, 'BENCHMARK.md'), '# Fixture\n')
    fs.writeFileSync(path.join(root, 'package.json'), '{}\n')
    fs.mkdirSync(path.join(root, 'specs'), { recursive: true })
    fs.copyFileSync(path.join(sourceRoot, 'specs', 'benchmark-phases.json'), path.join(root, 'specs', 'benchmark-phases.json'))
    fs.copyFileSync(path.join(sourceRoot, 'specs', 'nord-stage-4.variants.json'), path.join(root, 'specs', 'nord-stage-4.variants.json'))
    fs.mkdirSync(path.join(root, 'src', 'data'), { recursive: true })
    writeJson(path.join(root, 'src', 'data', 'runs.json'), [])

    const created = createRun(root, { model: 'Model Test', targetPhase: 2, provider: 'fixture' }, new Date('2026-01-01T00:00:00.000Z'))
    assert.deepEqual(created.selectedPhases, [1, 2])
    prepareStage(root, created.id, 1)
    markStage(root, created.id, 1, 'running')
    fs.mkdirSync(path.join(root, 'runs', created.id, 'stage1', 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, 'runs', created.id, 'stage1', 'dist', 'index.html'), '<h1>one</h1>')
    writeJson(path.join(root, 'runs', created.id, 'verifications', 'stage1.json'), { passed: true, artifactDigest: hashTree(path.join(root, 'runs', created.id, 'stage1')).digest })
    markStage(root, created.id, 1, 'complete')
    prepareStage(root, created.id, 2)
    markStage(root, created.id, 2, 'running')
    fs.mkdirSync(path.join(root, 'runs', created.id, 'stage2', 'dist'), { recursive: true })
    fs.writeFileSync(path.join(root, 'runs', created.id, 'stage2', 'dist', 'index.html'), '<h1>two</h1>')
    writeJson(path.join(root, 'runs', created.id, 'verifications', 'stage2.json'), { passed: true, artifactDigest: hashTree(path.join(root, 'runs', created.id, 'stage2')).digest })
    markStage(root, created.id, 2, 'complete')
    const published = publishRun(root, created.id)
    assert.equal(published.previewPath, '/previews/model-test/stage2/index.html')
    assert.deepEqual(Object.keys(published.previews), ['1', '2'])
    recordRunTelemetry(root, created.id, { phase: 1, wallTimeSeconds: 60, kind: 'measured' })
    assert.equal(loadRun(root, created.id).telemetry.totals.wallTimeSeconds.value, 60)
    const reindexed = reindexRegistry(root)
    assert.equal(reindexed.count, 1)
    return { ok: true, checks: 7, targetPhase: 2 }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function printHelp() {
  console.log(`Usage:
  manage-run.mjs create --model <id> [--target-phase <1|2|3>] [provenance and budget options]
  manage-run.mjs prepare --id <run-id> --phase <1|2|3>
  manage-run.mjs mark --id <run-id> --phase <1|2|3> --status <status>
  manage-run.mjs telemetry --id <run-id> [--phase <1|2|3>] --<metric> <value> [--kind measured|estimated|unavailable]
  manage-run.mjs status --id <run-id>
  manage-run.mjs preview|partial|publish --id <run-id>
  manage-run.mjs reindex
  manage-run.mjs self-test`)
}

try {
  const { command, options } = parseArgs(process.argv.slice(2))
  const root = findRepoRoot(options.root)
  let result
  if (command === 'create') result = createRun(root, createOptions(options))
  else if (command === 'prepare') result = prepareStage(root, options.id, options.phase ?? options.stage)
  else if (command === 'mark') result = markStage(root, options.id, options.phase ?? options.stage, options.status)
  else if (command === 'telemetry') result = recordRunTelemetry(root, options.id, telemetryOptions(options))
  else if (command === 'status') result = loadRun(root, options.id)
  else if (command === 'preview') result = previewRun(root, options.id)
  else if (command === 'partial') result = finishPartialRun(root, options.id)
  else if (command === 'publish') result = publishRun(root, options.id)
  else if (command === 'reindex') result = reindexRegistry(root)
  else if (command === 'self-test') result = selfTest(root)
  else { printHelp(); process.exitCode = command ? 1 : 0 }
  if (result) console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(`manage-run: ${error.message}`)
  process.exitCode = 1
}

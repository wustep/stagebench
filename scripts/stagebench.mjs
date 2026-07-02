#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { findRepoRoot, parseArgs } from '../.agents/skills/run-nord-benchmark/lib/cli.mjs'
import { createBlindEvaluationBundle } from '../.agents/skills/run-nord-benchmark/lib/blind-evaluation.mjs'
import { createPhaseBundle, importPhaseBundle, runInContainer } from '../.agents/skills/run-nord-benchmark/lib/phase-bundle.mjs'
import {
  archiveRunCaches,
  createRun,
  finishPartialRun,
  loadRun,
  markStage,
  prepareStage,
  previewRun,
  publishRun,
  recordAgentIdentity,
  recordRunTelemetry,
  reindexRegistry,
  resumePlan,
  retargetRun,
} from '../.agents/skills/run-nord-benchmark/lib/run-store.mjs'
import { loadProtocol } from '../.agents/skills/run-nord-benchmark/lib/protocol.mjs'

const COMMANDS = {
  doctor: 'Validate the host, protocol, references, and public data contracts.',
  create: 'Create a provenance-rich run with --target-phase 1, 2, or 3.',
  bundle: 'Create a solution-free, one-phase candidate workspace.',
  import: 'Import only candidate output from an isolated phase workspace.',
  exec: 'Run a command inside the phase bundle Docker sandbox.',
  prepare: 'Prepare a selected phase after its predecessor completes.',
  mark: 'Advance a phase through the durable state machine.',
  telemetry: 'Record measured, estimated, or unavailable run telemetry.',
  identity: 'Record verified response-model and agent identity details.',
  status: 'Print the authoritative per-run manifest.',
  resume: 'Print the next durable action for an interrupted run.',
  retarget: 'Extend a run to a higher cumulative target phase.',
  verify: 'Run the phase verifier and seal its artifact digest.',
  blind: 'Create an opaque evaluator bundle with a private identity mapping.',
  evaluate: 'Create, score, or rebuild a blinded evaluation.',
  capture: 'Capture canonical desktop and narrow screenshots.',
  preview: 'Publish previews for completed phases.',
  publish: 'Publish a completed selected target.',
  partial: 'End a run as incomplete and non-comparable.',
  archive: 'Remove only regenerable per-run dependency/tool caches.',
  reindex: 'Regenerate src/data/runs.json from authoritative run.json files.',
  validate: 'Validate all persisted data against JSON Schemas.',
}

function number(value) {
  if (value === undefined) return undefined
  const result = Number(value)
  if (!Number.isFinite(result)) throw new Error(`Expected a number, received ${value}`)
  return result
}

function createMetadata(options) {
  return {
    model: options.model,
    title: options.title,
    variant: options.variant,
    targetPhase: number(options['target-phase'] ?? options.phase),
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
    wallTimeSeconds: number(options['wall-time-seconds']),
    inputTokens: number(options['input-tokens']),
    outputTokens: number(options['output-tokens']),
    costUsd: number(options['cost-usd']),
    implementationAttemptsPerPhase: number(options['implementation-attempts']),
    verifierRepairsPerPhase: number(options['verifier-repairs']),
    subagents: number(options.subagents),
  }
}

function telemetryMetadata(options) {
  const result = { phase: options.phase, kind: options.kind }
  for (const field of ['wall-time-seconds', 'input-tokens', 'output-tokens', 'reasoning-tokens', 'cost-usd', 'tool-calls', 'subagents', 'implementation-attempts', 'verifier-repairs']) {
    if (options[field] === undefined) continue
    result[field.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = number(options[field])
  }
  return result
}

function runNode(root, script, args) {
  const result = spawnSync(process.execPath, [path.join(root, script), ...args], { cwd: root, encoding: 'utf8', stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(script)} exited with ${result.status}`)
  return { ok: true }
}

function doctor(root, options = {}) {
  const protocol = loadProtocol(root)
  const commands = ['git', 'pnpm', 'docker'].map((command) => {
    const result = spawnSync(command, ['--version'], { cwd: root, encoding: 'utf8' })
    return { command, available: result.status === 0, version: (result.stdout || result.stderr || '').trim() }
  })
  const references = [protocol.value.manual.path, ...new Set(JSON.parse(fs.readFileSync(path.join(root, protocol.value.variants), 'utf8')).variants.map((variant) => variant.referenceImage))]
    .map((relative) => ({ path: relative, present: fs.existsSync(path.join(root, relative)), bytes: fs.existsSync(path.join(root, relative)) ? fs.statSync(path.join(root, relative)).size : 0 }))
  const official = options.official === 'true'
  return {
    ok: Boolean(commands.find((entry) => entry.command === 'git')?.available && commands.find((entry) => entry.command === 'pnpm')?.available && references.every((entry) => entry.present) && (!official || commands.find((entry) => entry.command === 'docker')?.available)),
    officialRequirementsApplied: official,
    protocol: { version: protocol.value.version, digest: protocol.digest, phases: protocol.value.phaseCount },
    commands,
    references,
    diskFreeBytes: fs.statfsSync(root).bavail * fs.statfsSync(root).bsize,
  }
}

function printHelp() {
  console.log('Stagebench benchmark CLI\n')
  console.log('Usage: pnpm stagebench <command> [--option value]\n')
  for (const [command, description] of Object.entries(COMMANDS)) console.log(`  ${command.padEnd(10)} ${description}`)
  console.log('\nTarget selection is cumulative: 1 => [1], 2 => [1,2], 3 => [1,2,3].')
  console.log('Mutating commands accept --dry-run true. Successful command results are emitted as JSON.')
}

try {
  const { command, options } = parseArgs(process.argv.slice(2))
  if (!command || command === 'help') {
    printHelp()
  } else if (!COMMANDS[command]) {
    throw new Error(`Unknown command: ${command}`)
  } else {
    const root = findRepoRoot(options.root)
    let result
    if (options['dry-run'] === 'true' && !['doctor', 'status', 'validate'].includes(command)) {
      result = { dryRun: true, command, options, message: 'No filesystem or process changes were made.' }
    } else if (command === 'doctor') result = doctor(root, options)
    else if (command === 'create') {
      const health = doctor(root, options)
      if (!health.ok) throw new Error('Preflight failed for the requested run class; run pnpm stagebench doctor with the same options')
      result = createRun(root, createMetadata(options))
    }
    else if (command === 'bundle') result = createPhaseBundle(root, options.id, options.phase, { force: options.force === 'true' })
    else if (command === 'import') result = importPhaseBundle(root, options.id, options.phase)
    else if (command === 'exec') result = runInContainer(root, options.id, options.phase, options.command, { image: options.image, network: options.network, inherit: true })
    else if (command === 'prepare') result = prepareStage(root, options.id, options.phase)
    else if (command === 'mark') result = markStage(root, options.id, options.phase, options.status)
    else if (command === 'telemetry') result = recordRunTelemetry(root, options.id, telemetryMetadata(options))
    else if (command === 'identity') result = recordAgentIdentity(root, options.id, {
      provider: options.provider,
      model: options.model,
      modelSnapshot: options['model-snapshot'],
      responseModelId: options['response-model-id'],
      reasoning: options.reasoning,
      agentVersion: options['agent-version'],
      toolBundle: options['tool-bundle'],
    })
    else if (command === 'status') result = loadRun(root, options.id)
    else if (command === 'resume') result = resumePlan(root, options.id)
    else if (command === 'retarget') result = retargetRun(root, options.id, options['target-phase'] ?? options.phase)
    else if (command === 'verify') {
      markStage(root, options.id, options.phase, 'verifying')
      try {
        result = runNode(root, '.agents/skills/run-nord-benchmark/scripts/verify-stage.mjs', ['verify', '--id', options.id, '--phase', options.phase])
        markStage(root, options.id, options.phase, 'verified')
      } catch (error) {
        const failedRun = loadRun(root, options.id)
        const failedStage = failedRun.stages.find((entry) => entry.number === Number(options.phase))
        if (failedStage?.status !== 'budget-exceeded') markStage(root, options.id, options.phase, 'running')
        throw error
      }
    }
    else if (command === 'blind') result = createBlindEvaluationBundle(root, options.id, options.phase, { allowIdentityLeaks: options['allow-identity-leaks'] === 'true' })
    else if (command === 'evaluate') result = runNode(root, '.agents/skills/run-nord-benchmark/scripts/evaluate-run.mjs', [options.action ?? 'template', '--id', options.id, ...(options.phase ? ['--phase', options.phase] : []), ...(options.assessment ? ['--assessment', options.assessment] : [])])
    else if (command === 'capture') result = runNode(root, 'scripts/capture-evidence.mjs', ['capture', '--id', options.id, '--phase', options.phase, '--url', options.url])
    else if (command === 'preview') result = previewRun(root, options.id)
    else if (command === 'publish') result = publishRun(root, options.id)
    else if (command === 'partial') result = finishPartialRun(root, options.id)
    else if (command === 'archive') result = archiveRunCaches(root, options.id)
    else if (command === 'reindex') result = reindexRegistry(root)
    else if (command === 'validate') result = runNode(root, 'scripts/validate-data.mjs', [])
    if (result && command !== 'verify' && command !== 'evaluate' && command !== 'capture' && command !== 'validate') console.log(JSON.stringify(result, null, 2))
    if (command === 'doctor' && result && !result.ok) process.exitCode = 1
  }
} catch (error) {
  console.error(`stagebench: ${error.message}`)
  process.exitCode = 1
}

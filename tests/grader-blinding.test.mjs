// The grader is blind: nothing it is given says which model produced the
// artifact. Regression tests for the protocol-3 leak in which the grader's
// copy of the seal record (inputs/verification.json) kept the `usage` and
// `budget` blocks, so six graders were shown the producing model's id.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import {
  BlindingError, EVAL_BLINDING_VERSION, assertBlindInputs, blindVerification, knownIdentities, namePattern, producerIdentities, recordIdentities,
} from '../bench/lib/eval/blinding.mjs'
import { readJson } from '../bench/lib/shared.mjs'

const sourceRoot = path.resolve(import.meta.dirname, '..')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-blinding-test-'))
process.env.STAGEBENCH_HOME = path.join(scratch, 'home')
after(() => fs.rmSync(scratch, { recursive: true, force: true }))

const ID = 'gpt-6-2-astra-p3'
const BLIND = 'run-0123456789ab'

// A seal record with every way it has, or could, name its producer: the
// usage and budget blocks as protocol 3 wrote them, the isolation record, seal
// attempts, timestamps, other runs' origins, fields the seal might add later,
// and free text with the model's id in every punctuation.
function leakyRecord(root = '/Users/operator/Projects/stagebench-astra') {
  return {
    version: 4,
    runId: ID,
    stage: 2,
    protocolVersion: '3.0.0',
    verifiedAt: '2026-11-18T06:42:19.731Z',
    passed: true,
    artifactDigest: 'c'.repeat(64),
    artifactFiles: 79,
    materials: { 'specs/nord-stage-4.visual.json': { version: '1.5.0', digest: 'd'.repeat(64) } },
    phaseContract: { specs: ['specs/nord-stage-4.visual.json', 'specs/nord-stage-4.piano.json'], hardGates: 5 },
    featureMatrix: { coveredFeatures: 20, requiredFeatures: 20 },
    implementationDetails: {
      audioStrategy: 'Grand multisamples at minor thirds. Built by GPT 6.2 Astra (gpt-6.2-astra, served as openai/gpt-6.2-astra, a.k.a. GPT-6.2-Astra and gpt_6_2_astra).',
      generatedSources: 1,
      sampleSources: 2,
    },
    checks: [
      { id: 'test', command: 'pnpm run test', passed: true, durationMs: 9116, detail: 'Passed', isolation: 'lockdown' },
      { id: 'lint', command: 'pnpm run lint', passed: false, durationMs: 728, detail: `${root}/runs/${ID}/stage2/src/a.ts: error (gpt-6-2-sol-p3 style) at 2026-11-18T06:40:01Z under ${os.homedir()}/.stagebench; anthropic`, isolation: 'lockdown', where: 'sb-4127176862' },
    ],
    evidence: [
      { id: 'evidence/stage2-desktop.png', passed: true, detail: 'evidence/stage2-desktop.png · 1440x900' },
      { id: 'dist/index.html standards mode', advisory: true, passed: true, detail: 'dist/index.html opens with <!doctype html>' },
      { id: 'feature tests executed', passed: true, detail: 'Every feature maps to an executed, passing test (6 files ran)' },
      { id: 'sample provenance', passed: true, detail: '50 bundled audio files, all declared: 50 from the sample pack' },
      { id: 'artifact does not name its producer', passed: true, detail: 'Neither the run id nor the model name (gpt-6.2-astra) appears' },
      { id: 'agent instruction files', advisory: true, passed: true, detail: 'The artifact carries no agent instruction files' },
      { id: 'lockdown decoys', advisory: true, passed: true, detail: 'The decoy scoring files inside the box were not read' },
      { id: 'transcripts', passed: true, detail: 'rollout-2026-11-18T05-47-50.jsonl (Codex CLI)' },
      { id: 'asset provenance', advisory: true, passed: false, detail: '3 of 50 bundled assets are byte-identical to assets outside this run: run:gpt-6-2-sol-p3 (3)' },
      // One the seal may add later: unknown, so it stays out.
      { id: 'gateway usage', advisory: true, passed: true, detail: '36 requests to gpt-6.2-astra at high effort, $2.88' },
    ],
    isolation: {
      mode: 'lockdown',
      session: 'sb-4127176862',
      launches: [{ index: 0, harness: 'Codex CLI', harnessVersion: 'codex-cli 0.169.0', auth: 'chatgpt', model: 'gpt-6.2-astra', startedAt: '2026-11-18T05:47:50.000Z', operatorMessage: 'fix the plan' }],
      operator: { messages: [{ template: 'initial', at: '2026-11-18T05:47:50.000Z' }] },
      gateway: {
        models: { 'gpt-6.2-astra': 36 },
        deniedTargets: { 'auth.openai.com:443': 49, 'chatgpt.com/backend-api/codex/responses': 7 },
        usage: { byModel: { 'gpt-6.2-astra': { requests: 36, priceId: null } } },
      },
    },
    sampleProvenance: {
      version: 1,
      pack: { id: 'stagebench-raw-samples', version: '2.0.0', manifestSha256: 'e'.repeat(64) },
      bundled: 50,
      bundledBytes: 6902078,
      declared: 50,
      fromPack: 50,
      generated: 0,
      sources: { 'salamander-grand-v3': { name: 'Salamander Grand Piano V3', license: 'CC-BY-3.0', files: 50 } },
      unverifiable: [],
      inlineAudio: [],
      acoustic: { checked: 50, matched: 50, threshold: 0.8, lowestMatch: 0.9145, failed: [], where: 'lockdown' },
      problems: [],
      toMatch: [{ path: 'public/samples/a.ogg', packFile: 'grand/a.flac' }],
    },
    audio: { file: 'evidence/stage2-audio.json', plan: 'stagebench-audio-1', status: 'measured', failure: null, scores: { notesSounding: 19, notesTotal: 19, latencyMs: 5.2 } },
    assetProvenance: { version: 1, assets: 50, bytes: 6902078, matched: 3, matchedOrigins: { 'run:gpt-6-2-sol-p3': 3 }, matches: [{ path: 'public/samples/a.ogg', sources: ['run:gpt-6-2-sol-p3/stage2/public/samples/a.ogg'] }] },
    seal: { outcome: 'passed', attempts: 3, sealFailureRelays: 2, sealFailureLimit: 2 },
    usage: {
      source: 'gateway',
      requests: 36,
      inputTokens: 1995132,
      cachedInputTokens: 1885184,
      outputTokens: 31124,
      reasoningTokens: 5723,
      costUsd: 2.8786,
      totalTokens: 2026256,
      byModel: {
        'gpt-6.2-astra': { requests: 36, outputTokens: 31124, costUsd: 2.8786, priceId: 'gpt-6.2-astra' },
        'openai/gpt-6.2-astra': { requests: 1, priceId: 'gpt-6.2-astra' },
        astra: { requests: 1, priceId: 'astra' },
      },
      efforts: { 'gpt-6.2-astra:high': 36 },
      responseModels: { 'gpt-6.2-astra -> gpt-6.2-astra-2026-11-01': 36 },
      requestIds: { count: 36, first: 'resp_1', last: 'resp_36', sha256: 'f'.repeat(64) },
      prices: { asOf: '2026-11-17', sha256: 'a'.repeat(64), path: 'bench/prices.json' },
      unpriced: [],
    },
    budget: {
      rules: { effort: 'high', agentMinutes: 180, outputTokens: 4000000 },
      used: { agentSeconds: 1085, outputTokens: 31124 },
      status: 'within',
      effort: { pinned: 'high', launches: ['high'], ok: true, primaryModel: 'gpt-6.2-astra', observed: { 'gpt-6.2-astra:high': 36, 'astra:high': 1 } },
    },
    operatorPatch: { of: { run: 'gpt-6-2-sol-p3', phase: 2 }, reason: 'operator fixed a typo' },
    // Fields the seal does not write today. If it ever does, they stay out.
    provider: 'openai',
    vendor: 'OpenAI',
    harness: 'Codex CLI',
    model: 'gpt-6.2-astra',
    producer: { displayName: 'GPT 6.2 Astra', shortName: 'Astra', slashed: 'openai/gpt-6.2-astra' },
  }
}

const NAMES = ['gpt-6-2-astra-p3', 'gpt-6.2-astra', 'GPT 6.2 Astra High', 'gpt-6-2-sol-p3', 'gpt-6.2-sol', 'GPT 6.2 Sol High']
const VENDORS = ['anthropic', 'openai']

function keysOf(value, found = new Set()) {
  if (Array.isArray(value)) for (const entry of value) keysOf(entry, found)
  else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      found.add(key)
      keysOf(entry, found)
    }
  }
  return found
}

function assertNamesNobody(blind, label) {
  const text = JSON.stringify(blind)
  // Every spelling of the producer, of the other run, of the vendors and the harness.
  for (const giveaway of [
    'gpt-6-2-astra-p3', 'gpt-6.2-astra', 'gpt-6-2-astra', 'gpt_6_2_astra', 'GPT 6.2 Astra', 'GPT-6.2-Astra', 'openai/gpt-6.2-astra', 'astra',
    'gpt-6-2-sol-p3', 'gpt-6.2-sol', 'openai', 'anthropic', 'codex', 'chatgpt', 'sb-4127176862', 'lockdown', 'fix the plan', 'operator',
    'priceId', 'costUsd', '2.8786', '1995132', '31124', '/Users/operator', os.homedir(), '2026-11-18', '2026-11-17', 'gateway usage', 'transcripts', 'rollout',
  ]) {
    assert.equal(text.toLowerCase().includes(giveaway.toLowerCase()), false, `${label}: the grader must not see "${giveaway}"`)
  }
  for (const name of NAMES) assert.equal(namePattern(name).test(text), false, `${label}: no spelling of ${name} survives`)
  // Whole blocks that describe how the artifact was produced, wherever they would sit.
  const keys = keysOf(blind)
  for (const key of [
    'usage', 'budget', 'byModel', 'efforts', 'responseModels', 'primaryModel', 'observed', 'effort', 'priceId', 'costUsd', 'requestIds', 'prices',
    'isolation', 'launches', 'operator', 'operatorPatch', 'seal', 'attempts', 'verifiedAt', 'protocolVersion', 'where', 'matchedOrigins', 'matches',
    'problems', 'toMatch', 'provider', 'vendor', 'harness', 'model', 'producer', 'shortName', 'displayName',
  ]) {
    assert.equal(keys.has(key), false, `${label}: no "${key}" field reaches the grader`)
  }
}

test('the grader’s copy of the seal record keeps the artifact and nothing that names its producer', () => {
  const root = '/Users/operator/Projects/stagebench-astra'
  const record = leakyRecord(root)
  const before = structuredClone(record)
  const blind = blindVerification(record, ID, BLIND, { root, names: NAMES, vendors: VENDORS })
  assertNamesNobody(blind, 'with the known names')
  assert.deepEqual(record, before, 'the stored record itself is untouched')

  // What describes the artifact is all still there.
  assert.deepEqual(Object.keys(blind), ['runId', 'stage', 'passed', 'artifactDigest', 'artifactFiles', 'materials', 'phaseContract', 'featureMatrix', 'implementationDetails', 'checks', 'evidence', 'sampleProvenance', 'audio', 'assetProvenance'])
  assert.equal(blind.runId, BLIND)
  assert.deepEqual([blind.stage, blind.passed, blind.artifactDigest, blind.artifactFiles], [2, true, 'c'.repeat(64), 79])
  assert.deepEqual(blind.materials, record.materials)
  assert.deepEqual(blind.phaseContract, record.phaseContract)
  assert.deepEqual(blind.featureMatrix, record.featureMatrix)
  assert.equal(blind.implementationDetails.audioStrategy, 'Grand multisamples at minor thirds. Built by [redacted] ([redacted], served as [redacted], a.k.a. [redacted] and [redacted]).')
  assert.deepEqual(blind.checks.map(({ id, passed, durationMs }) => [id, passed, durationMs]), [['test', true, 9116], ['lint', false, 728]])
  assert.equal(blind.checks[1].detail, `<artifact>/stage2/src/a.ts: error ([redacted] style) at [timestamp] under ~/.stagebench; [redacted]`)
  assert.deepEqual(blind.evidence.map((entry) => entry.id), ['evidence/stage2-desktop.png', 'dist/index.html standards mode', 'feature tests executed', 'sample provenance', 'asset provenance'])
  assert.equal(blind.evidence.at(-1).detail, '3 of 50 bundled assets are byte-identical to assets that already exist outside this artifact')
  const { version: _version, problems: _problems, toMatch: _toMatch, acoustic: { where: _where, ...acoustic }, ...samples } = record.sampleProvenance
  assert.deepEqual(blind.sampleProvenance, { ...samples, acoustic }, 'where the samples came from is the grader’s business')
  assert.deepEqual(blind.audio, record.audio)
  assert.deepEqual(blind.assetProvenance, { assets: 50, matched: 3 }, 'the count survives; the origins do not')
})

test('the seal record’s own model ids are scrubbed even when the caller passes no names', () => {
  const blind = blindVerification(leakyRecord(), ID, BLIND)
  const text = JSON.stringify(blind)
  for (const giveaway of ['gpt-6.2-astra', 'GPT 6.2 Astra', 'gpt_6_2_astra', 'gpt-6-2-astra']) assert.equal(text.includes(giveaway), false, `"${giveaway}" is in the record, so it is known`)
  assert.deepEqual(recordIdentities(leakyRecord()).sort(), ['astra', 'gpt-6-2-astra-p3', 'gpt-6.2-astra', 'gpt-6.2-astra-2026-11-01', 'openai/gpt-6.2-astra'])
})

test('every committed seal record, blinded, names no model and no run', () => {
  const { names, vendors } = knownIdentities(sourceRoot, { id: 'unused' })
  // The two runs the audit found the leak in are among the names it knows.
  for (const name of ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6-2-astra-p3', 'GPT 6.2 Sol High', 'claude-opus-5-5', 'claude-haiku-4-5-20251001']) assert.ok(names.includes(name), name)
  assert.deepEqual(vendors, ['anthropic', 'openai'])
  const patterns = names.map(namePattern).filter(Boolean)
  let checked = 0
  for (const id of fs.readdirSync(path.join(sourceRoot, 'runs'))) {
    const directory = path.join(sourceRoot, 'runs', id, 'verifications')
    if (!fs.existsSync(directory)) continue
    const run = readJson(path.join(sourceRoot, 'runs', id, 'run.json'))
    for (const file of fs.readdirSync(directory).filter((name) => name.endsWith('.json'))) {
      const record = readJson(path.join(directory, file))
      const identities = knownIdentities(sourceRoot, { id, producerNames: [run.model, run.title, run.agent?.model].filter(Boolean), record })
      const blind = blindVerification(record, id, BLIND, { root: sourceRoot, names: identities.names, vendors: identities.vendors })
      const text = JSON.stringify(blind)
      for (const pattern of patterns) assert.equal(pattern.test(text), false, `runs/${id}/verifications/${file}: ${pattern} survives`)
      for (const key of ['usage', 'budget', 'isolation', 'seal', 'verifiedAt', 'byModel', 'efforts', 'responseModels', 'primaryModel', 'priceId']) assert.equal(keysOf(blind).has(key), false, `runs/${id}/verifications/${file}: ${key}`)
      checked += 1
    }
  }
  assert.ok(checked >= 80, `checked ${checked} committed records`)
})

// --- the guard ------------------------------------------------------------------------------

function graderWorkspace() {
  const workspace = fs.mkdtempSync(path.join(scratch, 'ws-'))
  const write = (relative, content) => {
    fs.mkdirSync(path.dirname(path.join(workspace, relative)), { recursive: true })
    fs.writeFileSync(path.join(workspace, relative), content)
  }
  write('EVAL.md', '# Stagebench evaluation — Phase 2 (run-0123456789ab)\n\nThis evaluation must be produced by `claude-opus-5`.\n')
  write('.assessment.template.json', JSON.stringify({ runId: BLIND, evaluatorModel: 'claude-opus-5' }))
  write('inputs/rubric.json', JSON.stringify({ evaluator: { model: 'claude-opus-5', label: 'Claude Opus 5', pinnedId: 'claude-opus-5' } }))
  write('inputs/TASK.md', '# Task\nRecreate the Nord Stage 4.\n')
  write('inputs/verification.json', JSON.stringify(blindVerification(leakyRecord(), ID, BLIND, { names: NAMES, vendors: VENDORS })))
  write('inputs/reference/nord-stage-4.pdf', Buffer.from([0x25, 0x50, 0x44, 0x46, 0, 0xff, 0xfe]))
  write('artifact/src/app.ts', 'export const app = 1 // compared against claude-opus-5-5 output\n')
  write('build/index.html', '<!doctype html><title>Stage</title>')
  return { workspace, write }
}

const GUARD = { names: [...NAMES, 'claude-opus-5', 'Claude Opus 5 High', 'claude-opus-5-5'], producer: producerIdentities({ id: ID, producerNames: ['gpt-6.2-astra', 'GPT 6.2 Astra High'], record: leakyRecord() }), grader: ['claude-opus-5', 'Claude Opus 5'] }

test('the guard passes blind inputs and says what it checked', () => {
  const { workspace } = graderWorkspace()
  const result = assertBlindInputs(workspace, GUARD)
  assert.equal(result.version, EVAL_BLINDING_VERSION)
  assert.equal(EVAL_BLINDING_VERSION, 2)
  // EVAL.md, the template, rubric, TASK.md, verification.json, and the two candidate files; the PDF is reference material.
  assert.equal(result.filesChecked, 7)
  assert.equal(result.namesChecked, 9)
})

test('the guard fails closed on any spelling of a known model or run in a grader input', () => {
  for (const leak of [
    '"byModel":{"gpt-6.2-astra":{}}', '"efforts":{"gpt-6.2-astra:high":36}', '"responseModels":{"gpt-6.2-astra -> gpt-6.2-astra":1}', '"primaryModel":"gpt-6.2-astra"',
    'gpt-6-2-astra', 'GPT 6.2 Astra', 'GPT-6.2-ASTRA', 'gpt_6_2_astra', 'openai/gpt-6.2-astra', 'gpt-6-2-astra-p3', 'gpt-6.2-sol', 'GPT 6.2 Sol High', 'claude-opus-5-5',
  ]) {
    const { workspace, write } = graderWorkspace()
    write('inputs/verification.json', JSON.stringify({ runId: BLIND, note: leak }))
    assert.throws(() => assertBlindInputs(workspace, GUARD), (error) => error instanceof BlindingError && /inputs\/verification\.json/.test(error.message) && /Nothing was launched or registered/.test(error.message), leak)
  }
})

test('the pinned grader may be named only where the grader is told what it must be', () => {
  // In rubric.json, EVAL.md, and the template it is the same for every run, so it is allowed there…
  assert.doesNotThrow(() => assertBlindInputs(graderWorkspace().workspace, GUARD))
  // …and nowhere else, because there it could only be about the producer.
  for (const file of ['inputs/verification.json', 'inputs/TASK.md', 'inputs/specs/nord-stage-4.visual.json']) {
    const { workspace, write } = graderWorkspace()
    write(file, 'Built by Claude Opus 5.')
    assert.throws(() => assertBlindInputs(workspace, GUARD), new RegExp(file.replace(/[./]/g, '\\$&')), file)
  }
  // Another model's name in the rubric is not the grader's own.
  const { workspace, write } = graderWorkspace()
  write('inputs/rubric.json', JSON.stringify({ evaluator: { model: 'claude-opus-5' }, note: 'calibrated on gpt-6.2-sol' }))
  assert.throws(() => assertBlindInputs(workspace, GUARD), /inputs\/rubric\.json: "gpt-6\.2-sol"/)
})

test('the guard fails closed on the producer’s name in its copy of the artifact or build, and on what it cannot read', () => {
  // Another model's name in the candidate's own code is the candidate's business.
  assert.doesNotThrow(() => assertBlindInputs(graderWorkspace().workspace, GUARD))
  for (const file of ['artifact/IMPLEMENTATION_PLAN.md', 'build/assets/index.js']) {
    const { workspace, write } = graderWorkspace()
    write(file, 'made by gpt-6.2-astra')
    assert.throws(() => assertBlindInputs(workspace, GUARD), new RegExp(`${file.replace(/[./]/g, '\\$&')}: "gpt-6\\.2-astra"`), file)
  }
  const binary = graderWorkspace()
  binary.write('inputs/blob.bin', Buffer.from([1, 0, 2, 0]))
  assert.throws(() => assertBlindInputs(binary.workspace, GUARD), /inputs\/blob\.bin for model names: it is not text/)
  assert.throws(() => assertBlindInputs(graderWorkspace().workspace, { ...GUARD, names: [] }), /no known model or run names/)
  const empty = fs.mkdtempSync(path.join(scratch, 'empty-'))
  assert.throws(() => assertBlindInputs(empty, GUARD), /has no EVAL\.md/)
})

test('the known names come from the price table and every run record, and the guard refuses without them', () => {
  const root = fs.mkdtempSync(path.join(scratch, 'repo-'))
  fs.mkdirSync(path.join(root, 'bench'), { recursive: true })
  assert.throws(() => knownIdentities(root, { id: 'x' }), /price table that lists every known model id/)
  fs.writeFileSync(path.join(root, 'bench', 'prices.json'), JSON.stringify({ models: { 'gpt-6.2-sol': { provider: 'openai' } }, aliases: { 'claude-haiku-4-5-20251001': 'claude-haiku-4-5' } }))
  fs.mkdirSync(path.join(root, 'runs', 'kimi-k3'), { recursive: true })
  fs.writeFileSync(path.join(root, 'runs', 'kimi-k3', 'run.json'), JSON.stringify({ id: 'kimi-k3', model: 'kimi-k3', title: 'Kimi K3', agent: { model: 'kimi-k3' } }))
  const { names, vendors } = knownIdentities(root, { id: ID, producerNames: ['GPT 6.2 Astra High'], record: leakyRecord() })
  for (const name of [ID, 'GPT 6.2 Astra High', 'gpt-6.2-astra', 'gpt-6.2-sol', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5', 'kimi-k3', 'Kimi K3']) assert.ok(names.includes(name), name)
  assert.deepEqual(vendors, ['openai'])
  // A run record that cannot be read is not skipped.
  fs.writeFileSync(path.join(root, 'runs', 'kimi-k3', 'run.json'), '{')
  assert.throws(() => knownIdentities(root, { id: ID }))
})

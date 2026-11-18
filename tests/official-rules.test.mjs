// The rules an official protocol-3 run is held to beyond the lockdown itself:
// a fixed number of seal-failure rounds, a fixed budget, usage and cost from the
// gateway rather than an operator, a candidate that is not told who it is, a
// grader whose served model id is recorded, and rubric 3.0.0's harness-measured
// sound bound to the runs created under it. No container engine or network.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { loadRubric, rubricVersionForRun } from '../bench/lib/eval/evaluate.mjs'
import { createAssessmentTemplate, measurementScore, mergeAssessments, scoreAssessment, scoreHarnessCriterion, validateAssessment } from '../bench/lib/eval/scoring.mjs'
import { BudgetSpent, agentSeconds, budgetRecord, nextLaunchAllowance, rulesFromManifest, runRules, sealFailureRelays, sealFailureRoundRefusal } from '../bench/lib/run/rules.mjs'
import { createRun, loadRun, markSealed, recordTelemetry, registryEntry, runFootnotes, saveRun } from '../bench/lib/run/store.mjs'
import { startPhase } from '../bench/lib/run/workspace.mjs'
import { hashTree, readJson, writeJson } from '../bench/lib/shared.mjs'
import { loadPrices, normalizeUsage, priceFor, primaryModel, responseCost, summarizeUsage } from '../bench/lib/usage.mjs'
import { extractResponseModel, extractUsage, normalizeConfig, reduceUsage, requestedEffort } from '../bench/lockdown/image/gateway.mjs'
import { HARNESSES, resolveAuth } from '../bench/lockdown/harnesses.mjs'
import { CANDIDATE_MESSAGES, neutralizeFailure } from '../bench/lockdown/messages.mjs'
import { findIdentityLeaks, isHarnessSurface, parseSections } from '../bench/lockdown/redteam/identity.mjs'
import { graderRecord } from '../bench/lockdown/seal.mjs'
import { boxEnvironment, sessionStateDir } from '../bench/lockdown/session.mjs'

const sourceRoot = path.resolve(import.meta.dirname, '..')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-rules-test-'))
process.env.STAGEBENCH_HOME = path.join(scratch, 'home')
after(() => fs.rmSync(scratch, { recursive: true, force: true }))

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(scratch, 'repo-'))
  for (const relative of [
    'BENCHMARK.md', 'TASK.md', 'package.json', 'bench/rubric.json', 'bench/prices.json',
    'specs/benchmark-phases.json', 'specs/nord-stage-4.variants.json', 'specs/nord-stage-4.visual.json', 'specs/nord-stage-4.piano.json',
    'prompts/stage1.md', 'bench/schemas/implementation-details.schema.json', 'bench/starter/package.json', 'bench/starter/index.html',
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    fs.copyFileSync(path.join(sourceRoot, relative), path.join(root, relative))
  }
  writeJson(path.join(root, 'src/data/runs.json'), [])
  return root
}

const launch = (minutes, extra = {}) => ({ startedAt: '2026-11-17T00:00:00.000Z', endedAt: new Date(Date.parse('2026-11-17T00:00:00.000Z') + minutes * 60_000).toISOString(), effort: 'high', ...extra })
const RULES = { sealFailureRounds: 2, budget: { effort: 'high', agentMinutes: 180, outputTokens: 4_000_000 } }

// --- the rules themselves -----------------------------------------------------

test('the official rules come from the protocol manifest and are copied into a run at creation', () => {
  const manifest = readJson(path.join(sourceRoot, 'specs/benchmark-phases.json'))
  assert.deepEqual(rulesFromManifest(manifest), RULES)
  const root = fixtureRoot()
  const created = createRun(root, { model: 'rules-fixture', target: '1' })
  assert.deepEqual(created.run.protocol.rules, RULES)
  assert.deepEqual(runRules(created.run), RULES, 'a locked protocol-3 run is held to its copy')
  assert.equal(runRules({ ...created.run, isolation: 'none' }), null, 'an opted-out run has no official rules')
  assert.equal(runRules({ ...created.run, protocol: { version: '2.0.0', rules: RULES } }), null, 'nor does a protocol-2 run')
  // Editing the manifest afterwards does not reach a run that already exists.
  const edited = { ...manifest, officialRules: { ...manifest.officialRules, sealFailureRounds: { limit: 9 } } }
  fs.writeFileSync(path.join(root, 'specs/benchmark-phases.json'), JSON.stringify(edited))
  assert.equal(loadRun(root, created.id).protocol.rules.sealFailureRounds, 2)
})

test('a phase gets two seal-failure relays; the first seal attempt is not one of them', () => {
  const initial = { message: { template: 'initial' } }
  const relay = { message: { template: 'seal-failure' } }
  const nudge = { message: { template: 'continue' } }
  assert.equal(sealFailureRelays([initial, nudge]), 0)
  assert.equal(sealFailureRoundRefusal(RULES, [initial]), null, 'after the first failed seal, round 1 is available')
  assert.equal(sealFailureRoundRefusal(RULES, [initial, relay, nudge]), null, 'a continue is not a round')
  assert.equal(sealFailureRelays([initial, relay, nudge, relay]), 2)
  assert.match(sealFailureRoundRefusal(RULES, [initial, relay, relay], 'fixture'), /had its 2 seal-failure rounds .* pnpm bench seal fixture \(a seal that fails now seals the phase as failed\)/)
  assert.equal(sealFailureRoundRefusal(null, [initial, relay, relay, relay]), null, 'a run without official rules is not capped')
})

test('the budget clamps each launch, pins the effort, and stops the phase when it is spent', () => {
  const fresh = nextLaunchAllowance(RULES, { launches: [], outputTokensSpent: 0 })
  assert.equal(fresh.timeoutMs, 180 * 60_000, 'with no operator timeout the budget sets it')
  assert.equal(fresh.timeoutIsBudget, true)
  assert.equal(fresh.effort, 'high', 'the pinned effort is used when the operator names none')
  assert.equal(fresh.outputTokensLeft, 4_000_000)
  const later = nextLaunchAllowance(RULES, { launches: [launch(170)], outputTokensSpent: 3_500_000, requestedMinutes: 60 })
  assert.equal(later.timeoutMs, 10 * 60_000, 'what is left, not what the operator asked for')
  assert.equal(later.outputTokensLeft, 500_000)
  const shorter = nextLaunchAllowance(RULES, { launches: [], requestedMinutes: 30 })
  assert.equal(shorter.timeoutMs, 30 * 60_000)
  assert.equal(shorter.timeoutIsBudget, false, 'an operator timeout inside the budget is the operator\'s')
  assert.deepEqual(nextLaunchAllowance(RULES, { requestedEffort: 'xhigh' }).offProtocol, ['effort xhigh instead of the pinned high'])
  assert.throws(() => nextLaunchAllowance(RULES, { launches: [launch(120), launch(61)] }), (error) => error instanceof BudgetSpent && error.kind === 'wall-clock')
  assert.throws(() => nextLaunchAllowance(RULES, { outputTokensSpent: 4_000_001 }), (error) => error instanceof BudgetSpent && error.kind === 'tokens' && /seal the phase as it stands/.test(error.message))
  assert.equal(agentSeconds([launch(10), launch(5)]), 900, 'agent time is the launches, summed')
  assert.equal(nextLaunchAllowance(null, { requestedMinutes: 5, requestedEffort: 'low' }).timeoutMs, 300_000, 'no rules, no clamp')
})

test('a budget record says within, stopped, or exceeded, and checks the effort the gateway saw', () => {
  const usage = (outputTokens, efforts = { 'gpt-6.2-sol:high': 40 }, denied = 0) => ({ outputTokens, efforts, budget: { denied } })
  assert.equal(budgetRecord(RULES, { launches: [launch(60)], usage: usage(1_000_000) }).status, 'within')
  const stopped = budgetRecord(RULES, { launches: [launch(150), launch(30, { stoppedBy: 'wall-clock' })], usage: usage(2_000_000) })
  assert.deepEqual([stopped.status, stopped.stoppedBy], ['stopped', 'wall-clock'], 'stopped by the cap is still official')
  assert.deepEqual([budgetRecord(RULES, { launches: [launch(60)], usage: usage(4_050_000, undefined, 3) }).status, budgetRecord(RULES, { launches: [launch(60)], usage: usage(4_050_000, undefined, 3) }).stoppedBy], ['stopped', 'tokens'])
  assert.equal(budgetRecord(RULES, { launches: [launch(60, { budgetOffProtocol: ['effort xhigh instead of the pinned high'] })], usage: usage(1) }).status, 'exceeded')
  assert.equal(budgetRecord(RULES, { launches: [launch(200)], usage: usage(1) }).status, 'exceeded', 'more agent time than the budget, not stopped by it')
  const drifted = budgetRecord(RULES, { launches: [launch(60)], usage: usage(1, { 'gpt-6.2-sol:medium': 30, 'gpt-6.2-sol:high': 2, 'gpt-6-luna:low': 5 }) })
  assert.equal(drifted.effort.ok, false, 'the gateway saw the run model asked for another effort')
  assert.deepEqual(drifted.effort.mismatched, [{ effort: 'medium', count: 30 }])
  assert.equal(budgetRecord(RULES, { launches: [launch(60)], usage: usage(1, { 'claude-opus-5:high': 9, 'claude-opus-5:unspecified': 2, 'claude-haiku-5-5:low': 4 }) }).effort.ok, true, 'auxiliary models and unspecified efforts are not mismatches')
})

// --- usage and cost from the gateway ---------------------------------------------

test('the gateway merges streamed usage, keeps only numbers, and records the served model, request id, and effort', () => {
  const anthropic = 'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-opus-5","usage":{"input_tokens":12,"cache_read_input_tokens":3000,"cache_creation_input_tokens":200,"output_tokens":1}}}\n\nevent: content_block_delta\ndata: {"delta":{"text":"the \\"model\\": \\"gpt-x\\" field"}}\n\nevent: message_delta\ndata: {"usage":{"output_tokens":512}}\n\n'
  assert.deepEqual(extractUsage(anthropic), { input_tokens: 12, cache_read_input_tokens: 3000, cache_creation_input_tokens: 200, output_tokens: 512 }, 'message_start and message_delta merge')
  assert.equal(extractResponseModel(anthropic), 'claude-opus-5', 'the served id, not a "model" quoted in generated text')
  const openai = '{"type":"response.completed","response":{"model":"gpt-6.2-sol","usage":{"input_tokens":12544,"input_tokens_details":{"cached_tokens":10880},"output_tokens":80,"output_tokens_details":{"reasoning_tokens":20},"attribution":{"items":{"x":{"input_tokens":5}}}}}}'
  assert.deepEqual(extractUsage(openai), { input_tokens: 12544, input_tokens_details: { cached_tokens: 10880 }, output_tokens: 80, output_tokens_details: { reasoning_tokens: 20 } }, 'attribution never reaches the hash-chained log')
  assert.deepEqual(reduceUsage({ a: 1, b: 'x', c: [1], d: { e: 2, f: { g: 3, h: { i: 4 } } } }), { a: 1, d: { e: 2, f: { g: 3 } } })
  assert.equal(requestedEffort({ reasoning: { effort: 'high' } }), 'high')
  assert.equal(requestedEffort({ output_config: { effort: 'xhigh' } }), 'xhigh')
  assert.equal(requestedEffort({ model: 'x' }), null)
  assert.deepEqual(normalizeConfig({ budget: { outputTokens: 10 } }).budget, { outputTokens: 10 })
  assert.equal(normalizeConfig({}).budget, null, 'no budget unless the launcher sets one')
})

test('usage is normalized per provider and priced from the pinned, dated table', () => {
  const prices = loadPrices(sourceRoot)
  assert.match(prices.asOf, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(prices.unit, 'per 1,000,000 tokens')
  assert.equal(priceFor(prices, 'gpt-6.2-sol').input, 2)
  assert.equal(priceFor(prices, 'claude-opus-5-20261001')?.id, 'claude-opus-5', 'a dated id resolves to its model')
  assert.equal(priceFor(prices, 'mystery-model'), null)

  const openai = normalizeUsage({ input_tokens: 1_000_000, input_tokens_details: { cached_tokens: 800_000 }, output_tokens: 100_000, output_tokens_details: { reasoning_tokens: 40_000 } })
  assert.deepEqual(openai, { inputTokens: 1_000_000, uncachedInputTokens: 200_000, cachedInputTokens: 800_000, cacheWriteTokens: 0, cacheWrite1hTokens: 0, outputTokens: 100_000, reasoningTokens: 40_000 })
  // 200k uncached × $2 + 800k cached × $0.10 + 100k out × $10 = $0.40 + $0.08 + $1.00 — but over 272k input, so long-context rates throughout:
  // 200k × $4 + 800k × $0.20 + 100k × $15 = $0.80 + $0.16 + $1.50
  assert.equal(Math.round(responseCost(priceFor(prices, 'gpt-6.2-sol'), openai) * 100) / 100, 2.46)
  const short = normalizeUsage({ input_tokens: 100_000, input_tokens_details: { cached_tokens: 50_000 }, output_tokens: 10_000 })
  assert.equal(Math.round(responseCost(priceFor(prices, 'gpt-6.2-sol'), short) * 10000) / 10000, 0.205, '50k × $2 + 50k × $0.10 + 10k × $10')

  const anthropic = normalizeUsage({ input_tokens: 1000, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 20_000, cache_creation: { ephemeral_1h_input_tokens: 5000 }, output_tokens: 4000 })
  assert.equal(anthropic.inputTokens, 121_000, 'Anthropic input is uncached + cache reads + cache writes')
  assert.equal(anthropic.reasoningTokens, null, 'not reported separately, so not invented')
  // 1k × $5 + 100k × $0.50 + 15k × $6.25 + 5k × $10 + 4k × $25
  assert.equal(Math.round(responseCost(priceFor(prices, 'claude-opus-5'), anthropic) * 100000) / 100000, 0.29875)
})

test('the gateway log sums to official usage, by model, with efforts, served ids, request ids, and gaps', () => {
  const prices = loadPrices(sourceRoot)
  const events = [
    { seq: 1, kind: 'inspect.request', method: 'GET', path: '/backend-api/wham/accounts/check', model: null },
    { seq: 2, kind: 'inspect.response', request: 1, status: 200, usage: null },
    { seq: 3, kind: 'inspect.request', method: 'POST', model: 'gpt-6.2-sol', effort: 'high' },
    { seq: 4, kind: 'inspect.response', request: 3, status: 200, model: 'gpt-6.2-sol', requestId: 'req_a', usage: { input_tokens: 10_000, input_tokens_details: { cached_tokens: 8_000 }, output_tokens: 500, output_tokens_details: { reasoning_tokens: 100 } } },
    { seq: 5, kind: 'inspect.request', method: 'POST', model: 'gpt-6.2-sol', effort: 'high' },
    { seq: 6, kind: 'inspect.response', request: 5, status: 200, model: 'gpt-6.2-sol', requestId: 'req_b', usage: null },
    { seq: 7, kind: 'inspect.request', method: 'POST', model: 'gpt-6-luna', effort: null },
    { seq: 8, kind: 'inspect.response', request: 7, status: 200, model: 'gpt-6-luna', requestId: 'req_c', usage: { input_tokens: 1000, output_tokens: 10 } },
    { seq: 9, kind: 'budget.exhausted', outputTokens: 510, budget: 500 },
    { seq: 10, kind: 'inspect.deny', budget: true, reason: 'the phase token budget is spent' },
  ]
  const summary = summarizeUsage(events, prices)
  assert.equal(summary.source, 'gateway')
  assert.equal(summary.requests, 3, 'model turns only; the account check is not one')
  assert.deepEqual([summary.inputTokens, summary.cachedInputTokens, summary.outputTokens, summary.reasoningTokens], [11_000, 8_000, 510, 100])
  assert.equal(summary.incompleteResponses, 1, 'a successful turn with no readable usage is a gap, and says so')
  assert.deepEqual(Object.keys(summary.byModel).sort(), ['gpt-6-luna', 'gpt-6.2-sol'])
  assert.deepEqual(summary.efforts, { 'gpt-6.2-sol:high': 2, 'gpt-6-luna:unspecified': 1 })
  assert.equal(primaryModel(summary), 'gpt-6.2-sol')
  assert.deepEqual(summary.responseModels, { 'gpt-6.2-sol -> gpt-6.2-sol': 2, 'gpt-6-luna -> gpt-6-luna': 1 })
  assert.deepEqual([summary.requestIds.count, summary.requestIds.first, summary.requestIds.last], [3, 'req_a', 'req_c'])
  assert.deepEqual(summary.budget, { denied: 1, exhausted: { at: null, outputTokens: 510, budget: 500 } })
  assert.equal(summary.prices.asOf, prices.asOf)
  assert.equal(typeof summary.costUsd, 'number')
  assert.deepEqual(summarizeUsage([{ seq: 1, kind: 'inspect.request', method: 'POST', model: 'mystery' }, { seq: 2, kind: 'inspect.response', request: 1, status: 200, usage: { input_tokens: 1, output_tokens: 1 } }], prices).unpriced, ['mystery'])
  assert.equal(summarizeUsage([{ seq: 1, kind: 'inspect.request', method: 'POST', model: 'mystery' }, { seq: 2, kind: 'inspect.response', request: 1, status: 200, usage: { input_tokens: 1, output_tokens: 1 } }], prices).costUsd, null, 'an unpriced model leaves the cost unknown, never zero')
})

test('figures an operator types never replace a boxed phase\'s gateway figures', () => {
  const root = fixtureRoot()
  const { id } = createRun(root, { model: 'telemetry-fixture', target: '1', isolation: 'none' })
  const run = loadRun(root, id)
  run.stages[0] = { ...run.stages[0], status: 'complete', telemetrySource: 'gateway', telemetry: { inputTokens: 100, outputTokens: 10, costUsd: 0.5 } }
  saveRun(root, run)
  const result = recordTelemetry(root, id, 1, { costUsd: 99, inputTokens: 5 })
  const after = loadRun(root, id).stages[0]
  assert.deepEqual([after.telemetry.costUsd, after.telemetry.inputTokens], [0.5, 100], 'the gateway figures stand')
  assert.deepEqual([after.operatorTelemetry.costUsd, after.operatorTelemetry.source, after.operatorTelemetry.official], [99, 'operator', false])
  assert.match(result.note, /operator-entered/)
  assert.ok(runFootnotes({ ...loadRun(root, id), protocol: { version: '3.0.0' } }).some((note) => note.kind === 'operator-telemetry'))
  // With no gateway record, typed figures are the phase's telemetry, marked as typed.
  const plain = createRun(root, { model: 'typed-fixture', target: '1', isolation: 'none' })
  recordTelemetry(root, plain.id, 1, { costUsd: 3 })
  assert.equal(loadRun(root, plain.id).stages[0].telemetrySource, 'operator')
})

test('a phase sealed as failed is frozen, ledgered as such, published only if it built, and footnoted', () => {
  const root = fixtureRoot()
  const { id } = createRun(root, { model: 'failed-seal-fixture', target: '1' })
  const run = loadRun(root, id)
  run.stages[0].status = 'running'
  run.stages[0].startedAt = '2026-11-17T00:00:00.000Z'
  saveRun(root, run)
  const stageDir = path.join(root, 'runs', id, 'stage1')
  fs.mkdirSync(path.join(stageDir, 'src'), { recursive: true })
  fs.writeFileSync(path.join(stageDir, 'src', 'app.ts'), 'export const broken = true\n')
  const digest = hashTree(stageDir).digest
  assert.throws(() => markSealed(root, id, 1, { passed: false, artifactDigest: digest }), /requires a passing verification/, 'a failed verification is not sealed by accident')
  markSealed(root, id, 1, { passed: false, artifactDigest: digest }, { outcome: 'failed' })
  const sealed = loadRun(root, id)
  assert.equal(sealed.stages[0].status, 'complete')
  assert.equal(sealed.stages[0].sealOutcome, 'failed')
  assert.equal(sealed.previews?.['1'], undefined, 'no build, no preview')
  sealed.stages[0].seal = { outcome: 'failed', attempts: 3, sealFailureRelays: 2, sealFailureLimit: 2, finalizedBy: 'seal-failure-rounds', failures: ['Package checks failed (build).'] }
  sealed.stages[0].budget = { status: 'stopped', stoppedBy: 'tokens', rules: RULES.budget, used: { agentSeconds: 4000, outputTokens: 4_000_100 }, agentMinutes: 67 }
  sealed.stages[0].official = { official: true, reasons: [] }
  sealed.stages[0].isolation = { mode: 'lockdown' }
  const notes = runFootnotes(sealed)
  assert.ok(notes.some((note) => note.kind === 'sealed-failed' && /after all 2 seal-failure rounds: Package checks failed/.test(note.text)))
  assert.ok(notes.some((note) => note.kind === 'budget' && /generated-token budget/.test(note.text)))
  const entry = registryEntry(sealed)
  assert.deepEqual([entry.stages[0].sealOutcome, entry.stages[0].sealFailureRelays, entry.stages[0].sealFailureLimit, entry.stages[0].budget.status, entry.official], ['failed', 2, 2, 'stopped', true])
})

// --- the candidate is not told who it is ---------------------------------------------

test('a relayed seal failure names neither the run nor the model, in any punctuation', () => {
  const text = neutralizeFailure('docs/gpt-6-2-sol-notes.md and src/GPT_6.2_Sol.ts name it; see runs/gpt-6-2-sol/stage1 and "GPT 6.2 Sol"', { id: 'gpt-6-2-sol', names: ['gpt-6.2-sol', 'GPT 6.2 Sol'] })
  assert.doesNotMatch(text, /gpt|sol/i)
  assert.match(text, /<run>|<model>/)
})

test('nothing the launcher writes into a candidate box names the model or the run, except what the harness itself must send', () => {
  const model = 'sbprobe-1234-model'
  const id = 'sbprobe-1234-model-run'
  const fakeEnv = { STAGEBENCH_OPENAI_API_KEY: `sk-proj-${'a'.repeat(48)}`, STAGEBENCH_ANTHROPIC_API_KEY: `sk-ant-api03-${'b'.repeat(48)}` }
  for (const [name, adapter] of Object.entries(HARNESSES).filter(([key]) => key !== 'custom')) {
    const auth = resolveAuth(adapter, fakeEnv, { auth: 'api-key' })
    const context = { prompt: CANDIDATE_MESSAGES.initial.text({ workspace: '/workspace' }), model, effort: 'high', extraArgs: [], mcpServers: {} }
    const sections = {
      env: Object.entries(boxEnvironment({ ...adapter.env, ...auth.env })).map(([key, value]) => `${key}=${value}`).join('\n'),
      prompt: context.prompt,
      'harness-command': adapter.command(context).join(' '),
      ...Object.fromEntries([...adapter.files(context), ...auth.files].map((file) => [`file:/home/candidate/${file.path}`, String(file.content)])),
    }
    const { leaks, known } = findIdentityLeaks(sections, [id, model])
    assert.deepEqual(leaks, [], `${name}: no leak outside the harness's own config and command line`)
    assert.ok(known.length > 0, `${name}: the model id is where the harness needs it, and that is reported as known`)
    assert.ok(known.every((hit) => isHarnessSurface(hit.section)))
  }
  assert.equal(isHarnessSurface('env'), false)
  assert.equal(isHarnessSurface('file:/workspace/WORKSPACE.md'), false)
  const parsed = parseSections('noise\n### env\nA=1\n### file:/x\nhello')
  assert.deepEqual(parsed, { env: 'A=1\n', 'file:/x': 'hello\n' })
})

test('a candidate workspace names neither its run nor its model', () => {
  const root = fixtureRoot()
  const created = createRun(root, { model: 'Sbprobe Workspace Model', title: 'Sbprobe Workspace Title', target: '1' })
  const started = startPhase(root, created.id)
  const visible = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.name !== 'workspace.json') visible.push([path.relative(started.workspace, absolute), fs.readFileSync(absolute, 'utf8')])
    }
  }
  walk(started.workspace)
  const sections = Object.fromEntries(visible.map(([file, text]) => [`file:${file}`, `${file}\n${text}`]))
  assert.deepEqual(findIdentityLeaks(sections, [created.id, created.run.model, created.run.title]).leaks, [], 'workspace.json (harness bookkeeping, never copied into the box) is the only file that names the run')
  assert.match(readJson(path.join(started.workspace, 'workspace.json')).runId, /sbprobe-workspace-model/)
})

// --- the grader's served model id ---------------------------------------------

test('each evaluation records the model id the provider served and its request ids, and flags drift from the pin', () => {
  const root = fixtureRoot()
  const id = 'grader-fixture'
  const write = (kind, slot, events) => {
    const stateDir = sessionStateDir(root, id, 1, kind)
    writeJson(path.join(stateDir, 'session.json'), { kind: 'evaluator', slot, launches: [{ harnessLabel: 'Claude Code', harnessVersion: '2.1.326' }] })
    fs.mkdirSync(path.join(stateDir, 'gateway'), { recursive: true })
    fs.writeFileSync(path.join(stateDir, 'gateway', 'events.jsonl'), `${events.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
  }
  const turn = (seq, asked, served, requestId, { path: requestPath = '/v1/messages', status = 200 } = {}) => [
    { seq, kind: 'inspect.request', method: 'POST', path: requestPath, model: asked },
    { seq: seq + 1, kind: 'inspect.response', request: seq, status, model: served, requestId },
  ]
  write('evaluator', 1, [...turn(1, 'claude-opus-5', 'claude-opus-5', 'req_1'), ...turn(3, 'claude-haiku-5-5', 'claude-haiku-5-5', 'req_2')])
  const steady = graderRecord(root, id, 1, { requested: 'claude-opus-5', pinned: 'claude-opus-5' })
  assert.equal(steady.boxed, true)
  assert.equal(steady.version, 2)
  assert.equal(steady.drift, null)
  assert.equal(steady.unverified, 0)
  assert.equal(steady.pinnedRequests, 1, 'the harness\'s auxiliary calls are recorded, not held to the pin')
  assert.deepEqual(steady.served, { 'claude-opus-5 -> claude-opus-5': 1, 'claude-haiku-5-5 -> claude-haiku-5-5': 1 })
  assert.deepEqual([steady.requestIds.count, steady.requestIds.first, steady.requestIds.last], [2, 'req_1', 'req_2'])
  assert.deepEqual(steady.requestIdList, ['req_1', 'req_2'])
  assert.deepEqual(steady.sessions[0].harness, ['Claude Code 2.1.326'])

  // What every protocol-3 evaluation did, and grader record 1 called drift:
  // Claude Code asks /v1/messages/count_tokens for the pinned model, and the
  // count names no model. Neither that nor a request the API refused (an
  // overloaded 529) is a turn anyone served, so neither is held to the pin.
  write('evaluator-2', 2, [
    ...turn(1, 'claude-opus-5', null, 'req_3', { path: '/v1/messages/count_tokens' }),
    ...turn(3, 'claude-opus-5', null, 'req_4', { status: 529 }),
    ...turn(5, 'claude-opus-5', 'claude-opus-5', 'req_5'),
  ])
  const counted = graderRecord(root, id, 1, { requested: 'claude-opus-5', pinned: 'claude-opus-5' })
  assert.equal(counted.drift, null, 'a token count is not drift')
  assert.equal(counted.unverified, 0)
  assert.deepEqual(counted.notServed, { 'claude-opus-5 count_tokens': 1, 'claude-opus-5 status 529': 1 })
  assert.deepEqual(counted.served, { 'claude-opus-5 -> claude-opus-5': 2, 'claude-haiku-5-5 -> claude-haiku-5-5': 1 })
  assert.equal(counted.pinnedRequests, 2)
  assert.equal(counted.requestIds.count, 5, 'every request id the provider returned is kept')

  // A generation whose response names no model is unverified, not drift; one
  // served as another id is drift.
  write('evaluator-2', 2, [...turn(1, 'claude-opus-5', null, 'req_3'), ...turn(3, 'claude-opus-5', 'claude-opus-5-preview-x', 'req_4')])
  const drifted = graderRecord(root, id, 1, { requested: 'claude-opus-5', pinned: 'claude-opus-5' })
  assert.deepEqual(drifted.drift, [{ servedAs: 'claude-opus-5-preview-x', requests: 1 }])
  assert.equal(drifted.unverified, 1)
  const unboxed = graderRecord(root, 'never-boxed', 1, { requested: 'claude-opus-5', pinned: 'claude-opus-5' })
  assert.equal(unboxed.boxed, false)
  assert.match(unboxed.note, /unverified/)
})

test('grader records are footnoted as registered: version-1 drift stands, version 2 adds unverified', () => {
  const root = fixtureRoot()
  const { id } = createRun(root, { model: 'grader-footnote-fixture', target: '3' })
  const run = loadRun(root, id)
  const grader = (fields) => ({ status: 'complete', isolation: { mode: 'lockdown' }, evaluation: { score: 50, grader: { pinned: 'claude-opus-5', boxed: true, ...fields } } })
  run.stages = [
    // As registered under grader record 1 (a token count recorded as drift to
    // "unreported"): the stored record is not reinterpreted.
    { number: 1, ...grader({ served: ['claude-opus-5 -> claude-opus-5', 'claude-opus-5 -> unreported'], drift: [{ servedAs: 'unreported', requests: 1 }] }) },
    { number: 2, ...grader({ version: 2, served: ['claude-opus-5 -> claude-opus-5-preview-x'], drift: [{ servedAs: 'claude-opus-5-preview-x', requests: 3 }], unverified: 0 }) },
    { number: 3, ...grader({ version: 2, served: ['claude-opus-5 -> claude-opus-5', 'claude-opus-5 -> unreported'], drift: null, unverified: 2 }) },
  ]
  const notes = runFootnotes(run)
  assert.deepEqual(notes.filter((note) => note.kind === 'grader-drift').map((note) => [note.phases, note.text]), [
    [[1], "Phase 1: the grader's requests for claude-opus-5 were served as unreported."],
    [[2], "Phase 2: the grader's requests for claude-opus-5 were served as claude-opus-5-preview-x."],
  ])
  assert.deepEqual(notes.filter((note) => note.kind === 'grader-unverified').map((note) => [note.phases, note.text]), [[[3], "Phase 3: 2 of the grader's responses for claude-opus-5 did not say which model served them."]])
  assert.deepEqual(registryEntry(run).stages.map((stage) => stage.grader?.drift), [true, true, false])
})

// --- rubric 3.0.0 ---------------------------------------------------------------

test('a run is scored by the rubric it was created under', () => {
  assert.equal(loadRubric().version, '3.0.0')
  assert.equal(loadRubric('2.0.0').version, '2.0.0')
  assert.throws(() => loadRubric('9.9.9'), /not in this checkout/)
  assert.equal(rubricVersionForRun({ protocol: { rubricVersion: '3.0.0' } }), '3.0.0')
  assert.equal(rubricVersionForRun({ protocol: { rubricVersion: '2.0.0' } }), '2.0.0', 'a run created before the bump keeps 2.0.0')
  assert.equal(rubricVersionForRun({ protocol: { rubricVersion: '1.0.0' } }), '2.0.0', 'runs created under 1.x were re-scored under 2.0.0, the oldest kept')
  assert.equal(rubricVersionForRun({}), '2.0.0')
  // Every scored run in the repository is bound to the rubric that scored it
  // (all of them 2.0.0): the bump re-scores nothing.
  const scored = fs.readdirSync(path.join(sourceRoot, 'runs'))
    .filter((entry) => fs.existsSync(path.join(sourceRoot, 'runs', entry, 'run.json')))
    .map((entry) => readJson(path.join(sourceRoot, 'runs', entry, 'run.json')))
    .filter((run) => run.evaluation?.rubricVersion)
  assert.ok(scored.length >= 27)
  for (const run of scored) assert.equal(rubricVersionForRun(run), run.evaluation.rubricVersion, `${run.id} is scored by the rubric it is bound to`)
  assert.equal(readJson(path.join(sourceRoot, 'src/data/protocol.json')).rubricVersion, '3.0.0', 'the gallery knows the current rubric')
})

test('rubric 3 scores sound from the harness record: never rated, never re-normalised, zero when the build gave nothing to measure', () => {
  const rubric = loadRubric('3.0.0')
  const voice = rubric.stages['1'].categories.find((category) => category.id === 'sound').criteria.find((criterion) => criterion.id === 'pianoVoice')
  assert.equal(voice.scoring, 'harness')
  const record = (scores, status = 'measured') => ({ audio: { status, plan: 'stagebench-audio-1', failure: status === 'measured' ? null : { kind: 'no-midi', detail: 'the app never listened for MIDI' }, scores } })
  const perfect = { notesSounding: 19, notesTotal: 19, tuningErrorCents: 3, velocityRisingSteps: 7, velocityStepsTotal: 7, velocityRangeDb: 30, releasesClean: 3, releasesTotal: 3, clicks: 0 }
  assert.equal(scoreHarnessCriterion(voice, record(perfect)).score, 100)
  // The 44.1/48 kHz resampling bug: 147 cents sharp scores nothing for tuning.
  const detuned = scoreHarnessCriterion(voice, record({ ...perfect, tuningErrorCents: 147 }))
  assert.equal(detuned.score, 75)
  assert.equal(detuned.measurements.find((entry) => entry.id === 'tuningErrorCents').score, 0)
  const unmeasurable = scoreHarnessCriterion(voice, record({ ...perfect, tuningErrorCents: null }))
  assert.equal(unmeasurable.score, 75, 'a measurement that could not be taken scores zero; the rest is not re-weighted')
  assert.match(unmeasurable.evidence.join('\n'), /could not be measured: scored 0/)
  const failed = scoreHarnessCriterion(voice, record(null, 'failed'))
  assert.equal(failed.score, 0)
  assert.match(failed.evidence[0], /no-midi/)
  assert.throws(() => scoreHarnessCriterion(voice, {}), /sealed artifact has none/)
  assert.equal(measurementScore({ id: 'x', kind: 'atMost', target: 10, zero: 50 }, { x: 30 }), 50)
  assert.equal(measurementScore({ id: 'x', kind: 'atLeast', target: 15, zero: 3 }, { x: 9 }), 50)

  // The evaluator never sees a harness criterion, and one it adds anyway is ignored.
  const template = createAssessmentTemplate(rubric, 'blind', 1)
  const ids = template.categories.flatMap((category) => category.criteria.map((criterion) => criterion.id))
  for (const harnessOnly of ['pianoVoice', 'sustainPedal']) assert.equal(ids.includes(harnessOnly), false)
  const filled = (evaluator, rating) => {
    const assessment = createAssessmentTemplate(rubric, 'blind', 1)
    Object.assign(assessment, { evaluator, evaluatedAt: '2026-11-17T00:00:00.000Z', summary: 'fixture' })
    for (const category of assessment.categories) for (const criterion of category.criteria) Object.assign(criterion, { rating, evidence: ['measured 1.0'] })
    return assessment
  }
  const sneaky = filled('one', 2)
  sneaky.categories[0].criteria.push({ id: 'pianoVoice', scoring: 'judged', rating: 4, evidence: ['sounded great to me'] })
  validateAssessment(rubric, sneaky)
  const harness = record({ ...perfect, sustainChecksPassed: 1, sustainChecksTotal: 2 })
  const scored = scoreAssessment(rubric, sneaky, [], { harness })
  assert.equal(scored.categories[0].criteria.find((criterion) => criterion.id === 'pianoVoice').score, 100, 'the harness, not the evaluator, decides')
  assert.equal(scored.categories.find((category) => category.id === 'playability').criteria.find((criterion) => criterion.id === 'sustainPedal').score, 50)
  // A panel merges what the evaluators rated; harness criteria are scored once, from the record.
  const merged = mergeAssessments(rubric, [filled('a', 2), filled('b', 4), filled('c', 3)])
  assert.equal(merged.categories[0].criteria.some((criterion) => criterion.id === 'pianoVoice'), false)
  assert.equal(scoreAssessment(rubric, merged, [], { harness }).categories[0].criteria.find((criterion) => criterion.id === 'sourceHonesty').rating, 3)
})

test('rubric 3 changes what #4 found unreachable and keeps everything else of 2.0.0', () => {
  const two = loadRubric('2.0.0')
  const three = loadRubric('3.0.0')
  const guidance = (rubric, phase, id) => rubric.stages[phase].categories.flatMap((category) => category.criteria).find((criterion) => criterion.id === id)?.guidance ?? ''
  assert.match(two.stages['2'].categories.flatMap((category) => category.criteria).find((criterion) => criterion.id === 'pianoControlDepth').guidance, /pedal noise/, '2.0.0 rewarded pedal noise, which the piano spec excludes')
  assert.doesNotMatch(guidance(three, '2', 'pianoControlDepth'), /String resonance, pedal noise/)
  assert.match(guidance(three, '2', 'instrumentBreadth'), /not marked down for having no velocity layers/)
  assert.match(guidance(three, '3', 'organSystem'), /two registrations/)
  assert.match(guidance(three, '3', 'distinctEngines'), /well-made synthesis is creditable in full/)
  assert.match(three.ratingScale.soundReachability, /never requires a recording the pack does not contain/)
  assert.match(three.ratingScale.listening, /cannot listen/)
  assert.deepEqual(three.runAxis, two.runAxis, 'panel fidelity is unchanged')
  assert.deepEqual(three.aggregateStageWeights, two.aggregateStageWeights)
  assert.deepEqual(three.technicalGate, two.technicalGate)
  assert.equal(three.evaluator.pinnedId, 'claude-opus-5')
  assert.match(three.evaluator.snapshotNote, /no dated snapshot/)
})

// The omp (Oh My Pi) harness: Vercel AI Gateway behind the lockdown gateway.
// Everything here runs without a container engine and without a model call:
// the adapter as data, the gateway's rules as pure functions over the request
// and response shapes omp's vercel-ai-gateway provider produces (Anthropic
// Messages, with synthetic fixtures), and the gateway itself over real sockets
// and real TLS, refusals only, so nothing leaves the machine.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import tls from 'node:tls'
import { spawnSync } from 'node:child_process'
import {
  AI_GATEWAY_KEPT_ROUTING, applyModelPolicy, extractResponseModel, extractUsage, generatedTokens, normalizeConfig, plainPath, requestedEffort, requestedThinkingBudget, startGateway,
} from '../bench/lockdown/image/gateway.mjs'
import {
  AI_GATEWAY_HOST, BOX_WORKSPACE, CLAUDE_PATHS, HARNESSES, OMP_AI_GATEWAY_PATHS, OMP_CHAT_ROLES, OMP_SESSIONS, ompModel, placeholderFor, resolveAuth, resolveHarness, toYaml,
} from '../bench/lockdown/harnesses.mjs'
import { IMAGE_DIR, IMAGE_TARGETS, DEFAULT_IMAGE_TARGETS, imageTags } from '../bench/lockdown/runtime.mjs'
import { attestation, sessionTranscriptFiles } from '../bench/lockdown/seal.mjs'
import { leakNeedle, summarizeGatewayLog } from '../bench/lockdown/session.mjs'
import { isHarnessSurface } from '../bench/lockdown/redteam/identity.mjs'
import { loadPrices, normalizeUsage, priceFor, responseCost, summarizeUsage } from '../bench/lib/usage.mjs'
import { budgetRecord } from '../bench/lib/run/rules.mjs'
import { archiveSessions, decompress, describeTranscript, detectHarness, discoverSessions, extractOperatorEvents } from '../bench/lib/run/transcripts.mjs'
import { scrubText } from '../bench/lib/scrub.mjs'

const sourceRoot = path.resolve(import.meta.dirname, '..')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-omp-test-'))
process.env.STAGEBENCH_HOME = path.join(scratch, 'home')
after(() => fs.rmSync(scratch, { recursive: true, force: true }))

const MODEL = 'google/gemini-4-neon'
// Assembled at runtime so no key-shaped literal sits in the repository.
const KEY = ['vck', 'Q7xR2'.repeat(10)].join('_')
const ompRule = (extra = {}) => normalizeConfig({ egress: [{ host: AI_GATEWAY_HOST, mode: 'inspect', api: 'vercel-ai-gateway', paths: OMP_AI_GATEWAY_PATHS }], ...extra })

// --- the adapter --------------------------------------------------------------

test('omp is a dedicated adapter whose key is held by the gateway; the box sees a placeholder', () => {
  const adapter = resolveHarness('omp')
  assert.equal(adapter, HARNESSES.omp)
  assert.equal(adapter.binary, 'omp')
  assert.equal(adapter.image, 'candidate-omp')
  assert.deepEqual(adapter.transcripts, ['.omp/agent/sessions'])
  for (const name of ['STAGEBENCH_AI_GATEWAY_API_KEY', 'AI_GATEWAY_API_KEY']) {
    const auth = resolveAuth(adapter, { [name]: KEY })
    assert.equal(auth.id, 'api-key')
    assert.equal(auth.source, `$${name}`)
    assert.match(auth.env.AI_GATEWAY_API_KEY, /^vck_stagebench-placeholder-[0-9a-f]{32}$/, 'the vendor prefix is kept, the key is not')
    assert.equal(JSON.stringify({ env: auth.env, files: auth.files }).includes(KEY), false)
    assert.deepEqual(auth.gatewaySecrets, [{ placeholder: auth.env.AI_GATEWAY_API_KEY, value: KEY, hosts: [AI_GATEWAY_HOST] }])
    assert.deepEqual(auth.leakCheck, [KEY])
    assert.deepEqual(auth.egress, [{ host: 'ai-gateway.vercel.sh', mode: 'inspect', api: 'vercel-ai-gateway', paths: OMP_AI_GATEWAY_PATHS }])
  }
  assert.equal(resolveAuth(adapter, { STAGEBENCH_AI_GATEWAY_API_KEY: KEY, AI_GATEWAY_API_KEY: `${KEY}x` }).gatewaySecrets[0].value, KEY, 'the STAGEBENCH_ name wins')
  assert.throws(() => resolveAuth(adapter, { OPENAI_API_KEY: 'sk-x' }), /No credential found for Oh My Pi/)
  assert.match(placeholderFor(KEY), /^vck_stagebench-placeholder-/)
  // The leak check can recognise the key whatever its length, without keeping it.
  const needle = leakNeedle(KEY)
  assert.ok(needle && KEY.includes(needle) && needle.length >= 16 && needle.length < KEY.length)
  assert.ok(leakNeedle(`vck_${'a'.repeat(30)}`), 'a 34-character key still gets a needle')
  assert.equal(leakNeedle('vck_short'), null)
})

test('omp runs unattended in print mode on the pinned model, with the effort as its thinking level', () => {
  const adapter = HARNESSES.omp
  const prompt = CANDIDATE_PROMPT
  const argv = adapter.command({ prompt, model: MODEL, effort: 'high', extraArgs: [], mcpServers: {} })
  assert.deepEqual(argv.slice(0, 2), ['omp', '--print'])
  assert.deepEqual(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 2), ['--model', 'vercel-ai-gateway/google/gemini-4-neon'])
  assert.deepEqual(argv.slice(argv.indexOf('--thinking'), argv.indexOf('--thinking') + 2), ['--thinking', 'high'])
  assert.deepEqual(argv.slice(argv.indexOf('--cwd'), argv.indexOf('--cwd') + 2), ['--cwd', BOX_WORKSPACE])
  assert.deepEqual(argv.slice(argv.indexOf('--approval-mode'), argv.indexOf('--approval-mode') + 2), ['--approval-mode', 'yolo'])
  for (const flag of ['--offline', '--no-title', '--no-extensions', '--no-skills']) assert.ok(argv.includes(flag), flag)
  assert.deepEqual(argv.slice(-2), ['--', prompt], 'the message follows `--`, so it can never be read as a flag or a file')
  assert.equal(argv.includes('--continue'), false)
  // A follow-up continues the session in /workspace.
  const resumed = adapter.command({ prompt: 'Continue.', model: MODEL, effort: 'high', resume: true })
  assert.deepEqual(resumed.slice(-3), ['--continue', '--', 'Continue.'])
  // The prefixed form is accepted for --model, and the gateway is pinned to the bare slug.
  assert.deepEqual(ompModel('vercel-ai-gateway/google/gemini-4-neon'), { slug: MODEL, omp: 'vercel-ai-gateway/google/gemini-4-neon' })
  assert.deepEqual(adapter.pinModels({ model: MODEL }), [MODEL])
  assert.deepEqual(adapter.pinModels({ model: `vercel-ai-gateway/${MODEL}` }), [MODEL])
  assert.deepEqual(adapter.describeLaunch({ model: MODEL, effort: 'high' }), { model: 'vercel-ai-gateway/google/gemini-4-neon', thinking: 'high', mode: 'print' })
  // Interactive: the TUI, no --print.
  assert.equal(adapter.command({ prompt: 'go', model: MODEL, interactive: true }).includes('--print'), false)
  // What it refuses to run with.
  assert.throws(() => adapter.command({ prompt: 'go', model: MODEL, mcpServers: { repl: { command: 'node' } } }), /no MCP servers/)
  assert.throws(() => adapter.command({ prompt: 'go' }), /needs the AI Gateway model/)
  assert.throws(() => adapter.check({}), /needs the AI Gateway model/)
  assert.throws(() => adapter.check({ model: MODEL, effort: 'ludicrous' }), /no thinking level "ludicrous"/)
  assert.throws(() => ompModel('google//x'), /not an AI Gateway model id/)
  assert.throws(() => ompModel('-rf'), /not an AI Gateway model id/)
  adapter.check({ model: MODEL, effort: 'high' })
})

const CANDIDATE_PROMPT = 'Read WORKSPACE.md in /workspace and follow it exactly.'

test('the box home says: no web search, no MCP, no extensions, no updates, every role on the run model', () => {
  const files = Object.fromEntries(HARNESSES.omp.files({ model: MODEL, effort: 'high' }).map((file) => [file.path, file.content]))
  assert.deepEqual(Object.keys(files).sort(), ['.omp/agent/config.yml', '.omp/agent/models.yml'])
  const config = files['.omp/agent/config.yml']
  for (const role of OMP_CHAT_ROLES) assert.match(config, new RegExp(`\\n  ${role}: "vercel-ai-gateway/google/gemini-4-neon"\\n`), role)
  for (const [section, setting] of [
    ['web_search', 'enabled: false'], ['fetch', 'enabled: false'], ['exa', 'enabled: false'], ['github', 'enabled: false'],
    ['mcp', 'enableProjectConfig: false'], ['skills', 'enabled: false'], ['marketplace', 'autoUpdate: "off"'],
    ['update', 'auto: false'], ['telemetry', 'otlpExportEnabled: false'], ['tools', 'approvalMode: "yolo"'],
    ['retry', 'modelFallback: false'], ['recap', 'enabled: false'], ['memory', 'backend: "off"'],
  ]) assert.match(config, new RegExp(`\\n${section}:\\n(  .*\\n)*  ${setting.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`), `${section}.${setting}`)
  assert.match(config, /\nstartup:\n  checkUpdate: false\n  setupWizard: false\n/)
  assert.match(config, /\ndev:\n  autoqa: false\n  autoqaConsent: "denied"\n/)
  assert.match(config, /\nproviders:\n  webKeyless: false\n  cacheWarming: "off"\n/)
  assert.match(config, /\nextensions: \[\]\n/)
  assert.doesNotMatch(config, /enabledProviders/, 'that setting is about foreign config directories, not model providers')
  assert.match(config, /\ndefaultThinkingLevel: "high"\n/)
  const models = files['.omp/agent/models.yml']
  assert.match(models, /\nproviders:\n  vercel-ai-gateway:\n    baseUrl: "https:\/\/ai-gateway\.vercel\.sh"\n    apiKey: "AI_GATEWAY_API_KEY"\n    api: "anthropic-messages"\n    models:\n      - id: "google\/gemini-4-neon"\n        api: "anthropic-messages"\n/)
  assert.match(models, /contextWindow: 1000000\n        maxTokens: 1000000\n/)
  assert.match(models, /thinking:\n          mode: "budget"\n/)
  // No credential, real or placeholder, is ever written into a file: the key
  // reaches omp only as an environment variable, by name.
  assert.equal(`${config}${models}`.includes('vck_'), false)
  assert.equal(HARNESSES.omp.files({ model: MODEL }).some((file) => file.content.includes('defaultThinkingLevel')), false, 'no effort, no thinking level')
  // omp's settings environment, belt and braces for what the files say.
  assert.deepEqual(HARNESSES.omp.env, { PI_CODING_AGENT_DIR: '/home/candidate/.omp/agent', PI_AUTO_QA: '0', PI_NO_TITLE: '1', OTEL_SDK_DISABLED: 'true', PI_AI_CODEX_CLIENT_VERSION: '0.169.0' })
  assert.match(fs.readFileSync(path.join(IMAGE_DIR, 'Containerfile'), 'utf8'), /ARG CODEX_VERSION=0\.169\.0\n/, 'the pinned client version is the Codex CLI the image carries')
  // The model id is allowed only in the harness's own config and command line.
  assert.equal(isHarnessSurface('file:/home/candidate/.omp/agent/config.yml'), true)
  assert.equal(isHarnessSurface('file:/home/candidate/.omp/agent/models.yml'), true)
  assert.equal(isHarnessSurface('file:/home/candidate/.omp/agent/sessions/x.jsonl'), false)
  assert.equal(isHarnessSurface('file:/workspace/candidate/.omp/agent/config.yml.bak'), false)
})

test('generated YAML quotes every string, so no value can change the document', () => {
  const text = toYaml({ a: 'x: y\n- z', list: ['#not a comment', { id: 'q"uote', n: 1 }], empty: [], nested: { 'odd key': true } })
  assert.equal(text, 'a: "x: y\\n- z"\nlist:\n  - "#not a comment"\n  - id: "q\\"uote"\n    n: 1\nempty: []\nnested:\n  "odd key": true\n')
})

// --- the gateway's rules for Vercel AI Gateway --------------------------------

test('the AI Gateway allowlist is exactly the two endpoints omp calls', () => {
  const [rule] = ompRule().egress
  for (const pattern of OMP_AI_GATEWAY_PATHS) {
    assert.match(pattern, /^\^.*\$$/)
    assert.doesNotMatch(pattern, /\.\*|\.\+|\[\^|\[a-z|\\w|\\S|\(\/\|\$\)/)
  }
  const allowed = (method, urlPath, body = null) => applyModelPolicy(ompRule({ models: [MODEL] }), rule, { method, urlPath, body })
  assert.equal(allowed('POST', '/v1/messages', { model: MODEL, messages: [] }).allow, true)
  assert.equal(allowed('POST', '/v1/messages?beta=true', { model: MODEL, messages: [] }).allow, true, 'omp asks for the beta surface with a query string')
  assert.equal(allowed('GET', '/v1/models').allow, true, 'model discovery')
  for (const urlPath of [
    '/v1/chat/completions', '/v1/responses', '/v1/messages/count_tokens', '/v1/messages/batches', '/v1/embeddings', '/v1/credits', '/v1/generation',
    '/v1/models/google/gemini-4-neon', '/v1/files', '/v1/images/generations', '/v3/ai/language-model', '/v1/messages/', '/v1//messages', '/v1/%6dessages', '/',
  ]) {
    const verdict = allowed('POST', urlPath, { model: MODEL })
    assert.equal(verdict.allow, false, urlPath)
  }
  assert.equal(allowed('DELETE', '/v1/models').allow, false)
  assert.equal(plainPath('/v1/models/../messages'), false)
})

test('the AI Gateway is pinned to the run model: another model, or none, is refused', () => {
  const config = ompRule({ models: HARNESSES.omp.pinModels({ model: MODEL }) })
  const [rule] = config.egress
  const post = (body) => applyModelPolicy(config, rule, { method: 'POST', urlPath: '/v1/messages', body })
  assert.equal(post({ model: MODEL, max_tokens: 10, messages: [] }).allow, true)
  for (const model of ['google/gemini-4-argon', 'gemini-4-neon', 'vercel-ai-gateway/google/gemini-4-neon', 'anthropic/claude-opus-5', 'GOOGLE/GEMINI-4-NEON']) {
    const verdict = post({ model, messages: [] })
    assert.equal(verdict.allow, false, model)
    assert.match(verdict.reason, /not the pinned run model \(google\/gemini-4-neon\)/)
  }
  assert.match(post({ messages: [] }).reason, /names none/)
  // A fallback list is another way to be served by a different model: it goes.
  const fallback = post({ model: MODEL, messages: [], models: ['anthropic/claude-opus-5'], providerOptions: { gateway: { models: ['openai/gpt-6.2-sol'], order: ['vertex'] } } })
  assert.equal(fallback.allow, true)
  assert.equal(fallback.body.models, undefined)
  assert.deepEqual(fallback.body.providerOptions, { gateway: { order: ['vertex'] } })
  assert.deepEqual(fallback.stripped.sort(), ['models', 'providerOptions.gateway.models'])
})

test('hosted tools and search switches are stripped from omp’s Anthropic-wire requests', () => {
  const [rule] = ompRule().egress
  const body = {
    model: MODEL,
    max_tokens: 1_000_000,
    thinking: { type: 'enabled', budget_tokens: 16384 },
    system: [{ type: 'text', text: 'You are a coding agent.' }],
    // omp's own tools: Anthropic custom tools, executed in the box.
    tools: [
      { name: 'bash', description: 'Run a command', input_schema: { type: 'object', properties: { command: { type: 'string' } } } },
      { name: 'edit', description: 'Edit a file', input_schema: { type: 'object' } },
      { type: 'web_search_20250305', name: 'web_search', max_uses: 5 },
      { type: 'web_fetch_20250910', name: 'web_fetch' },
      { type: 'code_execution_20250825', name: 'code_execution' },
      { type: 'mcp_toolset', mcp_server_name: 'remote' },
    ],
    tool_choice: { type: 'tool', name: 'web_search' },
    mcp_servers: [{ type: 'url', url: 'https://mcp.example.com/sse', name: 'remote' }],
    providerOptions: {
      google: { useSearchGrounding: true, tools: [{ googleSearch: {} }] },
      anthropic: { webSearch: true },
      gateway: { order: ['google', 'vertex'], only: ['vertex'], caching: 'auto', byok: { google: [{ apiKey: 'x' }] }, models: ['x/y'], user: 'u' },
    },
    plugins: [{ id: 'web' }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  }
  const verdict = applyModelPolicy(ompRule(), rule, { method: 'POST', urlPath: '/v1/messages', body })
  assert.equal(verdict.allow, true)
  assert.equal(verdict.modified, true)
  assert.deepEqual(verdict.body.tools.map((tool) => tool.name), ['bash', 'edit'])
  assert.equal(verdict.body.tool_choice, undefined, 'a forced choice of a stripped tool goes with it')
  assert.equal(verdict.body.mcp_servers, undefined)
  assert.equal(verdict.body.plugins, undefined)
  assert.deepEqual(verdict.body.providerOptions, { gateway: { order: ['google', 'vertex'], only: ['vertex'], caching: 'auto' } }, 'only routing among upstreams of the same model survives')
  assert.deepEqual(AI_GATEWAY_KEPT_ROUTING, ['order', 'only', 'caching'])
  for (const stripped of ['web_search_20250305', 'web_fetch_20250910', 'code_execution_20250825', 'mcp_toolset', 'mcp_servers', 'plugins', 'providerOptions.google', 'providerOptions.anthropic', 'providerOptions.gateway.byok', 'providerOptions.gateway.models', 'providerOptions.gateway.user']) {
    assert.ok(verdict.stripped.includes(stripped), stripped)
  }
  assert.deepEqual(verdict.body.thinking, { type: 'enabled', budget_tokens: 16384 }, 'thinking is the model’s own; untouched')
  assert.equal(requestedThinkingBudget(verdict.body), 16384)
  assert.equal(requestedEffort(verdict.body), null, 'a budget is not an effort string')
  // A request with nothing to strip goes out as it came.
  const clean = applyModelPolicy(ompRule(), rule, { method: 'POST', urlPath: '/v1/messages', body: { model: MODEL, messages: [], providerOptions: { gateway: { order: ['vertex'] } } } })
  assert.equal(clean.modified, false)
  assert.deepEqual(clean.stripped, [])
  // Junk where an options object belongs is removed, not forwarded.
  assert.equal(applyModelPolicy(ompRule(), rule, { method: 'POST', urlPath: '/v1/messages', body: { model: MODEL, providerOptions: 'enable-everything' } }).body.providerOptions, undefined)
  // Chat Completions shapes are covered the same way, should omp ever use them here.
  const chat = applyModelPolicy(ompRule(), rule, {
    method: 'POST', urlPath: '/v1/messages', body: {
      model: MODEL,
      tools: [{ type: 'function', function: { name: 'bash' } }, { type: 'provider-defined', id: 'google.google_search', name: 'google_search' }],
      web_search_options: {}, provider_options: { google: { urlContext: true } },
    },
  })
  assert.deepEqual(chat.body.tools.map((tool) => tool.type), ['function'])
  assert.equal(chat.body.web_search_options, undefined)
  assert.equal(chat.body.provider_options, undefined)
})

test('the AI Gateway rules apply only to the AI Gateway: other harnesses’ requests are as before', () => {
  const config = normalizeConfig({ egress: [{ host: 'api.anthropic.com', mode: 'inspect', api: 'anthropic-messages', paths: CLAUDE_PATHS }] })
  const body = { model: 'claude-opus-5', messages: [], models: ['kept'], plugins: ['kept'], providerOptions: { kept: true } }
  const verdict = applyModelPolicy(config, config.egress[0], { method: 'POST', urlPath: '/v1/messages', body })
  assert.equal(verdict.modified, false)
  assert.deepEqual(verdict.stripped, [])
  assert.deepEqual(verdict.body, { model: 'claude-opus-5', messages: [], models: ['kept'], plugins: ['kept'], providerOptions: { kept: true } })
})

// --- usage, the budget, and cost ----------------------------------------------

// A streamed Anthropic Messages response as Vercel AI Gateway sends one for a
// Gemini model: input and cache counts in message_start, output in message_delta.
const SSE = [
  'event: message_start',
  `data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"${MODEL}","content":[],"stop_reason":null,"usage":{"input_tokens":1200,"cache_creation_input_tokens":0,"cache_read_input_tokens":8000,"output_tokens":1}}}`,
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"The \\"model\\": \\"other\\" here is text, not the model."}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Done."}}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":950}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join('\n')

test('usage is read from omp’s streamed Anthropic-wire responses: input, cache reads, and output with thinking', () => {
  const usage = extractUsage(SSE)
  assert.deepEqual(usage, { input_tokens: 1200, cache_creation_input_tokens: 0, cache_read_input_tokens: 8000, output_tokens: 950 })
  assert.equal(extractResponseModel(SSE), MODEL, 'the served model comes from message_start, not from generated text')
  assert.equal(generatedTokens(usage), 950, 'the budget counts the output, thinking included, as Anthropic reports it')
  assert.deepEqual(normalizeUsage(usage), { inputTokens: 9200, uncachedInputTokens: 1200, cachedInputTokens: 8000, cacheWriteTokens: 0, cacheWrite1hTokens: 0, outputTokens: 950, reasoningTokens: null })
  // A non-streamed reply with no cache fields reads the same way.
  const plain = extractUsage(`{"id":"msg_2","model":"${MODEL}","usage":{"input_tokens":500,"output_tokens":40}}`)
  assert.equal(generatedTokens(plain), 40)
  assert.equal(normalizeUsage(plain).inputTokens, 500)
})

test('generated tokens include reasoning, whichever way a response reports it, and stay as they were for OpenAI and Anthropic', () => {
  // OpenAI Responses: output includes reasoning; the total says so.
  const responses = { input_tokens: 1000, output_tokens: 300, total_tokens: 1300, output_tokens_details: { reasoning_tokens: 200 }, input_tokens_details: { cached_tokens: 600 } }
  assert.equal(generatedTokens(responses), 300)
  assert.equal(normalizeUsage(responses).outputTokens, 300)
  assert.equal(normalizeUsage(responses).reasoningTokens, 200)
  // Anthropic: thinking is output; no split, no total.
  assert.equal(generatedTokens({ input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 77 }), 77)
  // Chat Completions (completion_tokens), with reasoning inside: as reported.
  const inside = { prompt_tokens: 1000, completion_tokens: 300, total_tokens: 1300, completion_tokens_details: { reasoning_tokens: 200 }, prompt_tokens_details: { cached_tokens: 400 } }
  assert.equal(generatedTokens(inside), 300, 'completion_tokens are counted (the budget used to read only output_tokens)')
  assert.deepEqual(normalizeUsage(inside), { inputTokens: 1000, uncachedInputTokens: 600, cachedInputTokens: 400, cacheWriteTokens: 0, cacheWrite1hTokens: 0, outputTokens: 300, reasoningTokens: 200 })
  // A provider that reports reasoning beside its output shows it in its own total; then both are counted.
  const beside = { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1300, completion_tokens_details: { reasoning_tokens: 200 } }
  assert.equal(generatedTokens(beside), 300)
  assert.equal(normalizeUsage(beside).outputTokens, 300)
  const besideAnthropic = { input_tokens: 50, cache_read_input_tokens: 0, output_tokens: 100, output_tokens_details: { reasoning_tokens: 40 }, total_tokens: 190 }
  assert.equal(generatedTokens(besideAnthropic), 140)
  assert.equal(normalizeUsage(besideAnthropic).outputTokens, 140)
  assert.equal(generatedTokens(null), 0)
  assert.equal(generatedTokens({}), 0)
})

test('google/gemini-4-neon is priced from the table, and a phase’s cost comes from its gateway log', () => {
  const prices = loadPrices(sourceRoot)
  assert.match(prices.sources['vercel-ai-gateway'], /ai-gateway\.vercel\.sh\/v1\/models/)
  const price = priceFor(prices, MODEL)
  assert.deepEqual(price, { id: MODEL, provider: 'vercel-ai-gateway', input: 3, cachedInput: 0.15, output: 15 })
  assert.equal(responseCost(price, normalizeUsage(extractUsage(SSE))), (1200 * 3 + 8000 * 0.15 + 950 * 15) / 1e6)
  assert.equal(responseCost(price, { inputTokens: 1000, uncachedInputTokens: 500, cachedInputTokens: 0, cacheWriteTokens: 500, cacheWrite1hTokens: 0, outputTokens: 0 }), 1000 * 3 / 1e6, 'cache writes at the input rate when the model lists none')
  // The log as the gateway writes it for two omp turns.
  const events = [
    { seq: 0, kind: 'inspect.request', method: 'GET', path: '/v1/models', model: null },
    { seq: 1, kind: 'inspect.response', request: 0, status: 200, usage: null, model: null },
    { seq: 2, kind: 'inspect.request', method: 'POST', path: '/v1/messages', model: MODEL, effort: null, thinkingBudget: 16384 },
    { seq: 3, kind: 'inspect.response', request: 2, status: 200, usage: extractUsage(SSE), model: extractResponseModel(SSE), requestId: 'req_1' },
    { seq: 4, kind: 'inspect.request', method: 'POST', path: '/v1/messages', model: MODEL, effort: null, thinkingBudget: 16384 },
    { seq: 5, kind: 'inspect.response', request: 4, status: 200, usage: { input_tokens: 300, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0, output_tokens: 50 }, model: MODEL },
  ]
  const summary = summarizeUsage(events, prices)
  assert.equal(summary.requests, 2, 'the model list is not a turn')
  assert.equal(summary.outputTokens, 1000)
  assert.equal(summary.cachedInputTokens, 17000)
  assert.equal(summary.incompleteResponses, 0)
  assert.deepEqual(summary.unpriced, [])
  assert.equal(summary.byModel[MODEL].priceId, MODEL)
  assert.equal(summary.costUsd, Math.round(((1200 * 3 + 8000 * 0.15 + 950 * 15) + (300 * 3 + 9000 * 0.15 + 50 * 15)) / 1e6 * 10000) / 10000)
  assert.deepEqual(summary.efforts, { [`${MODEL}:unspecified`]: 2 })
  assert.deepEqual(summary.thinkingBudgets, { [`${MODEL}:16384`]: 2 }, 'what omp asked for in place of an effort string is recorded')
  // The pinned effort is held to what the launches asked for; a request that
  // names no effort string is reported, not counted as a mismatch.
  const record = budgetRecord({ budget: { effort: 'high', agentMinutes: 180, outputTokens: 4_000_000 } }, { launches: [{ effort: 'high', startedAt: '2026-11-18T00:00:00Z', endedAt: '2026-11-18T00:10:00Z' }], usage: summary })
  assert.equal(record.effort.ok, true)
  assert.equal(record.effort.primaryModel, MODEL)
  assert.equal(record.status, 'within')
  // A run without thinking budgets has no such key: other harnesses' records keep their shape.
  assert.equal('thinkingBudgets' in summarizeUsage([{ seq: 0, kind: 'inspect.request', method: 'POST', model: 'gpt-6.2-sol', effort: 'high' }]), false)
})

// --- transcripts ----------------------------------------------------------------

const ompSession = ({ id = '0193f0aa-1111-7222-8333-944455556666', cwd = '/workspace', prompt = CANDIDATE_PROMPT } = {}) => [
  { type: 'session', version: 3, id, timestamp: '2026-11-18T10:00:00.000Z', cwd },
  { type: 'model_change', id: 'e1', parentId: null, timestamp: '2026-11-18T10:00:00.100Z', model: 'vercel-ai-gateway/google/gemini-4-neon' },
  { type: 'thinking_level_change', id: 'e2', parentId: 'e1', timestamp: '2026-11-18T10:00:00.200Z', thinkingLevel: 'high' },
  { type: 'message', id: 'e3', parentId: 'e2', timestamp: '2026-11-18T10:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: prompt }], timestamp: 1 } },
  { type: 'message', id: 'e4', parentId: 'e3', timestamp: '2026-11-18T10:00:09.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Reading.' }], api: 'anthropic-messages', provider: 'vercel-ai-gateway', model: MODEL, usage: { input: 10, output: 5 }, stopReason: 'toolUse' } },
  { type: 'message', id: 'e5', parentId: 'e4', timestamp: '2026-11-18T10:00:10.000Z', message: { role: 'user', content: 'Reminder: update your todo list.', synthetic: true } },
  { type: 'model_change', id: 'e6', parentId: 'e5', timestamp: '2026-11-18T10:00:11.000Z', model: 'vercel-ai-gateway/google/gemini-4-neon' },
  { type: 'message', id: 'e7', parentId: 'e6', timestamp: '2026-11-18T10:00:12.000Z', message: { role: 'assistant', content: [], stopReason: 'aborted', errorMessage: 'Request was aborted' } },
].map((record) => JSON.stringify(record)).join('\n') + '\n'

test('omp sessions are recognised, described, and their operator messages told apart from injected ones', () => {
  const records = ompSession().trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(detectHarness('/x/2026-11-18T10-00-00-000Z_abc.jsonl', records[0]), 'omp')
  assert.equal(detectHarness('/tmp/t/.omp/agent/sessions/--workspace--/a.jsonl', null), 'omp', 'by its store, when the header is unreadable')
  assert.equal(detectHarness('/x/rollout-1.jsonl', { type: 'session_meta' }), 'codex', 'codex is still codex')
  assert.equal(detectHarness('/x/y.jsonl', { type: 'user', sessionId: 's' }), 'claude-code', 'claude code is still claude code')
  const described = describeTranscript('/x/a.jsonl', records)
  assert.equal(described.harness, 'omp')
  assert.equal(described.sessionId, '0193f0aa-1111-7222-8333-944455556666')
  assert.equal(described.cwd, '/workspace')
  assert.equal(described.model, MODEL)
  assert.equal(described.startedAt, '2026-11-18T10:00:00.000Z')
  assert.equal(described.firstPrompt, CANDIDATE_PROMPT)
  const events = extractOperatorEvents(records, 'omp')
  assert.deepEqual(events.map((event) => event.kind), ['policy', 'policy', 'user-message', 'interrupt'], 'the synthetic reminder is not an operator message, and a repeated model is one policy event')
  assert.deepEqual(events[0].detail, { model: 'vercel-ai-gateway/google/gemini-4-neon', role: null })
  assert.deepEqual(events[1].detail, { thinkingLevel: 'high' })
  assert.equal(events[3].detail.reason, 'Request was aborted')
})

test('a boxed omp session is exported, handed to the archive, and archived with its subagents', () => {
  // The home volume's session store, as the export copies it out.
  const exported = path.join(scratch, 'export', 'transcripts')
  const project = path.join(exported, OMP_SESSIONS, '--workspace--')
  const stem = '2026-11-18T10-00-00-000Z_0193f0aa-1111-7222-8333-944455556666'
  fs.mkdirSync(path.join(project, stem), { recursive: true })
  fs.writeFileSync(path.join(project, `${stem}.jsonl`), ompSession())
  fs.writeFileSync(path.join(project, stem, '0-explore.jsonl'), ompSession({ id: '0193f0bb-0000-7000-8000-900000000000', prompt: 'Find the panel layout.' }))
  fs.writeFileSync(path.join(project, stem, 'artifact-1.txt'), 'spilled tool output\n')
  const consoleLog = path.join(scratch, 'export', 'launch-0.log')
  fs.writeFileSync(consoleLog, 'Done.\n')
  const handed = sessionTranscriptFiles({ transcripts: exported, consoleLogs: [consoleLog] })
  assert.deepEqual(handed.sessions.map((file) => path.relative(exported, file)), [`${OMP_SESSIONS}/--workspace--/${stem}.jsonl`, `${OMP_SESSIONS}/--workspace--/${stem}/0-explore.jsonl`])

  const root = path.join(scratch, 'archive-root')
  const parent = path.join(project, `${stem}.jsonl`)
  const result = archiveSessions(root, 'omp-run', { kind: 'candidate', phase: 1, source: 'seal', sessions: [{ file: parent, sidecars: [path.join(project, stem, '0-explore.jsonl'), path.join(project, stem, 'artifact-1.txt')] }], homes: {} })
  assert.equal(result.status, 'archived')
  const byFile = Object.fromEntries(result.transcripts.map((item) => [item.file, item]))
  const session = byFile[`phase-1/${stem}.jsonl.zst`]
  assert.equal(session.harness, 'omp')
  assert.equal(session.sessionId, '0193f0aa-1111-7222-8333-944455556666')
  assert.equal(session.model, MODEL)
  assert.equal(byFile[`phase-1/${stem}/0-explore.jsonl.zst`].role, 'subagent', 'omp writes a subagent as a session file of its own')
  assert.equal(byFile[`phase-1/${stem}/artifact-1.txt.zst`].role, 'tool-result')
  assert.equal(decompress(fs.readFileSync(path.join(root, 'runs', 'omp-run', 'transcripts', session.file))).toString('utf8'), ompSession())
  const operator = fs.readFileSync(path.join(root, 'runs', 'omp-run', 'transcripts', 'phase-1', 'operator.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(operator.filter((event) => event.kind === 'user-message').map((event) => [event.harness, event.text, Boolean(event.subagent)]).sort(), [['omp', 'Find the panel layout.', true], ['omp', CANDIDATE_PROMPT, false]])
})

test('omp sessions on the host are discovered by cwd, like the other harnesses’', () => {
  const home = path.join(scratch, 'operator-home')
  const sessions = path.join(home, '.omp', 'agent', 'sessions')
  const workspace = path.join(scratch, 'phase-workspace')
  fs.mkdirSync(path.join(sessions, '--elsewhere--'), { recursive: true })
  fs.mkdirSync(path.join(sessions, '--phase--'), { recursive: true })
  fs.writeFileSync(path.join(sessions, '--phase--', 'a_1.jsonl'), ompSession({ cwd: path.join(workspace, 'candidate') }))
  fs.writeFileSync(path.join(sessions, '--elsewhere--', 'b_2.jsonl'), ompSession({ cwd: '/somewhere/else' }))
  fs.mkdirSync(path.join(home, '.omp', 'profiles', 'work', 'agent', 'sessions'), { recursive: true })
  const homes = { codex: [], claude: [], cursor: [], omp: [sessions] }
  const found = discoverSessions([workspace], { homes })
  assert.deepEqual(found.map((entry) => [path.basename(entry.file), entry.harness]), [['a_1.jsonl', 'omp']])
  assert.deepEqual(discoverSessions([workspace], { homes, since: Date.parse('2030-01-01') }), [], 'outside the window it is not even opened')
})

test('a Vercel AI Gateway key is scrubbed from any archived transcript', () => {
  const redactions = {}
  const text = scrubText(`AI_GATEWAY_API_KEY=${KEY} and the placeholder vck_stagebench-placeholder-${'0'.repeat(32)}`, redactions)
  assert.equal(text.includes(KEY), false)
  assert.equal(text.includes('vck_'), false)
  assert.ok(redactions.AI_GATEWAY_KEY >= 2)
})

// --- the image, and the seal record ---------------------------------------------

test('omp has its own image target on top of the candidate box, which is unchanged by it', () => {
  const file = fs.readFileSync(path.join(IMAGE_DIR, 'Containerfile'), 'utf8')
  const stages = Object.fromEntries(file.split(/^(?=FROM )/m).filter((part) => part.startsWith('FROM ')).map((part) => [/ AS (\S+)/.exec(part)[1], part]))
  assert.deepEqual(Object.keys(stages), ['gateway', 'mirror', 'candidate', 'candidate-omp'])
  const omp = stages['candidate-omp']
  assert.match(omp, /^FROM candidate AS candidate-omp\n/)
  assert.match(omp, /\nARG BUN_VERSION=1\.4\.4\n/)
  assert.match(omp, /\nARG OMP_VERSION=19\.0\.0\n/)
  assert.match(omp, /npm install -g --prefix \/usr\/local \\\n\s+bun@\$\{BUN_VERSION\} \\\n\s+@oh-my-pi\/pi-coding-agent@\$\{OMP_VERSION\}/)
  assert.match(omp, /\nUSER candidate\s*$/, 'the box runs as the candidate user, as every other')
  const instructions = (stage) => stage.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n')
  assert.doesNotMatch(instructions(stages.candidate), /bun|oh-my-pi|\bomp\b/i, 'nothing of omp is in the box the other harnesses use')
  assert.deepEqual(IMAGE_TARGETS, { gateway: 'gateway', candidate: 'candidate', 'candidate-omp': 'candidateOmp' })
  assert.deepEqual(DEFAULT_IMAGE_TARGETS, ['gateway', 'candidate'], 'sessions build only what they always did; omp is built on demand')
  const tags = imageTags(IMAGE_DIR, {})
  assert.equal(tags.candidateOmp, `stagebench-lockdown-candidate-omp:${tags.digest}`)
  assert.equal(imageTags(IMAGE_DIR, { STAGEBENCH_LOCKDOWN_CANDIDATE_OMP_IMAGE: 'mine:1' }).candidateOmp, 'mine:1')
})

test('the seal record names the image omp ran in and how it was told to run, and only for omp', () => {
  const stateRoot = path.join(scratch, 'seal-root')
  const exported = {
    session: {
      key: 'sb-omp', runtime: { kind: 'podman', version: '6' }, images: { candidate: { tag: 'c' }, gateway: { tag: 'g' } },
      launches: [
        { index: 0, kind: 'initial', harnessLabel: 'Oh My Pi', auth: 'api-key', model: MODEL, image: { target: 'candidate-omp', tag: 'stagebench-lockdown-candidate-omp:abc', id: 'sha256:1' }, harnessSettings: { model: 'vercel-ai-gateway/google/gemini-4-neon', thinking: 'high', mode: 'print' }, pinnedModels: [MODEL] },
        { index: 1, kind: 'initial', harnessLabel: 'Codex CLI', auth: 'chatgpt', model: 'gpt-6.2-sol' },
      ],
    },
  }
  const record = attestation(stateRoot, 'omp-run', 1, exported, null)
  assert.deepEqual(record.launches[0].image, { target: 'candidate-omp', tag: 'stagebench-lockdown-candidate-omp:abc', id: 'sha256:1' })
  assert.deepEqual(record.launches[0].harnessSettings, { model: 'vercel-ai-gateway/google/gemini-4-neon', thinking: 'high', mode: 'print' })
  assert.deepEqual(record.launches[0].pinnedModels, [MODEL])
  for (const key of ['image', 'harnessSettings', 'pinnedModels']) assert.equal(key in record.launches[1], false, `a codex launch record has no ${key}`)
})

// --- the gateway over real sockets ------------------------------------------------

function proxyConnect(port, target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1')
    let buffer = Buffer.alloc(0)
    socket.once('error', reject)
    socket.on('data', function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.indexOf('\r\n\r\n') === -1) return
      socket.off('data', onData)
      resolve({ status: Number(buffer.toString('latin1', 9, 12)), socket })
    })
    socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`)
  })
}

function tlsExchange(socket, { servername, ca, request }) {
  return new Promise((resolve) => {
    const secure = tls.connect({ socket, servername, ca, ALPNProtocols: ['h2', 'http/1.1'] })
    let text = ''
    secure.on('secureConnect', () => secure.write(request))
    secure.on('data', (chunk) => { text += chunk })
    secure.on('error', (error) => resolve({ error: error.message, text }))
    secure.on('close', () => resolve({ text, protocol: secure.alpnProtocol }))
  })
}

test('the running gateway, configured as an omp launch configures it, refuses what omp must not reach', async (t) => {
  if (spawnSync('openssl', ['version']).status !== 0) {
    t.skip('openssl is not on PATH')
    return
  }
  const auth = resolveAuth(HARNESSES.omp, { STAGEBENCH_AI_GATEWAY_API_KEY: KEY })
  const logDir = path.join(scratch, 'omp-gateway-log')
  let gateway
  try {
    gateway = startGateway({ session: 'omp-unit', logDir, egress: auth.egress, models: HARNESSES.omp.pinModels({ model: MODEL }), secrets: auth.gatewaySecrets, budget: { outputTokens: 4_000_000 } }, { proxyPort: 0, mirrorPort: 0, listenHost: '127.0.0.1' })
  } catch (error) {
    t.skip(`this openssl cannot mint the gateway CA (${String(error.message).slice(0, 80)})`)
    return
  }
  const ports = await gateway.ready
  const ca = await new Promise((resolve, reject) => {
    const socket = net.connect(ports.mirror, '127.0.0.1', () => socket.write('GET /ca.pem HTTP/1.1\r\nHost: gateway\r\nConnection: close\r\n\r\n'))
    let text = ''
    socket.on('data', (chunk) => { text += chunk })
    socket.on('end', () => resolve(text.slice(text.indexOf('-----BEGIN'))))
    socket.on('error', reject)
  })
  const send = async (request) => {
    const tunnel = await proxyConnect(ports.proxy, `${AI_GATEWAY_HOST}:443`)
    assert.equal(tunnel.status, 200, 'the AI Gateway is the one inspected door')
    return tlsExchange(tunnel.socket, { servername: AI_GATEWAY_HOST, ca, request })
  }
  const post = (urlPath, body) => `POST ${urlPath} HTTP/1.1\r\nHost: ${AI_GATEWAY_HOST}\r\nAuthorization: Bearer ${auth.env.AI_GATEWAY_API_KEY}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
  try {
    // The other endpoints of the same host never leave the machine.
    for (const urlPath of ['/v1/chat/completions', '/v1/responses', '/v1/messages/count_tokens', '/v1/credits']) {
      const reply = await send(post(urlPath, JSON.stringify({ model: MODEL })))
      assert.match(reply.text, /^HTTP\/1\.1 403/, urlPath)
      assert.match(reply.text, /not on the allowlist for ai-gateway\.vercel\.sh/)
      assert.equal(reply.protocol, 'http/1.1')
    }
    // Nor does a turn for any model but the run's.
    const other = await send(post('/v1/messages', JSON.stringify({ model: 'anthropic/claude-opus-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })))
    assert.match(other.text, /^HTTP\/1\.1 403/)
    assert.match(other.text, /not the pinned run model \(google\/gemini-4-neon\)/)
    // Nor a websocket.
    const upgrade = await send(`GET /v1/messages HTTP/1.1\r\nHost: ${AI_GATEWAY_HOST}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`)
    assert.match(upgrade.text, /^HTTP\/1\.1 403/)
    // And no other host at all: the providers behind the gateway are not doors.
    for (const target of ['generativelanguage.googleapis.com:443', 'api.anthropic.com:443', 'api.openai.com:443', 'vercel.com:443', 'qa.omp.sh:443', 'registry.npmjs.org:443']) {
      const refused = await proxyConnect(ports.proxy, target)
      assert.equal(refused.status, 403, target)
      refused.socket.destroy()
    }
    const described = spawnSync('openssl', ['x509', '-noout', '-text'], { input: ca, encoding: 'utf8' }).stdout
    assert.match(described, /Name Constraints: critical[\s\S]*DNS:ai-gateway\.vercel\.sh/)
  } finally {
    await gateway.close()
  }
  const summary = summarizeGatewayLog(path.join(logDir, 'events.jsonl'))
  assert.equal(summary.chainOk, true)
  assert.equal(summary.modelRequests, 0, 'nothing was forwarded upstream')
  assert.ok(summary.deniedTargets['ai-gateway.vercel.sh/v1/chat/completions'] >= 1)
  assert.ok(summary.deniedTargets['ai-gateway.vercel.sh/v1/messages'] >= 1)
  const log = fs.readFileSync(path.join(logDir, 'events.jsonl'), 'utf8')
  assert.equal(log.includes(KEY), false, 'the key is never written to the log')
  const startEntry = log.split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((entry) => entry.kind === 'gateway.start')
  assert.deepEqual(startEntry.models, [MODEL])
  assert.deepEqual(startEntry.egress, [{ host: 'ai-gateway.vercel.sh', port: 443, mode: 'inspect', api: 'vercel-ai-gateway', paths: OMP_AI_GATEWAY_PATHS.map((pattern) => new RegExp(pattern).source) }])
  assert.deepEqual(startEntry.secrets, [{ hosts: ['ai-gateway.vercel.sh'] }])
})

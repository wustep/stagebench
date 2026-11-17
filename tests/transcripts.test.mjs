import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { hashTree, readJson, writeJson } from '../bench/lib/shared.mjs'
import { residualSecretKinds, scrubFile, scrubJsonl, scrubText } from '../bench/lib/scrub.mjs'
import { createRun, loadRun, markSealed } from '../bench/lib/run/store.mjs'
import { importWorkspace, removeWorkspace, startPhase } from '../bench/lib/run/workspace.mjs'
import {
  agentHomes,
  compress,
  decompress,
  discoverSessions,
  parseTranscriptList,
  recordPhaseTranscripts,
} from '../bench/lib/run/transcripts.mjs'

const sourceRoot = path.resolve(import.meta.dirname, '..')
const homeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-home-'))
process.env.STAGEBENCH_HOME = homeRoot
after(() => fs.rmSync(homeRoot, { recursive: true, force: true }))

// Credential-shaped fixtures are assembled at runtime so no token-shaped
// literal ever appears in the repository.
const FAKE = {
  anthropic: ['sk', 'ant', 'api03', 'Zx9'.repeat(12)].join('-'),
  openai: `${['sk', 'proj'].join('-')}-${'Ab3'.repeat(10)}`,
  github: `${'gh'}${'p_'}${'a1B2'.repeat(9)}`,
  slack: `${'xo'}${'xb'}-1234567890-abcdefghij`,
  aws: `${'AK'}${'IA'}${'ABCDEFGH12345678'}`,
  jwt: `${'ey'}J${'a'.repeat(12)}.${'ey'}J${'b'.repeat(12)}.${'c1'.repeat(8)}`,
  bearer: 'Q7'.repeat(12),
  password: 'hunter2hunter2',
  email: ['someone', 'private-mail.test'].join('@'),
  pemBegin: `-----${'BEGIN'} OPENSSH ${'PRIVATE'} KEY-----`,
  pemEnd: `-----${'END'} OPENSSH ${'PRIVATE'} KEY-----`,
}

test('scrubText redacts the obvious credential shapes and keeps ordinary code', () => {
  const cases = [
    [`key ${FAKE.anthropic}`, 'ANTHROPIC_KEY'],
    [`OPENAI=${FAKE.openai}`, 'OPENAI_KEY'],
    [`git clone https://${FAKE.github}@github.com/x/y`, 'GITHUB_TOKEN'],
    [`slack ${FAKE.slack}`, 'SLACK_TOKEN'],
    [`aws ${FAKE.aws}`, 'AWS_ACCESS_KEY'],
    [`jwt ${FAKE.jwt}`, 'JWT'],
    [`${FAKE.pemBegin}\nAAAAB3Nza\n${FAKE.pemEnd}`, 'PRIVATE_KEY'],
    [`curl -H "Authorization: Bearer ${FAKE.bearer}"`, 'AUTH_HEADER'],
    [`curl -H 'x-api-key: ${FAKE.bearer}'`, 'API_KEY_HEADER'],
    [`STAGEBENCH_PASSWORD=${FAKE.password} pnpm dev`, 'SECRET_ASSIGNMENT'],
    [`{"client_secret": "${FAKE.bearer}"}`, 'SECRET_ASSIGNMENT'],
    [`https://user:${FAKE.password}@example.org/repo`, 'URL_CREDENTIALS'],
    [`Cookie: session=${FAKE.bearer}`, 'COOKIE'],
    [`mail ${FAKE.email}`, 'EMAIL'],
  ]
  for (const [input, kind] of cases) {
    const redactions = {}
    const output = scrubText(input, redactions)
    assert.ok(redactions[kind] >= 1, `${kind} should be redacted in ${JSON.stringify(output)}`)
    assert.match(output, new RegExp(`\\*\\*\\*REDACTED_${kind}\\*\\*\\*`))
    for (const secret of Object.values(FAKE)) assert.ok(!output.includes(secret), `${kind}: secret survived`)
  }
  for (const benign of [
    'maxTokens: 4000',
    '"total_tokens":12345678',
    'const token = ++this.loadToken',
    'token: TokenType',
    '"hostCredential":"/Users/someone/.stagebench/work"',
    'noreply@anthropic.com',
    'Authorization: Bearer',
    '--password-store=basic',
    '/* Tokens: brushed metal */',
  ]) {
    const redactions = {}
    assert.equal(scrubText(benign, redactions), benign, `false positive on ${benign}`)
    assert.deepEqual(redactions, {})
  }
})

test('scrubJsonl keeps every line valid JSON, skips opaque payloads, drops account ids, and is idempotent', () => {
  const base64 = `AIza${'b'.repeat(35)}` // token-shaped by accident inside image data
  const lines = [
    { type: 'session_meta', payload: { cwd: '/w', creator_user_id: 'user-abc', creator_account_id: 'acct-1' } },
    { type: 'user', message: { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } }, { type: 'text', text: `use ${FAKE.openai}` }] } },
    { type: 'response_item', payload: { type: 'reasoning', encrypted_content: `${base64}${FAKE.github}` } },
    // A secret inside escaped JSON-in-JSON (a tool result echoing a config file).
    { type: 'tool', output: JSON.stringify({ headers: { Authorization: `Bearer ${FAKE.bearer}` } }) },
    { type: 'plain', text: 'nothing to see' },
  ]
  const input = `${lines.map((line) => JSON.stringify(line)).join('\n')}\nnot json ${FAKE.anthropic}\n`
  const { text, redactions } = scrubJsonl(input)
  const outLines = text.split('\n')
  for (const [index, line] of outLines.slice(0, lines.length).entries()) assert.doesNotThrow(() => JSON.parse(line), `line ${index} is still JSON`)
  assert.equal(outLines[4], JSON.stringify(lines[4]), 'a line with no hits keeps its original bytes')
  assert.equal(JSON.parse(outLines[1]).message.content[0].source.data, base64, 'image data is never rewritten')
  assert.ok(JSON.parse(outLines[2]).payload.encrypted_content.startsWith(base64), 'opaque encrypted payloads are left alone')
  assert.equal(JSON.parse(outLines[0]).payload.creator_user_id, '***REDACTED_ACCOUNT_ID***')
  assert.ok(!text.includes(FAKE.openai) && !text.includes(FAKE.bearer) && !text.includes(FAKE.anthropic))
  assert.ok(redactions.OPENAI_KEY === 1 && redactions.AUTH_HEADER === 1 && redactions.ANTHROPIC_KEY === 1 && redactions.ACCOUNT_ID === 2)
  assert.deepEqual(residualSecretKinds('x.jsonl', text), [], 'a second pass finds nothing')
  assert.deepEqual(scrubFile('notes.txt', `token=${FAKE.bearer}`).redactions, { SECRET_ASSIGNMENT: 1 })
})

test('archives compress losslessly with zstd', () => {
  const payload = Buffer.from(`${'{"a":"repeated line"}\n'.repeat(5000)}`)
  const packed = compress(payload)
  assert.ok(packed.length < payload.length / 20)
  assert.deepEqual(decompress(packed), payload)
  assert.deepEqual(parseTranscriptList('a.jsonl, b.jsonl,,'), ['a.jsonl', 'b.jsonl'])
  assert.deepEqual(parseTranscriptList(undefined), [])
  assert.deepEqual(parseTranscriptList('true'), [], 'a bare --transcripts flag adds nothing')
})

// --- the seal flow ----------------------------------------------------------

function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-bench-'))
  for (const relative of [
    'BENCHMARK.md', 'TASK.md', 'package.json',
    'specs/benchmark-phases.json', 'specs/nord-stage-4.variants.json', 'specs/nord-stage-4.visual.json', 'specs/nord-stage-4.piano.json',
    'prompts/stage1.md', 'bench/schemas/implementation-details.schema.json',
    'bench/starter/package.json', 'bench/starter/index.html',
  ]) {
    const destination = path.join(root, relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(sourceRoot, relative), destination)
  }
  writeJson(path.join(root, 'src/data/runs.json'), [])
  return root
}

const jsonl = (records) => `${records.map((record) => JSON.stringify(record)).join('\n')}\n`
const localDay = (date) => [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')]

// A fake operator home with one session per agent in the phase workspace,
// plus decoys that must not be archived.
function fakeAgentHome(workspace, now) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-agent-home-'))
  const at = (offsetSeconds) => new Date(now.getTime() + offsetSeconds * 1000).toISOString()
  const codexDay = path.join(home, '.codex-personal', 'sessions', ...localDay(now))
  fs.mkdirSync(codexDay, { recursive: true })
  const codexFile = path.join(codexDay, 'rollout-fixture-candidate.jsonl')
  fs.writeFileSync(codexFile, jsonl([
    { timestamp: at(0), type: 'session_meta', payload: { id: 'codex-session-1', timestamp: at(0), cwd: workspace, creator_user_id: 'user-xyz' } },
    { timestamp: at(1), type: 'turn_context', payload: { model: 'fixture-codex', approval_policy: 'never', sandbox_policy: { type: 'workspace-write' } } },
    { timestamp: at(2), type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: `Implement Phase 1. Use key ${FAKE.openai}` }] } } },
    { timestamp: at(3), type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: `{"cmd":"echo ${FAKE.email}"}` } },
    { timestamp: at(4), type: 'event_msg', payload: { type: 'turn_aborted', reason: 'interrupted' } },
  ]))
  // Decoy: same day, different project.
  fs.writeFileSync(path.join(codexDay, 'rollout-fixture-other.jsonl'), jsonl([
    { timestamp: at(0), type: 'session_meta', payload: { id: 'codex-other', cwd: path.join(home, 'some-other-project') } },
  ]))

  const claudeProject = path.join(home, '.claude-personal', 'projects', path.join(workspace, 'candidate').replace(/[^a-zA-Z0-9]/g, '-'))
  fs.mkdirSync(path.join(claudeProject, 'claude-session-1', 'subagents'), { recursive: true })
  fs.mkdirSync(path.join(claudeProject, 'claude-session-1', 'tool-results'), { recursive: true })
  const claudeFile = path.join(claudeProject, 'claude-session-1.jsonl')
  fs.writeFileSync(claudeFile, jsonl([
    { type: 'permission-mode', permissionMode: 'auto', sessionId: 'claude-session-1' },
    { type: 'user', sessionId: 'claude-session-1', cwd: path.join(workspace, 'candidate'), timestamp: at(10), message: { role: 'user', content: 'Build the piano. Do not read ../..' } },
    { type: 'assistant', sessionId: 'claude-session-1', timestamp: at(11), message: { model: 'fixture-claude', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: `curl -H "Authorization: Bearer ${FAKE.bearer}" x` } }] } },
    { type: 'user', sessionId: 'claude-session-1', timestamp: at(12), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: "The user doesn't want to proceed with this tool use." }] } },
    { type: 'user', sessionId: 'claude-session-1', timestamp: at(13), message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } },
  ]))
  fs.writeFileSync(path.join(claudeProject, 'claude-session-1', 'subagents', 'agent-a1.jsonl'), jsonl([
    { type: 'user', sessionId: 'claude-session-1', isSidechain: true, timestamp: at(14), message: { content: `subagent saw ${FAKE.anthropic}` } },
  ]))
  fs.writeFileSync(path.join(claudeProject, 'claude-session-1', 'tool-results', 'big-output.txt'), `env dump\nGITHUB_TOKEN=${FAKE.github}\n`)
  // Decoy: an older session in the same project, long before the phase began.
  const stale = path.join(claudeProject, 'claude-stale.jsonl')
  fs.writeFileSync(stale, jsonl([{ type: 'user', sessionId: 'claude-stale', timestamp: '2020-01-01T00:00:00.000Z', message: { content: 'old run' } }]))
  fs.utimesSync(stale, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'))

  const chatId = 'cursor-chat-1'
  const chatMetaDir = path.join(home, '.cursor', 'chats', 'bucket', chatId)
  fs.mkdirSync(chatMetaDir, { recursive: true })
  writeJson(path.join(chatMetaDir, 'meta.json'), { cwd: workspace, createdAtMs: now.getTime() + 20_000, updatedAtMs: now.getTime() + 30_000 })
  const cursorDir = path.join(home, '.cursor', 'projects', 'cursor-slug', 'agent-transcripts', chatId)
  fs.mkdirSync(cursorDir, { recursive: true })
  fs.writeFileSync(path.join(cursorDir, `${chatId}.jsonl`), jsonl([
    { role: 'user', message: { content: [{ type: 'text', text: '<timestamp>Monday</timestamp>\n<user_query>\nPhase 1 please\n</user_query>' }] } },
    { role: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },
  ]))
  return { home, codexFile, claudeFile }
}

function startedFixture() {
  const root = fixtureRoot()
  const created = createRun(root, { model: 'Transcript Fixture', provider: 'fixture', target: '1' })
  const started = startPhase(root, created.id)
  fs.writeFileSync(path.join(started.candidate, 'index.html'), '<h1>candidate</h1>')
  return { root, id: created.id, started }
}

// What `bench seal` does around the transcript step: import → verify (stubbed
// here: the digest of the imported tree) → markSealed → archive transcripts.
function sealWithoutGates(root, id) {
  importWorkspace(root, id, 1)
  const stageDir = path.join(root, 'runs', id, 'stage1')
  fs.mkdirSync(path.join(stageDir, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(stageDir, 'dist', 'index.html'), '<h1>candidate</h1>')
  const digest = hashTree(stageDir).digest
  markSealed(root, id, 1, { passed: true, artifactDigest: digest })
  return { stageDir, digest }
}

test('seal archives the phase transcripts as scrubbed, compressed sidecars outside the artifact digest', () => {
  const { root, id, started } = startedFixture()
  const now = new Date()
  const agent = fakeAgentHome(started.workspace, now)
  try {
    const homes = agentHomes({ homeDir: agent.home, env: {} })
    const discovered = discoverSessions([started.workspace, started.candidate], { homes, since: now.getTime() - 1000 })
    assert.deepEqual(discovered.map((session) => session.harness).sort(), ['claude-code', 'codex', 'cursor'], 'one session per agent store, decoys excluded')

    const { stageDir, digest } = sealWithoutGates(root, id)
    const warnings = []
    const result = recordPhaseTranscripts(root, id, {
      phase: 1,
      workspace: started.workspace,
      since: Date.parse(loadRun(root, id).stages[0].startedAt) - 1000,
      command: 'seal',
      homes,
      homeDir: agent.home,
      warn: (message) => warnings.push(message),
    })
    removeWorkspace(root, id, 1)
    assert.deepEqual(warnings, [])
    assert.equal(result.status, 'archived')
    assert.equal(result.sessions, 3)

    // The sealed artifact is untouched: transcripts are a sibling of stage1/,
    // never inside it, and the recorded digest still validates.
    const transcriptsRoot = path.join(root, 'runs', id, 'transcripts')
    assert.ok(!transcriptsRoot.startsWith(`${stageDir}${path.sep}`))
    assert.equal(hashTree(stageDir).digest, digest, 'archiving transcripts does not change the artifact digest')
    assert.equal(loadRun(root, id).stages[0].artifactDigest, digest)
    assert.ok(!fs.readdirSync(stageDir, { recursive: true }).some((entry) => String(entry).includes('transcript')))

    const manifest = readJson(path.join(transcriptsRoot, 'manifest.json'))
    const phase = manifest.candidate['1']
    assert.equal(phase.status, 'archived')
    const files = phase.transcripts.map((item) => item.file).sort()
    assert.deepEqual(files, [
      'phase-1/claude-session-1.jsonl.zst',
      'phase-1/claude-session-1/subagents/agent-a1.jsonl.zst',
      'phase-1/claude-session-1/tool-results/big-output.txt.zst',
      'phase-1/cursor-chat-1.jsonl.zst',
      'phase-1/rollout-fixture-candidate.jsonl.zst',
    ])
    const codex = phase.transcripts.find((item) => item.harness === 'codex')
    assert.equal(codex.sessionId, 'codex-session-1')
    assert.equal(codex.model, 'fixture-codex')
    assert.match(codex.source, /^~\/\.codex-personal\/sessions\//, 'sources are recorded home-relative')
    assert.ok(codex.redactions.OPENAI_KEY >= 1 && codex.redactions.EMAIL >= 1 && codex.redactions.ACCOUNT_ID >= 1)
    assert.equal(phase.transcripts.find((item) => item.harness === 'cursor').startedAt, new Date(now.getTime() + 20_000).toISOString(), 'cursor timing comes from chat meta')

    // Every archived byte is scrubbed; sha256 covers the scrubbed bytes.
    for (const item of phase.transcripts) {
      const bytes = decompress(fs.readFileSync(path.join(transcriptsRoot, item.file)))
      assert.equal(bytes.length, item.scrubbedBytes)
      for (const secret of Object.values(FAKE)) assert.ok(!bytes.includes(secret), `${item.file} leaks a fixture secret`)
    }
    assert.match(decompress(fs.readFileSync(path.join(transcriptsRoot, 'phase-1/claude-session-1/tool-results/big-output.txt.zst'))).toString(), /GITHUB_TOKEN=\*\*\*REDACTED_GITHUB_TOKEN\*\*\*/)

    // Derived operator log: messages, interrupts, rejections, policy.
    const operator = fs.readFileSync(path.join(transcriptsRoot, phase.operatorLog), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    const kinds = operator.map((event) => event.kind)
    for (const kind of ['user-message', 'interrupt', 'tool-rejected', 'policy', 'permission-mode']) assert.ok(kinds.includes(kind), `operator log has ${kind}`)
    assert.ok(operator.some((event) => event.harness === 'cursor' && event.text === 'Phase 1 please'))
    assert.ok(!JSON.stringify(operator).includes(FAKE.openai))
    assert.equal(phase.operatorSummary.toolRejections, 1)

    // Harness operator log records the seal.
    const events = fs.readFileSync(path.join(transcriptsRoot, 'operator.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    const sealEvent = events.find((event) => event.command === 'seal')
    assert.equal(sealEvent.phase, 1)
    assert.equal(sealEvent.transcripts.sessions, 3)

    // A later call that finds nothing keeps what was archived.
    const again = recordPhaseTranscripts(root, id, { phase: 1, workspace: started.workspace, command: 'transcripts', homes: { codex: [], claude: [], cursor: [] }, warn: () => {} })
    assert.equal(again.status, 'kept')
    assert.equal(readJson(path.join(transcriptsRoot, 'manifest.json')).candidate['1'].sessions, 3)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(agent.home, { recursive: true, force: true })
  }
})

test('a seal with no transcripts warns loudly, records the gap, and does not throw', () => {
  const { root, id, started } = startedFixture()
  try {
    const { stageDir, digest } = sealWithoutGates(root, id)
    const warnings = []
    const result = recordPhaseTranscripts(root, id, {
      phase: 1,
      workspace: started.workspace,
      command: 'seal',
      homes: { codex: [], claude: [], cursor: [] },
      warn: (message) => warnings.push(message),
    })
    assert.equal(result.status, 'missing')
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /No Phase 1 transcripts found/)
    assert.match(warnings[0], /pnpm bench transcripts .* --phase 1 --transcripts/)
    const manifest = readJson(path.join(root, 'runs', id, 'transcripts', 'manifest.json'))
    assert.equal(manifest.candidate['1'].status, 'missing')
    assert.match(manifest.candidate['1'].reason, /No Codex, Claude Code, or Cursor session/)
    assert.equal(loadRun(root, id).stages[0].status, 'complete', 'the phase is sealed regardless')
    assert.equal(hashTree(stageDir).digest, digest)

    // A transcript that cannot be read is also a warning, not a failure.
    const failed = recordPhaseTranscripts(root, id, {
      phase: 1,
      workspace: started.workspace,
      explicit: [path.join(root, 'does-not-exist.jsonl')],
      command: 'seal',
      homes: { codex: [], claude: [], cursor: [] },
      warn: (message) => warnings.push(message),
    })
    assert.equal(failed.status, 'failed')
    assert.match(warnings.at(-1), /were NOT archived/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('explicit transcripts and evaluator sessions are archived to their own subtrees', () => {
  const { root, id, started } = startedFixture()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'stagebench-outside-'))
  try {
    sealWithoutGates(root, id)
    const explicitFile = path.join(outside, 'exported-session.jsonl')
    fs.writeFileSync(explicitFile, jsonl([{ type: 'user', sessionId: 'exported', timestamp: new Date().toISOString(), message: { content: `hello ${FAKE.email}` } }]))
    const empty = { codex: [], claude: [], cursor: [] }
    const candidate = recordPhaseTranscripts(root, id, { phase: 1, workspace: started.workspace, explicit: [explicitFile], command: 'seal', homes: empty, warn: () => {} })
    assert.equal(candidate.status, 'archived')
    const evaluation = recordPhaseTranscripts(root, id, { kind: 'eval', phase: 1, workspace: path.join(outside, 'eval-ws'), explicit: [explicitFile], command: 'score', homes: empty, warn: () => {} })
    assert.equal(evaluation.status, 'archived')
    const base = path.join(root, 'runs', id, 'transcripts')
    assert.ok(fs.existsSync(path.join(base, 'phase-1', 'exported-session.jsonl.zst')))
    assert.ok(fs.existsSync(path.join(base, 'eval', 'phase-1', 'exported-session.jsonl.zst')), 'evaluator transcripts live under eval/, apart from candidate ones')
    const manifest = readJson(path.join(base, 'manifest.json'))
    assert.equal(manifest.eval['1'].transcripts[0].file, 'eval/phase-1/exported-session.jsonl.zst')
    assert.equal(manifest.candidate['1'].transcripts[0].file, 'phase-1/exported-session.jsonl.zst')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('the CLI logs start and archives transcripts for a sealed phase after the fact', () => {
  const root = fixtureRoot()
  const now = new Date()
  const created = createRun(root, { model: 'CLI Fixture', provider: 'fixture', target: '1' })
  const env = { ...process.env, STAGEBENCH_HOME: homeRoot }
  delete env.CODEX_HOME
  delete env.CLAUDE_CONFIG_DIR
  const cli = (args, extraEnv = {}) => spawnSync(process.execPath, [path.join(sourceRoot, 'bench', 'cli.mjs'), ...args, '--root', root], { encoding: 'utf8', env: { ...env, ...extraEnv } })
  let agent
  try {
    const start = cli(['start', created.id])
    assert.equal(start.status, 0, start.stderr)
    const workspace = JSON.parse(start.stdout).workspace
    const log = path.join(root, 'runs', created.id, 'transcripts', 'operator.jsonl')
    assert.equal(JSON.parse(fs.readFileSync(log, 'utf8').trim()).command, 'start')

    fs.writeFileSync(path.join(workspace, 'candidate', 'index.html'), '<h1>candidate</h1>')
    sealWithoutGates(root, created.id)
    agent = fakeAgentHome(workspace, now)
    const archived = cli(['transcripts', created.id, '--phase', '1'], { HOME: agent.home })
    assert.equal(archived.status, 0, archived.stderr)
    const result = JSON.parse(archived.stdout)
    assert.equal(result.status, 'archived')
    assert.equal(result.sessions, 3)
    assert.ok(fs.readFileSync(log, 'utf8').includes('"command":"transcripts"'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    if (agent) fs.rmSync(agent.home, { recursive: true, force: true })
  }
})

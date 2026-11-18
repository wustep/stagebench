// Transcript archiving: the agent sessions behind each sealed phase are part
// of the run's record, so `seal` (candidate) and `score` (evaluator) copy them
// into runs/<id>/transcripts/ — scrubbed of secrets and zstd-compressed —
// beside, never inside, the sealed stage<N>/ tree. Transcripts are sidecar
// records: they are not part of the candidate artifact or its digest.
//
//   runs/<id>/transcripts/manifest.json          what was archived, per phase, and every gap
//   runs/<id>/transcripts/operator.jsonl         harness events (start/seal/score/transcripts)
//   runs/<id>/transcripts/phase-<N>/*.zst        candidate sessions, original filenames
//   runs/<id>/transcripts/phase-<N>/operator.jsonl   operator messages / approvals derived from them
//   runs/<id>/transcripts/eval/phase-<N>/...     evaluator + reviewer sessions, same shape
//
// Sessions are found by the working directory the agent ran in (the phase
// workspace or its candidate/ subdirectory), across the session stores of the
// agents actually used: Codex rollouts, Claude Code projects, Cursor agent
// transcripts. Explicit files can be added for anything discovery misses.
// Missing transcripts never fail a seal — the gap is recorded instead.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { readJson, sha256, writeJson } from '../shared.mjs'
import { residualSecretKinds, scrubFile, scrubJsonl } from '../scrub.mjs'

export const MANIFEST_VERSION = 1
const SLACK_MS = 60 * 60 * 1000 // tolerate clock skew / sessions opened just before `start`

export function transcriptsDir(root, id) {
  return path.join(root, 'runs', id, 'transcripts')
}

function phaseDirName(kind, phase) {
  return kind === 'eval' ? path.join('eval', `phase-${phase}`) : `phase-${phase}`
}

const toPosix = (value) => value.split(path.sep).join('/')

// Replace the home directory with ~ so manifests record the store and path
// class without depending on the machine they were archived on.
function homeRelative(file, homeDir = os.homedir()) {
  return file.startsWith(`${homeDir}${path.sep}`) ? `~/${toPosix(path.relative(homeDir, file))}` : toPosix(file)
}

// --- session stores ---------------------------------------------------------

// The agent homes to search. $CODEX_HOME / $CLAUDE_CONFIG_DIR win, then every
// ~/.codex* and ~/.claude* home that has a session store (the operator runs
// separate personal/work homes), then ~/.cursor.
export function agentHomes({ env = process.env, homeDir = os.homedir() } = {}) {
  const dotHomes = (prefix) => {
    try {
      return fs.readdirSync(homeDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && (entry.name === prefix || entry.name.startsWith(`${prefix}-`) || entry.name.startsWith(`${prefix}_`)))
        .map((entry) => path.join(homeDir, entry.name))
    } catch {
      return []
    }
  }
  const unique = (list) => [...new Set(list.filter(Boolean).map((entry) => path.resolve(entry)))]
  const codex = unique([env.CODEX_HOME, path.join(homeDir, '.codex-personal'), ...dotHomes('.codex')])
    .flatMap((home) => ['sessions', 'archived_sessions'].map((sub) => path.join(home, sub)))
    .filter((dir) => fs.existsSync(dir))
  const claude = unique([env.CLAUDE_CONFIG_DIR, path.join(homeDir, '.claude-personal'), ...dotHomes('.claude')])
    .map((home) => path.join(home, 'projects'))
    .filter((dir) => fs.existsSync(dir))
  const cursor = unique([path.join(homeDir, '.cursor')]).filter((dir) => fs.existsSync(path.join(dir, 'projects')) || fs.existsSync(path.join(dir, 'chats')))
  return { codex, claude, cursor }
}

// Read just the first line of a (possibly large) JSONL file.
function firstLine(file, maxBytes = 4 * 1024 * 1024) {
  const fd = fs.openSync(file, 'r')
  try {
    let collected = Buffer.alloc(0)
    const chunk = Buffer.alloc(64 * 1024)
    let position = 0
    while (collected.length < maxBytes) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, position)
      if (read === 0) break
      const slice = chunk.subarray(0, read)
      const newline = slice.indexOf(10)
      if (newline >= 0) return Buffer.concat([collected, slice.subarray(0, newline)]).toString('utf8')
      collected = Buffer.concat([collected, slice])
      position += read
    }
    return collected.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const cwdMatches = (cwd, cwds) => typeof cwd === 'string' && cwds.some((target) => cwd === target || cwd.startsWith(`${target}${path.sep}`))

function inWindow(startMs, endMs, since, until) {
  if (since && Number.isFinite(endMs) && endMs < since - SLACK_MS) return false
  if (until && Number.isFinite(startMs) && startMs > until + SLACK_MS) return false
  return true
}

// Codex rollouts live under sessions/YYYY/MM/DD/rollout-*.jsonl (local date)
// and archived_sessions/; the first line is session_meta with the cwd.
function discoverCodex(dirs, cwds, since, until) {
  const found = []
  const days = new Set()
  if (since) {
    for (let t = since - 2 * 86_400_000; t <= (until ?? Date.now()) + 2 * 86_400_000; t += 86_400_000) {
      const d = new Date(t)
      days.add(`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`)
    }
  }
  const candidates = []
  for (const dir of dirs) {
    if (path.basename(dir) === 'sessions') {
      if (days.size > 0) {
        for (const day of days) {
          const dayDir = path.join(dir, ...day.split('/'))
          if (fs.existsSync(dayDir)) for (const name of fs.readdirSync(dayDir)) if (name.endsWith('.jsonl')) candidates.push(path.join(dayDir, name))
        }
      } else {
        for (const entry of fs.readdirSync(dir, { recursive: true })) if (String(entry).endsWith('.jsonl')) candidates.push(path.join(dir, String(entry)))
      }
    } else {
      for (const name of fs.readdirSync(dir)) if (name.endsWith('.jsonl')) candidates.push(path.join(dir, name))
    }
  }
  for (const file of candidates) {
    const meta = parseJson(firstLine(file))
    const cwd = meta?.payload?.cwd
    if (!cwdMatches(cwd, cwds)) continue
    const stat = fs.statSync(file)
    if (!inWindow(Date.parse(meta?.payload?.timestamp ?? meta?.timestamp), stat.mtimeMs, since, until)) continue
    found.push({ file, harness: 'codex', cwd, sidecars: [] })
  }
  return found
}

// Claude Code keys a project directory by the cwd with every non-alphanumeric
// character replaced by '-'. Subagent transcripts and offloaded tool results
// live under <project>/<session-id>/.
function claudeSlug(cwd) {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    .sort()
}

function discoverClaude(dirs, cwds, since, until) {
  const found = []
  for (const projects of dirs) {
    for (const cwd of cwds) {
      const slug = claudeSlug(cwd)
      // Very long cwds are truncated with a hash suffix; accept a prefix match.
      const names = fs.readdirSync(projects).filter((name) => name === slug || (slug.length > 200 && name.startsWith(slug.slice(0, 200))))
      for (const name of names) {
        const projectDir = path.join(projects, name)
        for (const entry of fs.readdirSync(projectDir)) {
          if (!entry.endsWith('.jsonl')) continue
          const file = path.join(projectDir, entry)
          const stat = fs.statSync(file)
          const head = parseJson(firstLine(file))
          if (!inWindow(Date.parse(head?.timestamp ?? stat.birthtime), stat.mtimeMs, since, until)) continue
          const sessionDir = path.join(projectDir, entry.replace(/\.jsonl$/, ''))
          found.push({ file, harness: 'claude-code', cwd, sidecars: listFilesRecursive(sessionDir) })
        }
      }
    }
  }
  return found
}

// Cursor agent CLI: chats/<hash>/<chat-id>/meta.json carries the cwd; the
// readable transcript is projects/<slug>/agent-transcripts/<chat-id>/<chat-id>.jsonl.
function discoverCursor(dirs, cwds, since, until) {
  const found = []
  for (const home of dirs) {
    const chatIds = new Map()
    const chats = path.join(home, 'chats')
    if (fs.existsSync(chats)) {
      for (const bucket of fs.readdirSync(chats)) {
        const bucketDir = path.join(chats, bucket)
        if (!fs.statSync(bucketDir).isDirectory()) continue
        for (const chatId of fs.readdirSync(bucketDir)) {
          const metaPath = path.join(bucketDir, chatId, 'meta.json')
          if (!fs.existsSync(metaPath)) continue
          const meta = parseJson(fs.readFileSync(metaPath, 'utf8'))
          if (!cwdMatches(meta?.cwd, cwds)) continue
          if (!inWindow(meta.createdAtMs, meta.updatedAtMs, since, until)) continue
          chatIds.set(chatId, meta.cwd)
        }
      }
    }
    const projects = path.join(home, 'projects')
    const slugs = new Set(cwds.map((cwd) => cwd.replace(/^\/+/, '').replace(/[^A-Za-z0-9]+/g, '-')))
    if (fs.existsSync(projects)) {
      for (const project of fs.readdirSync(projects)) {
        const transcripts = path.join(projects, project, 'agent-transcripts')
        if (!fs.existsSync(transcripts)) continue
        for (const chatId of fs.readdirSync(transcripts)) {
          const file = path.join(transcripts, chatId, `${chatId}.jsonl`)
          if (!fs.existsSync(file)) continue
          if (!chatIds.has(chatId)) {
            if (!slugs.has(project)) continue
            const stat = fs.statSync(file)
            if (!inWindow(stat.birthtimeMs, stat.mtimeMs, since, until)) continue
          }
          found.push({ file, harness: 'cursor', cwd: chatIds.get(chatId) ?? null, sidecars: [] })
        }
      }
    }
  }
  return found
}

// Find every agent session whose working directory is one of `cwds` and whose
// activity overlaps [since, until] (epoch ms, either optional).
export function discoverSessions(cwds, { homes = agentHomes(), since = null, until = null } = {}) {
  const resolved = cwds.map((cwd) => path.resolve(cwd))
  const sessions = [
    ...discoverCodex(homes.codex ?? [], resolved, since, until),
    ...discoverClaude(homes.claude ?? [], resolved, since, until),
    ...discoverCursor(homes.cursor ?? [], resolved, since, until),
  ]
  const seen = new Set()
  return sessions.filter((session) => !seen.has(session.file) && seen.add(session.file))
}

// --- describing a transcript ------------------------------------------------

export function detectHarness(file, firstRecord) {
  if (/\/agent-transcripts\//.test(toPosix(file)) || (firstRecord && 'role' in firstRecord && 'message' in firstRecord && !('type' in firstRecord))) return 'cursor'
  if (firstRecord?.type === 'session_meta' || /(^|\/)rollout-[^/]*\.jsonl$/.test(toPosix(file))) return 'codex'
  if (firstRecord && ('sessionId' in firstRecord || ['user', 'assistant', 'summary', 'system', 'permission-mode', 'session-owner', 'file-history-snapshot'].includes(firstRecord.type))) return 'claude-code'
  return 'unknown'
}

const textOf = (content) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((part) => part && (part.type === 'text' || part.type === 'input_text')).map((part) => part.text ?? '').join('\n')
}

// Codex injects environment/instruction blocks as user-role messages; they are
// harness context, not operator input.
const INJECTED_USER_TEXT = /^\s*(?:<environment_context>|<user_instructions>|<permissions instructions>|<collaboration_mode>|# AGENTS\.md|<INSTRUCTIONS>|<turn_aborted>)/

function cursorQuery(text) {
  const match = /<user_query>\s*([\s\S]*?)\s*<\/user_query>/.exec(text)
  return match ? match[1] : text.replace(/<timestamp>[\s\S]*?<\/timestamp>/g, '').trim()
}

// Operator-facing events in a transcript: messages the operator typed,
// interrupts, tool approvals/rejections, and permission/approval-policy
// changes. Each is { at, kind, text? , detail? }.
export function extractOperatorEvents(records, harness) {
  const events = []
  if (harness === 'codex') {
    // turn_context and thread_settings_applied describe policy in different
    // shapes; dedupe each against its own previous value.
    const lastPolicy = { turn: null, thread: null }
    for (const record of records) {
      const payload = record.payload ?? {}
      if (record.type === 'event_msg' && payload.type === 'item_completed' && payload.item?.type === 'UserMessage') {
        events.push({ at: record.timestamp, kind: 'user-message', text: textOf(payload.item.content) })
      } else if (record.type === 'event_msg' && payload.type === 'user_message') {
        events.push({ at: record.timestamp, kind: 'user-message', text: payload.message ?? '' })
      } else if (record.type === 'event_msg' && /approval/.test(payload.type ?? '')) {
        events.push({ at: record.timestamp, kind: 'approval', detail: { type: payload.type, command: payload.command ?? null, decision: payload.decision ?? null, reason: payload.reason ?? null } })
      } else if (record.type === 'event_msg' && payload.type === 'turn_aborted') {
        events.push({ at: record.timestamp, kind: 'interrupt', detail: { reason: payload.reason ?? null } })
      } else if (record.type === 'event_msg' && payload.type === 'thread_settings_applied') {
        const settings = payload.thread_settings ?? {}
        const policy = {
          model: settings.model ?? null,
          approvalPolicy: settings.approval_policy ?? null,
          approvalsReviewer: settings.approvals_reviewer ?? null,
          permissionProfile: settings.active_permission_profile?.id ?? null,
          network: settings.permission_profile?.network ?? null,
        }
        const key = JSON.stringify(policy)
        if (key !== lastPolicy.thread) events.push({ at: record.timestamp, kind: 'policy', detail: policy })
        lastPolicy.thread = key
      } else if (record.type === 'turn_context') {
        const policy = { model: payload.model ?? null, approvalPolicy: payload.approval_policy ?? null, sandbox: payload.sandbox_policy?.type ?? null, effort: payload.effort ?? null }
        const key = JSON.stringify(policy)
        if (key !== lastPolicy.turn) events.push({ at: record.timestamp, kind: 'policy', detail: policy })
        lastPolicy.turn = key
      }
    }
    // Older rollouts carry the operator prompt only as a user-role message.
    if (!events.some((event) => event.kind === 'user-message')) {
      for (const record of records) {
        const payload = record.payload ?? {}
        if (record.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
          const text = textOf(payload.content)
          if (text && !INJECTED_USER_TEXT.test(text)) events.push({ at: record.timestamp, kind: 'user-message', text })
        }
      }
    }
  } else if (harness === 'claude-code') {
    let lastMode = null
    for (const record of records) {
      if (record.permissionMode && record.permissionMode !== lastMode) {
        events.push({ at: record.timestamp ?? null, kind: 'permission-mode', detail: { mode: record.permissionMode } })
        lastMode = record.permissionMode
      }
      if (record.type === 'permission-mode' && record.permissionMode === undefined && record.mode && record.mode !== lastMode) {
        events.push({ at: record.timestamp ?? null, kind: 'permission-mode', detail: { mode: record.mode } })
        lastMode = record.mode
      }
      if (record.type !== 'user' || record.isMeta || record.isSidechain) continue
      const content = record.message?.content
      if (Array.isArray(content) && content.some((part) => part?.type === 'tool_result')) {
        for (const part of content) {
          if (part?.type !== 'tool_result') continue
          const text = typeof part.content === 'string' ? part.content : textOf(part.content)
          if (/doesn't want to proceed with this tool use|tool use was rejected|permission to use .* (?:was|has been) denied/i.test(text)) {
            events.push({ at: record.timestamp, kind: 'tool-rejected', detail: { toolUseId: part.tool_use_id ?? null }, text })
          }
        }
        continue
      }
      const text = textOf(content)
      if (!text) continue
      if (/^\[Request interrupted by user/.test(text)) events.push({ at: record.timestamp, kind: 'interrupt', text })
      else events.push({ at: record.timestamp, kind: 'user-message', text })
    }
  } else if (harness === 'cursor') {
    for (const record of records) {
      if (record.role !== 'user') continue
      const raw = textOf(record.message?.content)
      const stamp = /<timestamp>([\s\S]*?)<\/timestamp>/.exec(raw)?.[1] ?? null
      const text = cursorQuery(raw)
      events.push({ at: null, localTime: stamp, kind: text ? 'user-message' : 'resume', ...(text ? { text } : {}) })
    }
  }
  return events
}

// Metadata for one transcript: harness, session id, cwd, time span, model,
// and the first operator prompt (truncated). `records` are the parsed lines of
// the already-scrubbed transcript.
export function describeTranscript(file, records, { cursorHomes = [] } = {}) {
  const harness = detectHarness(file, records[0])
  const stamps = records.map((record) => record.timestamp).filter((value) => typeof value === 'string').sort()
  let sessionId = null
  let cwd = null
  let model = null
  if (harness === 'codex') {
    const meta = records.find((record) => record.type === 'session_meta')?.payload ?? {}
    sessionId = meta.id ?? meta.session_id ?? null
    cwd = meta.cwd ?? null
    model = records.find((record) => record.type === 'turn_context')?.payload?.model ?? null
  } else if (harness === 'claude-code') {
    sessionId = records.find((record) => record.sessionId)?.sessionId ?? null
    cwd = records.find((record) => record.cwd)?.cwd ?? null
    model = records.find((record) => record.type === 'assistant' && record.message?.model && record.message.model !== '<synthetic>')?.message?.model ?? null
  } else if (harness === 'cursor') {
    sessionId = path.basename(file).replace(/\.jsonl(?:\.zst)?$/, '')
  }
  let startedAt = stamps[0] ?? null
  let endedAt = stamps.at(-1) ?? null
  if (harness === 'cursor') {
    for (const home of cursorHomes) {
      const chats = path.join(home, 'chats')
      if (!fs.existsSync(chats)) continue
      for (const bucket of fs.readdirSync(chats)) {
        const metaPath = path.join(chats, bucket, sessionId, 'meta.json')
        if (!fs.existsSync(metaPath)) continue
        const meta = parseJson(fs.readFileSync(metaPath, 'utf8')) ?? {}
        cwd = meta.cwd ?? cwd
        if (meta.createdAtMs) startedAt = new Date(meta.createdAtMs).toISOString()
        if (meta.updatedAtMs) endedAt = new Date(meta.updatedAtMs).toISOString()
      }
    }
  }
  const events = extractOperatorEvents(records, harness)
  const firstPrompt = events.find((event) => event.kind === 'user-message' && event.text)?.text ?? null
  return {
    harness,
    sessionId,
    cwd,
    model,
    startedAt,
    endedAt,
    records: records.length,
    firstPrompt: firstPrompt ? firstPrompt.replace(/\s+/g, ' ').trim().slice(0, 240) : null,
    events,
  }
}

// Records are JSON objects. A console log archived beside the sessions is
// mostly prose, and a line of it can happen to be valid JSON of another kind
// (a quoted string, a number); those are not records.
const parseRecords = (text) => text.split('\n').filter(Boolean).map(parseJson).filter((record) => record !== null && typeof record === 'object' && !Array.isArray(record))

// --- archiving --------------------------------------------------------------

export function compress(buffer) {
  const C = zlib.constants
  return zlib.zstdCompressSync(buffer, {
    params: { [C.ZSTD_c_compressionLevel]: 12, [C.ZSTD_c_enableLongDistanceMatching]: 1, [C.ZSTD_c_windowLog]: 27 },
  })
}

export function decompress(buffer) {
  return zlib.zstdDecompressSync(buffer)
}

// Scrub, verify, compress, and write one file. Throws (writing nothing) if a
// second scrub pass still finds a secret.
function archiveFile(source, destination) {
  const raw = fs.readFileSync(source)
  const { text, redactions } = scrubFile(source, raw)
  const residual = residualSecretKinds(source, text)
  if (residual.length > 0) throw new Error(`Refusing to archive ${path.basename(source)}: scrub left ${residual.join(', ')}`)
  const scrubbed = Buffer.from(text, 'utf8')
  const packed = compress(scrubbed)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, packed)
  return { stats: { rawBytes: raw.length, scrubbedBytes: scrubbed.length, compressedBytes: packed.length, sha256: sha256(scrubbed), redactions }, text }
}

function loadManifest(root, id) {
  const file = path.join(transcriptsDir(root, id), 'manifest.json')
  if (fs.existsSync(file)) return readJson(file)
  return { version: MANIFEST_VERSION, runId: id, candidate: {}, eval: {} }
}

function saveManifest(root, id, manifest, now) {
  manifest.updatedAt = now.toISOString()
  writeJson(path.join(transcriptsDir(root, id), 'manifest.json'), manifest)
}

function sumRedactions(entries) {
  const totals = {}
  for (const entry of entries) for (const [kind, n] of Object.entries(entry.redactions ?? {})) totals[kind] = (totals[kind] ?? 0) + n
  return totals
}

// Archive `sessions` ({ file, sidecars? }) for one phase of a run.
// kind: 'candidate' (runs/<id>/transcripts/phase-N) or 'eval' (…/eval/phase-N).
// Archiving is additive: a session already archived under the same name is
// replaced, every other archived session of the phase is kept, so a later
// call (say, adding a file discovery missed) never drops earlier evidence.
// With no sessions and nothing archived yet, the gap is recorded instead.
export function archiveSessions(root, id, { kind = 'candidate', phase, sessions, source, workspace = null, reason = null, homes = agentHomes(), now = new Date(), homeDir = os.homedir() }) {
  if (!['candidate', 'eval'].includes(kind)) throw new Error(`Unknown transcript kind: ${kind}`)
  const base = transcriptsDir(root, id)
  const phaseDir = path.join(base, phaseDirName(kind, phase))
  const manifest = loadManifest(root, id)
  manifest[kind] ??= {}
  const previous = manifest[kind][String(phase)]

  if (!sessions.length) {
    if (previous?.status === 'archived') return { ...previous, status: 'kept', phase, kind }
    manifest[kind][String(phase)] = {
      status: 'missing',
      recordedAt: now.toISOString(),
      source,
      workspace: workspace ? homeRelative(workspace, homeDir) : null,
      reason: reason ?? 'No agent session was found for this phase.',
      searched: [...(homes.codex ?? []), ...(homes.claude ?? []), ...(homes.cursor ?? [])].map((dir) => homeRelative(dir, homeDir)),
    }
    saveManifest(root, id, manifest, now)
    return { status: 'missing', phase, kind, transcripts: [], operatorLog: null }
  }

  const added = []
  const replaced = new Set()
  for (const session of sessions) {
    const name = path.basename(session.file)
    const destination = path.join(phaseDir, `${name}.zst`)
    const { stats, text } = archiveFile(session.file, destination)
    const described = describeTranscript(session.file, parseRecords(text), { cursorHomes: homes.cursor ?? [] })
    const sessionStem = name.replace(/\.jsonl$/, '')
    const fileKey = toPosix(path.relative(base, destination))
    replaced.add(fileKey)
    added.push({
      file: fileKey,
      role: 'session',
      harness: described.harness,
      sessionId: described.sessionId,
      cwd: described.cwd ? homeRelative(described.cwd, homeDir) : null,
      model: described.model,
      startedAt: described.startedAt,
      endedAt: described.endedAt,
      records: described.records,
      firstPrompt: described.firstPrompt,
      source: homeRelative(session.file, homeDir),
      ...stats,
    })
    // Subagent transcripts and offloaded tool results, kept in the same
    // relative layout under the session's own directory.
    const sessionDir = session.file.replace(/\.jsonl$/, '')
    for (const sidecar of session.sidecars ?? []) {
      const relative = path.relative(sessionDir, sidecar)
      const sidecarDestination = path.join(phaseDir, sessionStem, `${relative}.zst`)
      const { stats: sidecarStats } = archiveFile(sidecar, sidecarDestination)
      const sidecarKey = toPosix(path.relative(base, sidecarDestination))
      replaced.add(sidecarKey)
      added.push({
        file: sidecarKey,
        role: /(^|\/)subagents\//.test(toPosix(relative)) ? 'subagent' : 'tool-result',
        parent: described.sessionId,
        source: homeRelative(sidecar, homeDir),
        ...sidecarStats,
      })
    }
  }
  const kept = (previous?.transcripts ?? []).filter((item) => !replaced.has(item.file) && fs.existsSync(path.join(base, item.file)))
  const transcripts = [...kept, ...added].sort((a, b) => String(a.startedAt ?? '~').localeCompare(String(b.startedAt ?? '~')) || a.file.localeCompare(b.file))

  // Derived operator log — what the operator said and allowed, in order —
  // rebuilt from every archived (already scrubbed) session of the phase.
  const operatorEvents = []
  for (const item of transcripts.filter((entry) => entry.role === 'session' || entry.role === 'subagent')) {
    const records = parseRecords(decompress(fs.readFileSync(path.join(base, item.file))).toString('utf8'))
    const harness = item.harness ?? detectHarness(item.file, records[0])
    for (const event of extractOperatorEvents(records, harness)) {
      operatorEvents.push({ session: item.sessionId ?? item.parent ?? path.basename(item.file), ...(item.role === 'subagent' ? { subagent: true } : {}), harness, ...event })
    }
  }
  operatorEvents.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')))
  const operatorPath = path.join(phaseDir, 'operator.jsonl')
  const scrubbedOperator = scrubJsonl(operatorEvents.map((event) => JSON.stringify(event)).join('\n') + (operatorEvents.length ? '\n' : ''))
  fs.writeFileSync(operatorPath, scrubbedOperator.text)

  const entry = {
    status: 'archived',
    archivedAt: now.toISOString(),
    source,
    workspace: workspace ? homeRelative(workspace, homeDir) : (previous?.workspace ?? null),
    sessions: transcripts.filter((item) => item.role === 'session').length,
    rawBytes: transcripts.reduce((sum, item) => sum + item.rawBytes, 0),
    compressedBytes: transcripts.reduce((sum, item) => sum + item.compressedBytes, 0),
    redactions: sumRedactions(transcripts),
    operatorLog: toPosix(path.relative(base, operatorPath)),
    operatorSummary: summarizeOperatorEvents(operatorEvents),
    transcripts,
  }
  manifest[kind][String(phase)] = entry
  saveManifest(root, id, manifest, now)
  return { status: 'archived', phase, kind, ...entry }
}

export function summarizeOperatorEvents(events) {
  const summary = { userMessages: 0, interrupts: 0, approvals: 0, toolRejections: 0, policyChanges: 0, permissionModes: [] }
  for (const event of events) {
    if (event.kind === 'user-message') summary.userMessages++
    else if (event.kind === 'interrupt') summary.interrupts++
    else if (event.kind === 'approval') summary.approvals++
    else if (event.kind === 'tool-rejected') summary.toolRejections++
    else if (event.kind === 'policy') summary.policyChanges++
    else if (event.kind === 'permission-mode' && !summary.permissionModes.includes(event.detail?.mode)) summary.permissionModes.push(event.detail?.mode)
  }
  return summary
}

// The seal/score entry point: discover the phase's sessions by working
// directory, add any explicit files, and archive them. Never throws for a
// missing transcript — it returns { status: 'missing' } and records the gap —
// but does throw if a found transcript cannot be scrubbed safely.
export function archivePhaseTranscripts(root, id, { kind = 'candidate', phase, workspace, explicit = [], since = null, until = null, homes = agentHomes(), source = 'seal', now = new Date(), homeDir = os.homedir() }) {
  const cwds = workspace ? [workspace, path.join(workspace, kind === 'eval' ? 'artifact' : 'candidate')] : []
  const discovered = cwds.length ? discoverSessions(cwds, { homes, since, until }) : []
  const sessions = [...discovered]
  for (const file of explicit) {
    const resolved = path.resolve(file)
    if (!fs.existsSync(resolved)) throw new Error(`--transcripts: no such file ${file}`)
    if (sessions.some((session) => session.file === resolved)) continue
    const sessionDir = resolved.replace(/\.jsonl$/, '')
    sessions.push({ file: resolved, harness: null, sidecars: resolved.endsWith('.jsonl') ? listFilesRecursive(sessionDir) : [] })
  }
  sessions.sort((a, b) => fs.statSync(a.file).mtimeMs - fs.statSync(b.file).mtimeMs)
  const reason = workspace
    ? `No Codex, Claude Code, or Cursor session with cwd ${homeRelative(workspace, homeDir)} (or a subdirectory) was found${since ? ` after ${new Date(since).toISOString()}` : ''}. Pass --transcripts <file[,file...]> to archive sessions stored elsewhere.`
    : 'No transcript files were given.'
  return archiveSessions(root, id, { kind, phase, sessions, source, workspace, reason, homes, now, homeDir })
}

// What `seal`, `score`, and `transcripts` call. Never throws: a phase's
// artifact must still be sealed/scored when its transcripts are missing or
// cannot be archived, so every failure becomes a loud warning plus a gap in
// the manifest, and the outcome is appended to the harness operator log.
export function recordPhaseTranscripts(root, id, { kind = 'candidate', phase, workspace, explicit = [], since = null, until = null, command, homes = agentHomes(), homeDir = os.homedir(), now = new Date(), warn = (message) => console.error(message) }) {
  const label = kind === 'eval' ? `evaluator transcripts for Phase ${phase}` : `Phase ${phase} transcripts`
  let result
  try {
    result = archivePhaseTranscripts(root, id, { kind, phase, workspace, explicit, since, until, homes, homeDir, source: command, now })
  } catch (error) {
    warn(`⚠ ${label} were NOT archived: ${error.message}`)
    try {
      archiveSessions(root, id, { kind, phase, sessions: [], source: command, workspace, reason: `Archiving failed: ${error.message}`, homes, homeDir, now })
    } catch {
      // The manifest itself could not be written; the warning above stands.
    }
    result = { status: 'failed', phase, kind, error: error.message }
  }
  if (result.status === 'missing') {
    warn(`⚠ No ${label} found for ${id}. The gap is recorded in runs/${id}/transcripts/manifest.json; archive them later with: pnpm bench transcripts ${id} --phase ${phase}${kind === 'eval' ? ' --eval' : ''} --transcripts <file[,file...]>`)
  }
  const summary = {
    status: result.status,
    sessions: result.sessions ?? 0,
    compressedBytes: result.compressedBytes ?? 0,
    redactions: result.redactions ?? {},
    operatorSummary: result.operatorSummary ?? null,
    manifest: `runs/${id}/transcripts/manifest.json`,
    ...(result.error ? { error: result.error } : {}),
  }
  try {
    appendOperatorEvent(root, id, {
      command,
      phase,
      kind,
      workspace: workspace ?? null,
      explicitTranscripts: explicit,
      transcripts: { status: summary.status, sessions: summary.sessions, files: (result.transcripts ?? []).map((item) => item.file), operatorSummary: summary.operatorSummary },
    }, now)
  } catch (error) {
    warn(`⚠ could not append to the operator log: ${error.message}`)
  }
  return summary
}

// Append one harness event to runs/<id>/transcripts/operator.jsonl. This is
// the operator log the harness itself keeps: which command ran, for which
// phase and workspace, and what was archived. Values are scrubbed.
export function appendOperatorEvent(root, id, event, now = new Date()) {
  const file = path.join(transcriptsDir(root, id), 'operator.jsonl')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const line = scrubJsonl(JSON.stringify({ at: now.toISOString(), runId: id, ...event })).text
  fs.appendFileSync(file, `${line}\n`)
  return file
}

// Parse a --transcripts value: comma-separated paths (parseArgs is last-wins
// per flag, so repeating the flag would silently drop files).
export function parseTranscriptList(value) {
  if (value === undefined || value === null || value === 'true') return []
  return String(value).split(',').map((file) => file.trim()).filter(Boolean)
}

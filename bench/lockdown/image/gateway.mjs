#!/usr/bin/env node
// Stagebench lockdown egress gateway.
//
// A candidate container sits on an internal network with no route to the
// internet, no external DNS, and no route to the host. This process is the only
// other thing on that network, and so the only way bytes get in or out. It
// offers exactly three doors, and logs every use of each:
//
//   1. mirrors   (http :4873)  GET-only reverse proxies to fixed upstreams.
//                              Protocol 3 configures none: candidates install
//                              from an offline mirror inside their own box, so
//                              this door is shut for every candidate session
//                              and exists only to re-run the gates of runs
//                              sealed before protocol 3, whose lockfiles name
//                              packages the offline mirror does not carry.
//   2. inspect   (CONNECT)     TLS is terminated here for the model API hosts, so
//                              the request can be checked: path allowlist, model
//                              pinning, hosted tools (web search, remote MCP,
//                              code interpreters) stripped, secrets substituted
//                              for placeholders the candidate holds.
//   3. tunnel    (CONNECT)     an opaque TLS tunnel to an allowlisted host:port.
//                              Weaker (nothing inside it can be checked), so no
//                              default adapter uses it.
//
// Everything else — any other host, plain HTTP proxying, websocket upgrades on
// an inspected host, non-GET mirror requests — is refused and logged.
//
// The log is a hash chain: every line carries the SHA-256 of the line before
// it, so the head hash recorded at seal time pins the whole history.
//
// Zero dependencies on purpose: this file is the trusted computing base of the
// network boundary and should be readable in one sitting.
import crypto from 'node:crypto'
import dns from 'node:dns'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import zlib from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const PROXY_PORT = 3128
export const MIRROR_PORT = 4873

// ---------------------------------------------------------------------------
// Pure policy. Everything in this section is exported and unit-tested without
// a socket.
// ---------------------------------------------------------------------------

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function normalizeConfig(raw = {}) {
  const egress = (raw.egress ?? []).map((rule) => ({
    host: String(rule.host).toLowerCase(),
    port: Number(rule.port ?? 443),
    mode: rule.mode === 'tunnel' ? 'tunnel' : 'inspect',
    paths: (rule.paths ?? []).map((pattern) => new RegExp(pattern)),
    api: rule.api ?? null,
    methods: Array.isArray(rule.methods) ? rule.methods.map((method) => String(method).toUpperCase()) : undefined,
  }))
  const mirrors = Object.fromEntries(Object.entries(raw.mirrors ?? {}).map(([name, mirror]) => [name, {
    upstream: String(mirror.upstream).replace(/\/+$/, ''),
    kind: mirror.kind === 'npm' ? 'npm' : 'static',
    // Other prefixes the upstream is known to redirect into (a CDN handing a
    // download to its storage bucket). A redirect anywhere else is refused.
    redirects: (mirror.redirects ?? []).map((prefix) => String(prefix).replace(/\/+$/, '')),
  }]))
  return {
    session: raw.session ?? 'unnamed',
    dns: raw.dns?.length ? raw.dns : ['1.1.1.1', '8.8.8.8'],
    egress,
    mirrors,
    models: raw.models?.length ? raw.models.map(String) : null,
    secrets: (raw.secrets ?? []).filter((secret) => secret.placeholder && secret.value).map((secret) => ({
      placeholder: String(secret.placeholder),
      value: String(secret.value),
      hosts: (secret.hosts ?? []).map((host) => String(host).toLowerCase()),
    })),
    bodyLog: ['full', 'responses', 'none'].includes(raw.bodyLog) ? raw.bodyLog : 'responses',
    logDir: raw.logDir ?? null,
    // What is left of the phase's generated-token budget when this launch
    // starts. Once responses have reported that many output tokens, model
    // requests are refused. Null: no budget.
    budget: Number.isFinite(Number(raw.budget?.outputTokens)) && raw.budget?.outputTokens !== null ? { outputTokens: Math.max(0, Number(raw.budget.outputTokens)) } : null,
  }
}

// `*.example.com` matches any subdomain (not the apex); anything else is exact.
export function hostMatches(pattern, host) {
  if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1
  return pattern === host
}

export function splitHostPort(authority) {
  const match = /^\[?([^\]]+?)\]?:(\d+)$/.exec(String(authority ?? ''))
  if (!match) return null
  return { host: match[1].toLowerCase().replace(/\.$/, ''), port: Number(match[2]) }
}

// Default deny. A literal IP is never allowlisted: every rule names a host, and
// the gateway does the resolving.
export function egressDecision(config, host, port) {
  if (net.isIP(host)) return { action: 'deny', reason: 'literal IP addresses are never allowlisted' }
  const rule = config.egress.find((entry) => hostMatches(entry.host, host) && entry.port === port)
  if (!rule) return { action: 'deny', reason: 'host is not on the egress allowlist' }
  return { action: rule.mode, rule }
}

// An allowlisted name must not be a door to the host, the VM, or a neighbour.
export function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
  }
  const lower = address.toLowerCase()
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7))
  return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff')
}

// Map a mirror request path to its fixed upstream URL. Only names declared in
// the config resolve; the remainder is appended verbatim, so a mirror can never
// be steered to another origin.
export function mirrorTarget(config, urlPath) {
  const match = /^\/([a-z0-9-]+)(\/.*)?$/.exec(urlPath)
  if (!match) return null
  const mirror = config.mirrors[match[1]]
  if (!mirror) return null
  const rest = match[2] ?? '/'
  // Reject anything that could re-root the request once normalised, and
  // anything that does not decode at all.
  let decoded
  try { decoded = decodeURIComponent(rest.split('?')[0]) } catch { return null }
  if (rest.includes('\\') || /(^|\/)\.\.(\/|$)/.test(decoded)) return null
  return { name: match[1], mirror, url: `${mirror.upstream}${rest}` }
}

// May a mirror follow this redirect? Only over HTTPS, and only to a location
// under one of its own prefixes (compared after URL normalisation, so `..`
// cannot climb out of one).
export function redirectAllowed(prefixes, location) {
  const next = location instanceof URL ? location : new URL(location)
  if (next.protocol !== 'https:') return false
  return prefixes.some((prefix) => `${next.origin}${next.pathname}`.startsWith(`${prefix}/`))
}

// Package metadata names each tarball by absolute URL on the real registry.
// Point those at the mirror so the client never needs the registry itself.
export function rewriteNpmMetadata(text, upstream, mirrorBase) {
  return text.split(`"tarball":"${upstream}/`).join(`"tarball":"${mirrorBase}/`)
}

// Tools the harness executes itself, inside the container. Anything else in a
// `tools` array is executed by the provider on the open internet (web search,
// web fetch, code interpreters, remote MCP connectors) and is removed.
const CLIENT_TOOL_TYPES = [
  /^function$/, /^custom$/, /^apply_patch$/, /^namespace$/,
  /^bash_\d+$/, /^text_editor_\d+$/, /^computer_\d+$/, /^memory_\d+$/,
  // Searches over the tool definitions already in the request; touches nothing external.
  /^tool_search$/, /^tool_search_tool_/,
]

export function isClientTool(tool) {
  if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return false
  // Anthropic custom tools carry no `type`; they are client-executed by definition.
  if (tool.type === undefined) return typeof tool.name === 'string' && tool.input_schema !== undefined
  const type = String(tool.type)
  // A shell tool is the harness's own unless it names a provider-hosted container.
  if (type === 'shell' || type === 'local_shell') return tool.environment === undefined || tool.environment?.type === 'local'
  return CLIENT_TOOL_TYPES.some((pattern) => pattern.test(type))
}

// Deeper than any real request, shallow enough to bound the walk. A request
// nested past it is refused rather than left partly unchecked.
const MAX_DEPTH = 64

function clip(value, length) {
  const text = String(value)
  return text.length > length ? `${text.slice(0, length)}…` : text
}

const isRemoteUrl = (value) => typeof value === 'string' && /^\s*(https?|ftp|s3|gs|wss?):/i.test(value)
const refersRemote = (value) => isRemoteUrl(value) || (value !== null && typeof value === 'object' && (isRemoteUrl(value.url) || isRemoteUrl(value.file_url)))

// A content block that tells the provider to go and fetch something: an image,
// document, or file given by URL rather than inline. The provider would
// download an arbitrary address on the candidate's behalf — data out in the
// URL, content back through the model — so such a request is refused. Inline
// (base64 / data:) content, which is what the harnesses send, is untouched.
function remoteReference(node) {
  const type = typeof node.type === 'string' ? node.type : ''
  if (node.source !== null && typeof node.source === 'object' && node.source.type === 'url' && /^(image|document|file|video|audio|pdf)$/.test(type)) return `${type}.source.url`
  if (/^(input_image|image_url|image)$/.test(type) && refersRemote(node.image_url)) return `${type}.image_url`
  if (/^(input_file|file|document)$/.test(type) && (refersRemote(node.file_url) || refersRemote(node.file))) return `${type}.file_url`
  if (/^(input_audio|audio|input_video|video)$/.test(type) && (refersRemote(node.audio_url) || refersRemote(node.video_url) || refersRemote(node.url))) return `${type}.url`
  return null
}

// One pass over the whole request. Tool declarations are not always at the top
// level (Codex sends them inside `input` items, grouped into namespaces), so
// every `tools` array is filtered wherever a harness puts it.
function inspectRequest(node, report, depth = 0) {
  if (node === null || typeof node !== 'object') return
  if (depth > MAX_DEPTH) {
    report.tooDeep = true
    return
  }
  if (Array.isArray(node)) {
    for (const entry of node) inspectRequest(entry, report, depth + 1)
    return
  }
  const remote = remoteReference(node)
  if (remote) report.remote.push(remote)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'tools' && Array.isArray(value)) {
      const kept = value.filter((tool) => {
        if (isClientTool(tool)) return true
        report.stripped.push(clip(tool?.type ?? tool?.name ?? typeof tool, 60))
        return false
      })
      if (kept.length !== value.length) {
        node.tools = kept
        report.modified = true
      }
      for (const tool of kept) if (typeof tool.name === 'string') report.toolNames.add(tool.name)
      inspectRequest(kept, report, depth + 1)
    } else {
      inspectRequest(value, report, depth + 1)
    }
  }
}

// A path is compared as sent. Anything a server might normalise into another
// path — dot segments, doubled or encoded separators — is refused outright, so
// "matches the allowlist" and "is the allowlisted endpoint" stay the same thing.
export function plainPath(pathname) {
  if (!pathname.startsWith('/')) return false
  for (let index = 0; index < pathname.length; index += 1) if (pathname.charCodeAt(index) <= 32) return false
  return !/\/\/|\\|\/\.{1,2}(\/|$)|%2e|%2f|%5c|%00/i.test(pathname)
}

const INSPECT_METHODS = ['GET', 'HEAD', 'POST']

// Check (and where needed rewrite) one request to an inspected model API host.
// Returns { allow, reason?, body?, modified, stripped, model }. Anything that
// cannot be checked is refused: an unknown method, a path that is not plain, a
// body that is not a JSON object.
export function applyModelPolicy(config, rule, { method = 'GET', urlPath, body = null, hasBody = body !== null }) {
  const pathname = urlPath.split('?')[0]
  const verb = String(method).toUpperCase()
  if (!(rule.methods ?? INSPECT_METHODS).includes(verb)) return { allow: false, reason: `method ${clip(verb, 16)} is not allowed on ${rule.host}` }
  if (!plainPath(pathname)) return { allow: false, reason: `path ${clip(pathname, 120)} is not a plain path` }
  if (rule.paths.length > 0 && !rule.paths.some((pattern) => pattern.test(pathname))) {
    return { allow: false, reason: `path ${clip(pathname, 120)} is not on the allowlist for ${rule.host}` }
  }
  if (!hasBody) return { allow: true, modified: false, stripped: [], model: null, body: null }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { allow: false, reason: 'request body is not a JSON object, so it cannot be inspected' }
  }
  const model = typeof body.model === 'string' ? clip(body.model, 120) : null
  if (config.models && verb === 'POST') {
    if (!model) return { allow: false, reason: 'models are pinned for this run and the request names none' }
    if (!config.models.includes(body.model)) return { allow: false, reason: `model ${model} is not the pinned run model (${config.models.join(', ')})`, model }
  }
  const report = { stripped: [], remote: [], toolNames: new Set(), modified: false, tooDeep: false }
  inspectRequest(body, report)
  if (report.tooDeep) return { allow: false, reason: `request is nested more than ${MAX_DEPTH} levels deep, so it cannot be inspected`, model }
  if (report.remote.length > 0) return { allow: false, reason: `request asks the provider to fetch remote content (${report.remote[0]}); send it inline instead`, model }
  // A forced choice of a tool that no longer exists would be rejected upstream.
  if (report.modified && body.tool_choice && typeof body.tool_choice === 'object' && !['auto', 'any', 'none', 'required'].includes(body.tool_choice.type)) {
    const wanted = body.tool_choice.name ?? body.tool_choice.function?.name
    if (!wanted || !report.toolNames.has(wanted)) delete body.tool_choice
  }
  // Request-level switches that make the provider reach the internet on the
  // model's behalf: Anthropic's MCP connector, xAI live search, OpenAI
  // search-preview options.
  for (const key of ['mcp_servers', 'search_parameters', 'web_search_options']) {
    if (body[key] !== undefined) {
      report.stripped.push(key)
      delete body[key]
      report.modified = true
    }
  }
  if (rule.api === 'vercel-ai-gateway') applyAiGatewayPolicy(body, report)
  return { allow: true, modified: report.modified, stripped: report.stripped.slice(0, 40), model, body }
}

// Vercel AI Gateway takes the same request bodies as the APIs it imitates
// (Anthropic Messages, OpenAI Chat Completions and Responses), plus fields of
// its own that reach past the one model the request names:
//   providerOptions   per-provider switches passed upstream. Under a provider's
//                     name they turn on hosted features (Google search
//                     grounding and URL context, OpenAI and xAI search);
//                     under `gateway`, `models` is a list of fallback models
//                     and `byok` carries credentials. Only the gateway's
//                     routing among the upstream providers of the same model
//                     (`order`, `only`) and its cache switch are kept.
//   models            a top-level fallback list, another way to be served by a
//                     model other than the one named.
//   plugins           aggregator plugins (web search among them).
export const AI_GATEWAY_KEPT_ROUTING = ['order', 'only', 'caching']

function applyAiGatewayPolicy(body, report) {
  for (const key of ['providerOptions', 'provider_options']) {
    const options = body[key]
    if (options === undefined) continue
    const routing = options !== null && typeof options === 'object' && !Array.isArray(options) && options.gateway !== null && typeof options.gateway === 'object' && !Array.isArray(options.gateway) ? options.gateway : null
    const kept = {}
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      report.stripped.push(key)
    } else {
      for (const name of Object.keys(options)) if (name !== 'gateway' || !routing) report.stripped.push(`${key}.${clip(name, 40)}`)
      if (routing) {
        for (const [name, value] of Object.entries(routing)) {
          if (AI_GATEWAY_KEPT_ROUTING.includes(name)) kept[name] = value
          else report.stripped.push(`${key}.gateway.${clip(name, 40)}`)
        }
      }
    }
    const before = JSON.stringify(options)
    if (Object.keys(kept).length > 0) body[key] = { gateway: kept }
    else delete body[key]
    if (JSON.stringify(body[key]) !== before) report.modified = true
  }
  for (const key of ['models', 'plugins']) {
    if (body[key] !== undefined) {
      report.stripped.push(key)
      delete body[key]
      report.modified = true
    }
  }
}

// Generated tokens in one response's usage, reasoning included, whichever
// vocabulary the API speaks: `output_tokens` (Anthropic Messages, OpenAI
// Responses) or `completion_tokens` (Chat Completions). Every API these
// harnesses use counts reasoning inside that number. A provider that reports
// it beside the output instead gives itself away by its own total
// (input + output + reasoning), and then the two are added.
export function generatedTokens(usage) {
  if (!usage || typeof usage !== 'object') return 0
  const count = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  const output = count(usage.output_tokens ?? usage.completion_tokens)
  const reasoning = count(usage.output_tokens_details?.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens)
  const input = count(usage.input_tokens ?? usage.prompt_tokens)
  if (reasoning > 0 && typeof usage.total_tokens === 'number' && usage.total_tokens === input + output + reasoning) return output + reasoning
  return output
}

// The only headers a credential belongs in. A placeholder anywhere else is
// left alone: a provider that echoes an unrecognised header value back in an
// error would otherwise hand the real credential to the box.
const CREDENTIAL_HEADERS = new Set(['authorization', 'x-api-key', 'api-key', 'x-goog-api-key'])

// Swap candidate-held placeholders for the real credential, but only in a
// credential header, and only on the way to the host that credential belongs to.
export function substituteSecrets(config, host, headers) {
  const result = { ...headers }
  let substituted = 0
  for (const secret of config.secrets) {
    if (!secret.hosts.some((pattern) => hostMatches(pattern, host))) continue
    for (const [name, value] of Object.entries(result)) {
      if (!CREDENTIAL_HEADERS.has(name.toLowerCase())) continue
      const replace = (text) => {
        if (typeof text !== 'string' || !text.includes(secret.placeholder)) return text
        substituted += 1
        return text.split(secret.placeholder).join(secret.value)
      }
      result[name] = Array.isArray(value) ? value.map(replace) : replace(value)
    }
  }
  return { headers: result, substituted }
}

// Hash chain: `prev` is the SHA-256 of the previous serialized line.
export const CHAIN_GENESIS = '0'.repeat(64)

export function chainLine(prev, entry) {
  const line = JSON.stringify({ ...entry, prev })
  return { line, hash: sha256(line) }
}

export function verifyChain(text) {
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  let prev = CHAIN_GENESIS
  for (let index = 0; index < lines.length; index += 1) {
    let entry
    try { entry = JSON.parse(lines[index]) } catch { return { ok: false, entries: index, error: `line ${index + 1} is not JSON` } }
    if (entry.prev !== prev) return { ok: false, entries: index, error: `line ${index + 1} does not chain from the line before it` }
    if (entry.seq !== index) return { ok: false, entries: index, error: `line ${index + 1} has seq ${entry.seq}, expected ${index}` }
    prev = sha256(lines[index])
  }
  return { ok: true, entries: lines.length, head: prev }
}

// Token accounting from a response body (JSON or SSE). Streaming APIs report
// usage in pieces: Anthropic sends input and cache counts in message_start and
// the final output count in message_delta; OpenAI sends everything once, in
// response.completed. So every `usage` object in the body is merged in order,
// later fields winning, which gives the final totals for both. Only numbers
// (and objects of numbers, such as input_tokens_details) are kept: OpenAI's
// per-item `attribution` breakdown would otherwise put tens of kilobytes into
// every line of the hash-chained log.
export function extractUsage(text) {
  let usage = null
  const pattern = /"usage"\s*:\s*\{/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index + match[0].length - 1
    let depth = 0
    for (let index = start; index < text.length; index += 1) {
      const char = text[index]
      if (char === '{') depth += 1
      else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          try { usage = { ...(usage ?? {}), ...reduceUsage(JSON.parse(text.slice(start, index + 1))) } } catch { /* partial object; keep what was merged */ }
          break
        }
      }
    }
  }
  return usage && Object.keys(usage).length > 0 ? usage : null
}

// The numeric part of a usage object, two levels deep.
export function reduceUsage(value, depth = 0) {
  const kept = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return kept
  for (const [key, entry] of Object.entries(value).slice(0, 40)) {
    if (key === 'attribution') continue
    if (typeof entry === 'number' && Number.isFinite(entry)) kept[key] = entry
    else if (depth < 2 && entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const nested = reduceUsage(entry, depth + 1)
      if (Object.keys(nested).length > 0) kept[key] = nested
    }
  }
  return kept
}

// The model id the provider says served a response: the first `"model"` key in
// the body. Both providers put it in the opening event (OpenAI's
// response.created, Anthropic's message_start), ahead of any generated text,
// and generated text is JSON-escaped, so a quoted "model" inside it cannot
// match. This is what the grader pin is checked against.
export function extractResponseModel(text) {
  const match = /"model"\s*:\s*"([^"\\]{1,120})"/.exec(text)
  return match ? match[1] : null
}

// The reasoning effort a request asked for: OpenAI's reasoning.effort or
// Anthropic's output_config.effort. Recorded, so a pinned effort can be checked
// against what the harness actually sent.
export function requestedEffort(body) {
  const effort = body?.reasoning?.effort ?? body?.output_config?.effort ?? null
  return typeof effort === 'string' ? clip(effort, 24) : null
}

// A thinking budget in tokens, where a request asks for one instead of (or as
// well as) an effort: Anthropic Messages `thinking.budget_tokens`, which is how
// omp asks Vercel AI Gateway's Gemini models to think. Recorded beside the
// effort; null (and left out of the log) when the request names none.
export function requestedThinkingBudget(body) {
  const budget = body?.thinking?.budget_tokens
  return typeof budget === 'number' && Number.isFinite(budget) ? budget : null
}

// ---------------------------------------------------------------------------
// Runtime. Sockets, TLS, and the log file.
// ---------------------------------------------------------------------------

// Read the tail of an existing log without loading it: how many lines, and
// the last one. A session's gateway is restarted for every launch and
// continues the existing chain, so one head pins the whole phase.
function chainTail(file) {
  const handle = fs.openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(1024 * 1024)
    let lines = 0
    let lastLine = null
    let carry = Buffer.alloc(0)
    for (let read = fs.readSync(handle, buffer, 0, buffer.length, null); read > 0; read = fs.readSync(handle, buffer, 0, buffer.length, null)) {
      let start = 0
      for (let newline = buffer.indexOf(10, start); newline !== -1 && newline < read; newline = buffer.indexOf(10, start)) {
        const line = Buffer.concat([carry, buffer.subarray(start, newline)])
        carry = Buffer.alloc(0)
        start = newline + 1
        if (line.length === 0) continue
        lines += 1
        lastLine = line
      }
      carry = Buffer.concat([carry, buffer.subarray(start, read)])
    }
    return { lines, last: lastLine ? lastLine.toString('utf8') : null }
  } finally {
    fs.closeSync(handle)
  }
}

// Refusals are the one kind of entry the box can generate at will. Past a
// burst they are counted rather than written one by one, so a flood cannot grow
// the log without bound; the count is itself logged.
const DENY_BURST = 400
const DENY_WINDOW_MS = 60_000

function createLogger(config) {
  let seq = 0
  let prev = CHAIN_GENESIS
  const file = config.logDir ? path.join(config.logDir, 'events.jsonl') : null
  if (config.logDir) fs.mkdirSync(path.join(config.logDir, 'bodies'), { recursive: true })
  if (file && fs.existsSync(file)) {
    const tail = chainTail(file)
    if (tail.lines > 0) {
      seq = tail.lines
      prev = sha256(tail.last)
    }
  }
  let windowStart = Date.now()
  let denials = 0
  let suppressed = 0
  const append = (kind, fields) => {
    const { line, hash } = chainLine(prev, { seq, ts: new Date().toISOString(), kind, ...fields })
    prev = hash
    const current = seq
    seq += 1
    process.stdout.write(`${line}\n`)
    if (file) fs.appendFileSync(file, `${line}\n`)
    return current
  }
  return {
    bodiesDir: config.logDir ? path.join(config.logDir, 'bodies') : null,
    write(kind, fields = {}) {
      if (kind.endsWith('.deny')) {
        const now = Date.now()
        if (now - windowStart > DENY_WINDOW_MS) {
          if (suppressed > 0) append('log.suppressed', { denials: suppressed, windowMs: DENY_WINDOW_MS })
          windowStart = now
          denials = 0
          suppressed = 0
        }
        denials += 1
        if (denials > DENY_BURST) {
          suppressed += 1
          return null
        }
      }
      return append(kind, fields)
    },
  }
}

function createResolver(config) {
  const resolver = new dns.promises.Resolver({ timeout: 4000, tries: 2 })
  resolver.setServers(config.dns)
  const cache = new Map()
  return async function resolve(host) {
    const cached = cache.get(host)
    if (cached && cached.expires > Date.now()) return cached.address
    let addresses = []
    try { addresses = await resolver.resolve4(host) } catch { addresses = [] }
    if (addresses.length === 0) {
      try { addresses = await resolver.resolve6(host) } catch { addresses = [] }
    }
    const address = addresses.find((entry) => !isPrivateAddress(entry))
    if (!address) throw new Error(addresses.length ? `${host} resolves only to private addresses` : `${host} did not resolve`)
    cache.set(host, { address, expires: Date.now() + 60_000 })
    return address
  }
}

// A per-process CA, name-constrained to the inspected hosts, living only in
// this container's memory-backed scratch space. Leaves are minted on demand.
function createCertificateAuthority(config, logger) {
  const hosts = config.egress.filter((rule) => rule.mode === 'inspect').map((rule) => rule.host)
  if (hosts.length === 0) return null
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-ca-'))
  const run = (args) => execFileSync('openssl', args, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] })
  const permitted = hosts.map((host) => `permitted;DNS:${host.startsWith('*.') ? host.slice(1) : host}`).join(',')
  run(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'ca.key'])
  run(['req', '-x509', '-new', '-key', 'ca.key', '-sha256', '-days', '14',
    '-subj', `/O=Stagebench lockdown/CN=Stagebench gateway CA ${config.session}`,
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
    '-addext', 'keyUsage=critical,keyCertSign',
    '-addext', `nameConstraints=critical,${permitted}`,
    '-out', 'ca.pem'])
  run(['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'leaf.key'])
  const caPem = fs.readFileSync(path.join(directory, 'ca.pem'), 'utf8')
  const leafKey = fs.readFileSync(path.join(directory, 'leaf.key'), 'utf8')
  const contexts = new Map()
  logger.write('gateway.ca', { fingerprint: new crypto.X509Certificate(caPem).fingerprint256, constrainedTo: hosts })
  return {
    caPem,
    contextFor(servername) {
      if (contexts.has(servername)) return contexts.get(servername)
      const safe = servername.replace(/[^a-z0-9.-]/g, '_')
      fs.writeFileSync(path.join(directory, `${safe}.ext`), `subjectAltName=DNS:${servername}\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n`)
      run(['req', '-new', '-key', 'leaf.key', '-subj', `/CN=${servername}`, '-out', `${safe}.csr`])
      run(['x509', '-req', '-in', `${safe}.csr`, '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '14', '-sha256', '-extfile', `${safe}.ext`, '-out', `${safe}.pem`])
      const context = { key: leafKey, cert: `${fs.readFileSync(path.join(directory, `${safe}.pem`), 'utf8')}${caPem}` }
      contexts.set(servername, context)
      return context
    },
  }
}

const HOP_BY_HOP = new Set(['connection', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'proxy-authorization', 'proxy-authenticate', 'expect'])

function forwardableHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_BY_HOP.has(name.toLowerCase())))
}

// Model requests are a few megabytes at most; the limits only have to stop one
// request from exhausting the gateway's memory.
const BODY_LIMIT = 96 * 1024 * 1024

function readBody(stream, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    stream.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body exceeds the gateway limit'))
        stream.destroy()
        return
      }
      chunks.push(chunk)
    })
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

function decodeBody(buffer, encoding) {
  // A small body must not be able to inflate past the limit either.
  const bounded = { maxOutputLength: 2 * BODY_LIMIT }
  switch (String(encoding ?? '').toLowerCase().trim()) {
    case '': case 'identity': return buffer
    case 'gzip': case 'x-gzip': return zlib.gunzipSync(buffer, bounded)
    case 'deflate': return zlib.inflateSync(buffer, bounded)
    case 'br': return zlib.brotliDecompressSync(buffer, bounded)
    case 'zstd': return zlib.zstdDecompressSync(buffer, bounded)
    default: throw new Error(`unsupported content-encoding: ${encoding}`)
  }
}

function refuse(response, status, message) {
  const body = `stagebench lockdown: ${message}\n`
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body), 'x-stagebench-lockdown': 'denied' })
  response.end(body)
}

export function startGateway(rawConfig, { proxyPort = PROXY_PORT, mirrorPort = MIRROR_PORT, listenHost = '0.0.0.0' } = {}) {
  const config = normalizeConfig(rawConfig)
  const logger = createLogger(config)
  const resolve = createResolver(config)
  // net/tls/https `lookup` hook: every outbound connection resolves through the
  // gateway's own resolver and is refused if the answer is a private address.
  const lookup = (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback
    const all = typeof options === 'object' && options?.all
    resolve(hostname).then(
      (address) => {
        const family = net.isIPv6(address) ? 6 : 4
        if (all) done(null, [{ address, family }])
        else done(null, address, family)
      },
      (error) => done(error),
    )
  }
  const authority = createCertificateAuthority(config, logger)
  // Generated tokens reported so far by responses this gateway relayed. The
  // budget it is checked against is what the launcher says is left for the phase.
  let outputTokensSpent = 0
  let budgetLogged = false
  const saveBody = (seq, suffix, buffer) => {
    if (!logger.bodiesDir) return
    fs.writeFileSync(path.join(logger.bodiesDir, `${String(seq).padStart(6, '0')}.${suffix}.gz`), zlib.gzipSync(buffer))
  }

  // --- door 2: inspected model API traffic ---------------------------------
  async function handleInspected(request, response) {
    const host = String(request.socket.servername || request.headers.host || '').toLowerCase().split(':')[0]
    const decision = egressDecision(config, host, 443)
    if (decision.action !== 'inspect') {
      logger.write('inspect.deny', { host, method: request.method, path: request.url, reason: 'not an inspected host' })
      refuse(response, 421, `${host} is not served here`)
      return
    }
    const rule = decision.rule
    let raw
    try {
      raw = await readBody(request)
    } catch (error) {
      logger.write('inspect.deny', { host, method: request.method, path: request.url, reason: error.message })
      refuse(response, 413, error.message)
      return
    }
    const logPath = clip(request.url.split('?')[0], 300)
    let parsed = null
    if (raw.length > 0) {
      try {
        // Every body is parsed, whatever its content-type says: a body that
        // cannot be read cannot be checked, and is refused rather than waved through.
        parsed = JSON.parse(decodeBody(raw, request.headers['content-encoding']).toString('utf8'))
      } catch (error) {
        logger.write('inspect.deny', { host, method: request.method, path: logPath, reason: `unreadable body: ${clip(error.message, 160)}` })
        refuse(response, 400, `request body could not be inspected (${clip(error.message, 160)})`)
        return
      }
    }
    const verdict = applyModelPolicy(config, rule, { method: request.method, urlPath: request.url, body: parsed, hasBody: raw.length > 0 })
    // The phase's token budget: once it is spent, no further model turn goes
    // out. The response that crossed it was already paid for and was relayed.
    if (verdict.allow && config.budget && raw.length > 0 && request.method === 'POST' && outputTokensSpent >= config.budget.outputTokens) {
      if (!budgetLogged) {
        budgetLogged = true
        logger.write('budget.exhausted', { outputTokens: outputTokensSpent, budget: config.budget.outputTokens })
      }
      logger.write('inspect.deny', { host, method: request.method, path: logPath, model: verdict.model ?? null, reason: 'the phase token budget is spent', budget: true })
      refuse(response, 403, `the token budget for this phase is spent (${outputTokensSpent} of ${config.budget.outputTokens} generated tokens)`)
      return
    }
    if (!verdict.allow) {
      logger.write('inspect.deny', { host, method: request.method, path: logPath, model: verdict.model ?? null, reason: verdict.reason })
      refuse(response, 403, verdict.reason)
      return
    }
    // What goes upstream is the gateway's own serialization of what it
    // inspected, never the bytes it was sent: duplicate keys and other parser
    // disagreements cannot make upstream read a different request.
    const outbound = verdict.body === null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(verdict.body))
    const { headers: substituted, substituted: secretsUsed } = substituteSecrets(config, host, forwardableHeaders(request.headers))
    const headers = { ...substituted, host, 'accept-encoding': 'identity' }
    delete headers['content-length']
    delete headers['content-encoding']
    if (outbound.length > 0 || !['GET', 'HEAD'].includes(request.method)) headers['content-length'] = String(outbound.length)
    if (outbound.length > 0) headers['content-type'] = 'application/json'
    const seq = logger.write('inspect.request', {
      host, method: request.method, path: logPath,
      model: verdict.model, effort: requestedEffort(verdict.body), bytes: outbound.length, bodySha256: outbound.length ? sha256(outbound) : null,
      ...(requestedThinkingBudget(verdict.body) !== null ? { thinkingBudget: requestedThinkingBudget(verdict.body) } : {}),
      strippedTools: verdict.stripped, secretsSubstituted: secretsUsed,
    })
    if (config.bodyLog === 'full' && outbound.length > 0) saveBody(seq, 'request', outbound)

    const upstream = https.request({ host, port: 443, servername: host, method: request.method, path: request.url, headers, lookup, timeout: 900_000 })
    upstream.on('timeout', () => upstream.destroy(new Error('upstream timed out')))
    upstream.on('error', (error) => {
      logger.write('inspect.error', { request: seq, host, error: error.message })
      if (!response.headersSent) refuse(response, 502, `upstream error: ${error.message}`)
      else response.destroy()
    })
    upstream.on('response', (reply) => {
      response.writeHead(reply.statusCode, reply.statusMessage, forwardableHeaders(reply.headers))
      const hash = crypto.createHash('sha256')
      const chunks = []
      let bytes = 0
      let finalized = false
      // Streaming clients hang up as soon as they have the final event, which
      // surfaces here as an aborted upstream. Record what was relayed either way.
      const finalize = (complete) => {
        if (finalized) return
        finalized = true
        const body = Buffer.concat(chunks)
        let usage = null
        let served = null
        try {
          const text = decodeBody(body, reply.headers['content-encoding']).toString('utf8')
          usage = extractUsage(text)
          served = extractResponseModel(text)
        } catch { usage = null }
        outputTokensSpent += generatedTokens(usage)
        // The provider's own request id and the model id it says served the
        // request: what a pinned grader is checked against afterwards.
        const requestId = clip(String(reply.headers['request-id'] ?? reply.headers['x-request-id'] ?? ''), 120) || null
        logger.write('inspect.response', { request: seq, host, status: reply.statusCode, bytes, bodySha256: hash.digest('hex'), complete, usage, model: served, requestId })
        if (config.bodyLog !== 'none' && body.length > 0) saveBody(seq, 'response', body)
      }
      reply.on('data', (chunk) => {
        hash.update(chunk)
        bytes += chunk.length
        if (bytes <= 256 * 1024 * 1024) chunks.push(chunk)
        response.write(chunk)
      })
      reply.on('end', () => {
        response.end()
        finalize(true)
      })
      reply.on('error', () => {
        finalize(false)
        response.destroy()
      })
      reply.on('close', () => finalize(reply.complete))
    })
    response.on('close', () => { if (!response.writableEnded) upstream.destroy() })
    upstream.end(outbound)
  }

  // TLS for inspected hosts terminates on a loopback-only HTTPS server; CONNECT
  // requests for those hosts are piped into it. HTTP/1.1 only, so every request
  // is a discrete, checkable unit.
  let inspector = null
  if (authority) {
    const contexts = new Map()
    inspector = https.createServer({
      ALPNProtocols: ['http/1.1'],
      SNICallback: (servername, callback) => {
        const name = String(servername ?? '').toLowerCase()
        if (egressDecision(config, name, 443).action !== 'inspect') {
          callback(new Error(`${name} is not an inspected host`))
          return
        }
        try {
          if (!contexts.has(name)) contexts.set(name, tls.createSecureContext(authority.contextFor(name)))
          callback(null, contexts.get(name))
        } catch (error) {
          callback(error)
        }
      },
    }, (request, response) => {
      handleInspected(request, response).catch((error) => {
        logger.write('inspect.error', { error: error.message })
        if (!response.headersSent) refuse(response, 500, 'gateway error')
        else response.destroy()
      })
    })
    // A websocket would be an unframed, uninspectable channel to the provider.
    inspector.on('upgrade', (request, socket) => {
      logger.write('inspect.deny', { host: request.socket.servername ?? null, method: request.method, path: request.url.split('?')[0], reason: 'websocket upgrade is not allowed on an inspected host' })
      socket.end('HTTP/1.1 403 Forbidden\r\nx-stagebench-lockdown: denied\r\ncontent-length: 0\r\nconnection: close\r\n\r\n')
    })
    inspector.on('tlsClientError', (error, socket) => {
      logger.write('inspect.tls-error', { servername: socket.servername ?? null, error: error.message })
    })
  }

  // --- doors 2 and 3: the CONNECT proxy ------------------------------------
  const proxy = http.createServer((request, response) => {
    // Absolute-form plain HTTP proxying is never allowed; nothing legitimate needs it.
    logger.write('proxy.deny', { method: request.method, target: String(request.url).slice(0, 300), reason: 'plain HTTP proxying is not allowed' })
    refuse(response, 403, 'plain HTTP proxying is not allowed; only allowlisted HTTPS hosts via CONNECT')
  })
  proxy.on('connect', (request, socket, head) => {
    socket.on('error', () => {})
    const target = splitHostPort(request.url)
    const deny = (reason) => {
      logger.write('connect.deny', { target: String(request.url).slice(0, 300), reason })
      const body = `stagebench lockdown: egress to ${String(request.url).slice(0, 200)} refused (${reason})\n`
      socket.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\nx-stagebench-lockdown: denied\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`)
    }
    if (!target) return deny('malformed CONNECT target')
    const decision = egressDecision(config, target.host, target.port)
    if (decision.action === 'deny') return deny(decision.reason)
    const pipeTo = (upstream, fields) => {
      let up = 0
      let down = 0
      upstream.on('error', (error) => {
        logger.write('connect.error', { ...fields, error: error.message })
        socket.destroy()
      })
      upstream.on('connect', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head?.length) upstream.write(head)
        socket.on('data', (chunk) => { up += chunk.length })
        upstream.on('data', (chunk) => { down += chunk.length })
        socket.pipe(upstream)
        upstream.pipe(socket)
      })
      socket.on('close', () => upstream.destroy())
      upstream.on('close', () => {
        socket.destroy()
        if (fields.mode === 'tunnel') logger.write('connect.close', { ...fields, bytesUp: up, bytesDown: down })
      })
    }
    if (decision.action === 'inspect') {
      pipeTo(net.connect({ host: '127.0.0.1', port: inspector.address().port }), { host: target.host, port: target.port, mode: 'inspect' })
      return undefined
    }
    resolve(target.host).then((address) => {
      logger.write('connect.allow', { host: target.host, port: target.port, mode: 'tunnel', address })
      pipeTo(net.connect({ host: address, port: target.port }), { host: target.host, port: target.port, mode: 'tunnel' })
    }, (error) => deny(error.message))
    return undefined
  })
  proxy.on('clientError', (_error, socket) => socket.destroy())

  // --- door 1: mirrors ------------------------------------------------------
  function fetchUpstream(url, headers, prefixes, redirects = 0) {
    return new Promise((resolvePromise, reject) => {
      const target = new URL(url)
      const request = https.request({ host: target.hostname, port: 443, servername: target.hostname, method: 'GET', path: `${target.pathname}${target.search}`, headers: { ...headers, host: target.hostname }, lookup, timeout: 120_000 })
      request.on('timeout', () => request.destroy(new Error('upstream timed out')))
      request.on('error', reject)
      request.on('response', (reply) => {
        const location = reply.headers.location
        if ([301, 302, 303, 307, 308].includes(reply.statusCode) && location) {
          reply.resume()
          const next = new URL(location, url)
          // Only ever follow a redirect that stays under the mirror's own
          // upstream prefix or one of its declared redirect prefixes.
          if (!redirectAllowed(prefixes, next) || redirects >= 3) reject(new Error(`upstream redirected outside the mirror to ${next.hostname}${next.pathname.slice(0, 60)}`))
          else fetchUpstream(next.toString(), headers, prefixes, redirects + 1).then(resolvePromise, reject)
          return
        }
        resolvePromise(reply)
      })
      request.end()
    })
  }

  const mirror = http.createServer((request, response) => {
    const urlPath = String(request.url)
    if (request.method === 'GET' && urlPath === '/healthz') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('ok\n')
      return
    }
    if (request.method === 'GET' && urlPath === '/ca.pem') {
      if (!authority) return refuse(response, 404, 'no inspected hosts are configured')
      response.writeHead(200, { 'content-type': 'application/x-pem-file' }).end(authority.caPem)
      return
    }
    const target = mirrorTarget(config, urlPath)
    if (!target) {
      logger.write('mirror.deny', { method: request.method, path: urlPath.slice(0, 300), reason: 'unknown mirror' })
      return refuse(response, 404, 'unknown mirror')
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      request.resume()
      logger.write('mirror.deny', { mirror: target.name, method: request.method, path: urlPath.slice(0, 300), reason: 'mirrors are read-only' })
      return refuse(response, 405, 'mirrors are read-only (GET only)')
    }
    const passthrough = {}
    for (const name of ['accept', 'if-none-match', 'if-modified-since', 'range', 'user-agent']) {
      if (request.headers[name]) passthrough[name] = request.headers[name]
    }
    passthrough['accept-encoding'] = 'identity'
    fetchUpstream(target.url, passthrough, [target.mirror.upstream, ...target.mirror.redirects]).then(async (reply) => {
      const headers = forwardableHeaders(reply.headers)
      const isMetadata = target.mirror.kind === 'npm' && /json/i.test(String(reply.headers['content-type'] ?? '')) && reply.statusCode === 200
      if (isMetadata) {
        const original = await readBody(reply)
        const rewritten = Buffer.from(rewriteNpmMetadata(original.toString('utf8'), target.mirror.upstream, `http://${request.headers.host}/${target.name}`))
        delete headers['content-encoding']
        headers['content-length'] = String(rewritten.length)
        response.writeHead(200, headers)
        response.end(request.method === 'HEAD' ? undefined : rewritten)
        logger.write('mirror.fetch', { mirror: target.name, path: urlPath.slice(target.name.length + 1), status: 200, bytes: original.length, object: 'metadata' })
        return
      }
      response.writeHead(reply.statusCode, headers)
      const hash = crypto.createHash('sha256')
      let bytes = 0
      reply.on('data', (chunk) => {
        hash.update(chunk)
        bytes += chunk.length
        response.write(chunk)
      })
      reply.on('end', () => {
        response.end()
        logger.write('mirror.fetch', { mirror: target.name, path: urlPath.slice(target.name.length + 1), status: reply.statusCode, bytes, sha256: bytes ? hash.digest('hex') : null, object: 'artifact' })
      })
      reply.on('error', () => response.destroy())
    }).catch((error) => {
      logger.write('mirror.error', { mirror: target.name, path: urlPath.slice(0, 300), error: error.message })
      if (!response.headersSent) refuse(response, 502, `mirror upstream error: ${error.message}`)
      else response.destroy()
    })
    return undefined
  })

  const listening = []
  const listen = (server, port, host) => new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(port, host, () => {
      listening.push(server)
      done(server.address().port)
    })
  })
  const ready = (async () => {
    if (inspector) await listen(inspector, 0, '127.0.0.1')
    const ports = { proxy: await listen(proxy, proxyPort, listenHost), mirror: await listen(mirror, mirrorPort, listenHost) }
    let source = null
    try { source = sha256(fs.readFileSync(fileURLToPath(import.meta.url))) } catch { source = null }
    logger.write('gateway.start', {
      session: config.session,
      gatewaySha256: source,
      ports,
      dns: config.dns,
      egress: config.egress.map((rule) => ({ host: rule.host, port: rule.port, mode: rule.mode, api: rule.api, paths: rule.paths.map((pattern) => pattern.source) })),
      mirrors: Object.fromEntries(Object.entries(config.mirrors).map(([name, entry]) => [name, entry.upstream])),
      models: config.models,
      budget: config.budget,
      // Never the values: only how many placeholders are armed, and for where.
      secrets: config.secrets.map((secret) => ({ hosts: secret.hosts })),
      bodyLog: config.bodyLog,
    })
    return ports
  })()
  return {
    ready,
    config,
    caPem: authority?.caPem ?? null,
    close: () => Promise.all(listening.map((server) => new Promise((done) => {
      server.closeAllConnections?.()
      server.close(() => done())
    }))),
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on('uncaughtException', (error) => process.stderr.write(`gateway: uncaught ${error.stack ?? error}\n`))
  process.on('unhandledRejection', (error) => process.stderr.write(`gateway: unhandled ${error?.stack ?? error}\n`))
  let raw
  try {
    raw = JSON.parse(process.env.STAGEBENCH_GATEWAY_CONFIG ?? '{}')
  } catch (error) {
    process.stderr.write(`gateway: STAGEBENCH_GATEWAY_CONFIG is not valid JSON (${error.message})\n`)
    process.exit(2)
  }
  const gateway = startGateway(raw)
  gateway.ready.catch((error) => {
    process.stderr.write(`gateway: failed to start (${error.message})\n`)
    process.exit(1)
  })
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => gateway.close().then(() => process.exit(0)))
}

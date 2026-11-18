// Token usage and cost, from the gateway's own record.
//
// Before protocol 3, cost and tokens were whatever an operator typed at seal
// (`--cost-usd`, `--input-tokens`, …): some runs have them, most do not, and
// none can be checked. A boxed run's every model call goes through the
// gateway, which logs the usage object of every response in its hash-chained
// log. So the official figures are derived from that log, priced with one
// pinned, dated table (bench/prices.json), and hand-entered figures are kept
// beside them, labelled as what they are.
import fs from 'node:fs'
import path from 'node:path'
import { sha256 } from './shared.mjs'

export function pricesPath(root) {
  return path.join(root, 'bench', 'prices.json')
}

export function loadPrices(root) {
  const file = pricesPath(root)
  const text = fs.readFileSync(file, 'utf8')
  const table = JSON.parse(text)
  return { ...table, sha256: sha256(text), path: 'bench/prices.json' }
}

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

// One response's usage in one vocabulary, whatever the provider called it.
//   inputTokens          every input token, cached or not
//   cachedInputTokens    input served from the provider's prompt cache
//   cacheWriteTokens     input written to the cache (Anthropic bills these apart)
//   outputTokens         generated tokens, reasoning included
//   reasoningTokens      the reasoning part of output, where the provider says (null if not)
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null
  // Anthropic Messages: input_tokens is only the uncached part.
  if ('cache_read_input_tokens' in usage || 'cache_creation_input_tokens' in usage) {
    const cached = number(usage.cache_read_input_tokens)
    const writes = number(usage.cache_creation_input_tokens)
    const hour = number(usage.cache_creation?.ephemeral_1h_input_tokens)
    const uncached = number(usage.input_tokens)
    return {
      inputTokens: uncached + cached + writes,
      uncachedInputTokens: uncached,
      cachedInputTokens: cached,
      cacheWriteTokens: writes,
      cacheWrite1hTokens: Math.min(hour, writes),
      outputTokens: number(usage.output_tokens),
      reasoningTokens: null,
    }
  }
  // OpenAI Responses (input_tokens) or Chat Completions (prompt_tokens):
  // input includes the cached part.
  const input = number(usage.input_tokens ?? usage.prompt_tokens)
  const details = usage.input_tokens_details ?? usage.prompt_tokens_details ?? {}
  const outputDetails = usage.output_tokens_details ?? usage.completion_tokens_details ?? null
  const cached = Math.min(number(details.cached_tokens), input)
  return {
    inputTokens: input,
    uncachedInputTokens: input - cached,
    cachedInputTokens: cached,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0,
    outputTokens: number(usage.output_tokens ?? usage.completion_tokens),
    reasoningTokens: outputDetails && typeof outputDetails.reasoning_tokens === 'number' ? outputDetails.reasoning_tokens : null,
  }
}

// The price entry for a model id: exact, then through the alias list, then
// with a date suffix taken off (gpt-x-2026-10-01, claude-x-20261001, x@20261001).
export function priceFor(prices, model) {
  if (!model || !prices?.models) return null
  const id = String(model).trim()
  const candidates = [id, prices.aliases?.[id], id.replace(/(@|-)\d{4}-?\d{2}-?\d{2}$/, '')].filter(Boolean)
  for (const candidate of candidates) {
    const resolved = prices.aliases?.[candidate] ?? candidate
    if (prices.models[resolved]) return { id: resolved, ...prices.models[resolved] }
  }
  return null
}

// What one response cost at the table's rates, in USD.
export function responseCost(price, normalized) {
  if (!price || !normalized) return null
  const long = price.longContext && normalized.inputTokens > price.longContext.aboveInputTokens ? price.longContext : null
  const rate = (key) => (long && long[key] !== undefined ? long[key] : price[key]) ?? 0
  let micro
  if (price.provider === 'anthropic') {
    const hour = normalized.cacheWrite1hTokens
    micro = normalized.uncachedInputTokens * rate('input')
      + normalized.cachedInputTokens * rate('cacheRead')
      + (normalized.cacheWriteTokens - hour) * rate('cacheWrite5m')
      + hour * rate('cacheWrite1h')
      + normalized.outputTokens * rate('output')
  } else {
    micro = normalized.uncachedInputTokens * rate('input')
      + normalized.cachedInputTokens * rate('cachedInput')
      + normalized.outputTokens * rate('output')
  }
  return micro / 1_000_000
}

function emptyTotals() {
  return { requests: 0, responsesWithUsage: 0, inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0, reasoningTokens: null, costUsd: 0 }
}

function add(totals, normalized, cost) {
  totals.responsesWithUsage += 1
  totals.inputTokens += normalized.inputTokens
  totals.cachedInputTokens += normalized.cachedInputTokens
  totals.cacheWriteTokens += normalized.cacheWriteTokens
  totals.outputTokens += normalized.outputTokens
  if (normalized.reasoningTokens !== null) totals.reasoningTokens = (totals.reasoningTokens ?? 0) + normalized.reasoningTokens
  if (cost !== null && totals.costUsd !== null) totals.costUsd += cost
}

const round = (value) => (value === null ? null : Math.round(value * 10000) / 10000)

// Everything the gateway log says about model usage: per model (the id the
// provider says served each response, else the id requested), and in total,
// priced with `prices`. Also which efforts were requested, which model ids came
// back, and the provider's request ids — the grader pin is checked against
// those. `incomplete` lists model calls whose usage could not be read, so a
// total is never presented as complete when it is not.
export function summarizeUsage(events, prices = null) {
  const requests = new Map()
  const byModel = {}
  const totals = emptyTotals()
  const efforts = {}
  const responseModels = {}
  const requestIds = []
  const unpriced = new Set()
  let incomplete = 0
  let budgetDenied = 0
  let budgetExhausted = null
  for (const entry of events) {
    if (entry.kind === 'inspect.request') {
      const turn = entry.method === 'POST' && Boolean(entry.model)
      requests.set(entry.seq, { model: entry.model ?? null, effort: entry.effort ?? null, turn })
      if (turn) {
        totals.requests += 1
        const key = `${entry.model}:${entry.effort ?? 'unspecified'}`
        efforts[key] = (efforts[key] ?? 0) + 1
      }
    } else if (entry.kind === 'inspect.deny' && entry.budget) {
      budgetDenied += 1
    } else if (entry.kind === 'budget.exhausted') {
      budgetExhausted = { at: entry.ts ?? null, outputTokens: entry.outputTokens ?? null, budget: entry.budget ?? null }
    } else if (entry.kind === 'inspect.response') {
      const request = requests.get(entry.request) ?? { model: null, effort: null, turn: false }
      if (!request.turn) continue
      if (entry.requestId) requestIds.push(entry.requestId)
      const served = entry.model ?? null
      if (served) {
        const key = `${request.model ?? '?'} -> ${served}`
        responseModels[key] = (responseModels[key] ?? 0) + 1
      }
      const normalized = normalizeUsage(entry.usage)
      if (!normalized) {
        // A refused or failed turn generates nothing; a successful one without usage is a gap.
        if (entry.status === 200) incomplete += 1
        continue
      }
      const model = served ?? request.model ?? 'unknown'
      const price = prices ? priceFor(prices, model) ?? priceFor(prices, request.model) : null
      if (prices && !price) unpriced.add(model)
      const cost = price ? responseCost(price, normalized) : null
      byModel[model] ??= { ...emptyTotals(), priceId: price?.id ?? null }
      byModel[model].requests += 1
      add(byModel[model], normalized, cost)
      if (byModel[model].costUsd !== null && cost === null) byModel[model].costUsd = null
      add(totals, normalized, cost)
      if (cost === null) totals.costUsd = null
    }
  }
  for (const entry of [totals, ...Object.values(byModel)]) entry.costUsd = round(entry.costUsd)
  return {
    source: 'gateway',
    ...totals,
    totalTokens: totals.inputTokens + totals.outputTokens,
    incompleteResponses: incomplete,
    byModel,
    efforts,
    responseModels,
    requestIds: { count: requestIds.length, first: requestIds[0] ?? null, last: requestIds.at(-1) ?? null, sha256: requestIds.length ? sha256(requestIds.join('\n')) : null },
    budget: { denied: budgetDenied, exhausted: budgetExhausted },
    ...(prices ? { prices: { asOf: prices.asOf, sha256: prices.sha256, path: prices.path }, unpriced: [...unpriced] } : {}),
  }
}

export function readGatewayEvents(file) {
  if (!file || !fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => {
    try { return JSON.parse(line) } catch { return null }
  }).filter(Boolean)
}

// The run's "primary" model: the one most model turns went to. Auxiliary calls
// a harness makes for itself (titles, compaction on a small model) are not it.
export function primaryModel(summary) {
  const counts = {}
  for (const [key, count] of Object.entries(summary?.efforts ?? {})) {
    const model = key.slice(0, key.lastIndexOf(':'))
    counts[model] = (counts[model] ?? 0) + count
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

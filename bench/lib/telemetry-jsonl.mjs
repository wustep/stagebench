// Recompute token/cost telemetry from Claude Code subagent JSONL transcripts.
//
// Why this exists: the Claude Code run-completion notification reports a
// `subagent_tokens` figure that is the subagent's FINAL CONTEXT SIZE, not the
// tokens it generated — entering it by hand overstates usage (observed ~2.1x on
// one run). The honest number is the sum of per-assistant-turn `output_tokens`
// across the transcript, which this parser computes.
//
// The transcript schema is external and versioned, so the parser is defensive:
// it skips malformed lines, ignores entries without a usage block, and reports
// a clear failure (ok: false) rather than emitting zeros when it finds nothing.
import fs from 'node:fs'
import { roundTelemetryValue } from '../../src/telemetry-fields.mjs'

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

// Parse the concatenated text of one or more JSONL transcripts. Returns
// { ok: false, ... } when no usage data is found, so callers never silently
// record zeros.
export function parseSubagentTelemetry(text) {
  let promptInput = 0
  let cacheCreation = 0
  let cacheRead = 0
  let outputTokens = 0
  let costUsd = 0
  let assistantTurns = 0
  let sawCost = false
  let lines = 0
  let skipped = 0

  for (const rawLine of String(text).split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    lines++
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      skipped++
      continue
    }
    // Usage lives on assistant message turns; tolerate both the nested
    // message.usage and a top-level usage shape across Claude Code versions.
    const usage = entry?.message?.usage ?? entry?.usage
    if (usage && typeof usage === 'object') {
      promptInput += finiteNumber(usage.input_tokens)
      cacheCreation += finiteNumber(usage.cache_creation_input_tokens)
      cacheRead += finiteNumber(usage.cache_read_input_tokens)
      outputTokens += finiteNumber(usage.output_tokens)
      assistantTurns++
    }
    // Some transcript versions record a per-turn dollar cost; sum it when
    // present rather than guessing from a model-specific price table.
    const cost = entry?.costUSD ?? entry?.message?.costUSD
    if (typeof cost === 'number' && Number.isFinite(cost)) {
      costUsd += cost
      sawCost = true
    }
  }

  if (assistantTurns === 0) {
    return { ok: false, reason: 'no usage data found in transcript', lines, skipped }
  }

  const inputTokens = promptInput + cacheCreation + cacheRead
  return {
    ok: true,
    lines,
    skipped,
    assistantTurns,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    // Rounded to the canonical telemetry precision; null (not zero) when no
    // cost was present in the transcript.
    costUsd: sawCost ? roundTelemetryValue(costUsd) : null,
    breakdown: { promptInput, cacheCreation, cacheRead },
  }
}

// Combine per-file parse results into one aggregate. ok when ANY file had
// usage (matching the old concatenate-then-parse behavior); costUsd stays null
// unless at least one file carried a cost.
function mergeParses(results) {
  const usable = results.filter((result) => result.ok)
  const lines = results.reduce((sum, result) => sum + result.lines, 0)
  const skipped = results.reduce((sum, result) => sum + result.skipped, 0)
  if (usable.length === 0) {
    return { ok: false, reason: results[0]?.reason ?? 'no usage data found in transcript', lines, skipped }
  }
  const sum = (pick) => usable.reduce((total, result) => total + pick(result), 0)
  const costs = usable.map((result) => result.costUsd).filter((cost) => cost !== null)
  return {
    ok: true,
    lines,
    skipped,
    assistantTurns: sum((result) => result.assistantTurns),
    inputTokens: sum((result) => result.inputTokens),
    outputTokens: sum((result) => result.outputTokens),
    totalTokens: sum((result) => result.totalTokens),
    costUsd: costs.length > 0 ? roundTelemetryValue(costs.reduce((total, cost) => total + cost, 0)) : null,
    breakdown: {
      promptInput: sum((result) => result.breakdown.promptInput),
      cacheCreation: sum((result) => result.breakdown.cacheCreation),
      cacheRead: sum((result) => result.breakdown.cacheRead),
    },
  }
}

// Read and parse one or more JSONL files, aggregating across all of them.
// Files are parsed one at a time so peak memory is bounded by the largest
// transcript, not the sum of all of them.
export function parseSubagentTelemetryFiles(paths) {
  const list = Array.isArray(paths) ? paths : [paths]
  const missing = list.filter((file) => !fs.existsSync(file))
  if (missing.length > 0) throw new Error(`Transcript file(s) not found: ${missing.join(', ')}`)
  return mergeParses(list.map((file) => parseSubagentTelemetry(fs.readFileSync(file, 'utf8'))))
}

// Project a parse result onto the telemetry flag fields recordTelemetry accepts.
// reasoningTokens is intentionally omitted: Claude bills thinking as output, so
// the transcript's usage block does not separate it out.
export function telemetryValuesFromParse(parsed) {
  const values = {
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    totalTokens: parsed.totalTokens,
  }
  if (parsed.costUsd !== null) values.costUsd = parsed.costUsd
  return values
}

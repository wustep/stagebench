import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSubagentTelemetry, telemetryValuesFromParse } from '../bench/lib/telemetry-jsonl.mjs'

// A synthetic transcript in the Claude Code JSONL shape: a user turn (no usage),
// two assistant turns with usage + per-turn cost, and one unparseable line.
const transcript = [
  JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
  JSON.stringify({ type: 'assistant', costUSD: 0.01, message: { usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 } } }),
  'this is not json',
  JSON.stringify({ type: 'assistant', costUSD: 0.02, message: { usage: { input_tokens: 5, cache_read_input_tokens: 2000, output_tokens: 30 } } }),
  '',
].join('\n')

test('parseSubagentTelemetry sums real output tokens and skips noise', () => {
  const result = parseSubagentTelemetry(transcript)
  assert.equal(result.ok, true)
  assert.equal(result.assistantTurns, 2)
  // output = 50 + 30; the whole point — the true generated tokens, not the
  // notification's context-size figure.
  assert.equal(result.outputTokens, 80)
  // input = prompt(10+5) + cacheCreation(100) + cacheRead(1000+2000)
  assert.equal(result.inputTokens, 3115)
  assert.equal(result.totalTokens, 3195)
  assert.equal(result.costUsd, 0.03)
  assert.equal(result.skipped, 1)
})

test('telemetryValuesFromParse maps to telemetry fields without reasoning', () => {
  const values = telemetryValuesFromParse(parseSubagentTelemetry(transcript))
  assert.deepEqual(values, { inputTokens: 3115, outputTokens: 80, totalTokens: 3195, costUsd: 0.03 })
  assert.ok(!('reasoningTokens' in values), 'reasoning is not derivable from usage')
})

test('cost is null (not zero) when no transcript cost is present', () => {
  const noCost = [
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 1, output_tokens: 2 } } }),
  ].join('\n')
  const result = parseSubagentTelemetry(noCost)
  assert.equal(result.ok, true)
  assert.equal(result.costUsd, null)
  assert.equal(telemetryValuesFromParse(result).costUsd, undefined)
})

test('a transcript with no usage fails loudly instead of recording zeros', () => {
  const result = parseSubagentTelemetry([JSON.stringify({ type: 'user' }), 'garbage'].join('\n'))
  assert.equal(result.ok, false)
  assert.match(result.reason, /no usage/)
})

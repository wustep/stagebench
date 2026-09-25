import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { registryEntry } from '../bench/lib/run/store.mjs'
import { partialPhaseLabel, tokenCoverageFromStages, tokenHeadline } from '../src/token-coverage.mjs'

const threePhases = (telemetry) => telemetry.map((entry, index) => ({ number: index + 1, telemetry: entry }))

test('partial phase labels name only the phases that recorded the field', () => {
  assert.equal(partialPhaseLabel([3], 3), 'phase 3 of 3')
  assert.equal(partialPhaseLabel([1, 2], 3), 'phases 1 and 2 of 3')
  assert.equal(partialPhaseLabel([1, 2, 3], 3), null)
  assert.equal(partialPhaseLabel([], 3), null)
})

test('a stored total is not replaced by input tokens', () => {
  const coverage = tokenCoverageFromStages(threePhases([
    { inputTokens: 200000, outputTokens: 260000, totalTokens: 460000 },
    { inputTokens: 400000, outputTokens: 380000, totalTokens: 780000 },
    { inputTokens: 500000, outputTokens: 350000, totalTokens: 850000 },
  ]))
  assert.deepEqual(tokenHeadline({
    totalTokens: 2_090_000,
    inputTokens: 1_100_000,
    outputTokens: 990_000,
    reasoningTokens: 110_000,
  }, coverage), { kind: 'total', value: 2_090_000 })
})

test('complete input and output without a stored total use in plus out, not input alone', () => {
  const coverage = tokenCoverageFromStages(threePhases([
    { inputTokens: 10, outputTokens: 1 },
    { inputTokens: 20, outputTokens: 2 },
    { inputTokens: 30, outputTokens: 3 },
  ]))
  assert.deepEqual(tokenHeadline({ totalTokens: null, inputTokens: 60, outputTokens: 6 }, coverage), { kind: 'total', value: 66 })
})

test('input recorded on every phase is not shown as the token total', () => {
  const coverage = tokenCoverageFromStages(threePhases([
    { inputTokens: 10 },
    { inputTokens: 20 },
    { inputTokens: 30 },
  ]))
  assert.deepEqual(tokenHeadline({ totalTokens: null, inputTokens: 60, outputTokens: null }, coverage), { kind: 'unknown' })
})

test('without phase coverage, a null total does not fall back to input tokens', () => {
  assert.deepEqual(tokenHeadline({ totalTokens: null, inputTokens: 1_100_000 }, null), { kind: 'unknown' })
  assert.deepEqual(tokenHeadline({ totalTokens: 5 }, null), { kind: 'total', value: 5 })
})

test('phase-3-only token counts are partial, not a full-run total', () => {
  const coverage = tokenCoverageFromStages(threePhases([
    { wallTimeSeconds: 1 },
    { wallTimeSeconds: 2 },
    { inputTokens: 2_256_621, outputTokens: 37_045, reasoningTokens: 1_882 },
  ]))
  assert.deepEqual(coverage.inputTokens, [3])
  assert.deepEqual(tokenHeadline({
    totalTokens: null,
    inputTokens: 2_256_621,
    outputTokens: 37_045,
    reasoningTokens: 1_882,
  }, coverage), { kind: 'partial', phases: [3], phaseCount: 3, label: 'phase 3 of 3' })
})

test('tokens missing from the last phase stay partial', () => {
  const coverage = tokenCoverageFromStages(threePhases([
    { inputTokens: 100, outputTokens: 10 },
    { inputTokens: 200, outputTokens: 20 },
    { wallTimeSeconds: 5 },
  ]))
  assert.deepEqual(tokenHeadline({
    totalTokens: null,
    inputTokens: 300,
    outputTokens: 30,
  }, coverage), { kind: 'partial', phases: [1, 2], phaseCount: 3, label: 'phases 1 and 2 of 3' })
})

test('a run-level total with no phase split is kept and not divided', () => {
  const coverage = tokenCoverageFromStages(threePhases([
    { wallTimeSeconds: 1 },
    { wallTimeSeconds: 2 },
    { wallTimeSeconds: 3 },
  ]))
  assert.deepEqual(coverage.totalTokens, [])
  assert.deepEqual(coverage.inputTokens, [])
  assert.deepEqual(tokenHeadline({
    totalTokens: 27_676_961,
    inputTokens: null,
    outputTokens: null,
  }, coverage), { kind: 'total', value: 27_676_961 })
})

test('published runs match the token-coverage contract', () => {
  const load = (id) => registryEntry(JSON.parse(fs.readFileSync(`runs/${id}/run.json`, 'utf8')))

  const opus = load('claude-opus-5-5')
  assert.equal(opus.telemetry.totalTokens, 2_090_000)
  assert.equal(opus.telemetry.inputTokens + opus.telemetry.outputTokens, 2_090_000)
  assert.deepEqual(opus.tokenCoverage.totalTokens, [1, 2, 3])
  assert.deepEqual(tokenHeadline(opus.telemetry, opus.tokenCoverage), { kind: 'total', value: 2_090_000 })

  const astra = load('gpt-6-astra')
  assert.equal(astra.telemetry.totalTokens, null)
  assert.deepEqual(astra.tokenCoverage.inputTokens, [3])
  assert.deepEqual(astra.tokenCoverage.outputTokens, [3])
  assert.equal(tokenHeadline(astra.telemetry, astra.tokenCoverage).kind, 'partial')

  const fable = load('claude-fable-5')
  assert.equal(fable.telemetry.totalTokens, null)
  assert.deepEqual(fable.tokenCoverage.inputTokens, [1, 2])
  assert.deepEqual(fable.tokenCoverage.outputTokens, [1, 2])
  assert.equal(tokenHeadline(fable.telemetry, fable.tokenCoverage).kind, 'partial')

  for (const id of ['gpt-5-6-luna-3', 'gpt-5-6-sol-high']) {
    const run = load(id)
    assert.equal(typeof run.telemetry.totalTokens, 'number')
    assert.equal(run.telemetry.inputTokens, null)
    assert.deepEqual(run.tokenCoverage.totalTokens, [])
    assert.deepEqual(run.tokenCoverage.inputTokens, [])
    assert.equal(tokenHeadline(run.telemetry, run.tokenCoverage).kind, 'total')
    assert.equal(tokenHeadline(run.telemetry, run.tokenCoverage).value, run.telemetry.totalTokens)
  }
})

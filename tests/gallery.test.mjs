import assert from 'node:assert/strict'
import test from 'node:test'
import runs from '../src/data/runs.json' with { type: 'json' }
import {
  clearViewerUrl,
  createViewerUrl,
  floorScore,
  getAvailablePhases,
  getLatestPhase,
  getPreviewPath,
  getRunTitle,
  parseViewerSearch,
} from '../src/run-utils-runtime.mjs'

// Look runs up by id rather than array position: the gallery registry grows
// and reorders as runs are added, so positional assertions are brittle.
const byId = (id) => {
  const run = runs.find((candidate) => candidate.id === id)
  assert.ok(run, `expected a run with id "${id}" in runs.json`)
  return run
}
const complete = byId('gpt-5-6-sol-high') // complete three-phase run
const pianoOnly = byId('gpt5-6-sol-high') // partial test run, phases 1-2 only

test('display scores floor decimal values without changing stored data', () => {
  assert.equal(floorScore(58.8), 58)
  assert.equal(floorScore(70), 70)
  assert.equal(complete.evaluation.score, 58.8)
})

test('run metadata separates canonical model identity from display titles', () => {
  assert.equal(complete.model, 'gpt-5.6-sol-high')
  assert.equal(getRunTitle(complete), 'GPT 5.6 Sol High')
  assert.equal(complete.isTest, false)
  assert.equal(getRunTitle(pianoOnly), 'GPT 5.6 Sol High (Piano Only)')
  assert.equal(pianoOnly.isTest, true)
})

test('phase previews expose the latest playable build and preserve partial availability', () => {
  assert.deepEqual(getAvailablePhases(complete), [1, 2, 3])
  assert.deepEqual(getAvailablePhases(pianoOnly), [1, 2])
  assert.equal(getLatestPhase(complete), 3)
  assert.equal(getLatestPhase(pianoOnly), 2)
  assert.equal(getPreviewPath(pianoOnly, 3), undefined)
})

test('four-phase runs expose Organ and Synth as the latest playable phase', () => {
  const run = {
    id: 'four-phase-run',
    model: 'test-model',
    previews: {
      '1': '/previews/four-phase-run/stage1/index.html',
      '2': '/previews/four-phase-run/stage2/index.html',
      '3': '/previews/four-phase-run/stage3/index.html',
      '4': '/previews/four-phase-run/stage4/index.html',
    },
    previewPath: '/previews/four-phase-run/stage4/index.html',
    previewStage: 4,
  }

  assert.deepEqual(getAvailablePhases(run), [1, 2, 3, 4])
  assert.equal(getLatestPhase(run), 4)
  assert.equal(getPreviewPath(run, 4), '/previews/four-phase-run/stage4/index.html')
})

test('every runs.json entry conforms to the BenchmarkRun shape', () => {
  const runStatuses = new Set(['running', 'complete', 'partial', 'failed'])
  const stageStatuses = new Set(['queued', 'running', 'complete', 'failed'])
  for (const run of runs) {
    assert.equal(typeof run.id, 'string', `${run.id}: id`)
    assert.equal(typeof run.model, 'string', `${run.id}: model`)
    assert.ok(runStatuses.has(run.status), `${run.id}: invalid status "${run.status}"`)
    assert.equal(typeof run.startedAt, 'string', `${run.id}: startedAt`)
    assert.equal(typeof run.updatedAt, 'string', `${run.id}: updatedAt`)
    assert.ok(Array.isArray(run.stages) && run.stages.length > 0, `${run.id}: stages`)
    for (const stage of run.stages) {
      assert.ok([1, 2, 3, 4].includes(stage.number), `${run.id}: stage number ${stage.number}`)
      assert.ok(stageStatuses.has(stage.status), `${run.id}: stage status "${stage.status}"`)
    }
    for (const optionalString of ['title', 'variant', 'target']) {
      if (run[optionalString] !== undefined) {
        assert.equal(typeof run[optionalString], 'string', `${run.id}: ${optionalString}`)
      }
    }
    if (run.isTest !== undefined) assert.equal(typeof run.isTest, 'boolean', `${run.id}: isTest`)
    if (run.evaluation != null) {
      assert.equal(typeof run.evaluation.score, 'number', `${run.id}: evaluation.score`)
      assert.ok(Array.isArray(run.evaluation.evaluatedStages), `${run.id}: evaluatedStages`)
    }
  }
})

test('viewer URLs deep-link to a run and phase with a latest-phase fallback', () => {
  const linked = createViewerUrl('http://127.0.0.1:5173/#runs', pianoOnly.id, 2)
  assert.equal(linked.href, 'http://127.0.0.1:5173/?run=gpt5-6-sol-high&phase=2')
  assert.deepEqual(parseViewerSearch(linked.search, runs), { run: pianoOnly, phase: 2 })
  assert.deepEqual(parseViewerSearch(`?run=${pianoOnly.id}&phase=3`, runs), { run: pianoOnly, phase: 2 })
  assert.equal(clearViewerUrl(linked.href).href, 'http://127.0.0.1:5173/')
})

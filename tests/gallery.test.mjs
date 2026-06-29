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
} from '../src/run-utils.ts'

test('display scores floor decimal values without changing stored data', () => {
  assert.equal(floorScore(58.8), 58)
  assert.equal(floorScore(70), 70)
  assert.equal(runs[0].evaluation.score, 58.8)
})

test('run metadata separates canonical model identity from display titles', () => {
  assert.deepEqual(runs.map((run) => run.model), ['gpt-5.6-sol-high', 'gpt-5.6-sol-high'])
  assert.deepEqual(runs.map(getRunTitle), ['GPT 5.6 Sol High', 'GPT 5.6 Sol High (Piano Only)'])
  assert.equal(runs[0].isTest, false)
  assert.equal(runs[1].isTest, true)
})

test('phase previews expose the latest playable build and preserve partial availability', () => {
  assert.deepEqual(getAvailablePhases(runs[0]), [1, 2, 3])
  assert.deepEqual(getAvailablePhases(runs[1]), [1, 2])
  assert.equal(getLatestPhase(runs[0]), 3)
  assert.equal(getLatestPhase(runs[1]), 2)
  assert.equal(getPreviewPath(runs[1], 3), undefined)
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

test('viewer URLs deep-link to a run and phase with a latest-phase fallback', () => {
  const linked = createViewerUrl('http://127.0.0.1:5173/#runs', runs[1].id, 2)
  assert.equal(linked.href, 'http://127.0.0.1:5173/?run=gpt5-6-sol-high&phase=2')
  assert.deepEqual(parseViewerSearch(linked.search, runs), { run: runs[1], phase: 2 })
  assert.deepEqual(parseViewerSearch(`?run=${runs[1].id}&phase=3`, runs), { run: runs[1], phase: 2 })
  assert.equal(clearViewerUrl(linked.href).href, 'http://127.0.0.1:5173/')
})

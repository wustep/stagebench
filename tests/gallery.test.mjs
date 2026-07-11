import assert from 'node:assert/strict'
import test from 'node:test'
import runs from '../src/data/runs.json' with { type: 'json' }
import {
  clearViewerUrl,
  createViewerUrl,
  getAvailablePhases,
  getLatestPhase,
  getPreviewPath,
  getRunTitle,
  parseViewerSearch,
} from '../src/run-utils-runtime.ts'

// Synthetic phases 1-2 fixture, decoupled from the registry so adding or
// removing runs can't break the preview/URL behavior exercised below.
const pianoOnly = {
  id: 'piano-only',
  model: 'piano-only-model',
  title: 'Piano Only',
  previews: {
    '1': '/previews/piano-only/stage1/index.html',
    '2': '/previews/piano-only/stage2/index.html',
  },
}

test('every runs.json entry conforms to the generated RunEntry projection', () => {
  const runStatuses = new Set(['in-progress', 'complete', 'legacy'])
  const stageStatuses = new Set(['queued', 'running', 'complete', 'failed'])
  assert.ok(runs.length > 0, 'the registry should not be empty')
  for (const run of runs) {
    assert.equal(typeof run.id, 'string', `${run.id}: id`)
    assert.equal(typeof run.model, 'string', `${run.id}: model`)
    assert.equal(typeof run.legacy, 'boolean', `${run.id}: legacy`)
    assert.ok(runStatuses.has(run.status), `${run.id}: invalid status "${run.status}"`)
    assert.equal(typeof run.startedAt, 'string', `${run.id}: startedAt`)
    assert.ok(run.score === null || typeof run.score === 'number', `${run.id}: score`)
    assert.ok(run.reportPath === null || typeof run.reportPath === 'string', `${run.id}: reportPath`)
    assert.ok(Array.isArray(run.stages) && run.stages.length > 0, `${run.id}: stages`)
    for (const stage of run.stages) {
      assert.ok([1, 2, 3, 4].includes(stage.number), `${run.id}: stage number ${stage.number}`)
      assert.ok(stageStatuses.has(stage.status), `${run.id}: stage status "${stage.status}"`)
      assert.ok(stage.score === null || typeof stage.score === 'number', `${run.id}: stage score`)
    }
  }
})

// Registry curation (which specific runs are kept vs superseded) is content
// that churns with every run added or rescored, so it is not snapshotted here.
// These assertions are invariants that hold for any registry the generator
// produces, so adding/removing/rescoring a run can't break the suite.
test('registry entries have unique, well-formed ids and parseable dates', () => {
  const ids = runs.map((run) => run.id)
  assert.equal(new Set(ids).size, ids.length, 'run ids must be unique')
  for (const run of runs) {
    assert.match(run.id, /^[a-z0-9][a-z0-9-]*$/, `${run.id}: id must be a lowercase slug`)
    assert.ok(!Number.isNaN(Date.parse(run.startedAt)), `${run.id}: startedAt must parse`)
    assert.ok(!Number.isNaN(Date.parse(run.updatedAt)), `${run.id}: updatedAt must parse`)
    // Stage numbers are unique and ascending within a run.
    const numbers = run.stages.map((stage) => stage.number)
    assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), `${run.id}: stages must be ordered`)
    assert.equal(new Set(numbers).size, numbers.length, `${run.id}: stage numbers must be unique`)
  }
})

test('run titles fall back to the model id and are always present', () => {
  // Fixture: an explicit title overrides the model id; without one, the model
  // id is the display title (canonical identity vs. display name).
  assert.equal(getRunTitle(pianoOnly), 'Piano Only')
  assert.equal(getRunTitle({ id: 'x', model: 'x-model', previews: {} }), 'x-model')
  // Registry invariant: every entry resolves to a non-empty display title.
  for (const run of runs) {
    assert.equal(typeof run.model, 'string', `${run.id}: model`)
    assert.ok(getRunTitle(run).length > 0, `${run.id}: title must be non-empty`)
  }
})

test('phase previews expose the latest playable build and preserve partial availability', () => {
  assert.deepEqual(getAvailablePhases(pianoOnly), [1, 2])
  assert.equal(getLatestPhase(pianoOnly), 2)
  assert.equal(getPreviewPath(pianoOnly, 3), undefined)
})

test('viewer URLs deep-link to a run and phase with a latest-phase fallback', () => {
  const linked = createViewerUrl('http://127.0.0.1:5173/#runs', pianoOnly.id, 2)
  assert.equal(linked.href, 'http://127.0.0.1:5173/?run=piano-only&phase=2')
  assert.deepEqual(parseViewerSearch(linked.search, [pianoOnly]), { run: pianoOnly, phase: 2 })
  assert.deepEqual(parseViewerSearch(`?run=${pianoOnly.id}&phase=3`, [pianoOnly]), { run: pianoOnly, phase: 2 })
  assert.equal(clearViewerUrl(linked.href).href, 'http://127.0.0.1:5173/')
})

test('viewer search validates run ids and phase shape, falling back on garbage', () => {
  // Malformed run ids never match a real run and return null (no viewer).
  assert.equal(parseViewerSearch('?run=Piano%20Only&phase=1', [pianoOnly]), null)
  assert.equal(parseViewerSearch('?run=../etc/passwd&phase=1', [pianoOnly]), null)
  assert.equal(parseViewerSearch('?run=PIANO-ONLY&phase=1', [pianoOnly]), null)
  assert.equal(parseViewerSearch('?phase=1', [pianoOnly]), null)

  // Non-integer, out-of-range, or non-numeric phases fall back to the latest.
  assert.deepEqual(parseViewerSearch(`?run=${pianoOnly.id}&phase=1.5`, [pianoOnly]), { run: pianoOnly, phase: 2 })
  assert.deepEqual(parseViewerSearch(`?run=${pianoOnly.id}&phase=abc`, [pianoOnly]), { run: pianoOnly, phase: 2 })
  assert.deepEqual(parseViewerSearch(`?run=${pianoOnly.id}&phase=99`, [pianoOnly]), { run: pianoOnly, phase: 2 })
  assert.deepEqual(parseViewerSearch(`?run=${pianoOnly.id}&phase=0`, [pianoOnly]), { run: pianoOnly, phase: 2 })

  // A valid in-range phase is still honored.
  assert.deepEqual(parseViewerSearch(`?run=${pianoOnly.id}&phase=1`, [pianoOnly]), { run: pianoOnly, phase: 1 })
})

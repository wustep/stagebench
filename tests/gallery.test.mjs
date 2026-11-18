import assert from 'node:assert/strict'
import test from 'node:test'
import protocol from '../src/data/protocol.json' with { type: 'json' }
import runs from '../src/data/runs.json' with { type: 'json' }
import {
  buildGenerationLabels,
  classifyResult,
  getIsolation,
  showsIsolationBadge,
  getProtocolLabel,
  getProtocolNote,
  getResultClass,
  normalizeRunEntry,
  protocolGeneration,
  rankByRun,
  shortVersion,
  visibleRuns,
} from '../src/runs-data.ts'
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

// Synthetic protocol constants and field, decoupled from the generated
// protocol.json so the tiering rule is pinned independently of which protocol
// happens to be current: protocol 3 with the rubric still at 2.0.0, and runs
// on record from generations 1 (two minors), 2 and 3.
const protocol3 = {
  version: '3.0.0',
  rubricVersion: '2.0.0',
  protocolNotes: { 1: 'Generation one.', 2: 'Generation two.', 3: 'Generation three.' },
}
const fieldLabels = buildGenerationLabels(['3.0.0', '2.0.0', '2.0.0', '1.0.0', '1.1.0', null])
const tierOf = (run, info = protocol3, labels = fieldLabels) =>
  classifyResult({ legacy: false, rubricVersion: info.rubricVersion, ...run }, info, labels)

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
    assert.ok(run.panelVisuals === null || typeof run.panelVisuals === 'number', `${run.id}: panelVisuals`)
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

test('token headlines distinguish full-run totals from partial phase coverage', () => {
  const byId = Object.fromEntries(runs.map((run) => [run.id, run]))
  assert.equal(byId['claude-opus-5-5'].telemetry.totalTokens, 2_090_000)
  assert.deepEqual(byId['claude-opus-5-5'].tokenCoverage.totalTokens, [1, 2, 3])
  assert.equal(byId['gpt-6-astra'].telemetry.totalTokens, null)
  assert.deepEqual(byId['gpt-6-astra'].tokenCoverage.inputTokens, [3])
  assert.deepEqual(byId['claude-fable-5'].tokenCoverage.inputTokens, [1, 2])
  assert.equal(byId['claude-fable-5'].tokenCoverage.inputTokens.includes(3), false)
  assert.equal(typeof byId['gpt-5-6-luna-3'].telemetry.totalTokens, 'number')
  assert.deepEqual(byId['gpt-5-6-luna-3'].tokenCoverage.inputTokens, [])
  assert.equal(typeof byId['gpt-5-6-sol-high'].telemetry.totalTokens, 'number')
  assert.deepEqual(byId['gpt-5-6-sol-high'].tokenCoverage.totalTokens, [])
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

// Protocol 3 changed the conditions candidates work under, not the rubric. So a
// score is comparable across generations in rubric terms, and still not the
// same job: the tier is the rubric first, then the generation a run was BUILT
// under.
test('a run scored under the current rubric is tiered by the protocol generation it was built under', () => {
  const current = tierOf({ protocolVersion: '3.0.0' })
  assert.deepEqual(current, { id: 'current', label: 'Protocol 3.0', rank: 0, description: 'Generation three.' })
  // Not scored yet is still the current tier: the run sinks below the scored ones.
  assert.equal(tierOf({ protocolVersion: '3.0.0', rubricVersion: null }).id, 'current')

  const previous = tierOf({ protocolVersion: '2.0.0' })
  assert.equal(previous.id, 'before-protocol-3')
  assert.equal(previous.label, 'Protocol 2.0 and earlier')
  assert.notEqual(previous.id, current.id, 'classifyResult still distinguishes conditions, even though the gallery ranks everyone together')
  assert.equal(previous.description, "Built before Protocol 3.0 and scored with the same rubric. Ranked separately because the conditions differ; each run's details say what its protocol guaranteed.")

  // Everything built before the current generation stays ONE board: protocol
  // 1.x and 2.0 runs were ranked together before protocol 3 existed (one
  // rubric scored them all), and a new protocol does not re-split them.
  const oldest = tierOf({ protocolVersion: '1.0.0' })
  assert.deepEqual(oldest, previous)
  assert.deepEqual(tierOf({ protocolVersion: '1.1.0' }), previous)

  assert.ok(current.rank < previous.rank, 'the current generation ranks first')
  // With a single earlier generation on record, the board is named for it alone.
  assert.equal(tierOf({ protocolVersion: '2.0.0' }, protocol3, buildGenerationLabels(['3.0.0', '2.0.0'])).label, 'Protocol 2.0')
})

test('an older rubric, a missing version, and legacy records each keep a tier below the generations', () => {
  const oldest = tierOf({ protocolVersion: '1.0.0' })
  // The rubric decides before the generation does, whatever protocol built the run.
  const olderRubric = tierOf({ protocolVersion: '1.1.0', rubricVersion: '1.1.0' })
  assert.equal(olderRubric.id, 'protocol-1.1.0')
  assert.equal(olderRubric.label, 'Rubric 1.1.0', 'an older-rubric board is named for its rubric, not a protocol')
  assert.equal(tierOf({ protocolVersion: '3.0.0', rubricVersion: '1.1.0' }).id, 'protocol-1.1.0')
  assert.match(olderRubric.description, /Scored under rubric 1\.1\.0, before rubric 2\.0 changed the weights/)

  // The comparison is with the RUBRIC version. Against the protocol version
  // (3.0.0) every run scored under rubric 2.0.0 would read as outdated.
  assert.equal(tierOf({ protocolVersion: '3.0.0', rubricVersion: '2.0.0' }).id, 'current')

  // No usable version: never assumed to be the current generation.
  const unversioned = tierOf({ protocolVersion: null })
  assert.equal(unversioned.id, 'protocol-unversioned')
  assert.equal(tierOf({ protocolVersion: 'nightly' }).id, 'protocol-unversioned')

  const legacy = tierOf({ legacy: true, protocolVersion: '3.1.0', rubricVersion: null })
  assert.equal(legacy.id, 'legacy')
  assert.equal(legacy.label, 'Legacy')

  assert.ok(oldest.rank < unversioned.rank, 'unversioned sits below every known generation')
  assert.ok(unversioned.rank < olderRubric.rank, 'a different rubric sits below every current-rubric tier')
  assert.ok(olderRubric.rank < legacy.rank, 'legacy stays the lowest tier')
})

test('tier names are derived from the versions on record, not hardcoded', () => {
  assert.equal(shortVersion('3.0.0'), '3.0')
  assert.equal(shortVersion('12.4.1'), '12.4')
  assert.equal(shortVersion('2'), '2')
  assert.equal(shortVersion(null), null)
  assert.equal(shortVersion('nightly'), null)
  assert.equal(protocolGeneration('3.0.0'), 3)
  assert.equal(protocolGeneration(null), null)
  assert.deepEqual([...fieldLabels].sort(), [[1, '1.x'], [2, '2.0'], [3, '3.0']])

  // The next protocol bump: generation 3 becomes a tier of its own, and the
  // top tier takes its name from the new version.
  const protocol4 = { ...protocol3, version: '4.1.0', protocolNotes: { ...protocol3.protocolNotes, 4: 'Generation four.' } }
  const labels = buildGenerationLabels(['4.1.0', '3.0.0', '2.0.0'])
  assert.equal(tierOf({ protocolVersion: '4.1.0' }, protocol4, labels).label, 'Protocol 4.1')
  const third = tierOf({ protocolVersion: '3.0.0' }, protocol4, labels)
  assert.equal(third.id, 'before-protocol-4')
  assert.equal(third.label, 'Protocol 3.0 and earlier')
  assert.match(third.description, /^Built before Protocol 4\.1 and scored with the same rubric/)
  assert.equal(third.rank, 1)
  assert.deepEqual(tierOf({ protocolVersion: '2.0.0' }, protocol4, labels), third)
})

// The gallery ranks every run in one list, whatever protocol or rubric
// produced the score. classifyResult still describes the conditions (tests
// above); it does not split the board. These hold for any registry, so
// adding, removing or rescoring a run cannot break them.
test('the registry leaderboard is one ranked list of every run', () => {
  assert.equal(visibleRuns.length, runs.length, 'every run is listed exactly once')
  assert.equal(new Set(visibleRuns.map((run) => run.id)).size, visibleRuns.length, 'ids are unique')

  let previousScore = Infinity
  let expectedRank = 0
  let seenUnscored = false
  for (const run of visibleRuns) {
    if (run.score === null) {
      seenUnscored = true
      assert.equal(rankByRun.has(run.id), false, `${run.id}: unscored runs are unranked`)
      continue
    }
    assert.equal(seenUnscored, false, `${run.id}: scored runs sit above every unscored run`)
    assert.ok(run.score <= previousScore, `${run.id}: the list is ordered by score`)
    previousScore = run.score
    expectedRank += 1
    assert.equal(rankByRun.get(run.id), expectedRank, `${run.id}: rank ${expectedRank} in the single list`)
  }
})

test('normalization gives the conditions fields honest defaults', () => {
  const bare = normalizeRunEntry({
    id: 'bare', model: 'bare-model', legacy: true, status: 'legacy',
    startedAt: '2026-06-28T00:00:00.000Z', updatedAt: '2026-06-28T00:00:00.000Z', score: null,
    stages: [{ number: 1 }],
  })
  // A record that says nothing never claims containment it cannot show.
  assert.equal(bare.isolation, 'none')
  assert.deepEqual(bare.footnotes, [])
  assert.equal(bare.derivedFrom, null)
  assert.equal(bare.protocolVersion, null)
  assert.equal(bare.stages[0].isolation, null)

  const full = normalizeRunEntry({
    ...bare,
    legacy: false,
    status: 'complete',
    protocolVersion: '3.0.0',
    isolation: 'mixed',
    footnotes: [{ text: 'Operator note.' }, { kind: 'isolation', phases: [2], text: 'Phase 2 sealed outside the lockdown.', at: '2026-11-12T10:00:00.000Z' }],
    derivedFrom: { run: 'source-run', fromPhase: 2, reason: 'not part of the projection' },
    stages: [{ number: 1, status: 'complete', isolation: 'lockdown' }, { number: 2, status: 'complete', isolation: 'none' }],
  })
  assert.equal(full.isolation, 'mixed')
  assert.deepEqual(full.footnotes, [
    { kind: 'note', text: 'Operator note.', phases: [], at: null },
    { kind: 'isolation', text: 'Phase 2 sealed outside the lockdown.', phases: [2], at: '2026-11-12T10:00:00.000Z' },
  ])
  assert.deepEqual(full.derivedFrom, { run: 'source-run', fromPhase: 2 })
  assert.deepEqual(full.stages.map((stage) => stage.isolation), ['lockdown', 'none'])

  // An isolation value the gallery does not know is not promoted to a lockdown.
  assert.equal(normalizeRunEntry({ ...bare, isolation: 'airgap' }).isolation, 'none')
  assert.equal(normalizeRunEntry({ ...bare, isolation: 'lockdown' }).isolation, 'lockdown')
})

test('every registry entry declares how it was contained and carries its footnotes', () => {
  const runModes = new Set(['lockdown', 'none', 'mixed'])
  const stageModes = new Set(['lockdown', 'none'])
  for (const run of runs) {
    assert.ok(runModes.has(run.isolation), `${run.id}: invalid isolation "${run.isolation}"`)
    assert.ok(run.protocolVersion === null || typeof run.protocolVersion === 'string', `${run.id}: protocolVersion`)
    assert.ok(Array.isArray(run.footnotes), `${run.id}: footnotes must be an array`)
    for (const note of run.footnotes) {
      assert.equal(typeof note.kind, 'string', `${run.id}: footnote kind`)
      assert.ok(typeof note.text === 'string' && note.text.trim().length > 0, `${run.id}: footnote text`)
      assert.ok(note.phases === undefined || (Array.isArray(note.phases) && note.phases.every(Number.isInteger)), `${run.id}: footnote phases`)
    }
    assert.ok(
      run.derivedFrom === null || (typeof run.derivedFrom.run === 'string' && Number.isInteger(run.derivedFrom.fromPhase)),
      `${run.id}: derivedFrom`,
    )
    for (const stage of run.stages) {
      if (run.legacy || stage.status !== 'complete') continue
      assert.ok(stageModes.has(stage.isolation), `${run.id}: sealed phase ${stage.number} isolation "${stage.isolation}"`)
    }
  }
})

test('rows label the protocol and flag isolation only where the protocol requires a lockdown', () => {
  const run = (fields) => normalizeRunEntry({
    id: 'r', model: 'm', legacy: false, status: 'complete',
    startedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', score: null,
    ...fields,
  })
  assert.equal(getProtocolLabel(run({ protocolVersion: '3.0.0' })), 'P3.0')
  assert.equal(getProtocolLabel(run({ protocolVersion: '1.1.0' })), 'P1.1')
  // No usable version shows nothing rather than a guess. Legacy records carry
  // versions from a retired numbering, so they get no label either.
  assert.equal(getProtocolLabel(run({ protocolVersion: null })), null)
  assert.equal(getProtocolLabel(run({ protocolVersion: '3.1.0', legacy: true, status: 'legacy' })), null)
  assert.equal(getProtocolNote(run({ protocolVersion: '3.1.0', legacy: true, status: 'legacy' })), null)
  assert.equal(getProtocolNote(run({ protocolVersion: '2.0.0' })), protocol.protocolNotes['2'])

  const locked = getIsolation(run({ protocolVersion: '3.0.0', isolation: 'lockdown' }))
  assert.deepEqual([locked.label, locked.offProtocol], ['Lockdown', false])

  // Before protocol 3, no isolation is simply how the protocol worked.
  const open = getIsolation(run({ protocolVersion: '2.0.0', isolation: 'none' }))
  assert.deepEqual([open.label, open.offProtocol], ['No isolation', false])

  for (const [isolation, label] of [['none', 'No isolation'], ['mixed', 'Mixed']]) {
    const flagged = getIsolation(run({ protocolVersion: '3.0.0', isolation }))
    assert.deepEqual([flagged.label, flagged.offProtocol], [label, true])
    assert.match(flagged.meaning, /Off-protocol: protocol 3\.0 requires the lockdown\./)
  }
  for (const isolation of ['lockdown', 'none', 'mixed']) {
    assert.match(getIsolation(run({ protocolVersion: '2.0.0', isolation })).meaning, /^[A-Z].+\.$/, `${isolation}: one plain sentence`)
  }

  // The list does not badge the pre-lockdown default or an official
  // lockdown (the protocol 3 default); it still flags a mixed seal and
  // an off-protocol miss.
  assert.equal(showsIsolationBadge(open), false)
  assert.equal(showsIsolationBadge(locked), false)
  assert.equal(showsIsolationBadge(getIsolation(run({ protocolVersion: '3.0.0', isolation: 'none' }))), true)
  assert.equal(showsIsolationBadge(getIsolation(run({ protocolVersion: '3.0.0', isolation: 'mixed' }))), true)
  assert.equal(showsIsolationBadge(getIsolation(run({ protocolVersion: '2.0.0', isolation: 'mixed' }))), true)
})

test('the leaderboard source is one list and never writes the No isolation badge', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/components/RunList.tsx', import.meta.url), 'utf8')
  assert.match(source, /one ranked list/)
  assert.match(source, /showsIsolationBadge/)
  assert.doesNotMatch(source, /No isolation/)
  assert.doesNotMatch(source, /resultClass\.id !== previousClass/)
  assert.doesNotMatch(source, /No \{currentResultClass/)
  assert.doesNotMatch(source, /Rubric /)
  assert.doesNotMatch(source, /getResultClass/)
})

// Token counts an operator typed in are not comparable across harnesses, so the
// leaderboard never shows them. A boxed run's tokens and cost come from the
// lockdown gateway's own log (the provider's counts, priced with one dated
// table), and only those reach the drawer, labelled as such.
test('the gallery shows tokens only from the gateway, and labels cost by where it came from', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../src/components/RunList.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /<span[^>]*>\s*Tokens\s*<\/span>/, 'no Tokens column in the leaderboard row')
  for (const field of ['telemetry.inputTokens', 'telemetry.outputTokens', 'telemetry.totalTokens', 'telemetry.reasoningTokens', 'telemetry?.inputTokens', 'telemetry?.totalTokens']) {
    assert.equal(source.includes(field), false, `operator-typed ${field} is never rendered`)
  }
  assert.match(source, /run\.usage \?/, 'tokens render only from gateway-derived usage')
  assert.match(source, /operator-entered/, 'a typed cost is labelled as operator-entered')
  assert.match(source, /prices \{run\.usage\.pricesAsOf\}/, 'a gateway cost says which dated price table it used')
  assert.ok(source.includes('>Time<'), 'Time column is kept')
  assert.ok(source.includes('Wall time'), 'Wall time stays in the drawer')
  assert.ok(runs.some((run) => run.telemetry?.totalTokens != null), 'raw token data is still in runs.json')
})

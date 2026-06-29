import assert from 'node:assert/strict'
import test from 'node:test'
import { renderRunReportHtml, renderRunReportMarkdown } from '../evaluation/lib/report.mjs'

const evaluation = {
  rubricVersion: '2.0.0',
  runId: 'report-test',
  stage: 1,
  stageName: 'Visual recreation',
  status: 'complete',
  evaluator: 'Test evaluator',
  evaluatedAt: '2026-01-01T00:00:00.000Z',
  summary: 'A concise readable summary.',
  score: 75,
  rawScore: 75,
  grade: 'competent',
  categories: [{
    id: 'visualFidelity',
    label: 'Visual fidelity',
    weight: 100,
    score: 75,
    contribution: 75,
    criteria: [{ id: 'layout', label: 'Layout', weight: 100, rating: 3, score: 75, evidence: ['Compared directly with the reference.'] }],
  }],
  technicalGate: { passed: true, scoreCap: null, checks: [{ id: 'test', label: 'test', passed: true, detail: 'Passed' }] },
  issues: [{ title: 'Invented <display> hardware', detail: 'Remove the unsupported display.' }],
}

const run = {
  id: 'report-test',
  model: 'Model <Test>',
  title: 'Model Test Run',
  status: 'partial',
  stages: [
    { number: 1, status: 'complete', evaluation: { status: 'complete', score: 75 } },
    { number: 2, status: 'queued' },
    { number: 3, status: 'queued' },
    { number: 4, status: 'queued' },
  ],
  evaluation: { rubricVersion: '2.0.0', score: 75, grade: 'competent', evaluatedStages: [1], availableStageWeight: 20 },
}

const implementationDetails = {
  version: 1,
  runId: 'report-test',
  phases: [{
    phase: 1,
    phaseName: 'Visual recreation',
    libraries: {
      application: [{ name: 'react', version: '^19.0.0' }],
      development: [{ name: 'vitest', version: '^3.0.0' }],
    },
    audio: {
      strategy: 'Generated AudioBuffer samples',
      generatedSources: [{ name: 'Piano root buffers', method: 'Additive synthesis at startup' }],
      sampleSources: [],
      detectedFiles: [],
      notes: ['No recorded samples are used.'],
    },
  }],
}

test('HTML report presents summary, scores, issues, checks, and escaped evidence', () => {
  const html = renderRunReportHtml(run, [evaluation], implementationDetails)
  assert.match(html, /Run overview/)
  assert.match(html, /1\/4 phases evaluated/)
  assert.match(html, /Implementation details/)
  assert.match(html, /Application libraries/)
  assert.match(html, /Generated AudioBuffer samples/)
  assert.match(html, /No recorded or external sample sources declared/)
  assert.match(html, /implementation-details\.json/)
  assert.match(html, /75<\/strong>\/100/)
  assert.match(html, /Priority issues/)
  assert.match(html, /Criterion ratings and evidence/)
  assert.match(html, /Technical gate/)
  assert.match(html, /Model Test Run/)
  assert.match(html, /Invented &lt;display&gt; hardware: Remove the unsupported display\./)
  assert.doesNotMatch(html, /Invented <display>/)
})

test('Markdown report uses the same stable section order', () => {
  const markdown = renderRunReportMarkdown(run, [evaluation], implementationDetails)
  assert.match(markdown, /^# Model Test Run — Stagebench evaluation/m)
  assert.match(markdown, /Coverage: 1\/4 phases/)
  assert.ok(markdown.indexOf('## Phase scores') < markdown.indexOf('## Implementation details'))
  assert.ok(markdown.indexOf('## Implementation details') < markdown.indexOf('## Phase 1: Visual recreation'))
  assert.match(markdown, /Application libraries: `react` \^19\.0\.0/)
  assert.match(markdown, /Bundled audio files: None detected/)
  assert.ok(markdown.indexOf('### Category scores') < markdown.indexOf('### Priority issues'))
  assert.ok(markdown.indexOf('### Priority issues') < markdown.indexOf('### Technical gate'))
  assert.match(markdown, /Invented <display> hardware: Remove the unsupported display\./)
})

test('readable reports floor displayed score percentages while retaining source precision', () => {
  const decimalEvaluation = {
    ...evaluation,
    score: 70.9,
    categories: evaluation.categories.map((category) => ({
      ...category,
      score: 68.8,
      contribution: 68.8,
      criteria: category.criteria.map((criterion) => ({ ...criterion, score: 66.7 })),
    })),
  }
  const decimalRun = { ...run, evaluation: { ...run.evaluation, score: 58.8 } }
  const html = renderRunReportHtml(decimalRun, [decimalEvaluation], implementationDetails)
  const markdown = renderRunReportMarkdown(decimalRun, [decimalEvaluation], implementationDetails)

  assert.match(html, /<strong>58<\/strong><span>\/100/)
  assert.match(html, /<strong>70<\/strong>\/100/)
  assert.doesNotMatch(html, /58\.8|70\.9|68\.8|66\.7/)
  assert.match(markdown, /\*\*58\/100 · competent\*\*/)
  assert.match(markdown, /\*\*70\/100 · competent\*\*/)
  assert.doesNotMatch(markdown, /58\.8|70\.9|68\.8|66\.7/)
})

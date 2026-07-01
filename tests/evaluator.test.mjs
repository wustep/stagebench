import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  aggregateStageEvaluations,
  createAssessmentTemplate,
  scoreAssessment,
  validateRubric,
} from '../evaluation/lib/scoring.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rubric = validateRubric(JSON.parse(fs.readFileSync(path.join(root, 'evaluation', 'rubrics', 'v3.json'), 'utf8')))

function completedAssessment(stage, rating) {
  const assessment = createAssessmentTemplate(rubric, 'test-run', stage)
  assessment.evaluator = 'Evaluator test'
  assessment.evaluatedAt = '2026-01-01T00:00:00.000Z'
  assessment.summary = 'A deterministic evaluator fixture.'
  for (const category of assessment.categories) {
    for (const criterion of category.criteria) {
      criterion.rating = rating
      criterion.evidence = [`Observed ${category.id}.${criterion.id}`]
    }
  }
  return assessment
}

test('rubric has distinct category values for every phase', () => {
  assert.deepEqual(
    rubric.stages['1'].categories.map(({ id, weight }) => [id, weight]),
    [['visualFidelity', 45], ['basicPiano', 25], ['interaction', 15], ['engineeringQuality', 15]],
  )
  assert.deepEqual(
    rubric.stages['2'].categories.map(({ id, weight }) => [id, weight]),
    [['visualRetention', 10], ['pianoLibrary', 35], ['effectsAudio', 30], ['systemBehavior', 10], ['engineeringQuality', 15]],
  )
  assert.deepEqual(
    rubric.stages['3'].categories.map(({ id, weight }) => [id, weight]),
    [['visualRetention', 5], ['featureCompletion', 35], ['audioIntegration', 30], ['systemBehavior', 20], ['engineeringQuality', 10]],
  )
})

test('uniform ratings normalize to a stable 0–100 score', () => {
  const result = scoreAssessment(rubric, completedAssessment(2, 3), [
    { id: 'typecheck', passed: true },
    { id: 'lint', passed: true },
    { id: 'build', passed: true },
    { id: 'artifact', passed: true },
  ])
  assert.equal(result.score, 75)
  assert.equal(result.rawScore, 75)
  assert.equal(result.grade, 'competent')
  assert.equal(result.categories.find(({ id }) => id === 'effectsAudio').score, 75)
})

test('technical failures cap but do not erase the raw score', () => {
  const result = scoreAssessment(rubric, completedAssessment(1, 4), [
    { id: 'build', passed: false },
  ])
  assert.equal(result.rawScore, 100)
  assert.equal(result.score, 59)
  assert.equal(result.technicalGate.passed, false)
})

test('aggregate score uses the configured phase values', () => {
  const aggregate = aggregateStageEvaluations(rubric, [
    { stage: 1, status: 'complete', score: 80 },
    { stage: 2, status: 'complete', score: 90 },
  ])
  assert.equal(aggregate.score, 85.5)
  assert.equal(aggregate.availableStageWeight, 55)
  assert.deepEqual(aggregate.evaluatedStages, [1, 2])
})

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
const rubric = validateRubric(JSON.parse(fs.readFileSync(path.join(root, 'evaluation', 'rubrics', 'v2.json'), 'utf8')))

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
    [['visualFidelity', 55], ['featureCompletion', 20], ['interactionQuality', 15], ['engineeringQuality', 10]],
  )
  assert.deepEqual(
    rubric.stages['2'].categories.map(({ id, weight }) => [id, weight]),
    [['visualFidelity', 25], ['featureCompletion', 25], ['audioQuality', 30], ['interactionQuality', 15], ['engineeringQuality', 5]],
  )
  assert.deepEqual(
    rubric.stages['3'].categories.map(({ id, weight }) => [id, weight]),
    [['visualFidelity', 15], ['featureCompletion', 30], ['audioQuality', 30], ['systemBehavior', 15], ['engineeringQuality', 10]],
  )
  assert.deepEqual(
    rubric.stages['4'].categories.map(({ id, weight }) => [id, weight]),
    [['visualFidelity', 10], ['featureCompletion', 35], ['audioQuality', 30], ['systemBehavior', 15], ['engineeringQuality', 10]],
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
  assert.equal(result.categories.find(({ id }) => id === 'audioQuality').score, 75)
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
  assert.equal(aggregate.score, 85.6)
  assert.equal(aggregate.availableStageWeight, 45)
  assert.deepEqual(aggregate.evaluatedStages, [1, 2])
})

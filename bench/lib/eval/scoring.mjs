// Deterministic scoring of an evaluator assessment against the rubric.
// Pure: no filesystem access, no run-state knowledge.
import assert from 'node:assert/strict'

export const SCORE_PRECISION = 1

function round(value) {
  const factor = 10 ** SCORE_PRECISION
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function sumWeight(items) {
  return items.reduce((total, item) => total + item.weight, 0)
}

export function validateRubric(rubric) {
  assert.equal(typeof rubric.version, 'string', 'Rubric version is required')
  assert.ok(rubric.stages && typeof rubric.stages === 'object', 'Rubric phase entries are required')
  const stageIds = Object.keys(rubric.stages).sort()
  assert.deepEqual(stageIds, Object.keys(rubric.aggregateStageWeights).sort(), 'Rubric phases and aggregate weights must match')
  assert.equal(sumWeight(Object.entries(rubric.aggregateStageWeights).map(([id, weight]) => ({ id, weight }))), 100, 'Aggregate phase weights must total 100')

  for (const [stageNumber, stage] of Object.entries(rubric.stages)) {
    assert.equal(sumWeight(stage.categories), 100, `Phase ${stageNumber} category weights must total 100`)
    const categoryIds = new Set()
    for (const category of stage.categories) {
      assert.ok(!categoryIds.has(category.id), `Duplicate category ${category.id} in Phase ${stageNumber}`)
      categoryIds.add(category.id)
      assert.equal(sumWeight(category.criteria), 100, `Phase ${stageNumber} ${category.id} criterion weights must total 100`)
      assert.equal(new Set(category.criteria.map((criterion) => criterion.id)).size, category.criteria.length, `Duplicate criterion in Phase ${stageNumber} ${category.id}`)
    }
  }
  return rubric
}

export function createAssessmentTemplate(rubric, runId, stageNumber) {
  const stage = rubric.stages[String(stageNumber)]
  assert.ok(stage, `Unknown stage: ${stageNumber}`)
  return {
    rubricVersion: rubric.version,
    runId,
    stage: Number(stageNumber),
    evaluator: '',
    evaluatedAt: '',
    summary: '',
    categories: stage.categories.map((category) => ({
      id: category.id,
      criteria: category.criteria.map((criterion) => ({
        id: criterion.id,
        rating: null,
        evidence: [],
      })),
    })),
    issues: [],
  }
}

function indexById(items, label) {
  const result = new Map()
  for (const item of items ?? []) {
    assert.equal(typeof item.id, 'string', `${label} id is required`)
    assert.ok(!result.has(item.id), `Duplicate ${label} id: ${item.id}`)
    result.set(item.id, item)
  }
  return result
}

export function validateAssessment(rubric, assessment) {
  const stage = rubric.stages[String(assessment.stage)]
  assert.ok(stage, `Unknown assessment stage: ${assessment.stage}`)
  assert.equal(assessment.rubricVersion, rubric.version, 'Assessment rubric version does not match')
  assert.ok(typeof assessment.runId === 'string' && assessment.runId.length > 0, 'Assessment runId is required')
  assert.equal(typeof assessment.evaluator, 'string', 'Evaluator is required')
  assert.ok(assessment.evaluator.trim().length > 0, 'Evaluator is required')
  assert.equal(typeof assessment.evaluatedAt, 'string', 'evaluatedAt is required')
  assert.ok(Number.isFinite(Date.parse(assessment.evaluatedAt)), 'evaluatedAt must be an ISO date')
  assert.equal(typeof assessment.summary, 'string', 'Summary is required')
  assert.ok(assessment.summary.trim().length > 0, 'Summary is required')

  const submittedCategories = indexById(assessment.categories, 'category')
  assert.equal(submittedCategories.size, stage.categories.length, 'Assessment must include every rubric category')
  for (const category of stage.categories) {
    const submittedCategory = submittedCategories.get(category.id)
    assert.ok(submittedCategory, `Missing category: ${category.id}`)
    const submittedCriteria = indexById(submittedCategory.criteria, 'criterion')
    assert.equal(submittedCriteria.size, category.criteria.length, `Category ${category.id} must include every criterion`)
    for (const criterion of category.criteria) {
      const submitted = submittedCriteria.get(criterion.id)
      assert.ok(submitted, `Missing criterion: ${category.id}.${criterion.id}`)
      assert.ok(Number.isInteger(submitted.rating), `${category.id}.${criterion.id} rating must be an integer`)
      assert.ok(submitted.rating >= rubric.ratingScale.minimum && submitted.rating <= rubric.ratingScale.maximum, `${category.id}.${criterion.id} rating is outside the rubric scale`)
      assert.ok(Array.isArray(submitted.evidence) && submitted.evidence.some((item) => typeof item === 'string' && item.trim().length > 0), `${category.id}.${criterion.id} requires evidence`)
    }
  }
  return assessment
}

export function scoreAssessment(rubric, assessment, technicalChecks = []) {
  validateAssessment(rubric, assessment)
  const stage = rubric.stages[String(assessment.stage)]
  const submittedCategories = indexById(assessment.categories, 'category')
  const maximumRating = rubric.ratingScale.maximum

  const categories = stage.categories.map((category) => {
    const submittedCriteria = indexById(submittedCategories.get(category.id).criteria, 'criterion')
    const criteria = category.criteria.map((criterion) => {
      const submitted = submittedCriteria.get(criterion.id)
      const score = round((submitted.rating / maximumRating) * 100)
      return {
        id: criterion.id,
        label: criterion.label,
        weight: criterion.weight,
        rating: submitted.rating,
        score,
        evidence: submitted.evidence,
      }
    })
    const score = round(criteria.reduce((total, criterion) => total + criterion.score * criterion.weight / 100, 0))
    return {
      id: category.id,
      label: category.label,
      weight: category.weight,
      score,
      contribution: round(score * category.weight / 100),
      criteria,
    }
  })

  const rawScore = round(categories.reduce((total, category) => total + category.score * category.weight / 100, 0))
  const failedChecks = technicalChecks.filter((check) => !check.passed)
  const missingArtifact = failedChecks.some((check) => check.id === 'artifact')
  const scoreCap = missingArtifact
    ? rubric.technicalGate.missingArtifactScoreCap
    : failedChecks.length > 0
      ? rubric.technicalGate.failureScoreCap
      : null
  const score = scoreCap === null ? rawScore : Math.min(rawScore, scoreCap)

  return {
    rubricVersion: rubric.version,
    runId: assessment.runId,
    stage: assessment.stage,
    stageName: stage.name,
    status: 'complete',
    evaluator: assessment.evaluator.trim(),
    evaluatedAt: new Date(assessment.evaluatedAt).toISOString(),
    summary: assessment.summary.trim(),
    score,
    rawScore,
    categories,
    technicalGate: {
      passed: failedChecks.length === 0,
      scoreCap,
      checks: technicalChecks,
    },
    issues: Array.isArray(assessment.issues) ? assessment.issues : [],
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Combine independent evaluator assessments of one phase into a single
// assessment by taking the per-criterion median rating (rounded to the
// rubric's integer scale) and unioning the evidence with per-evaluator
// attribution. Reduces single-observation noise; a one-evaluator panel is a
// no-op passthrough. Each input must independently validate.
export function mergeAssessments(rubric, assessments) {
  assert.ok(Array.isArray(assessments) && assessments.length > 0, 'A panel needs at least one assessment')
  assessments.forEach((assessment) => validateAssessment(rubric, assessment))
  if (assessments.length === 1) return assessments[0]
  const stageNumber = assessments[0].stage
  assert.ok(assessments.every((assessment) => assessment.stage === stageNumber), 'Panel assessments must target one stage')
  assert.ok(assessments.every((assessment) => assessment.runId === assessments[0].runId), 'Panel assessments must target one run')
  const stage = rubric.stages[String(stageNumber)]
  const categories = stage.categories.map((category) => ({
    id: category.id,
    criteria: category.criteria.map((criterion) => {
      const ratings = []
      const evidence = []
      for (const assessment of assessments) {
        const submittedCategory = assessment.categories.find((entry) => entry.id === category.id)
        const submitted = submittedCategory.criteria.find((entry) => entry.id === criterion.id)
        ratings.push(submitted.rating)
        for (const item of submitted.evidence) evidence.push(`[${assessment.evaluator}] ${item}`)
      }
      return { id: criterion.id, rating: Math.round(median(ratings)), evidence }
    }),
  }))
  return {
    rubricVersion: assessments[0].rubricVersion,
    runId: assessments[0].runId,
    stage: stageNumber,
    evaluator: `Panel median of ${assessments.length}: ${assessments.map((assessment) => assessment.evaluator).join('; ')}`,
    evaluatedAt: assessments.map((assessment) => assessment.evaluatedAt).sort().at(-1),
    summary: assessments.map((assessment, index) => `(${index + 1}) ${assessment.summary}`).join('\n\n'),
    categories,
    issues: assessments.flatMap((assessment) => (Array.isArray(assessment.issues) ? assessment.issues : [])),
    panel: assessments.map((assessment) => ({ evaluator: assessment.evaluator, evaluatedAt: assessment.evaluatedAt })),
  }
}

export function aggregateStageEvaluations(rubric, evaluations) {
  const complete = evaluations.filter((evaluation) => evaluation?.status === 'complete')
  if (complete.length === 0) return null
  const weighted = complete.map((evaluation) => ({
    stage: evaluation.stage,
    score: evaluation.score,
    weight: rubric.aggregateStageWeights[String(evaluation.stage)],
  }))
  const availableWeight = weighted.reduce((total, item) => total + item.weight, 0)
  const score = round(weighted.reduce((total, item) => total + item.score * item.weight, 0) / availableWeight)
  return {
    rubricVersion: rubric.version,
    score,
    evaluatedStages: weighted.map((item) => item.stage).sort(),
    availableStageWeight: availableWeight,
  }
}

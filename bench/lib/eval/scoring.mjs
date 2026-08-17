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
      category.criteria.forEach((criterion) => validateCriterionShape(criterion, `Phase ${stageNumber} ${category.id}`))
    }
  }

  if (rubric.runAxis) {
    const axis = rubric.runAxis
    assert.ok(axis.weight > 0 && axis.weight < 100, 'Run axis weight must be between 0 and 100')
    assert.equal(axis.scoredAgainst, 'highest-sealed-phase', 'Run axis must be scored against the highest sealed phase')
    assert.ok(axis.category?.criteria?.length, 'Run axis needs a category with criteria')
    assert.equal(sumWeight(axis.category.criteria), 100, 'Run axis criterion weights must total 100')
    axis.category.criteria.forEach((criterion) => validateCriterionShape(criterion, 'Run axis'))
    // A gate that can never fire is worse than no gate: it reads as a
    // safeguard while silently passing the case it was written for.
    for (const rule of axis.hardGate?.measurements ?? []) {
      const criterion = axis.category.criteria.find((entry) => entry.id === rule.criterion)
      assert.ok(criterion, `Hard gate references unknown criterion ${rule.criterion}`)
      assert.equal(criterion.scoring, 'computed', `Hard gate criterion ${rule.criterion} must be computed`)
      assert.ok(criterion.measurements.some((spec) => spec.id === rule.measurement), `Hard gate references unknown measurement ${rule.criterion}.${rule.measurement}`)
      assert.ok(['scoreBelow', 'ratioBelow'].includes(rule.kind), `Unknown hard gate kind: ${rule.kind}`)
    }
  }
  return rubric
}

const MEASUREMENT_KINDS = new Set(['band', 'range', 'ratio', 'penaltyCount'])

function validateCriterionShape(criterion, where) {
  if (criterion.scoring !== 'computed') return
  assert.ok(Array.isArray(criterion.measurements) && criterion.measurements.length, `${where} ${criterion.id} is computed and needs measurements`)
  assert.equal(sumWeight(criterion.measurements), 100, `${where} ${criterion.id} measurement weights must total 100`)
  for (const spec of criterion.measurements) {
    assert.ok(MEASUREMENT_KINDS.has(spec.kind), `${where} ${criterion.id}.${spec.id} has unknown kind ${spec.kind}`)
    if (spec.kind === 'ratio') assert.ok(spec.denominator, `${where} ${criterion.id}.${spec.id} needs a denominator`)
    if (spec.kind === 'band') assert.equal(typeof spec.target, 'number', `${where} ${criterion.id}.${spec.id} needs a numeric target`)
    if (spec.kind === 'range') assert.ok(spec.maximum > spec.minimum, `${where} ${criterion.id}.${spec.id} needs maximum > minimum`)
  }
}

// The model an assessment must have been produced by. Recorded in the rubric
// so a change to it is a rubric change, and so the value the evaluator is told
// to write is the same value registration checks.
export function pinnedEvaluatorModel(rubric) {
  return rubric.evaluator?.model ?? null
}

// Panel fidelity is a run-level axis: rated once against the highest sealed
// phase, because the phases are cumulative and rating the same panel three
// times measured it at three different resolutions. Its block rides on the top
// phase's assessment.
export function isTopPhase(rubric, phase, sealedPhases) {
  if (rubric.runAxis?.scoredAgainst !== 'highest-sealed-phase') return false
  return Number(phase) === Math.max(...sealedPhases.map(Number))
}

// A criterion is either judged (a 0-4 rating) or computed (measurements the
// evaluator reports, scored by formula). Computed criteria keep judgment out
// of the places where the specs already give ground truth.
function blankCriterion(criterion) {
  if (criterion.scoring !== 'computed') return { id: criterion.id, scoring: 'judged', rating: null, evidence: [] }
  const measurements = {}
  for (const spec of criterion.measurements) {
    measurements[spec.id] = null
    if (spec.kind === 'ratio') measurements[spec.denominator] = null
  }
  return { id: criterion.id, scoring: 'computed', measurements, evidence: [] }
}

export function createAssessmentTemplate(rubric, runId, stageNumber, { includeRunAxis = false } = {}) {
  const stage = rubric.stages[String(stageNumber)]
  assert.ok(stage, `Unknown stage: ${stageNumber}`)
  const template = {
    rubricVersion: rubric.version,
    runId,
    stage: Number(stageNumber),
    evaluator: '',
    evaluatorModel: pinnedEvaluatorModel(rubric) ?? '',
    evaluatedAt: '',
    summary: '',
    categories: stage.categories.map((category) => ({
      id: category.id,
      criteria: category.criteria.map(blankCriterion),
    })),
    issues: [],
  }
  if (includeRunAxis && rubric.runAxis) {
    template[rubric.runAxis.category.id] = {
      scoredAgainst: `stage${stageNumber}`,
      criteria: rubric.runAxis.category.criteria.map(blankCriterion),
    }
  }
  return template
}

function clampScore(value) {
  return Math.max(0, Math.min(100, value))
}

// Score one reported measurement. `curve` bends a ratio away from linear: a
// panel with 58% of its controls reachable is not 58% of a working panel, so
// reachability and keybed layout square the ratio.
export function measurementScore(spec, values) {
  const raw = values?.[spec.id]
  if (raw === undefined || raw === null || Number.isNaN(Number(raw))) return null
  const value = Number(raw)
  const decay = spec.decay ?? 3
  if (spec.kind === 'band') {
    const deviation = Math.abs(value - spec.target)
    if (spec.tolerance === 0) return deviation === 0 ? 100 : 0
    if (deviation <= spec.tolerance) return 100
    return clampScore(100 * (1 - (deviation - spec.tolerance) / (spec.tolerance * decay - spec.tolerance)))
  }
  if (spec.kind === 'range') {
    if (value >= spec.minimum && value <= spec.maximum) return 100
    const deviation = value < spec.minimum ? spec.minimum - value : value - spec.maximum
    return clampScore(100 * (1 - deviation / (((spec.maximum - spec.minimum) / 2) * (decay - 1))))
  }
  if (spec.kind === 'ratio') {
    const denominator = Number(values[spec.denominator])
    if (!denominator) return null
    return clampScore(100 * (value / denominator) ** (spec.curve ?? 1))
  }
  if (spec.kind === 'penaltyCount') return clampScore(100 - value * (spec.penaltyEach ?? 25))
  throw new Error(`Unknown measurement kind: ${spec.kind}`)
}

function scoreComputedCriterion(criterion, submitted) {
  const values = submitted?.measurements ?? {}
  const measurements = []
  let reportedWeight = 0
  let total = 0
  for (const spec of criterion.measurements) {
    const score = measurementScore(spec, values)
    measurements.push({ id: spec.id, label: spec.label, weight: spec.weight, value: values[spec.id] ?? null, score: score === null ? null : round(score) })
    if (score === null) continue
    reportedWeight += spec.weight
    total += (score * spec.weight) / 100
  }
  assert.ok(reportedWeight > 0, `${criterion.id} has no usable measurements`)
  // Re-normalise over what was reported, so one unmeasurable value does not
  // silently read as a zero.
  return { score: round((total / reportedWeight) * 100), measurements, reportedWeight }
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

// Issues arrived in 14 different shapes across the archived assessments (bare
// strings, {title,detail}, {area,evidence,summary}, …), which forced the report
// renderer to guess at keys to avoid printing "[object Object]". One shape now.
const ISSUE_SEVERITIES = new Set(['critical', 'major', 'minor'])

function validateIssues(issues) {
  if (issues === undefined) return
  assert.ok(Array.isArray(issues), 'issues must be an array')
  issues.forEach((issue, index) => {
    const at = `issues[${index}]`
    assert.ok(issue && typeof issue === 'object' && !Array.isArray(issue), `${at} must be an object`)
    assert.ok(ISSUE_SEVERITIES.has(issue.severity), `${at}.severity must be one of critical, major, minor`)
    assert.ok(typeof issue.title === 'string' && issue.title.trim().length > 0, `${at}.title is required`)
    assert.ok(typeof issue.detail === 'string' && issue.detail.trim().length > 0, `${at}.detail is required`)
  })
}

export function validateAssessment(rubric, assessment, options = {}) {
  const stage = rubric.stages[String(assessment.stage)]
  assert.ok(stage, `Unknown assessment stage: ${assessment.stage}`)
  assert.equal(assessment.rubricVersion, rubric.version, 'Assessment rubric version does not match')
  assert.ok(typeof assessment.runId === 'string' && assessment.runId.length > 0, 'Assessment runId is required')
  assert.equal(typeof assessment.evaluator, 'string', 'Evaluator is required')
  assert.ok(assessment.evaluator.trim().length > 0, 'Evaluator is required')

  // The evaluator model is the comparability-critical fact the old free-text
  // `evaluator` field never captured: across the archived assessments it says
  // "opus-4.8", "evaluator-1", "blind-evaluator-agent" and nothing at all.
  const pinned = pinnedEvaluatorModel(rubric)
  if (pinned && !options.allowEvaluatorModel) {
    assert.equal(
      typeof assessment.evaluatorModel === 'string' && assessment.evaluatorModel.trim(),
      pinned,
      `Assessment evaluatorModel must be "${pinned}" (got ${JSON.stringify(assessment.evaluatorModel ?? null)}); re-run the evaluation with the pinned model, or pass --allow-evaluator-model to register it anyway`,
    )
  }

  assert.equal(typeof assessment.evaluatedAt, 'string', 'evaluatedAt is required')
  assert.ok(Number.isFinite(Date.parse(assessment.evaluatedAt)), 'evaluatedAt must be an ISO date')
  assert.equal(typeof assessment.summary, 'string', 'Summary is required')
  assert.ok(assessment.summary.trim().length > 0, 'Summary is required')
  validateIssues(assessment.issues)

  const submittedCategories = indexById(assessment.categories, 'category')
  assert.equal(submittedCategories.size, stage.categories.length, 'Assessment must include every rubric category')
  for (const category of stage.categories) {
    const submittedCategory = submittedCategories.get(category.id)
    assert.ok(submittedCategory, `Missing category: ${category.id}`)
    validateCriteria(rubric, category.criteria, submittedCategory.criteria, category.id)
  }

  // The run-level panel axis rides on the top phase's assessment.
  const runAxis = rubric.runAxis
  if (runAxis && assessment[runAxis.category.id]) {
    validateCriteria(rubric, runAxis.category.criteria, assessment[runAxis.category.id].criteria, runAxis.category.id)
  }
  return assessment
}

function validateCriteria(rubric, defined, submittedList, where) {
  const submitted = indexById(submittedList, 'criterion')
  assert.equal(submitted.size, defined.length, `${where} must include every criterion`)
  for (const criterion of defined) {
    const entry = submitted.get(criterion.id)
    assert.ok(entry, `Missing criterion: ${where}.${criterion.id}`)
    assert.ok(
      Array.isArray(entry.evidence) && entry.evidence.some((item) => typeof item === 'string' && item.trim().length > 0),
      `${where}.${criterion.id} requires evidence`,
    )
    if (criterion.scoring === 'computed') {
      assert.ok(entry.measurements && typeof entry.measurements === 'object', `${where}.${criterion.id} is computed and requires a measurements object`)
      // Re-normalising over reported measurements means a null is honest but an
      // all-null criterion has nothing to score.
      const reported = criterion.measurements.filter((spec) => measurementScore(spec, entry.measurements) !== null)
      assert.ok(reported.length > 0, `${where}.${criterion.id} has no usable measurements`)
      continue
    }
    assert.ok(Number.isInteger(entry.rating), `${where}.${criterion.id} rating must be an integer`)
    assert.ok(
      entry.rating >= rubric.ratingScale.minimum && entry.rating <= rubric.ratingScale.maximum,
      `${where}.${criterion.id} rating is outside the rubric scale`,
    )
  }
}

// Score one axis (a phase category, or the run-level panel axis) from its
// definition plus what the evaluator submitted.
function scoreAxis(rubric, defined, submittedList) {
  const submitted = indexById(submittedList, 'criterion')
  const criteria = defined.map((criterion) => {
    const entry = submitted.get(criterion.id)
    if (criterion.scoring === 'computed') {
      const { score, measurements } = scoreComputedCriterion(criterion, entry)
      return { id: criterion.id, label: criterion.label, weight: criterion.weight, scoring: 'computed', score, measurements, evidence: entry.evidence }
    }
    const score = round((entry.rating / rubric.ratingScale.maximum) * 100)
    return { id: criterion.id, label: criterion.label, weight: criterion.weight, scoring: 'judged', rating: entry.rating, score, evidence: entry.evidence }
  })
  return { score: round(criteria.reduce((total, item) => total + (item.score * item.weight) / 100, 0)), criteria }
}

// Hard gates key on individual measurements, not the criterion score: a keybed
// with the right key count, the right split and the right height ratio that
// simply does not lay out inside its container averages to a passing number,
// which is exactly the failure the gate exists to catch.
function evaluateHardGate(gate, criteria) {
  if (!gate?.measurements?.length) return { tripped: [], scoreCap: null }
  const tripped = []
  for (const rule of gate.measurements) {
    const criterion = criteria.find((item) => item.id === rule.criterion)
    const measurement = criterion?.measurements?.find((item) => item.id === rule.measurement)
    if (!measurement || measurement.score === null) continue
    if (rule.kind === 'scoreBelow' && measurement.score < rule.threshold) tripped.push(rule)
    if (rule.kind === 'ratioBelow' && measurement.score / 100 < rule.threshold ** (rule.curve ?? 2)) tripped.push(rule)
  }
  return { tripped, scoreCap: tripped.length ? gate.scoreCap : null }
}

export function scoreRunAxis(rubric, assessment) {
  const runAxis = rubric.runAxis
  if (!runAxis) return null
  const block = assessment[runAxis.category.id]
  if (!block) return null
  const { score, criteria } = scoreAxis(rubric, runAxis.category.criteria, block.criteria)
  const { tripped, scoreCap } = evaluateHardGate(runAxis.hardGate, criteria)
  return {
    id: runAxis.category.id,
    label: runAxis.category.label,
    weight: runAxis.weight,
    scoredAgainst: block.scoredAgainst ?? null,
    rawScore: score,
    score: scoreCap === null ? score : round(Math.min(score, scoreCap)),
    hardGate: { tripped: tripped.map((rule) => `${rule.criterion}.${rule.measurement}`), scoreCap },
    criteria,
  }
}

export function scoreAssessment(rubric, assessment, technicalChecks = [], options = {}) {
  validateAssessment(rubric, assessment, options)
  const stage = rubric.stages[String(assessment.stage)]
  const submittedCategories = indexById(assessment.categories, 'category')

  const categories = stage.categories.map((category) => {
    const { score, criteria } = scoreAxis(rubric, category.criteria, submittedCategories.get(category.id).criteria)
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
  // Advisory checks are recorded and reported but never cap a score. They
  // describe how much a gate actually covered rather than whether it exited 0,
  // so a run sealed before the check existed is not retroactively re-capped by
  // rescoring. Promote one to gating by dropping its `advisory` flag.
  const failedChecks = technicalChecks.filter((check) => !check.passed && !check.advisory)
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
    evaluatorModel: (assessment.evaluatorModel ?? '').trim() || null,
    evaluatedAt: new Date(assessment.evaluatedAt).toISOString(),
    summary: assessment.summary.trim(),
    score,
    rawScore,
    categories,
    runAxis: scoreRunAxis(rubric, assessment),
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
export function mergeAssessments(rubric, assessments, options = {}) {
  assert.ok(Array.isArray(assessments) && assessments.length > 0, 'A panel needs at least one assessment')
  assessments.forEach((assessment) => validateAssessment(rubric, assessment, options))
  if (assessments.length === 1) return assessments[0]
  const stageNumber = assessments[0].stage
  assert.ok(assessments.every((assessment) => assessment.stage === stageNumber), 'Panel assessments must target one stage')
  assert.ok(assessments.every((assessment) => assessment.runId === assessments[0].runId), 'Panel assessments must target one run')
  // A panel exists to average out evaluator noise, not model differences.
  assert.equal(new Set(assessments.map((assessment) => assessment.evaluatorModel)).size, 1, 'Panel assessments must all come from the same evaluator model')
  const stage = rubric.stages[String(stageNumber)]
  // Judged criteria median their ratings; computed criteria median each
  // reported measurement, so a panel damps measurement-method spread the same
  // way it damps judgment spread.
  const mergeCriteria = (defined, pick) => defined.map((criterion) => {
    const evidence = []
    const submitted = assessments.map((assessment) => {
      const entry = pick(assessment, criterion.id)
      for (const item of entry.evidence) evidence.push(`[${assessment.evaluator}] ${item}`)
      return entry
    })
    if (criterion.scoring === 'computed') {
      const measurements = {}
      for (const key of new Set(submitted.flatMap((entry) => Object.keys(entry.measurements ?? {})))) {
        const values = submitted.map((entry) => entry.measurements?.[key]).filter((value) => typeof value === 'number')
        measurements[key] = values.length ? median(values) : null
      }
      return { id: criterion.id, scoring: 'computed', measurements, evidence }
    }
    return { id: criterion.id, scoring: 'judged', rating: Math.round(median(submitted.map((entry) => entry.rating))), evidence }
  })

  const categories = stage.categories.map((category) => ({
    id: category.id,
    criteria: mergeCriteria(category.criteria, (assessment, id) =>
      assessment.categories.find((entry) => entry.id === category.id).criteria.find((entry) => entry.id === id)),
  }))

  const runAxis = rubric.runAxis
  const mergedRunAxis = runAxis && assessments.every((assessment) => assessment[runAxis.category.id])
    ? {
        scoredAgainst: assessments[0][runAxis.category.id].scoredAgainst ?? null,
        criteria: mergeCriteria(runAxis.category.criteria, (assessment, id) =>
          assessment[runAxis.category.id].criteria.find((entry) => entry.id === id)),
      }
    : null

  return {
    ...(mergedRunAxis ? { [runAxis.category.id]: mergedRunAxis } : {}),
    rubricVersion: assessments[0].rubricVersion,
    runId: assessments[0].runId,
    stage: stageNumber,
    evaluator: `Panel median of ${assessments.length}: ${assessments.map((assessment) => assessment.evaluator).join('; ')}`,
    evaluatorModel: assessments[0].evaluatorModel,
    evaluatedAt: assessments.map((assessment) => assessment.evaluatedAt).sort().at(-1),
    summary: assessments.map((assessment, index) => `(${index + 1}) ${assessment.summary}`).join('\n\n'),
    categories,
    issues: assessments.flatMap((assessment) => (Array.isArray(assessment.issues) ? assessment.issues : [])),
    panel: assessments.map((assessment) => ({ evaluator: assessment.evaluator, evaluatedAt: assessment.evaluatedAt })),
  }
}

// The aggregate is the run-level panel axis plus the phase-weighted remainder.
// Callers pass stage summaries; `runAxis` is the scored panel block from the
// highest sealed phase (null on runs evaluated before the axis existed, which
// then aggregate on phases alone exactly as they used to).
export function aggregateStageEvaluations(rubric, evaluations, runAxis = null) {
  const complete = evaluations.filter((evaluation) => evaluation?.status === 'complete')
  if (complete.length === 0) return null
  const weighted = complete.map((evaluation) => ({
    stage: evaluation.stage,
    score: evaluation.score,
    weight: rubric.aggregateStageWeights[String(evaluation.stage)],
  }))
  const availableWeight = weighted.reduce((total, item) => total + item.weight, 0)
  const phaseScore = round(weighted.reduce((total, item) => total + item.score * item.weight, 0) / availableWeight)

  const axisWeight = runAxis ? (rubric.runAxis?.weight ?? 0) : 0
  const score = axisWeight
    ? round((axisWeight / 100) * runAxis.score + ((100 - axisWeight) / 100) * phaseScore)
    : phaseScore

  return {
    rubricVersion: rubric.version,
    score,
    phaseWeightedScore: phaseScore,
    ...(runAxis ? { runAxis: { id: runAxis.id, label: runAxis.label, weight: axisWeight, score: runAxis.score, hardGate: runAxis.hardGate } } : {}),
    evaluatedStages: weighted.map((item) => item.stage).sort(),
    availableStageWeight: availableWeight,
  }
}

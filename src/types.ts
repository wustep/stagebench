// Single source of truth for the benchmark run shape shared by the gallery
// app and the run-utils helpers. The data in src/data/runs.json is validated
// against this shape at test time (see tests/gallery.test.mjs).

export type PhaseNumber = 1 | 2 | 3 | 4

export type StageStatus = 'queued' | 'prepared' | 'running' | 'verifying' | 'verified' | 'complete' | 'failed' | 'invalid' | 'budget-exceeded'
export type RunStatus = 'created' | 'running' | 'complete' | 'partial' | 'failed' | 'invalid' | 'budget-exceeded' | 'infrastructure-failure'
export type EvaluationGrade = 'exceptional' | 'strong' | 'competent' | 'developing' | 'incomplete'

export type StageEvaluation = {
  status: 'complete'
  score: number
  rawScore: number
  grade: EvaluationGrade
  evaluatedAt: string
  rubricVersion: string
  path: string
  reportPath?: string
  categoryScores: Record<string, number>
}

export type BenchmarkRun = {
  schemaVersion?: number
  benchmarkVersion?: string
  id: string
  model: string
  title?: string
  variant?: string
  target?: string
  isTest?: boolean
  targetPhase?: 1 | 2 | 3
  selectedPhases?: Array<1 | 2 | 3>
  classification?: {
    kind: 'official' | 'exploratory' | 'legacy'
    comparable: boolean
    comparisonGroup?: string | null
    reason?: string
  }
  validity?: 'pending' | 'valid' | 'valid-with-warnings' | 'invalid-technical' | 'incomplete' | 'budget-exceeded' | 'infrastructure-failure' | 'legacy-unverified'
  protocol?: {
    version: string
    manifest?: string
    digest?: string
    rubricVersion?: string
    selectionMode?: string
  }
  status: RunStatus
  startedAt: string
  updatedAt: string
  previewPath?: string
  previewStage?: PhaseNumber
  previews?: Partial<Record<`${PhaseNumber}`, string>>
  evaluation?: {
    rubricVersion: string
    score: number
    grade: EvaluationGrade
    evaluatedStages: PhaseNumber[]
    availableStageWeight: number
    reportPath?: string
  } | null
  stages: Array<{
    number: PhaseNumber
    status: StageStatus
    attempts?: number
    artifactDigest?: string
    evaluation?: StageEvaluation
  }>
}

// The gallery renders src/data/runs.json, a generated projection of every
// runs/<id>/run.json (see bench/lib/run/store.mjs registryEntry). Legacy runs
// — anything recorded before run schemaVersion 4 — are frozen: they keep
// their scores, previews, and static HTML reports but are read-only.

export type PhaseNumber = 1 | 2 | 3 | 4

export type StageStatus = 'queued' | 'running' | 'complete' | 'failed'

export type Telemetry = {
  wallTimeSeconds: number | null
  totalTokens: number | null
  costUsd: number | null
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens: number | null
  toolCalls: number | null
}

export type StageEntry = {
  number: PhaseNumber
  status: StageStatus
  score: number | null
  reportPath: string | null
}

// The raw projection as it sits in src/data/runs.json. Optional/legacy fields
// may be absent or null; the gallery normalizes this into a RunEntry at load
// time (see normalizeRunEntry) so the render path never re-checks them.
export type RawRunEntry = {
  id: string
  model: string
  title?: string | null
  variant?: string | null
  target?: string | null
  targetPhase?: number | null
  harness?: string | null
  protocolVersion?: string | null
  /** The rubric that produced `score`. Scores from different rubrics are not comparable. */
  rubricVersion?: string | null
  legacy: boolean
  status: 'in-progress' | 'complete' | 'legacy'
  startedAt: string
  updatedAt: string
  score: number | null
  reportPath?: string | null
  telemetry?: Partial<Telemetry> | null
  previewPath?: string | null
  previewStage?: PhaseNumber | null
  previews?: Partial<Record<`${PhaseNumber}`, string>> | null
  stages?: Array<Partial<StageEntry> & { number: PhaseNumber }> | null
}

// The normalized entry the gallery renders. Every field the render path reads
// is guaranteed present, so components can drop defensive optional chaining.
export type RunEntry = {
  id: string
  model: string
  title: string
  variant: string | null
  target: string
  targetPhase: number | null
  harness: string | null
  protocolVersion: string | null
  /** The rubric that produced `score`. Scores from different rubrics are not comparable. */
  rubricVersion: string | null
  legacy: boolean
  status: 'in-progress' | 'complete' | 'legacy'
  startedAt: string
  updatedAt: string
  score: number | null
  reportPath: string | null
  telemetry: Telemetry | null
  previewPath: string | null
  previewStage: PhaseNumber | null
  previews: Partial<Record<`${PhaseNumber}`, string>>
  stages: StageEntry[]
}

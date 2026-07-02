// The gallery renders src/data/runs.json, a generated projection of every
// runs/<id>/run.json (see bench/lib/run/store.mjs registryEntry). Legacy runs
// — anything recorded before run schemaVersion 4 — are frozen: they keep
// their scores, previews, and static HTML reports but are read-only.

export type PhaseNumber = 1 | 2 | 3 | 4

export type StageStatus = 'queued' | 'running' | 'complete' | 'failed'

export type RunEntry = {
  id: string
  model: string
  title?: string | null
  variant?: string | null
  target?: string | null
  targetPhase?: number | null
  protocolVersion?: string | null
  legacy: boolean
  status: 'in-progress' | 'complete' | 'legacy'
  startedAt: string
  updatedAt: string
  score: number | null
  reportPath: string | null
  telemetry: {
    wallTimeSeconds: number | null
    costUsd: number | null
    inputTokens: number | null
    outputTokens: number | null
    reasoningTokens: number | null
    toolCalls: number | null
  } | null
  previewPath?: string | null
  previewStage?: PhaseNumber | null
  previews?: Partial<Record<`${PhaseNumber}`, string>> | null
  stages: Array<{
    number: PhaseNumber
    status: StageStatus
    score: number | null
    reportPath: string | null
  }>
}

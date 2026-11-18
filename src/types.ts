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

// Which phases recorded each token field. A run-level sum is full-run usage
// only when the field's list covers every phase (or the run has a total and
// no phase split). See src/token-coverage.mjs.
export type TokenCoverage = {
  phaseCount: number
  totalTokens: number[]
  inputTokens: number[]
  outputTokens: number[]
  reasoningTokens: number[]
}

// How a candidate was contained while it built a phase. `lockdown`: a container
// with none of the operator's filesystem and no network but its own model API.
// `none`: no enforced isolation (every run before protocol 3). A run sums its
// sealed phases into one mode, `mixed` when they disagree.
export type StageIsolation = 'lockdown' | 'none'
export type IsolationMode = StageIsolation | 'mixed'

// What a reader should know before comparing a run's score with another's.
// Some are derived from the record (operator patch, phases sealed outside the
// lockdown), the rest attached by the operator; see runFootnotes in
// bench/lib/run/store.mjs.
export type RawFootnote = {
  kind?: string | null
  text: string
  phases?: number[] | null
  at?: string | null
}

export type Footnote = {
  kind: string
  text: string
  phases: number[]
  at: string | null
}

// Set on an operator-patched fork: the run it was copied from and the first
// phase the operator changed. A fork is not the model's own sealed output.
export type DerivedFrom = {
  run: string
  fromPhase: number
}

// Token usage as the lockdown gateway logged it (never typed by an operator),
// priced with the pinned table in bench/prices.json as of `pricesAsOf`.
export type GatewayUsage = {
  source: 'gateway'
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number | null
  costUsd: number | null
  pricesAsOf: string | null
}

export type RunUsage = GatewayUsage & {
  /** Phases the figures cover; `complete` when that is every sealed phase. */
  phases: number[]
  complete: boolean
}

// An official phase's fixed budget and what it used.
export type StageBudget = {
  status: 'within' | 'stopped' | 'exceeded' | 'unbudgeted'
  stoppedBy: 'wall-clock' | 'tokens' | null
  agentMinutes: number | null
  outputTokens: number | null
  limits: { effort: string | null; agentMinutes: number | null; outputTokens: number | null } | null
}

// The harness's own audio measurement of the sealed build (rubric 3).
export type StageAudio = {
  status: 'measured' | 'failed'
  failure: string | null
  scores: Record<string, number | null> | null
}

export type StageEntry = {
  number: PhaseNumber
  status: StageStatus
  score: number | null
  reportPath: string | null
  /** Recorded when the phase is sealed; null before that and on legacy records. */
  isolation: StageIsolation | null
  /** 'failed': sealed as it stood after its seal-failure rounds or budget ran out. */
  sealOutcome: 'passed' | 'failed' | null
  sealFailureRelays: number | null
  sealFailureLimit: number | null
  budget: StageBudget | null
  usage: GatewayUsage | null
  audio: StageAudio | null
  grader: { pinned: string | null; served: string[]; drift: boolean } | null
  official: boolean
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
  /** The protocol the run was BUILT under: its conditions, not its scoring. */
  protocolVersion?: string | null
  isolation?: IsolationMode | null
  footnotes?: RawFootnote[] | null
  derivedFrom?: DerivedFrom | null
  /** The rubric that produced `score`. Scores from different rubrics are not comparable. */
  rubricVersion?: string | null
  legacy: boolean
  status: 'in-progress' | 'complete' | 'legacy'
  startedAt: string
  updatedAt: string
  score: number | null
  /** Run-level panel-fidelity axis (protocol 2.0+). Null on legacy/v1 records. */
  panelVisuals?: number | null
  reportPath?: string | null
  telemetry?: Partial<Telemetry> | null
  tokenCoverage?: TokenCoverage | null
  previewPath?: string | null
  previewStage?: PhaseNumber | null
  previews?: Partial<Record<`${PhaseNumber}`, string>> | null
  usage?: RunUsage | null
  official?: boolean | null
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
  /** The protocol the run was BUILT under: its conditions, not its scoring. */
  protocolVersion: string | null
  isolation: IsolationMode
  footnotes: Footnote[]
  derivedFrom: DerivedFrom | null
  /** The rubric that produced `score`. Scores from different rubrics are not comparable. */
  rubricVersion: string | null
  legacy: boolean
  status: 'in-progress' | 'complete' | 'legacy'
  startedAt: string
  updatedAt: string
  score: number | null
  /** Run-level panel-fidelity axis (protocol 2.0+). Null on legacy/v1 records. */
  panelVisuals: number | null
  reportPath: string | null
  telemetry: Telemetry | null
  tokenCoverage: TokenCoverage | null
  previewPath: string | null
  previewStage: PhaseNumber | null
  previews: Partial<Record<`${PhaseNumber}`, string>>
  /** Gateway-derived tokens and cost; null when only operator-typed figures exist. */
  usage: RunUsage | null
  /** Every sealed phase is an official protocol-3 result. */
  official: boolean
  stages: StageEntry[]
}

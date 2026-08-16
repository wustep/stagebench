// Shared run data and presentation helpers for the gallery. The run list, the
// toy keyboard's benchmark readouts, and the preview dialogs all read from
// here, so the derived leaderboard data is computed exactly once at module
// load (it is a pure function of the generated runs.json) rather than on every
// render.
import runsData from './data/runs.json'
import protocol from './data/protocol.json'
import type { PhaseNumber } from './run-utils'
import type { RawRunEntry, RunEntry, Telemetry } from './types'
import { TELEMETRY_FIELDS } from './telemetry-fields.mjs'

export { protocol }

// Project a raw runs.json entry into a complete RunEntry so the render path can
// assume every field is present. Legacy-schema runs that omitted optional
// fields get honest defaults (null telemetry, empty previews) rather than
// scattered optional chaining downstream.
function normalizeRunEntry(raw: RawRunEntry): RunEntry {
  const telemetry: Telemetry | null = raw.telemetry
    ? Object.fromEntries(TELEMETRY_FIELDS.map((field) => [field, raw.telemetry?.[field] ?? null])) as Telemetry
    : null
  return {
    id: raw.id,
    model: raw.model,
    title: raw.title ?? raw.model,
    variant: raw.variant ?? null,
    target: raw.target ?? 'Stage 4 73',
    targetPhase: raw.targetPhase ?? null,
    harness: raw.harness ?? null,
    protocolVersion: raw.protocolVersion ?? null,
    rubricVersion: raw.rubricVersion ?? null,
    legacy: raw.legacy,
    status: raw.status,
    startedAt: raw.startedAt,
    updatedAt: raw.updatedAt,
    score: raw.score ?? null,
    reportPath: raw.reportPath ?? null,
    telemetry,
    previewPath: raw.previewPath ?? null,
    previewStage: raw.previewStage ?? null,
    previews: raw.previews ?? {},
    stages: (raw.stages ?? []).map((stage) => ({
      number: stage.number,
      status: stage.status ?? 'queued',
      score: stage.score ?? null,
      reportPath: stage.reportPath ?? null,
    })),
  }
}

// The secret cookie still unlocks private artifacts, but benchmark runs are
// always public in the gallery.
export const artifactsUnlocked =
  typeof document !== 'undefined' &&
  document.cookie.split(';').some((entry) => entry.trim().startsWith('stagebench_extras='))

export const runs = (runsData as RawRunEntry[]).map(normalizeRunEntry)

// Phase display names come from the phase manifest via src/data/protocol.json
// (generated at reindex time); legacy/v2 mappings live there too because the
// current spec has no data for those retired protocol layouts.
export const phaseNames = protocol.phaseNames
const v2PhaseNames = protocol.v2PhaseNames
const legacyPhaseNames = protocol.legacyPhaseNames

// One shared formatter: Intl.DateTimeFormat construction is far more expensive
// than formatting, and formatDate runs once (or more) per run row per render.
const dateFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

export function formatDate(value: string) {
  return dateFormat.format(new Date(value))
}

export function formatTokens(value: number) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`
  return String(value)
}

export function formatDuration(value: number) {
  const totalSeconds = Math.round(value)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`
}

// Ultra-compact wall time for the leaderboard's TIME column ("4h27m",
// "20m29s"); the expanded details pane shows the full formatDuration string.
export function formatDurationCompact(value: number) {
  const totalSeconds = Math.round(value)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours > 0) return `${hours}h${minutes}m`
  if (minutes > 0) return `${minutes}m${totalSeconds % 60}s`
  return `${totalSeconds}s`
}

// CSS modifier slug for a harness pill ("Claude Code" -> "claude-code").
export function harnessSlug(harness: string) {
  return harness.toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

// The full phase list for the protocol a run was recorded under. Rendering
// every protocol phase (not just the recorded stages) keeps the phase columns
// vertically aligned across rows, so scores can be compared at a glance.
export function getPhaseList(run: RunEntry) {
  if (!run.legacy || String(run.protocolVersion ?? '').startsWith('3.')) return phaseNames
  if (run.stages.length === 4) return v2PhaseNames
  return legacyPhaseNames
}

export function getPhaseName(run: RunEntry, phase: PhaseNumber) {
  return getPhaseList(run)[phase - 1]
}

// Runs are tiered by the rubric that produced their score, because scores from
// different rubrics are not comparable — different weights, different criteria,
// and (before the model was pinned) different judges. Ranking them in one list
// would put a 93.8 scored under an older rubric above a 91 scored under the
// current one and imply a result neither number supports.
export function getResultClass(run: RunEntry) {
  if (run.legacy) return { id: 'legacy', label: 'Legacy', rank: 2, description: 'Runs recorded under earlier protocol versions, kept for reference with their frozen evaluation reports.' }
  const scoredUnder = run.rubricVersion ?? null
  if (scoredUnder && scoredUnder !== protocol.version) {
    return {
      id: `rubric-${scoredUnder}`,
      label: `Rubric ${scoredUnder}`,
      rank: 1,
      description: `Scored under rubric ${scoredUnder}, before the current rubric changed the weights, the criteria, and the evaluator. Not comparable with Protocol ${protocol.version} scores — ranked separately rather than merged into one leaderboard.`,
    }
  }
  return { id: 'current', label: `Protocol ${protocol.version}`, rank: 0, description: 'Benchmark evaluation reports are not rigorous and are just for fun.' }
}

// Leaderboard ordering and per-tier rankings are pure functions of the
// module-constant `runs`, so they're computed once at module load rather than
// on every render. This keeps the toy keyboard's high-frequency note/bend
// updates from re-sorting and re-ranking the whole field.
//
// Within each result tier, rank by aggregate score (highest first) so the
// gallery's job — comparing model results — is legible at a glance. Runs still
// in progress have no score yet, so they sink below the scored runs of their
// tier; newest-first breaks any remaining ties.
// Tier id breaks ties within a rank so tiers stay contiguous: several older
// rubrics share rank 1, and sorting them by score alone would interleave them
// back into the single mixed leaderboard the tiers exist to prevent.
export const visibleRuns = [...runs]
  .sort((left, right) =>
    getResultClass(left).rank - getResultClass(right).rank
    || getResultClass(right).id.localeCompare(getResultClass(left).id)
    || (right.score ?? -1) - (left.score ?? -1)
    || right.startedAt.localeCompare(left.startedAt))
export const activeCount = visibleRuns.filter((run) => run.status === 'in-progress').length
export const runningModel = runs.find((run) => run.status === 'in-progress')?.model

// Position among the scored runs of each tier, so "#1" always names the top
// score of its protocol group. Unscored (in-progress) runs get no rank.
function buildRankByRun(orderedRuns: RunEntry[]) {
  const ranks = new Map<string, number>()
  const tierRankCounter = new Map<string, number>()
  for (const run of orderedRuns) {
    if (run.score === null) continue
    const tierId = getResultClass(run).id
    const next = (tierRankCounter.get(tierId) ?? 0) + 1
    tierRankCounter.set(tierId, next)
    ranks.set(run.id, next)
  }
  return ranks
}

// The field's best score per phase within each tier — the timing-tower
// "fastest split" highlight, so per-phase winners read independently of the
// aggregate ranking.
function buildBestByTierPhase(orderedRuns: RunEntry[]) {
  const best = new Map<string, number>()
  for (const run of orderedRuns) {
    const tierId = getResultClass(run).id
    for (const stage of run.stages) {
      if (stage.score === null) continue
      const key = `${tierId}:${stage.number}`
      best.set(key, Math.max(best.get(key) ?? -1, stage.score))
    }
  }
  return best
}

export const rankByRun = buildRankByRun(visibleRuns)
export const bestByTierPhase = buildBestByTierPhase(visibleRuns)

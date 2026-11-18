// Shared run data and presentation helpers for the gallery. The run list, the
// toy keyboard's benchmark readouts, and the preview dialogs all read from
// here, so the derived leaderboard data is computed exactly once at module
// load (it is a pure function of the generated runs.json) rather than on every
// render.
//
// The JSON imports carry import attributes so the node:test suite can load
// this module as-is (Node strips the types and requires the attribute); Vite
// treats them exactly like a bare JSON import.
import runsData from './data/runs.json' with { type: 'json' }
import protocol from './data/protocol.json' with { type: 'json' }
import type { PhaseNumber } from './run-utils'
import type { IsolationMode, RawRunEntry, RunEntry, Telemetry } from './types'
import { TELEMETRY_FIELDS } from './telemetry-fields.mjs'

export { protocol }

// Project a raw runs.json entry into a complete RunEntry so the render path can
// assume every field is present. Legacy-schema runs that omitted optional
// fields get honest defaults (null telemetry, empty previews, no isolation, no
// footnotes) rather than scattered optional chaining downstream.
export function normalizeRunEntry(raw: RawRunEntry): RunEntry {
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
    // Anything that is not a recorded lockdown counts as no isolation: the
    // default must never claim more containment than the record shows.
    isolation: raw.isolation === 'lockdown' || raw.isolation === 'mixed' ? raw.isolation : 'none',
    footnotes: (raw.footnotes ?? []).map((note) => ({
      kind: note.kind ?? 'note',
      text: note.text,
      phases: note.phases ?? [],
      at: note.at ?? null,
    })),
    derivedFrom: raw.derivedFrom ? { run: raw.derivedFrom.run, fromPhase: raw.derivedFrom.fromPhase } : null,
    rubricVersion: raw.rubricVersion ?? null,
    legacy: raw.legacy,
    status: raw.status,
    startedAt: raw.startedAt,
    updatedAt: raw.updatedAt,
    score: raw.score ?? null,
    panelVisuals: typeof raw.panelVisuals === 'number' ? raw.panelVisuals : null,
    reportPath: raw.reportPath ?? null,
    telemetry,
    tokenCoverage: raw.tokenCoverage ?? null,
    previewPath: raw.previewPath ?? null,
    previewStage: raw.previewStage ?? null,
    previews: raw.previews ?? {},
    usage: raw.usage ?? null,
    official: raw.official === true,
    stages: (raw.stages ?? []).map((stage) => ({
      number: stage.number,
      status: stage.status ?? 'queued',
      score: stage.score ?? null,
      reportPath: stage.reportPath ?? null,
      isolation: stage.isolation ?? null,
      sealOutcome: stage.sealOutcome ?? null,
      sealFailureRelays: stage.sealFailureRelays ?? null,
      sealFailureLimit: stage.sealFailureLimit ?? null,
      budget: stage.budget ?? null,
      usage: stage.usage ?? null,
      audio: stage.audio ?? null,
      grader: stage.grader ?? null,
      official: stage.official === true,
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

// --- protocol versions --------------------------------------------------------

// The fields of src/data/protocol.json the tiering reads. `version` is the
// current protocol (the conditions candidates work under), `rubricVersion` the
// current rubric (what makes two scores comparable), and `protocolNotes` one
// sentence per protocol generation, keyed by major version.
export type ProtocolInfo = {
  version: string
  rubricVersion: string
  protocolNotes: Record<string, string>
}

const protocolInfo: ProtocolInfo = protocol

// "3.0.0" -> { major: 3, minor: 0 }. Null when the string does not start with
// a number, so callers show nothing rather than a guess.
function parseVersion(version: string | null) {
  const match = /^(\d+)(?:\.(\d+))?/.exec((version ?? '').trim())
  if (!match) return null
  return { major: Number(match[1]), minor: match[2] === undefined ? null : Number(match[2]) }
}

// "3.0.0" -> "3.0": the form the gallery prints.
export function shortVersion(version: string | null) {
  const parsed = parseVersion(version)
  if (!parsed) return null
  return parsed.minor === null ? String(parsed.major) : `${parsed.major}.${parsed.minor}`
}

// A protocol generation is a major version: one set of conditions candidates
// worked under (see protocolNotes).
export function protocolGeneration(version: string | null) {
  return parseVersion(version)?.major ?? null
}

// What to call each generation in a heading, from the versions actually on
// record: "2.0" when every run of the generation agrees, "1.x" when the
// generation spans several minors (1.0 and 1.1 share a tier).
export function buildGenerationLabels(versions: Iterable<string | null>) {
  const seen = new Map<number, Set<string>>()
  for (const version of versions) {
    const generation = protocolGeneration(version)
    const short = shortVersion(version)
    if (generation === null || short === null) continue
    seen.set(generation, (seen.get(generation) ?? new Set<string>()).add(short))
  }
  return new Map([...seen].map(([generation, shorts]) => [generation, shorts.size === 1 ? [...shorts][0] : `${generation}.x`]))
}

// --- result tiers -------------------------------------------------------------

export type ResultClass = { id: string; label: string; rank: number; description: string }

// Tier order, top to bottom. Just below RANK_CURRENT sits one board for every
// run built before the current protocol generation and scored under the
// current rubric.
const RANK_CURRENT = 0
const RANK_EARLIER = 1
const RANK_UNVERSIONED = 97
const RANK_OLDER_RUBRIC = 98
const RANK_LEGACY = 99

// Two things have to match before two scores belong in one ranked list.
//
// The RUBRIC that produced them: different weights, different criteria, and
// (before the evaluator was pinned) different judges. One list would put a
// 93.8 scored under rubric 1.1 above a 91 scored under 2.0 and imply a result
// neither number supports. A run is tiered by the rubric it was scored under,
// which is not always the one current when it was built — rescoring moves it.
//
// The CONDITIONS it was built under, which is what a protocol generation is.
// Protocol 3 kept the rubric and changed the conditions (the lockdown), so a
// run built before it is scored the same way but did not do the same job: it
// is ranked on a board below the current one.
//
// That board is ONE board, however many earlier generations it holds. The
// runs built under protocols 1 and 2 were already ranked together (one rubric
// scored them all), and a new protocol is no reason to split a ranking that
// existed before it. Each row says which protocol it was built under.
export function classifyResult(
  run: Pick<RunEntry, 'legacy' | 'rubricVersion' | 'protocolVersion'>,
  info: ProtocolInfo,
  generationLabels: ReadonlyMap<number, string>,
): ResultClass {
  if (run.legacy) return { id: 'legacy', label: 'Legacy', rank: RANK_LEGACY, description: 'Runs recorded before the current run schema, under earlier prompts, specs, or scoring. Kept for reference with their frozen scores and reports.' }
  const scoredUnder = run.rubricVersion
  if (scoredUnder && scoredUnder !== info.rubricVersion) {
    // Named for the RUBRIC: one board can hold runs built under several
    // protocols (each row says which), all scored the same way.
    return {
      id: `protocol-${scoredUnder}`,
      label: `Rubric ${scoredUnder}`,
      rank: RANK_OLDER_RUBRIC,
      description: `Scored under rubric ${scoredUnder}, before rubric ${shortVersion(info.rubricVersion) ?? info.rubricVersion} changed the weights, the criteria, and how they are scored. Ranked separately rather than merged into one leaderboard; each row says which protocol it was built under.`,
    }
  }
  const labelOf = (generation: number) => generationLabels.get(generation) ?? `${generation}.x`
  const currentGeneration = protocolGeneration(info.version)
  const currentLabel = `Protocol ${currentGeneration === null ? info.version : labelOf(currentGeneration)}`
  const generation = protocolGeneration(run.protocolVersion)
  if (generation === null) {
    return { id: 'protocol-unversioned', label: 'Unversioned', rank: RANK_UNVERSIONED, description: `No protocol version on record, so the conditions these runs were built under are unknown. Ranked separately from ${currentLabel}.` }
  }
  if (currentGeneration === null || generation >= currentGeneration) {
    return { id: 'current', label: currentLabel, rank: RANK_CURRENT, description: info.protocolNotes[String(currentGeneration)] ?? '' }
  }
  const earlier = [...generationLabels.keys()].filter((known) => known < currentGeneration).sort((left, right) => right - left)
  const newest = earlier[0] ?? generation
  return {
    id: `before-protocol-${currentGeneration}`,
    label: `Protocol ${labelOf(newest)}${earlier.length > 1 ? ' and earlier' : ''}`,
    rank: RANK_EARLIER,
    description: `Built before ${currentLabel} and scored with the same rubric. Ranked separately because the conditions differ; each run's details say what its protocol guaranteed.`,
  }
}

// Legacy records are left out: their versions come from a retired numbering
// (an earlier "2.0" and "3.x") that would otherwise read as today's protocols.
const generationLabels = buildGenerationLabels([
  protocolInfo.version,
  ...runs.filter((run) => !run.legacy).map((run) => run.protocolVersion),
])

export function getResultClass(run: RunEntry) {
  return classifyResult(run, protocolInfo, generationLabels)
}

// The top tier exists whether or not a run has reached it yet, so the page can
// always name the current protocol above the boards ranked separately from it.
export const currentResultClass = classifyResult({ legacy: false, rubricVersion: null, protocolVersion: protocolInfo.version }, protocolInfo, generationLabels)

// --- per-run conditions -------------------------------------------------------

// "P2.0": the protocol a run was built under, for the row's meta line. Legacy
// records get no label, for the same reason they get no generation.
export function getProtocolLabel(run: RunEntry) {
  const short = run.legacy ? null : shortVersion(run.protocolVersion)
  return short === null ? null : `P${short}`
}

// The one-sentence conditions note of the generation a run was built under.
export function getProtocolNote(run: RunEntry) {
  const generation = run.legacy ? null : protocolGeneration(run.protocolVersion)
  return generation === null ? null : protocolInfo.protocolNotes[String(generation)] ?? null
}

const ISOLATION: Record<IsolationMode, { label: string; meaning: string }> = {
  lockdown: { label: 'Lockdown', meaning: "Built in a container with none of the operator's filesystem and no internet, only its own model API." },
  none: { label: 'No isolation', meaning: 'Nothing was enforced: the candidate could read whatever its harness allowed.' },
  mixed: { label: 'Mixed', meaning: 'Some phases were sealed outside the lockdown.' },
}

// The first protocol generation that requires the lockdown; mirrors
// isStrictProtocol in bench/lib/shared.mjs. Before it, "no isolation" is simply
// how the protocol worked. From it on, anything but a lockdown is off-protocol.
const LOCKDOWN_REQUIRED_FROM = 3

export function getIsolation(run: RunEntry) {
  const generation = run.legacy ? null : protocolGeneration(run.protocolVersion)
  const offProtocol = generation !== null && generation >= LOCKDOWN_REQUIRED_FROM && run.isolation !== 'lockdown'
  const { label, meaning } = ISOLATION[run.isolation]
  return {
    mode: run.isolation,
    label,
    offProtocol,
    meaning: offProtocol ? `${meaning} Off-protocol: protocol ${shortVersion(run.protocolVersion)} requires the lockdown.` : meaning,
  }
}

// Official lockdowns are the protocol 3 default, and "no isolation" is how
// every protocol before that worked, so the gallery does not badge either.
// A mixed seal or an off-protocol miss still shows: those change how a row
// should be read.
export function showsIsolationBadge(isolation: { mode: IsolationMode; offProtocol: boolean }) {
  return isolation.offProtocol || isolation.mode === 'mixed'
}

// Leaderboard ordering and ranks are pure functions of the module-constant
// `runs`, so they're computed once at module load rather than on every render.
// This keeps the toy keyboard's high-frequency note/bend updates from
// re-sorting and re-ranking the whole field.
//
// Every run shares one ranked list, whatever protocol or rubric produced the
// score. Protocol version stays on the row and in the drawer. Rank by
// aggregate score (highest first); runs still in progress have no score yet,
// so they sink below the scored runs; newest-first breaks any remaining ties.
export const visibleRuns = [...runs]
  .sort((left, right) =>
    (right.score ?? -1) - (left.score ?? -1)
    || right.startedAt.localeCompare(left.startedAt))
export const activeCount = visibleRuns.filter((run) => run.status === 'in-progress').length
export const runningModel = runs.find((run) => run.status === 'in-progress')?.model

// Position among every scored run. Unscored (in-progress) runs get no rank.
function buildRankByRun(orderedRuns: RunEntry[]) {
  const ranks = new Map<string, number>()
  let next = 0
  for (const run of orderedRuns) {
    if (run.score === null) continue
    next += 1
    ranks.set(run.id, next)
  }
  return ranks
}

// The field's best score per phase — the timing-tower "fastest split"
// highlight, so per-phase winners read independently of the aggregate ranking.
function buildBestByPhase(orderedRuns: RunEntry[]) {
  const best = new Map<number, number>()
  for (const run of orderedRuns) {
    for (const stage of run.stages) {
      if (stage.score === null) continue
      best.set(stage.number, Math.max(best.get(stage.number) ?? -1, stage.score))
    }
  }
  return best
}

export const rankByRun = buildRankByRun(visibleRuns)
export const bestByPhase = buildBestByPhase(visibleRuns)

// Best run-level panel score on the board, so the Panel Visuals cell can
// light up the same way a phase sector does for the field's fastest split.
function buildBestPanel(orderedRuns: RunEntry[]) {
  let best = -1
  for (const run of orderedRuns) {
    if (run.panelVisuals === null) continue
    best = Math.max(best, run.panelVisuals)
  }
  return best
}

export const bestPanel = buildBestPanel(visibleRuns)

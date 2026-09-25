// How much of a run's token telemetry actually covers every phase.
//
// Run totals sum whichever phases recorded a field, so a number can be real
// and still not be full-run usage (Phase 3 only, or Phases 1–2 with Phase 3
// blank). The gallery uses this to avoid presenting that sum as the Tokens
// column. totalTokens means input + output; reasoning is a separate count
// and is not added in. A run-level total with no phase split is kept as
// recorded — phase numbers are never invented to fill it.

export const TOKEN_COVERAGE_FIELDS = ['totalTokens', 'inputTokens', 'outputTokens', 'reasoningTokens']

export function tokenCoverageFromStages(stages) {
  const list = Array.isArray(stages) ? stages : []
  const coverage = { phaseCount: list.length }
  for (const field of TOKEN_COVERAGE_FIELDS) {
    coverage[field] = []
    for (const stage of list) {
      if (typeof stage?.telemetry?.[field] === 'number') coverage[field].push(stage.number)
    }
  }
  return coverage
}

function coversEveryPhase(phases, phaseCount) {
  return phaseCount > 0 && Array.isArray(phases) && phases.length === phaseCount
}

function joinPhases(phases) {
  if (phases.length <= 1) return String(phases[0] ?? '')
  if (phases.length === 2) return `${phases[0]} and ${phases[1]}`
  return `${phases.slice(0, -1).join(', ')}, and ${phases[phases.length - 1]}`
}

// Null when the field is absent or recorded on every phase. A phrase when
// only some phases recorded it: "phase 3 of 3", "phases 1 and 2 of 3".
export function partialPhaseLabel(phases, phaseCount) {
  if (!Array.isArray(phases) || phaseCount <= 0) return null
  if (phases.length === 0 || phases.length === phaseCount) return null
  const noun = phases.length === 1 ? 'phase' : 'phases'
  return `${noun} ${joinPhases(phases)} of ${phaseCount}`
}

// Leaderboard Tokens cell.
// - total: safe to show as full-run usage
// - partial: some phases recorded tokens; the sum is not the run total
// - unknown: nothing that can be shown without calling input "total"
export function tokenHeadline(telemetry, coverage) {
  if (!telemetry) return { kind: 'unknown' }
  if (!coverage) {
    return typeof telemetry.totalTokens === 'number'
      ? { kind: 'total', value: telemetry.totalTokens }
      : { kind: 'unknown' }
  }

  const phaseCount = coverage.phaseCount ?? 0
  const totalPhases = coverage.totalTokens ?? []
  const inputPhases = coverage.inputTokens ?? []
  const outputPhases = coverage.outputTokens ?? []
  const totalComplete = coversEveryPhase(totalPhases, phaseCount)
  const inoutComplete = coversEveryPhase(inputPhases, phaseCount) && coversEveryPhase(outputPhases, phaseCount)

  // A stored total is full-run usage when every phase recorded one, or when
  // the run has a single total and no phase split at all (nothing to sum).
  if (typeof telemetry.totalTokens === 'number' && (totalComplete || totalPhases.length === 0)) {
    return { kind: 'total', value: telemetry.totalTokens }
  }
  // Same definition the JSONL parser and the GPT runs use: in + out, with
  // reasoning kept separate. Only when every phase recorded both, so a
  // partial rollup cannot masquerade as the run total.
  if (inoutComplete && typeof telemetry.inputTokens === 'number' && typeof telemetry.outputTokens === 'number') {
    return { kind: 'total', value: telemetry.inputTokens + telemetry.outputTokens }
  }

  const recorded = new Set()
  for (const field of TOKEN_COVERAGE_FIELDS) {
    const phases = coverage[field] ?? []
    if (phases.length > 0 && phases.length < phaseCount) {
      for (const phase of phases) recorded.add(phase)
    }
  }
  if (recorded.size > 0) {
    const phases = [...recorded].sort((left, right) => left - right)
    return { kind: 'partial', phases, phaseCount, label: partialPhaseLabel(phases, phaseCount) }
  }
  return { kind: 'unknown' }
}

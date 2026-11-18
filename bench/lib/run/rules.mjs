// The fixed rules of an official run: how many times a seal failure may be
// relayed to the agent, and the budget a phase runs under.
//
// They live in the protocol manifest (specs/benchmark-phases.json,
// `officialRules`) and are copied into a run when it is created, so a run is
// held to the rules it started under, never to a later edit. A run created
// before they existed carries none and is held to none.
import { isStrictProtocol } from '../shared.mjs'
import { primaryModel } from '../usage.mjs'

export function rulesFromManifest(manifest) {
  const rules = manifest?.officialRules
  if (!rules) return null
  return {
    sealFailureRounds: Number(rules.sealFailureRounds?.limit ?? rules.sealFailureRounds),
    budget: {
      effort: rules.budget?.effort ?? null,
      agentMinutes: Number(rules.budget?.agentMinutes ?? 0) || null,
      outputTokens: Number(rules.budget?.outputTokens ?? 0) || null,
    },
  }
}

// The rules a run is held to: its own copy, for a protocol-3 run in the lockdown.
export function runRules(run) {
  if (!isStrictProtocol(run) || run.isolation !== 'lockdown') return null
  return run.protocol?.rules ?? null
}

const seconds = (launch) => {
  const start = Date.parse(launch.startedAt)
  const end = Date.parse(launch.endedAt)
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 1000) : 0
}

// Time the agent has run in this phase: its launches, summed. Time between
// launches (the operator reading a log, a seal running) is not the agent's.
export function agentSeconds(launches = []) {
  return Math.round(launches.reduce((total, launch) => total + seconds(launch), 0))
}

// How many seal failures have been relayed to the agent in this phase.
export function sealFailureRelays(launches = []) {
  return launches.filter((launch) => launch.message?.template === 'seal-failure').length
}

// May another seal failure be relayed? Null if so; otherwise why not. The
// first seal attempt is not a round: a round is one relay of a failure.
export function sealFailureRoundRefusal(rules, launches = [], id = '<run>') {
  if (!rules) return null
  const used = sealFailureRelays(launches)
  if (used < rules.sealFailureRounds) return null
  return `This phase has had its ${rules.sealFailureRounds} seal-failure round${rules.sealFailureRounds === 1 ? '' : 's'} (the protocol's limit for an official run); no further seal failure is relayed. Seal it as it stands: pnpm bench seal ${id} (a seal that fails now seals the phase as failed).`
}

// What the next launch may use. Throws when nothing is left: the phase is then
// sealed as it stands.
export function nextLaunchAllowance(rules, { launches = [], outputTokensSpent = 0, requestedMinutes = null, requestedEffort = null }) {
  const budget = rules?.budget
  if (!budget) return { budgeted: false, timeoutMs: requestedMinutes ? requestedMinutes * 60_000 : undefined, effort: requestedEffort, offProtocol: [] }
  const usedSeconds = agentSeconds(launches)
  const leftSeconds = budget.agentMinutes ? budget.agentMinutes * 60 - usedSeconds : Infinity
  const leftTokens = budget.outputTokens ? budget.outputTokens - outputTokensSpent : Infinity
  if (leftSeconds <= 0) throw new BudgetSpent('wall-clock', `the phase has used its ${budget.agentMinutes} minutes of agent time (${Math.round(usedSeconds / 60)} min)`)
  if (leftTokens <= 0) throw new BudgetSpent('tokens', `the phase has used its ${budget.outputTokens.toLocaleString('en-US')} generated tokens (${outputTokensSpent.toLocaleString('en-US')})`)
  const offProtocol = []
  // The effort is part of the budget: an operator who asks for another one is
  // running a different experiment, and the phase is marked for it.
  const effort = requestedEffort ?? budget.effort
  if (budget.effort && effort !== budget.effort) offProtocol.push(`effort ${effort} instead of the pinned ${budget.effort}`)
  const capMs = Number.isFinite(leftSeconds) ? Math.ceil(leftSeconds * 1000) : undefined
  const asked = requestedMinutes ? requestedMinutes * 60_000 : undefined
  return {
    budgeted: true,
    timeoutMs: capMs === undefined ? asked : asked === undefined ? capMs : Math.min(asked, capMs),
    // True when the budget, not the operator, set this launch's timeout.
    timeoutIsBudget: capMs !== undefined && (asked === undefined || capMs <= asked),
    outputTokensLeft: Number.isFinite(leftTokens) ? leftTokens : null,
    effort,
    offProtocol,
  }
}

export class BudgetSpent extends Error {
  constructor(kind, detail) {
    super(`The budget for this phase is spent: ${detail}. No further launch is allowed; seal the phase as it stands.`)
    this.kind = kind
  }
}

// The budget record a seal writes: the rules, what was used, and whether the
// phase stayed inside them.
//   within    finished inside the budget
//   stopped   the budget stopped it (a launch hit the time cap, or the gateway
//             refused a turn for tokens); sealed as it stood, still official
//   exceeded  used more than the budget allows without being stopped (an
//             operator override, or a record that does not add up); not official
export function budgetRecord(rules, { launches = [], usage = null }) {
  const budget = rules?.budget ?? null
  const used = { agentSeconds: agentSeconds(launches), outputTokens: usage?.outputTokens ?? null }
  if (!budget) return { rules: null, used, status: 'unbudgeted', stoppedBy: null }
  const stoppedBy = launches.some((launch) => launch.stoppedBy === 'tokens') || (usage?.budget?.denied ?? 0) > 0
    ? 'tokens'
    : launches.some((launch) => launch.stoppedBy === 'wall-clock') ? 'wall-clock' : null
  const overTime = budget.agentMinutes && used.agentSeconds > budget.agentMinutes * 60 + 60
  // One response can cross the token cap before the gateway can refuse the next.
  const overTokens = budget.outputTokens && used.outputTokens !== null && used.outputTokens > budget.outputTokens + 200_000
  const efforts = launches.map((launch) => launch.effort ?? null)
  // What the gateway saw the harness ask for, on the run's own model (the one
  // most turns went to; a harness's auxiliary calls on a small model are not
  // held to it). A request that names no effort runs at the provider default
  // for that harness, and is reported, not counted as a mismatch.
  const primary = primaryModel(usage)
  const observedOff = Object.entries(usage?.efforts ?? {})
    .filter(([key]) => key.slice(0, key.lastIndexOf(':')) === primary)
    .map(([key, count]) => ({ effort: key.slice(key.lastIndexOf(':') + 1), count }))
    .filter((entry) => entry.effort !== 'unspecified' && budget.effort && entry.effort !== budget.effort)
  const effortOk = !budget.effort || (efforts.every((effort) => effort === budget.effort) && observedOff.length === 0)
  const offProtocol = [...new Set(launches.flatMap((launch) => launch.budgetOffProtocol ?? []))]
  const status = overTime || overTokens || offProtocol.length > 0 ? 'exceeded' : stoppedBy ? 'stopped' : 'within'
  return {
    rules: budget,
    used,
    status,
    stoppedBy,
    effort: { pinned: budget.effort, launches: efforts, ok: effortOk, primaryModel: primary, observed: usage?.efforts ?? null, ...(observedOff.length ? { mismatched: observedOff } : {}) },
    ...(offProtocol.length ? { offProtocol } : {}),
  }
}

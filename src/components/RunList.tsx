// The run leaderboard: one ranked list of every run, with per-phase score
// sectors, a wall-time column, and an expandable details drawer. Protocol
// version lives on the row and in the drawer, not as a split. Isolation is
// badged only for a mixed seal or an off-protocol miss, not for an official
// lockdown (the protocol 3 default).
// Memoized: all props are reference-stable, so App's dialog/viewer state
// changes (open preview, copy link, phase switch) skip re-rendering the
// largest subtree in the app.
import { Fragment, memo, useCallback, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PhaseNumber } from '../run-utils'
import { floorScore, getRunTitle, getThumbPath } from '../run-utils'
import type { RunEntry, StageEntry } from '../types'
import {
  bestByPhase,
  bestPanel,
  formatDate,
  formatDuration,
  formatDurationCompact,
  formatTokens,
  getIsolation,
  getPhaseList,
  getProtocolLabel,
  getProtocolNote,
  harnessSlug,
  rankByRun,
  showsIsolationBadge,
  visibleRuns,
} from '../runs-data'
import { ChevronIcon, InfoIcon, PlayIcon, ReportIcon, StatusLight } from './icons'

// Tallest a hover card gets (a near-square instrument crop at the card's width,
// plus its frame). A row closer than this to the top of the viewport shows its
// card below instead of above.
const THUMB_MAX_HEIGHT = 300

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

// One line per sealed phase of an official run: how its seal went, its budget,
// and the harness's audio measurement.
function stagePhaseLine(stage: StageEntry) {
  const parts: string[] = []
  parts.push(stage.sealOutcome === 'failed' ? 'sealed as failed' : 'sealed')
  if (stage.sealFailureLimit != null) parts.push(`${stage.sealFailureRelays ?? 0} of ${stage.sealFailureLimit} seal-failure rounds`)
  if (stage.budget && stage.budget.status !== 'unbudgeted') {
    const limits = stage.budget.limits
    parts.push(`${stage.budget.agentMinutes ?? '?'}${limits?.agentMinutes ? `/${limits.agentMinutes}` : ''} agent min, ${stage.budget.outputTokens != null ? formatTokens(stage.budget.outputTokens) : '?'}${limits?.outputTokens ? `/${formatTokens(limits.outputTokens)}` : ''} generated tokens${stage.budget.status === 'within' ? '' : ` (${stage.budget.status}${stage.budget.stoppedBy ? `: ${stage.budget.stoppedBy}` : ''})`}`)
  }
  if (stage.audio) {
    const scores = stage.audio.scores
    parts.push(stage.audio.status === 'measured' && scores
      ? `audio: tuning ${scores.tuningErrorCents ?? '—'}¢, velocity ${scores.velocityRangeDb ?? '—'} dB, ${scores.clicks ?? '—'} clicks, ${scores.latencyMs ?? '—'} ms`
      : `audio not measurable (${stage.audio.failure ?? 'failed'})`)
  }
  if (stage.grader?.drift) parts.push('grader drift')
  if (!stage.official) parts.push('not official')
  return `0${stage.number}: ${parts.join(' · ')}`
}

// " Sealed phases: 01 lockdown, 02 outside the lockdown." — which sealed
// phase had which mode, for a run whose phases disagree. Empty when no phase says.
function sealedIsolation(run: RunEntry) {
  const phases = run.stages
    .filter((stage) => stage.isolation !== null)
    .map((stage) => `0${stage.number} ${stage.isolation === 'lockdown' ? 'lockdown' : 'outside the lockdown'}`)
  return phases.length > 0 ? ` Sealed phases: ${phases.join(', ')}.` : ''
}

export const RunList = memo(function RunList({
  expandedRunId,
  onToggleExpand,
  onOpenPreview,
  onOpenProtocolInfo,
  onOpenReport,
}: {
  expandedRunId: string | null
  onToggleExpand: (runId: string) => void
  onOpenPreview: (run: RunEntry) => void
  onOpenProtocolInfo: () => void
  onOpenReport: (run: RunEntry) => void
}) {
  // Pointer-only affordance: the hovered row shows a cropped shot of its
  // instrument. Mounted on hover rather than up front so the leaderboard does
  // not pull ten screenshots on load; `loaded` keeps the card hidden until its
  // image has decoded, so it fades in whole instead of flashing an empty frame.
  // The card normally sits above the row; rows too near the top of the viewport
  // flip it below so it is never clipped off-screen.
  const [hovered, setHovered] = useState<{ id: string; placement: 'above' | 'below' } | null>(null)
  const [loadedThumbs, setLoadedThumbs] = useState<ReadonlySet<string>>(() => new Set())
  const markThumbLoaded = useCallback((runId: string) => {
    setLoadedThumbs((current) => (current.has(runId) ? current : new Set(current).add(runId)))
  }, [])

  if (visibleRuns.length === 0) {
    return (
      <div className="empty-state">
        <StatusLight status="queued" />
        <div><h3>No runs yet</h3><p>Run <code>pnpm bench new</code> to add the first model.</p></div>
      </div>
    )
  }

  const headerPhases = getPhaseList(visibleRuns[0])
  const headerStyle = { '--sectors': headerPhases.length } as CSSProperties

  return (
    <div className="run-list">
      <header className="result-group-heading result-group-current" style={headerStyle}>
        <span className="result-group-label">
          Runs
          <button
            aria-label="About the protocol"
            className="protocol-info-btn"
            onClick={onOpenProtocolInfo}
            type="button"
          >
            <InfoIcon />
          </button>
        </span>
      </header>
      <div aria-hidden="true" className="tower-head" style={headerStyle}>
        <span>Pos</span>
        <span>Model</span>
        <span>Harness</span>
        {headerPhases.map((name, phaseIndex) => <span key={name}>0{phaseIndex + 1} · {name}</span>)}
        <span>Panel Visuals</span>
        <span className="num">Time</span>
        <span className="num">Score</span>
        <span />
      </div>
      {visibleRuns.map((run) => {
        const phaseList = getPhaseList(run)
        const rank = rankByRun.get(run.id) ?? null
        const playable = Boolean(run.previewPath)
        const thumbPath = getThumbPath(run)
        const showThumb = playable && thumbPath !== null && hovered?.id === run.id
        const expanded = expandedRunId === run.id
        // Sector column count rides on a CSS variable so a four-phase
        // legacy run still keeps its own aligned grid.
        const sectorsStyle = { '--sectors': phaseList.length } as CSSProperties
        const panel = run.panelVisuals
        const isBestPanel = panel !== null && panel === bestPanel
        const protocolLabel = getProtocolLabel(run)
        const protocolNote = getProtocolNote(run)
        const isolation = getIsolation(run)
        const showIsolation = showsIsolationBadge(isolation)
        const footnoteCount = run.footnotes.length
        return (
        <Fragment key={run.id}>
        <article className={`run-row${rank !== null && rank <= 3 ? ` podium-${rank}` : ''}`}>
          <div
            className={`row-main${playable ? ' is-playable' : ''}`}
            onClick={playable ? () => onOpenPreview(run) : undefined}
            onMouseEnter={playable ? (event) => {
              const { top } = event.currentTarget.getBoundingClientRect()
              setHovered({ id: run.id, placement: top < THUMB_MAX_HEIGHT ? 'below' : 'above' })
            } : undefined}
            onMouseLeave={playable ? () => setHovered((current) => (current?.id === run.id ? null : current)) : undefined}
            style={sectorsStyle}
          >
            {showThumb && (
              <div
                aria-hidden="true"
                className={`row-thumb is-${hovered.placement}${loadedThumbs.has(run.id) ? ' is-loaded' : ''}`}
              >
                <img alt="" decoding="async" onLoad={() => markThumbLoaded(run.id)} src={thumbPath} />
              </div>
            )}
            <span className="pos">
              <b aria-hidden="true">{rank ?? '—'}</b>
              {playable && (
                <button
                  aria-label={`Play ${getRunTitle(run)}${rank !== null ? `, ranked ${rank}` : ''}`}
                  className="pos-play"
                  onClick={(event) => { event.stopPropagation(); onOpenPreview(run) }}
                  type="button"
                >
                  <PlayIcon />
                </button>
              )}
            </span>
            <div className="driver">
              <span className="driver-title">
                <strong>{getRunTitle(run)}</strong>
              </span>
              <span className="driver-meta">
                <span>{formatDate(run.startedAt)}</span>
                {protocolLabel && <span title={`Built under protocol ${run.protocolVersion}`}>{protocolLabel}</span>}
              </span>
            </div>
            <div className="entry">
              {run.harness && <span className={`harness harness-${harnessSlug(run.harness)}`}>{run.harness}</span>}
              {showIsolation && (
                <span
                  className={`isolation isolation-${isolation.mode}${isolation.offProtocol ? ' is-off-protocol' : ''}`}
                  title={isolation.meaning}
                >
                  {isolation.label}
                  {/* The flag is a colour; say it in words for screen readers too. */}
                  {isolation.offProtocol && <span className="visually-hidden">, off-protocol</span>}
                </span>
              )}
            </div>
            {phaseList.map((name, phaseIndex) => {
              const phase = (phaseIndex + 1) as PhaseNumber
              const stage = run.stages.find((candidate) => candidate.number === phase)
              const score = stage?.score ?? null
              const best = score !== null && score === bestByPhase.get(phase)
              const label = score !== null
                ? String(floorScore(score))
                : stage
                  ? (stage.status === 'complete' ? 'pending' : stage.status)
                  : '—'
              return (
                <div
                  aria-label={`Phase ${phase}, ${name}: ${score !== null ? `${floorScore(score)} out of 100${best ? ', best of the field' : ''}` : label}`}
                  className={`sector${best ? ' is-best' : ''}${score === null ? ' is-na' : ''}${stage?.status === 'running' ? ' is-running' : ''}`}
                  key={phase}
                >
                  <b>{label}</b>
                  <span aria-hidden="true" className="sector-bar"><i style={{ width: `${score !== null ? Math.min(100, Math.max(0, score)) : 0}%` }} /></span>
                  <small aria-hidden="true">{name}</small>
                </div>
              )
            })}
            <div
              aria-label={panel !== null ? `Panel visuals ${floorScore(panel)} out of 100${isBestPanel ? ', best of the field' : ''}` : 'Panel visuals unavailable'}
              className={`sector sector-panel${isBestPanel ? ' is-best' : ''}${panel === null ? ' is-na' : ''}`}
            >
              <b>{panel !== null ? String(floorScore(panel)) : '—'}</b>
              <span aria-hidden="true" className="sector-bar"><i style={{ width: `${panel !== null ? Math.min(100, Math.max(0, panel)) : 0}%` }} /></span>
              <small aria-hidden="true">Panel Visuals</small>
            </div>
            <span className="cell-num">{run.telemetry?.wallTimeSeconds != null ? formatDurationCompact(run.telemetry.wallTimeSeconds) : '—'}</span>
            <div className="total" aria-label={run.score !== null ? `Score ${floorScore(run.score)} out of 100` : undefined}>
              {run.score !== null
                ? <><b>{floorScore(run.score)}</b><small>/100</small></>
                : <span className={`total-state${run.status === 'in-progress' ? ' is-live' : ''}`}>{run.status === 'in-progress' ? 'Running' : 'Pending'}</span>}
            </div>
            <button
              aria-expanded={expanded}
              aria-label={`${getRunTitle(run)} run details`}
              className="row-info"
              onClick={(event) => { event.stopPropagation(); onToggleExpand(run.id) }}
              type="button"
            >
              <ChevronIcon />
            </button>
            {run.derivedFrom && (
              <p className="row-note">
                Operator-patched fork of <b>{run.derivedFrom.run}</b> from Phase {run.derivedFrom.fromPhase}. Not the model&rsquo;s own sealed output.
              </p>
            )}
          </div>
          {expanded && (
            <div className="run-details">
              <dl>
                <div><dt>Status</dt><dd className="detail-status"><StatusLight status={run.status} />{run.status.replace(/-/g, ' ')}</dd></div>
                <div><dt>Run</dt><dd>{run.id}</dd></div>
                <div><dt>Model</dt><dd>{run.model}</dd></div>
                <div><dt>Target</dt><dd>{run.target}</dd></div>
                <div><dt>Protocol</dt><dd>{run.protocolVersion ?? '—'}{run.legacy && run.protocolVersion ? ' (legacy numbering)' : ''}</dd></div>
                <div><dt>Started</dt><dd>{formatDate(run.startedAt)}</dd></div>
                <div><dt>Updated</dt><dd>{formatDate(run.updatedAt)}</dd></div>
                {run.telemetry?.wallTimeSeconds != null && <div><dt>Wall time</dt><dd>{formatDuration(run.telemetry.wallTimeSeconds)}</dd></div>}
                {run.usage ? (
                  <>
                    <div>
                      <dt>Tokens</dt>
                      <dd title="From the lockdown gateway's log of every model response, not typed by an operator">
                        {formatTokens(run.usage.inputTokens)} in ({formatTokens(run.usage.cachedInputTokens)} cached) · {formatTokens(run.usage.outputTokens)} out{run.usage.reasoningTokens != null ? ` (${formatTokens(run.usage.reasoningTokens)} reasoning)` : ''}{run.usage.complete ? '' : ` · phases ${run.usage.phases.join(', ')}`}
                      </dd>
                    </div>
                    {run.usage.costUsd != null && <div><dt>Cost</dt><dd title={`API list price as of ${run.usage.pricesAsOf ?? 'unknown'} (bench/prices.json)`}>${run.usage.costUsd.toFixed(2)} <small>gateway, prices {run.usage.pricesAsOf}</small></dd></div>}
                  </>
                ) : (
                  run.telemetry?.costUsd != null && <div><dt>Cost</dt><dd>${run.telemetry.costUsd.toFixed(2)} <small>operator-entered</small></dd></div>
                )}
                {run.telemetry?.toolCalls != null && <div><dt>Tool calls</dt><dd>{run.telemetry.toolCalls}</dd></div>}
                {run.stages.some((stage) => stage.budget || stage.sealOutcome === 'failed' || (stage.sealFailureRelays ?? 0) > 0 || stage.audio) && (
                  <div>
                    <dt>Phases</dt>
                    {run.stages.filter((stage) => stage.status === 'complete').map((stage) => (
                      <dd key={stage.number}>{stagePhaseLine(stage)}</dd>
                    ))}
                  </div>
                )}
              </dl>
              {run.reportPath && (
                <button type="button" className="open-report" onClick={() => onOpenReport(run)}>
                  <ReportIcon />
                  <span>Evaluation report</span>
                </button>
              )}
              <dl className="run-notes">
                <div>
                  <dt>Conditions</dt>
                  {protocolNote && <dd>{protocolNote}</dd>}
                  {showIsolation && (
                    <dd className={isolation.offProtocol ? 'is-off-protocol' : undefined}>
                      <b>{isolation.label}.</b> {isolation.meaning}
                      {isolation.mode === 'mixed' && sealedIsolation(run)}
                    </dd>
                  )}
                </div>
                {footnoteCount > 0 && (
                  <div>
                    <dt>{plural(footnoteCount, 'footnote')}</dt>
                    {run.footnotes.map((note, noteIndex) => (
                      <dd className="footnote" key={noteIndex}>
                        <span className="footnote-tag">
                          {note.kind.replace(/-/g, ' ')}
                          {note.phases.length > 0 && ` · ${note.phases.length === 1 ? 'Phase' : 'Phases'} ${note.phases.join(', ')}`}
                        </span>
                        {' '}{note.text}
                      </dd>
                    ))}
                  </div>
                )}
              </dl>
            </div>
          )}
        </article>
        </Fragment>
        )
      })}
    </div>
  )
})

// The run leaderboard: one row per benchmark run, grouped by result tier, with
// per-phase score sectors, telemetry columns, and an expandable details drawer.
// Memoized: all props are reference-stable, so App's dialog/viewer state
// changes (open preview, copy link, phase switch) skip re-rendering the
// largest subtree in the app.
import { Fragment, memo } from 'react'
import type { CSSProperties } from 'react'
import type { PhaseNumber } from '../run-utils'
import { floorScore, getRunTitle } from '../run-utils'
import type { RunEntry } from '../types'
import {
  bestByTierPhase,
  formatDate,
  formatDuration,
  formatDurationCompact,
  formatTokens,
  getPhaseList,
  getResultClass,
  harnessSlug,
  protocol,
  rankByRun,
  visibleRuns,
} from '../runs-data'
import { ChevronIcon, InfoIcon, PlayIcon, ReportIcon, StatusLight } from './icons'

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
  if (visibleRuns.length === 0) {
    return (
      <div className="empty-state">
        <StatusLight status="queued" />
        <div><h3>No runs yet</h3><p>Run <code>pnpm bench new</code> to add the first model.</p></div>
      </div>
    )
  }

  return (
    <div className="run-list">
      {visibleRuns.map((run, index) => {
        const resultClass = getResultClass(run)
        const previousClass = index > 0 ? getResultClass(visibleRuns[index - 1]).id : null
        const phaseList = getPhaseList(run)
        const rank = rankByRun.get(run.id) ?? null
        const playable = Boolean(run.previewPath)
        const expanded = expandedRunId === run.id
        // Sector column count rides on a CSS variable so legacy tiers
        // with a four-phase protocol keep their own aligned grid.
        const sectorsStyle = { '--sectors': phaseList.length } as CSSProperties
        const tokens = run.telemetry?.totalTokens ?? run.telemetry?.inputTokens ?? null
        return (
        <Fragment key={run.id}>
        {resultClass.id !== previousClass && (
          <>
            <header className={`result-group-heading result-group-${resultClass.id}`}>
              <span className="result-group-label">
                {resultClass.label}
                {resultClass.id === 'current' && (
                  <button
                    aria-label={`About protocol ${protocol.version}`}
                    className="protocol-info-btn"
                    onClick={onOpenProtocolInfo}
                    type="button"
                  >
                    <InfoIcon />
                  </button>
                )}
              </span>
              <p>{resultClass.description}</p>
            </header>
            <div aria-hidden="true" className="tower-head" style={sectorsStyle}>
              <span>Pos</span>
              <span>Model</span>
              <span>Harness</span>
              {phaseList.map((name, phaseIndex) => <span key={name}>0{phaseIndex + 1} · {name}</span>)}
              <span className="num">Tokens</span>
              <span className="num">Time</span>
              <span className="num">Score</span>
              <span />
            </div>
          </>
        )}
        <article className={`run-row result-${resultClass.id}${rank !== null && rank <= 3 ? ` podium-${rank}` : ''}`}>
          <div
            className={`row-main${playable ? ' is-playable' : ''}`}
            onClick={playable ? () => onOpenPreview(run) : undefined}
            style={sectorsStyle}
          >
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
              <strong>{getRunTitle(run)}</strong>
              <span>{formatDate(run.startedAt)}</span>
            </div>
            {run.harness ? (
              <span className={`harness harness-${harnessSlug(run.harness)}`}>{run.harness}</span>
            ) : <span />}
            {phaseList.map((name, phaseIndex) => {
              const phase = (phaseIndex + 1) as PhaseNumber
              const stage = run.stages.find((candidate) => candidate.number === phase)
              const score = stage?.score ?? null
              const best = score !== null && score === bestByTierPhase.get(`${resultClass.id}:${phase}`)
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
            <span className="cell-num">{tokens !== null ? formatTokens(tokens) : '—'}</span>
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
          </div>
          {expanded && (
            <div className="run-details">
              <dl>
                <div><dt>Status</dt><dd className="detail-status"><StatusLight status={run.status} />{run.status.replace(/-/g, ' ')}</dd></div>
                <div><dt>Run</dt><dd>{run.id}</dd></div>
                <div><dt>Model</dt><dd>{run.model}</dd></div>
                <div><dt>Target</dt><dd>{run.target}</dd></div>
                <div><dt>Protocol</dt><dd>{run.protocolVersion ?? '—'}</dd></div>
                <div><dt>Started</dt><dd>{formatDate(run.startedAt)}</dd></div>
                <div><dt>Updated</dt><dd>{formatDate(run.updatedAt)}</dd></div>
                {run.telemetry?.wallTimeSeconds != null && <div><dt>Wall time</dt><dd>{formatDuration(run.telemetry.wallTimeSeconds)}</dd></div>}
                {run.telemetry?.costUsd != null && <div><dt>Cost</dt><dd>${run.telemetry.costUsd.toFixed(2)}</dd></div>}
                {run.telemetry?.totalTokens != null && <div><dt>Total tokens</dt><dd>{formatTokens(run.telemetry.totalTokens)}</dd></div>}
                {run.telemetry?.inputTokens != null && <div><dt>Tokens in</dt><dd>{formatTokens(run.telemetry.inputTokens)}</dd></div>}
                {run.telemetry?.outputTokens != null && <div><dt>Tokens out</dt><dd>{formatTokens(run.telemetry.outputTokens)}</dd></div>}
                {run.telemetry?.reasoningTokens != null && <div><dt>Reasoning</dt><dd>{formatTokens(run.telemetry.reasoningTokens)}</dd></div>}
                {run.telemetry?.toolCalls != null && <div><dt>Tool calls</dt><dd>{run.telemetry.toolCalls}</dd></div>}
              </dl>
              {run.reportPath && (
                <button type="button" className="open-report" onClick={() => onOpenReport(run)}>
                  <ReportIcon />
                  <span>Evaluation report</span>
                </button>
              )}
            </div>
          )}
        </article>
        </Fragment>
        )
      })}
    </div>
  )
})

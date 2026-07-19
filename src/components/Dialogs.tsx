// The gallery's modal layer: the run preview overlay, the showcase overlay,
// the protocol-info modal, and the evaluation-report overlay. App owns the
// open/close state and focus management; this component only renders whichever
// overlay is currently open.
import type { PhaseNumber } from '../run-utils'
import { floorScore, getPreviewPath, getRunTitle } from '../run-utils'
import type { RunEntry } from '../types'
import { getPhaseName, protocol } from '../runs-data'
import { CloseIcon, StatusLight } from './icons'
import { PreviewFrame } from './PreviewFrame'

type CopyStatus = 'idle' | 'copied' | 'failed'

export function Dialogs({
  selectedRun,
  selectedPhase,
  selectedPreviewPath,
  selectedReport,
  showcaseOpen,
  protocolInfoOpen,
  copyStatus,
  focusDialog,
  onClosePreview,
  onChangePhase,
  onCopyLink,
  onCloseShowcase,
  onCloseProtocolInfo,
  onCloseReport,
}: {
  selectedRun: RunEntry | null
  selectedPhase: PhaseNumber | null
  selectedPreviewPath: string | null | undefined
  selectedReport: RunEntry | null
  showcaseOpen: boolean
  protocolInfoOpen: boolean
  copyStatus: CopyStatus
  focusDialog: (node: HTMLDivElement | null) => void
  onClosePreview: () => void
  onChangePhase: (phase: PhaseNumber) => void
  onCopyLink: () => void
  onCloseShowcase: () => void
  onCloseProtocolInfo: () => void
  onCloseReport: () => void
}) {
  return (
    <>
      {selectedRun && selectedPhase && selectedPreviewPath && (
        <div className="preview-overlay" ref={focusDialog} role="dialog" tabIndex={-1} aria-modal="true" aria-label={`${getRunTitle(selectedRun)} preview`}>
          <div className="preview-header">
            <div className="preview-identity">
              <StatusLight status={selectedRun.status} />
              <strong>{getRunTitle(selectedRun)}</strong>
              <span>PHASE {selectedPhase} · {getPhaseName(selectedRun, selectedPhase)}</span>
            </div>
            <div className="preview-tools">
              {selectedRun.stages.length > 1 && (
                <div className="phase-switch" role="group" aria-label="Preview phase">
                  <span aria-hidden="true">Phase</span>
                  {selectedRun.stages.map(({ number: phase }) => {
                    const available = Boolean(getPreviewPath(selectedRun, phase))
                    return (
                      <button
                        aria-label={`Phase ${phase} · ${getPhaseName(selectedRun, phase)}${available ? '' : ' · unavailable'}`}
                        aria-pressed={phase === selectedPhase}
                        className={phase === selectedPhase ? 'is-current' : undefined}
                        disabled={!available}
                        key={phase}
                        onClick={() => onChangePhase(phase)}
                        type="button"
                      >
                        0{phase}
                      </button>
                    )
                  })}
                </div>
              )}
              <button className="copy-link" onClick={onCopyLink} type="button">
                {copyStatus === 'copied' ? 'Link copied' : copyStatus === 'failed' ? 'Copy failed' : 'Copy link'}
              </button>
              <button type="button" onClick={onClosePreview}>Close</button>
            </div>
          </div>
          <div className="preview-stage">
            <PreviewFrame
              autoFocus
              frameKey={`${selectedRun.id}-${selectedPhase}`}
              onEscape={onClosePreview}
              scrolling="no"
              src={selectedPreviewPath}
              title={`${getRunTitle(selectedRun)} Phase ${selectedPhase} output`}
            />
          </div>
        </div>
      )}

      {showcaseOpen && (
        <div className="preview-overlay" ref={focusDialog} role="dialog" tabIndex={-1} aria-modal="true" aria-label="Showcase preview">
          <div className="preview-header">
            <div className="preview-identity">
              <strong>Showcase</strong>
            </div>
            <div className="preview-tools">
              <button type="button" onClick={onCloseShowcase}>Close</button>
            </div>
          </div>
          <div className="preview-stage">
            <PreviewFrame autoFocus onEscape={onCloseShowcase} scrolling="no" src="/previews/showcase/index.html" title="Showcase Nord Stage 4" />
          </div>
        </div>
      )}

      {protocolInfoOpen && (
        <div className="modal-backdrop" onClick={onCloseProtocolInfo}>
          <div
            aria-labelledby="protocol-info-heading"
            aria-modal="true"
            className="info-modal"
            onClick={(event) => event.stopPropagation()}
            ref={focusDialog}
            role="dialog"
            tabIndex={-1}
          >
            <div className="info-modal-head">
              <h3 id="protocol-info-heading">Protocol {protocol.version}</h3>
              <button aria-label="Close" onClick={onCloseProtocolInfo} type="button">
                <CloseIcon />
              </button>
            </div>
            <div className="info-modal-body">
              <p>
                Stagebench bumps its protocol version whenever the prompts, specs, rubric, or verifier behavior
                change — anything that could shift what&rsquo;s being measured. Runs are only closely comparable
                within the same protocol version.
              </p>
              <dl className="protocol-history">
                <div>
                  <dt>Protocol 1.1 <span>Current</span></dt>
                  <dd>
                    Changed materials packaging: candidates no longer see scoring or harness docs, future-phase
                    details, or unassigned hardware variants, and evaluators now work in an isolated workspace.
                    Task content — phases, prompts, rubric weights — is unchanged from 1.0, so 1.0 and 1.1 scores
                    are directly comparable.
                  </dd>
                </div>
                <div>
                  <dt>Protocol 1.0</dt>
                  <dd>
                    The baseline three-phase protocol: cumulative Surface + Piano, Pianos + FX, and Complete
                    System phases, each scored against the published rubric.
                  </dd>
                </div>
                <div>
                  <dt>Legacy</dt>
                  <dd>
                    Runs recorded before the current run schema, under earlier prompts, specs, or scoring. Kept
                    for reference with their frozen scores and evaluation reports — not directly comparable to
                    current runs.
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}

      {selectedReport?.reportPath && (
        <div className="preview-overlay report-overlay" ref={focusDialog} role="dialog" tabIndex={-1} aria-modal="true" aria-label={`${getRunTitle(selectedReport)} evaluation report`}>
          <div className="preview-header">
            <div className="preview-identity report-identity">
              <StatusLight status={selectedReport.status} />
              <strong>{getRunTitle(selectedReport)}</strong>
              <span className="report-kind">Evaluation report</span>
              {selectedReport.score !== null && <span className="report-score">{floorScore(selectedReport.score)}/100</span>}
            </div>
            <div className="preview-tools">
              <button type="button" onClick={onCloseReport}>Close</button>
            </div>
          </div>
          <PreviewFrame className="report-frame" onEscape={onCloseReport} src={selectedReport.reportPath} title={`${getRunTitle(selectedReport)} evaluation report`} />
        </div>
      )}
    </>
  )
}

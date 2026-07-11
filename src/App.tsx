import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearViewerUrl,
  createViewerUrl,
  getLatestPhase,
  getPreviewPath,
  parseViewerSearch,
} from './run-utils'
import type { PhaseNumber } from './run-utils'
import type { RunEntry } from './types'
import { artifactsUnlocked, runs } from './runs-data'
import { PlayIcon } from './components/icons'
import { ToyKeyboard } from './components/ToyKeyboard'
import { RunList } from './components/RunList'
import { Dialogs } from './components/Dialogs'
import './App.css'

function App() {
  const initialViewer = parseViewerSearch(window.location.search, runs)
  const [selectedRun, setSelectedRun] = useState<RunEntry | null>(
    initialViewer ? initialViewer.run : null,
  )
  const [selectedPhase, setSelectedPhase] = useState<PhaseNumber | null>(initialViewer?.phase ?? null)
  const [selectedReport, setSelectedReport] = useState<RunEntry | null>(null)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [showcaseOpen, setShowcaseOpen] = useState(false)
  const [protocolInfoOpen, setProtocolInfoOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  // The element that opened the current dialog, so focus can return to it on
  // close. Captured before the dialog mounts (the dialog steals focus).
  const dialogOpenerRef = useRef<HTMLElement | null>(null)
  const captureDialogOpener = useCallback(() => {
    dialogOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [])
  const selectedPreviewPath = selectedRun && selectedPhase
    ? getPreviewPath(selectedRun, selectedPhase)
    : undefined

  const openPreview = useCallback((run: RunEntry, phase = getLatestPhase(run)) => {
    if (!phase) return
    captureDialogOpener()
    setSelectedReport(null)
    setSelectedRun(run)
    setSelectedPhase(phase)
    setCopyStatus('idle')
    window.history.pushState({}, '', createViewerUrl(window.location.href, run.id, phase))
  }, [captureDialogOpener])

  const closePreview = useCallback(() => {
    setSelectedRun(null)
    setSelectedPhase(null)
    setCopyStatus('idle')
    window.history.replaceState({}, '', clearViewerUrl(window.location.href))
  }, [])

  const changePreviewPhase = useCallback((phase: PhaseNumber) => {
    if (!selectedRun || !getPreviewPath(selectedRun, phase)) return
    setSelectedPhase(phase)
    setCopyStatus('idle')
    window.history.replaceState({}, '', createViewerUrl(window.location.href, selectedRun.id, phase))
  }, [selectedRun])

  const copyPreviewLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    }
  }, [])

  // Mirror the render conditions in Dialogs: a run with no preview path (or a
  // report entry with no report path) must not lock scroll or steal keyboard
  // handling behind an overlay that never mounts.
  const overlayOpen = Boolean(
    (selectedRun && selectedPhase && selectedPreviewPath) ||
    selectedReport?.reportPath ||
    showcaseOpen ||
    protocolInfoOpen,
  )

  // Capture the trigger, close the preview, and clear every sibling dialog so
  // exactly one overlay is ever mounted (the protocol modal has no focus trap,
  // so keyboard focus can reach triggers behind the backdrop).
  const beginDialog = useCallback(() => {
    captureDialogOpener()
    closePreview()
    setSelectedReport(null)
    setShowcaseOpen(false)
    setProtocolInfoOpen(false)
  }, [captureDialogOpener, closePreview])

  const openProtocolInfo = useCallback(() => {
    beginDialog()
    setProtocolInfoOpen(true)
  }, [beginDialog])

  const openReport = useCallback((run: RunEntry) => {
    beginDialog()
    setSelectedReport(run)
  }, [beginDialog])

  const openShowcase = useCallback(() => {
    beginDialog()
    setShowcaseOpen(true)
  }, [beginDialog])

  const toggleRunDetails = useCallback((runId: string) => {
    setExpandedRunId((current) => (current === runId ? null : runId))
  }, [])

  // Move focus into a dialog when it mounts; tabIndex={-1} on the container
  // keeps it out of the tab order while still accepting programmatic focus.
  const focusDialog = useCallback((node: HTMLDivElement | null) => {
    node?.focus()
  }, [])

  // Return focus to whatever opened the dialog once it closes.
  useEffect(() => {
    if (!overlayOpen) return
    return () => {
      dialogOpenerRef.current?.focus()
      dialogOpenerRef.current = null
    }
  }, [overlayOpen])

  useEffect(() => {
    if (!overlayOpen) return

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (showcaseOpen) setShowcaseOpen(false)
      else if (selectedReport) setSelectedReport(null)
      else if (protocolInfoOpen) setProtocolInfoOpen(false)
      else if (selectedRun) closePreview()
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [overlayOpen, showcaseOpen, selectedReport, protocolInfoOpen, selectedRun, closePreview])

  useEffect(() => {
    const syncViewerFromUrl = () => {
      const viewer = parseViewerSearch(window.location.search, runs)
      setSelectedRun(viewer ? viewer.run : null)
      setSelectedPhase(viewer?.phase ?? null)
      setSelectedReport(null)
      setCopyStatus('idle')
    }

    window.addEventListener('popstate', syncViewerFromUrl)
    return () => window.removeEventListener('popstate', syncViewerFromUrl)
  }, [])

  useEffect(() => {
    if (!overlayOpen) return

    const scrollY = window.scrollY
    const previous = {
      bodyOverflow: document.body.style.overflow,
      bodyPosition: document.body.style.position,
      bodyTop: document.body.style.top,
      bodyWidth: document.body.style.width,
      htmlOverflow: document.documentElement.style.overflow,
    }

    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'

    return () => {
      document.documentElement.style.overflow = previous.htmlOverflow
      document.body.style.overflow = previous.bodyOverflow
      document.body.style.position = previous.bodyPosition
      document.body.style.top = previous.bodyTop
      document.body.style.width = previous.bodyWidth
      window.scrollTo(0, scrollY)
    }
  }, [overlayOpen])

  return (
    <main>
      <a className="skip-link" href="#runs">Skip to runs</a>
      <header className="instrument-header">
        <div className="header-intro">
          <div>
            <span className="header-eyebrow">Unofficial fan project</span>
            <h1>Nord Stage{' '}4 benchmark</h1>
            <p>Coding agents rebuild the Nord Stage{' '}4 as a playable browser instrument.</p>
          </div>
          <a className="github-link" href="https://github.com/wustep/stagebench" rel="noopener" target="_blank">
            <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" fill="currentColor" />
            </svg>
            <span>GitHub</span>
          </a>
        </div>

        <ToyKeyboard overlayOpen={overlayOpen} />
      </header>

      <section className="showcase-band" aria-labelledby="showcase-heading">
        <div className="showcase-copy">
          <span className="showcase-flag">Featured showcase</span>
          <h2 id="showcase-heading">The evolving Stage 4</h2>
          <p>Seeded from the top-scoring run, then iterated beyond the benchmark rules. Not scored against the gallery.</p>
        </div>
        <button type="button" className="open-preview showcase-play" onClick={openShowcase}>
          <span>Play the showcase</span> <PlayIcon />
        </button>
      </section>

      <section className="run-index" id="runs">
        <div className="run-index-heading">
          <h2>Runs</h2>
        </div>

        <RunList
          expandedRunId={expandedRunId}
          onToggleExpand={toggleRunDetails}
          onOpenPreview={openPreview}
          onOpenProtocolInfo={openProtocolInfo}
          onOpenReport={openReport}
        />

        <section className="benchmark-details" aria-labelledby="stage-tests-heading">
          <h3 id="stage-tests-heading">What the three cumulative phases test</h3>
          <ol>
            <li><span>01</span><div><strong>Complete surface + basic Piano</strong><p>Exact visual hardware and keybed, one playable Piano voice, and honestly decorative panel controls.</p></div></li>
            <li><span>02</span><div><strong>Piano library + working effects</strong><p>Multiple distinct Pianos, two layers, detailed controls, shared audio graph, and connected effect families.</p></div></li>
            <li><span>03</span><div><strong>Complete Stage 4 system</strong><p>Programs, splits, scenes, morphs, Organ, Synth, full routing, and meaningful hardware bindings.</p></div></li>
          </ol>
        </section>
      </section>

      {artifactsUnlocked && (
        <section className="artifacts" aria-labelledby="artifacts-heading">
          <h3 id="artifacts-heading">Artifacts</h3>
          <p className="artifacts-lead">
            Side experiments and study pieces — not benchmark runs. Unlocked via <code>/secret</code>.
          </p>
          <ul className="artifact-list">
            <li>
              <a href="/artifacts/nord-stage-4-recreation.html" target="_blank" rel="noopener">
                <strong>Nord Stage 4 — vector recreation study <span aria-hidden="true">→</span></strong>
                <span>
                  A from-scratch SVG trace of the reference photo, drawn on the photo&rsquo;s own frame with an
                  overlay tool (opacity / diff / wipe) for measuring drift against the real product shot.
                </span>
              </a>
            </li>
          </ul>
        </section>
      )}

      <footer>
        <span>Stagebench</span>
        <p>
          <span>This is an unofficial fan project created for educational and non-commercial purposes. It is not affiliated with, endorsed by, sponsored by, or associated with Clavia DMI AB or the Nord brand.</span>
          <span>&ldquo;Nord&rdquo; and &ldquo;Nord Stage&rdquo; are trademarks of Clavia DMI AB and are used solely to identify the product that inspired this project.</span>
        </p>
      </footer>

      <Dialogs
        selectedRun={selectedRun}
        selectedPhase={selectedPhase}
        selectedPreviewPath={selectedPreviewPath}
        selectedReport={selectedReport}
        showcaseOpen={showcaseOpen}
        protocolInfoOpen={protocolInfoOpen}
        copyStatus={copyStatus}
        focusDialog={focusDialog}
        onClosePreview={closePreview}
        onChangePhase={changePreviewPhase}
        onCopyLink={copyPreviewLink}
        onCloseShowcase={() => setShowcaseOpen(false)}
        onCloseProtocolInfo={() => setProtocolInfoOpen(false)}
        onCloseReport={() => setSelectedReport(null)}
      />
    </main>
  )
}

export default App

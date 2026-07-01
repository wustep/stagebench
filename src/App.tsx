import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import runsData from './data/runs.json'
import {
  clearViewerUrl,
  createViewerUrl,
  floorScore,
  getLatestPhase,
  getPreviewPath,
  getRunTitle,
  parseViewerSearch,
} from './run-utils'
import type { PhaseNumber } from './run-utils'
import type { BenchmarkRun, RunStatus, StageStatus } from './types'
import './App.css'

const runs = runsData as BenchmarkRun[]
const isLocalEnvironment = import.meta.env.DEV
const locallyAvailableRuns = runs.filter((run) => isLocalEnvironment || !run.isTest)
const phaseNames = ['Surface + Piano', 'Pianos + FX', 'Complete System']
const v2PhaseNames = ['Visual', 'Piano', 'Programs + FX', 'Organ + Synth']
const legacyPhaseNames = ['Visual', 'Piano', 'Complete']
const noteOffsets = [0, 2, 4, 5, 7, 9, 11]
const noteNames = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const sharpNotes = new Set(['C', 'D', 'F', 'G', 'A'])
const headerKeys = Array.from({ length: 28 }, (_, index) => {
  const octave = 3 + Math.floor(index / 7)
  const noteIndex = index % 7
  const note = noteNames[noteIndex]
  const midi = 48 + Math.floor(index / 7) * 12 + noteOffsets[noteIndex]

  return {
    white: { midi, name: `${note}${octave}` },
    black: sharpNotes.has(note) ? { midi: midi + 1, name: `${note}♯${octave}` } : null,
  }
})
const computerKeyboardNotes: Record<string, { label: string; midi: number }> = {
  KeyZ: { label: 'Z', midi: 48 },
  KeyS: { label: 'S', midi: 49 },
  KeyX: { label: 'X', midi: 50 },
  KeyD: { label: 'D', midi: 51 },
  KeyC: { label: 'C', midi: 52 },
  KeyV: { label: 'V', midi: 53 },
  KeyG: { label: 'G', midi: 54 },
  KeyB: { label: 'B', midi: 55 },
  KeyH: { label: 'H', midi: 56 },
  KeyN: { label: 'N', midi: 57 },
  KeyJ: { label: 'J', midi: 58 },
  KeyM: { label: 'M', midi: 59 },
  KeyQ: { label: 'Q', midi: 60 },
  Digit2: { label: '2', midi: 61 },
  KeyW: { label: 'W', midi: 62 },
  Digit3: { label: '3', midi: 63 },
  KeyE: { label: 'E', midi: 64 },
  KeyR: { label: 'R', midi: 65 },
  Digit5: { label: '5', midi: 66 },
  KeyT: { label: 'T', midi: 67 },
  Digit6: { label: '6', midi: 68 },
  KeyY: { label: 'Y', midi: 69 },
  Digit7: { label: '7', midi: 70 },
  KeyU: { label: 'U', midi: 71 },
}
const computerKeyLabels = new Map(
  Object.values(computerKeyboardNotes).map(({ label, midi }) => [midi, label]),
)
const headerNoteNames = Object.fromEntries(
  headerKeys.flatMap(({ white, black }) => black
    ? [[white.midi, white.name], [black.midi, black.name]]
    : [[white.midi, white.name]]),
) as Record<number, string>

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value))
}

function getPhaseName(run: BenchmarkRun, phase: PhaseNumber) {
  if (String(run.protocol?.version ?? run.benchmarkVersion ?? '').startsWith('3.')) return phaseNames[phase - 1]
  if (run.stages.length === 4) return v2PhaseNames[phase - 1]
  return legacyPhaseNames[phase - 1]
}

function getResultClass(run: BenchmarkRun) {
  if (['partial', 'failed', 'invalid', 'budget-exceeded', 'infrastructure-failure'].includes(run.status) || ['invalid-technical', 'incomplete', 'budget-exceeded', 'infrastructure-failure'].includes(run.validity ?? '')) {
    return { id: 'diagnostic', label: 'Incomplete / invalid', rank: 2, description: 'Diagnostic records that are not eligible for comparison.' }
  }
  if (run.classification?.kind === 'official' && run.classification.comparable && run.validity === 'valid') return { id: 'official', label: 'Official', rank: 0, description: 'Valid, complete runs from the current compatible comparison series.' }
  if (run.classification?.kind === 'exploratory') return { id: 'exploratory', label: 'Exploratory', rank: 1, description: 'Development runs recorded outside an official comparison series.' }
  return { id: 'legacy', label: 'Legacy', rank: 3, description: 'Historical runs retained under their original protocol and rubric.' }
}

function StatusLight({ status }: { status: StageStatus | RunStatus }) {
  return <span className={`status-light status-${status}`} aria-hidden="true" />
}

function KeyboardRail({
  activeNotes,
  onNoteOn,
  onNoteOff,
}: {
  activeNotes: Set<number>
  onNoteOn: (midi: number, name: string) => void
  onNoteOff: (midi: number) => void
}) {
  const keyboardHandlers = (midi: number, name: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      onNoteOn(midi, name)
    },
    onPointerUp: () => onNoteOff(midi),
    onPointerCancel: () => onNoteOff(midi),
    onLostPointerCapture: () => onNoteOff(midi),
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
        event.preventDefault()
        onNoteOn(midi, name)
      }
    },
    onKeyUp: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onNoteOff(midi)
      }
    },
    onBlur: () => onNoteOff(midi),
  })

  return (
    <div className="keyboard-rail" role="group" aria-label="Playable benchmark keyboard">
      {headerKeys.map(({ white, black }) => {
        const whiteShortcut = computerKeyLabels.get(white.midi)
        const blackShortcut = black ? computerKeyLabels.get(black.midi) : undefined

        return (
          <span className="key-slot" key={white.midi}>
            <button
              aria-label={`Play ${white.name}${whiteShortcut ? `, keyboard ${whiteShortcut}` : ''}`}
              className={`white-key${activeNotes.has(white.midi) ? ' is-active' : ''}`}
              type="button"
              {...keyboardHandlers(white.midi, white.name)}
            >
              {whiteShortcut && <span className="key-label" aria-hidden="true">{whiteShortcut}</span>}
            </button>
            {black && (
              <button
                aria-label={`Play ${black.name}${blackShortcut ? `, keyboard ${blackShortcut}` : ''}`}
                className={`black-key${activeNotes.has(black.midi) ? ' is-active' : ''}`}
                type="button"
                {...keyboardHandlers(black.midi, black.name)}
              >
                {blackShortcut && <span className="key-label" aria-hidden="true">{blackShortcut}</span>}
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}

function App() {
  const initialViewer = parseViewerSearch(window.location.search, locallyAvailableRuns)
  const [selectedRun, setSelectedRun] = useState<BenchmarkRun | null>(
    initialViewer ? initialViewer.run as BenchmarkRun : null,
  )
  const [selectedPhase, setSelectedPhase] = useState<PhaseNumber | null>(initialViewer?.phase ?? null)
  const [selectedReport, setSelectedReport] = useState<BenchmarkRun | null>(null)
  const [showTestRuns, setShowTestRuns] = useState(isLocalEnvironment)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [activeNotes, setActiveNotes] = useState<Set<number>>(() => new Set())
  const [lastPlayed, setLastPlayed] = useState<string | null>(null)
  const [knobValues, setKnobValues] = useState([18, 42, 66, 90])
  const audioContextRef = useRef<AudioContext | null>(null)
  const voicesRef = useRef(new Map<number, { oscillator: OscillatorNode; gain: GainNode }>())
  const pressedKeysRef = useRef(new Set<string>())
  const visibleRuns = [...locallyAvailableRuns]
    .filter((run) => showTestRuns || !run.isTest)
    .sort((left, right) => getResultClass(left).rank - getResultClass(right).rank || right.startedAt.localeCompare(left.startedAt))
  const testRunCount = locallyAvailableRuns.filter((run) => run.isTest).length
  const activeCount = visibleRuns.filter((run) => run.status === 'running').length
  const selectedPreviewPath = selectedRun && selectedPhase
    ? getPreviewPath(selectedRun, selectedPhase)
    : undefined

  const openPreview = useCallback((run: BenchmarkRun, phase = getLatestPhase(run)) => {
    if (!phase) return
    setSelectedReport(null)
    setSelectedRun(run)
    setSelectedPhase(phase)
    setCopyStatus('idle')
    window.history.pushState({}, '', createViewerUrl(window.location.href, run.id, phase))
  }, [])

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

  const stopHeaderNote = useCallback((midi: number) => {
    const voice = voicesRef.current.get(midi)
    if (!voice) return

    const now = voice.gain.context.currentTime
    voice.gain.gain.cancelScheduledValues(now)
    voice.gain.gain.setTargetAtTime(0.0001, now, 0.04)
    voice.oscillator.stop(now + 0.22)
    voicesRef.current.delete(midi)
    setActiveNotes((current) => {
      const next = new Set(current)
      next.delete(midi)
      return next
    })
  }, [])

  const startHeaderNote = useCallback((midi: number, name: string) => {
    if (voicesRef.current.has(midi)) return

    const context = audioContextRef.current ?? new AudioContext()
    audioContextRef.current = context
    if (context.state === 'suspended') void context.resume()

    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const now = context.currentTime
    oscillator.type = 'triangle'
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.018)
    gain.gain.exponentialRampToValueAtTime(0.075, now + 0.8)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.onended = () => {
      oscillator.disconnect()
      gain.disconnect()
    }
    oscillator.start(now)
    voicesRef.current.set(midi, { oscillator, gain })
    setLastPlayed(name)
    setActiveNotes((current) => new Set(current).add(midi))
  }, [])

  const overlayOpen = Boolean(selectedRun || selectedReport)

  useEffect(() => {
    const syncViewerFromUrl = () => {
      const viewer = parseViewerSearch(window.location.search, locallyAvailableRuns)
      setSelectedRun(viewer ? viewer.run as BenchmarkRun : null)
      setSelectedPhase(viewer?.phase ?? null)
      setSelectedReport(null)
      setCopyStatus('idle')
    }

    window.addEventListener('popstate', syncViewerFromUrl)
    return () => window.removeEventListener('popstate', syncViewerFromUrl)
  }, [])

  useEffect(() => {
    const pressedKeys = pressedKeysRef.current
    const releasePressedKeys = () => {
      for (const code of pressedKeys) {
        stopHeaderNote(computerKeyboardNotes[code].midi)
      }
      pressedKeys.clear()
    }

    if (overlayOpen) {
      releasePressedKeys()
      return
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const note = computerKeyboardNotes[event.code]
      if (!note || event.repeat || pressedKeys.has(event.code) || event.metaKey || event.ctrlKey || event.altKey) return

      const target = event.target
      if (target instanceof HTMLElement && (
        target.isContentEditable || target.matches('input, textarea, select')
      )) return

      event.preventDefault()
      pressedKeys.add(event.code)
      startHeaderNote(note.midi, headerNoteNames[note.midi])
    }

    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      const note = computerKeyboardNotes[event.code]
      if (!note || !pressedKeys.has(event.code)) return

      event.preventDefault()
      pressedKeys.delete(event.code)
      stopHeaderNote(note.midi)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releasePressedKeys)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releasePressedKeys)
      releasePressedKeys()
    }
  }, [overlayOpen, startHeaderNote, stopHeaderNote])

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

  useEffect(() => {
    const voices = voicesRef.current
    return () => {
      for (const { oscillator } of voices.values()) oscillator.stop()
      voices.clear()
      if (audioContextRef.current) void audioContextRef.current.close()
    }
  }, [])

  return (
    <main>
      <header className="instrument-header">
        <nav className="topbar" aria-label="Primary navigation">
          <a className="wordmark" href="#runs" aria-label="Stagebench runs">
            <span>STAGEBENCH</span>
          </a>
          <a href="https://github.com/wustep/stagebench/blob/main/METHODOLOGY.md">METHODOLOGY.md</a>
          <a href="https://github.com/wustep/stagebench/blob/main/BENCHMARK.md">BENCHMARK.md</a>
        </nav>

        <div className="header-intro">
          <div>
            <h1>Nord Stage 4 benchmark</h1>
            <p>Compare agent-built recreations across the complete surface and basic Piano, multi-Piano effects, then the full Stage 4 system.</p>
          </div>
        </div>

        <div className="instrument-shell">
          <div className="control-panel" aria-label="Benchmark status">
            <div className="panel-readout">
              <small>RUNS</small>
              <strong>{String(visibleRuns.length).padStart(2, '0')}</strong>
            </div>
            <div className="panel-readout">
              <small>ACTIVE</small>
              <strong>{String(activeCount).padStart(2, '0')}</strong>
            </div>
            <div className="oled-display">
              <span>{activeCount > 0 ? 'BENCHMARK RUNNING' : 'SYSTEM READY'}</span>
              <strong>{activeNotes.size > 0 ? `PLAYING ${lastPlayed}` : lastPlayed ? `LAST NOTE ${lastPlayed}` : activeCount > 0 ? runs.find((run) => run.status === 'running')?.model : 'SELECT MODEL'}</strong>
            </div>
            <ol className="stage-controls" aria-label="Adjustable benchmark phase levels">
              {phaseNames.map((name, index) => (
                <li key={name}>
                  <div className="knob-control">
                    <input
                      aria-label={`${name} benchmark phase level`}
                      max="100"
                      min="0"
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value)
                        setKnobValues((current) => current.map((currentValue, currentIndex) => (
                          currentIndex === index ? value : currentValue
                        )))
                      }}
                      type="range"
                      value={knobValues[index]}
                    />
                    <div className="knob" aria-hidden="true">
                      <i style={{ transform: `rotate(${knobValues[index] * 2.7 - 135}deg)` }} />
                    </div>
                  </div>
                  <span>0{index + 1}</span>
                  <strong>{name}</strong>
                </li>
              ))}
            </ol>
          </div>
          <KeyboardRail activeNotes={activeNotes} onNoteOff={stopHeaderNote} onNoteOn={startHeaderNote} />
        </div>
      </header>

      <section className="run-index" id="runs">
        <div className="run-index-heading">
          <h2>Runs</h2>
          <div className="run-index-meta">
            <span>{visibleRuns.length} {visibleRuns.length === 1 ? 'run' : 'runs'}</span>
            {isLocalEnvironment && testRunCount > 0 && (
              <button
                aria-pressed={showTestRuns}
                className="test-run-toggle"
                onClick={() => setShowTestRuns((current) => !current)}
                type="button"
              >
                {showTestRuns ? 'Hide test runs' : `Show test runs (${testRunCount})`}
              </button>
            )}
          </div>
        </div>

        {visibleRuns.length > 0 ? (
          <div className="run-list">
            {visibleRuns.map((run, index) => {
              const resultClass = getResultClass(run)
              const previousClass = index > 0 ? getResultClass(visibleRuns[index - 1]).id : null
              return (
              <Fragment key={run.id}>
              {resultClass.id !== previousClass && (
                <header className={`result-group-heading result-group-${resultClass.id}`}>
                  <span>{resultClass.label}</span>
                  <p>{resultClass.description}</p>
                </header>
              )}
              <article className={`run-row result-${resultClass.id}`}>
                <div className="run-model">
                  <div className="run-status-line">
                    <span className="run-status"><StatusLight status={run.status} />{run.status}</span>
                    <span className="model-target">{run.target ?? 'Stage 4 73'}</span>
                    <span className={`result-class-badge result-class-${getResultClass(run).id}`}>{getResultClass(run).label}</span>
                    {run.validity && <span className="validity-badge">{run.validity}</span>}
                    {run.isTest && <span className="test-run-badge">Test run</span>}
                  </div>
                  <h3>{getRunTitle(run)}</h3>
                  {run.evaluation && (
                    <div className="run-score" aria-label={`Aggregate evaluation ${floorScore(run.evaluation.score)} out of 100, ${run.evaluation.grade}`}>
                      <strong>{floorScore(run.evaluation.score)}</strong>
                      <span>/100 · {run.evaluation.grade}<small>{run.evaluation.evaluatedStages.length}/{run.stages.length} selected phases evaluated{getResultClass(run).id !== 'official' ? ' · diagnostic, not ranked' : ''}</small></span>
                    </div>
                  )}
                  {!run.evaluation && run.stages.some((stage) => stage.status === 'complete') && (
                    <span className="evaluation-pending">Evaluation pending</span>
                  )}
                  <p>{formatDate(run.startedAt)} · {run.model}</p>
                </div>

                <ol className="stage-track" aria-label={`${getRunTitle(run)} phase progress`} style={{ gridTemplateColumns: `repeat(${run.stages.length}, 1fr)` }}>
                  {run.stages.map((stage) => (
                    <li className={`stage-${stage.status}`} key={stage.number}>
                      <span>0{stage.number}</span>
                      <div><StatusLight status={stage.status} /><strong>{getPhaseName(run, stage.number)}</strong></div>
                      <small>{stage.evaluation ? `${floorScore(stage.evaluation.score)}/100 · ${stage.evaluation.grade}` : stage.status === 'complete' ? 'evaluation pending' : stage.status}</small>
                    </li>
                  ))}
                </ol>

                <div className="run-actions">
                  {run.previewPath ? (
                    <button type="button" className="open-preview" onClick={() => openPreview(run)}>
                      Play <span aria-hidden="true">▶</span>
                    </button>
                  ) : (
                    <span className="preview-pending">No preview available</span>
                  )}
                  {run.evaluation?.reportPath && (
                    <button type="button" className="open-report" onClick={() => { closePreview(); setSelectedReport(run) }}>
                      Evaluation report <span aria-hidden="true">→</span>
                    </button>
                  )}
                </div>
              </article>
              </Fragment>
              )
            })}
          </div>
        ) : (
          <div className="empty-state">
            <StatusLight status="queued" />
            <div><h3>No runs yet</h3><p>Run the project skill to add the first model.</p></div>
          </div>
        )}

        <section className="benchmark-details" aria-labelledby="stage-tests-heading">
          <h3 id="stage-tests-heading">What the three cumulative phases test</h3>
          <ol>
            <li><span>01</span><div><strong>Complete surface + basic Piano</strong><p>Exact visual hardware and keybed, one playable Piano voice, and honestly decorative panel controls.</p></div></li>
            <li><span>02</span><div><strong>Piano library + working effects</strong><p>Multiple distinct Pianos, two layers, detailed controls, shared audio graph, and connected effect families.</p></div></li>
            <li><span>03</span><div><strong>Complete Stage 4 system</strong><p>Programs, presets, performance systems, Organ, Synth, full routing, and meaningful hardware bindings.</p></div></li>
          </ol>
        </section>
      </section>

      <footer>
        <span>Stagebench</span>
        <p>
          <span>This is an academic benchmark for UI and audio system reconstruction.</span>
          <span>Nord® and Nord Stage® are trademarks of Clavia DMI AB. Independent project, not affiliated with or endorsed by Clavia.</span>
        </p>
      </footer>

      {selectedRun && selectedPhase && selectedPreviewPath && (
        <div className="preview-overlay" role="dialog" aria-modal="true" aria-label={`${getRunTitle(selectedRun)} preview`}>
          <div className="preview-header">
            <div className="preview-identity">
              <StatusLight status={selectedRun.status} />
              <strong>{getRunTitle(selectedRun)}</strong>
              <span>PHASE {selectedPhase} · {getPhaseName(selectedRun, selectedPhase)}</span>
            </div>
            <div className="preview-tools">
              <label className="phase-selector">
                <span>Phase</span>
                <select
                  aria-label="Preview phase"
                  onChange={(event) => changePreviewPhase(Number(event.currentTarget.value) as PhaseNumber)}
                  value={selectedPhase}
                >
                  {selectedRun.stages.map(({ number: phase }) => (
                    <option disabled={!getPreviewPath(selectedRun, phase)} key={phase} value={phase}>
                      {phase} · {getPhaseName(selectedRun, phase)}{getPreviewPath(selectedRun, phase) ? '' : ' · unavailable'}
                    </option>
                  ))}
                </select>
              </label>
              <button className="copy-link" onClick={copyPreviewLink} type="button">
                {copyStatus === 'copied' ? 'Link copied' : copyStatus === 'failed' ? 'Copy failed' : 'Copy link'}
              </button>
              <button type="button" onClick={closePreview}>Close</button>
            </div>
          </div>
          <div className="preview-stage">
            <iframe
              key={`${selectedRun.id}-${selectedPhase}`}
              scrolling="no"
              src={selectedPreviewPath}
              title={`${getRunTitle(selectedRun)} Phase ${selectedPhase} output`}
            />
          </div>
        </div>
      )}

      {selectedReport?.evaluation?.reportPath && (
        <div className="preview-overlay report-overlay" role="dialog" aria-modal="true" aria-label={`${getRunTitle(selectedReport)} evaluation report`}>
          <div className="preview-header">
            <div className="preview-identity report-identity">
              <StatusLight status={selectedReport.status} />
              <strong>{getRunTitle(selectedReport)}</strong>
              <span className="report-kind">Evaluation report</span>
              <span className="report-score">{floorScore(selectedReport.evaluation.score)}/100</span>
            </div>
            <div className="preview-tools">
              <button type="button" onClick={() => setSelectedReport(null)}>Close</button>
            </div>
          </div>
          <iframe className="report-frame" src={selectedReport.evaluation.reportPath} title={`${getRunTitle(selectedReport)} evaluation report`} />
        </div>
      )}
    </main>
  )
}

export default App

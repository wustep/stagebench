import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import runsData from './data/runs.json'
import protocol from './data/protocol.json'
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
import type { RawRunEntry, RunEntry, StageStatus, Telemetry } from './types'
import './App.css'

const TELEMETRY_FIELDS: Array<keyof Telemetry> = [
  'wallTimeSeconds', 'costUsd', 'inputTokens', 'outputTokens', 'reasoningTokens', 'toolCalls',
]

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
    protocolVersion: raw.protocolVersion ?? null,
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

// GPT5.6 runs are hidden from the main gallery until the visitor unlocks
// them at /secret (same access password, separate cookie set by middleware.js).
const EXTRA_MODEL_PREFIX = 'gpt-5.6'
const extraModelsUnlocked =
  typeof document !== 'undefined' &&
  document.cookie.split(';').some((entry) => entry.trim().startsWith('stagebench_extras='))

const runs = (runsData as RawRunEntry[])
  .map(normalizeRunEntry)
  .filter((run) => extraModelsUnlocked || !run.model.startsWith(EXTRA_MODEL_PREFIX))
// Phase display names come from the phase manifest via src/data/protocol.json
// (generated at reindex time); legacy/v2 mappings live there too because the
// current spec has no data for those retired protocol layouts.
const phaseNames = protocol.phaseNames
const v2PhaseNames = protocol.v2PhaseNames
const legacyPhaseNames = protocol.legacyPhaseNames
const knobAngles = [-86, -22, 43]
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

function formatTokens(value: number) {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${Math.round(value / 1e3)}k`
  return String(value)
}

function formatTelemetry(telemetry: RunEntry['telemetry']) {
  if (!telemetry) return null
  const parts: string[] = []
  if (typeof telemetry.costUsd === 'number') parts.push(`$${telemetry.costUsd.toFixed(2)}`)
  if (typeof telemetry.wallTimeSeconds === 'number') {
    const hours = Math.floor(telemetry.wallTimeSeconds / 3600)
    const minutes = Math.round((telemetry.wallTimeSeconds % 3600) / 60)
    parts.push(hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`)
  }
  if (typeof telemetry.inputTokens === 'number') parts.push(`${formatTokens(telemetry.inputTokens)} tok in`)
  if (typeof telemetry.outputTokens === 'number') parts.push(`${formatTokens(telemetry.outputTokens)} tok out`)
  if (typeof telemetry.reasoningTokens === 'number') parts.push(`${formatTokens(telemetry.reasoningTokens)} reasoning`)
  if (typeof telemetry.toolCalls === 'number') parts.push(`${telemetry.toolCalls} tool calls`)
  return parts.length > 0 ? parts.join(' · ') : null
}

// The full phase list for the protocol a run was recorded under. Rendering
// every protocol phase (not just the recorded stages) keeps the phase columns
// vertically aligned across rows, so scores can be compared at a glance.
function getPhaseList(run: RunEntry) {
  if (!run.legacy || String(run.protocolVersion ?? '').startsWith('3.')) return phaseNames
  if (run.stages.length === 4) return v2PhaseNames
  return legacyPhaseNames
}

function getPhaseName(run: RunEntry, phase: PhaseNumber) {
  return getPhaseList(run)[phase - 1]
}

function getResultClass(run: RunEntry) {
  if (run.legacy) return { id: 'legacy', label: 'Legacy', rank: 1, description: 'Runs recorded under earlier protocol versions, kept for reference with their frozen evaluation reports.' }
  return { id: 'current', label: `Protocol ${protocol.version}`, rank: 0, description: 'Benchmark evaluation reports are not rigorous and are just for fun.' }
}

function StatusLight({ status }: { status: StageStatus | RunEntry['status'] | 'off' }) {
  return <span className={`status-light status-${status}`} aria-hidden="true" />
}

function PlayIcon() {
  return (
    <svg className="play-icon" viewBox="0 0 10 12" width="10" height="12" aria-hidden="true">
      <path d="M0 0l10 6-10 6z" fill="currentColor" />
    </svg>
  )
}

function PreviewFrame({
  className,
  scrolling,
  src,
  title,
  frameKey,
}: {
  className?: string
  scrolling?: 'no'
  src: string
  title: string
  frameKey?: string
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  // Iframe error signaling is limited across origins, so pair the native
  // onError with a load-timeout heuristic that only fires while still loading.
  useEffect(() => {
    setState('loading')
    const timeout = window.setTimeout(() => {
      setState((current) => (current === 'loading' ? 'error' : current))
    }, 12000)
    return () => window.clearTimeout(timeout)
  }, [src])

  return (
    <div className="preview-frame-shell">
      {state === 'error' ? (
        <div className="preview-error" role="alert">
          <strong>Preview failed to load</strong>
          <p>The published build did not respond.</p>
          <code>{src}</code>
        </div>
      ) : (
        <>
          {state === 'loading' && (
            <div className="preview-loading" role="status">
              <span aria-hidden="true" className="loading-lights"><i /><i /><i /></span>
              <span>Loading build</span>
            </div>
          )}
          <iframe
            className={className}
            key={frameKey}
            onError={() => setState('error')}
            onLoad={() => setState('ready')}
            scrolling={scrolling}
            src={src}
            title={title}
          />
        </>
      )}
    </div>
  )
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
  const initialViewer = parseViewerSearch(window.location.search, runs)
  const [selectedRun, setSelectedRun] = useState<RunEntry | null>(
    initialViewer ? initialViewer.run as RunEntry : null,
  )
  const [selectedPhase, setSelectedPhase] = useState<PhaseNumber | null>(initialViewer?.phase ?? null)
  const [selectedReport, setSelectedReport] = useState<RunEntry | null>(null)
  const [showcaseOpen, setShowcaseOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [activeNotes, setActiveNotes] = useState<Set<number>>(() => new Set())
  const [lastPlayed, setLastPlayed] = useState<string | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const voicesRef = useRef(new Map<number, { oscillator: OscillatorNode; gain: GainNode; ended: boolean }>())
  const pressedKeysRef = useRef(new Set<string>())
  // The element that opened the current dialog, so focus can return to it on
  // close. Captured before the dialog mounts (the dialog steals focus).
  const dialogOpenerRef = useRef<HTMLElement | null>(null)
  const captureDialogOpener = useCallback(() => {
    dialogOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [])
  const visibleRuns = [...runs]
    .sort((left, right) => getResultClass(left).rank - getResultClass(right).rank || right.startedAt.localeCompare(left.startedAt))
  const activeCount = visibleRuns.filter((run) => run.status === 'in-progress').length
  const legacyCount = visibleRuns.filter((run) => run.legacy).length
  const currentCount = visibleRuns.length - legacyCount
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
    const voice = { oscillator, gain, ended: false }
    oscillator.onended = () => {
      voice.ended = true
      oscillator.disconnect()
      gain.disconnect()
    }
    oscillator.start(now)
    voicesRef.current.set(midi, voice)
    setLastPlayed(name)
    setActiveNotes((current) => new Set(current).add(midi))
  }, [])

  const overlayOpen = Boolean(selectedRun || selectedReport || showcaseOpen)

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
      else if (selectedRun) closePreview()
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [overlayOpen, showcaseOpen, selectedReport, selectedRun, closePreview])

  useEffect(() => {
    const syncViewerFromUrl = () => {
      const viewer = parseViewerSearch(window.location.search, runs)
      setSelectedRun(viewer ? viewer.run as RunEntry : null)
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
      // A voice may already have ended via its onended callback; calling stop()
      // on a stopped oscillator throws, so skip ended voices and guard the rest.
      for (const voice of voices.values()) {
        if (voice.ended) continue
        try {
          voice.oscillator.stop()
        } catch {
          // Oscillator already stopped or context torn down; nothing to do.
        }
      }
      voices.clear()
      if (audioContextRef.current) void audioContextRef.current.close()
    }
  }, [])

  return (
    <main>
      <a className="skip-link" href="#runs">Skip to runs</a>
      <header className="instrument-header">
        <nav className="topbar" aria-label="Primary navigation">
          <a className="wordmark" href="#runs" aria-label="Stagebench runs">
            <span>STAGEBENCH</span>
          </a>
          <a href="https://github.com/wustep/stagebench/blob/main/BENCHMARK.md">BENCHMARK.md</a>
        </nav>

        <div className="header-intro">
          <div>
            <h1>Nord Stage{'\u00A0'}4 benchmark</h1>
            <p>Coding agents recreate the Nord Stage 4 as a playable browser instrument in three cumulative phases — panel and Piano, Piano library and effects, then the complete system.</p>
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
              <strong aria-live="polite">{activeNotes.size > 0 ? `PLAYING ${lastPlayed}` : lastPlayed ? `LAST NOTE ${lastPlayed}` : activeCount > 0 ? runs.find((run) => run.status === 'in-progress')?.model : 'SELECT MODEL'}</strong>
            </div>
            <ol className="stage-controls" aria-label="Benchmark phases">
              {phaseNames.map((name, index) => (
                <li key={name}>
                  <div className="knob" aria-hidden="true">
                    <i style={{ transform: `rotate(${knobAngles[index]}deg)` }} />
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

      <section className="showcase-band" aria-labelledby="showcase-heading">
        <div className="showcase-copy">
          <span className="showcase-flag">Showcase</span>
          <h2 id="showcase-heading">The evolving Stage 4</h2>
          <p>Seeded from the top-scoring run, then iterated beyond the benchmark rules. Not scored against the gallery.</p>
        </div>
        <button type="button" className="open-preview showcase-play" onClick={() => { captureDialogOpener(); closePreview(); setSelectedReport(null); setShowcaseOpen(true) }}>
          Play <PlayIcon />
        </button>
      </section>

      <section className="run-index" id="runs">
        <div className="run-index-heading">
          <h2>Runs</h2>
          <div className="run-index-meta">
            <span>
              {legacyCount > 0
                ? `${currentCount} current · ${legacyCount} legacy`
                : `${visibleRuns.length} ${visibleRuns.length === 1 ? 'run' : 'runs'}`}
            </span>
          </div>
        </div>

        {visibleRuns.length > 0 ? (
          <div className="run-list">
            {visibleRuns.map((run, index) => {
              const resultClass = getResultClass(run)
              const previousClass = index > 0 ? getResultClass(visibleRuns[index - 1]).id : null
              const phaseList = getPhaseList(run)
              const telemetry = formatTelemetry(run.telemetry)
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
                    <span className="run-status"><StatusLight status={run.status} />{run.status.replace(/-/g, ' ')}</span>
                    <span className="model-target">{run.target}</span>
                  </div>
                  <h3>{getRunTitle(run)}</h3>
                  {run.score !== null && (
                    <div className="run-score" aria-label={`Aggregate evaluation ${floorScore(run.score)} out of 100`}>
                      <strong>{floorScore(run.score)}</strong>
                      <span>/100</span>
                    </div>
                  )}
                  <p>{formatDate(run.startedAt)}{run.model !== getRunTitle(run) && ` · ${run.model}`}</p>
                  {telemetry && <p className="run-telemetry">{telemetry}</p>}
                </div>

                <ol className="stage-track" aria-label={`${getRunTitle(run)} phase progress`} style={{ gridTemplateColumns: `repeat(${phaseList.length}, 1fr)` }}>
                  {phaseList.map((name, phaseIndex) => {
                    const phase = (phaseIndex + 1) as PhaseNumber
                    const stage = run.stages.find((candidate) => candidate.number === phase)
                    const score = stage?.score ?? null
                    return (
                      <li className={`stage-${stage?.status ?? 'off'}`} key={phase}>
                        <span>0{phase}</span>
                        <div><StatusLight status={stage?.status ?? 'off'} /><strong>{name}</strong></div>
                        <small>{score !== null ? `${floorScore(score)}/100` : stage ? (stage.status === 'complete' ? 'evaluation pending' : stage.status) : 'not run'}</small>
                        <span aria-hidden="true" className="stage-meter"><i style={{ width: `${score !== null ? Math.min(100, Math.max(0, score)) : 0}%` }} /></span>
                      </li>
                    )
                  })}
                </ol>

                <div className="run-actions">
                  {run.previewPath ? (
                    <button type="button" className="open-preview" onClick={() => openPreview(run)}>
                      Play <PlayIcon />
                    </button>
                  ) : (
                    <span className="preview-pending">No preview available</span>
                  )}
                  {run.reportPath && (
                    <button type="button" className="open-report" onClick={() => { captureDialogOpener(); closePreview(); setSelectedReport(run) }}>
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
            <div><h3>No runs yet</h3><p>Run <code>pnpm bench new</code> to add the first model.</p></div>
          </div>
        )}

        <section className="benchmark-details" aria-labelledby="stage-tests-heading">
          <h3 id="stage-tests-heading">What the three cumulative phases test</h3>
          <ol>
            <li><span>01</span><div><strong>Complete surface + basic Piano</strong><p>Exact visual hardware and keybed, one playable Piano voice, and honestly decorative panel controls.</p></div></li>
            <li><span>02</span><div><strong>Piano library + working effects</strong><p>Multiple distinct Pianos, two layers, detailed controls, shared audio graph, and connected effect families.</p></div></li>
            <li><span>03</span><div><strong>Complete Stage 4 system</strong><p>Programs, splits, scenes, morphs, Organ, Synth, full routing, and meaningful hardware bindings.</p></div></li>
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
                        onClick={() => changePreviewPhase(phase)}
                        type="button"
                      >
                        0{phase}
                      </button>
                    )
                  })}
                </div>
              )}
              <button className="copy-link" onClick={copyPreviewLink} type="button">
                {copyStatus === 'copied' ? 'Link copied' : copyStatus === 'failed' ? 'Copy failed' : 'Copy link'}
              </button>
              <button type="button" onClick={closePreview}>Close</button>
            </div>
          </div>
          <div className="preview-stage">
            <PreviewFrame
              frameKey={`${selectedRun.id}-${selectedPhase}`}
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
              <button type="button" onClick={() => setShowcaseOpen(false)}>Close</button>
            </div>
          </div>
          <div className="preview-stage">
            <PreviewFrame scrolling="no" src="/previews/showcase/index.html" title="Showcase Nord Stage 4" />
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
              <button type="button" onClick={() => setSelectedReport(null)}>Close</button>
            </div>
          </div>
          <PreviewFrame className="report-frame" src={selectedReport.reportPath} title={`${getRunTitle(selectedReport)} evaluation report`} />
        </div>
      )}
    </main>
  )
}

export default App

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
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
  'wallTimeSeconds', 'totalTokens', 'costUsd', 'inputTokens', 'outputTokens', 'reasoningTokens', 'toolCalls',
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
    harness: raw.harness ?? null,
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

// The secret cookie still unlocks private artifacts, but benchmark runs are
// always public in the gallery.
const artifactsUnlocked =
  typeof document !== 'undefined' &&
  document.cookie.split(';').some((entry) => entry.trim().startsWith('stagebench_extras='))

const runs = (runsData as RawRunEntry[])
  .map(normalizeRunEntry)
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
  KeyI: { label: 'I', midi: 72 },
  Digit9: { label: '9', midi: 73 },
  KeyO: { label: 'O', midi: 74 },
  Digit0: { label: '0', midi: 75 },
  KeyP: { label: 'P', midi: 76 },
}
const computerKeyLabels = new Map(
  Object.values(computerKeyboardNotes).map(({ label, midi }) => [midi, label]),
)
// The QWERTY map covers 29 semitones of the 48-key rail; the octave shift
// buttons (or -/= keys) slide it up so every note is reachable from the
// computer keyboard: shift 0 starts at C3, +2 tops out at the rail's B6.
const OCTAVE_SHIFT_MAX = 2
const HEADER_MIDI_MAX = 95
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

function formatDuration(value: number) {
  const totalSeconds = Math.round(value)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`
}

// Ultra-compact wall time for the leaderboard's TIME column ("4h27m",
// "20m29s"); the expanded details pane shows the full formatDuration string.
function formatDurationCompact(value: number) {
  const totalSeconds = Math.round(value)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours > 0) return `${hours}h${minutes}m`
  if (minutes > 0) return `${minutes}m${totalSeconds % 60}s`
  return `${totalSeconds}s`
}

// CSS modifier slug for a harness pill ("Claude Code" -> "claude-code").
function harnessSlug(harness: string) {
  return harness.toLowerCase().replace(/[^a-z0-9]+/g, '-')
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

function ChevronIcon() {
  return (
    <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 7v4.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="4.6" r="1" fill="currentColor" />
    </svg>
  )
}

function ReportIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <rect x="1" y="6.5" width="2.3" height="4.5" rx=".5" fill="currentColor" />
      <rect x="4.85" y="3.5" width="2.3" height="7.5" rx=".5" fill="currentColor" />
      <rect x="8.7" y="1" width="2.3" height="10" rx=".5" fill="currentColor" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path d="M1 1l10 10M11 1L1 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

// Miniature take on the Stage 4 pitch stick: drag sideways to bend held
// notes, springs back to center on release (pointer, keyboard, or focus loss).
function PitchStick({ bend, onBend }: { bend: number; onBend: (value: number) => void }) {
  const dragOriginRef = useRef<number | null>(null)

  return (
    <div
      aria-label="Pitch stick, bends held notes"
      aria-orientation="horizontal"
      aria-valuemax={1}
      aria-valuemin={-1}
      aria-valuenow={Math.round(bend * 100) / 100}
      className="toy-pitch-stick"
      role="slider"
      tabIndex={0}
      onBlur={() => onBend(0)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); onBend(bend - 0.25) }
        else if (event.key === 'ArrowRight') { event.preventDefault(); onBend(bend + 0.25) }
        else if (event.key === 'Home') { event.preventDefault(); onBend(0) }
      }}
      onKeyUp={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') onBend(0)
      }}
      onLostPointerCapture={() => { dragOriginRef.current = null; onBend(0) }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        dragOriginRef.current = event.clientX
      }}
      onPointerMove={(event) => {
        if (dragOriginRef.current === null) return
        onBend((event.clientX - dragOriginRef.current) / 44)
      }}
    >
      <span aria-hidden="true" className="toy-pitch-lever" style={{ transform: `translateX(${bend * 32}%)` }} />
    </div>
  )
}

// Miniature mod wheel: drag up for vibrato depth; the value latches like the
// hardware wheel (no spring back).
function ModWheel({ mod, onMod }: { mod: number; onMod: (value: number) => void }) {
  const dragStateRef = useRef<{ originY: number; startValue: number } | null>(null)

  return (
    <div
      aria-label="Mod wheel, adds vibrato"
      aria-orientation="vertical"
      aria-valuemax={1}
      aria-valuemin={0}
      aria-valuenow={Math.round(mod * 100) / 100}
      className="toy-mod-wheel"
      role="slider"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') { event.preventDefault(); onMod(mod + 0.1) }
        else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') { event.preventDefault(); onMod(mod - 0.1) }
        else if (event.key === 'Home') { event.preventDefault(); onMod(0) }
        else if (event.key === 'End') { event.preventDefault(); onMod(1) }
      }}
      onLostPointerCapture={() => { dragStateRef.current = null }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        dragStateRef.current = { originY: event.clientY, startValue: mod }
      }}
      onPointerMove={(event) => {
        const drag = dragStateRef.current
        if (!drag) return
        onMod(drag.startValue + (drag.originY - event.clientY) / 56)
      }}
    >
      <span aria-hidden="true" className="toy-wheel-face">
        <i className="toy-wheel-dimple" style={{ top: `${84 - mod * 68}%` }} />
      </span>
    </div>
  )
}

function KeyboardRail({
  activeNotes,
  octaveShift,
  onNoteOn,
  onNoteOff,
}: {
  activeNotes: Set<number>
  octaveShift: number
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
        // Key-hint chips follow the octave shift so they always sit on the
        // keys the computer keyboard currently plays.
        const whiteShortcut = computerKeyLabels.get(white.midi - octaveShift * 12)
        const blackShortcut = black ? computerKeyLabels.get(black.midi - octaveShift * 12) : undefined

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
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [showcaseOpen, setShowcaseOpen] = useState(false)
  const [protocolInfoOpen, setProtocolInfoOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [activeNotes, setActiveNotes] = useState<Set<number>>(() => new Set())
  const [lastPlayed, setLastPlayed] = useState<string | null>(null)
  const [bend, setBend] = useState(0)
  const [mod, setMod] = useState(0)
  const [octaveShift, setOctaveShift] = useState(0)
  const audioContextRef = useRef<AudioContext | null>(null)
  const voicesRef = useRef(new Map<number, { oscillator: OscillatorNode; gain: GainNode; ended: boolean }>())
  // Shared modulation graph: pitch stick detunes every voice directly, the
  // mod wheel scales one vibrato LFO that feeds each oscillator's detune.
  const bendCentsRef = useRef(0)
  const modDepthRef = useRef(0)
  const lfoRef = useRef<{ oscillator: OscillatorNode; gain: GainNode } | null>(null)
  const masterRef = useRef<GainNode | null>(null)
  // Each held computer key remembers the actual MIDI note it started, so a
  // mid-hold octave change still releases the right voice.
  const pressedKeysRef = useRef(new Map<string, number>())
  const octaveShiftRef = useRef(0)
  // The element that opened the current dialog, so focus can return to it on
  // close. Captured before the dialog mounts (the dialog steals focus).
  const dialogOpenerRef = useRef<HTMLElement | null>(null)
  const captureDialogOpener = useCallback(() => {
    dialogOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [])
  // Leaderboard ordering: within each result tier, rank by aggregate score
  // (highest first) so the gallery's job — comparing model results — is legible
  // at a glance. Runs still in progress have no score yet, so they sink below
  // the scored runs of their tier; newest-first breaks any remaining ties.
  const visibleRuns = [...runs]
    .sort((left, right) =>
      getResultClass(left).rank - getResultClass(right).rank
      || (right.score ?? -1) - (left.score ?? -1)
      || right.startedAt.localeCompare(left.startedAt))
  const activeCount = visibleRuns.filter((run) => run.status === 'in-progress').length
  // Position among the scored runs of each tier, so "#1" always names the top
  // score of its protocol group. Unscored (in-progress) runs get no rank.
  const rankByRun = new Map<string, number>()
  const tierRankCounter = new Map<string, number>()
  for (const run of visibleRuns) {
    if (run.score === null) continue
    const tierId = getResultClass(run).id
    const next = (tierRankCounter.get(tierId) ?? 0) + 1
    tierRankCounter.set(tierId, next)
    rankByRun.set(run.id, next)
  }
  // The field's best score per phase within each tier — the timing-tower
  // "fastest split" highlight, so per-phase winners read independently of
  // the aggregate ranking.
  const bestByTierPhase = new Map<string, number>()
  for (const run of visibleRuns) {
    const tierId = getResultClass(run).id
    for (const stage of run.stages) {
      if (stage.score === null) continue
      const key = `${tierId}:${stage.number}`
      bestByTierPhase.set(key, Math.max(bestByTierPhase.get(key) ?? -1, stage.score))
    }
  }
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

  const ensureAudioContext = useCallback(() => {
    const context = audioContextRef.current ?? new AudioContext()
    audioContextRef.current = context
    if (context.state === 'suspended') void context.resume()

    if (!masterRef.current) {
      // Soft-knee limiter keeps big chords from clipping now that the toy
      // encourages mashing many keys with vibrato on top.
      const compressor = context.createDynamicsCompressor()
      compressor.threshold.value = -14
      compressor.knee.value = 20
      compressor.ratio.value = 8
      const master = context.createGain()
      master.gain.value = 0.9
      master.connect(compressor)
      compressor.connect(context.destination)
      masterRef.current = master
    }

    if (!lfoRef.current) {
      const oscillator = context.createOscillator()
      oscillator.type = 'sine'
      oscillator.frequency.value = 5.6
      const gain = context.createGain()
      gain.gain.value = modDepthRef.current * 32
      oscillator.connect(gain)
      oscillator.start()
      lfoRef.current = { oscillator, gain }
    }

    return context
  }, [])

  const applyBend = useCallback((value: number) => {
    const next = clamp(value, -1, 1)
    setBend(next)
    bendCentsRef.current = next * 200
    const context = audioContextRef.current
    if (!context) return
    for (const voice of voicesRef.current.values()) {
      voice.oscillator.detune.setTargetAtTime(bendCentsRef.current, context.currentTime, 0.012)
    }
  }, [])

  const shiftOctave = useCallback((delta: number) => {
    setOctaveShift((current) => {
      const next = clamp(current + delta, 0, OCTAVE_SHIFT_MAX)
      octaveShiftRef.current = next
      return next
    })
  }, [])

  const applyMod = useCallback((value: number) => {
    const next = clamp(value, 0, 1)
    setMod(next)
    modDepthRef.current = next
    const context = audioContextRef.current
    if (context && lfoRef.current) {
      lfoRef.current.gain.gain.setTargetAtTime(next * 32, context.currentTime, 0.05)
    }
  }, [])

  const startHeaderNote = useCallback((midi: number, name: string) => {
    if (voicesRef.current.has(midi)) return

    const context = ensureAudioContext()

    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const now = context.currentTime
    oscillator.type = 'triangle'
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12)
    oscillator.detune.value = bendCentsRef.current
    lfoRef.current?.gain.connect(oscillator.detune)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.018)
    gain.gain.exponentialRampToValueAtTime(0.075, now + 0.8)
    oscillator.connect(gain)
    gain.connect(masterRef.current ?? context.destination)
    const voice = { oscillator, gain, ended: false }
    oscillator.onended = () => {
      voice.ended = true
      lfoRef.current?.gain.disconnect(oscillator.detune)
      oscillator.disconnect()
      gain.disconnect()
    }
    oscillator.start(now)
    voicesRef.current.set(midi, voice)
    setLastPlayed(name)
    setActiveNotes((current) => new Set(current).add(midi))
  }, [ensureAudioContext])

  const overlayOpen = Boolean(selectedRun || selectedReport || showcaseOpen || protocolInfoOpen)

  const openProtocolInfo = useCallback(() => {
    captureDialogOpener()
    closePreview()
    setSelectedReport(null)
    setShowcaseOpen(false)
    setProtocolInfoOpen(true)
  }, [captureDialogOpener, closePreview])

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
      for (const midi of pressedKeys.values()) {
        stopHeaderNote(midi)
      }
      pressedKeys.clear()
    }

    if (overlayOpen) {
      releasePressedKeys()
      return
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return

      const target = event.target
      if (target instanceof HTMLElement && (
        target.isContentEditable || target.matches('input, textarea, select')
      )) return

      if (event.code === 'Minus' || event.code === 'Equal') {
        event.preventDefault()
        shiftOctave(event.code === 'Minus' ? -1 : 1)
        return
      }

      const note = computerKeyboardNotes[event.code]
      if (!note || pressedKeys.has(event.code)) return

      const midi = note.midi + octaveShiftRef.current * 12
      if (midi > HEADER_MIDI_MAX) return

      event.preventDefault()
      pressedKeys.set(event.code, midi)
      startHeaderNote(midi, headerNoteNames[midi])
    }

    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      const midi = pressedKeys.get(event.code)
      if (midi === undefined) return

      event.preventDefault()
      pressedKeys.delete(event.code)
      stopHeaderNote(midi)
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
  }, [overlayOpen, shiftOctave, startHeaderNote, stopHeaderNote])

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
        <div className="header-intro">
          <div>
            <span className="header-eyebrow">Unofficial fan project</span>
            <h1>Nord Stage{'\u00A0'}4 benchmark</h1>
            <p>Coding agents rebuild the Nord Stage{' '}4 as a playable browser instrument.</p>
          </div>
          <a className="github-link" href="https://github.com/wustep/stagebench" rel="noopener" target="_blank">
            <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" fill="currentColor" />
            </svg>
            <span>GitHub</span>
          </a>
        </div>

        <div className="instrument-shell">
          <div className="toy-top-rail" aria-hidden="true">
            <span>PEDALS</span>
            <span>MIDI</span>
            <span>USB</span>
            <span>MONITOR</span>
            <span>OUTPUT</span>
          </div>

          <div className="control-deck" aria-label="Benchmark status">
            <section className="deck-performance" aria-label="Performance controls">
              <div className="wheel-park">
                <div className="wheel-well">
                  <PitchStick bend={bend} onBend={applyBend} />
                  <span aria-hidden="true" className="wheel-legend">PITCH</span>
                </div>
                <div className="wheel-well">
                  <ModWheel mod={mod} onMod={applyMod} />
                  <span aria-hidden="true" className="wheel-legend">MOD</span>
                </div>
                <div className="wheel-well octave-well">
                  <div className="octave-buttons">
                    <button
                      aria-label="Keyboard octave down, shortcut minus key"
                      disabled={octaveShift === 0}
                      onClick={() => shiftOctave(-1)}
                      type="button"
                    >
                      &minus;
                    </button>
                    <button
                      aria-label="Keyboard octave up, shortcut equals key"
                      disabled={octaveShift === OCTAVE_SHIFT_MAX}
                      onClick={() => shiftOctave(1)}
                      type="button"
                    >
                      +
                    </button>
                  </div>
                  <span
                    aria-label={`Keyboard octave shift ${octaveShift === 0 ? 'off' : `plus ${octaveShift}`}`}
                    className="octave-leds"
                    role="status"
                  >
                    {[0, 1, 2].map((step) => (
                      <i className={step === octaveShift ? 'is-on' : undefined} key={step} />
                    ))}
                  </span>
                  <span aria-hidden="true" className="wheel-legend">OCTAVE</span>
                </div>
              </div>
              <div className="toy-branding" aria-hidden="true">
                <span className="brand-line">stagebench</span>
                <span className="brand-sub">TOY ACTION 48</span>
              </div>
            </section>

            <section className="deck-plate plate-benchmark" aria-label="Benchmark counters">
              <header className="plate-tab" aria-hidden="true">BENCHMARK</header>
              <div className="plate-body readout-body">
                <div className="panel-readout">
                  <small>RUNS</small>
                  <strong>{String(visibleRuns.length).padStart(2, '0')}</strong>
                </div>
                <div className="panel-readout">
                  <small>ACTIVE</small>
                  <strong>{String(activeCount).padStart(2, '0')}</strong>
                </div>
              </div>
            </section>

            <section className="deck-plate plate-program" aria-label="Program display">
              <header className="plate-tab" aria-hidden="true">
                PROGRAM
                <span className={`toy-led${activeNotes.size > 0 ? ' is-on' : ''}`} />
              </header>
              <div className="plate-body">
                <div className="oled-display">
                  <span>{activeCount > 0 ? 'BENCHMARK RUNNING' : 'SYSTEM READY'}</span>
                  <strong aria-live="polite">{activeNotes.size > 0 ? `PLAYING ${lastPlayed}` : lastPlayed ? `LAST NOTE ${lastPlayed}` : activeCount > 0 ? runs.find((run) => run.status === 'in-progress')?.model : 'SELECT MODEL'}</strong>
                </div>
              </div>
            </section>

            <section className="deck-plate plate-phases" aria-label="Benchmark phases">
              <header className="plate-tab" aria-hidden="true">PHASES</header>
              <ol className="stage-controls plate-body">
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
            </section>
          </div>

          <div className="toy-keys">
            <div className="end-cheek left" aria-hidden="true" />
            <KeyboardRail activeNotes={activeNotes} octaveShift={octaveShift} onNoteOff={stopHeaderNote} onNoteOn={startHeaderNote} />
            <div className="end-cheek right" aria-hidden="true" />
          </div>
          <div className="toy-bottom-rail" aria-hidden="true" />
          <span className="toy-foot left" aria-hidden="true" />
          <span className="toy-foot right" aria-hidden="true" />
        </div>
      </header>

      <section className="showcase-band" aria-labelledby="showcase-heading">
        <div className="showcase-copy">
          <span className="showcase-flag">Featured showcase</span>
          <h2 id="showcase-heading">The evolving Stage 4</h2>
          <p>Seeded from the top-scoring run, then iterated beyond the benchmark rules. Not scored against the gallery.</p>
        </div>
        <button type="button" className="open-preview showcase-play" onClick={() => { captureDialogOpener(); closePreview(); setSelectedReport(null); setShowcaseOpen(true) }}>
          <span>Play the showcase</span> <PlayIcon />
        </button>
      </section>

      <section className="run-index" id="runs">
        <div className="run-index-heading">
          <h2>Runs</h2>
        </div>

        {visibleRuns.length > 0 ? (
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
                          onClick={openProtocolInfo}
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
                  onClick={playable ? () => openPreview(run) : undefined}
                  style={sectorsStyle}
                >
                  <span className="pos">
                    <b aria-hidden="true">{rank ?? '—'}</b>
                    {playable && (
                      <button
                        aria-label={`Play ${getRunTitle(run)}${rank !== null ? `, ranked ${rank}` : ''}`}
                        className="pos-play"
                        onClick={(event) => { event.stopPropagation(); openPreview(run) }}
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
                    onClick={(event) => { event.stopPropagation(); setExpandedRunId(expanded ? null : run.id) }}
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
                      <button type="button" className="open-report" onClick={() => { captureDialogOpener(); closePreview(); setSelectedReport(run) }}>
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

      {protocolInfoOpen && (
        <div className="modal-backdrop" onClick={() => setProtocolInfoOpen(false)}>
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
              <button aria-label="Close" onClick={() => setProtocolInfoOpen(false)} type="button">
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

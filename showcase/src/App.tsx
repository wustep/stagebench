import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  realAssetBoundary,
  realAudioBoundary,
  realMidiBoundary,
  realStorageBoundary,
  type AssetBoundary,
  type AudioBoundary,
  type MidiBoundary,
  type StorageBoundary,
} from './audio/boundaries'
import { PianoEngine, type EngineStatusInfo } from './audio/engine'
import { InstrumentController } from './input/controller'
import { KEY_CODE_TO_MIDI, KEYBOARD_VELOCITY, SOFT_KEY_CODE, SOSTENUTO_KEY_CODE, SUSTAIN_KEY_CODE } from './input/keymap'
import { MidiInputManager, type MidiStatusInfo } from './input/midi'
import { parseMidiFile } from './input/midi-file'
import { MidiFilePlayer, type MidiPlayerState } from './input/midi-player'
import { Keybed } from './components/Keybed'
import {
  EffectsSection,
  OrganSection,
  PerformanceSection,
  PianoSection,
  ProgramSection,
  SynthSection,
} from './components/sections'
import { SectionZoomOverlay } from './components/section-zoom'
import { PresentationStore } from './state/presentation'
import { InstrumentStore } from './state/instrument'
import { VARIANT } from './model/variant'

/** Sections that offer the inspect/zoom affordance (those with a plate-title). */
type ZoomableSectionId = 'organ' | 'piano' | 'synth' | 'effects'
const ZOOM_TITLES: Record<ZoomableSectionId, string> = { organ: 'Organ', piano: 'Piano', synth: 'Synth', effects: 'Layer Effects' }

/** CSS cursor values the panel actually uses (styles.css): `pointer` on
 *  buttons, `ns-resize` on knob/fader/drawbar/wheel drags, `ew-resize` on the
 *  pitch stick; anything else falls back to the plain arrow. */
const LENS_CURSOR_KINDS = ['pointer', 'ns-resize', 'ew-resize'] as const

/** Browsers never expose the real cursor bitmap, so the lens draws its own
 *  OS-styled artwork: macOS's black arrow with a white outline vs the
 *  Windows-style white arrow with a black outline. */
const LENS_CURSOR_OS: 'mac' | 'win' = /mac/i.test(
  (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '',
)
  ? 'mac'
  : 'win'

/** Rear-connector legends printed along the top lip, [label, left%] pairs
 *  pixel-measured from reference/nord-stage-4-73.jpg. Multi-line labels wrap
 *  at the \n like the reference's stacked print. */
const REAR_LEGENDS: [string, number][] = [
  ['MONITOR\nIN', 15],
  ['HEAD\nPHONES', 16.5],
  ['OUT 1 — OUT 2', 18.5],
  ['OUT 3 — OUT 4', 21.4],
  ['CONTROL\nPEDAL', 23.5],
  ['ORGAN\nSWELL', 25.1],
  ['SUSTAIN\nPEDAL', 26.7],
  ['TRIPLE\nPEDAL', 28.3],
  ['MIDI IN', 33.4],
  ['MIDI OUT', 38.1],
  ['ROTOR\nPEDAL', 40.3],
  ['USB', 41.9],
  ['FOOT\nSWITCH', 43.4],
  ['AC IN', 61],
  ['POWER ON/OFF', 65.3],
]

/** Chassis-screw left% offsets along the deck's bottom lip (reference photo);
 *  rendered on the real deck and again in the magnifier lens clone. */
const DECK_SCREWS = [13.6, 32.6, 40.7, 52.6, 76.4, 94.8]

/** Reference-overlay compare tool. The photo is served by the dev server's
 *  /reference bridge (vite.config.ts) from the repo-root reference/ dir, or
 *  on production by middleware.js (proxied from Nord's CDN — public, no
 *  /secret unlock required). Gitignored locally and never bundled —
 *  unavailable without one of those routes. */
const REFERENCE_PHOTO_URL = '/reference/nord-stage-4-73.jpg'
/** The chassis' bounding box inside that photo, as fractions of the full
 *  frame (the product shot has white margins and a gray drop shadow).
 *  Measured as the bbox of red-dominant pixels (r − max(g,b) > 30) on a
 *  1450px-wide rasterization. The overlay stretches the photo so this box
 *  lands exactly on the rendered chassis (photo crop aspect 3.17 vs chassis
 *  3.0951 — alignment at the edges beats preserving the ~2% difference). */
const REFERENCE_PHOTO_CROP = { x: 0.1117, y: 0.1222, w: 0.7766, h: 0.735 }

/** The rendered chassis' center expressed in photo coordinates — the pivot
 *  for the alignment-nudge scale, so scaling zooms about what you look at. */
const REFERENCE_PHOTO_ORIGIN = `${(REFERENCE_PHOTO_CROP.x + REFERENCE_PHOTO_CROP.w / 2) * 100}% ${(REFERENCE_PHOTO_CROP.y + REFERENCE_PHOTO_CROP.h / 2) * 100}%`

type OverlayMode = 'ghost' | 'diff' | 'wipe'
/** Photo alignment nudge: dx/dy in % of the chassis box, scale about its
 *  center. Compensates the photo-vs-render aspect residue (crop 3.17 vs
 *  chassis 3.0951) so diff mode can be zeroed onto the region under study. */
interface OverlayNudge {
  dx: number
  dy: number
  scale: number
}
const NUDGE_IDENTITY: OverlayNudge = { dx: 0, dy: 0, scale: 1 }

// Same cookie gate as the main gallery (/secret in middleware.js): on
// production this unlocks the extra dev tools (e.g. Measure). The
// reference-photo proxy is public and needs no unlock.
const extraModelsUnlocked =
  typeof document !== 'undefined' &&
  document.cookie.split(';').some((entry) => entry.trim().startsWith('stagebench_extras='))
const showDevTools = import.meta.env.DEV || extraModelsUnlocked
const overlayMissingMessage = import.meta.env.DEV
  ? 'reference photo unavailable — dev server with reference/ fetched (pnpm bench fetch)'
  : 'reference photo unavailable — upstream fetch failed; try again later'

/** Dev-only measure tool: a drag-drawn bounding box over the chassis. The
 *  geometry (x/y/w/h) is stored as FRACTIONS of the chassis box — x and w of
 *  its width, y and h of its height — so drawn boxes stay pinned through
 *  window resizes. The printed measurements are snapshotted from the chassis
 *  rect at draw time; cqw is the canonical unit (1cqw = 1% of chassis width,
 *  the unit every panel CSS size uses — the visual spec's fractions are
 *  cqw/100), with raw px and % of chassis height alongside. */
interface MeasureBox {
  x: number
  y: number
  w: number
  h: number
  wCqw: number
  hCqw: number
  hPctH: number
  wPx: number
  hPx: number
}

/** Live pointer position for the measure readout, chassis-relative. */
interface MeasureCursor {
  xCqw: number
  yCqw: number
  yPctH: number
  xPx: number
  yPx: number
}

/** The photo ghosted over a chassis box. Rendered inside the real chassis
 *  and again inside the magnifier's lens clone, so the loupe magnifies the
 *  comparison too. Non-interactive; mode paints via data-mode (styles.css):
 *  ghost = plain opacity, diff = mix-blend-mode difference (matches go
 *  black), wipe = photo clipped to the left of the seam. */
function ReferenceGhost({
  mode,
  opacity,
  wipe,
  nudge,
  testId,
  onError,
}: {
  mode: OverlayMode
  opacity: number
  wipe: number
  nudge: OverlayNudge
  testId?: string
  onError?: () => void
}) {
  // translate() percentages resolve against the img's own box (1/crop.w of
  // the chassis wide), so chassis-relative nudges scale down by the crop.
  const dxImg = +(nudge.dx * REFERENCE_PHOTO_CROP.w).toFixed(4)
  const dyImg = +(nudge.dy * REFERENCE_PHOTO_CROP.h).toFixed(4)
  return (
    <div
      className="reference-overlay"
      data-mode={mode}
      data-testid={testId}
      aria-hidden="true"
      style={{
        opacity,
        clipPath: mode === 'wipe' ? `inset(0 ${100 - wipe}% 0 0)` : undefined,
      }}
    >
      {/* The full product shot, offset/stretched so its measured chassis
          bbox covers this element (= the chassis box); the chassis'
          overflow:hidden clips the photo's margins. */}
      <img
        src={REFERENCE_PHOTO_URL}
        alt=""
        draggable={false}
        style={{
          left: `${(-REFERENCE_PHOTO_CROP.x / REFERENCE_PHOTO_CROP.w) * 100}%`,
          top: `${(-REFERENCE_PHOTO_CROP.y / REFERENCE_PHOTO_CROP.h) * 100}%`,
          width: `${100 / REFERENCE_PHOTO_CROP.w}%`,
          height: `${100 / REFERENCE_PHOTO_CROP.h}%`,
          transform: `translate(${dxImg}%, ${dyImg}%) scale(${nudge.scale})`,
          transformOrigin: REFERENCE_PHOTO_ORIGIN,
        }}
        onError={onError}
      />
    </div>
  )
}

/** Minimal floating transport for dropped-MIDI playback: play/pause,
 *  restart, a thin progress bar, and close. Also surfaces a read error.
 *  Subscribes to the player itself so the 100 ms position updates re-render
 *  only this strip — not the whole App tree above it. */
function MidiTransport({
  player,
  error,
  onDismissError,
}: {
  player: MidiFilePlayer
  error: string | null
  onDismissError: () => void
}) {
  const state = useMidiPlayer(player)
  if (error && state.status === 'idle') {
    return (
      <div className="midi-transport is-error" role="alert" data-testid="midi-transport">
        <span className="midi-transport-name">{error}</span>
        <button type="button" className="midi-transport-btn" aria-label="Dismiss" onClick={onDismissError}>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
          </svg>
        </button>
      </div>
    )
  }
  const playing = state.status === 'playing'
  const progress = state.durationSec > 0 ? Math.min(1, state.positionSec / state.durationSec) : 0
  return (
    <div className="midi-transport" data-testid="midi-transport" data-status={state.status}>
      <button
        type="button"
        className="midi-transport-btn"
        aria-label={playing ? 'Pause' : 'Play'}
        data-testid="midi-transport-play"
        onClick={() => player.toggle()}
      >
        {playing ? (
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2.5" y="2" width="2.6" height="8" rx="0.5" fill="currentColor" />
            <rect x="6.9" y="2" width="2.6" height="8" rx="0.5" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 2 L10 6 L3 10 Z" fill="currentColor" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="midi-transport-btn"
        aria-label="Restart"
        data-testid="midi-transport-restart"
        onClick={() => player.restart()}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M6 2.2 A3.8 3.8 0 1 1 2.4 7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <path d="M6 0.6 L6 3.8 L3.4 2.2 Z" fill="currentColor" />
        </svg>
      </button>
      <div className="midi-transport-body">
        <span className="midi-transport-name" title={state.name ?? undefined}>
          {state.name}
        </span>
        <span className="midi-transport-bar" aria-hidden="true">
          <span className="midi-transport-fill" style={{ width: `${progress * 100}%` }} />
        </span>
      </div>
      <span className="midi-transport-time" aria-hidden="true">
        {formatClock(state.positionSec)} / {formatClock(state.durationSec)}
      </span>
      <button
        type="button"
        className="midi-transport-btn"
        aria-label="Close"
        data-testid="midi-transport-close"
        onClick={() => player.close()}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
        </svg>
      </button>
    </div>
  )
}

/** Persisted UI chrome preferences (stagebench.ui.v1). */
interface UiPrefs {
  chrome: 'minimal' | 'full'
  theme: 'light' | 'dark'
  panelHidden: boolean
}

export interface AppProps {
  audioBoundary?: AudioBoundary
  midiBoundary?: MidiBoundary
  assetBoundary?: AssetBoundary
  storageBoundary?: StorageBoundary
  panelClock?: () => number
}

function useEngineStatus(engine: PianoEngine): EngineStatusInfo {
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.getStatus(),
  )
}

function useMidiStatus(midi: MidiInputManager): MidiStatusInfo {
  return useSyncExternalStore(
    (listener) => midi.subscribe(listener),
    () => midi.getStatus(),
  )
}

function useMidiPlayer(player: MidiFilePlayer): MidiPlayerState {
  return useSyncExternalStore(player.subscribe, player.getState)
}

/** App-level subscription narrowed to the transport's visibility: the
 *  100 ms playback-position emits produce a fresh state object each time,
 *  and the full-state snapshot re-rendered the entire App tree on every one. */
function useMidiPlayerStatus(player: MidiFilePlayer): MidiPlayerState['status'] {
  return useSyncExternalStore(player.subscribe, () => player.getState().status)
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function usePedals(controller: InstrumentController): { sustain: boolean; sostenuto: boolean; soft: boolean } {
  const sustain = useSyncExternalStore(controller.subscribe, () => controller.isSustainDown())
  const sostenuto = useSyncExternalStore(controller.subscribe, () => controller.isSostenutoDown())
  const soft = useSyncExternalStore(controller.subscribe, () => controller.isSoftDown())
  return { sustain, sostenuto, soft }
}

function useControlPedal(instrument: InstrumentStore): number {
  return useSyncExternalStore(instrument.subscribe, () => instrument.getState().morphValues.pedal)
}

/** Tracks a CSS media query. jsdom (unit tests) and SSR have no matchMedia,
 *  so the query is treated as not matching there — the small-screen notice
 *  stays hidden by default and only a real narrow browser viewport shows it. */
function useMediaQuery(query: string): boolean {
  const matches = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false
  const subscribe = useCallback(
    (listener: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener('change', listener)
      return () => mql.removeEventListener('change', listener)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, matches, () => false)
}

declare global {
  interface Window {
    /** Diagnostics hook for browser-based signal verification only. */
    __stagebench?: { engine: PianoEngine; controller: InstrumentController; instrument: InstrumentStore }
  }
}

export default function App({ audioBoundary, midiBoundary, assetBoundary, storageBoundary, panelClock }: AppProps = {}) {
  const system = useMemo(() => {
    const storage = storageBoundary ?? realStorageBoundary()
    const instrument = new InstrumentStore(storage)
    const engine = new PianoEngine(audioBoundary ?? realAudioBoundary(), {
      assets: assetBoundary ?? realAssetBoundary(),
    })
    engine.attachStore(instrument)
    const controller = new InstrumentController(engine)
    const store = new PresentationStore({ instrument, controller, now: panelClock })
    const clock = panelClock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
    // Pedal Tap (manual p. 41): while enabled, the sustain pedal is
    // re-assigned to tap tempo — presses feed the Mst Clk tap estimator
    // (edge-detected, so continuous CC64 streams tap once per press) and the
    // damper stays up. Every sustain input path routes through here.
    let tapPedalDown = false
    const sustainInput = (value: boolean | number): void => {
      if (instrument.getState().masterClock.pedalTap) {
        const down = typeof value === 'boolean' ? value : value >= 0.5
        if (down && !tapPedalDown) instrument.tapMasterClock(clock())
        tapPedalDown = down
        if (controller.isSustainDown()) controller.setSustain(false)
        return
      }
      tapPedalDown = false
      controller.setSustain(value)
    }
    const midi = new MidiInputManager({
      noteOn: (note, velocity) => controller.noteOn(note, velocity, 'midi'),
      noteOff: (note) => controller.noteOff(note, 'midi'),
      setSustain: (value) => sustainInput(value),
      setSostenuto: (down) => controller.setSostenuto(down),
      setSoft: (down) => controller.setSoft(down),
      setControlPedal: (value) => instrument.setMorphSource('pedal', value * 127),
      // CC1 drives the canonical Wheel morph value; the on-screen wheel reads
      // the same value, so it follows the hardware wheel's position.
      setModWheel: (value) => instrument.setMorphSource('wheel', value * 127),
      // Channel pressure drives the A.T. morph source (audit E10) — the one
      // morph source with no on-screen input of its own.
      setAftertouch: (value) => instrument.setMorphSource('at', value * 127),
      // Pitch bend routes through the panel's own pitch-stick handler so the
      // on-screen stick mirrors the device (engine bend + local visual).
      setPitchBend: (value) => store.setValue('perf-pitch-stick', value * 100),
      // Real-time clock ticks lock the master clock to the device's tempo.
      setExternalClock: (bpm) => instrument.setExternalClock(bpm),
      onDisconnectCleanup: () => {
        controller.allNotesOff('midi-disconnect')
        instrument.setExternalClock(null)
      },
    })
    const midiPlayer = new MidiFilePlayer(controller)
    return { engine, controller, midi, store, instrument, storage, sustainInput, midiPlayer }
    // The instrument system is created once per mounted app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { engine, controller, midi, store, instrument, sustainInput, midiPlayer } = system
  const engineStatus = useEngineStatus(engine)
  const midiStatus = useMidiStatus(midi)
  const pedals = usePedals(controller)
  const controlPedal = useControlPedal(instrument)
  const midiPlaybackStatus = useMidiPlayerStatus(midiPlayer)

  // Drag-and-drop MIDI file playback. A dragged file shows a minimal drop
  // scrim over the whole app; dropping a .mid/.midi parses and plays it
  // through the currently selected sound, with a compact transport for
  // pause/restart. dragCounter tracks enter/leave so nested elements don't
  // flicker the indicator off mid-drag.
  const [midiDragging, setMidiDragging] = useState(false)
  const [midiError, setMidiError] = useState<string | null>(null)
  const dragCounter = useRef(0)

  const hasMidiFiles = (event: ReactDragEvent) =>
    Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file')

  const onMidiDragEnter = (event: ReactDragEvent) => {
    if (!hasMidiFiles(event)) return
    event.preventDefault()
    dragCounter.current += 1
    setMidiDragging(true)
  }
  const onMidiDragOver = (event: ReactDragEvent) => {
    if (!hasMidiFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
  const onMidiDragLeave = (event: ReactDragEvent) => {
    if (dragCounter.current === 0) return
    event.preventDefault()
    dragCounter.current -= 1
    if (dragCounter.current === 0) setMidiDragging(false)
  }
  const onMidiDrop = (event: ReactDragEvent) => {
    event.preventDefault()
    dragCounter.current = 0
    setMidiDragging(false)
    const file = event.dataTransfer.files[0]
    if (!file) return
    if (!/\.midi?$/i.test(file.name)) {
      setMidiError('Not a MIDI file — drop a .mid or .midi')
      return
    }
    setMidiError(null)
    file
      .arrayBuffer()
      .then((buffer) => midiPlayer.loadAndPlay(parseMidiFile(buffer, file.name)))
      .catch(() => setMidiError("Couldn't read that MIDI file"))
  }

  // Dispose the file player on unmount alongside the controller.
  useEffect(() => () => midiPlayer.dispose(), [midiPlayer])

  // Section-inspect/zoom overlay (narrow-legend-legibility): additive and
  // opt-in — the default deck layout never changes, only this state gates
  // an extra portaled overlay rendering the same section again, larger.
  const [zoomedSection, setZoomedSection] = useState<ZoomableSectionId | null>(null)

  // Magnifier loupe: while toggled on, a floating lens follows the pointer
  // over the whole chassis — control deck AND keybed — showing a 2.6x view
  // of the instrument under the cursor. The lens content is a second, inert
  // render of the chassis (aria-hidden, pointer-events none) — purely
  // visual, the real instrument stays interactive: notes played under the
  // loupe light up inside it (the clone is live). Cloning the full chassis
  // means the view past the edges shows what is really there — page
  // background above/beside — instead of a flat red fill.
  const [magnify, setMagnify] = useState(false)
  const realChassisRef = useRef<HTMLDivElement>(null)

  // Reference-photo overlay: opt-in ghost of the real Nord Stage 4 product
  // shot stretched over the chassis at adjustable opacity, for eyeballing
  // visual drift against reference/nord-stage-4-73.jpg. Always off by
  // default and never persisted — it is a compare tool, not panel paint
  // (the visual spec forbids rendering the reference as background).
  const [overlay, setOverlay] = useState(false)
  const [overlayOpacity, setOverlayOpacity] = useState(50)
  const [overlayMissing, setOverlayMissing] = useState(false)
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('ghost')
  // Wipe seam position, % of chassis width; photo shows left of the seam.
  const [overlayWipe, setOverlayWipe] = useState(50)
  const [overlayNudge, setOverlayNudge] = useState<OverlayNudge>(NUDGE_IDENTITY)
  // Blink compare: while V is held the ghost snaps to the full photo
  // (mode ghost, opacity 100), release returns to the configured view —
  // position drift "jumps" between frames far more than in a static ghost.
  const [overlayPeek, setOverlayPeek] = useState(false)
  const overlayActive = overlay && !overlayMissing

  // Compare-tool keys, live while the overlay shows (and no zoom dialog):
  // V peeks, arrows nudge ±0.1% (Shift+vertical scales ±0.2%), 0 resets.
  // Form controls and the wipe seam keep their own native arrow behavior.
  useEffect(() => {
    if (!overlayActive || zoomedSection) return
    const isFormTarget = (event: KeyboardEvent) =>
      event.target instanceof Element && event.target.closest('input, select, textarea, [role="slider"]') !== null
    const onKeyDown = (event: KeyboardEvent) => {
      if (isFormTarget(event)) return
      if (event.code === 'KeyV') {
        if (!event.repeat) setOverlayPeek(true)
        return
      }
      if (event.code === 'Digit0') {
        setOverlayNudge(NUDGE_IDENTITY)
        return
      }
      if (!event.code.startsWith('Arrow')) return
      event.preventDefault()
      const round1 = (value: number) => Math.round(value * 10) / 10
      setOverlayNudge((nudge) => {
        if (event.shiftKey) {
          const step = event.code === 'ArrowUp' || event.code === 'ArrowRight' ? 0.002 : -0.002
          return { ...nudge, scale: Math.round((nudge.scale + step) * 1000) / 1000 }
        }
        if (event.code === 'ArrowLeft') return { ...nudge, dx: round1(nudge.dx - 0.1) }
        if (event.code === 'ArrowRight') return { ...nudge, dx: round1(nudge.dx + 0.1) }
        if (event.code === 'ArrowUp') return { ...nudge, dy: round1(nudge.dy - 0.1) }
        return { ...nudge, dy: round1(nudge.dy + 0.1) }
      })
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'KeyV') setOverlayPeek(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      setOverlayPeek(false)
    }
  }, [overlayActive, zoomedSection])

  // Wipe seam drag: chassis-relative pointer x, clamped off the edges.
  const onWipeDrag = (event: ReactPointerEvent) => {
    const rect = realChassisRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    setOverlayWipe(Math.min(98, Math.max(2, ((event.clientX - rect.left) / rect.width) * 100)))
  }

  // Measure mode: a crosshair layer over the chassis reporting the pointer
  // position (readout pinned to the viewport's bottom-right) plus drag-drawn
  // bounding boxes labeled with their width x height. Available in dev and
  // after /secret unlock on production. While on, the layer swallows panel
  // input on purpose: measuring a knob must not twist it.
  const [measure, setMeasure] = useState(false)
  const [measureCursor, setMeasureCursor] = useState<MeasureCursor | null>(null)
  const [measureBoxes, setMeasureBoxes] = useState<MeasureBox[]>([])
  const [measureDraft, setMeasureDraft] = useState<MeasureBox | null>(null)
  // In-flight drag origin (chassis fractions); a ref so pointermove doesn't
  // depend on render freshness mid-drag.
  const measureAnchor = useRef<{ xf: number; yf: number } | null>(null)

  const measurePointAt = (event: ReactPointerEvent): { xf: number; yf: number; rect: DOMRect } | null => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
    return {
      xf: clamp01((event.clientX - rect.left) / rect.width),
      yf: clamp01((event.clientY - rect.top) / rect.height),
      rect,
    }
  }
  const measureBoxFrom = (a: { xf: number; yf: number }, b: { xf: number; yf: number }, rect: DOMRect): MeasureBox => {
    const w = Math.abs(a.xf - b.xf)
    const h = Math.abs(a.yf - b.yf)
    return {
      x: Math.min(a.xf, b.xf),
      y: Math.min(a.yf, b.yf),
      w,
      h,
      wCqw: w * 100,
      hCqw: (h * rect.height * 100) / rect.width,
      hPctH: h * 100,
      wPx: w * rect.width,
      hPx: h * rect.height,
    }
  }
  const onMeasureMove = (event: ReactPointerEvent) => {
    const p = measurePointAt(event)
    if (!p) return
    setMeasureCursor({
      xCqw: p.xf * 100,
      yCqw: (p.yf * p.rect.height * 100) / p.rect.width,
      yPctH: p.yf * 100,
      xPx: p.xf * p.rect.width,
      yPx: p.yf * p.rect.height,
    })
    if (measureAnchor.current) setMeasureDraft(measureBoxFrom(measureAnchor.current, p, p.rect))
  }
  const onMeasureDown = (event: ReactPointerEvent) => {
    const p = measurePointAt(event)
    if (!p) return
    event.currentTarget.setPointerCapture(event.pointerId)
    measureAnchor.current = { xf: p.xf, yf: p.yf }
    setMeasureDraft(measureBoxFrom(p, p, p.rect))
  }
  const onMeasureUp = (event: ReactPointerEvent) => {
    const anchor = measureAnchor.current
    measureAnchor.current = null
    setMeasureDraft(null)
    const p = measurePointAt(event)
    if (!anchor || !p) return
    const box = measureBoxFrom(anchor, p, p.rect)
    // Sub-3px drags are stray clicks, not measurements — don't keep specks.
    if (box.wPx > 3 || box.hPx > 3) setMeasureBoxes((boxes) => [...boxes, box])
  }
  const onMeasureLeave = () => {
    if (!measureAnchor.current) setMeasureCursor(null)
  }
  const toggleMeasure = () => {
    measureAnchor.current = null
    setMeasureDraft(null)
    setMeasureBoxes([])
    setMeasureCursor(null)
    setMeasure((on) => !on)
  }
  // Esc wipes the drawn boxes (and any in-flight drag) while measuring.
  useEffect(() => {
    if (!measure) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return
      measureAnchor.current = null
      setMeasureDraft(null)
      setMeasureBoxes([])
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [measure])
  // The readout's box line tracks the drag live, else the last drawn box.
  const measureReadoutBox = measureDraft ?? measureBoxes[measureBoxes.length - 1] ?? null
  const lensRef = useRef<HTMLDivElement>(null)
  const lensCanvasRef = useRef<HTMLDivElement>(null)
  const lensCursorRef = useRef<HTMLSpanElement>(null)
  const LENS_W = 340
  const LENS_H = 230
  const LENS_K = 2.6
  /** Lens motion time constant: the glide closes ~63% of the remaining gap
   *  every 60ms. Tight enough that normal sweeps feel attached to the
   *  pointer, soft enough that discontinuities — releasing a drag-frozen
   *  lens, the above/below flip at the screen edge — become a quick glide
   *  instead of a teleport. */
  const LENS_TAU_MS = 60
  // Where the lens WANTS to be (written per pointermove) vs where it IS
  // (advanced toward the target each frame by the rAF loop below). left/top
  // place the lens box; cx/cy are the magnified panel point, which drives
  // both the canvas transform and the cursor clone. shown=false makes the
  // next appearance snap instead of gliding in from a stale position.
  const lensTargetRef = useRef({ left: 0, top: 0, cx: 0, cy: 0, shown: false })
  const lensPosRef = useRef({ left: 0, top: 0, cx: 0, cy: 0 })

  const applyLensPosition = () => {
    const lens = lensRef.current
    const canvas = lensCanvasRef.current
    const pos = lensPosRef.current
    if (!lens || !canvas) return
    lens.style.left = `${pos.left}px`
    lens.style.top = `${pos.top}px`
    canvas.style.transform = `translate(${LENS_W / 2 - pos.cx * LENS_K}px, ${LENS_H / 2 - pos.cy * LENS_K}px) scale(${LENS_K})`
    const cursorEl = lensCursorRef.current
    if (cursorEl) {
      cursorEl.style.left = `${pos.cx}px`
      cursorEl.style.top = `${pos.cy}px`
    }
  }

  // The smoothing loop: frame-rate-independent exponential ease toward the
  // target while the loupe is on. Idles (no style writes) when the lens is
  // hidden or already settled on the target.
  useEffect(() => {
    if (!magnify) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const target = lensTargetRef.current
      const pos = lensPosRef.current
      const dt = now - last
      last = now
      raf = requestAnimationFrame(tick)
      if (!target.shown) return
      const gap = Math.max(
        Math.abs(target.left - pos.left),
        Math.abs(target.top - pos.top),
        Math.abs(target.cx - pos.cx),
        Math.abs(target.cy - pos.cy),
      )
      if (gap < 0.05) return
      const alpha = 1 - Math.exp(-dt / LENS_TAU_MS)
      pos.left += (target.left - pos.left) * alpha
      pos.top += (target.top - pos.top) * alpha
      pos.cx += (target.cx - pos.cx) * alpha
      pos.cy += (target.cy - pos.cy) * alpha
      applyLensPosition()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [magnify])

  const onLensMove = (event: ReactPointerEvent) => {
    const chassis = realChassisRef.current
    const lens = lensRef.current
    const canvas = lensCanvasRef.current
    if (!chassis || !lens || !canvas) return
    const hoveredCursor = event.target instanceof Element ? getComputedStyle(event.target).cursor : ''
    // Drag freeze: value drags capture the pointer on the control
    // (controls.tsx onPointerDown), so while a button is held the event
    // target stays the dragged resize-cursor control. Skipping all updates
    // holds the lens (and its cursor clone) where the drag started, so the
    // gesture doesn't carry the loupe away — the clone is a live render, so
    // the value change stays visible inside the frozen lens. On release the
    // rAF glide catches the lens up to the pointer instead of teleporting.
    // Key presses are exempt: holding a note while sweeping (glissando)
    // should carry the loupe along, pressed keys lighting up inside it.
    if (event.buttons !== 0 && (hoveredCursor === 'ns-resize' || hoveredCursor === 'ew-resize')) return
    // The loupe covers the WHOLE chassis — control deck and keybed alike
    // (the clone already renders both); it hides past the chassis edges.
    const c = chassis.getBoundingClientRect()
    const x = event.clientX - c.left
    const y = event.clientY - c.top
    const target = lensTargetRef.current
    if (x < 0 || y < 0 || x > c.width || y > c.height) {
      lens.style.visibility = 'hidden'
      target.shown = false
      return
    }
    // Lens floats beside the cursor, flipping above/below to stay on screen.
    target.left = Math.min(event.clientX + 20, window.innerWidth - LENS_W - 8)
    target.top = event.clientY - LENS_H - 20 < 8 ? event.clientY + 22 : event.clientY - LENS_H - 20
    // The clone renders at the real chassis' width (same cqw scale), then
    // the transform magnifies and centers the cursor point in the lens.
    target.cx = x
    target.cy = y
    canvas.style.width = `${c.width}px`
    canvas.style.height = `${c.height}px`
    // Cursor clone glyph swaps instantly (easing a glyph swap means showing
    // the wrong cursor); its position eases with everything else.
    const cursorEl = lensCursorRef.current
    if (cursorEl) {
      cursorEl.dataset.cursor = (LENS_CURSOR_KINDS as readonly string[]).includes(hoveredCursor) ? hoveredCursor : 'default'
    }
    if (!target.shown) {
      // First appearance (or re-entry): materialize at the pointer, don't
      // glide in from wherever the lens last was.
      target.shown = true
      lensPosRef.current = { left: target.left, top: target.top, cx: target.cx, cy: target.cy }
      applyLensPosition()
      lens.style.visibility = 'visible'
    }
  }
  const onLensLeave = () => {
    if (lensRef.current) lensRef.current.style.visibility = 'hidden'
    lensTargetRef.current.shown = false
  }

  // Persisted UI preferences (all in one record so writing one never wipes
  // the others): the info strip's minimal/full chrome, the page theme, and
  // whether the whole bottom control panel is hidden.
  const [ui, setUi] = useState<UiPrefs>(() => {
    const defaults: UiPrefs = { chrome: 'minimal', theme: 'light', panelHidden: false }
    try {
      const raw = system.storage.load('stagebench.ui.v1')
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<UiPrefs>
        return {
          chrome: parsed.chrome === 'full' ? 'full' : 'minimal',
          theme: parsed.theme === 'dark' ? 'dark' : 'light',
          panelHidden: parsed.panelHidden === true,
        }
      }
    } catch {
      /* unreadable preference: fall through to the defaults */
    }
    return defaults
  })
  const { chrome, theme, panelHidden } = ui
  // Toggles all funnel through functional updates so keyboard shortcuts and
  // buttons stay correct regardless of render freshness, persisting the whole
  // record each time.
  const patchUi = useCallback(
    (patch: (current: UiPrefs) => UiPrefs) => {
      setUi((current) => {
        const next = patch(current)
        system.storage.save('stagebench.ui.v1', JSON.stringify(next))
        return next
      })
    },
    [system.storage],
  )
  const toggleChrome = useCallback(
    () => patchUi((c) => ({ ...c, chrome: c.chrome === 'minimal' ? 'full' : 'minimal' })),
    [patchUi],
  )
  const toggleTheme = useCallback(
    () => patchUi((c) => ({ ...c, theme: c.theme === 'dark' ? 'light' : 'dark' })),
    [patchUi],
  )
  const togglePanelHidden = useCallback(() => patchUi((c) => ({ ...c, panelHidden: !c.panelHidden })), [patchUi])

  // Global UI shortcuts: B hides/shows the bottom control panel, N flips the
  // theme. Both skip typing targets, key-repeat, and modified presses (so
  // Cmd/Ctrl+N etc. keep their browser behavior); the note-key handler
  // ignores B and N since neither is a mapped note.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      )
        return
      if (event.code === 'KeyB') {
        event.preventDefault()
        togglePanelHidden()
      } else if (event.code === 'KeyN') {
        event.preventDefault()
        toggleTheme()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [togglePanelHidden, toggleTheme])

  // Below this width the chassis shrinks past legibility and its knobs,
  // faders, and keybed are too small to drive with a finger/mouse — surface a
  // dismissible "best viewed on desktop" hint rather than fake usability.
  const isSmallScreen = useMediaQuery('(max-width: 820px)')
  const [screenNoticeDismissed, setScreenNoticeDismissed] = useState(false)
  const showScreenNotice = isSmallScreen && !screenNoticeDismissed

  // (Re)attach canonical state on every mount: unmount cleanup disposes the
  // engine and detaches its store subscription, and StrictMode's simulated
  // unmount/remount would otherwise leave the engine frozen on initial state
  // (attachStore is idempotent — it replaces any previous subscription).
  useEffect(() => {
    engine.attachStore(instrument)
  }, [engine, instrument])

  // Diagnostics hook for real-browser audio verification (not used by app logic).
  useEffect(() => {
    window.__stagebench = { engine, controller, instrument }
    return () => {
      delete window.__stagebench
    }
  }, [engine, controller, instrument])

  // Live-mode auto-store serialization is debounced (see schedulePersist);
  // flush it whenever the page hides so a reload/close never loses edits.
  useEffect(() => {
    const flush = () => instrument.flushPersist()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      flush()
    }
  }, [instrument])

  // Warm the audio engine ahead of the first note: the context is created
  // (suspended, pending a gesture) and samples fetch/decode during idle time,
  // so the first key press only has to resume the context instead of paying
  // the full 200-500ms graph/sample startup. Injected boundaries (tests) keep
  // the original lazy behavior.
  useEffect(() => {
    if (audioBoundary) return
    const warm = () => engine.ensureStarted()
    const idleId = typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(warm, { timeout: 400 }) : null
    const timerId = idleId === null ? window.setTimeout(warm, 150) : null
    return () => {
      if (idleId !== null) window.cancelIdleCallback?.(idleId)
      if (timerId !== null) window.clearTimeout(timerId)
    }
  }, [engine, audioBoundary])

  // Web MIDI wiring (injectable; truthful denied/unsupported/disconnect states).
  useEffect(() => {
    void midi.start(midiBoundary ?? realMidiBoundary())
    return () => midi.dispose()
  }, [midi, midiBoundary])

  // Mapped computer-key input with repeat suppression and blur cleanup,
  // plus the space-bar sustain and Z/X soft/sostenuto pedal input paths.
  useEffect(() => {
    const heldCodes = new Set<string>()
    // Space engaged the pedal: remembered so the RELEASE always happens even
    // if focus moved onto a button/slider mid-press (clicking a control
    // focuses it) — otherwise the keyup guard below would skip the release
    // and the damper would stick down forever.
    let spaceSustainDown = false
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'
    }
    const isInteractiveTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement && target.closest('button, [role="slider"]') !== null

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (event.code === SUSTAIN_KEY_CODE && !isInteractiveTarget(event.target)) {
        event.preventDefault()
        if (!event.repeat) {
          spaceSustainDown = true
          sustainInput(true)
        }
        return
      }
      // Letter keys never operate a focused button/slider (those use
      // Space/Enter and arrows), so notes and the Z/X pedals keep playing
      // even while a panel control has focus — only the Space sustain guard
      // above must respect focus, since Space also activates buttons.
      if (event.code === SOFT_KEY_CODE) {
        if (!event.repeat) controller.setSoft(true)
        return
      }
      if (event.code === SOSTENUTO_KEY_CODE) {
        if (!event.repeat) controller.setSostenuto(true)
        return
      }
      const midiNote = KEY_CODE_TO_MIDI[event.code]
      if (midiNote === undefined) return
      if (event.repeat || heldCodes.has(event.code)) return
      heldCodes.add(event.code)
      controller.noteOn(midiNote, KEYBOARD_VELOCITY, 'keyboard')
    }
    const onKeyUp = (event: KeyboardEvent) => {
      // Pedal key-ups mirror the key-down guard — EXCEPT when this very key
      // engaged the pedal: the damper must come back up no matter where
      // focus wandered during the press (honesty: pedal up = release).
      if (event.code === SUSTAIN_KEY_CODE) {
        if (spaceSustainDown) {
          spaceSustainDown = false
          sustainInput(false)
          return
        }
        if (!isInteractiveTarget(event.target)) {
          sustainInput(false)
          return
        }
      }
      if (event.code === SOFT_KEY_CODE) {
        controller.setSoft(false)
        return
      }
      if (event.code === SOSTENUTO_KEY_CODE) {
        controller.setSostenuto(false)
        return
      }
      const midiNote = KEY_CODE_TO_MIDI[event.code]
      if (midiNote === undefined || !heldCodes.has(event.code)) return
      heldCodes.delete(event.code)
      controller.noteOff(midiNote, 'keyboard')
    }
    const onBlur = () => {
      heldCodes.clear()
      spaceSustainDown = false
      controller.allNotesOff('blur')
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [controller, sustainInput])

  // Unmount cleanup: stop every owned voice and release the audio graph.
  useEffect(() => () => controller.dispose(), [controller])

  // Engine failures must stay visible even with the info strip collapsed:
  // in minimal chrome a degraded (error/fallback) engine line renders
  // directly in the always-visible strip instead of the hidden info block.
  const engineDegraded = engineStatus.status === 'error' || engineStatus.status === 'fallback'
  const engineStatusLine = (
    <span data-testid="engine-status" data-status={engineStatus.status} aria-live="polite">
      <b>Piano:</b> {engineStatus.message}
    </span>
  )

  return (
    <main
      className="stage-app"
      data-theme={theme}
      onDragEnter={onMidiDragEnter}
      onDragOver={onMidiDragOver}
      onDragLeave={onMidiDragLeave}
      onDrop={onMidiDrop}
    >
      {midiDragging && (
        <div className="midi-drop" data-testid="midi-drop" aria-hidden="true">
          <div className="midi-drop-frame">
            <span className="midi-drop-label">Drop a MIDI file to play</span>
          </div>
        </div>
      )}
      {showScreenNotice && (
        <div className="screen-notice" role="status" data-testid="screen-notice">
          <div className="screen-notice-card">
            <svg className="screen-notice-icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="2.5" y="4" width="19" height="12.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M8.5 20.5h7M12 16.5v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <div className="screen-notice-text">
              <strong>Best viewed on desktop</strong>
              <span>
                This Nord Stage 4 recreation needs a wider screen and a mouse or MIDI keyboard to reach its knobs,
                faders, and keybed.
              </span>
            </div>
            <button
              type="button"
              className="screen-notice-dismiss"
              data-testid="screen-notice-dismiss"
              onClick={() => setScreenNoticeDismissed(true)}
            >
              Continue anyway
            </button>
          </div>
        </div>
      )}
      {(midiPlaybackStatus !== 'idle' || midiError) && (
        <MidiTransport player={midiPlayer} error={midiError} onDismissError={() => setMidiError(null)} />
      )}
      <div
        className="instrument"
        role="region"
        aria-label={`${VARIANT.label} product study`}
        data-variant={VARIANT.id}
        data-testid="instrument"
        onPointerMove={magnify ? onLensMove : undefined}
        onPointerLeave={magnify ? onLensLeave : undefined}
      >
        <div className="chassis" data-testid="chassis" ref={realChassisRef}>
          <div className="deck-block" data-testid="deck-block" style={{ height: '52.5%' }}>
            {/* Rear-connector legends printed on the top lip (reference
                photo); purely decorative print — the jacks are on the back. */}
            <div className="top-rail" aria-hidden="true">
              {REAR_LEGENDS.map(([label, left]) => (
                <span key={label} className="rear-legend" style={{ left: `${left}%` }}>
                  {label}
                </span>
              ))}
            </div>
            <div className="control-deck" data-testid="control-deck">
              {/* Chassis screws along the deck's bottom lip (reference). */}
              <span className="deck-screws" aria-hidden="true">
                {DECK_SCREWS.map((left) => (
                  <i key={left} style={{ left: `${left}%` }} />
                ))}
              </span>
              <PerformanceSection store={store} instrument={instrument} />
              <OrganSection store={store} instrument={instrument} onZoom={() => setZoomedSection('organ')} />
              <PianoSection store={store} instrument={instrument} engine={engine} onZoom={() => setZoomedSection('piano')} />
              <ProgramSection store={store} instrument={instrument} engine={engine} />
              <SynthSection store={store} instrument={instrument} onZoom={() => setZoomedSection('synth')} />
              <EffectsSection store={store} instrument={instrument} onZoom={() => setZoomedSection('effects')} />
              {/* Vertical print on the bare red right margin (reference photo). */}
              <span className="made-in" aria-hidden="true">
                HANDMADE IN SWEDEN BY CLAVIA DMI AB&ensp;v2.0 Rev.B
              </span>
            </div>
          </div>
          <div className="keys-block" data-testid="keys-block" style={{ height: '47.5%' }}>
            <Keybed controller={controller} instrument={instrument} />
            <div className="bottom-rail" aria-hidden="true" />
          </div>
          {/* Raised wooden side rails along both edges (reference photo):
              a slightly deeper red than the deck, standing proud of it. */}
          <div className="side-rail left" aria-hidden="true" />
          <div className="side-rail right" aria-hidden="true" />
          {overlayActive && (
            <ReferenceGhost
              mode={overlayPeek ? 'ghost' : overlayMode}
              opacity={overlayPeek ? 1 : overlayOpacity / 100}
              wipe={overlayWipe}
              nudge={overlayNudge}
              testId="reference-overlay"
              onError={() => setOverlayMissing(true)}
            />
          )}
          {overlayActive && overlayMode === 'wipe' && (
            <div
              className="overlay-wipe"
              data-testid="overlay-wipe"
              role="slider"
              tabIndex={0}
              aria-label="Overlay wipe position"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(overlayWipe)}
              style={{ left: `${overlayWipe}%` }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId)
                onWipeDrag(event)
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) onWipeDrag(event)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                event.preventDefault()
                event.stopPropagation()
                const step = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 5 : 1)
                setOverlayWipe((wipe) => Math.min(98, Math.max(2, wipe + step)))
              }}
            >
              <span className="overlay-wipe-grip" aria-hidden="true" />
            </div>
          )}
          {showDevTools && measure && (
            <div
              className="measure-overlay"
              data-testid="measure-overlay"
              onPointerDown={onMeasureDown}
              onPointerMove={onMeasureMove}
              onPointerUp={onMeasureUp}
              onPointerLeave={onMeasureLeave}
            >
              {[...measureBoxes, ...(measureDraft ? [measureDraft] : [])].map((box, index) => (
                <div
                  key={index}
                  className="measure-box"
                  data-testid="measure-box"
                  style={{
                    left: `${box.x * 100}%`,
                    top: `${box.y * 100}%`,
                    width: `${box.w * 100}%`,
                    height: `${box.h * 100}%`,
                  }}
                  data-label={box.y + box.h > 0.92 ? 'above' : 'below'}
                >
                  <span className="measure-box-label">{`${box.wCqw.toFixed(2)} × ${box.hCqw.toFixed(2)} cqw`}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {zoomedSection && (
        <SectionZoomOverlay title={ZOOM_TITLES[zoomedSection]} sectionId={zoomedSection} onClose={() => setZoomedSection(null)}>
          {zoomedSection === 'organ' && <OrganSection store={store} instrument={instrument} />}
          {zoomedSection === 'piano' && <PianoSection store={store} instrument={instrument} engine={engine} />}
          {zoomedSection === 'synth' && <SynthSection store={store} instrument={instrument} />}
          {zoomedSection === 'effects' && <EffectsSection store={store} instrument={instrument} />}
        </SectionZoomOverlay>
      )}
      {magnify && (
        <div className="magnify-lens" ref={lensRef} aria-hidden="true" data-testid="magnify-lens">
          {/* Inert visual clone of the whole chassis (deck block + keybed)
              at the same cqw scale; the transform above magnifies the area
              under the cursor. Cloning past the deck keeps the view honest
              at the panel's edges: page background and keybed, not red. */}
          <div className="lens-canvas" ref={lensCanvasRef} inert>
            <div className="chassis lens-chassis">
              <div className="deck-block" style={{ height: '52.5%' }}>
                <div className="top-rail" aria-hidden="true">
                  {REAR_LEGENDS.map(([label, left]) => (
                    <span key={label} className="rear-legend" style={{ left: `${left}%` }}>
                      {label}
                    </span>
                  ))}
                </div>
                <div className="control-deck">
                  <span className="deck-screws" aria-hidden="true">
                    {DECK_SCREWS.map((left) => (
                      <i key={left} style={{ left: `${left}%` }} />
                    ))}
                  </span>
                  <PerformanceSection store={store} instrument={instrument} />
                  <OrganSection store={store} instrument={instrument} />
                  <PianoSection store={store} instrument={instrument} engine={engine} />
                  <ProgramSection store={store} instrument={instrument} engine={engine} />
                  <SynthSection store={store} instrument={instrument} />
                  <EffectsSection store={store} instrument={instrument} />
                  <span className="made-in" aria-hidden="true">
                    HANDMADE IN SWEDEN BY CLAVIA DMI AB&ensp;v2.0 Rev.B
                  </span>
                </div>
              </div>
              <div className="keys-block" style={{ height: '47.5%' }}>
                <Keybed controller={controller} instrument={instrument} />
                <div className="bottom-rail" aria-hidden="true" />
              </div>
              <div className="side-rail left" aria-hidden="true" />
              <div className="side-rail right" aria-hidden="true" />
              {/* The compare ghost travels into the loupe too, so the lens
                  magnifies photo-vs-render at the same 2.6x. */}
              {overlayActive && (
                <ReferenceGhost
                  mode={overlayPeek ? 'ghost' : overlayMode}
                  opacity={overlayPeek ? 1 : overlayOpacity / 100}
                  wipe={overlayWipe}
                  nudge={overlayNudge}
                />
              )}
            </div>
            {/* OS-styled clone of the mouse cursor at the magnified point;
                onLensMove positions it and picks the glyph via data-cursor. */}
            <span className="lens-cursor" ref={lensCursorRef} data-os={LENS_CURSOR_OS} data-cursor="default">
              <svg data-for="default" viewBox="0 0 15 20" aria-hidden="true">
                <path d="M1.2 1 L1.2 16.2 L5.3 12.9 L7.9 18.3 L10.6 17 L8.1 11.7 L13.3 11.7 Z" />
              </svg>
              <svg data-for="pointer" viewBox="0 0 18 23" aria-hidden="true">
                <path d="M7.6 2.2 Q7.6 0.9 8.9 0.9 Q10.2 0.9 10.2 2.2 L10.2 8.2 Q10.5 7.5 11.4 7.7 Q12.3 7.9 12.3 8.9 Q12.7 8.2 13.5 8.4 Q14.3 8.7 14.3 9.6 Q14.8 9.1 15.4 9.4 Q16.1 9.8 16.1 10.6 L16.1 13.5 Q16.1 16.6 14.6 18.2 L14.6 21.4 L6.9 21.4 L6.9 18.6 Q4.6 16.9 3.6 14.6 Q3.1 13.4 4 12.7 Q4.9 12 5.9 12.9 L7.6 14.6 Z" />
              </svg>
              <svg data-for="ns-resize" viewBox="0 0 12 22" aria-hidden="true">
                <path d="M6 1 L10.2 6.4 L7.3 6.4 L7.3 15.6 L10.2 15.6 L6 21 L1.8 15.6 L4.7 15.6 L4.7 6.4 L1.8 6.4 Z" />
              </svg>
              <svg data-for="ew-resize" viewBox="0 0 22 12" aria-hidden="true">
                <path d="M1 6 L6.4 1.8 L6.4 4.7 L15.6 4.7 L15.6 1.8 L21 6 L15.6 10.2 L15.6 7.3 L6.4 7.3 L6.4 10.2 Z" />
              </svg>
            </span>
          </div>
        </div>
      )}
      {showDevTools && measure && (
        <aside className="measure-readout" data-testid="measure-readout" aria-hidden="true">
          <span className="measure-title">measure · 1 cqw = 1% of chassis width</span>
          <span data-testid="measure-cursor">
            {measureCursor
              ? `x ${measureCursor.xCqw.toFixed(2)} · y ${measureCursor.yCqw.toFixed(2)} cqw  (${Math.round(measureCursor.xPx)}, ${Math.round(measureCursor.yPx)} px · y ${measureCursor.yPctH.toFixed(1)}%H)`
              : 'move the pointer over the chassis'}
          </span>
          {measureReadoutBox && (
            <span data-testid="measure-box-readout">
              {`w ${measureReadoutBox.wCqw.toFixed(2)} · h ${measureReadoutBox.hCqw.toFixed(2)} cqw  (${Math.round(measureReadoutBox.wPx)} × ${Math.round(measureReadoutBox.hPx)} px · h ${measureReadoutBox.hPctH.toFixed(1)}%H)`}
            </span>
          )}
          <span className="measure-hint">drag draws a box · Esc clears · panel input paused</span>
        </aside>
      )}
      {panelHidden ? (
        <div className="panel-restore-zone" data-testid="panel-restore-zone">
          <button
            type="button"
            className="panel-restore"
            data-testid="panel-restore"
            aria-label="Show controls"
            title="Show controls (B)"
            onClick={togglePanelHidden}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 7.5 L6 4 L9.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Controls
          </button>
        </div>
      ) : (
      <footer
        className={`status-strip ${chrome === 'minimal' ? 'chrome-minimal' : ''}`}
        data-testid="status-strip"
      >
        <span className="chrome-essentials">
          <button
            type="button"
            className="sustain-pedal"
            data-testid="sustain-pedal"
            aria-pressed={pedals.sustain}
            aria-label="Sustain Pedal"
            onClick={() => {
              // Pedal Tap re-assigns the pedal: a click is one full press.
              if (instrument.getState().masterClock.pedalTap) {
                sustainInput(true)
                sustainInput(false)
                return
              }
              sustainInput(!controller.isSustainDown())
            }}
          >
            <span className="chrome-dot" aria-hidden="true" />
            Sustain Pedal
          </button>
          <label className="ctrl-pedal">
            <span className="ctrl-pedal-label">Ctrl Pedal</span>
            <input
              type="range"
              min={0}
              max={127}
              value={controlPedal}
              aria-label="Control Pedal"
              data-testid="ctrl-pedal"
              onChange={(event) => instrument.setMorphSource('pedal', Number(event.target.value))}
            />
            <span className="ctrl-pedal-value" aria-hidden="true">
              {controlPedal}
            </span>
          </label>
          <span className="chrome-divider" aria-hidden="true" />
          <button
            type="button"
            className="chrome-toggle"
            data-testid="chrome-toggle"
            aria-pressed={chrome === 'full'}
            aria-label="Show panel info"
            onClick={toggleChrome}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <rect x="5.3" y="5" width="1.4" height="4" rx="0.7" fill="currentColor" />
              <circle cx="6" cy="3.4" r="0.85" fill="currentColor" />
            </svg>
            Info
          </button>
          <button
            type="button"
            className="chrome-toggle"
            data-testid="theme-toggle"
            aria-pressed={theme === 'dark'}
            aria-label="Toggle dark mode"
            title="Dark mode (N)"
            onClick={toggleTheme}
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <circle cx="6" cy="6" r="3" fill="currentColor" />
                <path
                  d="M6 0.6V2 M6 10V11.4 M0.6 6H2 M10 6H11.4 M2.2 2.2l1 1 M8.8 8.8l1 1 M9.8 2.2l-1 1 M3.2 8.8l-1 1"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M10 7.2A4.6 4.6 0 1 1 4.8 2 3.6 3.6 0 0 0 10 7.2Z" fill="currentColor" />
              </svg>
            )}
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <button
            type="button"
            className="chrome-toggle"
            data-testid="magnify-toggle"
            aria-pressed={magnify}
            aria-label="Toggle magnifier lens"
            onClick={() => setMagnify((m) => !m)}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <rect x="7.4" y="8.2" width="4" height="1.5" rx="0.75" transform="rotate(45 7.4 8.2)" fill="currentColor" />
            </svg>
            Magnify
          </button>
          <button
            type="button"
            className="chrome-toggle"
            data-testid="overlay-toggle"
            aria-pressed={overlay}
            aria-label="Toggle reference photo overlay"
            onClick={() => {
              setOverlay((o) => !o)
              // Re-arm the load attempt: the photo may have been fetched
              // (pnpm bench fetch) since the last failed try.
              setOverlayMissing(false)
            }}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <rect x="1.2" y="1.2" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <rect x="4.6" y="4.6" width="6.2" height="6.2" rx="1" fill="currentColor" opacity="0.55" />
            </svg>
            Overlay
          </button>
          {showDevTools && (
            <button
              type="button"
              className="chrome-toggle"
              data-testid="measure-toggle"
              aria-pressed={measure}
              aria-label="Toggle measure mode"
              onClick={toggleMeasure}
            >
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <rect x="0.9" y="3.8" width="10.2" height="4.4" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <path d="M3.4 3.8v2.1 M6 3.8v2.1 M8.6 3.8v2.1" stroke="currentColor" strokeWidth="1" fill="none" />
              </svg>
              Measure
            </button>
          )}
          <span className="chrome-divider" aria-hidden="true" />
          <button
            type="button"
            className="chrome-toggle"
            data-testid="panel-hide"
            aria-label="Hide controls"
            title="Hide controls (B)"
            onClick={togglePanelHidden}
          >
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Hide
          </button>
          {(overlayActive || (overlay && overlayMissing)) && (
            <span className="chrome-overlay-tools">
              {overlayActive && (
                <>
                  <span className="overlay-modes" role="group" aria-label="Overlay compare mode">
                    {(
                      [
                        ['ghost', 'Ghost', 'Photo at slider opacity'],
                        ['diff', 'Diff', 'Difference blend — matches go black, mismatches glow'],
                        ['wipe', 'Wipe', 'Photo left of a draggable seam'],
                      ] as const
                    ).map(([mode, label, title]) => (
                      <button
                        key={mode}
                        type="button"
                        className="chrome-toggle overlay-mode"
                        data-testid={`overlay-mode-${mode}`}
                        aria-pressed={overlayMode === mode}
                        title={title}
                        onClick={() => {
                          setOverlayMode(mode)
                          // Diff and wipe read best at full strength; ghost keeps
                          // whatever the slider says.
                          if (mode !== 'ghost') setOverlayOpacity(100)
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                  <label className="ctrl-pedal overlay-opacity">
                    <span className="ctrl-pedal-label">Photo</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={overlayOpacity}
                      aria-label="Reference overlay opacity"
                      data-testid="overlay-opacity"
                      onChange={(event) => setOverlayOpacity(Number(event.target.value))}
                    />
                    <span className="ctrl-pedal-value" aria-hidden="true">
                      {overlayOpacity}%
                    </span>
                  </label>
                  {(overlayNudge.dx !== 0 || overlayNudge.dy !== 0 || overlayNudge.scale !== 1) && (
                    <span className="overlay-nudge" data-testid="overlay-nudge">
                      Δ {overlayNudge.dx.toFixed(1)}, {overlayNudge.dy.toFixed(1)} · ×{overlayNudge.scale.toFixed(3)}
                      <button type="button" className="chrome-toggle overlay-mode" onClick={() => setOverlayNudge(NUDGE_IDENTITY)}>
                        Reset
                      </button>
                    </span>
                  )}
                </>
              )}
              {overlay && overlayMissing && (
                <span className="overlay-missing" data-testid="overlay-missing" role="status">
                  {overlayMissingMessage}
                </span>
              )}
            </span>
          )}
        </span>
        {chrome === 'minimal' && engineDegraded && engineStatusLine}
        <span className="chrome-info">
          {(chrome !== 'minimal' || !engineDegraded) && engineStatusLine}
          <span data-testid="midi-status" data-status={midiStatus.status} aria-live="polite">
            <b>MIDI</b> {midiStatus.message}
          </span>
          <span data-testid="pedal-status">
            <b>Pedals</b> sustain {pedals.sustain ? 'down' : 'up'} (pedal latches / Space / CC64 half-pedal) · sostenuto{' '}
            {pedals.sostenuto ? 'down' : 'up'} (X / CC66) · soft {pedals.soft ? 'down' : 'up'} (Z / CC67)
          </span>
          <span data-testid="ctrl-pedal-status">
            <b>Ctrl pedal</b> {controlPedal} — CC11, the Control Pedal morph source
          </span>
          <span data-testid="keymap-help">
            <b>Keys</b> A S D F G H J K L ; play C4–E5, W E T Y U O P the sharps between them (physical positions,
            layout-independent) · Space/Z/X are the sustain/soft/sostenuto pedals · B hides this panel, N toggles dark
            mode
          </span>
          {overlayActive && (
            <span data-testid="overlay-help">
              <b>Overlay</b> hold V to blink the full photo · arrows nudge the photo 0.1% (Shift+↑↓ scales) · 0 resets
              the nudge · in Diff, matches go black and mismatches glow
            </span>
          )}
          <span className="status-note">
            <b>Coverage</b> Every section is functional — keybed and pedals, Piano (all six types), Organ (all six
            models, presets, percussion), Synth (Analog + Samples, every oscillator category and filter), per-layer
            Layer Effects, Rotary, and the full Programs cluster (scenes, splits, morphs, master clock, transpose,
            preset library, Mon/Copy, Section Edit). Morph A.T. assigns like the other sources and moves from MIDI
            channel pressure (browsers have no other aftertouch input). Visual-only by spec exclusion: Synth
            Mode&apos;s Extern position. MIDI output (Extern section, manual ch. 9) is out of scope.
          </span>
          <span className="status-note chrome-disclaimer" data-testid="chrome-disclaimer">
            <b>Disclaimer</b> This is an unofficial fan project created for educational and non-commercial purposes. It
            is not affiliated with, endorsed by, sponsored by, or associated with Clavia DMI AB or the Nord brand.
            &ldquo;Nord&rdquo; and &ldquo;Nord Stage&rdquo; are trademarks of Clavia DMI AB and are used solely to
            identify the product that inspired this project.
          </span>
        </span>
      </footer>
      )}
    </main>
  )
}

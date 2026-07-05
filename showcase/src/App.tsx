import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
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
 *  /reference bridge (vite.config.ts) from the repo-root reference/ dir —
 *  gitignored and never bundled, so published builds truthfully report it
 *  as unavailable instead of shipping Nord's product shot. */
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

function usePedals(controller: InstrumentController): { sustain: boolean; sostenuto: boolean; soft: boolean } {
  const sustain = useSyncExternalStore(controller.subscribe, () => controller.isSustainDown())
  const sostenuto = useSyncExternalStore(controller.subscribe, () => controller.isSostenutoDown())
  const soft = useSyncExternalStore(controller.subscribe, () => controller.isSoftDown())
  return { sustain, sostenuto, soft }
}

function useControlPedal(instrument: InstrumentStore): number {
  return useSyncExternalStore(instrument.subscribe, () => instrument.getState().morphValues.pedal)
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
    return { engine, controller, midi, store, instrument, storage, sustainInput }
    // The instrument system is created once per mounted app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { engine, controller, midi, store, instrument, sustainInput } = system
  const engineStatus = useEngineStatus(engine)
  const midiStatus = useMidiStatus(midi)
  const pedals = usePedals(controller)
  const controlPedal = useControlPedal(instrument)

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

  const [chrome, setChrome] = useState<'minimal' | 'full'>(() => {
    try {
      const raw = system.storage.load('stagebench.ui.v1')
      if (raw) {
        const parsed = JSON.parse(raw) as { chrome?: string }
        if (parsed.chrome === 'full') return 'full'
      }
    } catch {
      /* unreadable preference: fall through to the default */
    }
    return 'minimal'
  })
  const toggleChrome = () => {
    setChrome((current) => {
      const next = current === 'minimal' ? 'full' : 'minimal'
      system.storage.save('stagebench.ui.v1', JSON.stringify({ chrome: next }))
      return next
    })
  }

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
    <main className="stage-app">
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
          <div className="deck-block" data-testid="deck-block" style={{ height: '54%' }}>
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
          <div className="keys-block" data-testid="keys-block" style={{ height: '46%' }}>
            <Keybed controller={controller} instrument={instrument} />
            <div className="bottom-rail" aria-hidden="true" />
          </div>
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
              <div className="deck-block" style={{ height: '54%' }}>
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
              <div className="keys-block" style={{ height: '46%' }}>
                <Keybed controller={controller} instrument={instrument} />
                <div className="bottom-rail" aria-hidden="true" />
              </div>
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
          {overlayActive && (
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
          )}
          {overlayActive && (
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
          )}
          {overlayActive && (overlayNudge.dx !== 0 || overlayNudge.dy !== 0 || overlayNudge.scale !== 1) && (
            <span className="overlay-nudge" data-testid="overlay-nudge">
              Δ {overlayNudge.dx.toFixed(1)}, {overlayNudge.dy.toFixed(1)} · ×{overlayNudge.scale.toFixed(3)}
              <button type="button" className="chrome-toggle overlay-mode" onClick={() => setOverlayNudge(NUDGE_IDENTITY)}>
                Reset
              </button>
            </span>
          )}
          {overlay && overlayMissing && (
            <span className="overlay-missing" data-testid="overlay-missing" role="status">
              reference photo unavailable — dev server with reference/ fetched (pnpm bench fetch)
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
            layout-independent) · Space/Z/X are the sustain/soft/sostenuto pedals
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
    </main>
  )
}

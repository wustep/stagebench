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
    const midi = new MidiInputManager({
      noteOn: (note, velocity) => controller.noteOn(note, velocity, 'midi'),
      noteOff: (note) => controller.noteOff(note, 'midi'),
      setSustain: (value) => controller.setSustain(value),
      setSostenuto: (down) => controller.setSostenuto(down),
      setSoft: (down) => controller.setSoft(down),
      setControlPedal: (value) => instrument.setMorphSource('pedal', value * 127),
      onDisconnectCleanup: () => controller.allNotesOff('midi-disconnect'),
    })
    const store = new PresentationStore({ instrument, controller, now: panelClock })
    return { engine, controller, midi, store, instrument, storage }
    // The instrument system is created once per mounted app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { engine, controller, midi, store, instrument } = system
  const engineStatus = useEngineStatus(engine)
  const midiStatus = useMidiStatus(midi)
  const pedals = usePedals(controller)
  const controlPedal = useControlPedal(instrument)

  // Section-inspect/zoom overlay (narrow-legend-legibility): additive and
  // opt-in — the default deck layout never changes, only this state gates
  // an extra portaled overlay rendering the same section again, larger.
  const [zoomedSection, setZoomedSection] = useState<ZoomableSectionId | null>(null)

  // Magnifier loupe: while toggled on, a floating lens follows the pointer
  // over the deck block (top-rail rear legends + control deck) showing a
  // 2.6x view of the panel under the cursor. The lens content is a second,
  // inert render of the deck (aria-hidden, pointer-events none) — purely
  // visual, the real deck stays interactive.
  const [magnify, setMagnify] = useState(false)
  const realDeckRef = useRef<HTMLDivElement>(null)
  const lensRef = useRef<HTMLDivElement>(null)
  const lensCanvasRef = useRef<HTMLDivElement>(null)
  const LENS_W = 340
  const LENS_H = 230
  const LENS_K = 2.6
  const onLensMove = (event: ReactPointerEvent) => {
    const deck = realDeckRef.current
    const lens = lensRef.current
    const canvas = lensCanvasRef.current
    if (!deck || !lens || !canvas) return
    const r = deck.getBoundingClientRect()
    const x = event.clientX - r.left
    const y = event.clientY - r.top
    if (x < 0 || y < 0 || x > r.width || y > r.height) {
      lens.style.visibility = 'hidden'
      return
    }
    lens.style.visibility = 'visible'
    // Lens floats beside the cursor, flipping above/below to stay on screen.
    const left = Math.min(event.clientX + 20, window.innerWidth - LENS_W - 8)
    const top = event.clientY - LENS_H - 20 < 8 ? event.clientY + 22 : event.clientY - LENS_H - 20
    lens.style.left = `${left}px`
    lens.style.top = `${top}px`
    // The clone renders at the real deck's width (same cqw scale), then the
    // transform magnifies and centers the cursor point in the lens.
    canvas.style.width = `${r.width}px`
    canvas.style.height = `${r.height}px`
    canvas.style.transform = `translate(${LENS_W / 2 - x * LENS_K}px, ${LENS_H / 2 - y * LENS_K}px) scale(${LENS_K})`
  }
  const onLensLeave = () => {
    if (lensRef.current) lensRef.current.style.visibility = 'hidden'
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
        if (!event.repeat) controller.setSustain(true)
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
      // Pedal key-ups mirror the key-down guard: keyboard activation of a
      // focused control (e.g. Space on the on-screen sustain pedal) must not
      // double as a pedal gesture.
      if (event.code === SUSTAIN_KEY_CODE && !isInteractiveTarget(event.target)) {
        controller.setSustain(false)
        return
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
  }, [controller])

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
        <div className="chassis" data-testid="chassis">
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
            <div className="control-deck" data-testid="control-deck" ref={realDeckRef}>
              {/* Chassis screws along the deck's bottom lip (reference). */}
              <span className="deck-screws" aria-hidden="true">
                {[13.6, 32.6, 40.7, 52.6, 76.4, 94.8].map((left) => (
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
        </div>
      </div>
      {zoomedSection && (
        <SectionZoomOverlay title={ZOOM_TITLES[zoomedSection]} onClose={() => setZoomedSection(null)}>
          {zoomedSection === 'organ' && <OrganSection store={store} instrument={instrument} />}
          {zoomedSection === 'piano' && <PianoSection store={store} instrument={instrument} engine={engine} />}
          {zoomedSection === 'synth' && <SynthSection store={store} instrument={instrument} />}
          {zoomedSection === 'effects' && <EffectsSection store={store} instrument={instrument} />}
        </SectionZoomOverlay>
      )}
      {magnify && (
        <div className="magnify-lens" ref={lensRef} aria-hidden="true" data-testid="magnify-lens">
          {/* Inert visual clone of the deck at the same cqw scale; the
              transform above magnifies the area under the cursor. */}
          <div className="lens-canvas" ref={lensCanvasRef} inert>
            <div className="control-deck lens-deck">
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
            onClick={() => controller.setSustain(!controller.isSustainDown())}
          >
            SUSTAIN PEDAL
          </button>
          <label className="ctrl-pedal">
            CTRL PEDAL
            <input
              type="range"
              min={0}
              max={127}
              value={controlPedal}
              aria-label="Control Pedal"
              data-testid="ctrl-pedal"
              onChange={(event) => instrument.setMorphSource('pedal', Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            className="chrome-toggle"
            data-testid="chrome-toggle"
            aria-pressed={chrome === 'full'}
            aria-label="Show panel info"
            onClick={toggleChrome}
          >
            ⓘ INFO
          </button>
          <button
            type="button"
            className="chrome-toggle"
            data-testid="magnify-toggle"
            aria-pressed={magnify}
            aria-label="Toggle magnifier lens"
            onClick={() => setMagnify((m) => !m)}
          >
            🔍 MAGNIFY
          </button>
        </span>
        {chrome === 'minimal' && engineDegraded && engineStatusLine}
        <span className="chrome-info">
          {(chrome !== 'minimal' || !engineDegraded) && engineStatusLine}
          <span data-testid="midi-status" data-status={midiStatus.status} aria-live="polite">
            <b>MIDI:</b> {midiStatus.message}
          </span>
          <span data-testid="pedal-status">
            <b>Pedals:</b> sustain {pedals.sustain ? 'down' : 'up'} (pedal latches / Space / CC64 half-pedal) · sostenuto{' '}
            {pedals.sostenuto ? 'down' : 'up'} (X / CC66) · soft {pedals.soft ? 'down' : 'up'} (Z / CC67)
          </span>
          <span data-testid="ctrl-pedal-status">
            <span>
              CTRL PEDAL {controlPedal} (CC11 · Control Pedal morph source)
            </span>
          </span>
          <span data-testid="keymap-help">
            <b>Keyboard:</b> A S D F G H J K L ; play C4–E5 and W E T Y U O P the sharps between them (physical key
            positions, layout-independent) · Space/Z/X are the sustain/soft/sostenuto pedals
          </span>
          <span className="status-note">
            Functional: keybed, pedals, all Piano and Organ sections (all six organ models including B3 Bass and Pipe
            2, and the Organ preset button), the complete Synth section (Analog and Samples modes, all optional
            oscillator categories and filters), Layer Effects (including each synth layer's own effect chain and the
            organ layers' shared chain), Rotary, Programs/scenes/splits/morphs/master clock/transpose, the
            preset-library buttons, Layer Init (Shift + Section Edit), Mon/Copy monitor + copy/paste latches (manual
            p. 43), and section zoom. Visual-only by spec exclusion: Synth Mode's Extern position, Section Edit's
            plain press, and Morph A.T. (no browser aftertouch).
          </span>
        </span>
      </footer>
    </main>
  )
}

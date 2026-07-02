import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  realAssetBoundary,
  realAudioBoundary,
  realMidiBoundary,
  type AssetBoundary,
  type AudioBoundary,
  type MidiBoundary,
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
import { PresentationStore } from './state/presentation'
import { InstrumentStore } from './state/instrument'
import { VARIANT } from './model/variant'

export interface AppProps {
  audioBoundary?: AudioBoundary
  midiBoundary?: MidiBoundary
  assetBoundary?: AssetBoundary
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

declare global {
  interface Window {
    /** Diagnostics hook for browser-based signal verification only. */
    __stagebench?: { engine: PianoEngine; controller: InstrumentController; instrument: InstrumentStore }
  }
}

export default function App({ audioBoundary, midiBoundary, assetBoundary, panelClock }: AppProps = {}) {
  const system = useMemo(() => {
    const instrument = new InstrumentStore()
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
      onDisconnectCleanup: () => controller.allNotesOff('midi-disconnect'),
    })
    const store = new PresentationStore({ instrument, controller, now: panelClock })
    return { engine, controller, midi, store, instrument }
    // The instrument system is created once per mounted app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { engine, controller, midi, store, instrument } = system
  const engineStatus = useEngineStatus(engine)
  const midiStatus = useMidiStatus(midi)
  const pedals = usePedals(controller)

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
      if (event.code === SOFT_KEY_CODE && !isInteractiveTarget(event.target)) {
        if (!event.repeat) controller.setSoft(true)
        return
      }
      if (event.code === SOSTENUTO_KEY_CODE && !isInteractiveTarget(event.target)) {
        if (!event.repeat) controller.setSostenuto(true)
        return
      }
      const midiNote = KEY_CODE_TO_MIDI[event.code]
      if (midiNote === undefined || isInteractiveTarget(event.target)) return
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
      if (event.code === SOFT_KEY_CODE && !isInteractiveTarget(event.target)) {
        controller.setSoft(false)
        return
      }
      if (event.code === SOSTENUTO_KEY_CODE && !isInteractiveTarget(event.target)) {
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

  return (
    <main className="stage-app">
      <div
        className="instrument"
        role="region"
        aria-label={`${VARIANT.label} product study`}
        data-variant={VARIANT.id}
        data-testid="instrument"
      >
        <div className="chassis" data-testid="chassis">
          <div className="deck-block" data-testid="deck-block" style={{ height: '54%' }}>
            <div className="top-rail" aria-hidden="true" />
            <div className="control-deck" data-testid="control-deck">
              <PerformanceSection store={store} instrument={instrument} />
              <OrganSection store={store} />
              <PianoSection store={store} instrument={instrument} engine={engine} />
              <ProgramSection store={store} instrument={instrument} engine={engine} />
              <SynthSection store={store} />
              <EffectsSection store={store} instrument={instrument} />
            </div>
          </div>
          <div className="keys-block" data-testid="keys-block" style={{ height: '46%' }}>
            <Keybed controller={controller} />
            <div className="bottom-rail" aria-hidden="true" />
          </div>
        </div>
      </div>
      <footer className="status-strip" aria-live="polite">
        <span data-testid="engine-status" data-status={engineStatus.status}>
          <b>Piano:</b> {engineStatus.message}
        </span>
        <span data-testid="midi-status" data-status={midiStatus.status}>
          <b>MIDI:</b> {midiStatus.message}
        </span>
        <span data-testid="pedal-status">
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
          <b>Pedals:</b> sustain {pedals.sustain ? 'down' : 'up'} (pedal latches / Space / CC64 half-pedal) · sostenuto{' '}
          {pedals.sostenuto ? 'down' : 'up'} (X / CC66) · soft {pedals.soft ? 'down' : 'up'} (Z / CC67)
        </span>
        <span className="status-note">
          Functional this phase: keybed, pedals, Piano section (all six types), Layer Effects, Rotary, Master Level,
          pitch stick, Panic, and Shift+Layer A/B for SUSTPED/PSTICK routing. Organ, Synth and the remaining Program
          controls are visual-only until Phase 3.
        </span>
      </footer>
    </main>
  )
}

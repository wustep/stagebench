import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { realAudioBoundary, realMidiBoundary, type AudioBoundary, type MidiBoundary } from './audio/boundaries'
import { PianoEngine, type EngineStatusInfo } from './audio/engine'
import { InstrumentController } from './input/controller'
import { KEY_CODE_TO_MIDI, KEYBOARD_VELOCITY, SUSTAIN_KEY_CODE } from './input/keymap'
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
import { VARIANT } from './model/variant'

export interface AppProps {
  audioBoundary?: AudioBoundary
  midiBoundary?: MidiBoundary
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

export default function App({ audioBoundary, midiBoundary }: AppProps = {}) {
  const system = useMemo(() => {
    const engine = new PianoEngine(audioBoundary ?? realAudioBoundary())
    const controller = new InstrumentController(engine)
    const midi = new MidiInputManager({
      noteOn: (note, velocity) => controller.noteOn(note, velocity, 'midi'),
      noteOff: (note) => controller.noteOff(note, 'midi'),
      setSustain: (down) => controller.setSustain(down),
      onDisconnectCleanup: () => controller.allNotesOff('midi-disconnect'),
    })
    const store = new PresentationStore()
    return { engine, controller, midi, store }
    // The instrument system is created once per mounted app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { engine, controller, midi, store } = system
  const engineStatus = useEngineStatus(engine)
  const midiStatus = useMidiStatus(midi)

  // Web MIDI wiring (injectable; truthful denied/unsupported/disconnect states).
  useEffect(() => {
    void midi.start(midiBoundary ?? realMidiBoundary())
    return () => midi.dispose()
  }, [midi, midiBoundary])

  // Mapped computer-key input with repeat suppression and blur cleanup,
  // plus the space-bar sustain input path.
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
      const midiNote = KEY_CODE_TO_MIDI[event.code]
      if (midiNote === undefined || isInteractiveTarget(event.target)) return
      if (event.repeat || heldCodes.has(event.code)) return
      heldCodes.add(event.code)
      controller.noteOn(midiNote, KEYBOARD_VELOCITY, 'keyboard')
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === SUSTAIN_KEY_CODE) {
        controller.setSustain(false)
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
              <PerformanceSection store={store} />
              <OrganSection store={store} />
              <PianoSection store={store} />
              <ProgramSection store={store} />
              <SynthSection store={store} />
              <EffectsSection store={store} />
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
          <b>Piano voice:</b> {engineStatus.message}
        </span>
        <span data-testid="midi-status" data-status={midiStatus.status}>
          <b>MIDI:</b> {midiStatus.message}
        </span>
        <span className="status-note">
          Panel controls are visual-only in this phase — only the keybed (pointer/touch, A–; keys, MIDI) and sustain
          (space bar, MIDI CC64) make sound.
        </span>
      </footer>
    </main>
  )
}

import { useLayoutEffect, useState } from 'react'
import { realAudioBoundary, realTimers, type AudioBoundary, type TimerBoundary } from './audio/boundaries'
import { PianoEngine } from './audio/engine'
import { Keybed } from './components/Keybed'
import { ControlDeck } from './components/sections'
import { InstrumentController } from './input/controller'
import { MidiInput, realMidiBoundary, type MidiBoundary } from './input/midi'
import { VARIANT } from './model/variant'
import { bindPanel } from './state/panelSync'
import { PresentationStore } from './state/presentation'

export interface AppProps {
  audio?: AudioBoundary
  midi?: MidiBoundary
  timers?: TimerBoundary
  /** Test seam: observe the engine created for this mount. */
  onEngine?: (engine: PianoEngine) => void
}

interface Session {
  engine: PianoEngine
  controller: InstrumentController
  midi: MidiInput
}

export default function App({ audio, midi, timers, onEngine }: AppProps) {
  const [store] = useState(() => new PresentationStore())
  const [session, setSession] = useState<Session | null>(null)

  useLayoutEffect(() => {
    let cancelled = false
    const engine = new PianoEngine(
      {
        ...(audio ?? realAudioBoundary()),
        timers: timers ?? audio?.timers ?? realTimers(),
      },
      { persist: import.meta.env.MODE !== 'test' },
    )
    const controller = new InstrumentController(engine)
    const midiInput = new MidiInput(midi ?? realMidiBoundary(), {
      onNoteOn: (note, velocity) => controller.noteOn(note, velocity, 'midi'),
      onNoteOff: (note) => controller.noteOff(note, 'midi'),
      onSustain: (down) => controller.setSustain(down),
      onAllNotesOff: () => controller.allNotesOff('midi'),
      onControlPedal: (value) => engine.setControlPedal(value),
    })
    const detachPanel = bindPanel(store, engine)
    const detachKeys = controller.attachWindow(window)
    if (import.meta.env.MODE !== 'test') void engine.preloadSamples()
    if (!cancelled) setSession({ engine, controller, midi: midiInput })
    onEngine?.(engine)
    void midiInput.start()
    return () => {
      cancelled = true
      controller.allNotesOff('unmount')
      detachKeys()
      detachPanel()
      midiInput.close()
      engine.dispose()
    }
  }, [audio, midi, store, timers, onEngine])

  return (
    <main className="stage-app">
      <h1 className="sr-only">Nord Stage 4 73</h1>
      <div
        className="instrument"
        data-testid="instrument"
        data-variant={VARIANT.id}
        data-aspect={VARIANT.aspectRatio}
        role="application"
        aria-label="Nord Stage 4 73"
      >
        <div className="chassis" data-testid="chassis">
          <ControlDeck store={store} engine={session?.engine ?? null} midi={session?.midi ?? null} />
          <Keybed controller={session?.controller ?? null} engine={session?.engine ?? null} />
        </div>
      </div>
    </main>
  )
}

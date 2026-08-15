import { useEffect, useMemo, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import type { StatusSnapshot } from './piano/status'
import { StatusModel } from './piano/status'
import type { MidiPermission } from './piano/inputs'
import { ComputerKeyboard, MidiInputBinding } from './piano/inputs'
import type { NoteLifecycle } from './piano/lifecycle'
import { getSections } from './hardware/instrument'
import { Section } from './components/Section'
import { Keybed } from './components/Keybed'
import { useHardwareState } from './hardware/store'
import { StageEngine } from './audio/stage'
import { StageLifecycle } from './piano/lifecycle2'
import { syncEngineFromStore, masterLevelFrom } from './piano/bridge'
import { AudioGraph } from './audio/graph'
import { PianoLibrary } from './piano/library'

/**
 * Nord Stage 4 (variant 73) — Phase 2 reconstruction.
 *
 * The Piano section and Layer Effects become functional: two layers over a
 * shared master/limiter, a six-type instrument library (Grand/Upright/Electric
 * bundled sample sets; Clav/Digital/Misc synthesis), performance controls, and
 * the ordered effect chain. Master Level is real. Organ/Synth/Program controls
 * keep their honest decorative behavior.
 *
 * Phase 1 behavior is preserved: the keybed + keyboard + MIDI input path, the
 * pressed-state UI, truthful status, and the full visible surface.
 */

export function useStatus(snapshot: StatusModel): StatusSnapshot {
  return useSyncExternalStore(snapshot.subscribe, () => snapshot.snapshot)
}

function midiPermissionText(permission: MidiPermission): string {
  if (permission === 'granted') return 'MIDI connected'
  if (permission === 'denied') return 'MIDI unavailable'
  return 'Web MIDI not available'
}

export default function App() {
  const [midiPermission, setMidiPermission] = useState<MidiPermission>(null)
  const hardware = useHardwareState()

  // Singleton runtime resources, created once and torn down on unmount.
  const runtime = useRef<{ lifecycle: StageLifecycle; keyboard: ComputerKeyboard; midi: MidiInputBinding; status: StatusModel; graph: AudioGraph | null; library: PianoLibrary } | null>(null)
  if (!runtime.current) {
    // The StageEngine is the single source of truth; StageLifecycle drives it
    // with the same note API the keybed/keyboard/MIDI adapters expect.
    const status = new StatusModel()
    const stage = new StageEngine()
    const lifecycle = new StageLifecycle(stage)
    const keyboard = new ComputerKeyboard({ lifecycle: lifecycle as unknown as NoteLifecycle, onActivity: () => {} })
    const midi = new MidiInputBinding({ lifecycle: lifecycle as unknown as NoteLifecycle, onPermissionChange: (permission) => setMidiPermission(permission) })
    let graph: AudioGraph | null = null
    try {
      graph = new AudioGraph({ engine: stage, masterLevel: masterLevelFrom(hardware) })
    } catch {
      graph = null // headless/test: no Web Audio; DSP engine still renders
    }
    const library = new PianoLibrary({ engine: stage, status })
    runtime.current = { lifecycle, keyboard, midi, status, graph, library }
  }
  const { lifecycle, keyboard, midi, status, graph, library } = runtime.current

  // Sustain presentation from the lifecycle.
  const sustainVersion = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshotVersion)
  void sustainVersion

  // Push every hardware control change into the stage engine (layers, FX,
  // master level) so panel feedback and audio stay in lockstep.
  useEffect(() => {
    syncEngineFromStore(lifecycle.engine, hardware)
    graph?.setMasterLevel(masterLevelFrom(hardware))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardware])

  useEffect(() => {
    keyboard.attach()
    void library.load() // sets ready (or labeled fallback on failure)
    void midi.connect().then(setMidiPermission)
    return () => {
      keyboard.detach()
      midi.dispose()
      lifecycle.dispose()
      graph?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const statusSnap = useStatus(status)
  const sections = useMemo(getSections, [])

  const toggleSustain = () => lifecycle.setSustain(!lifecycle.engine.sustainInput)

  return (
    <main className="instrument-stage" aria-label="Nord Stage 4 73">
      <div className="instrument">
        <div className="chassis">
          {/* top rail */}
          <div className="chassis-top-rail" />
          {/* control deck */}
          <div className="deck">
            {sections.map((section) => (
              <Section key={section.id} section={section} />
            ))}
          </div>
          {/* keybed */}
          <Keybed lifecycle={lifecycle as unknown as NoteLifecycle} />
          {/* bottom rail */}
          <div className="chassis-bottom-rail" />
        </div>

        {/* status + functional sustain strip (reflects real engine state) */}
        <div className="status-strip" role="status" aria-label="Piano status">
          <span className={`status-dot status--${statusSnap.status}`} aria-hidden="true" />
          <span className="status-message">{statusSnap.message}</span>
          <button
            type="button"
            className={`sustain-pedal ${lifecycle.engine.sustainInput ? 'on' : ''}`}
            aria-pressed={lifecycle.engine.sustainInput}
            onClick={toggleSustain}
          >
            Sustain pedal
          </button>
          <span className="midi-status">{midiPermissionText(midiPermission)}</span>
          <span className="keyboard-hint" aria-hidden="true">Keys: z x c v b n m · q w e r t y u · s d g h j · 2 3 5 6 7 · Space = sustain</span>
        </div>
      </div>
    </main>
  )
}

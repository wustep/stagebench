import { useEffect, useMemo, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import type { StatusSnapshot } from './piano/status'
import { StatusModel } from './piano/status'
import type { MidiPermission } from './piano/inputs'
import { PianoEngine } from './audio/engine'
import { NoteLifecycle } from './piano/lifecycle'
import { ComputerKeyboard, MidiInputBinding } from './piano/inputs'
import { getSections } from './hardware/instrument'
import { Section } from './components/Section'
import { Keybed } from './components/Keybed'

/**
 * Nord Stage 4 (variant 73) — Phase 1 reconstruction.
 *
 * The complete visible surface is render + decorative presentation state in a
 * normalized hardware store. The ONLY functional audio path is a single
 * dependable synthesized piano voice fed through one note lifecycle, plus
 * sustain input. Every panel control moves/presses accessibly and changes
 * nothing else.
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

  // Singleton runtime resources, created once and torn down on unmount.
  const runtime = useRef<{ lifecycle: NoteLifecycle; keyboard: ComputerKeyboard; midi: MidiInputBinding; status: StatusModel } | null>(null)
  if (!runtime.current) {
    const engine = new PianoEngine()
    const status = new StatusModel()
    const lifecycle = new NoteLifecycle({ engine, onStateChange: () => {} })
    const keyboard = new ComputerKeyboard({ lifecycle, onActivity: () => {} })
    const midi = new MidiInputBinding({
      lifecycle,
      onPermissionChange: (permission) => setMidiPermission(permission),
    })
    runtime.current = { lifecycle, keyboard, midi, status }
  }
  const { lifecycle, keyboard, midi, status } = runtime.current

  // Sustain presentation from the lifecycle.
  const sustainVersion = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshotVersion)
  void sustainVersion

  useEffect(() => {
    keyboard.attach()
    // truthful status: synthesized voice is ready, no assets to download.
    status.setReady('Basic piano ready (synthesized voice)')
    void midi.connect().then(setMidiPermission)
    return () => {
      keyboard.detach()
      midi.dispose()
      lifecycle.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const statusSnap = useStatus(status)
  const sections = useMemo(getSections, [])

  const toggleSustain = () => lifecycle.setSustain(!lifecycle.engine.isSustain)

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
          <Keybed lifecycle={lifecycle} />
          {/* bottom rail */}
          <div className="chassis-bottom-rail" />
        </div>

        {/* status + functional sustain strip (reflects real engine state) */}
        <div className="status-strip" role="status" aria-label="Piano status">
          <span className={`status-dot status--${statusSnap.status}`} aria-hidden="true" />
          <span className="status-message">{statusSnap.message}</span>
          <button
            type="button"
            className={`sustain-pedal ${lifecycle.engine.isSustain ? 'on' : ''}`}
            aria-pressed={lifecycle.engine.isSustain}
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
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
import { useHardwareState, hardwareStore } from './hardware/store'
import { System4 } from './audio/system4'
import { SystemLifecycle } from './system/lifecycle'
import { syncSystemFromStore } from './system/bridge'
import { SystemGraph } from './audio/graph4'
import { PianoLibrary } from './piano/library'

/**
 * Nord Stage 4 (variant 73) — Phase 3 complete system.
 *
 * The full instrument: a System4 orchestrator (Piano + Organ + Synth over one
 * shared Rotary and master/limiter path) with 32 program slots + 8 Live,
 * splits/zones/scenes/morphs, master clock, transpose and Panic. The surface,
 * keybed, computer-keyboard and MIDI input paths are unchanged from Phase 1;
 * the whole signal graph renders through one AudioContext.
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

  const runtime = useRef<{
    lifecycle: SystemLifecycle
    keyboard: ComputerKeyboard
    midi: MidiInputBinding
    status: StatusModel
    graph: SystemGraph | null
    library: PianoLibrary
  } | null>(null)
  if (!runtime.current) {
    const status = new StatusModel()
    const system = new System4()
    const lifecycle = new SystemLifecycle(system)
    const keyboard = new ComputerKeyboard({ lifecycle: lifecycle as unknown as NoteLifecycle, onActivity: () => {} })
    const midi = new MidiInputBinding({ lifecycle: lifecycle as unknown as NoteLifecycle, onPermissionChange: (permission) => setMidiPermission(permission) })
    let graph: SystemGraph | null = null
    try {
      graph = new SystemGraph({ engine: system, masterLevel: 0.8 })
    } catch {
      graph = null // headless/test: no Web Audio; DSP engine still renders
    }
    const library = new PianoLibrary({ engine: system.piano, status })
    runtime.current = { lifecycle, keyboard, midi, status, graph, library }
  }
  const { lifecycle, keyboard, midi, status, graph, library } = runtime.current

  const sustainVersion = useSyncExternalStore(lifecycle.subscribe, lifecycle.getSnapshotVersion)
  void sustainVersion

  // Program display lives on the System4 engine (dirty / name / index).
  const progVersion = useSyncExternalStore(lifecycle.engine.subscribe, lifecycle.engine.getSnapshotVersion)
  void progVersion

  // Push every hardware control change into the System4 instrument.
  useEffect(() => {
    const master = syncSystemFromStore(lifecycle.engine, hardware)
    graph?.setMasterLevel(master)
    reflectDisplays(lifecycle.engine)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hardware, progVersion])

  useEffect(() => {
    keyboard.attach()
    void library.load()
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
  const tapClock = () => lifecycle.engine.tap()
  const transposeUp = () => lifecycle.engine.setTranspose(lifecycle.engine.currentProgram.transpose + 1)
  const transposeDown = () => lifecycle.engine.setTranspose(lifecycle.engine.currentProgram.transpose - 1)
  const transitPending = lifecycle.engine.isDirty && !lifecycle.engine.isLiveMode ? 'E' : ''

  return (
    <main className="instrument-stage" aria-label="Nord Stage 4 73">
      <div className="instrument">
        <div className="chassis">
          <div className="chassis-top-rail" />
          <div className="deck">
            {sections.map((section) => (
              <Section key={section.id} section={section} />
            ))}
          </div>
          <Keybed lifecycle={lifecycle as unknown as NoteLifecycle} />
          <div className="chassis-bottom-rail" />
        </div>

        <div className="status-strip" role="status" aria-label="Instrument status">
          <span className={`status-dot status--${statusSnap.status}`} aria-hidden="true" />
          <span className="status-message">{statusSnap.message}</span>
          <button
            type="button"
            className={`sustain-pedal ${lifecycle.engine.sustainInput ? 'on' : ''}`}
            aria-pressed={lifecycle.engine.sustainInput}
            onClick={toggleSustain}
          >
            Sustain
          </button>
          <button
            type="button"
            className="clock-tap"
            aria-label="Master clock tap"
            onClick={tapClock}
          >
            MST CLK {Math.round(lifecycle.engine.currentProgram.clock.tempo)} BPM
          </button>
          <button type="button" className="transpose" aria-label="Transpose down" onClick={transposeDown}>T-</button>
          <span className="transpose-value" aria-label="Transpose">{lifecycle.engine.currentProgram.transpose > 0 ? `+${lifecycle.engine.currentProgram.transpose}` : lifecycle.engine.currentProgram.transpose}</span>
          <button type="button" className="transpose" aria-label="Transpose up" onClick={transposeUp}>T+</button>
          <button
            type="button"
            className="panic"
            aria-label="Panic (all notes off)"
            onClick={() => lifecycle.panic()}
          >
            Panic
          </button>
          <span className="program-readout" aria-label="Program state">
            {lifecycle.engine.isLiveMode ? 'LIVE' : `P${lifecycle.engine.page + 1}.${(lifecycle.engine.currentIndex % 8) + 1}`}{transitPending}
          </span>
          <span className="midi-status">{midiPermissionText(midiPermission)}</span>
          <span className="keyboard-hint" aria-hidden="true">Keys: z x c v b n m · q w e r t y u · s d g h j · 2 3 5 6 7 · Space = sustain</span>
        </div>
      </div>
    </main>
  )
}

/** Push the current program name / synth readout into the OLED store values. */
function reflectDisplays(system: System4): void {
  const name = system.currentProgram.name
  hardwareStore.set('prog.oled', name)
  const layer = system.currentProgram.synth.layers[0]
  hardwareStore.set('synth.oled', `${layer.category} · ${layer.wave}/${layer.filterType}`)
}

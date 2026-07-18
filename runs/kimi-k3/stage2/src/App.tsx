import { useEffect, useMemo, useRef, useState } from 'react'
import { PianoEngine, type EngineStatus } from './audio/engine'
import { createWebAudioBackend } from './audio/web-audio-backend'
import { SilentBackend } from './audio/silent-backend'
import { attachMidi, requestMidiAccess, type MidiStatus } from './input/midi'
import { AppContext, FALLBACK_LABEL, SYNTH_FALLBACK_LABEL, type StatusSnapshot } from './state/app-context'
import { SECTIONS, VERTICAL_ALLOCATION } from './hardware/variant'
import { EffectsSection, OrganSection, PerformanceSection, PianoSection, ProgramSection, SynthSection } from './components/sections'
import { Keybed } from './components/keybed'
import { inRange } from './hardware/keys'
import { subscribeHardware } from './state/hardware-store'
import { syncFunctionalControls } from './state/panel-bindings'

const SECTION_VIEWS: Record<string, () => React.JSX.Element> = {
  performance: PerformanceSection,
  organ: OrganSection,
  piano: PianoSection,
  program: ProgramSection,
  synth: SynthSection,
  effects: EffectsSection,
}

export interface AppProps {
  /** Test seam: inject a fully-built engine. */
  engine?: PianoEngine
  /** Test seam: inject MIDI access instead of navigator.requestMIDIAccess. */
  midiAccess?: Parameters<typeof attachMidi>[0] | null
  /** Test seam: skip MIDI wiring entirely. */
  disableMidi?: boolean
}

export default function App({ engine: injectedEngine, midiAccess, disableMidi }: AppProps = {}) {
  const engine = useMemo(() => {
    if (injectedEngine) return injectedEngine
    const backend = createWebAudioBackend()
    if (!backend) {
      // Honest fallback: no Web Audio — status reports it, nothing pretends.
      const e = new PianoEngine(new SilentBackend())
      void e.init().then(() => e.fail(`${FALLBACK_LABEL}: Web Audio unavailable in this browser`))
      return e
    }
    const e = new PianoEngine(backend)
    backend.onLibraryError = (type, detail) => {
      // Sample asset failure: labeled synthesized fallback stays playable.
      e.markTypeFailed(type, `${SYNTH_FALLBACK_LABEL}: ${type} samples failed to load (${detail})`)
    }
    void e.init()
    return e
  }, [injectedEngine])

  const [status, setStatus] = useState<StatusSnapshot>({
    audio: engine.getStatus().status,
    audioDetail: engine.getStatus().detail,
    midi: 'unsupported',
    fallback: engine.getStatus().status === 'error',
  })
  const [typeFailure, setTypeFailure] = useState<string>('')

  // Audio status mirroring (engine is the source of truth).
  useEffect(() => {
    const onStatus = (s: EngineStatus, detail?: string) =>
      setStatus((prev) => ({ ...prev, audio: s, audioDetail: detail ?? '', fallback: s === 'error' }))
    // Wrap: rebuild a mirror by polling once (engine events were set at build time only for injected engines).
    onStatus(engine.getStatus().status, engine.getStatus().detail)
    const id = setInterval(() => onStatus(engine.getStatus().status, engine.getStatus().detail), 250)
    return () => clearInterval(id)
  }, [engine])

  // Sample-asset failure mirroring (labeled synthesized fallback).
  useEffect(() => {
    const check = () => {
      const failed = ['grand', 'upright', 'electric', 'clav', 'digital', 'misc'].find((t) => engine.isTypeFailed(t as 'grand'))
      setTypeFailure(failed ? `${SYNTH_FALLBACK_LABEL}: ${failed} samples failed to load — synthesized voice active` : '')
    }
    check()
    const id = setInterval(check, 150)
    return () => clearInterval(id)
  }, [engine])

  // Initial panel → engine sync (functional controls), once on mount.
  useEffect(() => {
    syncFunctionalControls(engine)
    return subscribeHardware(() => {
      // Presentation store changed; functional sync happens in the control
      // components themselves — this subscription only re-renders status.
    })
  }, [engine])

  // MIDI wiring with truthful status and cleanup on disconnect/unmount.
  useEffect(() => {
    if (disableMidi) return
    let detach: (() => void) | undefined
    let cancelled = false
    const setMidi = (midi: MidiStatus) => setStatus((prev) => ({ ...prev, midi }))
    const wire = (access: Parameters<typeof attachMidi>[0]) => {
      detach = attachMidi(access, {
        noteOn: (note, vel) => {
          if (inRange(note)) engine.noteOn(note, vel)
        },
        noteOff: (note) => {
          if (inRange(note)) engine.noteOff(note)
        },
        sustain: (down) => engine.setSustain(down),
        onStatus: (s) => setMidi(s),
      })
    }
    if (midiAccess) {
      wire(midiAccess)
    } else {
      requestMidiAccess()
        .then((access) => {
          if (cancelled) return
          wire(access)
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          setMidi(/not supported/i.test(msg) ? 'unsupported' : 'denied')
        })
    }
    return () => {
      cancelled = true
      detach?.()
      engine.allNotesOff() // disconnect/unmount cleanup
    }
  }, [engine, midiAccess, disableMidi])

  // Unmount cleanup: stop every owned voice.
  const engineRef = useRef(engine)
  engineRef.current = engine
  useEffect(() => () => engineRef.current.dispose(), [])

  return (
    <AppContext.Provider value={{ engine }}>
      <main className="page">
        <div className="instrument" data-instrument="">
          <div className="deck" style={{ height: `${VERTICAL_ALLOCATION.controlDeck * 100}%` }}>
            {SECTIONS.map((s) => {
              const View = SECTION_VIEWS[s.id]
              return (
                <div key={s.id} className="section-slot" style={{ width: `${s.fraction * 100}%` }} data-section-slot={s.id}>
                  <View />
                </div>
              )
            })}
          </div>
          <div className="keybed-wrap" style={{ height: `${VERTICAL_ALLOCATION.keybed * 100}%` }}>
            <Keybed />
          </div>
        </div>
        <footer className="statusbar" aria-live="polite">
          <span data-status="audio">
            Piano voice: {status.audio === 'ready' ? 'ready (recorded sample library)' : status.audio === 'loading' ? 'loading…' : status.fallback ? `${FALLBACK_LABEL} — ${status.audioDetail}` : `error — ${status.audioDetail}`}
            {typeFailure ? ` · ${typeFailure}` : ''}
          </span>
          <span data-status="midi">MIDI: {status.midi}</span>
          <span className="status-hint">Keys Z–M / Q–I play · space = sustain · Piano, Effects &amp; Master Level are live; Organ/Synth/Program stay decorative</span>
        </footer>
      </main>
    </AppContext.Provider>
  )
}

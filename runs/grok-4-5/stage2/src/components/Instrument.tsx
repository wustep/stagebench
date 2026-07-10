import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { PianoEngine, type AudioStatus } from '../audio/piano-engine'
import { attachKeyboardInput } from '../input/keyboard'
import { MidiInput } from '../input/midi'
import { hardwareStore } from '../state/hardware-store'
import { registerEngine } from '../state/engine-registry'
import { ControlDeck } from './ControlDeck'
import { Keybed } from './Keybed'
import { VERTICAL_ALLOCATION } from '../model/hardware'
import { VARIANT } from '../model/variant'

export interface InstrumentProps {
  engine?: PianoEngine
  enableMidi?: boolean
  requestMidiAccess?: () => Promise<import('../input/midi').MidiAccessLike>
}

export function Instrument({ engine: externalEngine, enableMidi = true, requestMidiAccess }: InstrumentProps) {
  const engineRef = useRef<PianoEngine | null>(null)
  if (!engineRef.current) {
    engineRef.current = externalEngine ?? new PianoEngine()
  }
  const engine = engineRef.current
  const [status, setStatus] = useState<AudioStatus>(engine.getStatus())
  const [statusMsg, setStatusMsg] = useState(engine.getStatusMessage())
  const [midiState, setMidiState] = useState('pending')
  const midiNotes = useRef(new Map<number, string>())
  const kbNotes = useRef(new Map<number, string>())

  useEffect(() => {
    registerEngine(engine)
    return () => registerEngine(null)
  }, [engine])

  useEffect(() => {
    let cancelled = false
    const unsub = engine.onStatus((s) => {
      if (!cancelled) {
        setStatus(s)
        setStatusMsg(engine.getStatusMessage())
      }
    })
    void engine.init().then(() => {
      if (!cancelled) {
        setStatus(engine.getStatus())
        setStatusMsg(engine.getStatusMessage())
      }
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [engine])

  useEffect(() => {
    const detach = attachKeyboardInput({
      onNoteOn: (midi, velocity) => {
        const id = engine.noteOn(midi, velocity, 'keyboard')
        if (id) {
          kbNotes.current.set(midi, id)
          hardwareStore.setKeyPressed(midi, true)
        }
      },
      onNoteOff: (midi) => {
        const id = kbNotes.current.get(midi)
        if (id) {
          engine.noteOff(id)
          kbNotes.current.delete(midi)
        } else {
          engine.noteOffByMidi(midi)
        }
        hardwareStore.setKeyPressed(midi, false)
      },
      onSustain: (down) => {
        engine.setSustain(down)
      },
    })
    return detach
  }, [engine])

  useEffect(() => {
    if (!enableMidi) {
      setMidiState('unsupported')
      return
    }
    const midi = new MidiInput({
      requestAccess: requestMidiAccess,
      handlers: {
        onNoteOn: (m, v) => {
          const id = engine.noteOn(m, v, 'midi')
          if (id) {
            midiNotes.current.set(m, id)
            hardwareStore.setKeyPressed(m, true)
          }
        },
        onNoteOff: (m) => {
          const id = midiNotes.current.get(m)
          if (id) {
            engine.noteOff(id)
            midiNotes.current.delete(m)
          } else {
            engine.noteOffByMidi(m)
          }
          hardwareStore.setKeyPressed(m, false)
        },
        onSustain: (down) => engine.setSustain(down),
        onStateChange: (s) => setMidiState(s),
      },
    })
    void midi.connect()
    return () => {
      midi.disconnect()
      engine.allNotesOff()
    }
  }, [engine, enableMidi, requestMidiAccess])

  useEffect(() => {
    const onBlur = () => {
      engine.allNotesOff()
      for (const m of hardwareStore.getPressedKeys()) {
        hardwareStore.setKeyPressed(m, false)
      }
      kbNotes.current.clear()
      midiNotes.current.clear()
    }
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      engine.allNotesOff()
    }
  }, [engine])

  useEffect(() => {
    return () => {
      if (!externalEngine) {
        engine.dispose()
      } else {
        engine.allNotesOff()
      }
    }
  }, [engine, externalEngine])

  const piano = engine.getPianoState()
  const modelLabel = `${piano.type} ${piano.modelIndex + 1}`

  return (
    <div
      className="instrument"
      data-testid="instrument"
      data-variant={VARIANT.id}
      data-audio-status={status}
      data-midi-state={midiState}
      data-piano-type={piano.type}
      data-layer-focus={piano.focus}
      style={
        {
          ['--deck-frac' as string]: VERTICAL_ALLOCATION.controlDeck,
          ['--keybed-frac' as string]: VERTICAL_ALLOCATION.keybed,
          aspectRatio: `${VARIANT.aspectRatio}`,
        } as CSSProperties
      }
    >
      <div className="instrument-top-rail" aria-hidden />
      <ControlDeck modelLabel={modelLabel} />
      <Keybed engine={engine} />
      <div className="instrument-bottom-rail" aria-hidden />
      <div className="status-bar" data-testid="audio-status" role="status" aria-live="polite">
        <span>Audio: {status}</span>
        {statusMsg ? <span data-testid="audio-status-message">{statusMsg}</span> : null}
        <span>MIDI: {midiState}</span>
        <span className="status-note" data-testid="phase1-honesty">
          Organ/Synth/Program controls are decorative (Phase 2)
        </span>
      </div>
    </div>
  )
}

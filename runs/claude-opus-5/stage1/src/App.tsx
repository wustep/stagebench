import { useEffect, useMemo, useState } from 'react'
import { Instrument } from './components/Instrument'
import { VARIANT } from './model/variant'
import { HardwareProvider } from './state/HardwareContext'
import { useInstrument, type InstrumentOptions } from './state/useInstrument'
import { midiToName } from './model/keyboard'

export interface AppProps {
  /** Injectable audio / MIDI / timing boundaries. Production passes nothing. */
  readonly boundaries?: InstrumentOptions
}

/**
 * The Phase 1 surface: the instrument plus a compact status strip.
 *
 * The status strip is deliberately not part of the instrument graphic (the visual spec forbids a
 * marketing hero above the instrument, and this sits below it). It exists because Phase 1 must
 * report truthful audio and MIDI state and expose the sustain input, neither of which the
 * hardware surface can honestly show while every panel control is decorative.
 */
export default function App({ boundaries }: AppProps = {}) {
  const instrument = useInstrument(boundaries)
  const [zoom, setZoom] = useState(1)
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(max-width: 720px)')
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  const display = useMemo(
    () => ({
      audioMessage: instrument.audio.message,
      audioLabel: audioLabel(instrument.audio.status),
      midiMessage: midiLabel(instrument.midi.permission),
      soundingVoices: instrument.heldNotes.size,
    }),
    [instrument.audio.message, instrument.audio.status, instrument.midi.permission, instrument.heldNotes.size],
  )

  return (
    <HardwareProvider>
      <main className="stage">
        <div className="stage__viewport">
          <div className="stage__scaler" style={{ width: `${zoom * 100}%` }}>
            <Instrument
              heldNotes={instrument.heldNotes}
              display={display}
              noteOn={instrument.noteOn}
              noteOff={instrument.noteOff}
            />
          </div>
        </div>

        <div className="statusbar">
          <p className="statusbar__line" data-audio-status={instrument.audio.status}>
            <strong>Audio</strong>
            <span role="status">{instrument.audio.message}</span>
          </p>
          <p className="statusbar__line" data-midi-permission={instrument.midi.permission}>
            <strong>MIDI</strong>
            <span role="status">
              {instrument.midi.message}
              {instrument.midi.inputNames.length > 0 ? ` (${instrument.midi.inputNames.join(', ')})` : ''}
            </span>
          </p>
          <div className="statusbar__controls">
            {instrument.audio.status === 'idle' ? (
              <button type="button" className="uibtn" onClick={instrument.startAudio}>
                Start audio
              </button>
            ) : null}
            <button
              type="button"
              className="uibtn"
              aria-pressed={instrument.sustain}
              onPointerDown={() => instrument.setSustain(true)}
              onPointerUp={() => instrument.setSustain(false)}
              onPointerCancel={() => instrument.setSustain(false)}
              onPointerLeave={() => instrument.setSustain(false)}
            >
              Sustain pedal {instrument.sustain ? '(down)' : '(up)'}
            </button>
            <span className="uihint">
              Computer keys A–; play from <output>{midiToName(instrument.baseMidi)}</output> (W E T Y U O P
              are the black keys). Z / X shift an octave, Space holds sustain.
            </span>
            {narrow ? (
              <label className="uizoom">
                Zoom
                <input
                  type="range"
                  min={1}
                  max={4}
                  step={0.5}
                  value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
                <output>{zoom}×</output>
              </label>
            ) : null}
          </div>
          <p className="statusbar__note">
            Phase 1 of the {VARIANT.fullName}: the keybed and the sustain input make sound. Every panel
            control moves, lights and reports its value but is otherwise inert — nothing on the deck is
            connected to audio yet.
          </p>
        </div>
      </main>
    </HardwareProvider>
  )
}

function audioLabel(status: string): string {
  switch (status) {
    case 'ready':
      return 'AUDIO READY'
    case 'starting':
      return 'AUDIO STARTING'
    case 'idle':
      return 'AUDIO SUSPENDED'
    case 'unsupported':
      return 'NO WEB AUDIO'
    default:
      return 'AUDIO ERROR'
  }
}

function midiLabel(permission: string): string {
  switch (permission) {
    case 'granted':
      return 'MIDI ON'
    case 'denied':
      return 'MIDI DENIED'
    case 'requesting':
      return 'MIDI …'
    default:
      return 'NO MIDI'
  }
}

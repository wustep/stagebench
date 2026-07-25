import { useEffect, useMemo, useState } from 'react'
import { Instrument } from './components/Instrument'
import { VARIANT } from './model/variant'
import { pianoModel, pianoType } from './audio/pianoTypes'
import { HardwareProvider, useDeck } from './state/HardwareContext'
import { deriveSettings } from './state/settings'
import { useInstrument, type InstrumentOptions } from './state/useInstrument'
import { midiToName } from './model/keyboard'

export interface AppProps {
  /** Injectable audio / MIDI / timing / asset boundaries. Production passes nothing. */
  readonly boundaries?: InstrumentOptions
}

/**
 * The Phase 2 surface: the instrument plus a compact status strip.
 *
 * The status strip is deliberately not part of the instrument graphic (the visual spec forbids a
 * marketing hero above the instrument, and this sits below it). It exists because the phase must
 * report truthful audio, sample-library and MIDI state and expose the sustain input, none of
 * which the hardware surface can honestly show on its own.
 */
export default function App({ boundaries }: AppProps = {}) {
  return (
    <HardwareProvider>
      <AppBody boundaries={boundaries} />
    </HardwareProvider>
  )
}

function AppBody({ boundaries }: AppProps) {
  const deck = useDeck()
  // One pure mapping from the panel to the engine; the engine applies it to real audio nodes.
  const settings = useMemo(() => deriveSettings(deck), [deck])
  const instrument = useInstrument({ ...boundaries, settings })
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

  const focusedLayer = settings.layers[deck.focus]
  const type = pianoType(focusedLayer.type)
  const model = pianoModel(focusedLayer.type, focusedLayer.model)

  const display = useMemo(
    () => ({
      audioMessage: instrument.audio.message,
      audioLabel: audioLabel(instrument.audio.status),
      midiMessage: midiLabel(instrument.midi.permission),
      soundingVoices: instrument.heldNotes.size,
      focus: deck.focus,
      typeLabel: type.label,
      modelName: model.name,
      sourceLabel:
        type.source === 'recorded'
          ? instrument.samples.fallbackActive
            ? 'FALLBACK VOICE'
            : 'RECORDED SAMPLES'
          : 'SYNTHESISED',
      octave: focusedLayer.octave,
    }),
    [
      deck.focus,
      focusedLayer.octave,
      instrument.audio.message,
      instrument.audio.status,
      instrument.heldNotes.size,
      instrument.midi.permission,
      instrument.samples.fallbackActive,
      model.name,
      type.label,
      type.source,
    ],
  )

  return (
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
        <p className="statusbar__line" data-sample-fallback={instrument.samples.fallbackActive ? 'true' : 'false'}>
          <strong>Samples</strong>
          <span role="status">{instrument.samples.message}</span>
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
          Phase 2 of the {VARIANT.fullName}: the keybed, the Piano section, the Layer Effects section,
          Master Level and the Rotary Speaker speed and drive are live. The Organ, Synth and Program
          controls still move, light and report their value but are connected to no audio.
        </p>
      </div>
    </main>
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

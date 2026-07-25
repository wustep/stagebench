import { useCallback, useEffect, useMemo, useState } from 'react'
import { Instrument } from './components/Instrument'
import { VARIANT } from './model/variant'
import { pianoModel, pianoType } from './audio/pianoTypes'
import { HardwareProvider, useDeck, useHardware } from './state/HardwareContext'
import type { SnapshotStore } from './state/program'
import { deriveSettings } from './state/settings'
import { useInstrument, type InstrumentOptions } from './state/useInstrument'
import { midiToName } from './model/keyboard'

export interface AppProps {
  /** Injectable audio / MIDI / timing / asset boundaries. Production passes nothing. */
  readonly boundaries?: InstrumentOptions
  /** Storage boundary for the Live slots; `null` disables persistence (hermetic tests). */
  readonly store?: SnapshotStore | null
}

/**
 * The Phase 2 surface: the instrument plus a compact status strip.
 *
 * The status strip is deliberately not part of the instrument graphic (the visual spec forbids a
 * marketing hero above the instrument, and this sits below it). It exists because the phase must
 * report truthful audio, sample-library and MIDI state and expose the sustain input, none of
 * which the hardware surface can honestly show on its own.
 */
export default function App({ boundaries, store }: AppProps = {}) {
  return (
    <HardwareProvider store={store}>
      <AppBody boundaries={boundaries} />
    </HardwareProvider>
  )
}

function AppBody({ boundaries }: AppProps) {
  const deck = useDeck()
  const hardware = useHardware()
  // One pure mapping from the panel to the engine; the engine applies it to real audio nodes.
  const settings = useMemo(() => deriveSettings(deck), [deck])
  const setPedal = hardware.setPedal
  const onExpression = useCallback((value: number) => setPedal(value), [setPedal])
  const instrument = useInstrument({
    ...boundaries,
    settings,
    panicCount: deck.panicCount,
    onExpression,
  })
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
            splitPoints={deck.split.on ? deck.split.points.filter((point) => point.enabled) : []}
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
          <label className="uizoom">
            Control pedal
            <input
              type="range"
              aria-label="Control Pedal"
              min={0}
              max={1}
              step={0.01}
              value={deck.pedal}
              onChange={(event) => setPedal(Number(event.target.value))}
            />
            <output>{Math.round(deck.pedal * 100)}%</output>
          </label>
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
          Phase 3 of the {VARIANT.fullName}: every section is live — Organ, Piano, Synth, Layer
          Effects, the Rotary Speaker, and the Program system with 32 programs, 8 Live slots,
          splits, Layer Scenes, morphs, Master Clock, Transpose and Panic. Nine controls stay
          decorative because the specs exclude their behaviour: the Delay Effects selector, the
          Organ Preset button, the A.T. morph source, the three Preset Library buttons, Solo/Undo,
          Section Edit and Mon/Copy. They move, light and report their value and are connected to
          no audio.
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

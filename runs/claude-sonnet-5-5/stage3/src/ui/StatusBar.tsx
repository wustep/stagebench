import type { KeyboardEvent, PointerEvent } from 'react'
import { CONTROLS } from '../hardware/layout'
import { EXCLUDED_REASONS, PARTIAL_NOTES } from '../engine/panelBindings'
import { setPedalPos } from '../engine/edits'
import { useEngineState, useInstrument, useInstrumentSnapshot, useProgramsSnapshot } from './context'

const LABEL_OF = new Map(CONTROLS.map((c) => [c.id, c.label]))

/** App chrome (not part of the instrument): truthful audio / MIDI status and a sustain pedal button. */
export default function StatusBar({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }) {
  const instrument = useInstrument()
  const snap = useInstrumentSnapshot()
  const state = useEngineState()
  const programs = useProgramsSnapshot()
  const pedalDown = () => {
    instrument?.wake()
    instrument?.lifecycle.sustain('ui:pedal', true)
  }
  const pedalUp = () => instrument?.lifecycle.sustain('ui:pedal', false)
  const canConnect = snap.midi.phase !== 'unsupported' && snap.midi.phase !== 'requesting'

  return (
    <footer className="statusbar" aria-label="Instrument status">
      <p className={`status status--${snap.audio.phase}`} data-testid="audio-status" data-phase={snap.audio.phase}>
        <strong>Audio</strong> {snap.audio.message}
      </p>
      <p className={`status status--midi-${snap.midi.phase}`} data-testid="midi-status" data-phase={snap.midi.phase}>
        <strong>MIDI</strong> {snap.midi.message}{' '}
        <button type="button" className="chrome-btn" disabled={!canConnect} onClick={() => void instrument?.midi.connect()}>
          Connect MIDI
        </button>
      </p>
      <p className="status">
        <button
          type="button"
          className="chrome-btn"
          aria-pressed={snap.sustain}
          data-testid="sustain-button"
          onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
            e.currentTarget.setPointerCapture?.(e.pointerId)
            pedalDown()
          }}
          onPointerUp={pedalUp}
          onPointerCancel={pedalUp}
          onLostPointerCapture={pedalUp}
          onBlur={pedalUp}
          onKeyDown={(e: KeyboardEvent) => {
            if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
              e.preventDefault()
              pedalDown()
            }
          }}
          onKeyUp={(e: KeyboardEvent) => {
            if (e.key === ' ' || e.key === 'Enter') pedalUp()
          }}
        >
          Sustain pedal (hold)
        </button>{' '}
        <span data-testid="voice-status">
          Voices {snap.voices}/{snap.maxVoices} · Sustain {snap.sustain ? 'on' : 'off'}
        </span>
      </p>
      <p className="status status--pedal">
        <label>
          <strong>Control pedal</strong> (Control Pedal morph source; MIDI CC11 too){' '}
          <input
            type="range"
            className="pedal-slider"
            data-testid="control-pedal"
            aria-label="Control pedal"
            min={0}
            max={127}
            value={Math.round(state.pedalPos * 127)}
            onChange={(e) => instrument?.state.update((s) => setPedalPos(s, Number(e.target.value) / 127))}
          />
        </label>{' '}
        <span data-testid="program-status">
          {programs.storageOk ? 'Programs and Live slots are saved in this browser' : 'Storage unavailable: programs last for this session only'}
        </span>
      </p>
      <p className="status status--zoom">
        <button type="button" className="chrome-btn" aria-pressed={zoom > 1} data-testid="zoom-button" onClick={() => onZoom(zoom > 1 ? 1 : 3)}>
          {zoom > 1 ? 'Fit instrument to screen' : 'Zoom in to inspect panel (scrolls sideways)'}
        </button>
      </p>
      <p className="status status--hint">
        Play with mouse, touch, MIDI or the computer keys (Z–/ lower row, Q–] upper row, Space = sustain). Every panel control is live except the ones the specs exclude, which are listed below.
      </p>
      <details className="audit" data-testid="control-audit">
        <summary>Unsupported controls (excluded by the specs): {Object.keys(EXCLUDED_REASONS).length}</summary>
        <ul>
          {Object.entries(EXCLUDED_REASONS).map(([id, reason]) => (
            <li key={id} data-control-audit={id}>
              {LABEL_OF.get(id) ?? id}: {reason}
            </li>
          ))}
          {Object.entries(PARTIAL_NOTES).map(([id, note]) => (
            <li key={id} data-control-partial={id}>
              {LABEL_OF.get(id) ?? id} (partly built): {note}
            </li>
          ))}
        </ul>
      </details>
    </footer>
  )
}

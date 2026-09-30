import type { KeyboardEvent, PointerEvent } from 'react'
import { useInstrument, useInstrumentSnapshot } from './context'

/** App chrome (not part of the instrument): truthful audio / MIDI status and a sustain pedal button. */
export default function StatusBar({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }) {
  const instrument = useInstrument()
  const snap = useInstrumentSnapshot()
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
      <p className="status status--zoom">
        <button type="button" className="chrome-btn" aria-pressed={zoom > 1} data-testid="zoom-button" onClick={() => onZoom(zoom > 1 ? 1 : 3)}>
          {zoom > 1 ? 'Fit instrument to screen' : 'Zoom in to inspect panel (scrolls sideways)'}
        </button>
      </p>
      <p className="status status--hint">
        Play the keybed with mouse, touch, MIDI or the computer keys (Z–/ lower row, Q–] upper row, Space = sustain). Panel controls move and light but do not change the
        sound in this phase.
      </p>
    </footer>
  )
}

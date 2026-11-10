import { useSyncExternalStore } from 'react'
import type { Session } from '../app/session'
import type { AudioStatus } from '../audio/engine'
import { noteName } from '../hardware/keys'
import type { MidiStatus } from '../input/midi'

interface ConsoleProps {
  session: Session
  zoom: number
  zoomSteps: readonly number[]
  onZoom: (zoom: number) => void
}

const AUDIO_LABEL: Record<AudioStatus, string> = {
  idle: 'Idle',
  loading: 'Loading',
  ready: 'Ready',
  fallback: 'Fallback',
  error: 'Error',
}

const MIDI_LABEL: Record<MidiStatus, string> = {
  unsupported: 'Unsupported',
  idle: 'Off',
  requesting: 'Asking permission',
  connected: 'Connected',
  'no-inputs': 'No input connected',
  denied: 'Denied',
  error: 'Error',
}

const PEDAL_SOURCE = 'ui:pedal'

/**
 * Everything that is not the instrument: live status, the two functional helpers that have
 * no place on the panel (MIDI permission and a sustain pedal), view zoom, and how to play.
 * It sits below the instrument so nothing stands between the viewer and the hardware.
 */
export function Console({ session, zoom, zoomSteps, onZoom }: ConsoleProps) {
  const audio = useSyncExternalStore(session.engine.subscribe, session.engine.getSnapshot, session.engine.getSnapshot)
  const midi = useSyncExternalStore(session.midi.subscribe, session.midi.getSnapshot, session.midi.getSnapshot)
  const notes = useSyncExternalStore(
    session.lifecycle.subscribe,
    session.lifecycle.getSnapshot,
    session.lifecycle.getSnapshot,
  )
  const baseNote = useSyncExternalStore(session.keyboard.subscribe, session.keyboard.getBaseNote, session.keyboard.getBaseNote)
  const pedalDown = notes.sustain

  const zoomIndex = zoomSteps.indexOf(zoom)
  const canEnableMidi = midi.status === 'idle'

  return (
    <aside className="console" aria-label="Status and playing help">
      <div className="console__row">
        <p className="chip" data-status-kind="audio" data-status={audio.status} role="status" aria-live="polite">
          <span className="chip__key">Audio</span>
          <span className="chip__value" data-testid="audio-status">
            {AUDIO_LABEL[audio.status]}
          </span>
          <span className="chip__detail">{audio.detail}</span>
        </p>
        <p className="chip" data-status-kind="midi" data-status={midi.status} role="status" aria-live="polite">
          <span className="chip__key">MIDI</span>
          <span className="chip__value" data-testid="midi-status">
            {MIDI_LABEL[midi.status]}
          </span>
          <span className="chip__detail">{midi.detail}</span>
        </p>
      </div>

      <div className="console__row console__row--tools">
        {canEnableMidi ? (
          <button type="button" className="tool" id="midi-enable" onClick={() => void session.midi.enable()}>
            Enable MIDI
          </button>
        ) : null}
        <button
          type="button"
          id="sustain-pedal"
          className="tool tool--pedal"
          aria-pressed={pedalDown}
          onClick={() => {
            session.wake()
            // The on-screen pedal latches: one tap down, one tap up.
            session.lifecycle.setSustain(PEDAL_SOURCE, !session.lifecycle.isSustainHeldBy(PEDAL_SOURCE))
          }}
        >
          Sustain pedal: {pedalDown ? 'down' : 'up'}
        </button>
        <button type="button" id="all-notes-off" className="tool" onClick={session.panic}>
          All notes off
        </button>
        <span className="readout" data-testid="voice-count">
          Voices: {audio.voices}
        </span>
        <span className="readout" data-testid="held-count">
          Keys held: {notes.held.length}
        </span>
        <span className="tool-group" role="group" aria-label="Computer keyboard octave">
          <button type="button" className="tool" aria-label="Octave down" onClick={() => session.keyboard.shiftOctave(-1)}>
            Z −
          </button>
          <span className="readout" data-testid="kbd-octave">
            A = {noteName(baseNote)}
          </span>
          <button type="button" className="tool" aria-label="Octave up" onClick={() => session.keyboard.shiftOctave(1)}>
            X +
          </button>
        </span>
        <span className="tool-group" role="group" aria-label="View zoom">
          <button
            type="button"
            className="tool"
            aria-label="Zoom out"
            disabled={zoomIndex <= 0}
            onClick={() => onZoom(zoomSteps[Math.max(0, zoomIndex - 1)])}
          >
            −
          </button>
          <button type="button" className="tool" aria-pressed={zoom === 1} onClick={() => onZoom(1)}>
            {zoom === 1 ? 'Fit' : `${zoom}×`}
          </button>
          <button
            type="button"
            className="tool"
            aria-label="Zoom in"
            disabled={zoomIndex >= zoomSteps.length - 1}
            onClick={() => onZoom(zoomSteps[Math.min(zoomSteps.length - 1, zoomIndex + 1)])}
          >
            +
          </button>
        </span>
      </div>

      <p className="console__note">
        <strong>Phase 1.</strong> The keybed plays one synthesized piano voice (live additive synthesis, not a
        recording). Every panel control moves or presses, but is decorative: it does not change the sound.
      </p>
      <p className="console__help">
        Play with mouse or touch (strike nearer the front edge for a harder hit), a MIDI keyboard, or the computer
        keys <kbd>A</kbd> <kbd>W</kbd> <kbd>S</kbd> <kbd>E</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>T</kbd> <kbd>G</kbd>{' '}
        <kbd>Y</kbd> <kbd>H</kbd> <kbd>U</kbd> <kbd>J</kbd> <kbd>K</kbd> <kbd>O</kbd> <kbd>L</kbd> <kbd>P</kbd>{' '}
        <kbd>;</kbd> <kbd>'</kbd>. <kbd>Z</kbd>/<kbd>X</kbd> shift the octave. <kbd>Space</kbd> is the sustain pedal
        unless a control has focus.
      </p>
    </aside>
  )
}

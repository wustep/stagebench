import type { PianoStatus } from '../audio/pianoEngine';
import type { MidiState } from '../input/midi';

interface StatusBarProps {
  pianoStatus: PianoStatus;
  midiState: MidiState;
  activeCount: number;
}

const PIANO_LABEL: Record<PianoStatus, string> = {
  idle: 'Idle',
  loading: 'Loading voice…',
  ready: 'Piano ready (synthesized voice)',
  error: 'Audio error',
  fallback: 'Silent fallback (no audio device)',
};

const MIDI_LABEL: Record<MidiState, string> = {
  unsupported: 'MIDI unsupported',
  requesting: 'Requesting MIDI…',
  denied: 'MIDI denied',
  ready: 'MIDI connected',
  disconnected: 'MIDI disconnected',
};

/**
 * Truthful status strip: reports the real piano voice state (synthesized, not
 * recorded), the real MIDI permission/connection state, and the live voice
 * count. Nothing here claims unimplemented behavior.
 */
export function StatusBar({ pianoStatus, midiState, activeCount }: StatusBarProps) {
  return (
    <div className="status-bar" role="status" aria-live="polite">
      <span className={`status-chip piano ${pianoStatus}`} data-piano-status={pianoStatus}>
        {PIANO_LABEL[pianoStatus]}
      </span>
      <span className={`status-chip midi ${midiState}`} data-midi-status={midiState}>
        {MIDI_LABEL[midiState]}
      </span>
      <span className="status-chip voices" data-voice-count={activeCount}>
        {activeCount} voice{activeCount === 1 ? '' : 's'}
      </span>
      <span className="status-note">
        Phase 1: keybed + one piano voice are live. All panel controls are decorative.
      </span>
    </div>
  );
}

import type { PianoStatus } from '../audio/pianoEngine';
import type { MidiState } from '../input/midi';

interface StatusBarProps {
  pianoStatus: PianoStatus;
  midiState: MidiState;
  activeCount: number;
  /**
   * How the currently sounding voice is produced. The Phase-2 engine plays
   * recorded sample sets for Grand/Upright/Electric ('recorded'); the Phase-1
   * regression path plays a synthesized placeholder voice ('synthesized'). The
   * label always tells the truth about the actual source.
   */
  soundSource?: 'recorded' | 'synthesized';
}

function pianoLabel(status: PianoStatus, source: 'recorded' | 'synthesized'): string {
  switch (status) {
    case 'idle':
      return 'Idle';
    case 'loading':
      return source === 'recorded' ? 'Loading recorded pianos…' : 'Loading voice…';
    case 'ready':
      return source === 'recorded'
        ? 'Piano ready (recorded + synth voices)'
        : 'Piano ready (synthesized voice)';
    case 'error':
      return 'Audio error';
    case 'fallback':
      return source === 'recorded'
        ? 'Playable fallback (synthesized; samples unavailable)'
        : 'Silent fallback (no audio device)';
  }
}

const MIDI_LABEL: Record<MidiState, string> = {
  unsupported: 'MIDI unsupported',
  requesting: 'Requesting MIDI…',
  denied: 'MIDI denied',
  ready: 'MIDI connected',
  disconnected: 'MIDI disconnected',
};

/**
 * Truthful status strip: reports the real piano voice state and its actual sound
 * source (recorded samples vs. synthesized), the real MIDI permission/connection
 * state, and the live voice count. Nothing here claims unimplemented behavior.
 */
export function StatusBar({ pianoStatus, midiState, activeCount, soundSource = 'recorded' }: StatusBarProps) {
  return (
    <div className="status-bar" role="status" aria-live="polite">
      <span className={`status-chip piano ${pianoStatus}`} data-piano-status={pianoStatus}>
        {pianoLabel(pianoStatus, soundSource)}
      </span>
      <span className={`status-chip midi ${midiState}`} data-midi-status={midiState}>
        {MIDI_LABEL[midiState]}
      </span>
      <span className="status-chip voices" data-voice-count={activeCount}>
        {activeCount} voice{activeCount === 1 ? '' : 's'}
      </span>
      <span className="status-note">
        {soundSource === 'recorded'
          ? 'Phase 2: Piano, Layer Effects, and Master Level are live. Organ, Synth, and Program stay decorative.'
          : 'Phase 1: keybed + one piano voice are live. All panel controls are decorative.'}
      </span>
    </div>
  );
}

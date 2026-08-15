import React from 'react';
import { AudioStatus } from '../audio/types';
import { MidiStatus } from '../input/MidiController';

interface StatusBarProps {
  audioStatus: AudioStatus;
  midiStatus: MidiStatus;
  activeVoiceCount: number;
  isSustained: boolean;
  onInitAudio: () => void;
  onToggleSustain: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  audioStatus,
  midiStatus,
  activeVoiceCount,
  isSustained,
  onInitAudio,
  onToggleSustain,
}) => {
  return (
    <footer className="instrument-status-bar" role="contentinfo" aria-label="Instrument Status">
      <div className="status-indicators-group">
        <div className="status-pill">
          <span className="pill-label">AUDIO:</span>
          <span className={`pill-value status-${audioStatus}`}>{audioStatus.toUpperCase()}</span>
          {(audioStatus === 'uninitialized' || audioStatus === 'suspended') && (
            <button
              type="button"
              className="status-action-btn"
              onClick={onInitAudio}
              aria-label="Initialize or Resume Audio Context"
            >
              Start Audio
            </button>
          )}
        </div>

        <div className="status-pill">
          <span className="pill-label">MIDI:</span>
          <span className={`pill-value status-${midiStatus}`}>{midiStatus.toUpperCase()}</span>
        </div>

        <div className="status-pill">
          <span className="pill-label">VOICES:</span>
          <span className="pill-value voices-count">{activeVoiceCount}</span>
        </div>

        <div className="status-pill">
          <span className="pill-label">SUSTAIN:</span>
          <button
            type="button"
            className={`sustain-toggle-btn ${isSustained ? 'active' : ''}`}
            onClick={onToggleSustain}
            aria-label="Toggle Sustain Pedal (Space)"
            aria-pressed={isSustained}
          >
            {isSustained ? 'HOLD (ON)' : 'OFF'}
          </button>
        </div>
      </div>

      <div className="status-help-hint">
        <span>Play with mouse, multi-touch, computer keys [Z-M, Q-P], or USB/Web MIDI</span>
      </div>
    </footer>
  );
};

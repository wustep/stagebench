import { useState } from 'react'
import type { PianoEngineStatusSnapshot } from '../audio/boundaries'
import type { MidiStatusSnapshot } from '../audio/midiController'
import type { NoteLifecycleSnapshot } from '../audio/noteLifecycle'

export interface StatusFooterProps {
  readonly audioStatus: PianoEngineStatusSnapshot
  readonly midiStatus: MidiStatusSnapshot
  readonly noteSnapshot: NoteLifecycleSnapshot
  readonly onToggleSustain: (active: boolean) => void
  readonly onAllNotesOff: () => void
}

export function StatusFooter({
  audioStatus,
  midiStatus,
  noteSnapshot,
  onToggleSustain,
  onAllNotesOff,
}: StatusFooterProps) {
  const [creditsOpen, setCreditsOpen] = useState(false)

  const audioBadgeClass =
    audioStatus.status === 'ready'
      ? 'is-ready'
      : audioStatus.status === 'fallback'
        ? 'is-fallback'
        : audioStatus.status === 'error'
          ? 'is-error'
          : 'is-loading'

  const midiBadgeClass =
    midiStatus.status === 'ready'
      ? 'is-ready'
      : midiStatus.status === 'denied' || midiStatus.status === 'error'
        ? 'is-error'
        : 'is-neutral'

  return (
    <footer className="ns4-status-bar" aria-label="Instrument status and sample attribution">
      <div className="ns4-status-row">
        <div className="ns4-status-pills">
          <span
            className={`ns4-status-pill ${audioBadgeClass}`}
            data-testid="audio-status"
            role="status"
          >
            <span className="ns4-status-dot" aria-hidden="true" />
            {audioStatus.message}
          </span>

          <span
            className={`ns4-status-pill ${midiBadgeClass}`}
            data-testid="midi-status"
          >
            <span className="ns4-status-dot" aria-hidden="true" />
            {midiStatus.message}
          </span>

          <span className="ns4-status-meta" data-testid="voice-count">
            Voices: {noteSnapshot.activeVoiceCount}/32
          </span>
        </div>

        <div className="ns4-status-actions">
          <button
            type="button"
            id="sustain-pedal-toggle"
            className={`ns4-utility-btn ${noteSnapshot.sustainActive ? 'is-engaged' : ''}`}
            aria-pressed={noteSnapshot.sustainActive}
            onClick={() => onToggleSustain(!noteSnapshot.sustainActive)}
          >
            Sustain (Space / CC64): {noteSnapshot.sustainActive ? 'ON' : 'OFF'}
          </button>

          <button
            type="button"
            id="all-notes-off-btn"
            className="ns4-utility-btn"
            onClick={onAllNotesOff}
          >
            All Notes Off
          </button>

          <button
            type="button"
            id="credits-toggle-btn"
            className="ns4-utility-btn"
            aria-expanded={creditsOpen}
            aria-controls="sample-credits-panel"
            onClick={() => setCreditsOpen((v) => !v)}
          >
            Credits &amp; Phase 1 Scope
          </button>
        </div>
      </div>

      {creditsOpen ? (
        <div id="sample-credits-panel" className="ns4-credits-panel">
          <p>
            <strong>Phase 1 Honesty Notice:</strong> The 73-key hammer-action keybed (E1–E7),
            computer keyboard (<code>A–&apos;</code> / <code>Z–M</code>, <code>Space</code> sustain),
            and Web MIDI input (notes + CC64 sustain) play one basic Grand Piano voice. All panel
            knobs, buttons, drawbars, faders, and wheels move accessibly as visual surface controls
            only and do not yet alter audio or system state.
          </p>
          <p>
            <strong>Recorded Sample Attribution (CC BY 3.0):</strong> Salamander Grand Piano V3 by
            Alexander Holm, licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/).
            Source: https://archive.org/details/SalamanderGrandPianoV3. Fallback voice (used only
            while samples load or if unavailable) is live Web Audio harmonic synthesis.
          </p>
        </div>
      ) : null}
    </footer>
  )
}

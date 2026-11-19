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
            Credits &amp; Scope
          </button>
        </div>
      </div>

      {creditsOpen ? (
        <div id="sample-credits-panel" className="ns4-credits-panel">
          <p>
            <strong>Phase 2 Scope Notice:</strong> The Piano section (Layers A/B, 6 types, models,
            KB Touch, Dyn Comp, Timbre, Unison, Soft Release, String Res, SUSTPED/PSTICK), Layer
            Effects section (Mod 1, Mod 2, Delay, Amp Sim/EQ, Compressor, Reverb, Rotary via To
            Rotary, Focus/Group/Global/Bypass), Master Level, and Pitch Stick are live on one shared
            Web Audio context. Organ, Synth, and Program controls remain decorative presentation
            controls.
          </p>
          <p>
            <strong>Recorded Sample Attributions:</strong> Salamander Grand Piano V3 by Alexander
            Holm, licensed under CC BY 3.0 (https://creativecommons.org/licenses/by/3.0/). Source:
            https://archive.org/details/SalamanderGrandPianoV3. · Wurlitzer EP200 samples by Greg
            Sullivan (http://www.sullivang.net/), licensed under CC BY 3.0
            (https://creativecommons.org/licenses/by/3.0/). Source:
            https://github.com/sfzinstruments/GregSullivan.E-Pianos. · Upright Piano KW by Gonzalo
            and Roberto, FreePats project, CC0 1.0. · Rhodes Mark I samples (jRhodes GM version) by
            Jeff Learman, CC0 1.0.
          </p>
          <p>
            <strong>Live Synthesis &amp; Generated DSP:</strong> Clav, Digital, Misc piano models,
            reverb impulse responses, sympathetic string resonance, and the labeled sample-failure
            fallback are generated in Web Audio and are not audio recordings.
          </p>
        </div>
      ) : null}
    </footer>
  )
}

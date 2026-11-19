import { useState } from 'react'
import type { PianoEngineStatusSnapshot } from '../audio/boundaries'
import type { MidiStatusSnapshot } from '../audio/midiController'
import type { NoteLifecycleSnapshot } from '../audio/noteLifecycle'
import { UNSUPPORTED_CONTROLS_AUDIT } from '../model/programBank'

export interface StatusFooterProps {
  readonly audioStatus: PianoEngineStatusSnapshot
  readonly midiStatus: MidiStatusSnapshot
  readonly noteSnapshot: NoteLifecycleSnapshot
  readonly controlPedal: number
  readonly onChangeControlPedal: (value: number) => void
  readonly onToggleSustain: (active: boolean) => void
  readonly onAllNotesOff: () => void
  readonly onPanic?: () => void
}

export function StatusFooter({
  audioStatus,
  midiStatus,
  noteSnapshot,
  controlPedal,
  onChangeControlPedal,
  onToggleSustain,
  onAllNotesOff,
  onPanic,
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
          <label className="ns4-pedal-control" htmlFor="control-pedal-slider">
            <span>Ctrl Pedal (CC11): {controlPedal}%</span>
            <input
              id="control-pedal-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={controlPedal}
              aria-label="Control Pedal (CC11)"
              onChange={(e) => onChangeControlPedal(Number(e.target.value))}
            />
          </label>

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
            onClick={onPanic ?? onAllNotesOff}
          >
            All Notes Off / Panic
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
            <strong>Phase 3 Complete System Scope:</strong> Organ (Layers A/B, B3/B3 Bass/Vox/Farf/Pipe
            1/Pipe 2, 9 drawbars, percussion, key click, V/C, shared FX chain &amp; Rotary), Piano
            (Layers A/B, 6 types, recorded Grand/Upright/Rhodes/Wurli + Clav/Digital/Misc), Synth
            (Layers A/B/C, Pure/Sync/Multi/Super/FM-H, Osc Ctrl, LP12/LP24/LPM/HP/BP/LP+HP filters,
            3 envelopes, 5-wave LFO, Poly/Mono/Legato/Glide/Unison/Vibrato, deterministic Arp/Gate),
            Layer Effects (6 chains + Rotary + Group/Global/Bypass), and Programs (32 slots, 8
            auto-storing Live slots, Store/Store As, List View, Splits/Zones/Crossfades, Scenes I/II,
            Wheel &amp; Control Pedal morphs, Master Clock, Transpose ±6, Panic) all run on one shared
            Web Audio context.
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
            <strong>Live Synthesis &amp; Generated DSP:</strong> Organ engines (B3/B3 Bass, Vox, Farf,
            Pipe 1, Pipe 2), Synth engine (Analog + FM-H), Piano Clav/Digital/Misc models, reverb
            impulse responses, sympathetic string resonance, and the labeled sample-failure fallback
            are generated in Web Audio and are not audio recordings.
          </p>
          <p>
            <strong>Unsupported (Spec-Excluded) Controls:</strong>{' '}
            {UNSUPPORTED_CONTROLS_AUDIT.map((entry) => `${entry.label} (${entry.id})`).join(' · ')}
          </p>
        </div>
      ) : null}
    </footer>
  )
}

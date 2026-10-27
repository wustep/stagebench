import { VARIANT } from '../hardware/variant'
import { keybedRangeLabel } from '../hardware/keybed'
import type { MidiStatusReport } from '../input/midi'
import type { PianoSnapshot } from '../audio/noteSession'

/**
 * The two OLEDs.
 *
 * They are the only displays on the instrument (visual spec: Program and Synth are the
 * only primary OLED locations; the performance band and the effects band carry none).
 *
 * Both are truthful by construction: they render live engine/MIDI/voice state and never
 * print a feature, program or effect that Phase 1 has not implemented. The Synth display
 * says so in as many words rather than showing a fake waveform.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function noteLabel(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

function audioLine(snapshot: PianoSnapshot): { label: string; tone: string } {
  const { status } = snapshot.audio
  switch (status) {
    case 'ready':
      return { label: 'AUDIO READY', tone: 'ok' }
    case 'loading':
      return { label: 'AUDIO LOADING', tone: 'warn' }
    case 'suspended':
      return { label: 'AUDIO SUSPENDED', tone: 'warn' }
    case 'fallback':
      return { label: 'NO AUDIO OUTPUT', tone: 'warn' }
    case 'error':
      return { label: 'AUDIO ERROR', tone: 'bad' }
    default:
      return { label: 'AUDIO IDLE', tone: 'warn' }
  }
}

function midiLine(midi: MidiStatusReport): { label: string; tone: string } {
  switch (midi.state) {
    case 'ready':
      return { label: `MIDI ${midi.inputCount} IN`, tone: 'ok' }
    case 'denied':
      return { label: 'MIDI DENIED', tone: 'warn' }
    case 'disconnected':
      return { label: 'MIDI LOST', tone: 'warn' }
    case 'unsupported':
      return { label: 'NO WEB MIDI', tone: 'warn' }
    case 'error':
      return { label: 'MIDI ERROR', tone: 'bad' }
    case 'requesting':
      return { label: 'MIDI…', tone: 'warn' }
    default:
      return { label: 'MIDI IDLE', tone: 'warn' }
  }
}

export interface ProgramDisplayProps {
  snapshot: PianoSnapshot
  midi: MidiStatusReport
  /** Number of physical keys currently under a pointer or key. */
  heldCount: number
}

/**
 * Primary program OLED. Reads the real engine, MIDI and voice state; reports no program
 * library, split, scene or morph, because Phase 1 implements none of them.
 */
export function ProgramDisplay({ snapshot, midi, heldCount }: ProgramDisplayProps) {
  const audio = audioLine(snapshot)
  const midiStatus = midiLine(midi)
  const sounding = snapshot.sounding
  const voiceLine =
    sounding.length === 0
      ? 'Modelled piano · idle'
      : `Modelled piano · ${sounding.length} voice${sounding.length === 1 ? '' : 's'}`

  return (
    <div
      className="oled glass-program"
      data-testid="program-display"
      data-display-id="program.display"
      data-display-root="true"
      role="status"
      // Only state transitions are announced. A live region that re-announced on every
      // key press would read a wall of text at a player, so the region is polite and
      // carries the stable status line rather than the per-note readout.
      aria-live="polite"
      aria-atomic="false"
      aria-label={`Program display: ${audio.label}. ${midiStatus.label}. ${snapshot.audio.detail}`}
    >
      <div className="glass-row glass-head">
        {/* No program library exists in this phase, so the slot area says so rather than
            printing a bank and number that would imply a loaded program. */}
        <span className="glass-bank">PHASE 1</span>
        <span className={`glass-status tone-${audio.tone}`}>{audio.label}</span>
      </div>
      <div className="glass-title">
        <span>{VARIANT.fullName}</span>
      </div>
      <div className="glass-row glass-voice">
        <span className="glass-icon" aria-hidden="true">
          PIANO
        </span>
        <span className="glass-value">{voiceLine}</span>
      </div>
      <div className="glass-row glass-meta">
        <span className={`glass-chip tone-${midiStatus.tone}`}>{midiStatus.label}</span>
        <span className="glass-chip">SUSTAIN {snapshot.sustainPedal ? 'DOWN' : 'UP'}</span>
        <span className="glass-chip">
          {heldCount}/{VARIANT.totalKeys} KEYS
        </span>
      </div>
      <div className="glass-foot">
        <span>{snapshot.audio.detail}</span>
      </div>
      <div className="glass-foot glass-note">
        <span>
          {keybedRangeLabel()} · {VARIANT.totalKeys} keys · {VARIANT.keyAction}
        </span>
        <span>
          {sounding.length > 0 ? sounding.slice(0, 6).map(noteLabel).join(' ') : '—'}
          {snapshot.stolen > 0 ? ` · ${snapshot.stolen} stolen` : ''}
        </span>
      </div>
    </div>
  )
}

/**
 * Synth OLED. The Synth engine is out of Phase 1 scope, so the display says exactly
 * that instead of showing a waveform it cannot produce.
 */
export function SynthDisplay({ midi }: { midi: MidiStatusReport }) {
  void midi
  return (
    <div
      className="oled glass-synth"
      data-testid="synth-display"
      data-display-id="synth.display"
      data-display-root="true"
      aria-label="Synth display: synth engine not available in this phase"
    >
      <div className="glass-row glass-head">
        <span className="glass-bank">OSC WAVEFORM</span>
        <span className="glass-status tone-warn">OFFLINE</span>
      </div>
      <div className="glass-title glass-title-sm">
        <span>Synth engine</span>
      </div>
      <div className="glass-row glass-voice">
        <span className="glass-icon" aria-hidden="true">
          SYNTH
        </span>
        <span className="glass-value">Not available in this phase</span>
      </div>
      <div className="glass-foot">
        <span>Controls are present and move, but produce no sound here.</span>
      </div>
    </div>
  )
}

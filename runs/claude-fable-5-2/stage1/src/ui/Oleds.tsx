import { useSyncExternalStore, type CSSProperties } from 'react'
import type { Session } from '../app/session'
import type { AudioStatus } from '../audio/engine'
import { VARIANT } from '../hardware/geometry'
import type { OledDef } from '../hardware/types'
import type { MidiStatus } from '../input/midi'

function box(def: OledDef): CSSProperties {
  return { left: def.x - def.w / 2, top: def.y - def.h / 2, width: def.w, height: def.h }
}

export const AUDIO_WORDS: Record<AudioStatus, string> = {
  idle: 'PRESS A KEY',
  loading: 'LOADING',
  ready: 'READY',
  fallback: 'FALLBACK',
  error: 'NO AUDIO',
}

export const MIDI_WORDS: Record<MidiStatus, string> = {
  unsupported: 'UNSUPPORTED',
  idle: 'OFF',
  requesting: 'ASKING',
  connected: 'CONNECTED',
  'no-inputs': 'NO INPUT',
  denied: 'DENIED',
  error: 'ERROR',
}

/**
 * The Program OLED. In Phase 1 there are no programs, so it does not show one: it shows what
 * is actually true right now — which voice the keybed plays and the live audio/MIDI/pedal state.
 */
export function ProgramOled({ def, session }: { def: OledDef; session: Session }) {
  const audio = useSyncExternalStore(session.engine.subscribe, session.engine.getSnapshot, session.engine.getSnapshot)
  const midi = useSyncExternalStore(session.midi.subscribe, session.midi.getSnapshot, session.midi.getSnapshot)
  const notes = useSyncExternalStore(
    session.lifecycle.subscribe,
    session.lifecycle.getSnapshot,
    session.lifecycle.getSnapshot,
  )
  const rows = [
    `AUDIO ${AUDIO_WORDS[audio.status]}`,
    `MIDI ${MIDI_WORDS[midi.status]}`,
    `SUSTAIN ${notes.sustain ? 'DOWN' : 'UP'}  VOICES ${audio.voices}`,
  ]
  return (
    <div
      id={def.id}
      className="oled"
      role="img"
      aria-label={`${def.name}. ${VARIANT.label}, Phase 1. Basic Piano, synthesized. ${rows.join('. ')}.`}
      data-oled="program"
      style={box(def)}
    >
      <span className="px-small">{VARIANT.label.toUpperCase()} · PHASE 1</span>
      <span className="px-big">Basic Piano</span>
      <span className="px-rule" />
      {rows.map((row) => (
        <span key={row.slice(0, 5)} className="px-row">
          {row}
        </span>
      ))}
    </div>
  )
}

/** The Synth OLED. The Synth engine is not part of Phase 1, and the glass says so. */
export function SynthOled({ def }: { def: OledDef }) {
  return (
    <div
      id={def.id}
      className="oled"
      role="img"
      aria-label={`${def.name}. Synth is not active in Phase 1. Panel controls are decorative.`}
      data-oled="synth"
      style={box(def)}
    >
      <span className="px-bar">SYNTH</span>
      <span className="px-big">Not active</span>
      <span className="px-row">PHASE 1 · NO SYNTH ENGINE</span>
      <span className="px-row">PANEL IS DECORATIVE</span>
    </div>
  )
}

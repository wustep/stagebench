import { useSyncExternalStore } from 'react'
import { midiToName } from '../hardware/keybed'
import { useServices } from './context'

/** The Program OLED: the only primary display of the program section. Shows truthful Phase 1 state. */
export function ProgramOled() {
  const { engine, midi, bus } = useServices()
  const status = useSyncExternalStore(engine.subscribe, engine.getStatus, engine.getStatus)
  const midiStatus = useSyncExternalStore(midi.subscribe, midi.getStatus, midi.getStatus)
  const notes = useSyncExternalStore(bus.subscribe, bus.getState, bus.getState)
  const held = [...notes.held.keys()].sort((a, b) => a - b).map(midiToName)
  return (
    <div id="program.oled" className="oled oled-program" role="group" aria-label="Program display" data-display="primary">
      <div className="oled-row oled-head">
        <span>STAGEBENCH</span>
        <span>PHASE 1</span>
      </div>
      <div className="oled-row oled-big">Basic piano</div>
      <div className="oled-rule" />
      <div className="oled-row">Voice: {status.voiceSource === 'fallback-oscillator' ? 'fallback tone' : 'generated tone'}</div>
      <div className="oled-row">
        Audio {status.state} · MIDI {midiStatus.state}
      </div>
      <div className="oled-row">
        Keys {held.length ? held.join(' ') : '—'} · Sus {notes.sustain ? 'on' : 'off'}
      </div>
    </div>
  )
}

/** The Synth OLED: the section's single narrow display. Honest about being decorative in Phase 1. */
export function SynthOled() {
  return (
    <div id="synth.oled" className="oled oled-synth" role="group" aria-label="Synth display" data-display="primary">
      <div className="oled-row oled-head oled-center">SYNTH · PHASE 1</div>
      <div className="oled-row oled-big">Decorative</div>
      <div className="oled-row">No synth engine runs yet</div>
      <div className="oled-row oled-dials">
        <span>TYPE</span>
        <span>CAT</span>
        <span>WAVE</span>
      </div>
    </div>
  )
}

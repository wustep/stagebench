import { useMemo, useReducer, type KeyboardEvent, type PointerEvent } from 'react'
import { Deck } from './components/Surface'
import { Keybed } from './components/Keybed'
import { deriveAudioSettings } from './model/audioSettings'
import { initialPresentation, presentationReducer } from './model/hardware'
import { MIDI_STATUS_MESSAGES } from './input/midi'
import { KEYBED } from './model/keybed'
import { usePianoInstrument } from './instrument/usePianoInstrument'

export default function App() {
  const [values, dispatch] = useReducer(presentationReducer, undefined, () => initialPresentation())
  const audio = useMemo(() => deriveAudioSettings(values), [values])
  const piano = usePianoInstrument(audio)

  const pedalKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (!event.repeat) piano.setPedal(true)
    }
  }
  const pedalKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      piano.setPedal(false)
    }
  }
  const pedalPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    piano.setPedal(true)
  }
  const pedalPointerUp = () => piano.setPedal(false)

  return (
    <main className="app">
      <h1 className="sr-only">Nord Stage 4 {KEYBED.totalKeys} — Phase 2</h1>
      <div className="stage">
        <div className="instrument">
          <div className="chassis">
            <Deck values={values} dispatch={dispatch} />
            <Keybed heldNotes={piano.heldNotes} onNoteOn={piano.noteOn} onNoteOff={piano.noteOff} />
          </div>
        </div>
      </div>

      <div className="below">
        <button
          type="button"
          id="sustain-pedal"
          className={`pedal ${piano.sustainActive ? 'lit' : ''}`}
          aria-pressed={piano.sustainActive}
          aria-label="Sustain pedal (virtual)"
          onPointerDown={pedalPointerDown}
          onPointerUp={pedalPointerUp}
          onPointerCancel={pedalPointerUp}
          onLostPointerCapture={pedalPointerUp}
          onKeyDown={pedalKeyDown}
          onKeyUp={pedalKeyUp}
        >
          Sustain pedal (virtual) — hold, or Shift / MIDI CC64
        </button>
        <p className="status" role="status" data-engine-state={piano.engineStatus.state} id="engine-status">
          {piano.engineStatus.message}
        </p>
        <p className="status" role="status" data-piano-state={piano.pianoStatus.state} id="piano-status">
          {piano.pianoStatus.message}
        </p>
        <p className="status" role="status" data-midi-state={piano.midiStatus} id="midi-status">
          {MIDI_STATUS_MESSAGES[piano.midiStatus]}
        </p>
        <p className="note">
          Phase 2: the Piano and Layer Effects sections, and Master Level, are live. Organ, Synth, and Program controls move or press but change nothing else.
        </p>
      </div>
    </main>
  )
}

import { useEffect, useMemo, useReducer, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Deck } from './components/Surface'
import { Keybed } from './components/Keybed'
import { ProgramDialogs } from './components/ProgramDialogs'
import { deriveAudioSettings } from './model/audioSettings'
import { createInstrumentState, instrumentReducer, type InstrumentAction } from './model/instrument'
import { applyMorphs, MORPH_SOURCES } from './model/morph'
import { derivedLeds, programDisplayLines, synthDisplayLines } from './model/displays'
import { browserProgramStorage, loadStoredSlots, saveSlots } from './model/program'
import { MIDI_STATUS_MESSAGES } from './input/midi'
import { KEYBED } from './model/keybed'
import { usePianoInstrument } from './instrument/usePianoInstrument'

export default function App() {
  const storage = useMemo(() => browserProgramStorage(), [])
  const [state, dispatch] = useReducer(instrumentReducer, undefined, () => createInstrumentState(loadStoredSlots(storage) ?? undefined))
  const [listOpen, setListOpen] = useState(false)

  // Morphs move the destinations before the audio is derived, so the sound follows the morph and the panel keeps the player's values.
  const audio = useMemo(() => deriveAudioSettings(applyMorphs(state.values, state.morphs)), [state.values, state.morphs])
  const piano = usePianoInstrument(audio, (value) => dispatch({ type: 'set', id: 'performance.control-pedal', value }))

  useEffect(() => {
    saveSlots(storage, state.bank)
  }, [storage, state.bank])

  useEffect(() => {
    if (state.panics > 0) piano.panic()
  }, [state.panics, piano])

  // Panel values for the lit LEDs and dial position, plus the morph destinations that show their green LED.
  const shownValues = useMemo(() => ({ ...state.values, ...derivedLeds(state) }), [state])
  const morphed = useMemo(() => {
    const keys = new Set<string>()
    for (const source of MORPH_SOURCES) for (const assignment of state.morphs[source]) keys.add(assignment.key)
    return keys
  }, [state.morphs])
  const displays = useMemo(() => ({ 'program.oled': programDisplayLines(state), 'synth.oled': synthDisplayLines(state) }), [state])

  // Tap tempo needs the press time, and the panel itself does not know the clock.
  const dispatchPanel = (action: InstrumentAction) => {
    if (action.type === 'toggle' && action.id === 'program.tap') {
      dispatch({ type: 'tap-tempo', time: performance.now() })
      return
    }
    dispatch(action)
  }

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
      <h1 className="sr-only">Nord Stage 4 {KEYBED.totalKeys} — Phase 3</h1>
      <div className="stage">
        <div className="instrument">
          <div className="chassis">
            <Deck
              values={shownValues}
              dispatch={dispatchPanel}
              displays={displays}
              morphed={morphed}
              onShiftDial={() => setListOpen(true)}
            />
            <Keybed heldNotes={piano.heldNotes} onNoteOn={piano.noteOn} onNoteOff={piano.noteOff} />
          </div>
        </div>
      </div>

      <ProgramDialogs
        state={state}
        dispatch={dispatch}
        listOpen={listOpen}
        onCloseList={() => setListOpen(false)}
      />

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
          Phase 3: the piano, organ, synth, layer effects, programs (32 stored, 8 Live), splits, scenes, morphs, master clock, transpose, and Panic are live. Spec-excluded controls are listed as unsupported in the audit.
        </p>
      </div>
    </main>
  )
}

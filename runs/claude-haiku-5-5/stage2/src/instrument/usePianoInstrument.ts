import { useEffect, useState } from 'react'
import type { EngineStatus } from '../engine/pianoEngine'
import type { MidiStatus } from '../input/midi'
import { translateKeyDown, translateKeyUp } from '../input/computerKeys'
import type { AudioSettings } from '../model/audioSettings'
import { createPianoInstrument, KEYBOARD_SUSTAIN_SOURCE, PEDAL_SOURCE, type PianoInstrument, type PianoStatus } from './pianoInstrument'

const IDLE_ENGINE_STATUS: EngineStatus = { state: 'idle', message: 'Audio idle. Press a key to start the piano.' }
const IDLE_PIANO_STATUS: PianoStatus = { state: 'idle', message: 'Piano idle.' }

export interface PianoInstrumentState {
  heldNotes: ReadonlySet<number>
  sustainActive: boolean
  engineStatus: EngineStatus
  pianoStatus: PianoStatus
  midiStatus: MidiStatus
  noteOn: PianoInstrument['noteOn']
  noteOff: PianoInstrument['noteOff']
  setPedal: (on: boolean) => void
}

/**
 * React bridge for the playable piano. It owns one instrument for the component's lifetime,
 * applies the panel-derived settings whenever they change, wires computer-keyboard, Shift sustain,
 * and window-blur cleanup, and exposes truthful status.
 */
export function usePianoInstrument(settings: AudioSettings): PianoInstrumentState {
  const [heldNotes, setHeldNotes] = useState<ReadonlySet<number>>(() => new Set())
  const [sustainActive, setSustainActive] = useState(false)
  const [engineStatus, setEngineStatus] = useState<EngineStatus>(IDLE_ENGINE_STATUS)
  const [pianoStatus, setPianoStatus] = useState<PianoStatus>(IDLE_PIANO_STATUS)
  const [midiStatus, setMidiStatus] = useState<MidiStatus>('idle')
  const [instrument] = useState(() =>
    createPianoInstrument({
      onHeldNotes: setHeldNotes,
      onSustain: setSustainActive,
      onEngineStatus: setEngineStatus,
      onPianoStatus: setPianoStatus,
      onMidiStatus: setMidiStatus,
    }),
  )

  useEffect(() => {
    instrument.configure(settings)
  }, [instrument, settings])

  useEffect(() => {
    instrument.connectMidi()

    const onKeyDown = (event: KeyboardEvent) => {
      const intent = translateKeyDown(event)
      switch (intent.type) {
        case 'note-on':
          event.preventDefault()
          instrument.noteOn(intent.source, intent.note, intent.velocity)
          break
        case 'sustain':
          event.preventDefault()
          instrument.setSustain(KEYBOARD_SUSTAIN_SOURCE, intent.on)
          break
        default:
          break
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      const intent = translateKeyUp(event)
      if (intent.type === 'note-off') {
        instrument.noteOff(intent.source, intent.note)
      } else if (intent.type === 'sustain') {
        instrument.setSustain(KEYBOARD_SUSTAIN_SOURCE, intent.on)
      }
    }

    const releaseAll = () => instrument.releaseEverything()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') releaseAll()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', onVisibility)
      instrument.teardown()
    }
  }, [instrument])

  return {
    heldNotes,
    sustainActive,
    engineStatus,
    pianoStatus,
    midiStatus,
    noteOn: (source, note, velocity) => instrument.noteOn(source, note, velocity),
    noteOff: (source, note) => instrument.noteOff(source, note),
    setPedal: (on) => instrument.setSustain(PEDAL_SOURCE, on),
  }
}

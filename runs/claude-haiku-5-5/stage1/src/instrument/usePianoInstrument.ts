import { useEffect, useState } from 'react'
import type { EngineStatus } from '../engine/pianoEngine'
import type { MidiStatus } from '../input/midi'
import { translateKeyDown, translateKeyUp } from '../input/computerKeys'
import { createPianoInstrument, KEYBOARD_SUSTAIN_SOURCE, PEDAL_SOURCE, type PianoInstrument } from './pianoInstrument'

const IDLE_ENGINE_STATUS: EngineStatus = { state: 'idle', message: 'Audio idle. Press a key to start the piano voice.' }

export interface PianoInstrumentState {
  heldNotes: ReadonlySet<number>
  sustainActive: boolean
  engineStatus: EngineStatus
  midiStatus: MidiStatus
  noteOn: PianoInstrument['noteOn']
  noteOff: PianoInstrument['noteOff']
  setPedal: (on: boolean) => void
}

/**
 * React bridge for the playable piano. It owns one instrument for the component's lifetime,
 * wires computer-keyboard, Shift sustain, and window-blur cleanup, and exposes truthful status.
 */
export function usePianoInstrument(): PianoInstrumentState {
  const [heldNotes, setHeldNotes] = useState<ReadonlySet<number>>(() => new Set())
  const [sustainActive, setSustainActive] = useState(false)
  const [engineStatus, setEngineStatus] = useState<EngineStatus>(IDLE_ENGINE_STATUS)
  const [midiStatus, setMidiStatus] = useState<MidiStatus>('idle')
  const [instrument] = useState(() =>
    createPianoInstrument({
      onHeldNotes: setHeldNotes,
      onSustain: setSustainActive,
      onEngineStatus: setEngineStatus,
      onMidiStatus: setMidiStatus,
    }),
  )

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
    midiStatus,
    noteOn: (source, note, velocity) => instrument.noteOn(source, note, velocity),
    noteOff: (source, note) => instrument.noteOff(source, note),
    setPedal: (on) => instrument.setSustain(PEDAL_SOURCE, on),
  }
}

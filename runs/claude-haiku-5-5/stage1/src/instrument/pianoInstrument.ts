// Non-React composition of the playable piano: audio engine, note lifecycle, MIDI adapter.
// Everything external is injected, so the whole instrument runs under test with fakes.

import { createBrowserAudioContext, type AudioContextFactory } from '../audio/audioBoundary'
import { NoteController } from '../engine/noteController'
import { PianoEngine, type EngineStatus } from '../engine/pianoEngine'
import { browserMidiAccess, createMidiController, MIDI_SOURCE, type MidiAccessRequest, type MidiController, type MidiStatus } from '../input/midi'
import { isKeyboardNote } from '../model/keybed'

export const PEDAL_SOURCE = 'pedal:ui'
export const KEYBOARD_SUSTAIN_SOURCE = 'key:sustain'

export interface PianoInstrumentOptions {
  audioFactory?: AudioContextFactory
  midiRequest?: MidiAccessRequest
  onHeldNotes?: (heldNotes: ReadonlySet<number>) => void
  onSustain?: (active: boolean) => void
  onEngineStatus?: (status: EngineStatus) => void
  onMidiStatus?: (status: MidiStatus) => void
}

export interface PianoInstrument {
  readonly engine: PianoEngine
  readonly controller: NoteController
  readonly midi: MidiController
  noteOn(source: string, note: number, velocity: number): boolean
  noteOff(source: string, note: number): boolean
  setSustain(source: string, on: boolean): void
  /** Releases every note from every source and clears every sustain source. Used on blur. */
  releaseEverything(): void
  connectMidi(): void
  /** Stops every owned voice, disconnects MIDI, and returns audio to idle. Used on unmount. */
  teardown(): void
}

export function createPianoInstrument(options: PianoInstrumentOptions = {}): PianoInstrument {
  const engine = new PianoEngine(options.audioFactory ?? createBrowserAudioContext, options.onEngineStatus)

  const controller = new NoteController(engine, {
    onHeldNotesChange: options.onHeldNotes,
    onSustainChange: options.onSustain,
  })

  const midi = createMidiController(options.midiRequest ?? browserMidiAccess(), {
    noteOn: (note, velocity) => {
      if (!isKeyboardNote(note)) return
      engine.ensureStarted()
      controller.noteOn(MIDI_SOURCE, note, velocity)
    },
    noteOff: (note) => {
      controller.noteOff(MIDI_SOURCE, note)
    },
    sustain: (on) => {
      controller.setSustain(MIDI_SOURCE, on)
    },
    allNotesOff: () => {
      controller.releaseSource(MIDI_SOURCE)
    },
    onStatus: options.onMidiStatus ?? (() => {}),
  })

  return {
    engine,
    controller,
    midi,
    noteOn(source, note, velocity) {
      engine.ensureStarted()
      return controller.noteOn(source, note, velocity)
    },
    noteOff(source, note) {
      return controller.noteOff(source, note)
    },
    setSustain(source, on) {
      if (on) engine.ensureStarted()
      controller.setSustain(source, on)
    },
    releaseEverything() {
      controller.allNotesOff()
      for (const source of [PEDAL_SOURCE, KEYBOARD_SUSTAIN_SOURCE, MIDI_SOURCE]) {
        controller.setSustain(source, false)
      }
    },
    connectMidi() {
      midi.connect()
    },
    teardown() {
      controller.stopAll()
      midi.disconnect()
      engine.dispose()
    },
  }
}

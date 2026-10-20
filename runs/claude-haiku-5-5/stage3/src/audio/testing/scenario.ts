// Plays the real piano from panel state on an OfflineAudioContext and returns what it rendered.
// The panel state goes through the same reducer and derivation the browser uses, so a test that
// presses a control here hears exactly what a user would hear.

import { createPianoInstrument, type PianoInstrument } from '../../instrument/pianoInstrument'
import { deriveAudioSettings } from '../../model/audioSettings'
import { initialPresentation, presentationReducer, type ControlAction, type PresentationState } from '../../model/hardware'
import { asBoundary, diskSampleLoader, offlineContext, renderWithEvents, type Rendered } from './offline'

export interface NoteEvent {
  source?: string
  note: number
  velocity?: number
  /** Seconds into the render. Zero means at the start. */
  on?: number
  /** Seconds into the render when the key is released. Omit to hold to the end. */
  off?: number
}

export interface Scenario {
  seconds: number
  notes: NoteEvent[]
  /** Panel actions applied before the render starts. */
  actions?: ControlAction[]
  /** Pedal changes, in seconds. `source` defaults to the UI pedal. */
  pedal?: { time: number; on: boolean; source?: string }[]
  /** Overrides applied to the instrument after configuration, for example a loader that fails. */
  loader?: ReturnType<typeof diskSampleLoader>
}

export interface Played {
  rendered: Rendered
  instrument: PianoInstrument
  state: PresentationState
  contexts: number
}

export function withActions(state: PresentationState, actions: readonly ControlAction[] = []): PresentationState {
  return actions.reduce((current, action) => presentationReducer(current, action), state)
}

export async function play(scenario: Scenario, base: PresentationState = initialPresentation()): Promise<Played> {
  const state = withActions(base, scenario.actions)
  const context = offlineContext(scenario.seconds)
  let contexts = 0
  const instrument = createPianoInstrument({
    audioFactory: () => {
      contexts += 1
      return asBoundary(context)
    },
    sampleLoader: scenario.loader ?? diskSampleLoader(),
    midiRequest: undefined,
  })
  instrument.configure(deriveAudioSettings(state))
  await instrument.ready()

  const events: { time: number; run: () => void }[] = []
  for (const [index, event] of scenario.notes.entries()) {
    const source = event.source ?? `pointer:${index}`
    const velocity = event.velocity ?? 100
    events.push({ time: event.on ?? 0, run: () => instrument.noteOn(source, event.note, velocity) })
    if (event.off !== undefined) {
      events.push({ time: event.off, run: () => instrument.noteOff(source, event.note) })
    }
  }
  for (const pedal of scenario.pedal ?? []) {
    events.push({ time: pedal.time, run: () => instrument.setSustain(pedal.source ?? 'pedal:ui', pedal.on) })
  }

  const rendered = await renderWithEvents(context, events)
  return { rendered, instrument, state, contexts }
}

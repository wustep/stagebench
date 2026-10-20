// Plays the whole instrument (piano, organ, synth, effects, zones, and the arpeggiator) on an
// OfflineAudioContext and returns what it rendered. Piano samples are not loaded here: the piano's
// labelled fallback is silenced by switching Layer A off, so the rendered sound is the engine under test.

import { createStage4Instrument, type Stage4Instrument } from '../../instrument/stage4Instrument'
import { deriveAudioSettings } from '../../model/audioSettings'
import { initialPresentation, presentationReducer, type ControlAction, type PresentationState } from '../../model/hardware'
import { applyMorphs, EMPTY_MORPHS, type MorphMap } from '../../model/morph'
import type { SampleLoader } from '../sampleLibrary'
import { asBoundary, mono, offlineContext, renderWithEvents, type Rendered } from './offline'

/** Turns the piano's Layer A off, so only the engines under test make sound. */
export const PIANO_SILENT: ControlAction[] = [{ type: 'toggle', id: 'piano.layer-a-on' }]

/** The engine tests load no piano samples; a failed load is the labelled fallback, which is also silenced. */
export const NO_SAMPLES: SampleLoader = {
  fetchBytes: () => Promise.reject(new Error('engine tests load no piano samples')),
}

export interface EngineNote {
  source?: string
  note: number
  velocity?: number
  /** Seconds into the render when the key goes down. */
  on: number
  /** Seconds into the render when the key lifts. Omit to hold to the end. */
  off?: number
}

export interface EngineScenario {
  seconds: number
  notes?: EngineNote[]
  /** Panel actions applied before the render. */
  actions?: ControlAction[]
  morphs?: MorphMap
  /** Times at which the arpeggiator is advanced to that time, as the browser clock would. */
  ticks?: number[]
  /** Other events at a time, for pedal, panel changes during the render, and so on. */
  events?: { time: number; run: (instrument: Stage4Instrument) => void }[]
  /** Panel state to start from, instead of the initial panel. */
  base?: PresentationState
}

export interface EnginePlayed {
  rendered: Rendered
  mono: Float32Array
  instrument: Stage4Instrument
  state: PresentationState
  /** How many audio contexts the instrument created during the render. Must be one. */
  contexts: number
  context: ReturnType<typeof offlineContext>
}

export function withPanelActions(state: PresentationState, actions: readonly ControlAction[]): PresentationState {
  return actions.reduce((current, action) => presentationReducer(current, action), state)
}

export async function renderEngines(scenario: EngineScenario): Promise<EnginePlayed> {
  const state = withPanelActions(scenario.base ?? initialPresentation(), [...PIANO_SILENT, ...(scenario.actions ?? [])])
  const morphs = scenario.morphs ?? EMPTY_MORPHS
  const context = offlineContext(scenario.seconds)
  let contexts = 0
  const instrument = createStage4Instrument({
    audioFactory: () => {
      contexts += 1
      return asBoundary(context)
    },
    sampleLoader: NO_SAMPLES,
  })
  instrument.configure(deriveAudioSettings(applyMorphs(state, morphs)))

  const events: { time: number; run: () => void }[] = []
  for (const [index, note] of (scenario.notes ?? []).entries()) {
    const source = note.source ?? `pointer:${index}`
    events.push({ time: note.on, run: () => instrument.noteOn(source, note.note, note.velocity ?? 100) })
    if (note.off !== undefined) events.push({ time: note.off, run: () => instrument.noteOff(source, note.note) })
  }
  for (const time of scenario.ticks ?? []) {
    events.push({ time, run: () => instrument.advanceTo(time) })
  }
  for (const event of scenario.events ?? []) {
    events.push({ time: event.time, run: () => event.run(instrument) })
  }

  // Events at or after the end of the render never happen, so they are dropped rather than scheduled past the end.
  const inRange = events.filter((event) => event.time < scenario.seconds)
  const rendered = await renderWithEvents(context, inRange)
  return { rendered, mono: mono(rendered), instrument, state, contexts, context }
}

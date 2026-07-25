import { ManualScheduler } from '../audio/graph'
import { OfflineAudioGraph } from '../audio/offline'
import type { MidiAccessLike, MidiConnectionEvent, MidiInputLike, RequestMidiAccess } from '../input/midi'
import type { SampleFetcher } from '../audio/sampleLibrary'
import type { InstrumentOptions } from '../state/useInstrument'

/**
 * Deterministic boundaries for component tests: the offline audio renderer, a manual timer, and
 * a fake Web MIDI implementation. No device, no network, no audio output.
 */

export class FakeMidiInput implements MidiInputLike {
  onmidimessage: ((event: { data: Uint8Array | null }) => void) | null = null

  constructor(
    readonly id: string,
    readonly name: string,
  ) {}

  send(bytes: readonly number[]): void {
    this.onmidimessage?.({ data: new Uint8Array(bytes) })
  }
}

export class FakeMidiAccess implements MidiAccessLike {
  onstatechange: ((event: MidiConnectionEvent) => void) | null = null

  constructor(private readonly ports: FakeMidiInput[]) {}

  readonly inputs = {
    values: (): IterableIterator<MidiInputLike> => this.ports.values(),
  }

  disconnect(): void {
    this.onstatechange?.({ port: { id: this.ports[0]?.id, state: 'disconnected', type: 'input' } })
  }
}

export interface Rig {
  readonly boundaries: InstrumentOptions
  readonly graph: OfflineAudioGraph
  readonly scheduler: ManualScheduler
  readonly midiInput: FakeMidiInput
  readonly midiAccess: FakeMidiAccess
}

export function createRig(
  options: {
    midi?: 'granted' | 'denied' | 'unsupported'
    maxVoices?: number
    /** Sample assets. Omitted means "none here", which selects the labelled fallback voice. */
    sampleFetcher?: SampleFetcher | null
  } = {},
): Rig {
  const graph = new OfflineAudioGraph(16000)
  const scheduler = new ManualScheduler()
  const midiInput = new FakeMidiInput('fake-in-1', 'Fake Controller')
  const midiAccess = new FakeMidiAccess([midiInput])

  let requestMidiAccess: RequestMidiAccess | null
  switch (options.midi ?? 'granted') {
    case 'denied':
      requestMidiAccess = () => Promise.reject(new Error('Permission to use Web MIDI was not granted'))
      break
    case 'unsupported':
      requestMidiAccess = null
      break
    default:
      requestMidiAccess = () => Promise.resolve(midiAccess as MidiAccessLike)
  }

  return {
    graph,
    scheduler,
    midiInput,
    midiAccess,
    boundaries: {
      createContext: () => graph,
      scheduler,
      requestMidiAccess,
      autoStart: true,
      maxVoices: options.maxVoices,
      // Component tests are hermetic: no fetch, no assets, so the engine reports the fallback
      // unless a test hands it the real files.
      sampleFetcher: options.sampleFetcher ?? null,
    },
  }
}

/** Boundaries where creating the audio context fails, for the honest error state. */
export function failingAudioBoundaries(): InstrumentOptions {
  return {
    createContext: () => {
      throw new Error('AudioContext blocked')
    },
    requestMidiAccess: null,
    autoStart: true,
    sampleFetcher: null,
  }
}

/** Boundaries for a browser with no Web Audio at all. */
export function absentAudioBoundaries(): InstrumentOptions {
  return { createContext: () => null, requestMidiAccess: null, autoStart: true, sampleFetcher: null }
}

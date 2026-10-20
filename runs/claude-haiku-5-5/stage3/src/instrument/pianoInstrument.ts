// Non-React composition of the playable piano: the audio engine and signal graph, two layers with
// their own note controllers and voice sinks, sample library, sustain routing, and MIDI.
// Everything external is injected, so the whole instrument runs under test with fakes or offline
// rendering.

import { createBrowserAudioContext, type AudioContextFactory } from '../audio/audioBoundary'
import { browserSampleLoader, SampleLibrary, type SampleLoader, type SampleSetStatus } from '../audio/sampleLibrary'
import type { SampleSetId } from '../audio/pianoModels'
import { spawnSympatheticResonance } from '../audio/stringResonance'
import { LAYER_IDS, type LayerId } from '../audio/signalGraph'
import { NoteController } from '../engine/noteController'
import { PianoEngine, type EngineStatus } from '../engine/pianoEngine'
import { LayerVoiceSink } from '../engine/layerVoices'
import { browserMidiAccess, createMidiController, MIDI_SOURCE, type MidiAccessRequest, type MidiController, type MidiStatus } from '../input/midi'
import { isKeyboardNote } from '../model/keybed'
import type { AudioSettings, VoiceSettings } from '../model/audioSettings'

export const PEDAL_SOURCE = 'pedal:ui'
export const KEYBOARD_SUSTAIN_SOURCE = 'key:sustain'
const SUSTAIN_SOURCES = [PEDAL_SOURCE, KEYBOARD_SUSTAIN_SOURCE, MIDI_SOURCE] as const
const STRING_RESONANCE_LEVEL = 0.012

export interface PianoStatus {
  state: 'off' | 'idle' | 'loading' | 'recorded' | 'synthesized' | 'fallback' | 'failed'
  message: string
}

export interface PianoInstrumentOptions {
  audioFactory?: AudioContextFactory
  midiRequest?: MidiAccessRequest
  sampleLoader?: SampleLoader
  onHeldNotes?: (heldNotes: ReadonlySet<number>) => void
  onSustain?: (active: boolean) => void
  onEngineStatus?: (status: EngineStatus) => void
  onMidiStatus?: (status: MidiStatus) => void
  onPianoStatus?: (status: PianoStatus) => void
  /**
   * Replaces the piano's own MIDI routing. The instrument hub uses it so MIDI notes reach every engine,
   * not only the piano. Without it, MIDI plays the piano alone.
   */
  midiRoute?: MidiRoute
  /** CC11 as the Control Pedal's 0..1 value. The page moves the panel's Control Pedal with it. */
  onControlPedal?: (value: number) => void
}

export interface MidiRoute {
  noteOn(note: number, velocity: number): void
  noteOff(note: number): void
  sustain(on: boolean): void
  allNotesOff(): void
}

export interface PianoInstrument {
  readonly engine: PianoEngine
  readonly library: SampleLibrary
  readonly midi: MidiController
  /** Applies panel-derived settings. Safe to call before audio starts; the graph picks them up on start. */
  configure(settings: AudioSettings): void
  pianoStatus(): PianoStatus
  /** Starts audio if needed and resolves once the selected type's recorded set is ready or has failed. */
  ready(): Promise<PianoStatus>
  /** `layerGains` scales each piano layer (zone crossfades); a missing layer plays at full level. */
  noteOn(source: string, note: number, velocity: number, layerGains?: Partial<Record<LayerId, number>>): boolean
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
  let settings: AudioSettings | undefined
  const heldSustainSources = new Set<string>()
  let sustainReported = false

  const library = new SampleLibrary(options.sampleLoader ?? browserSampleLoader(), () => {
    reportPianoStatus()
  })

  const voiceContext = {
    context: () => engine.audio?.context,
    input: (layer: LayerId) => engine.audio?.graph.input(layer),
    library,
    voice: (): VoiceSettings | undefined => settings?.voice,
    octave: (layer: LayerId) => (settings?.octave[layer] ?? 0) + (settings?.transpose ?? 0),
  }

  const sinks: Record<LayerId, LayerVoiceSink> = {
    A: new LayerVoiceSink('A', voiceContext),
    B: new LayerVoiceSink('B', voiceContext),
  }

  const heldAcrossLayers = (): ReadonlySet<number> => {
    const notes = new Set<number>()
    for (const id of LAYER_IDS) controllers[id].heldNotes.forEach((note) => notes.add(note))
    return notes
  }

  const controllers: Record<LayerId, NoteController> = {
    A: new NoteController(sinks.A, { onHeldNotesChange: () => options.onHeldNotes?.(heldAcrossLayers()) }),
    B: new NoteController(sinks.B, { onHeldNotesChange: () => options.onHeldNotes?.(heldAcrossLayers()) }),
  }

  const midiRoute: MidiRoute = options.midiRoute ?? {
    noteOn: (note, velocity) => {
      if (!isKeyboardNote(note)) return
      startAudio()
      noteOnAllLayers(MIDI_SOURCE, note, velocity)
    },
    noteOff: (note) => {
      noteOffAllLayers(MIDI_SOURCE, note)
    },
    sustain: (on) => {
      setSustain(MIDI_SOURCE, on)
    },
    allNotesOff: () => {
      for (const id of LAYER_IDS) controllers[id].releaseSource(MIDI_SOURCE)
    },
  }
  const midi = createMidiController(options.midiRequest ?? browserMidiAccess(), {
    noteOn: (note, velocity) => midiRoute.noteOn(note, velocity),
    noteOff: (note) => midiRoute.noteOff(note),
    sustain: (on) => midiRoute.sustain(on),
    allNotesOff: () => midiRoute.allNotesOff(),
    onStatus: options.onMidiStatus ?? (() => {}),
    controlPedal: (value) => options.onControlPedal?.(value),
  })

  /** Starts the context and the graph on first use, then gives the graph the current settings. */
  function startAudio(): void {
    if (engine.ensureStarted() && settings) {
      engine.audio?.graph.apply(settings.graph)
    }
    ensureSamples()
  }

  function ensureSamples(): void {
    const context = engine.audio?.context
    if (!context || !settings) return
    const set = settings.voice.type.sampleSet
    if (set && settings.voice.type.source === 'recorded' && library.status(set).state === 'idle') {
      library.load(context, set).catch(() => {
        // The status callback has already reported the failure; the fallback voice keeps playing.
      })
    }
  }

  function noteOnAllLayers(source: string, note: number, velocity: number, layerGains: Partial<Record<LayerId, number>> = {}): boolean {
    if (!settings?.graph.sectionOn) return false
    let accepted = false
    for (const id of LAYER_IDS) {
      if (!settings.graph.layers[id].on) continue
      const gain = layerGains[id] ?? 1
      if (gain <= 0) continue
      if (controllers[id].noteOn(source, note, velocity, gain)) accepted = true
    }
    return accepted
  }

  function noteOffAllLayers(source: string, note: number): boolean {
    let released = false
    for (const id of LAYER_IDS) {
      if (controllers[id].noteOff(source, note)) released = true
    }
    return released
  }

  /** Sustain reaches a layer only while SUSTPED routes it to the section (manual p. 23). */
  function syncSustain(): void {
    const routed = settings?.sustainRouted ?? false
    for (const id of LAYER_IDS) {
      for (const source of SUSTAIN_SOURCES) {
        controllers[id].setSustain(source, routed && heldSustainSources.has(source))
      }
    }
    const active = routed && heldSustainSources.size > 0
    if (active !== sustainReported) {
      sustainReported = active
      options.onSustain?.(active)
    }
  }

  function setSustain(source: string, on: boolean): void {
    if (on) {
      startAudio()
      heldSustainSources.add(source)
    } else {
      heldSustainSources.delete(source)
    }
    syncSustain()
  }

  function layerOnState(): Record<LayerId, boolean> {
    return {
      A: Boolean(settings?.graph.layers.A.on) && Boolean(settings?.graph.sectionOn),
      B: Boolean(settings?.graph.layers.B.on) && Boolean(settings?.graph.sectionOn),
    }
  }

  let lastAudible = layerOnState()

  /** Layers that just went silent release their voices, so a turned-off layer never keeps ringing. */
  function releaseSilencedLayers(): void {
    const audible = layerOnState()
    for (const id of LAYER_IDS) {
      if (lastAudible[id] && !audible[id]) controllers[id].allNotesOff()
    }
    lastAudible = audible
  }

  function pianoStatus(): PianoStatus {
    if (!settings) return { state: 'idle', message: 'Piano idle.' }
    if (!settings.graph.sectionOn) return { state: 'off', message: 'Piano section is off.' }
    const type = settings.voice.type
    if (type.source === 'synthesis') {
      return { state: 'synthesized', message: `${type.label}: ${type.model}. Live synthesis, not a recording.` }
    }
    const set = type.sampleSet as SampleSetId
    const status: SampleSetStatus = library.status(set)
    if (status.state === 'ready') {
      return { state: 'recorded', message: `${type.label}: ${type.model}. Recorded samples (${library.get(set)?.manifest.license ?? ''}).` }
    }
    if (status.state === 'failed') {
      return {
        state: 'failed',
        message: `${type.label}: ${status.message} Playing the labelled live-synthesis fallback, not the recorded set.`,
      }
    }
    if (status.state === 'loading') {
      return { state: 'loading', message: `${type.label}: loading recorded samples. Playing the labelled live-synthesis fallback until they arrive.` }
    }
    return { state: 'idle', message: `${type.label}: ${type.model}. Samples load when the piano first sounds.` }
  }

  let lastStatus: PianoStatus | undefined
  function reportPianoStatus(): void {
    const next = pianoStatus()
    if (lastStatus && lastStatus.state === next.state && lastStatus.message === next.message) return
    lastStatus = next
    options.onPianoStatus?.(next)
  }

  function resonate(note: number): void {
    const context = engine.audio?.context
    const graph = engine.audio?.graph
    if (!context || !graph || !settings?.voice.stringResonance || !settings.voice.type.stringResonance) return
    const others = [...heldAcrossLayers()].filter((held) => held !== note)
    if (others.length === 0) return
    spawnSympatheticResonance(context, [graph.input('A'), graph.input('B')], others, STRING_RESONANCE_LEVEL)
  }

  return {
    engine,
    library,
    midi,
    configure(next) {
      settings = next
      if (engine.audio) {
        engine.audio.graph.apply(next.graph)
      }
      for (const id of LAYER_IDS) {
        sinks[id].setBend(next.voice.bendCents)
      }
      releaseSilencedLayers()
      syncSustain()
      ensureSamples()
      reportPianoStatus()
    },
    pianoStatus,
    ready() {
      startAudio()
      const context = engine.audio?.context
      const set = settings?.voice.type.sampleSet
      if (!context || !set) return Promise.resolve(pianoStatus())
      return library.load(context, set).then(
        () => pianoStatus(),
        () => pianoStatus(),
      )
    },
    noteOn(source, note, velocity, layerGains) {
      startAudio()
      const accepted = noteOnAllLayers(source, note, velocity, layerGains)
      if (accepted) resonate(note)
      return accepted
    },
    noteOff(source, note) {
      return noteOffAllLayers(source, note)
    },
    setSustain,
    releaseEverything() {
      for (const id of LAYER_IDS) controllers[id].allNotesOff()
      heldSustainSources.clear()
      syncSustain()
    },
    connectMidi() {
      midi.connect()
    },
    teardown() {
      for (const id of LAYER_IDS) controllers[id].stopAll()
      heldSustainSources.clear()
      midi.disconnect()
      engine.dispose()
    },
  }
}

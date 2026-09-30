import { attachComputerKeyboard } from '../input/computerKeyboard'
import { createMidiController, type MidiController, type MidiProvider, type MidiStatus } from '../input/midi'
import { attachPageLifecycle, type DocumentLike } from '../input/pageLifecycle'
import { createEngineStore, LAYER_IDS, type EngineStore, type LayerId } from '../engine/state'
import { NoteLifecycle, type LifecycleSnapshot } from './lifecycle'
import { MAX_NOTE, MIN_NOTE } from './pianoDsp'
import type { AudioContextLike, AudioStatus, EventTargetLike, LayerRouter, SampleLoader, Scheduler } from './types'
import { WebAudioPianoSink, type ModelStatus } from './webAudioSink'

/** Every browser boundary the instrument touches, injectable for tests. */
export interface InstrumentDeps {
  createAudioContext: () => AudioContextLike | null
  scheduler: Scheduler
  /** fetches one bundled sample file; tests inject an in-memory loader */
  loadSample: SampleLoader
  midi: MidiProvider
  keyTarget: EventTargetLike
  pageWindow: EventTargetLike
  pageDocument: DocumentLike
}

export interface InstrumentSnapshot extends LifecycleSnapshot {
  audio: AudioStatus
  midi: MidiStatus
  /** what each layer's selected model is doing */
  models: Record<LayerId, ModelStatus>
}

export interface Instrument {
  lifecycle: NoteLifecycle
  sink: WebAudioPianoSink
  /** canonical piano + effects state that the audio follows */
  state: EngineStore
  midi: MidiController
  /** ask the browser for audio (call from a user gesture) */
  wake(): void
  subscribe(listener: () => void): () => void
  getSnapshot(): InstrumentSnapshot
  dispose(): void
}

/** which layers a key reaches: enabled layers of an enabled Piano section, shifted by each layer's octave */
export function createRouter(state: EngineStore): LayerRouter {
  return {
    targets(note) {
      const s = state.get()
      if (!s.pianoOn) return []
      const out = []
      for (const id of LAYER_IDS) {
        const layer = s.layers[id]
        const transpose = 12 * layer.octave
        const sounding = note + transpose
        if (layer.enabled && sounding >= MIN_NOTE && sounding <= MAX_NOTE) out.push({ layer: id, transpose })
      }
      return out
    },
    sustPed: (layer) => state.get().layers[layer as LayerId]?.sustPed ?? true,
  }
}

export function createInstrument(deps: InstrumentDeps, state: EngineStore = createEngineStore()): Instrument {
  const listeners = new Set<() => void>()
  let snapshot: InstrumentSnapshot
  let disposed = false

  const sink = new WebAudioPianoSink({
    createAudioContext: deps.createAudioContext,
    scheduler: deps.scheduler,
    loadSample: deps.loadSample,
    state,
    onStatus: () => refresh(),
  })
  const lifecycle = new NoteLifecycle(sink, undefined, createRouter(state))
  const midi = createMidiController(deps.midi, lifecycle)

  const build = (): InstrumentSnapshot => ({ ...lifecycle.getSnapshot(), audio: sink.getStatus(), midi: midi.getStatus(), models: sink.modelStatuses() })
  const refresh = () => {
    if (disposed) return
    snapshot = build()
    listeners.forEach((l) => l())
  }
  snapshot = build()

  const offLifecycle = lifecycle.subscribe(refresh)
  const offState = state.subscribe(() => {
    sink.syncState(state.get())
    lifecycle.refreshRouting()
    refresh()
  })
  const offMidi = midi.subscribe(refresh)
  const detachKeys = attachComputerKeyboard(deps.keyTarget, lifecycle, deps.pageWindow)
  const detachPage = attachPageLifecycle(deps.pageWindow, deps.pageDocument, () => lifecycle.allNotesOff())

  return {
    lifecycle,
    sink,
    state,
    midi,
    wake: () => sink.ensureStarted(),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
    dispose() {
      if (disposed) return
      detachKeys()
      detachPage()
      offLifecycle()
      offState()
      offMidi()
      midi.dispose()
      lifecycle.dispose()
      disposed = true
      listeners.clear()
    },
  }
}

interface AudioWindow {
  AudioContext?: new () => unknown
  webkitAudioContext?: new () => unknown
}

export function browserDeps(): InstrumentDeps {
  const w = window as unknown as AudioWindow
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  const nav = navigator as unknown as { requestMIDIAccess?: () => Promise<unknown> }
  return {
    createAudioContext: () => (Ctor ? (new Ctor() as AudioContextLike) : null),
    scheduler: {
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
    },
    loadSample: async (url) => {
      const response = await fetch(new URL(url.split('/').map(encodeURIComponent).join('/'), document.baseURI))
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
      return response.arrayBuffer()
    },
    midi: nav.requestMIDIAccess ? () => nav.requestMIDIAccess!.call(navigator) as Promise<never> : null,
    keyTarget: window,
    pageWindow: window,
    pageDocument: document,
  }
}

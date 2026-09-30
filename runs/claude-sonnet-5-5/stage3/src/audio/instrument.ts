import { attachComputerKeyboard } from '../input/computerKeyboard'
import { createMidiController, type MidiController, type MidiProvider, type MidiStatus } from '../input/midi'
import { attachPageLifecycle, type DocumentLike } from '../input/pageLifecycle'
import { createEngineStore, LAYER_IDS, type EngineState, type EngineStore, type LayerId } from '../engine/state'
import { resolveState } from '../engine/resolve'
import { SYNTH_LAYER_IDS } from '../engine/synth'
import { zoneGain, type SourceKey } from '../engine/zones'
import type { StorageLike } from '../engine/programs'
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
  /** where programs and Live slots persist; null = nowhere (kept for the session only) */
  storage?: StorageLike | null
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
  /** Panic: every note, latched note and arpeggio stops; held pedals are forgotten */
  panic(): void
  subscribe(listener: () => void): () => void
  getSnapshot(): InstrumentSnapshot
  dispose(): void
}

/** every sound source: its voice-target id, section and canonical layer, in a fixed order */
interface Source {
  layer: string
  key: SourceKey
  section: 'piano' | 'organ' | 'synth'
  enabled: (s: EngineState) => boolean
  octave: (s: EngineState) => number
  sustPed: (s: EngineState) => boolean
  range: [number, number]
}
const SOURCES: Source[] = [
  ...LAYER_IDS.map(
    (id): Source => ({ layer: id, key: `piano.${id}`, section: 'piano', enabled: (s) => s.pianoOn && s.layers[id].enabled, octave: (s) => s.layers[id].octave, sustPed: (s) => s.layers[id].sustPed, range: [MIN_NOTE, MAX_NOTE] }),
  ),
  ...LAYER_IDS.map(
    (id): Source => ({ layer: `o${id}`, key: `organ.${id}`, section: 'organ', enabled: (s) => s.organOn && s.organ.layers[id].enabled, octave: (s) => s.organ.layers[id].octave, sustPed: (s) => s.organ.layers[id].sustPed, range: [12, 119] }),
  ),
  ...SYNTH_LAYER_IDS.map(
    (id): Source => ({ layer: `s${id}`, key: `synth.${id}`, section: 'synth', enabled: (s) => s.synthOn && s.synth[id].enabled, octave: (s) => s.synth[id].octave, sustPed: (s) => s.synth[id].sustPed, range: [0, 127] }),
  ),
]

/**
 * Which layers a key reaches: enabled layers of enabled sections whose zone range contains the key (faded across the split
 * crossfade), shifted by the layer's octave and the global transpose.
 */
export function createRouter(state: EngineStore): LayerRouter {
  return {
    targets(note) {
      const s = state.get()
      const transpose = s.transpose.on ? s.transpose.semitones : 0
      const out = []
      for (const src of SOURCES) {
        if (!src.enabled(s)) continue
        const shift = 12 * src.octave(s) + transpose
        const sounding = note + shift
        if (sounding < src.range[0] || sounding > src.range[1]) continue
        const gain = zoneGain(s.split, s.zones[src.key], note)
        if (gain < 0.002) continue
        out.push(gain >= 0.9999 ? { layer: src.layer, transpose: shift } : { layer: src.layer, transpose: shift, gain })
      }
      return out
    },
    sustPed: (layer) => {
      const src = SOURCES.find((x) => x.layer === layer)
      return src ? src.sustPed(state.get()) : true
    },
    active: () => {
      const s = state.get()
      return SOURCES.filter((src) => src.enabled(s)).map((src) => src.layer)
    },
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
  const midi = createMidiController(deps.midi, lifecycle, {
    modWheel: (v) => state.update((s) => (s.modWheel === v ? s : { ...s, modWheel: v })),
    controlPedal: (v) => state.update((s) => (s.pedalPos === v ? s : { ...s, pedalPos: v })),
    pitchBend: (v) => state.update((s) => (s.pitchBend === v ? s : { ...s, pitchBend: v })),
  })

  const build = (): InstrumentSnapshot => ({ ...lifecycle.getSnapshot(), audio: sink.getStatus(), midi: midi.getStatus(), models: sink.modelStatuses() })
  const refresh = () => {
    if (disposed) return
    snapshot = build()
    listeners.forEach((l) => l())
  }
  snapshot = build()

  const offLifecycle = lifecycle.subscribe(refresh)
  sink.syncState(resolveState(state.get()))
  const offState = state.subscribe(() => {
    sink.syncState(resolveState(state.get()))
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
    panic: () => lifecycle.allNotesOff(),
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
    storage: browserStorage(),
  }
}

/** localStorage, or null where it is blocked (private windows, cleared site data) */
export function browserStorage(): StorageLike | null {
  try {
    const storage = window.localStorage
    const probe = '__stagebench_probe__'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return null
  }
}

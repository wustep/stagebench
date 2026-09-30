import { attachComputerKeyboard } from '../input/computerKeyboard'
import { createMidiController, type MidiController, type MidiProvider, type MidiStatus } from '../input/midi'
import { attachPageLifecycle, type DocumentLike } from '../input/pageLifecycle'
import { NoteLifecycle, type LifecycleSnapshot } from './lifecycle'
import type { AudioContextLike, AudioStatus, EventTargetLike, Scheduler } from './types'
import { WebAudioPianoSink } from './webAudioSink'

/** Every browser boundary the instrument touches, injectable for tests. */
export interface InstrumentDeps {
  createAudioContext: () => AudioContextLike | null
  scheduler: Scheduler
  midi: MidiProvider
  keyTarget: EventTargetLike
  pageWindow: EventTargetLike
  pageDocument: DocumentLike
}

export interface InstrumentSnapshot extends LifecycleSnapshot {
  audio: AudioStatus
  midi: MidiStatus
}

export interface Instrument {
  lifecycle: NoteLifecycle
  sink: WebAudioPianoSink
  midi: MidiController
  /** ask the browser for audio (call from a user gesture) */
  wake(): void
  subscribe(listener: () => void): () => void
  getSnapshot(): InstrumentSnapshot
  dispose(): void
}

export function createInstrument(deps: InstrumentDeps): Instrument {
  const listeners = new Set<() => void>()
  let snapshot: InstrumentSnapshot
  let disposed = false

  const sink = new WebAudioPianoSink({
    createAudioContext: deps.createAudioContext,
    scheduler: deps.scheduler,
    onStatus: () => refresh(),
  })
  const lifecycle = new NoteLifecycle(sink)
  const midi = createMidiController(deps.midi, lifecycle)

  const build = (): InstrumentSnapshot => ({ ...lifecycle.getSnapshot(), audio: sink.getStatus(), midi: midi.getStatus() })
  const refresh = () => {
    if (disposed) return
    snapshot = build()
    listeners.forEach((l) => l())
  }
  snapshot = build()

  const offLifecycle = lifecycle.subscribe(refresh)
  const offMidi = midi.subscribe(refresh)
  const detachKeys = attachComputerKeyboard(deps.keyTarget, lifecycle, deps.pageWindow)
  const detachPage = attachPageLifecycle(deps.pageWindow, deps.pageDocument, () => lifecycle.allNotesOff())

  return {
    lifecycle,
    sink,
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
    midi: nav.requestMIDIAccess ? () => nav.requestMIDIAccess!.call(navigator) as Promise<never> : null,
    keyTarget: window,
    pageWindow: window,
    pageDocument: document,
  }
}

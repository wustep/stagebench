/**
 * The one note lifecycle every input source feeds.
 *
 * Pointer, touch, computer keyboard and Web MIDI all call `press`/`release` here, so
 * there is exactly one place that decides whether a voice starts, is re-struck, is
 * sustained, is stolen, or is cleaned up.
 */
import type { AudioEngine, AudioStatusReport, VoiceHandle } from './types'
import type { Clock } from './clock'
import { clampVelocity } from './pianoModel'

export const MAX_POLYPHONY = 16

export type NoteSource = 'pointer' | 'keyboard' | 'midi'

export interface VoiceState {
  id: string
  midi: number
  velocity: number
  /** Sources currently holding this note. The voice ends when this empties. */
  owners: Set<string>
  /** Which input families currently own the note, for the visual audit. */
  sources: Set<NoteSource>
  /** True while the note is only sounding because the sustain pedal is down. */
  sustained: boolean
  /** Monotonic order of voice start, used for deterministic stealing. */
  order: number
  startedAt: number
}

export interface PianoSnapshot {
  /** MIDI notes with at least one owner holding the key down. */
  held: number[]
  /** MIDI notes currently sounding, whether held or sustained. */
  sounding: number[]
  sustained: number[]
  velocities: Record<number, number>
  sustainPedal: boolean
  audio: AudioStatusReport
  /** Voices owned by the engine right now. */
  engineVoices: number
  /** Voices the session believes it has started and not yet ended. */
  sessionVoices: number
  /** Notes dropped by voice stealing since mount, for the audit and tests. */
  stolen: number
  voices: VoiceState[]
}

export interface PianoSessionOptions {
  engine: AudioEngine
  clock: Clock
  lowestMidi: number
  highestMidi: number
  maxPolyphony?: number
}

export interface NoteOnRequest {
  midi: number
  /** 0..1. Callers convert MIDI 1..127 or pointer pressure before calling. */
  velocity: number
  source: NoteSource
  /** Stable per-source key, e.g. `pointer:3`, `keyboard:KeyZ`, `midi:<inputId>`. */
  owner: string
}

export interface PianoSession {
  press(request: NoteOnRequest): void
  release(source: NoteSource, owner: string, midi: number): void
  /** Releases everything held by one owner (e.g. one pointer lifting). */
  releaseOwner(source: NoteSource, owner: string): void
  setSustain(down: boolean, owner: string): void
  /** Every voice stops: blur, MIDI disconnect, panic, unmount. */
  allNotesOff(reason: string): void
  snapshot(): PianoSnapshot
  subscribe(listener: (snapshot: PianoSnapshot) => void): () => void
  reportAudio(report: AudioStatusReport): void
  dispose(): void
  lastAllNotesOffReason(): string | null
}

export function createPianoSession(options: PianoSessionOptions): PianoSession {
  const { engine, clock, lowestMidi, highestMidi } = options
  const maxPolyphony = options.maxPolyphony ?? MAX_POLYPHONY

  const voices = new Map<number, VoiceState>()
  const pedalOwners = new Set<string>()
  const listeners = new Set<(snapshot: PianoSnapshot) => void>()
  let audio: AudioStatusReport = engine.status()
  let nextVoiceId = 1
  let order = 0
  let stolen = 0
  let disposed = false
  let lastReason: string | null = null
  let started = false

  function emit(): void {
    const snap = snapshot()
    for (const listener of listeners) listener(snap)
  }

  function snapshot(): PianoSnapshot {
    const list = Array.from(voices.values()).toSorted((a, b) => a.order - b.order)
    const held = list.filter((v) => v.owners.size > 0).map((v) => v.midi).toSorted((a, b) => a - b)
    const sounding = list.map((v) => v.midi).toSorted((a, b) => a - b)
    const sustained = list.filter((v) => v.owners.size === 0).map((v) => v.midi).toSorted((a, b) => a - b)
    const velocities: Record<number, number> = {}
    for (const v of list) velocities[v.midi] = v.velocity
    return {
      held,
      sounding,
      sustained,
      velocities,
      sustainPedal: pedalOwners.size > 0,
      audio,
      engineVoices: engine.activeVoiceCount(),
      sessionVoices: list.length,
      stolen,
      voices: list.map((v) => ({
        ...v,
        owners: new Set(v.owners),
        sources: new Set(v.sources),
      })),
    }
  }

  function endVoice(voice: VoiceState): void {
    voices.delete(voice.midi)
    engine.noteOff(voice.id)
  }

  function startAudioIfNeeded(): void {
    if (started) return
    started = true
    void engine.start().then((report) => {
      audio = report
      emit()
    })
  }

  function stealIfNeeded(): void {
    while (voices.size >= maxPolyphony) {
      // Deterministic: the oldest-started voice is stolen. Ties cannot occur because
      // `order` is a strictly increasing counter.
      let oldest: VoiceState | null = null
      for (const voice of voices.values()) {
        if (!oldest || voice.order < oldest.order) oldest = voice
      }
      if (!oldest) break
      stolen += 1
      endVoice(oldest)
    }
  }

  function press(request: NoteOnRequest): void {
    if (disposed) return
    const { midi, source, owner } = request
    if (!Number.isInteger(midi) || midi < lowestMidi || midi > highestMidi) return
    startAudioIfNeeded()

    const velocity = clampVelocity(request.velocity)
    const existing = voices.get(midi)
    let inheritedOwners: Set<string> | null = null
    let inheritedSources: Set<NoteSource> | null = null
    if (existing) {
      // The same owner pressing the same key again is a duplicate, not a new stroke.
      if (existing.owners.has(owner)) return
      // A different owner striking a held note re-strikes it. The previous stroke's
      // damper closes and a new attack begins, while every existing owner carries over.
      inheritedOwners = new Set(existing.owners)
      inheritedOwners.add(owner)
      inheritedSources = new Set(existing.sources)
      inheritedSources.add(source)
      endVoice(existing)
    }

    stealIfNeeded()

    const voice: VoiceState = {
      id: `v${nextVoiceId}`,
      midi,
      velocity,
      owners: inheritedOwners ?? new Set([owner]),
      sources: inheritedSources ?? new Set([source]),
      sustained: false,
      order: order++,
      startedAt: clock.now(),
    }
    nextVoiceId += 1
    voices.set(midi, voice)
    const handle: VoiceHandle = { id: voice.id, midi, velocity }
    engine.noteOn(handle)
    emit()
  }

  function release(source: NoteSource, owner: string, midi: number): void {
    if (disposed) return
    const voice = voices.get(midi)
    if (!voice) return
    if (!voice.owners.has(owner)) return
    voice.owners.delete(owner)
    if (voice.owners.size === 0) voice.sources.clear()
    else voice.sources.delete(source)
    if (voice.owners.size > 0) {
      emit()
      return
    }
    if (pedalOwners.size > 0) {
      // Damper up: the note keeps sounding until the pedal is released.
      voice.sustained = true
      emit()
      return
    }
    endVoice(voice)
    emit()
  }

  function releaseOwner(source: NoteSource, owner: string): void {
    if (disposed) return
    for (const voice of Array.from(voices.values())) {
      if (!voice.owners.has(owner)) continue
      release(source, owner, voice.midi)
    }
  }

  function setSustain(down: boolean, owner: string): void {
    if (disposed) return
    const wasDown = pedalOwners.size > 0
    if (down) pedalOwners.add(owner)
    else pedalOwners.delete(owner)
    const isDown = pedalOwners.size > 0
    if (wasDown && !isDown) {
      for (const voice of Array.from(voices.values())) {
        if (voice.owners.size === 0) endVoice(voice)
      }
    }
    emit()
  }

  function allNotesOff(reason: string): void {
    lastReason = reason
    for (const voice of Array.from(voices.values())) {
      voices.delete(voice.midi)
      engine.noteOff(voice.id)
    }
    engine.stopAll()
    pedalOwners.clear()
    emit()
  }

  return {
    press,
    release,
    releaseOwner,
    setSustain,
    allNotesOff,
    snapshot,
    subscribe(listener) {
      listeners.add(listener)
      listener(snapshot())
      return () => {
        listeners.delete(listener)
      }
    },
    reportAudio(report) {
      audio = report
      emit()
    },
    dispose() {
      if (disposed) return
      allNotesOff('unmount')
      disposed = true
      listeners.clear()
    },
    lastAllNotesOffReason() {
      return lastReason
    },
  }
}

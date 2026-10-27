/**
 * The one note lifecycle every input source feeds.
 *
 * Pointer, touch, computer keyboard and Web MIDI all call `press`/`release` here, so there
 * is exactly one place that decides whether a voice starts, is re-struck, is sustained, is
 * stolen, or is cleaned up.
 *
 * Phase 2 adds layer ownership. One key press now starts up to two voices (Piano A and
 * Piano B) and each is released, sustained and cleaned up independently. Every Phase 1
 * behaviour is preserved: the same public surface, the same duplicate/re-strike rules, and
 * the same deterministic oldest-first stealing now applied per layer.
 */
import type { AudioEngine, AudioStatusReport, LayerId, VoiceHandle, VoiceSettings } from './types'
import type { Clock } from './clock'
import { clampVelocity } from './pianoModel'
import type { PianoLayerId, PianoState } from './pianoState'
import { activeLayers, voiceParamsFor } from './pianoState'

export const MAX_POLYPHONY = 16

export type NoteSource = 'pointer' | 'keyboard' | 'midi'

export interface VoiceState {
  id: string
  midi: number
  velocity: number
  /** Piano layer that owns this voice. */
  layer: PianoLayerId
  /** The sounding pitch after the layer's octave shift. */
  playedMidi: number
  /** Sources currently holding this note. The voice ends when this empties. */
  owners: Set<string>
  /** Which input families currently own the note, for the visual audit. */
  sources: Set<NoteSource>
  /** True while the note is only sounding because the sustain pedal is down. */
  sustained: boolean
  /** Monotonic order of voice start, used for deterministic stealing. */
  order: number
  startedAt: number
  settings: VoiceSettings
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
  /** Voices per layer, so layer ownership is directly observable. */
  byLayer: Record<PianoLayerId, number>
}

export interface PianoSessionOptions {
  engine: AudioEngine
  clock: Clock
  lowestMidi: number
  highestMidi: number
  maxPolyphony?: number
  /**
   * Reads the current Piano section state at the moment of the press. Phase 1 callers
   * omit this and get a single default layer, which keeps every inherited test valid.
   */
  pianoState?: () => PianoState | null
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
  /** The panel's per-layer SUSTPED routing (manual p. 23). */
  setSustainRouting(layer: PianoLayerId, enabled: boolean): void
  /** Stops every voice one layer owns, e.g. when the layer is switched off mid-note. */
  releaseLayer(layer: PianoLayerId): void
  /** Every voice stops: blur, MIDI disconnect, panic, unmount. */
  allNotesOff(reason: string): void
  snapshot(): PianoSnapshot
  subscribe(listener: (snapshot: PianoSnapshot) => void): () => void
  reportAudio(report: AudioStatusReport): void
  dispose(): void
  lastAllNotesOffReason(): string | null
}

/** The Phase 1 default: one enabled layer, no piano state supplied. */
function defaultSettings(velocity: number): VoiceSettings {
  return {
    velocity,
    layer: 'piano.a',
    octave: 0,
    model: 'grand.salamander',
    touchExponent: 1,
    dynComp: 0,
    timbre: 0,
    unison: 0,
    softRelease: false,
    stringRes: false,
  }
}

/** Voice map key: one entry per (layer, note), so A and B on a key are independent. */
const key = (layer: PianoLayerId, midi: number) => `${layer}:${midi}`

function unique(values: number[]): number[] {
  return Array.from(new Set(values)).toSorted((a, b) => a - b)
}

export function createPianoSession(options: PianoSessionOptions): PianoSession {
  const { engine, clock, lowestMidi, highestMidi } = options
  const maxPolyphony = options.maxPolyphony ?? MAX_POLYPHONY
  const readPianoState = options.pianoState ?? null

  /** Voices keyed by layer + midi, so A and B on the same key are independent. */
  const voices = new Map<string, VoiceState>()
  const pedalOwners = new Set<string>()
  /** Per-layer sustain: SUSTPED decides whether the pedal holds a layer's notes. */
  const pedalHolds: Record<PianoLayerId, boolean> = { 'piano.a': true, 'piano.b': true }
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
    const held = unique(list.filter((v) => v.owners.size > 0).map((v) => v.midi))
    const sounding = unique(list.map((v) => v.midi))
    const sustained = unique(list.filter((v) => v.owners.size === 0).map((v) => v.midi))
    const velocities: Record<number, number> = {}
    for (const v of list) velocities[v.midi] = v.velocity
    const byLayer: Record<PianoLayerId, number> = { 'piano.a': 0, 'piano.b': 0 }
    for (const v of list) byLayer[v.layer] += 1
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
      byLayer,
    }
  }

  function endVoice(voice: VoiceState): void {
    voices.delete(key(voice.layer, voice.midi))
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

  /** Oldest-first stealing, per layer, exactly as Phase 1 did it globally. */
  function stealIfNeeded(layer: PianoLayerId): void {
    for (;;) {
      const layerVoices = Array.from(voices.values()).filter((v) => v.layer === layer)
      if (layerVoices.length < maxPolyphony) return
      let oldest: VoiceState | null = null
      for (const voice of layerVoices) {
        if (!oldest || voice.order < oldest.order) oldest = voice
      }
      if (!oldest) return
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
    const state = readPianoState?.() ?? null
    const layers: PianoLayerId[] = state ? activeLayers(state) : ['piano.a']
    if (layers.length === 0) return
    for (const layer of layers) {
      const voiceKey = key(layer, midi)
      const existing = voices.get(voiceKey)
      let inheritedOwners: Set<string> | null = null
      let inheritedSources: Set<NoteSource> | null = null
      if (existing) {
        if (existing.owners.has(owner)) continue
        inheritedOwners = new Set(existing.owners)
        inheritedOwners.add(owner)
        inheritedSources = new Set(existing.sources)
        inheritedSources.add(source)
        endVoice(existing)
      }
      stealIfNeeded(layer)

      const settings: VoiceSettings = state
        ? voiceParamsFor(state, layer, velocity)
        : defaultSettings(velocity)
      const playedMidi = midi + (settings.octave ?? 0)
      const voice: VoiceState = {
        id: `v${nextVoiceId}`,
        midi,
        velocity,
        layer,
        playedMidi,
        owners: inheritedOwners ?? new Set([owner]),
        sources: inheritedSources ?? new Set([source]),
        sustained: false,
        order: order++,
        startedAt: clock.now(),
        settings,
      }
      nextVoiceId += 1
      voices.set(voiceKey, voice)
      const handle: VoiceHandle = { id: voice.id, midi: playedMidi, velocity, settings }
      engine.noteOn(handle)
    }
    emit()
  }

  function release(source: NoteSource, owner: string, midi: number): void {
    if (disposed) return
    for (const layer of ['piano.a', 'piano.b'] as PianoLayerId[]) {
      const voice = voices.get(key(layer, midi))
      if (!voice) continue
      if (!voice.owners.has(owner)) continue
      voice.owners.delete(owner)
      if (voice.owners.size === 0) voice.sources.clear()
      else voice.sources.delete(source)
      if (voice.owners.size > 0) continue
      if (pedalOwners.size > 0 && pedalHolds[layer]) {
        voice.sustained = true
        continue
      }
      endVoice(voice)
    }
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

  /** The panel's SUSTPED toggle, per layer (manual p. 23). */
  function setSustainRouting(layer: PianoLayerId, enabled: boolean): void {
    pedalHolds[layer] = enabled
    if (!enabled && pedalOwners.size > 0) {
      // Turning the routing off damps notes that layer was holding through the pedal.
      for (const voice of Array.from(voices.values())) {
        if (voice.layer === layer && voice.owners.size === 0) endVoice(voice)
      }
      emit()
    }
  }

  /**
   * Switches a layer off. Its voices are stopped rather than left ringing, and because the
   * session removes them itself the snapshot stays truthful — an engine-level stop would
   * silence the sound while still reporting the note as sounding.
   */
  function releaseLayer(layer: PianoLayerId): void {
    for (const voice of Array.from(voices.values())) {
      if (voice.layer !== layer) continue
      endVoice(voice)
    }
    emit()
  }

  function allNotesOff(reason: string): void {
    lastReason = reason
    for (const voice of Array.from(voices.values())) {
      voices.delete(key(voice.layer, voice.midi))
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
    setSustainRouting,
    releaseLayer,
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

/** Kept for callers that describe a layer by its engine id. */
export type LayerVoiceOwner = LayerId

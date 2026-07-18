/**
 * Injectable audio boundary.
 *
 * `AudioBackend` is the narrow seam between the note lifecycle and whatever
 * renders sound. The app uses `WebAudioBackend`; tests use `FakeAudioBackend`,
 * which renders voices into deterministic in-memory signal buffers so
 * behavior (not exact cross-browser waveforms) can be asserted.
 *
 * Phase 2: the engine owns two piano layers (A/B) with enable, focus, level,
 * octave shift, type, and per-layer SUSTPED routing, plus the canonical
 * piano-performance and effects state the panel edits. Input behavior is
 * unchanged from Phase 1: every source funnels through the same note
 * lifecycle, sustain, polyphony, stealing, and cleanup.
 */

import type { PianoTypeId } from './piano-models'
import { DEFAULT_PIANO_PERF, type PianoPerfState } from '../state/piano-state'
import { defaultEffectsState, type EffectsState } from '../state/effects-state'
import type { LayerId } from './render'

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface Voice {
  id: number
  note: number
  velocity: number
  startedAt: number
  releasedAt: number | null
  stopped: boolean
  /** Phase 2: which piano layer owns this voice. */
  layer: LayerId
}

export interface AudioBackend {
  /** Current time in seconds (monotonic, arbitrary origin). */
  now(): number
  /** Start a voice. Returns a backend handle used to track the voice. */
  startVoice(note: number, velocity: number, layer: LayerId): number
  /** Begin the release phase of a voice (damper down). */
  releaseVoice(handle: number): void
  /** Stop a voice immediately (steal / all-notes-off). */
  stopVoice(handle: number): void
  /** Number of voices the backend still owns (sounding or releasing). */
  activeVoiceCount(): number
  /** Current render configuration snapshot (layer/fx/master state). */
  configure?(config: unknown): void
  /** Tear everything down. */
  dispose(): void
}

export interface EngineEvents {
  onStatus?: (status: EngineStatus, detail?: string) => void
  onVoicesChanged?: (voices: readonly Voice[]) => void
  onStateChanged?: () => void
  /** A recorded type's assets failed; a labeled fallback stays playable. */
  onTypeFailed?: (type: PianoTypeId, detail: string) => void
}

/** Deterministic voice-stealing polyphony limit (per layer). */
export const MAX_VOICES = 16

export interface LayerState {
  id: LayerId
  enabled: boolean
  /** Level fader 0..1. */
  level: number
  /** Octave shift in semitones, clamped to ±12. */
  octave: number
  type: PianoTypeId
  /** SUSTPED toggle: sustain input reaches this layer. */
  sustainPedal: boolean
  /** PSTICK toggle (pitch stick routing; decorative until pitch stick is functional). */
  pitchStick: boolean
}

/** Which piano layer new keybed notes go to (focus). */
export type { LayerId }

/**
 * The shared note lifecycle. All input sources (pointer, touch, computer
 * keyboard, MIDI) funnel through here, so every source gets identical
 * velocity/release/sustain/polyphony/stealing semantics.
 */
export class PianoEngine {
  private backend: AudioBackend
  private events: EngineEvents
  private status: EngineStatus = 'idle'
  private statusDetail = ''
  private voices: Voice[] = []
  private nextVoiceId = 1
  private sustainDown = false
  /** Notes physically held (finger/key down) per MIDI note. */
  private held = new Map<number, number>()

  /** Piano section on/off. */
  private sectionOn = true
  readonly layers: Record<LayerId, LayerState> = {
    pianoA: { id: 'pianoA', enabled: true, level: 0.79, octave: 0, type: 'grand', sustainPedal: true, pitchStick: false },
    pianoB: { id: 'pianoB', enabled: false, level: 0.79, octave: 0, type: 'upright', sustainPedal: true, pitchStick: false },
  }
  /** Which layer new notes are assigned to (Layer focus). */
  private focusedLayer: LayerId = 'pianoA'

  /** Canonical piano performance + effects state (panel-edited). */
  readonly perf: PianoPerfState = { ...DEFAULT_PIANO_PERF }
  readonly effects: EffectsState = defaultEffectsState()
  /** Master Level knob position 0..1. */
  private masterLevel = 0.9
  /** Per-type asset failure (labeled fallback stays playable). */
  private failedTypes = new Set<PianoTypeId>()

  constructor(backend: AudioBackend, events: EngineEvents = {}) {
    this.backend = backend
    this.events = events
  }

  getStatus(): { status: EngineStatus; detail: string } {
    return { status: this.status, detail: this.statusDetail }
  }

  getVoices(): readonly Voice[] {
    return this.voices
  }

  isSustainDown(): boolean {
    return this.sustainDown
  }

  // ------------------------------------------------------------- state API

  getFocusedLayer(): LayerId {
    return this.focusedLayer
  }

  setFocusLayer(layer: LayerId): void {
    this.focusedLayer = layer
    this.pushConfig()
  }

  setSectionOn(on: boolean): void {
    this.sectionOn = on
    if (!on) this.allNotesOff()
    this.pushConfig()
  }

  isSectionOn(): boolean {
    return this.sectionOn
  }

  setLayerEnabled(layer: LayerId, enabled: boolean): void {
    this.layers[layer].enabled = enabled
    if (!enabled) {
      // Layer ownership: disabling a layer stops only its own voices.
      for (const v of this.voices) {
        if (v.layer === layer && !v.stopped) {
          this.backend.stopVoice(v.id)
          v.stopped = true
        }
      }
      this.voices = this.voices.filter((v) => !v.stopped)
      this.events.onVoicesChanged?.(this.voices)
    }
    this.pushConfig()
  }

  setLayerLevel(layer: LayerId, level01: number): void {
    this.layers[layer].level = Math.min(1, Math.max(0, level01))
    this.pushConfig()
  }

  setLayerOctave(layer: LayerId, semitones: number): void {
    this.layers[layer].octave = Math.max(-12, Math.min(12, Math.round(semitones)))
    this.pushConfig()
  }

  setLayerType(layer: LayerId, type: PianoTypeId): void {
    this.layers[layer].type = type
    this.pushConfig()
  }

  setLayerSustainPedal(layer: LayerId, on: boolean): void {
    this.layers[layer].sustainPedal = on
    if (!on && this.sustainDown) {
      // SUSTPED switched off mid-pedal: that layer's deferred notes release.
      for (const v of this.voices) {
        if (v.layer === layer && !v.stopped && v.releasedAt === null && !this.held.has(v.note)) {
          v.releasedAt = this.backend.now()
          this.backend.releaseVoice(v.id)
        }
      }
      this.events.onVoicesChanged?.(this.voices)
    }
    this.pushConfig()
  }

  setLayerPitchStick(layer: LayerId, on: boolean): void {
    this.layers[layer].pitchStick = on
    this.pushConfig()
  }

  setMasterLevel(level01: number): void {
    this.masterLevel = Math.min(1, Math.max(0, level01))
    this.pushConfig()
  }

  getMasterLevel(): number {
    return this.masterLevel
  }

  /** Mark a recorded type's assets as failed → labeled fallback (playable). */
  markTypeFailed(type: PianoTypeId, detail: string): void {
    this.failedTypes.add(type)
    this.events.onTypeFailed?.(type, detail)
    this.pushConfig()
  }

  clearTypeFailed(type: PianoTypeId): void {
    this.failedTypes.delete(type)
    this.pushConfig()
  }

  isTypeFailed(type: PianoTypeId): boolean {
    return this.failedTypes.has(type)
  }

  /** Snapshot used by backends to render/schedule. */
  getConfig() {
    return {
      layers: this.layers,
      focusedLayer: this.focusedLayer,
      sectionOn: this.sectionOn,
      perf: this.perf,
      effects: this.effects,
      masterLevel: this.masterLevel,
      failedTypes: new Set(this.failedTypes),
    }
  }

  private pushConfig(): void {
    this.backend.configure?.(this.getConfig())
    this.events.onStateChanged?.()
  }

  /** Mutate perf/effects state then push (used by panel bindings). */
  update(mutate: () => void): void {
    mutate()
    this.pushConfig()
  }

  // ------------------------------------------------------------ lifecycle

  /** Initialize the backend and mark ready. Kept async for real backends that decode. */
  async init(): Promise<void> {
    this.setStatus('loading')
    try {
      this.setStatus('ready')
      this.pushConfig()
    } catch (err) {
      this.setStatus('error', err instanceof Error ? err.message : String(err))
    }
  }

  /** Enter an error state with an honest message (e.g. Web Audio unavailable). */
  fail(detail: string) {
    this.setStatus('error', detail)
  }

  noteOn(note: number, velocity: number) {
    if (this.status === 'error') return
    if (!this.sectionOn) return
    const layer = this.focusedLayer
    if (!this.layers[layer].enabled) return
    const vel = clamp01(velocity)
    // Deterministic stealing within the layer: steal the oldest released voice first, else the oldest voice.
    if (this.voices.filter((v) => !v.stopped && v.layer === layer).length >= MAX_VOICES) {
      const victim = pickStealVictim(this.voices.filter((v) => v.layer === layer))
      if (victim) {
        this.backend.stopVoice(victim.id)
        victim.stopped = true
      }
    }
    this.voices = this.voices.filter((v) => !v.stopped)
    const handle = this.backend.startVoice(note, vel, layer)
    const voice: Voice = { id: handle, note, velocity: vel, startedAt: this.backend.now(), releasedAt: null, stopped: false, layer }
    this.voices.push(voice)
    this.held.set(note, (this.held.get(note) ?? 0) + 1)
    this.events.onVoicesChanged?.(this.voices)
  }

  noteOff(note: number) {
    const count = this.held.get(note) ?? 0
    if (count > 1) {
      this.held.set(note, count - 1)
      return // overlapping note-ons: only release when the last hold lifts
    }
    this.held.delete(note)
    let changed = false
    for (const v of this.voices) {
      if (v.note === note && !v.stopped && v.releasedAt === null) {
        if (this.sustainDown && this.layers[v.layer].sustainPedal) {
          // Damper up: voice keeps sounding until sustain lifts (SUSTPED on).
          continue
        }
        v.releasedAt = this.backend.now()
        this.backend.releaseVoice(v.id)
        changed = true
      }
    }
    if (changed) this.events.onVoicesChanged?.(this.voices)
  }

  setSustain(down: boolean) {
    if (this.sustainDown === down) return
    this.sustainDown = down
    if (!down) {
      // Damper down: every note whose keys are no longer held releases now
      // (only layers with SUSTPED on deferred their release).
      for (const v of this.voices) {
        if (v.note != null && !v.stopped && v.releasedAt === null && !this.held.has(v.note)) {
          v.releasedAt = this.backend.now()
          this.backend.releaseVoice(v.id)
        }
      }
    }
    this.events.onVoicesChanged?.(this.voices)
  }

  /** All notes off: stop every owned voice immediately and forget holds. */
  allNotesOff() {
    for (const v of this.voices) {
      if (!v.stopped) {
        this.backend.stopVoice(v.id)
        v.stopped = true
      }
    }
    this.voices = []
    this.held.clear()
    this.events.onVoicesChanged?.(this.voices)
  }

  dispose() {
    this.allNotesOff()
    this.backend.dispose()
  }

  private setStatus(status: EngineStatus, detail = '') {
    this.status = status
    this.statusDetail = detail
    this.events.onStatus?.(status, detail)
  }
}

function pickStealVictim(voices: Voice[]): Voice | undefined {
  const live = voices.filter((v) => !v.stopped)
  if (live.length === 0) return undefined
  const released = live.filter((v) => v.releasedAt !== null)
  const pool = released.length > 0 ? released : live
  // Oldest by start time; ties broken by voice id (allocation order) — deterministic.
  return pool.reduce((a, b) => (a.startedAt !== b.startedAt ? (a.startedAt < b.startedAt ? a : b) : a.id < b.id ? a : b))
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

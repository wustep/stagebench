/**
 * Injectable audio boundary + the instrument engine (Phase 3).
 *
 * `AudioBackend` is the narrow seam between the note lifecycle and whatever
 * renders sound. The app uses `WebAudioBackend`; tests use `FakeAudioBackend`.
 *
 * Phase 3: the engine owns every section — piano (2 layers), organ (2
 * layers), synth (3 layers) — plus the program system (32 slots + 8 Live),
 * splits/zones/crossfades, Layer Scenes, morphs, master clock, transpose,
 * and Panic. Every input source funnels through one note lifecycle; the
 * routable layer of a voice is decided by section enable, zone routing, and
 * (for piano, per the inherited Phase 2 contract) layer focus.
 */

import type { PianoTypeId } from './piano-models'
import { DEFAULT_PIANO_PERF, type PianoPerfState } from '../state/piano-state'
import { defaultEffectsState, type EffectsState } from '../state/effects-state'
import { defaultOrganState, type OrganState } from '../state/organ-state'
import { defaultSynthState, type SynthState } from '../state/synth-state'
import {
  activeSplitMidis,
  cloneProgramState,
  defaultProgramState,
  serializeProgramState,
  zoneGain,
  type ProgramState,
  type RoutableLayerId,
  type SplitState,
} from '../state/program-state'
import { ProgramBank, LIVE_SLOTS, PROGRAM_SLOTS, SLOTS_PER_PAGE, type StorageLike } from '../state/program-store'
import { isMorphableControl, morphValue, type MorphState, type MorphSource } from '../state/morph'
import { inRange } from '../hardware/keys'

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error'

/** Piano layer ids (Phase 2 contract, kept verbatim for inherited tests). */
export type LayerId = 'pianoA' | 'pianoB'

export interface Voice {
  id: number
  note: number
  velocity: number
  startedAt: number
  releasedAt: number | null
  stopped: boolean
  /** Which layer owns this voice (piano layers in Phase 2; any routable layer in Phase 3). */
  layer: RoutableLayerId
  /** Zone/crossfade gain captured at note-on. */
  zoneGain: number
}

export interface AudioBackend {
  /** Current time in seconds (monotonic, arbitrary origin). */
  now(): number
  /** Start a voice. Returns a backend handle used to track the voice. */
  startVoice(note: number, velocity: number, layer: RoutableLayerId): number
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
  /** PSTICK toggle (pitch stick routing). */
  pitchStick: boolean
}

/** Which piano layer new keybed notes go to (focus). */
export type { LayerId as PianoLayerId }

export type { RoutableLayerId }

/** Transpose range (programs spec). */
export const TRANSPOSE_RANGE = 6
/** Master clock range (programs spec). */
export const BPM_MIN = 30
export const BPM_MAX = 300

/** Per-layer enable map used by Layer Scenes. */
export interface LayerEnables {
  pianoA: boolean
  pianoB: boolean
  organA: boolean
  organB: boolean
  synthA: boolean
  synthB: boolean
  synthC: boolean
}

/**
 * The shared note lifecycle + full instrument state. All input sources
 * (pointer, touch, computer keyboard, MIDI) funnel through noteOn/noteOff,
 * so every source gets identical velocity/release/sustain/polyphony/stealing
 * semantics.
 */
export class PianoEngine {
  private backend: AudioBackend
  private events: EngineEvents
  private status: EngineStatus = 'idle'
  private statusDetail = ''
  private voices: Voice[] = []
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

  /** Phase 3: canonical organ and synth state. */
  readonly organ: OrganState = defaultOrganState()
  readonly synth: SynthState = defaultSynthState()
  /** Splits / zones / crossfades. */
  split: SplitState = defaultProgramState().split
  /** Active Layer Scene. */
  scene: 'I' | 'II' = 'I'
  private sceneMemory: Record<'I' | 'II', LayerEnables | null> = { I: null, II: null }
  /** Morph assignments + source positions (0..1). */
  morphs: MorphState = { wheel: [], ctrlPedal: [] }
  morphPositions: Record<MorphSource, number> = { wheel: 0, ctrlPedal: 0 }
  /** Master clock BPM (30..300) + keyboard sync toggle. */
  clock = { bpm: 120, kbSync: false }
  /** Transpose in semitones (−6..+6). */
  transpose = 0
  /** Program bank (32 slots + 8 Live), navigation, and dirty lifecycle. */
  readonly bank: ProgramBank
  currentSlot: number | null = 0
  liveMode = false
  currentLiveSlot = 0
  page = 0
  listView = false
  /** Canonical snapshot of the loaded slot (dirty check). */
  private loadedSnapshot: string | null = null
  /** Slot name shown in the display. */
  currentName = 'Grand Piano'
  /** Single-level undo of a program change from an edited state (optional). */
  private undoSnapshot: { slot: number | null; liveSlot: number; liveMode: boolean; name: string; state: ProgramState } | null = null

  /** Master Level knob position 0..1. */
  private masterLevel = 0.9
  /** Per-type asset failure (labeled fallback stays playable). */
  private failedTypes = new Set<PianoTypeId>()

  /** Arp held-note pool per synth layer (arpHold keeps notes after lift). */
  private arpHeldNotes: Record<'A' | 'B' | 'C', number[]> = { A: [], B: [], C: [] }

  constructor(backend: AudioBackend, events: EngineEvents = {}, storage: StorageLike | null = null) {
    this.backend = backend
    this.events = events
    this.bank = new ProgramBank(storage)
    this.loadSlot(0, { discard: true })
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
    if (!on) this.stopSectionVoices((v) => v.layer === 'pianoA' || v.layer === 'pianoB')
    this.pushConfig()
  }

  isSectionOn(): boolean {
    return this.sectionOn
  }

  setOrganSectionOn(on: boolean): void {
    this.organ.sectionOn = on
    if (!on) this.stopSectionVoices((v) => v.layer === 'organA' || v.layer === 'organB')
    this.pushConfig()
  }

  setSynthSectionOn(on: boolean): void {
    this.synth.sectionOn = on
    if (!on) this.stopSectionVoices((v) => v.layer === 'synthA' || v.layer === 'synthB' || v.layer === 'synthC')
    this.pushConfig()
  }

  private stopSectionVoices(match: (v: Voice) => boolean): void {
    let changed = false
    for (const v of this.voices) {
      if (match(v) && !v.stopped) {
        this.backend.stopVoice(v.id)
        v.stopped = true
        changed = true
      }
    }
    if (changed) {
      this.voices = this.voices.filter((v) => !v.stopped)
      this.events.onVoicesChanged?.(this.voices)
    }
  }

  setLayerEnabled(layer: LayerId, enabled: boolean): void {
    this.layers[layer].enabled = enabled
    if (!enabled) this.stopSectionVoices((v) => v.layer === layer)
    this.pushConfig()
  }

  setOrganLayerEnabled(layer: 'A' | 'B', enabled: boolean): void {
    this.organ.layers[layer].enabled = enabled
    if (!enabled) this.stopSectionVoices((v) => v.layer === `organ${layer}`)
    this.pushConfig()
  }

  setSynthLayerEnabled(layer: 'A' | 'B' | 'C', enabled: boolean): void {
    this.synth.layers[layer].enabled = enabled
    if (!enabled) this.stopSectionVoices((v) => v.layer === `synth${layer}`)
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

  // ------------------------------------------------------------ programs

  /** Current full program state snapshot (the canonical schema). */
  getProgramState(): ProgramState {
    return {
      piano: {
        sectionOn: this.sectionOn,
        focusLayer: this.focusedLayer,
        layers: {
          pianoA: { ...this.layers.pianoA },
          pianoB: { ...this.layers.pianoB },
        },
        perf: { ...this.perf },
      },
      organ: JSON.parse(JSON.stringify(this.organ)) as OrganState,
      synth: JSON.parse(JSON.stringify(this.synth)) as SynthState,
      effects: JSON.parse(JSON.stringify(this.effects)) as EffectsState,
      split: JSON.parse(JSON.stringify(this.split)) as SplitState,
      scene: this.scene,
      morphs: JSON.parse(JSON.stringify(this.morphs)) as MorphState,
      clock: { ...this.clock },
      transpose: this.transpose,
    }
  }

  /** Apply a stored program state (replaces the live state). */
  applyProgramState(state: ProgramState): void {
    const s = cloneProgramState(state)
    this.sectionOn = s.piano.sectionOn
    this.focusedLayer = s.piano.focusLayer
    this.layers.pianoA = { ...s.piano.layers.pianoA, id: 'pianoA' }
    this.layers.pianoB = { ...s.piano.layers.pianoB, id: 'pianoB' }
    Object.assign(this.perf, s.piano.perf)
    this.organ.sectionOn = s.organ.sectionOn
    this.organ.focusLayer = s.organ.focusLayer
    this.organ.layers.A = s.organ.layers.A
    this.organ.layers.B = s.organ.layers.B
    this.synth.sectionOn = s.synth.sectionOn
    this.synth.focusLayer = s.synth.focusLayer
    this.synth.layers.A = s.synth.layers.A
    this.synth.layers.B = s.synth.layers.B
    this.synth.layers.C = s.synth.layers.C
    this.effects.chains = s.effects.chains
    this.effects.rotary = s.effects.rotary
    this.effects.allOn = s.effects.allOn
    this.effects.focusSection = s.effects.focusSection
    this.effects.focusLayer = s.effects.focusLayer
    this.effects.pianoGroup = s.effects.pianoGroup
    this.effects.synthGroup = s.effects.synthGroup
    this.split = s.split
    this.scene = s.scene
    this.sceneMemory = { I: null, II: null }
    this.morphs = s.morphs
    this.clock = s.clock
    this.transpose = s.transpose
    this.allNotesOff()
    this.pushConfig()
  }

  /** True when the live state differs from the loaded slot (the E indicator). */
  isDirty(): boolean {
    if (this.loadedSnapshot === null) return false
    return serializeProgramState(this.getProgramState()) !== this.loadedSnapshot
  }

  /** Re-baseline the dirty check at the current state (panel reflection, not a user edit). */
  adoptSnapshot(): void {
    this.loadedSnapshot = serializeProgramState(this.getProgramState())
  }

  /** Display position, e.g. "3.2", plus name (manual p. 13). */
  getProgramLabel(): string {
    if (this.liveMode) return `Live ${this.currentLiveSlot + 1}`
    const slot = this.currentSlot ?? 0
    return `${Math.floor(slot / SLOTS_PER_PAGE) + 1}.${(slot % SLOTS_PER_PAGE) + 1}`
  }

  /** Load a slot (regular or live). Discards edits unless already stored. */
  loadSlot(index: number, opts: { discard?: boolean } = {}): void {
    if (!opts.discard && this.isDirty()) {
      // Edits are discarded on program change (manual p. 13); keep undo.
      this.undoSnapshot = {
        slot: this.currentSlot,
        liveSlot: this.currentLiveSlot,
        liveMode: this.liveMode,
        name: this.currentName,
        state: this.getProgramState(),
      }
    } else {
      this.undoSnapshot = null
    }
    const stored = this.liveMode ? this.bank.getLive(index) : this.bank.get(index)
    if (this.liveMode) this.currentLiveSlot = index
    else {
      this.currentSlot = index
      this.page = Math.floor(index / SLOTS_PER_PAGE)
    }
    this.currentName = stored.name
    this.applyProgramState(stored.state)
    this.loadedSnapshot = serializeProgramState(this.getProgramState())
    this.events.onStateChanged?.()
    this.uiNotifier?.()
  }

  /** Select a program button (1..8) on the current page, or a Live slot in Live Mode. */
  selectProgramButton(n: number): void {
    const idx = Math.min(SLOTS_PER_PAGE - 1, Math.max(0, n - 1))
    if (this.liveMode) this.loadSlot(idx)
    else this.loadSlot(this.page * SLOTS_PER_PAGE + idx)
  }

  /** Page navigation (wraps 1..4). */
  setPage(page: number): void {
    this.page = ((page % 4) + 4) % 4
    this.events.onStateChanged?.()
    this.uiNotifier?.()
  }

  /** Dial browsing: step through all 32 slots (or 8 live slots). */
  browse(delta: number): void {
    const count = this.liveMode ? LIVE_SLOTS : PROGRAM_SLOTS
    const cur = this.liveMode ? this.currentLiveSlot : (this.currentSlot ?? 0)
    const next = (((cur + delta) % count) + count) % count
    this.loadSlot(next)
  }

  /** Toggle the numeric list view (Shift + Program dial). */
  setListView(on: boolean): void {
    this.listView = on
    this.events.onStateChanged?.()
    this.uiNotifier?.()
  }

  /** Store the current state into a slot (Store confirm / Store As). */
  storeTo(index: number, name?: string): void {
    const finalName = (name ?? this.currentName).slice(0, 12) || 'Init'
    if (this.liveMode) {
      this.bank.setLive(index, finalName, this.getProgramState())
      this.currentLiveSlot = index
    } else {
      this.bank.set(index, finalName, this.getProgramState())
      this.currentSlot = index
      this.page = Math.floor(index / SLOTS_PER_PAGE)
    }
    this.currentName = finalName
    this.loadedSnapshot = serializeProgramState(this.getProgramState())
    this.events.onStateChanged?.()
    this.uiNotifier?.()
  }

  /** Copy the currently-loaded program into the other bank (Live ↔ regular, manual p. 13/44). */
  copyCurrentTo(target: { live: number } | { slot: number }, name?: string): void {
    const finalName = (name ?? this.currentName).slice(0, 12) || 'Init'
    if ('live' in target) this.bank.setLive(target.live, finalName, this.getProgramState())
    else this.bank.set(target.slot, finalName, this.getProgramState())
    this.events.onStateChanged?.()
    this.uiNotifier?.()
  }

  /** Live Mode toggle: switches the 8 program buttons to auto-storing Live slots. */
  setLiveMode(on: boolean): void {
    if (this.liveMode === on) return
    this.liveMode = on
    this.loadSlot(on ? this.currentLiveSlot : (this.currentSlot ?? 0), { discard: true })
    this.events.onStateChanged?.()
    this.uiNotifier?.()
  }

  /** Auto-store after any edit while in Live Mode. */
  private autoStoreLive(): void {
    if (!this.liveMode) return
    this.bank.setLive(this.currentLiveSlot, this.currentName, this.getProgramState())
    this.loadedSnapshot = serializeProgramState(this.getProgramState())
  }

  /** Single-level undo of the last program change from an edited state (optional). */
  undoProgramChange(): boolean {
    if (!this.undoSnapshot) return false
    const u = this.undoSnapshot
    this.undoSnapshot = null
    this.liveMode = u.liveMode
    this.currentSlot = u.slot
    this.currentLiveSlot = u.liveSlot
    this.currentName = u.name
    this.applyProgramState(u.state)
    this.loadedSnapshot = serializeProgramState(this.getProgramState())
    return true
  }

  hasUndo(): boolean {
    return this.undoSnapshot !== null
  }

  // ------------------------------------------------- scenes / morphs / clock

  /** Switch Layer Scene I/II: swaps only layer enable state (manual p. 43). */
  setScene(scene: 'I' | 'II'): void {
    if (this.scene === scene) return
    // Stash current enables in the outgoing scene's memory, restore the
    // incoming scene's. Sound parameters are untouched.
    this.sceneMemory[this.scene] = this.currentEnables()
    this.scene = scene
    const mem = this.sceneMemory[scene]
    if (mem) this.applyEnables(mem)
    this.pushConfig()
  }

  private currentEnables(): LayerEnables {
    return {
      pianoA: this.layers.pianoA.enabled,
      pianoB: this.layers.pianoB.enabled,
      organA: this.organ.layers.A.enabled,
      organB: this.organ.layers.B.enabled,
      synthA: this.synth.layers.A.enabled,
      synthB: this.synth.layers.B.enabled,
      synthC: this.synth.layers.C.enabled,
    }
  }

  private applyEnables(mem: LayerEnables): void {
    for (const id of ['pianoA', 'pianoB'] as const) if (this.layers[id].enabled !== mem[id]) this.setLayerEnabled(id, mem[id])
    for (const id of ['A', 'B'] as const) {
      const key = `organ${id}` as const
      if (this.organ.layers[id].enabled !== mem[key]) {
        this.organ.layers[id].enabled = mem[key]
        if (!mem[key]) this.stopSectionVoices((v) => v.layer === key)
      }
    }
    for (const id of ['A', 'B', 'C'] as const) {
      const key = `synth${id}` as const
      if (this.synth.layers[id].enabled !== mem[key]) {
        this.synth.layers[id].enabled = mem[key]
        if (!mem[key]) this.stopSectionVoices((v) => v.layer === key)
      }
    }
  }

  /** Assign (or update) a morph destination for a source. */
  assignMorph(source: MorphSource, controlId: string, from: number, to: number): boolean {
    if (!isMorphableControl(controlId)) return false
    const list = this.morphs[source]
    const existing = list.find((a) => a.controlId === controlId)
    if (from === to) {
      // Zeroing removes the single assignment (manual p. 39).
      if (existing) this.morphs[source] = list.filter((a) => a !== existing)
    } else if (existing) {
      existing.from = from
      existing.to = to
    } else {
      list.push({ controlId, from, to })
    }
    this.pushConfig()
    return true
  }

  /** Clear every assignment of one morph source (Shift + source button). */
  clearMorph(source: MorphSource): void {
    this.morphs[source] = []
    this.pushConfig()
  }

  /** Move a morph source; returns the interpolated destinations to apply. */
  setMorphPosition(source: MorphSource, pos: number): { controlId: string; value: number }[] {
    const p = Math.min(1, Math.max(0, pos))
    this.morphPositions[source] = p
    const out: { controlId: string; value: number }[] = []
    for (const a of this.morphs[source]) out.push({ controlId: a.controlId, value: morphValue(a, p) })
    this.events.onStateChanged?.()
    return out
  }

  /** Controls with an active assignment on any source (green morph LEDs). */
  morphAssignedControls(): Set<string> {
    const s = new Set<string>()
    for (const src of ['wheel', 'ctrlPedal'] as const) for (const a of this.morphs[src]) s.add(a.controlId)
    return s
  }

  /** Master clock: set BPM (hold MST CLK + dial). */
  setBpm(bpm: number): void {
    this.clock.bpm = Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(bpm)))
    this.pushConfig()
  }

  /** Master clock tap: feed tap times; ≥4 taps sets BPM (manual p. 40). */
  private tapTimes: number[] = []
  tapMasterClock(nowMs: number): void {
    this.tapTimes.push(nowMs)
    if (this.tapTimes.length > 4) this.tapTimes.shift()
    if (this.tapTimes.length >= 4) {
      // Average of the last three intervals.
      const ts = this.tapTimes
      const avg = (ts[3] - ts[0]) / 3
      if (avg > 0) this.setBpm(60000 / avg)
    }
    this.events.onStateChanged?.()
    this.uiNotifier?.()
  }

  setTranspose(semis: number): void {
    this.transpose = Math.max(-TRANSPOSE_RANGE, Math.min(TRANSPOSE_RANGE, Math.round(semis)))
    this.pushConfig()
  }

  /** Panic (Shift+Transpose / PANIC): All Notes Off + reset held inputs. */
  panic(): void {
    this.allNotesOff()
    this.sustainDown = false
    this.arpHeldNotes = { A: [], B: [], C: [] }
    this.tapTimes = []
    this.events.onStateChanged?.()
    this.uiNotifier?.()
  }

  /** Held notes for the arpeggiator pool of a synth layer. */
  getArpNotes(layer: 'A' | 'B' | 'C'): readonly number[] {
    return this.arpHeldNotes[layer]
  }

  // ------------------------------------------------------------- config

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
      organ: this.organ,
      synth: this.synth,
      split: this.split,
      clock: this.clock,
      transpose: this.transpose,
      morphPositions: this.morphPositions,
      arpNotes: { A: [...this.arpHeldNotes.A], B: [...this.arpHeldNotes.B], C: [...this.arpHeldNotes.C] },
    }
  }

  private pushConfig(): void {
    this.backend.configure?.(this.getConfig())
    this.autoStoreLive()
    this.events.onStateChanged?.()
    this.uiNotifier?.()
  }

  /** UI subscription seam (set by the App shell; called on every state push). */
  private uiNotifier: (() => void) | null = null
  setUiNotifier(fn: (() => void) | null): void {
    this.uiNotifier = fn
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

  /**
   * Route a played note to its layers: every enabled layer of every active
   * section whose zone assignment covers the note starts a voice. Piano
   * keeps the Phase 2 focus contract (only the focused piano layer sounds).
   */
  private routeNote(note: number): { layer: RoutableLayerId; gain: number; zoneIndex: number }[] {
    const out: { layer: RoutableLayerId; gain: number; zoneIndex: number }[] = []
    if (!inRange(note)) return out
    const zoneIndex = this.split.on ? zoneOfNoteSafe(this.split, note) : 0
    const add = (layer: RoutableLayerId, enabled: boolean) => {
      if (!enabled) return
      const g = zoneGain(this.split, layer, note)
      if (g > 0) out.push({ layer, gain: g, zoneIndex })
    }
    if (this.sectionOn) {
      // Phase 2 contract: the focused piano layer owns new notes.
      add(this.focusedLayer, this.layers[this.focusedLayer].enabled)
    }
    if (this.organ.sectionOn) {
      add('organA', this.organ.layers.A.enabled)
      add('organB', this.organ.layers.B.enabled)
    }
    if (this.synth.sectionOn) {
      add('synthA', this.synth.layers.A.enabled)
      add('synthB', this.synth.layers.B.enabled)
      add('synthC', this.synth.layers.C.enabled)
    }
    return out
  }

  noteOn(note: number, velocity: number) {
    if (this.status === 'error') return
    if (!inRange(note)) return
    const vel = clamp01(velocity)
    const routes = this.routeNote(note)
    if (routes.length === 0) {
      // Still track the hold so overlapping-note semantics stay consistent.
      this.held.set(note, (this.held.get(note) ?? 0) + 1)
      return
    }
    for (const route of routes) {
      const layer = route.layer
      if (layer === 'synthA' || layer === 'synthB' || layer === 'synthC') {
        const lid = layer.slice(-1) as 'A' | 'B' | 'C'
        const sl = this.synth.layers[lid]
        if (sl.voiceMode > 0) {
          // Mono/legato: one voice per layer; the render side glides from the
          // previous note when the mode calls for it.
          this.stopSectionVoices((v) => v.layer === layer)
        }
        if (!this.arpHeldNotes[lid].includes(note)) this.arpHeldNotes[lid].push(note)
      }
      // Deterministic stealing within the layer: steal the oldest released voice first, else the oldest voice.
      if (this.voices.filter((v) => !v.stopped && v.layer === layer).length >= MAX_VOICES) {
        const victim = pickStealVictim(this.voices.filter((v) => v.layer === layer))
        if (victim) {
          this.backend.stopVoice(victim.id)
          victim.stopped = true
        }
      }
      // Crossfade gain rides the voice velocity so the backend's captured
      // events carry it (crossfades fade sounds across the window, p. 39).
      const handle = this.backend.startVoice(note, vel * route.gain, layer)
      const voice: Voice = { id: handle, note, velocity: vel * route.gain, startedAt: this.backend.now(), releasedAt: null, stopped: false, layer, zoneGain: route.gain }
      this.voices.push(voice)
    }
    this.voices = this.voices.filter((v) => !v.stopped)
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
    // Arp hold: notes keep sounding / the arp keeps running after lift.
    for (const lid of ['A', 'B', 'C'] as const) {
      const sl = this.synth.layers[lid]
      if (!sl.arpHold) this.arpHeldNotes[lid] = this.arpHeldNotes[lid].filter((n) => n !== note)
    }
    let changed = false
    for (const v of this.voices) {
      if (v.note === note && !v.stopped && v.releasedAt === null) {
        if (this.sustainDown && this.sustainPedalFor(v.layer)) {
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

  private sustainPedalFor(layer: RoutableLayerId): boolean {
    if (layer === 'pianoA' || layer === 'pianoB') return this.layers[layer].sustainPedal
    if (layer === 'organA') return this.organ.layers.A.sustainPedal
    if (layer === 'organB') return this.organ.layers.B.sustainPedal
    return this.synth.layers[layer.slice(-1) as 'A' | 'B' | 'C'].sustainPedal
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

function zoneOfNoteSafe(split: SplitState, note: number): number {
  const edges = activeSplitMidis(split)
  let zone = 0
  for (const edge of edges) if (note >= edge) zone++
  return zone
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

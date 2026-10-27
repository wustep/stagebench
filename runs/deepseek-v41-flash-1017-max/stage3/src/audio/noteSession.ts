/**
 * The one note lifecycle every input source feeds.
 *
 * Pointer, touch, computer keyboard and Web MIDI all call `press`/`release` here, so there
 * is exactly one place that decides whether a voice starts, is re-struck, is sustained, is
 * stolen, or is cleaned up.
 *
 * Phase 2 added layer ownership. Phase 3 extends it to all three engines — one key press can
 * start up to two Piano voices, two Organ voices and three Synth voices — and adds the
 * performance layer on top:
 *
 *  - **Splits and zones**: a layer sounds only inside the zones it is assigned to, at the
 *    crossfade gain for that note.
 *  - **Scenes**: the active layer scene decides which layers are enabled, without touching
 *    any sound parameter.
 *  - **Transpose**: applied to the sounding pitch, never to the key the panel shows.
 *  - **Synth voice modes**: poly, mono and legato with note priority and glide, so the synth
 *    layer sounds one voice at a time when it is told to.
 *  - **Arpeggiator / gate**: a deterministic step clock over the held synth notes.
 *
 * Every Phase 1 and Phase 2 behaviour is preserved: the same public surface, the same
 * duplicate/re-strike rules, and the same deterministic oldest-first stealing now applied
 * per layer.
 */
import type {
  AudioEngine,
  AudioStatusReport,
  LayerId,
  OrganVoiceRequest,
  SynthVoiceRequest,
  VoiceHandle,
  VoiceSettings,
} from './types'
import { ALL_LAYERS } from './types'
import type { Clock } from './clock'
import { clampVelocity } from './pianoModel'
import type { PianoLayerId, PianoState } from './pianoState'
import { voiceParamsFor } from './pianoState'
import type { OrganLayerId, OrganState } from './organState'
import type { SynthLayerId, SynthState } from './synthState'
import type { ProgramState } from './programState'
import { layerGainForNote, zoneIndexForNote } from './programState'
import { envelopeFromDials, planArp, priorityNote, stepSecondsFor } from './synthModel'

export const MAX_POLYPHONY = 16

export type NoteSource = 'pointer' | 'keyboard' | 'midi'

export interface VoiceState {
  id: string
  midi: number
  velocity: number
  /** Layer that owns this voice. */
  layer: LayerId
  /** The sounding pitch after octave shift and transpose. */
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
  /** Gain from the layer's split zoning, 0..1. */
  zoneGain: number
  settings: VoiceSettings
}

export interface EngineVoiceCounts {
  piano: number
  organ: number
  synth: number
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
  /** Voices per piano layer, so layer ownership is directly observable. */
  byLayer: Record<PianoLayerId, number>
  /** Voices per engine. */
  byEngine: EngineVoiceCounts
  /** Voices per layer, for every layer of every engine. */
  byAnyLayer: Record<LayerId, number>
  /** The arpeggiator's current step, for the display and the tests. */
  arpStep: number
  /** True while the arpeggiator clock is running. */
  arpRunning: boolean
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
  /** The whole program state, for organ/synth routing, splits, scenes and transpose. */
  programState?: () => ProgramState | null
  /** Organ state, when a caller drives the organ on its own. */
  organState?: () => OrganState | null
  /** Synth state, when a caller drives the synth on its own. */
  synthState?: () => SynthState | null
  /** The mod wheel position, which drives the Wheel vibrato source. */
  modWheel?: () => number
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
  setSustainRouting(layer: LayerId, enabled: boolean): void
  /** Stops every voice one layer owns, e.g. when the layer is switched off mid-note. */
  releaseLayer(layer: LayerId): void
  /**
   * Re-evaluates which layers are sounding after a scene, zone or enable change. Voices on
   * layers that should no longer sound are ended; layers that should now sound are started
   * for the keys still held.
   */
  refreshRouting(): void
  /** Every voice stops: blur, MIDI disconnect, panic, unmount. */
  allNotesOff(reason: string): void
  /** Starts or stops the arpeggiator clock (ARP RUN). */
  setArpRun(running: boolean): void
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

/** Voice map key: one entry per (layer, note), so every layer on a key is independent. */
const key = (layer: LayerId, midi: number) => `${layer}:${midi}`

function unique(values: number[]): number[] {
  return Array.from(new Set(values)).toSorted((a, b) => a - b)
}

function emptyLayerCounts(): Record<LayerId, number> {
  const counts = {} as Record<LayerId, number>
  for (const layer of ALL_LAYERS) counts[layer] = 0
  return counts
}

export function createPianoSession(options: PianoSessionOptions): PianoSession {
  const { engine, clock, lowestMidi, highestMidi } = options
  const maxPolyphony = options.maxPolyphony ?? MAX_POLYPHONY
  const readPianoState = options.pianoState ?? null
  const readProgramState = options.programState ?? null
  const readOrganState = options.organState ?? null
  const readSynthState = options.synthState ?? null
  const readModWheel = options.modWheel ?? (() => 0)

  /** Voices keyed by layer + midi, so every layer on the same key is independent. */
  const voices = new Map<string, VoiceState>()
  const pedalOwners = new Set<string>()
  /** Per-layer sustain: SUSTPED decides whether the pedal holds a layer's notes. */
  const pedalHolds = {} as Record<LayerId, boolean>
  for (const layer of ALL_LAYERS) pedalHolds[layer] = true
  const listeners = new Set<(snapshot: PianoSnapshot) => void>()
  let audio: AudioStatusReport = engine.status()
  let nextVoiceId = 1
  let order = 0
  let stolen = 0
  let disposed = false
  let lastReason: string | null = null
  let started = false
  /** Keys currently held, so a routing change can re-evaluate them. */
  const heldKeys = new Map<number, { velocity: number; owners: Set<string>; sources: Set<NoteSource> }>()

  // ---- arpeggiator ----------------------------------------------------
  let arpRunning = false
  let arpTimer: number | null = null
  let arpStep = 0
  /** The notes the arpeggiator is walking, frozen while KB HOLD keeps them sounding. */
  let arpHeld: number[] = []
  let arpHold = false

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
    const byAnyLayer = emptyLayerCounts()
    const byEngine: EngineVoiceCounts = { piano: 0, organ: 0, synth: 0 }
    for (const v of list) {
      byAnyLayer[v.layer] += 1
      if (v.layer.startsWith('piano')) byLayer[v.layer as PianoLayerId] += 1
      if (v.layer.startsWith('organ')) byEngine.organ += 1
      else if (v.layer.startsWith('synth')) byEngine.synth += 1
      else byEngine.piano += 1
    }
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
      byEngine,
      byAnyLayer,
      arpStep,
      arpRunning,
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
  function stealIfNeeded(layer: LayerId): void {
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

  /* ---------------------------------------------------------------- */
  /* Routing                                                          */
  /* ---------------------------------------------------------------- */

  /** The program state, which carries splits, scenes, transpose and the clock. */
  function program(): ProgramState | null {
    return readProgramState?.() ?? null
  }

  /**
   * The layers that should sound `midi`, with the gain each one gets from splits, scenes and
   * section/layer enable state. Order is stable: piano, then organ, then synth.
   */
  function layersFor(midi: number): Array<{ layer: LayerId; gain: number }> {
    const state = program()
    const piano = readPianoState?.() ?? state?.piano ?? null
    const organ = readOrganState?.() ?? state?.organ ?? null
    const synth = readSynthState?.() ?? state?.synth ?? null
    const out: Array<{ layer: LayerId; gain: number }> = []

    if (!state) {
      // Phase 1 form: a single default layer, no routing at all.
      return pianoStateLayers(piano).map((entry) => ({ layer: entry.layer, gain: 1 }))
    }

    const zone = zoneIndexForNote(state.split, midi, lowestMidi, highestMidi)
    void zone

    // A layer sounds a note when the gain its zones produce is above zero. That single test
    // covers three cases at once: the note is inside an assigned zone, the note is inside a
    // crossfade band belonging to an assigned zone, and the note is outside every assigned
    // zone. Filtering by "the note's zone index is assigned" first would be wrong, because a
    // crossfaded layer sounds notes in the *neighbouring* zone as well.
    if (piano && piano.sectionOn) {
      for (const layer of ['piano.a', 'piano.b'] as PianoLayerId[]) {
        if (!piano.layers[layer].enabled) continue
        const gain = layerGainForNote(state.split, layer, midi, lowestMidi, highestMidi)
        if (gain <= 0) continue
        out.push({ layer, gain })
      }
    }
    if (organ && organ.sectionOn) {
      for (const layer of ['organ.a', 'organ.b'] as OrganLayerId[]) {
        if (!organ.layers[layer].enabled) continue
        const gain = layerGainForNote(state.split, layer, midi, lowestMidi, highestMidi)
        if (gain <= 0) continue
        out.push({ layer, gain })
      }
    }
    if (synth && synth.sectionOn) {
      for (const layer of ['synth.a', 'synth.b', 'synth.c'] as SynthLayerId[]) {
        if (!synth.layers[layer].enabled) continue
        const gain = layerGainForNote(state.split, layer, midi, lowestMidi, highestMidi)
        if (gain <= 0) continue
        out.push({ layer, gain })
      }
    }
    return out
  }

  /** Phase 1's rule: only the piano layers, and only when a piano state was supplied. */
  function pianoStateLayers(piano: PianoState | null): Array<{ layer: PianoLayerId }> {
    if (!piano) return [{ layer: 'piano.a' }]
    if (!piano.sectionOn) return []
    return (['piano.a', 'piano.b'] as PianoLayerId[])
      .filter((id) => piano.layers[id].enabled)
      .map((layer) => ({ layer }))
  }

  /** The octave a layer's voices are shifted by. */
  function octaveFor(layer: LayerId): number {
    const state = program()
    if (layer.startsWith('piano')) {
      const piano = readPianoState?.() ?? state?.piano ?? null
      return piano?.layers[layer as PianoLayerId].octave ?? 0
    }
    if (layer.startsWith('organ')) {
      const organ = readOrganState?.() ?? state?.organ ?? null
      return organ?.layers[layer as OrganLayerId].octave ?? 0
    }
    const synth = readSynthState?.() ?? state?.synth ?? null
    const layerState = synth?.layers[layer as SynthLayerId]
    return (layerState?.octave ?? 0) + (layerState?.coarse ?? 0)
  }

  /** Transpose, applied only when TRANSP ON is engaged. */
  function transposeFor(): number {
    const state = program()
    if (!state || !state.transposeOn) return 0
    return Math.max(-6, Math.min(6, Math.round(state.transpose)))
  }

  function organRequest(layer: OrganLayerId, gain: number): OrganVoiceRequest | undefined {
    const state = program()
    const organ = readOrganState?.() ?? state?.organ ?? null
    if (!organ) return undefined
    const layerState = organ.layers[layer]
    return {
      vibratoOn: layerState.vibratoOn,
      vibratoType: layerState.vibratoType,
      percussion: { ...layerState.percussion },
      keyClick: layerState.keyClick,
      zoneGain: gain,
    }
  }

  /** LFO rate in Hz, resolved through the master clock when the layer is synced. */
  function lfoRateFor(layer: SynthLayerId): number {
    const state = program()
    const synth = readSynthState?.() ?? state?.synth ?? null
    const config = synth?.layers[layer]?.lfo
    if (!config) return 4
    // The Rate knob 0..10 maps to 0.05..18 Hz, or to a clock division when synced.
    const free = 0.05 * Math.pow(18 / 0.05, Math.min(10, Math.max(0, config.rate)) / 10)
    if (!config.clockSync) return free
    const bpm = state?.clock.bpm ?? 120
    // Synced, the knob selects a clock division from 1/1 to 1/16.
    const subdivision = Math.pow(2, Math.round(Math.min(10, Math.max(0, config.rate)) / 10 * 4))
    return bpm / 60 / subdivision
  }

  function synthRequest(layer: SynthLayerId, gain: number, holdSeconds: number): SynthVoiceRequest | undefined {
    const state = program()
    const synth = readSynthState?.() ?? state?.synth ?? null
    if (!synth) return undefined
    const layerState = synth.layers[layer]
    const previous = lastMonoNote
    const modes = layerState.voiceMode
    const glideFrom =
      modes !== 'Poly' && layerState.glide > 0 && previous !== null ? previous : null
    return {
      holdSeconds,
      // The release tail the amp envelope should render. It comes from the same helper the
      // renderer uses for the envelope itself, so the dial and the buffer length cannot drift.
      releaseSeconds: Math.max(
        0.05,
        Math.min(4, envelopeFromDials(layerState.ampEnv.attack, layerState.ampEnv.decay, layerState.ampEnv.release).release),
      ),
      glideFrom,
      modWheel: readModWheel(),
      lfoRateHz: lfoRateFor(layer),
      zoneGain: gain,
    }
  }

  /** The last note a mono or legato synth layer sounded, for glide. */
  let lastMonoNote: number | null = null

  /* ---------------------------------------------------------------- */
  /* Press / release                                                  */
  /* ---------------------------------------------------------------- */

  function press(request: NoteOnRequest): void {
    if (disposed) return
    const { midi, source, owner } = request
    if (!Number.isInteger(midi) || midi < lowestMidi || midi > highestMidi) return
    startAudioIfNeeded()

    const velocity = clampVelocity(request.velocity)
    const tracked = heldKeys.get(midi)
    if (tracked) {
      tracked.owners.add(owner)
      tracked.sources.add(source)
    } else {
      heldKeys.set(midi, { velocity, owners: new Set([owner]), sources: new Set([source]) })
    }

    const state = program()
    const transpose = transposeFor()

    // The arpeggiator, when running, does not sound the note directly: it collects it and
    // walks the held set on its own clock.
    if (state && arpActive(state)) {
      if (!arpHeld.includes(midi)) arpHeld.push(midi)
      arpHold = true
      // A press with the arpeggiator engaged starts its clock, so the first step lands
      // without needing a separate RUN press.
      if (!arpRunning) {
        arpRunning = true
        ensureArpClock()
      }
      emit()
      return
    }

    soundNote(midi, velocity, source, owner, transpose)
    emit()
  }

  /** True when any enabled synth layer is in Arp mode with ARP RUN engaged. */
  function arpActive(state: ProgramState): boolean {
    if (!state.synth.sectionOn) return false
    return (['synth.a', 'synth.b', 'synth.c'] as SynthLayerId[]).some((layer) => {
      const config = state.synth.layers[layer]
      return config.enabled && config.arp.mode === 'Arp' && config.arp.run
    })
  }

  /** Starts the voices for one key across every layer that should sound it. */
  function soundNote(
    midi: number,
    velocity: number,
    source: NoteSource,
    owner: string,
    transpose: number,
  ): void {
    const layers = layersFor(midi)
    if (layers.length === 0) return
    const state = program()
    const synth = readSynthState?.() ?? state?.synth ?? null

    for (const { layer, gain } of layers) {
      // Mono/legato synth layers sound one note at a time: starting a new note ends the old.
      if (layer.startsWith('synth') && synth) {
        const config = synth.layers[layer as SynthLayerId]
        if (config.voiceMode !== 'Poly') {
          for (const existing of Array.from(voices.values())) {
            if (existing.layer === layer) endVoice(existing)
          }
        }
      }
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

      const octave = octaveFor(layer)
      const playedMidi = midi + octave + transpose
      const settings: VoiceSettings =
        layer.startsWith('piano') && (readPianoState?.() ?? state?.piano)
          ? voiceParamsFor((readPianoState?.() ?? state!.piano) as PianoState, layer as PianoLayerId, velocity)
          : defaultSettings(velocity)

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
        zoneGain: gain,
        settings: { ...settings, layer, octave },
      }
      nextVoiceId += 1
      voices.set(voiceKey, voice)
      const handle: VoiceHandle = {
        id: voice.id,
        midi: playedMidi,
        velocity,
        layer,
        settings: voice.settings,
        organSettings: layer.startsWith('organ') ? organRequest(layer as OrganLayerId, gain) : undefined,
        synthSettings: layer.startsWith('synth')
          ? synthRequest(layer as SynthLayerId, gain, 8)
          : undefined,
      }
      if (layer.startsWith('synth')) lastMonoNote = playedMidi
      engine.noteOn(handle)
    }
  }

  function release(source: NoteSource, owner: string, midi: number): void {
    if (disposed) return
    const tracked = heldKeys.get(midi)
    if (tracked && tracked.owners.has(owner)) {
      tracked.owners.delete(owner)
      if (tracked.owners.size === 0) {
        tracked.sources.clear()
        heldKeys.delete(midi)
      }
    } else if (!tracked) {
      // A key the arpeggiator is holding: lifting it removes it from the walk.
      arpHeld = arpHeld.filter((note) => note !== midi)
    }
    for (const layer of ALL_LAYERS) {
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

  /** The panel's SUSTPED toggle, per layer. */
  function setSustainRouting(layer: LayerId, enabled: boolean): void {
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
  function releaseLayer(layer: LayerId): void {
    let changed = false
    for (const voice of Array.from(voices.values())) {
      if (voice.layer !== layer) continue
      endVoice(voice)
      changed = true
    }
    if (changed) emit()
  }

  /**
   * Re-evaluates the held keys after a routing change: layers that should no longer sound a
   * key are ended, and layers that should now sound it are started.
   */
  function refreshRouting(): void {
    if (disposed) return
    let changed = false
    for (const [midi, tracked] of heldKeys) {
      const shouldSound = new Set(layersFor(midi).map((entry) => entry.layer))
      for (const voice of Array.from(voices.values())) {
        if (voice.midi !== midi) continue
        if (!shouldSound.has(voice.layer) && voice.owners.size > 0) {
          endVoice(voice)
          changed = true
          shouldSound.delete(voice.layer)
        } else {
          shouldSound.delete(voice.layer)
        }
      }
      // Anything still in `shouldSound` has no voice yet.
      if (shouldSound.size > 0) {
        const firstOwner = Array.from(tracked.owners)[0]
        const firstSource = (Array.from(tracked.sources)[0] ?? 'pointer') as NoteSource
        if (firstOwner) {
          soundNote(midi, tracked.velocity, firstSource, firstOwner, transposeFor())
          changed = true
        }
      }
    }
    // A layer switched off leaves no voice ringing even if its key is still down.
    const state = program()
    if (state) {
      for (const voice of Array.from(voices.values())) {
        if (voice.owners.size === 0) continue
        if (!layersFor(voice.midi).some((entry) => entry.layer === voice.layer)) {
          endVoice(voice)
          changed = true
        }
      }
    }
    if (changed) emit()
  }

  function allNotesOff(reason: string): void {
    lastReason = reason
    for (const voice of Array.from(voices.values())) {
      voices.delete(key(voice.layer, voice.midi))
      engine.noteOff(voice.id)
    }
    engine.stopAll()
    pedalOwners.clear()
    heldKeys.clear()
    arpHeld = []
    emit()
  }

  /* ---------------------------------------------------------------- */
  /* Arpeggiator                                                      */
  /* ---------------------------------------------------------------- */

  function ensureArpClock(): void {
    if (arpTimer !== null || !arpRunning) return
    scheduleArpStep()
  }

  function scheduleArpStep(): void {
    const state = program()
    if (!state || !arpRunning || disposed) return
    const stepSeconds = arpStepSeconds(state)
    arpTimer = clock.setTimeout(() => {
      arpTimer = null
      if (!arpRunning || disposed) return
      stepArp()
      scheduleArpStep()
    }, Math.max(8, stepSeconds * 1000))
  }

  function arpStepSeconds(state: ProgramState): number {
    // The focused synth layer's arp settings define the shared step rate.
    const layer = state.synth.layers[state.synth.focused] ?? state.synth.layers['synth.a']
    const synced = layer.arp.clockSync && state.clock.sync.arp
    return stepSecondsFor(layer.arp.rate, state.clock.bpm, synced)
  }

  /** Sounds one arpeggiator step from the held (or latched) note set. */
  function stepArp(): void {
    const state = program()
    if (!state) return
    const layer = state.synth.layers[state.synth.focused] ?? state.synth.layers['synth.a']
    if (layer.arp.mode !== 'Arp') return
    const notes = state.synth.layers[state.synth.focused].arp.hold || arpHold ? arpHeld : Array.from(heldKeys.keys())
    if (notes.length === 0) {
      arpHold = false
      emit()
      return
    }
    const stepSeconds = arpStepSeconds(state)
    const octaves = Math.max(1, Math.round((layer.arp.range / 10) * 3) + 1)
    const plan = planArp({
      notes,
      direction: layer.arp.direction,
      octaves,
      stepSeconds,
      totalSteps: Math.max(16, arpHeld.length * octaves * 4),
    })
    const note = plan.notes[arpStep % plan.notes.length]
    const transpose = transposeFor()
    // Every arpeggiated step replaces the previous one, which is what a monosynth-style arp
    // does; the session still owns the voice so cleanup is unchanged.
    for (const voice of Array.from(voices.values())) {
      if (voice.layer.startsWith('synth')) endVoice(voice)
    }
    soundNote(note, 0.8, 'pointer', 'arp', transpose)
    arpStep = (arpStep + 1) % Math.max(1, plan.notes.length)
    emit()
  }

  function setArpRun(running: boolean): void {
    arpRunning = running
    if (!running) {
      if (arpTimer !== null) {
        clock.clearTimeout(arpTimer)
        arpTimer = null
      }
      for (const voice of Array.from(voices.values())) {
        if (voice.layer.startsWith('synth') && voice.owners.has('arp')) endVoice(voice)
      }
      arpStep = 0
      emit()
      return
    }
    // Start running as soon as a note is held, or immediately if notes already are.
    arpRunning = true
    if (heldKeys.size > 0) arpHeld = Array.from(heldKeys.keys())
    ensureArpClock()
    emit()
  }

  return {
    press,
    release,
    releaseOwner,
    setSustain,
    setSustainRouting,
    releaseLayer,
    refreshRouting,
    allNotesOff,
    setArpRun,
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
      if (arpTimer !== null) {
        clock.clearTimeout(arpTimer)
        arpTimer = null
      }
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

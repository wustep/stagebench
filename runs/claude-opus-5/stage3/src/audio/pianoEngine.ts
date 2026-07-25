import { ArpRunner } from './arp'
import { Ramped, RotaryUnit } from './effects'
import type { GraphBuffer, GraphContext, GraphGain, GraphWaveShaper, Scheduler } from './graph'
import { realScheduler } from './graph'
import { PianoLayer, type LayerVoice } from './layer'
import { OrganSection } from './organLayer'
import { pianoType } from './pianoTypes'
import { fillHammerNoise } from './pianoVoice'
import { SampleLibrary, type LoadedSet, type SampleSetId } from './sampleLibrary'
import { SynthLayer, type SynthVoice } from './synthLayer'
import { arpStepsPerSecond, gateShape, syncedHz } from './synthVoice'
import {
  DEFAULT_SETTINGS,
  LAYER_IDS,
  ORGAN_LAYER_IDS,
  SYNTH_LAYER_IDS,
  type EngineSettings,
  type LayerId,
  type LayerKey,
  type OrganLayerId,
  type SynthLayerId,
  type ZoneSettings,
} from './settings'

/** A note instance is owned by the input that started it, so sources never steal each other's notes. */
export type NoteSource = 'pointer' | 'keyboard' | 'midi' | 'ui'

export function noteId(source: NoteSource, key: string | number): string {
  return `${source}:${key}`
}

interface Voice {
  readonly id: string
  readonly key: string
  readonly layerKey: LayerKey
  readonly midi: number
  readonly velocity: number
  readonly startedAt: number
  readonly voice: LayerVoice
  /** True once the key is up but the sustain pedal is still holding the note. */
  sustained: boolean
  releasing: boolean
  reapHandle: number | null
}

export interface PianoEngineOptions {
  readonly maxVoices?: number
  readonly scheduler?: Scheduler
  readonly library?: SampleLibrary | null
  readonly settings?: EngineSettings
}

/** Truthful state of the recorded sample sets — never "ready" unless they really loaded. */
export type SampleSetState = 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable'

export interface SampleReport {
  readonly sets: Readonly<Record<SampleSetId, SampleSetState>>
  /** True when a selected recorded type is playing the synthesised fallback instead. */
  readonly fallbackActive: boolean
  readonly message: string
}

const NOISE_SECONDS = 0.09

/**
 * How much of a note a layer's keyboard zone lets through: 1 inside the zone, 0 outside it, and a
 * cosine-free linear ramp across the crossfade region so ±6 and ±12 fade instead of switching
 * (programs spec, `split.crossfadeBehavior`).
 */
export function zoneGain(zone: ZoneSettings, midi: number): number {
  const lowEdge = zone.low - zone.fadeLow
  const highEdge = zone.high + zone.fadeHigh
  if (midi < lowEdge || midi > highEdge) return 0
  let gain = 1
  if (zone.fadeLow > 0 && midi < zone.low + zone.fadeLow) {
    gain *= Math.min(1, Math.max(0, (midi - lowEdge) / (2 * zone.fadeLow)))
  }
  if (zone.fadeHigh > 0 && midi > zone.high - zone.fadeHigh) {
    gain *= Math.min(1, Math.max(0, (highEdge - midi) / (2 * zone.fadeHigh)))
  }
  return gain
}

/**
 * The whole instrument's audio.
 *
 *   organ A/B ─┐
 *   piano A/B ─┼─ per-layer chains (Mod 1 → Mod 2 → Delay → Amp/EQ → Comp → Reverb) → level
 *   synth A/B/C┘        ├── section bus ─────────────────┐
 *                       └── shared Rotary ───────────────┤
 *                                                        ▼
 *                                 master gain → limiter → destination
 *
 * There is exactly one AudioContext, one destination connection, and one master path; nothing
 * bypasses it. The class keeps its Phase 1/2 name so every inherited test and import still works;
 * `StageEngine` is the name that describes what it now is.
 */
export class StageEngine {
  readonly context: GraphContext
  readonly master: GraphGain
  readonly limiter: GraphWaveShaper
  readonly pianoBus: GraphGain
  readonly organBus: GraphGain
  readonly synthBus: GraphGain
  readonly rotary: RotaryUnit
  private readonly layers: Record<LayerId, PianoLayer>
  /**
   * Organ and Synth layers are built the first time their section is switched on, not at
   * construction. A silent section costs no nodes, which keeps a piano-only program exactly as
   * cheap as it was in Phase 2 — and every layer that is built joins this same context and the
   * same master path.
   */
  private organSection: OrganSection | null = null
  private readonly synths: Partial<Record<SynthLayerId, SynthLayer>> = {}
  private readonly arps: Record<SynthLayerId, ArpRunner>
  private readonly scheduler: Scheduler
  private readonly maxVoices: number
  private readonly voices = new Map<string, Voice>()
  private readonly noiseBuffer: GraphBuffer
  private readonly masterRamp: Ramped
  private readonly busRamp: Ramped
  private readonly library: SampleLibrary | null
  private readonly setStates = new Map<SampleSetId, SampleSetState>()
  /** Keys held per synth layer, newest last — the input to mono priority and the arpeggiator. */
  private readonly synthHeld: Record<SynthLayerId, { key: string; midi: number }[]> = {
    a: [],
    b: [],
    c: [],
  }
  private readonly synthLatched: Record<SynthLayerId, number[]> = { a: [], b: [], c: [] }
  private settings: EngineSettings
  private sustainDown = false
  private voiceCounter = 0
  private arpCounter = 0
  private disposed = false

  /** Called whenever the truthful sample/fallback report changes. */
  onSampleReport: ((report: SampleReport) => void) | null = null

  constructor(context: GraphContext, options: PianoEngineOptions = {}) {
    this.context = context
    this.scheduler = options.scheduler ?? realScheduler
    this.maxVoices = options.maxVoices ?? 32
    this.library = options.library ?? null
    this.settings = options.settings ?? DEFAULT_SETTINGS

    this.master = context.createGain()
    this.masterRamp = new Ramped(this.master.gain, this.settings.masterLevel)
    this.limiter = context.createWaveShaper()
    this.limiter.curve = limiterCurve()
    this.master.connect(this.limiter)
    this.limiter.connect(context.destination)

    this.pianoBus = context.createGain()
    this.busRamp = new Ramped(this.pianoBus.gain, this.settings.sectionOn ? 1 : 0)
    this.pianoBus.connect(this.master)
    this.organBus = context.createGain()
    this.organBus.connect(this.master)
    this.synthBus = context.createGain()
    this.synthBus.connect(this.master)

    this.rotary = new RotaryUnit(context)
    this.rotary.output.connect(this.master)
    this.rotary.update(this.settings.rotary)

    const frames = Math.max(8, Math.floor(context.sampleRate * NOISE_SECONDS))
    this.noiseBuffer = context.createBuffer(1, frames, context.sampleRate)
    fillHammerNoise(this.noiseBuffer.getChannelData(0))

    this.layers = {
      a: new PianoLayer('a', context, this.noiseBuffer, this.settings.layers.a, this.settings.effectsOn),
      b: new PianoLayer('b', context, this.noiseBuffer, this.settings.layers.b, this.settings.effectsOn),
    }
    for (const id of LAYER_IDS) {
      this.layers[id].dryOut.connect(this.pianoBus)
      this.layers[id].rotaryOut.connect(this.rotary.input)
    }

    this.arps = {
      a: new ArpRunner(this.scheduler, (notes, seconds) => this.arpStep('a', notes, seconds)),
      b: new ArpRunner(this.scheduler, (notes, seconds) => this.arpStep('b', notes, seconds)),
      c: new ArpRunner(this.scheduler, (notes, seconds) => this.arpStep('c', notes, seconds)),
    }
    this.syncArps()
    this.syncLibraries()
  }

  /* -------------------------------------------------- settings */

  get current(): EngineSettings {
    return this.settings
  }

  layer(id: LayerId): PianoLayer {
    return this.layers[id]
  }

  /** The Organ section, built on first use. */
  get organ(): OrganSection {
    if (!this.organSection) {
      this.organSection = new OrganSection(
        this.context,
        this.noiseBuffer,
        this.settings.organ,
        this.settings.effectsOn,
      )
      this.organSection.dryOut.connect(this.organBus)
      this.organSection.rotaryOut.connect(this.rotary.input)
    }
    return this.organSection
  }

  /** One synth layer, built on first use. */
  synth(id: SynthLayerId): SynthLayer {
    let layer = this.synths[id]
    if (!layer) {
      layer = new SynthLayer(id, this.context, this.settings.synth.layers[id], this.settings.effectsOn)
      layer.dryOut.connect(this.synthBus)
      layer.rotaryOut.connect(this.rotary.input)
      this.synths[id] = layer
    }
    return layer
  }

  arp(id: SynthLayerId): ArpRunner {
    return this.arps[id]
  }

  applySettings(next: EngineSettings): void {
    if (this.disposed) return
    const previousTranspose = this.settings.transpose
    const previousBend = this.settings.pitchBend
    this.settings = next
    this.masterRamp.set(next.masterLevel, this.context)
    this.busRamp.set(next.sectionOn ? 1 : 0, this.context)
    for (const id of LAYER_IDS) this.layers[id].update(next.layers[id], next.effectsOn)
    if (next.organ.sectionOn || this.organSection) this.organ.update(next.organ, next.effectsOn)
    for (const id of SYNTH_LAYER_IDS) {
      if (!next.synth.sectionOn && !this.synths[id]) continue
      this.synth(id).update(next.synth.layers[id], next.effectsOn, next.synth.sectionOn, next.clock.bpm)
    }
    this.rotary.update(next.rotary)
    this.syncArps()
    this.syncLibraries()
    this.refreshResonance()
    // The pitch stick bends the Synth section: every sounding synth voice is retuned, which is
    // what makes it a bend rather than a setting that only new notes hear.
    if (next.pitchBend !== previousBend) this.applyBend(next.pitchBend)
    // Transpose applies to notes as they start; anything already sounding keeps its pitch, which
    // is what the instrument does too.
    void previousTranspose
  }

  private applyBend(semitones: number): void {
    for (const voice of this.voices.values()) {
      if (!voice.layerKey.startsWith('synth.') || voice.releasing) continue
      const synthVoice = voice.voice as SynthVoice
      if (typeof synthVoice.retune === 'function') synthVoice.retune(voice.midi + semitones, 0)
    }
  }

  private syncArps(): void {
    for (const id of SYNTH_LAYER_IDS) {
      const arp = this.settings.synth.layers[id].arp
      const stepsPerSecond = arp.clockSync
        ? syncedHz(this.settings.clock.bpm, arp.rate)
        : arpStepsPerSecond(arp.rate)
      this.arps[id].setConfig({
        mode: arp.mode,
        run: arp.run && this.settings.synth.sectionOn && this.settings.synth.layers[id].enabled,
        stepsPerSecond,
        range: arp.range,
        direction: arp.direction,
      })
      this.arps[id].setNotes(this.arpNotes(id))
    }
  }

  private arpNotes(id: SynthLayerId): number[] {
    const held = this.synthHeld[id].map((entry) => entry.midi)
    return held.length > 0 ? held : this.synthLatched[id]
  }

  /* -------------------------------------------------- sample library */

  /** Loads whatever recorded sets the current selection needs, and reports honestly. */
  private syncLibraries(): void {
    for (const id of LAYER_IDS) {
      const layer = this.layers[id]
      const type = pianoType(this.settings.layers[id].type)
      if (type.source !== 'recorded' || !type.sampleSet) {
        layer.setLibrary(null)
        continue
      }
      const setId = type.sampleSet
      const ready = this.library?.get(setId) ?? null
      layer.setLibrary(ready)
      if (ready) {
        this.setStates.set(setId, 'ready')
        continue
      }
      if (!this.library) {
        this.setStates.set(setId, 'unavailable')
        continue
      }
      if (this.setStates.get(setId) === 'loading' || this.setStates.get(setId) === 'failed') continue
      this.setStates.set(setId, 'loading')
      void this.library
        .load(setId)
        .then((loaded: LoadedSet) => {
          if (this.disposed) return
          this.setStates.set(setId, 'ready')
          for (const layerId of LAYER_IDS) {
            const layerType = pianoType(this.settings.layers[layerId].type)
            if (layerType.sampleSet === setId) this.layers[layerId].setLibrary(loaded)
          }
          this.report()
        })
        .catch(() => {
          if (this.disposed) return
          this.setStates.set(setId, 'failed')
          this.report()
        })
    }
    this.report()
  }

  sampleReport(): SampleReport {
    const sets: Record<SampleSetId, SampleSetState> = {
      grand: this.setStates.get('grand') ?? 'idle',
      upright: this.setStates.get('upright') ?? 'idle',
      electric: this.setStates.get('electric') ?? 'idle',
    }
    const fallbackActive = LAYER_IDS.some((id) => {
      const type = pianoType(this.settings.layers[id].type)
      return (
        this.settings.layers[id].enabled && type.source === 'recorded' && !this.layers[id].playsRecordedSamples
      )
    })
    const failed = Object.entries(sets)
      .filter(([, state]) => state === 'failed')
      .map(([id]) => id)
    const unavailable = Object.values(sets).some((state) => state === 'unavailable')
    let message = 'Recorded sample sets ready.'
    if (failed.length > 0) {
      message = `Sample set${failed.length > 1 ? 's' : ''} ${failed.join(', ')} failed to load — playing the labelled synthesised fallback voice.`
    } else if (unavailable && fallbackActive) {
      message = 'No sample assets in this environment — playing the labelled synthesised fallback voice.'
    } else if (fallbackActive) {
      message = 'Loading recorded samples — the labelled synthesised fallback voice is playing meanwhile.'
    }
    return { sets, fallbackActive, message }
  }

  private report(): void {
    this.onSampleReport?.(this.sampleReport())
  }

  /* -------------------------------------------------- voices */

  get activeVoiceCount(): number {
    return this.voices.size
  }

  get soundingVoiceCount(): number {
    let count = 0
    for (const voice of this.voices.values()) if (!voice.releasing) count += 1
    return count
  }

  get sustainedVoiceCount(): number {
    let count = 0
    for (const voice of this.voices.values()) if (voice.sustained) count += 1
    return count
  }

  get sustainEngaged(): boolean {
    return this.sustainDown
  }

  /** MIDI note numbers currently sounding, ascending — used for the on-screen key highlight. */
  soundingNotes(): number[] {
    const notes = new Set<number>()
    for (const voice of this.voices.values()) if (!voice.releasing) notes.add(voice.midi)
    return [...notes].sort((a, b) => a - b)
  }

  noteOn(id: string, midi: number, velocity = 0.8): void {
    if (this.disposed) return
    const clampedVelocity = Math.min(1, Math.max(0.01, velocity))
    const played = midi + this.settings.transpose

    if (this.settings.sectionOn) {
      for (const layerId of LAYER_IDS) {
        if (!this.settings.layers[layerId].enabled) continue
        const gain = zoneGain(this.settings.zones[`piano.${layerId}` as LayerKey], midi)
        if (gain <= 0) continue
        this.start(`${id}#piano.${layerId}`, `piano.${layerId}`, id, played, clampedVelocity, () =>
          this.layers[layerId].buildVoice(played, clampedVelocity, gain),
        )
      }
    }

    if (this.settings.organ.sectionOn) {
      const percussionAllowed = !this.hasSoundingOrganVoice()
      for (const layerId of ORGAN_LAYER_IDS) {
        if (!this.settings.organ.layers[layerId].enabled) continue
        const gain = zoneGain(this.settings.zones[`organ.${layerId}` as LayerKey], midi)
        if (gain <= 0) continue
        this.start(`${id}#organ.${layerId}`, `organ.${layerId}`, id, played, clampedVelocity, () =>
          this.organ.buildVoice(layerId, played, clampedVelocity, percussionAllowed, gain),
        )
      }
    }

    if (this.settings.synth.sectionOn) {
      for (const layerId of SYNTH_LAYER_IDS) {
        if (!this.settings.synth.layers[layerId].enabled) continue
        const gain = zoneGain(this.settings.zones[`synth.${layerId}` as LayerKey], midi)
        if (gain <= 0) continue
        this.synthNoteOn(layerId, id, played, clampedVelocity, gain)
      }
    }

    this.refreshResonance()
  }

  noteOff(id: string): void {
    for (const layerKey of ['piano.a', 'piano.b', 'organ.a', 'organ.b'] as const) {
      const voice = this.voices.get(`${id}#${layerKey}`)
      if (!voice) continue
      if (this.sustainDown && this.sustainRoutedTo(layerKey)) {
        voice.sustained = true
        continue
      }
      this.release(voice, voice.voice.releaseSeconds)
    }
    for (const layerId of SYNTH_LAYER_IDS) this.synthNoteOff(layerId, id)
    this.refreshResonance()
  }

  private sustainRoutedTo(layerKey: LayerKey): boolean {
    if (layerKey === 'piano.a' || layerKey === 'piano.b') {
      return this.settings.layers[layerKey.slice(-1) as LayerId].sustainPedal
    }
    if (layerKey === 'organ.a' || layerKey === 'organ.b') {
      return this.settings.organ.layers[layerKey.slice(-1) as OrganLayerId].sustainPedal
    }
    return this.settings.synth.layers[layerKey.slice(-1) as SynthLayerId].sustainPedal
  }

  private hasSoundingOrganVoice(): boolean {
    for (const voice of this.voices.values()) {
      if (!voice.releasing && voice.layerKey.startsWith('organ.')) return true
    }
    return false
  }

  /* -------------------------------------------------- synth note routing */

  private synthNoteOn(layerId: SynthLayerId, id: string, midi: number, velocity: number, gain: number): void {
    const settings = this.settings.synth.layers[layerId]
    this.synthHeld[layerId] = [...this.synthHeld[layerId].filter((e) => e.key !== id), { key: id, midi }]
    if (settings.arp.hold) this.synthLatched[layerId] = this.synthHeld[layerId].map((e) => e.midi)

    if (settings.arp.mode !== 'poly' && settings.arp.run) {
      this.syncArps()
      return
    }
    if (settings.voice.mode === 'poly') {
      this.start(`${id}#synth.${layerId}`, `synth.${layerId}`, id, midi, velocity, () =>
        this.synth(layerId).buildVoice(midi, velocity, gain),
      )
      return
    }
    this.updateMonoVoice(layerId, velocity, gain, true)
  }

  private synthNoteOff(layerId: SynthLayerId, id: string): void {
    const settings = this.settings.synth.layers[layerId]
    const before = this.synthHeld[layerId].length
    this.synthHeld[layerId] = this.synthHeld[layerId].filter((entry) => entry.key !== id)
    if (before === this.synthHeld[layerId].length) return

    if (settings.arp.hold) {
      // KB Hold keeps the notes sounding and the arpeggio running after the keys are lifted.
      this.syncArps()
      return
    }
    if (settings.arp.mode !== 'poly' && settings.arp.run) {
      this.syncArps()
      return
    }
    if (settings.voice.mode === 'poly') {
      const voice = this.voices.get(`${id}#synth.${layerId}`)
      if (!voice) return
      if (this.sustainDown && settings.sustainPedal) {
        voice.sustained = true
        return
      }
      this.release(voice, voice.voice.releaseSeconds)
      return
    }
    this.updateMonoVoice(layerId, 0.8, 1, false)
  }

  /**
   * Mono and legato. Mono retriggers the envelopes on every new note; legato glides the sounding
   * voice to the new pitch instead, which is the documented difference (manual p. 35).
   */
  private updateMonoVoice(layerId: SynthLayerId, velocity: number, gain: number, attack: boolean): void {
    const settings = this.settings.synth.layers[layerId]
    const key = `mono#synth.${layerId}`
    const existing = this.voices.get(key)
    const held = this.synthHeld[layerId]
    if (held.length === 0) {
      if (existing) this.release(existing, existing.voice.releaseSeconds)
      return
    }
    const chosen = pickByPriority(held, settings.voice.priority)
    if (!chosen) return
    if (existing && !existing.releasing) {
      const previous = existing.midi
      if (previous === chosen.midi) return
      const glide = this.synth(layerId).glideSecondsFor(previous, chosen.midi)
      const legato = settings.voice.mode === 'legato' && held.length > 1
      const synthVoice = existing.voice as SynthVoice
      if (legato || (!attack && glide > 0)) {
        synthVoice.retune(chosen.midi, glide)
        this.voices.set(key, { ...existing, midi: chosen.midi })
        return
      }
      this.destroy(existing)
    }
    this.start(key, `synth.${layerId}`, key, chosen.midi, velocity, () => {
      const built = this.synth(layerId).buildVoice(chosen.midi, velocity, gain)
      if (built && existing) {
        const glide = this.synth(layerId).glideSecondsFor(existing.midi, chosen.midi)
        if (glide > 0) built.retune(chosen.midi, glide)
      }
      return built
    })
  }

  private arpStep(layerId: SynthLayerId, notes: readonly number[], stepSeconds: number): void {
    const settings = this.settings.synth.layers[layerId]
    if (!this.settings.synth.sectionOn || !settings.enabled) return
    const gateSeconds =
      settings.arp.mode === 'gate'
        ? Math.min(stepSeconds * 0.95, stepSeconds * gateShape(settings.arp.range).hold)
        : stepSeconds * 0.8
    for (const midi of notes) {
      const key = `arp#synth.${layerId}#${this.arpCounter++}`
      const gain = zoneGain(this.settings.zones[`synth.${layerId}` as LayerKey], midi - this.settings.transpose)
      const started = this.start(key, `synth.${layerId}`, key, midi, 0.85, () =>
        this.synth(layerId).buildVoice(midi, 0.85, gain),
      )
      if (!started) continue
      this.scheduler.setTimeout(() => {
        const voice = this.voices.get(key)
        if (voice) this.release(voice, voice.voice.releaseSeconds)
      }, Math.max(1, gateSeconds * 1000))
    }
  }

  /* -------------------------------------------------- voice lifecycle */

  private start(
    key: string,
    layerKey: LayerKey,
    id: string,
    midi: number,
    velocity: number,
    build: () => LayerVoice | null,
  ): boolean {
    const existing = this.voices.get(key)
    if (existing) this.tearDown(existing, 0.01)
    if (this.voices.size >= this.maxVoices) this.stealVoice()
    const built = build()
    if (!built) return false
    const voice: Voice = {
      id,
      key,
      layerKey,
      midi,
      velocity,
      startedAt: this.voiceCounter++,
      voice: built,
      sustained: false,
      releasing: false,
      reapHandle: null,
    }
    this.voices.set(key, voice)
    // A voice whose sound has fully decayed is reaped even if the key is never released,
    // so a held chord does not leak nodes.
    voice.reapHandle = this.scheduler.setTimeout(() => {
      const current = this.voices.get(key)
      if (current === voice) this.destroy(voice)
    }, built.lifetimeSeconds * 1000)
    return true
  }

  setSustain(down: boolean): void {
    if (down === this.sustainDown) return
    this.sustainDown = down
    if (!down) {
      for (const voice of Array.from(this.voices.values())) {
        if (!voice.sustained) continue
        const seconds = voice.layerKey.startsWith('piano.')
          ? this.layers[voice.layerKey.slice(-1) as LayerId].pedalReleaseSeconds()
          : voice.voice.releaseSeconds
        this.release(voice, seconds)
      }
    }
    this.refreshResonance()
  }

  /** Stops every voice this engine owns. Used on blur, MIDI disconnect and unmount. */
  allNotesOff(): void {
    for (const voice of Array.from(this.voices.values())) this.release(voice, voice.voice.releaseSeconds)
    for (const id of SYNTH_LAYER_IDS) {
      this.synthHeld[id] = []
      this.synthLatched[id] = []
    }
    this.syncArps()
    this.refreshResonance()
  }

  /**
   * Panic: an internal All Notes Off with no release tail, plus a reset of the held performance
   * inputs — sustain, arpeggiator latches and every held key (manual p. 40).
   */
  panic(): void {
    for (const voice of Array.from(this.voices.values())) this.destroy(voice)
    for (const id of SYNTH_LAYER_IDS) {
      this.synthHeld[id] = []
      this.synthLatched[id] = []
      this.arps[id].stop()
    }
    this.sustainDown = false
    this.syncArps()
    this.refreshResonance()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.panic()
    for (const id of SYNTH_LAYER_IDS) this.arps[id].stop()
    for (const id of LAYER_IDS) this.layers[id].dispose()
    for (const id of SYNTH_LAYER_IDS) this.synths[id]?.dispose()
    this.organSection?.dispose()
    this.rotary.dispose()
    this.pianoBus.disconnect()
    this.organBus.disconnect()
    this.synthBus.disconnect()
    this.master.disconnect()
    this.limiter.disconnect()
  }

  private refreshResonance(): void {
    const held: number[] = []
    for (const voice of this.voices.values()) {
      if (!voice.releasing && voice.layerKey.startsWith('piano.')) held.push(voice.midi)
    }
    for (const id of LAYER_IDS) this.layers[id].updateResonance(held, this.sustainDown)
  }

  private release(voice: Voice, releaseSeconds: number): void {
    if (voice.releasing) return
    voice.releasing = true
    voice.sustained = false
    const now = this.context.currentTime
    for (const output of voice.voice.outputs) {
      const level = output.gain.value
      output.gain.cancelScheduledValues(now)
      output.gain.setValueAtTime(level, now)
      output.gain.exponentialRampToValueAtTime(Math.max(1e-5, level * 0.0005), now + releaseSeconds)
    }
    this.tearDown(voice, releaseSeconds + 0.02)
  }

  private tearDown(voice: Voice, afterSeconds: number): void {
    if (voice.reapHandle !== null) this.scheduler.clearTimeout(voice.reapHandle)
    voice.reapHandle = this.scheduler.setTimeout(() => this.destroy(voice), afterSeconds * 1000)
  }

  private destroy(voice: Voice): void {
    if (voice.reapHandle !== null) {
      this.scheduler.clearTimeout(voice.reapHandle)
      voice.reapHandle = null
    }
    for (const stoppable of voice.voice.stoppables) {
      try {
        stoppable.stop(this.context.currentTime)
      } catch {
        // A source that already stopped throws in some implementations; nothing to do.
      }
    }
    for (const node of voice.voice.nodes) node.disconnect()
    if (this.voices.get(voice.key) === voice) this.voices.delete(voice.key)
  }

  /**
   * Deterministic stealing order: the longest-running releasing voice first, then the
   * longest-running sustained voice, then the longest-running sounding voice.
   */
  private stealVoice(): void {
    const ranked = [...this.voices.values()].sort((a, b) => {
      const priority = (voice: Voice) => (voice.releasing ? 0 : voice.sustained ? 1 : 2)
      const byPriority = priority(a) - priority(b)
      return byPriority !== 0 ? byPriority : a.startedAt - b.startedAt
    })
    const victim = ranked[0]
    if (victim) this.destroy(victim)
  }
}

/** Note priority for mono and legato: Off takes the last key, Low/High the extreme held note. */
export function pickByPriority(
  held: readonly { key: string; midi: number }[],
  priority: 'off' | 'low' | 'high',
): { key: string; midi: number } | null {
  if (held.length === 0) return null
  if (priority === 'low') return held.reduce((best, entry) => (entry.midi < best.midi ? entry : best))
  if (priority === 'high') return held.reduce((best, entry) => (entry.midi > best.midi ? entry : best))
  return held[held.length - 1]
}

/**
 * The engine's Phase 1/2 name. Kept as an alias so every inherited import and test continues to
 * work unchanged while the class itself now drives the whole instrument.
 */
export const PianoEngine = StageEngine
export type PianoEngine = StageEngine

/**
 * Master limiter: unity below the knee, then a soft saturation that keeps the summed output of
 * two layers, unison voices and the effect chain from clipping the destination.
 */
export function limiterCurve(size = 2048, knee = 0.6, ceiling = 0.97): Float32Array {
  const curve = new Float32Array(size)
  const range = ceiling - knee
  for (let i = 0; i < size; i += 1) {
    const x = (i / (size - 1)) * 2 - 1
    const magnitude = Math.abs(x)
    const shaped =
      magnitude <= knee ? magnitude : knee + range * Math.tanh((magnitude - knee) / Math.max(range, 1e-6))
    curve[i] = Math.sign(x) * shaped
  }
  return curve
}

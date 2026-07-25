import { Ramped, RotaryUnit } from './effects'
import type { GraphBuffer, GraphContext, GraphGain, GraphWaveShaper, Scheduler } from './graph'
import { realScheduler } from './graph'
import { PianoLayer, type LayerVoice } from './layer'
import { pianoType } from './pianoTypes'
import { fillHammerNoise } from './pianoVoice'
import {
  SampleLibrary,
  type LoadedSet,
  type SampleSetId,
} from './sampleLibrary'
import { DEFAULT_SETTINGS, LAYER_IDS, type EngineSettings, type LayerId } from './settings'

/** A note instance is owned by the input that started it, so sources never steal each other's notes. */
export type NoteSource = 'pointer' | 'keyboard' | 'midi' | 'ui'

export function noteId(source: NoteSource, key: string | number): string {
  return `${source}:${key}`
}

interface Voice {
  readonly id: string
  readonly key: string
  readonly layerId: LayerId
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
 * The piano section and its effects: two layers, each with its own voices, timbre stage and
 * effect chain, feeding the piano bus, plus the shared Rotary, the master gain and the limiter.
 *
 *   voices -> layer timbre -> Mod 1 -> Mod 2 -> Delay -> Amp/EQ -> Comp -> Reverb -> layer level
 *          -> piano bus (or shared Rotary) -> master gain -> limiter -> destination
 *
 * There is one AudioContext and one destination connection; nothing bypasses the master path.
 */
export class PianoEngine {
  readonly context: GraphContext
  readonly master: GraphGain
  readonly limiter: GraphWaveShaper
  readonly pianoBus: GraphGain
  readonly rotary: RotaryUnit
  private readonly layers: Record<LayerId, PianoLayer>
  private readonly scheduler: Scheduler
  private readonly maxVoices: number
  private readonly voices = new Map<string, Voice>()
  private readonly noiseBuffer: GraphBuffer
  private readonly masterRamp: Ramped
  private readonly busRamp: Ramped
  private readonly library: SampleLibrary | null
  private readonly setStates = new Map<SampleSetId, SampleSetState>()
  private settings: EngineSettings
  private sustainDown = false
  private voiceCounter = 0
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

    this.syncLibraries()
  }

  /* -------------------------------------------------- settings */

  get current(): EngineSettings {
    return this.settings
  }

  layer(id: LayerId): PianoLayer {
    return this.layers[id]
  }

  applySettings(next: EngineSettings): void {
    if (this.disposed) return
    this.settings = next
    this.masterRamp.set(next.masterLevel, this.context)
    this.busRamp.set(next.sectionOn ? 1 : 0, this.context)
    for (const id of LAYER_IDS) this.layers[id].update(next.layers[id], next.effectsOn)
    this.rotary.update(next.rotary)
    this.syncLibraries()
    this.refreshResonance()
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
    if (this.disposed || !this.settings.sectionOn) return
    const clampedVelocity = Math.min(1, Math.max(0.01, velocity))
    for (const layerId of LAYER_IDS) {
      const layer = this.layers[layerId]
      if (!this.settings.layers[layerId].enabled) continue
      const key = `${id}#${layerId}`
      const existing = this.voices.get(key)
      if (existing) this.tearDown(existing, 0.01)
      if (this.voices.size >= this.maxVoices) this.stealVoice()
      const built = layer.buildVoice(midi, clampedVelocity)
      if (!built) continue
      const voice: Voice = {
        id,
        key,
        layerId,
        midi,
        velocity: clampedVelocity,
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
    }
    this.refreshResonance()
  }

  noteOff(id: string): void {
    for (const layerId of LAYER_IDS) {
      const voice = this.voices.get(`${id}#${layerId}`)
      if (!voice) continue
      if (this.sustainDown && this.settings.layers[layerId].sustainPedal) {
        voice.sustained = true
        continue
      }
      this.release(voice, voice.voice.releaseSeconds)
    }
    this.refreshResonance()
  }

  setSustain(down: boolean): void {
    if (down === this.sustainDown) return
    this.sustainDown = down
    if (!down) {
      for (const voice of Array.from(this.voices.values())) {
        if (voice.sustained) this.release(voice, this.layers[voice.layerId].pedalReleaseSeconds())
      }
    }
    this.refreshResonance()
  }

  /** Stops every voice this engine owns. Used on blur, MIDI disconnect and unmount. */
  allNotesOff(): void {
    for (const voice of Array.from(this.voices.values())) this.release(voice, voice.voice.releaseSeconds)
    this.refreshResonance()
  }

  /** Immediate, unconditional teardown — no release tail. */
  panic(): void {
    for (const voice of Array.from(this.voices.values())) this.destroy(voice)
    this.refreshResonance()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.panic()
    for (const id of LAYER_IDS) this.layers[id].dispose()
    this.rotary.dispose()
    this.pianoBus.disconnect()
    this.master.disconnect()
    this.limiter.disconnect()
  }

  private refreshResonance(): void {
    const held: number[] = []
    for (const voice of this.voices.values()) if (!voice.releasing) held.push(voice.midi)
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

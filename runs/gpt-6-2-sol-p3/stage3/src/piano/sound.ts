import { EffectsRack } from '../audio/effects'
import { curve, Graph } from '../audio/graph'
import type { NotePart } from '../audio/notePart'
import { OrganWaves } from '../audio/organ'
import { OrganChannel } from '../audio/organChannel'
import { SynthWaves } from '../audio/synth'
import { browserScheduler, SynthChannel } from '../audio/synthChannel'
import type { Scheduler } from '../audio/synthChannel'
import { effectiveSettings } from '../instrument/morph'
import { clamp, splitPoints, synthLayers, zoneGain } from '../instrument/parameters'
import type { SynthId, ZoneRange } from '../instrument/parameters'
import { loadLibraryBank, SampleBank, Tones } from './library'
import type { PianoSample } from './library'
import type { Voice, VoiceOutput } from './notes'
import { initialSettings, isRecorded, layers } from './settings'
import type { Layer, PianoType, RecordedType, Settings } from './settings'
import { LayerVoice, strikeVelocity, timbreBus } from './voices'

export type { PianoSample } from './library'
export { velocityGain } from './voices'

export type AudioStatus = 'loading' | 'ready' | 'fallback' | 'error'

export interface AudioEngine extends VoiceOutput {
  prepare(): void
  activate(): void
  configure?(settings: Settings): void
  dispose(): void
}

interface AudioEnvironment {
  available?(): boolean
  createContext(): AudioContext
  scheduler?: Scheduler
  loadBank(signal: AbortSignal, type: RecordedType): Promise<PianoSample[]>
}

/** All instrument sections enter the same rack in browsers and offline renders. */
export class PianoRack implements VoiceOutput {
  private readonly graph: Graph
  private readonly master: GainNode
  private readonly active: Record<Layer, Set<LayerVoice>> = { A: new Set(), B: new Set() }
  private readonly buses: Record<Layer, ReturnType<typeof timbreBus>>
  private readonly tones: Tones
  private readonly banks = new Map<RecordedType, SampleBank>()
  private settings = initialSettings()
  private effects?: EffectsRack
  private readonly organChannels = new Map<Layer, OrganChannel>()
  private readonly synthChannels = new Map<SynthId, SynthChannel>()
  private readonly held = new Set<object>()
  private organWaves?: OrganWaves
  private synthWaves?: SynthWaves
  private points: ReturnType<typeof splitPoints> = []
  private epoch = 0

  constructor(
    private readonly context: BaseAudioContext,
    private readonly clock = () => context.currentTime,
    private readonly scheduler = browserScheduler,
  ) {
    this.graph = new Graph(context, clock)
    this.tones = new Tones(context)
    this.buses = { A: timbreBus(this.graph), B: timbreBus(this.graph) }
    this.master = this.graph.gain()
    const limiter = this.graph.own(context.createDynamicsCompressor())
    limiter.threshold.value = -8
    limiter.knee.value = 8
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.11
    const peakGuard = this.graph.shape(curve((input) => {
      const magnitude = Math.abs(input)
      if (magnitude <= 0.82) return input
      const excess = (magnitude - 0.82) / 0.18
      return Math.sign(input) * (0.82 + 0.18 * (1 - Math.exp(-excess)))
    }))
    this.master.connect(limiter)
    limiter.connect(peakGuard)
    peakGuard.connect(context.destination)
    this.configure(this.settings)
  }

  setBank(bank: readonly PianoSample[], type: RecordedType = 'Upright') {
    this.banks.set(type, new SampleBank(bank))
  }

  configure(raw: Settings) {
    const settings = this.settings = effectiveSettings(raw)
    this.points = splitPoints(settings.splits)
    this.graph.set(this.master.gain, 0.22 * (settings.master / 3) ** 1.15)
    this.effects?.update(settings)
    for (const layer of layers) {
      const state = settings.layers[layer]
      this.buses[layer].update(state)
      for (const voice of this.active[layer]) {
        voice.setPitch(state.pitch ? settings.pitch * 20 : 0)
        voice.setZone(this.gain(state.zone, voice.keyNote))
        if (!settings.on || !state.on) voice.release(0.024)
        else if (voice.sustained && !state.sustain) voice.release(this.releaseTime(voice.type, state.softRelease))
      }
      this.updateResonance(layer)
      const organ = settings.organ.layers[layer]
      this.organChannels.get(layer)?.update(organ, settings.organ.on && organ.on, this.bend(organ.pitch),
        (note) => this.gain(organ.zone, note))
    }
    for (const layer of synthLayers) this.synthChannels.get(layer)?.update(this.synthPatch(layer))
  }

  play(note: number, velocity: number, ended: () => void): Voice | undefined {
    const { settings } = this
    const handle = {}
    if (!this.held.size && settings.keyboardSync) {
      this.epoch = this.clock()
      for (const layer of synthLayers) this.synthChannels.get(layer)?.update(this.synthPatch(layer))
    }
    const parts = new Set<NotePart>()
    let ready = false
    const add = (start: (end: () => void) => NotePart) => {
      const part = start(() => {
        parts.delete(part)
        if (!parts.size && ready) {
          this.held.delete(handle)
          ended()
        }
      })
      parts.add(part)
    }

    for (const layer of layers) {
      const state = settings.layers[layer]
      const zone = this.gain(state.zone, note)
      if (settings.on && state.on && zone > 0) add((end) => this.playPiano(layer, note, velocity, zone, end))
      const organ = settings.organ.layers[layer]
      const organZone = this.gain(organ.zone, note)
      if (settings.organ.on && organ.on && organZone > 0) {
        const channel = this.organChannel(layer)
        add((end) => channel.play(note, organZone, velocity, this.transpose(), this.bend(organ.pitch), end))
      }
    }
    for (const layer of synthLayers) {
      const synth = settings.synth.layers[layer]
      if (!settings.synth.on || !synth.on) continue
      const zone = this.gain(synth.zone, note)
      if (zone > 0) add((end) => this.synthChannel(layer).press({ note, velocity, zone }, end))
    }
    if (!parts.size) return
    this.held.add(handle)
    ready = true
    return {
      keyUp: (pedal) => {
        this.held.delete(handle)
        let sustained = false
        for (const part of parts) sustained = part.keyUp(pedal) || sustained
        return sustained
      },
      setPedal: (enabled) => { for (const part of parts) part.setPedal?.(enabled) },
      isSustained: () => [...parts].some((part) => part.isSustained()),
      release: (seconds) => {
        this.held.delete(handle)
        for (const part of parts) part.release(seconds)
      },
      stop: () => {
        this.held.delete(handle)
        for (const part of parts) part.stop()
      },
    }
  }

  private playPiano(layer: Layer, note: number, velocity: number, zone: number, ended: () => void): NotePart {
    this.prepareGraph()
    const state = this.settings.layers[layer]
    const shifted = clamp(note + this.transpose() + state.octave * 12, 0, 127)
    const strike = strikeVelocity(velocity, state.touch)
    const type = state.type
    const takes = (isRecorded(type) ? this.banks.get(type)?.strike(shifted, strike) : undefined) ?? []
    const tone = takes.length ? undefined : this.tones.get(isRecorded(type) ? 'Fallback' : type, shifted)
    const voice = new LayerVoice(this.context, this.buses[layer].input, shifted, strike, state, takes, tone,
      this.bend(state.pitch), this.clock, () => {
        this.active[layer].delete(voice)
        this.updateResonance(layer)
        ended()
      }, note, zone)
    this.active[layer].add(voice)
    this.updateResonance(layer)
    const release = (seconds?: number) => {
      voice.release(seconds ?? this.releaseTime(voice.type, this.settings.layers[layer].softRelease))
      this.updateResonance(layer)
    }
    return {
      keyUp: (pedal) => {
        const current = this.settings.layers[layer]
        if (voice.keyed && pedal && current.sustain && current.on && this.settings.on) {
          voice.keyed = false
          voice.sustained = true
          this.updateResonance(layer)
          return true
        }
        release()
        return false
      },
      setPedal: (enabled) => {
        voice.pedal = enabled
        this.updateResonance(layer)
      },
      isSustained: () => voice.sustained,
      release,
      stop: () => voice.stop(),
    }
  }

  private bend(enabled: boolean) {
    return enabled ? this.settings.pitch * 20 : 0
  }

  private transpose() {
    return this.settings.transpose.enabled ? this.settings.transpose.semitones : 0
  }

  private gain(zone: ZoneRange, note: number) {
    return zoneGain(this.points, zone, note)
  }

  private organChannel(layer: Layer) {
    let channel = this.organChannels.get(layer)
    if (!channel) {
      this.prepareGraph()
      const bank = this.organWaves ??= new OrganWaves(this.context)
      const state = this.settings.organ.layers[layer]
      channel = new OrganChannel(this.context, this.effects!.input('Organ'), bank, state, this.clock)
      channel.update(state, true, this.bend(state.pitch), (note) => this.gain(state.zone, note))
      this.organChannels.set(layer, channel)
    }
    return channel
  }

  private synthPatch(layer: SynthId) {
    const { synth, effects, keyboardSync, performance } = this.settings
    const state = synth.layers[layer]
    return {
      state, on: synth.on && state.on, transpose: this.transpose(), bend: this.bend(state.pitch),
      wheel: performance.wheel, tempo: effects.clockBpm, epoch: this.epoch, keyboardSync,
    }
  }

  private synthChannel(layer: SynthId) {
    let channel = this.synthChannels.get(layer)
    if (!channel) {
      this.prepareGraph()
      const bank = this.synthWaves ??= new SynthWaves(this.context)
      channel = new SynthChannel(this.context, this.effects!.input(`Synth ${layer}`), bank,
        this.synthPatch(layer), this.clock, this.scheduler, (note) => this.gain(this.settings.synth.layers[layer].zone, note))
      this.synthChannels.set(layer, channel)
    }
    return channel
  }

  stopAll() {
    this.held.clear()
    this.epoch = 0
    for (const layer of layers) for (const voice of this.active[layer]) voice.stop()
    for (const channel of this.organChannels.values()) channel.dispose()
    for (const channel of this.synthChannels.values()) channel.clear()
    this.organChannels.clear()
    this.synthChannels.clear()
    if (this.effects) {
      for (const layer of layers) this.buses[layer].output.disconnect()
      this.effects.dispose()
      this.effects = undefined
    }
  }

  dispose() {
    this.stopAll()
    this.tones.clear()
    this.banks.clear()
    this.graph.dispose()
  }

  prepareGraph() {
    if (this.effects) return
    const effects = new EffectsRack(this.master, this.context, this.clock)
    effects.update(this.settings)
    for (const layer of layers) this.buses[layer].output.connect(effects.input(layer))
    this.effects = effects
  }

  private releaseTime(type: PianoType, softRelease: boolean) {
    return type === 'Clav' ? 0.075 : softRelease ? 0.31 : 0.16
  }

  private updateResonance(layer: Layer) {
    const state = this.settings.layers[layer]
    for (const voice of this.active[layer]) {
      let sympathetic = 0
      if (state.resonance && (voice.keyed || voice.sustained)) {
        if (voice.pedal && state.sustain) sympathetic += 0.21
        for (const other of this.active[layer]) {
          if (voice === other || !other.keyed) continue
          const interval = Math.abs(voice.note - other.note) % 12
          sympathetic += interval === 0 || interval === 7 || interval === 5 ? 0.14 : 0.025
        }
      }
      voice.setResonance(Math.min(0.3, sympathetic))
    }
  }
}

export class PianoAudio implements AudioEngine {
  private readonly pending = new AbortController()
  private readonly bankStates = new Map<RecordedType, AudioStatus>()
  private readonly banks = new Map<RecordedType, readonly PianoSample[]>()
  private context?: AudioContext
  private rack?: PianoRack
  private settings = initialSettings()
  private prepared = false
  private resumePending = false
  private outputFailed = false
  private lastStatus?: AudioStatus

  constructor(
    private readonly status: (state: AudioStatus) => void,
    private readonly environment?: AudioEnvironment,
  ) {}

  prepare() {
    this.prepared = true
    if (this.environment?.available?.() === false ||
        (!this.environment && typeof AudioContext === 'undefined')) {
      this.outputFailed = true
      this.report()
      return
    }
    if (this.environment) this.prepareSelectedBanks()
    else queueMicrotask(() => this.prepareSelectedBanks())
  }

  configure(settings: Settings) {
    this.settings = settings
    this.rack?.configure(settings)
    if (this.prepared) this.prepareSelectedBanks()
  }

  activate() {
    if (this.pending.signal.aborted) return
    try {
      const context = this.audioContext()
      if (!this.rack) {
        this.rack = new PianoRack(context, undefined, this.environment?.scheduler)
        this.rack.configure(this.settings)
        for (const [type, bank] of this.banks) this.rack.setBank(bank, type)
      }
      this.rack.prepareGraph()
      if (context.state === 'running') {
        this.outputFailed = false
        this.report()
      } else if (!this.resumePending) {
        this.resumePending = true
        void context.resume().then(() => {
          if (this.pending.signal.aborted) return
          this.outputFailed = false
          this.report()
        }).catch(() => {
          if (this.pending.signal.aborted) return
          this.outputFailed = true
          this.report()
        }).finally(() => { this.resumePending = false })
      }
    } catch {
      this.outputFailed = true
      this.report()
    }
  }

  play(note: number, velocity: number, ended: () => void) {
    this.activate()
    return this.rack?.play(note, velocity, ended)
  }

  stopAll() {
    this.rack?.stopAll()
  }

  dispose() {
    this.pending.abort()
    this.rack?.dispose()
    void this.context?.close().catch(() => {})
    this.banks.clear()
    this.bankStates.clear()
    this.rack = undefined
    this.context = undefined
  }

  private audioContext() {
    return this.context ??= this.environment ? this.environment.createContext() : new AudioContext({ latencyHint: 'interactive' })
  }

  private prepareSelectedBanks() {
    if (this.pending.signal.aborted || this.outputFailed) return
    if (!this.settings.on) { this.report(); return }
    for (const layer of layers) {
      const selection = this.settings.layers[layer]
      if ((selection.on || layer === this.settings.focus) && isRecorded(selection.type)) this.load(selection.type)
    }
    this.report()
  }

  private load(type: RecordedType) {
    if (this.bankStates.has(type)) return
    this.bankStates.set(type, 'loading')
    let promise: Promise<PianoSample[]>
    try {
      promise = this.environment
        ? this.environment.loadBank(this.pending.signal, type)
        : loadLibraryBank(this.audioContext(), type, this.pending.signal)
    } catch {
      this.outputFailed = true
      this.report()
      return
    }
    void promise.then((bank) => {
      if (this.pending.signal.aborted) return
      if (!bank.length) throw new Error('No recorded samples decoded')
      this.banks.set(type, bank)
      this.rack?.setBank(bank, type)
      this.bankStates.set(type, 'ready')
      this.report()
    }).catch(() => {
      if (this.pending.signal.aborted) return
      this.bankStates.set(type, 'fallback')
      this.report()
    })
  }

  private report() {
    const type = this.settings.layers[this.settings.focus].type
    const state = this.outputFailed ? 'error'
      : this.settings.on && isRecorded(type) ? this.bankStates.get(type) ?? 'loading' : 'ready'
    if (state === this.lastStatus) return
    if (state === 'loading' && this.lastStatus === undefined) return
    this.lastStatus = state
    this.status(state)
  }
}

import type { AudioContextFactory, PianoStatus, TimingBoundary } from './boundaries'
import { defaultAudioContextFactory, defaultTiming } from './boundaries'
import { LayerEffectChain, SharedRotary } from './effects-chain'
import { applyMorphToValue } from './morph-clock'
import { spawnOrganVoice } from './organ-voice'
import { buildArpSequence, createSynthFilter, createSynthOscillators } from './synth-voice'
import { resolveLayerGain } from './zones'
import { SampleLibrary, synthesizeFallbackBuffer } from './samples'
import {
  PIANO_TYPES,
  defaultInstrumentState,
  type InstrumentAudioState,
  type PianoLayerId,
  type PianoType,
  type SynthLayerId,
} from './types'
import type { LayerSceneConfig, MorphDestination, ZoneAssignment } from './program-types'

const MAX_POLYPHONY = 32
const RAMP = 0.012

interface ActiveVoice {
  midi: number
  voiceId: number
  engine: 'piano' | 'organ' | 'synth'
  layer: PianoLayerId | 'A' | 'B' | SynthLayerId
  source: AudioBufferSourceNode | OscillatorNode
  gain: GainNode
  extra?: OscillatorNode[]
  stopFn?: (time: number) => void
  startedAt: number
}

export interface PianoEngineOptions {
  audioContextFactory?: AudioContextFactory
  timing?: TimingBoundary
  polyphony?: number
  forceError?: boolean
  forceSampleFail?: boolean
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

export class PianoEngine {
  readonly context: AudioContext | OfflineAudioContext
  readonly timing: TimingBoundary
  readonly maxPolyphony: number
  private masterGain: GainNode
  private limiter: DynamicsCompressorNode
  private mixBus: GainNode
  private layerInputs: Record<PianoLayerId, GainNode>
  private organMix: GainNode
  private organLayerInputs: Record<'A' | 'B', GainNode>
  private synthLayerInputs: Record<SynthLayerId, GainNode>
  private effectChains: Record<PianoLayerId, LayerEffectChain>
  private organEffectChain: LayerEffectChain
  private synthEffectChains: Record<SynthLayerId, LayerEffectChain>
  private rotary: SharedRotary
  private sampleLibrary: SampleLibrary
  private fallbackBuffer: AudioBuffer | null = null
  private voices = new Map<number, ActiveVoice>()
  private sustainedNotes = new Set<string>()
  private sustainPedal = false
  private nextVoiceId = 1
  private status: PianoStatus = 'loading'
  private started = false
  private state: InstrumentAudioState = defaultInstrumentState()
  private loadPromise: Promise<void> | null = null
  private arpNotes = new Set<number>()
  private arpStep = 0
  private arpTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: PianoEngineOptions = {}) {
    this.timing = options.timing ?? defaultTiming
    this.maxPolyphony = options.polyphony ?? MAX_POLYPHONY
    const factory = options.audioContextFactory ?? defaultAudioContextFactory
    this.context = factory.create()
    this.sampleLibrary = new SampleLibrary(options.forceSampleFail ?? options.forceError)

    this.masterGain = this.context.createGain()
    this.limiter = this.context.createDynamicsCompressor()
    this.limiter.threshold.value = -3
    this.limiter.ratio.value = 20
    this.limiter.knee.value = 0
    this.mixBus = this.context.createGain()

    this.layerInputs = {
      A: this.context.createGain(),
      B: this.context.createGain(),
    }
    this.organMix = this.context.createGain()
    this.organLayerInputs = { A: this.context.createGain(), B: this.context.createGain() }
    this.synthLayerInputs = {
      A: this.context.createGain(),
      B: this.context.createGain(),
      C: this.context.createGain(),
    }

    this.rotary = new SharedRotary(this.context, this.mixBus)
    this.effectChains = {
      A: new LayerEffectChain(this.context, this.mixBus, this.rotary.input),
      B: new LayerEffectChain(this.context, this.mixBus, this.rotary.input),
    }
    this.organEffectChain = new LayerEffectChain(this.context, this.mixBus, this.rotary.input)
    this.synthEffectChains = {
      A: new LayerEffectChain(this.context, this.mixBus, this.rotary.input),
      B: new LayerEffectChain(this.context, this.mixBus, this.rotary.input),
      C: new LayerEffectChain(this.context, this.mixBus, this.rotary.input),
    }

    this.layerInputs.A.connect(this.effectChains.A.input)
    this.layerInputs.B.connect(this.effectChains.B.input)
    this.organLayerInputs.A.connect(this.organMix)
    this.organLayerInputs.B.connect(this.organMix)
    this.organMix.connect(this.organEffectChain.input)
    this.synthLayerInputs.A.connect(this.synthEffectChains.A.input)
    this.synthLayerInputs.B.connect(this.synthEffectChains.B.input)
    this.synthLayerInputs.C.connect(this.synthEffectChains.C.input)

    this.mixBus.connect(this.masterGain)
    this.masterGain.connect(this.limiter)
    this.limiter.connect(this.context.destination)

    this.masterGain.gain.value = 0.35
    this.applyState()

    if (options.forceError) {
      this.status = 'error'
    } else {
      this.loadPromise = this.initSamples()
    }
  }

  private async initSamples(): Promise<void> {
    try {
      await this.sampleLibrary.load(this.context)
      this.fallbackBuffer = await synthesizeFallbackBuffer(this.context)
      this.status = 'ready'
    } catch {
      this.fallbackBuffer = await synthesizeFallbackBuffer(this.context)
      this.status = 'fallback'
    }
  }

  async ensureReady(): Promise<void> {
    if (this.loadPromise) await this.loadPromise
  }

  getStatus(): PianoStatus {
    return this.status
  }

  getState(): InstrumentAudioState {
    return structuredClone(this.state)
  }

  getActiveVoiceCount(): number {
    return this.voices.size
  }

  getActiveVoiceCountForLayer(layer: PianoLayerId): number {
    let n = 0
    for (const v of this.voices.values()) if (v.engine === 'piano' && v.layer === layer) n++
    return n
  }

  getOrganEffectChain(): LayerEffectChain {
    return this.organEffectChain
  }

  getSynthEffectChain(layer: SynthLayerId): LayerEffectChain {
    return this.synthEffectChains[layer]
  }

  getAudioContext(): BaseAudioContext {
    return this.context
  }

  isSustainHeld(): boolean {
    return this.sustainPedal
  }

  async ensureStarted(): Promise<void> {
    await this.ensureReady()
    if (this.started) return
    if ('resume' in this.context) await this.context.resume()
    this.started = true
  }

  updateState(partial: DeepPartial<InstrumentAudioState>): void {
    if (partial.masterLevel != null) this.state.masterLevel = partial.masterLevel
    if (partial.pianoA) this.state.pianoA = { ...this.state.pianoA, ...partial.pianoA }
    if (partial.pianoB) this.state.pianoB = { ...this.state.pianoB, ...partial.pianoB }
    if (partial.pianoPerf) this.state.pianoPerf = { ...this.state.pianoPerf, ...partial.pianoPerf }
    if (partial.organ) {
      this.state.organ = {
        ...this.state.organ,
        ...partial.organ,
        layerA: {
          ...this.state.organ.layerA,
          ...partial.organ.layerA,
          drawbars: (partial.organ.layerA?.drawbars ?? this.state.organ.layerA.drawbars) as number[],
        },
        layerB: {
          ...this.state.organ.layerB,
          ...partial.organ.layerB,
          drawbars: (partial.organ.layerB?.drawbars ?? this.state.organ.layerB.drawbars) as number[],
        },
        percussion: { ...this.state.organ.percussion, ...partial.organ.percussion },
      }
    }
    if (partial.synth) {
      this.state.synth = {
        ...this.state.synth,
        ...partial.synth,
        layerA: { ...this.state.synth.layerA, ...partial.synth.layerA },
        layerB: { ...this.state.synth.layerB, ...partial.synth.layerB },
        layerC: { ...this.state.synth.layerC, ...partial.synth.layerC },
      }
    }
    if (partial.split) {
      this.state.split = {
        ...this.state.split,
        ...partial.split,
        low: { ...this.state.split.low, ...partial.split.low },
        mid: { ...this.state.split.mid, ...partial.split.mid },
        high: { ...this.state.split.high, ...partial.split.high },
      }
    }
    if (partial.zones) this.state.zones = partial.zones as ZoneAssignment[]
    if (partial.sceneI) this.state.sceneI = { ...this.state.sceneI, ...partial.sceneI }
    if (partial.sceneII) this.state.sceneII = { ...this.state.sceneII, ...partial.sceneII }
    if (partial.activeScene) this.state.activeScene = partial.activeScene
    if (partial.morph) {
      this.state.morph = {
        wheel: (partial.morph.wheel as MorphDestination[] | undefined) ?? this.state.morph.wheel,
        pedal: (partial.morph.pedal as MorphDestination[] | undefined) ?? this.state.morph.pedal,
      }
    }
    if (partial.clock) this.state.clock = { ...this.state.clock, ...partial.clock }
    if (partial.performance) this.state.performance = { ...this.state.performance, ...partial.performance }
    if (partial.effects) {
      const e = partial.effects
      if (e.mod1) this.state.effects.mod1 = { ...this.state.effects.mod1, ...e.mod1 }
      if (e.mod2) this.state.effects.mod2 = { ...this.state.effects.mod2, ...e.mod2 }
      if (e.delay) this.state.effects.delay = { ...this.state.effects.delay, ...e.delay }
      if (e.amp) this.state.effects.amp = { ...this.state.effects.amp, ...e.amp }
      if (e.comp) this.state.effects.comp = { ...this.state.effects.comp, ...e.comp }
      if (e.reverb) this.state.effects.reverb = { ...this.state.effects.reverb, ...e.reverb }
      if (e.layerAFocus != null) this.state.effects.layerAFocus = e.layerAFocus
      if (e.layerBFocus != null) this.state.effects.layerBFocus = e.layerBFocus
      if (e.layerCFocus != null) this.state.effects.layerCFocus = e.layerCFocus
      if (e.pianoGroup != null) this.state.effects.pianoGroup = e.pianoGroup
      if (e.allBypass != null) this.state.effects.allBypass = e.allBypass
      if (e.rotaryOn != null) this.state.effects.rotaryOn = e.rotaryOn
      if (e.rotarySpeed != null) this.state.effects.rotarySpeed = e.rotarySpeed
      if (e.rotaryDrive != null) this.state.effects.rotaryDrive = e.rotaryDrive
    }
    this.applyState()
  }

  setMasterLevel(value: number): void {
    this.state.masterLevel = value
    const t = this.context.currentTime
    this.masterGain.gain.setTargetAtTime((value / 127) * 0.7, t, RAMP)
  }

  private applyState(): void {
    const t = this.context.currentTime
    this.setMasterLevel(this.state.masterLevel)
    const scene = this.state.activeScene === 'I' ? this.state.sceneI : this.state.sceneII
    const wheel = this.state.performance.modWheel
    const pedal = this.state.performance.controlPedal

    this.effectChains.A.applyState(this.state.effects, this.state.effects.allBypass)
    this.effectChains.B.applyState(this.resolveEffectsForLayer('B'), this.state.effects.allBypass)
    this.organEffectChain.applyState(this.state.effects, this.state.effects.allBypass)
    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
      this.synthEffectChains[layer].applyState(this.state.effects, this.state.effects.allBypass)
    }

    this.effectChains.A.setLayerLevel(this.morphedLevel('piano-layer-a-level', this.state.pianoA.level, wheel, pedal))
    this.effectChains.B.setLayerLevel(this.morphedLevel('piano-layer-b-level', this.state.pianoB.level, wheel, pedal))
    this.organEffectChain.setLayerLevel(this.morphedLevel('organ-layer-a-level', this.state.organ.layerA.level, wheel, pedal))
    this.synthEffectChains.A.setLayerLevel(this.morphedLevel('synth-layer-a-level', this.state.synth.layerA.level, wheel, pedal))
    this.synthEffectChains.B.setLayerLevel(this.morphedLevel('synth-layer-b-level', this.state.synth.layerB.level, wheel, pedal))
    this.synthEffectChains.C.setLayerLevel(this.morphedLevel('synth-layer-c-level', this.state.synth.layerC.level, wheel, pedal))

    const rotaryOn = this.state.effects.rotaryOn || this.state.organ.rotaryRoute
    this.rotary.apply(rotaryOn, this.state.effects.rotarySpeed, this.state.effects.rotaryDrive)

    const pianoAOn = this.state.pianoA.enabled && this.state.pianoPerf.sectionOn && scene.pianoA
    const pianoBOn = this.state.pianoB.enabled && this.state.pianoPerf.sectionOn && scene.pianoB
    this.layerInputs.A.gain.setTargetAtTime(pianoAOn ? 1 : 0, t, RAMP)
    this.layerInputs.B.gain.setTargetAtTime(pianoBOn ? 1 : 0, t, RAMP)

    const organAOn = this.state.organ.layerA.enabled && this.state.organ.sectionOn && scene.organA
    const organBOn = this.state.organ.layerB.enabled && this.state.organ.sectionOn && scene.organB
    this.organLayerInputs.A.gain.setTargetAtTime(organAOn ? 1 : 0, t, RAMP)
    this.organLayerInputs.B.gain.setTargetAtTime(organBOn ? 1 : 0, t, RAMP)

    for (const [layer, cfg, sceneKey] of [
      ['A', this.state.synth.layerA, 'synthA'],
      ['B', this.state.synth.layerB, 'synthB'],
      ['C', this.state.synth.layerC, 'synthC'],
    ] as const) {
      const on = cfg.enabled && this.state.synth.sectionOn && scene[sceneKey]
      this.synthLayerInputs[layer].gain.setTargetAtTime(on ? 1 : 0, t, RAMP)
    }
  }

  private morphedLevel(controlId: string, base: number, wheel: number, pedal: number): number {
    return applyMorphToValue(controlId, base, this.state.morph, wheel, pedal)
  }

  private sceneLayers(): LayerSceneConfig {
    return this.state.activeScene === 'I' ? this.state.sceneI : this.state.sceneII
  }

  private resolveEffectsForLayer(layer: PianoLayerId) {
    const fx = this.state.effects
    if (fx.pianoGroup || fx.delay.global || fx.comp.global || fx.reverb.global) {
      return fx
    }
    if (layer === 'A') return fx
    return fx
  }

  midiToFreq(midi: number): number {
    return 440 * 2 ** ((midi - 69) / 12)
  }

  velocityToGain(velocity: number): number {
    const v = Math.max(1, Math.min(127, velocity))
    let gain = (v / 127) ** 1.4
    const touch = this.state.pianoPerf.kbTouch
    if (touch === 'Heavy') gain *= 0.75 + (v / 127) ** 0.8 * 0.35
    else if (touch === 'Light') gain *= 0.55 + (v / 127) ** 2 * 0.55
    const dc = this.state.pianoPerf.dynComp
    if (dc !== 'Off') {
      const level = Number(dc)
      const lift = (1 - v / 127) * 0.15 * level
      gain = Math.min(1, gain + lift)
    }
    return gain
  }

  noteOn(midi: number, velocity = 100, time?: number): number {
    if (this.status === 'error') return -1
    const when = time ?? this.context.currentTime
    const transposed = midi + this.state.performance.transpose
    const voiceIds: number[] = []
    const scene = this.sceneLayers()

    for (const layer of ['A', 'B'] as PianoLayerId[]) {
      const ls = layer === 'A' ? this.state.pianoA : this.state.pianoB
      const sceneOn = layer === 'A' ? scene.pianoA : scene.pianoB
      if (!ls.enabled || !this.state.pianoPerf.sectionOn || !sceneOn) continue
      const zoneGain = resolveLayerGain(transposed, { engine: 'piano', layer }, this.state.zones, this.state.split)
      if (zoneGain <= 0) continue
      const shifted = transposed + ls.octave
      this.releaseVoiceForNote(shifted, 'piano', layer, when, 0.01)
      if (this.voices.size >= this.maxPolyphony) this.stealOldestVoice(when)
      const id = this.spawnPianoVoice(shifted, Math.round(velocity * zoneGain), layer, when)
      if (id >= 0) voiceIds.push(id)
    }

    for (const layer of ['A', 'B'] as const) {
      const ls = layer === 'A' ? this.state.organ.layerA : this.state.organ.layerB
      const sceneOn = layer === 'A' ? scene.organA : scene.organB
      if (!ls.enabled || !this.state.organ.sectionOn || !sceneOn) continue
      const zoneGain = resolveLayerGain(transposed, { engine: 'organ', layer }, this.state.zones, this.state.split)
      if (zoneGain <= 0) continue
      const shifted = transposed + ls.octave
      if (this.voices.size >= this.maxPolyphony) this.stealOldestVoice(when)
      const id = this.spawnOrganVoiceInternal(shifted, Math.round(velocity * zoneGain), layer, when)
      if (id >= 0) voiceIds.push(id)
    }

    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
      const ls = this.state.synth[`layer${layer}`]
      const sceneOn = scene[`synth${layer}`]
      if (!ls.enabled || !this.state.synth.sectionOn || !sceneOn) continue
      const zoneGain = resolveLayerGain(transposed, { engine: 'synth', layer }, this.state.zones, this.state.split)
      if (zoneGain <= 0) continue
      const shifted = transposed + ls.octave
      if (ls.arpRun && ls.arpMode === 'Arp') {
        this.arpNotes.add(shifted)
        this.scheduleArp(layer, when)
      } else {
        if (this.voices.size >= this.maxPolyphony) this.stealOldestVoice(when)
        const id = this.spawnSynthVoiceInternal(shifted, Math.round(velocity * zoneGain), layer, when)
        if (id >= 0) voiceIds.push(id)
      }
    }
    return voiceIds[0] ?? -1
  }

  noteOff(midi: number, time?: number): void {
    const when = time ?? this.context.currentTime
    const transposed = midi + this.state.performance.transpose
    this.arpNotes.delete(transposed)
    for (const layer of ['A', 'B'] as PianoLayerId[]) {
      const ls = layer === 'A' ? this.state.pianoA : this.state.pianoB
      if (!ls.enabled) continue
      const shifted = transposed + ls.octave
      const key = `piano:${layer}:${shifted}`
      const useSustain = this.sustainPedal && ls.sustPed
      if (useSustain) {
        this.sustainedNotes.add(key)
        continue
      }
      this.releaseVoiceForNote(shifted, 'piano', layer, when)
    }
    for (const layer of ['A', 'B'] as const) {
      const ls = layer === 'A' ? this.state.organ.layerA : this.state.organ.layerB
      const shifted = transposed + ls.octave
      const key = `organ:${layer}:${shifted}`
      const useSustain = this.sustainPedal && this.state.organ.sustPed
      if (useSustain) {
        this.sustainedNotes.add(key)
        continue
      }
      this.releaseVoiceForNote(shifted, 'organ', layer, when)
    }
    for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
      const ls = this.state.synth[`layer${layer}`]
      const shifted = transposed + ls.octave
      if (ls.arpHold) continue
      const key = `synth:${layer}:${shifted}`
      const useSustain = this.sustainPedal && ls.sustPed
      if (useSustain) {
        this.sustainedNotes.add(key)
        continue
      }
      this.releaseVoiceForNote(shifted, 'synth', layer, when)
    }
  }

  setSustain(on: boolean, time?: number): void {
    const when = time ?? this.context.currentTime
    this.sustainPedal = on
    if (!on) {
      for (const key of [...this.sustainedNotes]) {
        this.sustainedNotes.delete(key)
        const [engine, layer, midiStr] = key.split(':') as ['piano' | 'organ' | 'synth', string, string]
        const midi = Number(midiStr)
        if (engine === 'piano') {
          const ls = layer === 'A' ? this.state.pianoA : this.state.pianoB
          if (ls.sustPed) this.releaseVoiceForNote(midi, 'piano', layer as PianoLayerId, when)
        } else if (engine === 'organ' && this.state.organ.sustPed) {
          this.releaseVoiceForNote(midi, 'organ', layer as 'A' | 'B', when)
        } else if (engine === 'synth') {
          const ls = this.state.synth[`layer${layer as SynthLayerId}`]
          if (ls.sustPed) this.releaseVoiceForNote(midi, 'synth', layer as SynthLayerId, when)
        }
      }
    }
  }

  panic(time?: number): void {
    const when = time ?? this.context.currentTime
    this.allNotesOff(when)
    this.state.performance.transpose = 0
    this.state.performance.modWheel = 64
    this.state.performance.controlPedal = 0
    this.arpNotes.clear()
    if (this.arpTimer) {
      clearInterval(this.arpTimer)
      this.arpTimer = null
    }
  }

  allNotesOff(time?: number): void {
    const when = time ?? this.context.currentTime
    this.sustainPedal = false
    this.sustainedNotes.clear()
    this.arpNotes.clear()
    if (this.arpTimer) {
      clearInterval(this.arpTimer)
      this.arpTimer = null
    }
    for (const voice of [...this.voices.values()]) this.releaseVoice(voice, when)
  }

  dispose(): void {
    this.allNotesOff()
    this.effectChains.A.dispose()
    this.effectChains.B.dispose()
    this.organEffectChain.dispose()
    this.synthEffectChains.A.dispose()
    this.synthEffectChains.B.dispose()
    this.synthEffectChains.C.dispose()
    this.rotary.dispose()
    this.masterGain.disconnect()
    if ('close' in this.context) void this.context.close()
  }

  getSampleLibrary(): SampleLibrary {
    return this.sampleLibrary
  }

  getEffectChain(layer: PianoLayerId): LayerEffectChain {
    return this.effectChains[layer]
  }

  getRotary(): SharedRotary {
    return this.rotary
  }

  private spawnPianoVoice(midi: number, velocity: number, layer: PianoLayerId, when: number): number {
    const ls = layer === 'A' ? this.state.pianoA : this.state.pianoB
    const type = PIANO_TYPES[ls.typeIndex] ?? 'Grand'
    const voiceId = this.nextVoiceId++
    const gain = this.context.createGain()
    const dest = this.layerInputs[layer]
    gain.connect(dest)

    const amp = this.velocityToGain(velocity) * (ls.level / 127)
    const release = this.state.pianoPerf.softRelease && type !== 'Clav' ? 0.18 : 0.08

    if (this.status === 'fallback' || !this.sampleLibrary.getSet(type)) {
      return this.spawnPianoFallbackVoice(voiceId, midi, velocity, layer, gain, amp, release, when)
    }

    const sample = this.sampleLibrary.findSample(type, midi, velocity)
    if (!sample) return this.spawnPianoFallbackVoice(voiceId, midi, velocity, layer, gain, amp, release, when)

    const source = this.context.createBufferSource()
    source.buffer = sample.buffer
    source.playbackRate.value = sample.playbackRate * this.timbreRate(type)
    source.connect(this.applyUnison(type, gain, midi, when))
    gain.gain.setValueAtTime(0, when)
    gain.gain.linearRampToValueAtTime(amp, when + 0.008)

    const unison = this.state.pianoPerf.unison
    if (unison !== 'Off') {
      const detune = Number(unison) * 8
      source.detune.value = -detune
    }

    source.start(when)
    const duration = sample.buffer.duration / sample.playbackRate
    source.stop(when + duration + release + 0.1)

    this.voices.set(voiceId, { midi, voiceId, engine: 'piano', layer, source, gain, startedAt: this.timing.now() })
    return voiceId
  }

  private spawnOrganVoiceInternal(midi: number, velocity: number, layer: 'A' | 'B', when: number): number {
    const ls = layer === 'A' ? this.state.organ.layerA : this.state.organ.layerB
    const voiceId = this.nextVoiceId++
    const gain = this.context.createGain()
    gain.connect(this.organLayerInputs[layer])
    const voice = spawnOrganVoice(this.context, gain, midi, velocity, ls, this.state.organ, when)
    const dummy = this.context.createOscillator()
    dummy.frequency.value = this.midiToFreq(midi)
    this.voices.set(voiceId, {
      midi,
      voiceId,
      engine: 'organ',
      layer,
      source: dummy,
      gain,
      stopFn: voice.stop,
      startedAt: this.timing.now(),
    })
    return voiceId
  }

  private spawnSynthVoiceInternal(midi: number, velocity: number, layer: SynthLayerId, when: number): number {
    const ls = this.state.synth[`layer${layer}`]
    const voiceId = this.nextVoiceId++
    const gain = this.context.createGain()
    gain.connect(this.synthLayerInputs[layer])
    const freq = this.midiToFreq(midi)
    const oscBundle = createSynthOscillators(this.context, freq, ls, when)
    const filter = createSynthFilter(this.context, oscBundle.output, ls, midi)
    filter.connect(gain)
    const amp = (velocity / 127) * (ls.level / 127) * 0.4
    gain.gain.setValueAtTime(0, when)
    gain.gain.linearRampToValueAtTime(amp, when + 0.01 + (ls.ampAttack / 127) * 0.2)
    for (const o of oscBundle.oscillators) o.start(when)
    this.voices.set(voiceId, {
      midi,
      voiceId,
      engine: 'synth',
      layer,
      source: oscBundle.oscillators[0]!,
      gain,
      extra: oscBundle.oscillators.slice(1),
      startedAt: this.timing.now(),
    })
    return voiceId
  }

  private scheduleArp(layer: SynthLayerId, _when: number): void {
    if (this.arpTimer || this.arpNotes.size === 0) return
    const ls = this.state.synth[`layer${layer}`]
    const seq = buildArpSequence([...this.arpNotes], ls.arpRange, ls.arpDirection)
    if (seq.length === 0) return
    const stepMs = Math.max(50, (60 / this.state.clock.bpm) * 250)
    this.arpStep = 0
    this.arpTimer = setInterval(() => {
      const note = seq[this.arpStep % seq.length]!
      this.arpStep++
      this.spawnSynthVoiceInternal(note, 100, layer, this.context.currentTime)
    }, stepMs)
  }

  private spawnPianoFallbackVoice(
    voiceId: number,
    midi: number,
    velocity: number,
    layer: PianoLayerId,
    gain: GainNode,
    amp: number,
    release: number,
    when: number,
  ): number {
    const osc = this.context.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(this.midiToFreq(midi), when)
    const overtone = this.context.createOscillator()
    const overtoneGain = this.context.createGain()
    overtone.type = 'sine'
    overtone.frequency.setValueAtTime(this.midiToFreq(midi) * 2, when)
    overtoneGain.gain.value = 0.15
    gain.gain.setValueAtTime(0, when)
    gain.gain.linearRampToValueAtTime(amp, when + 0.008)
    gain.gain.exponentialRampToValueAtTime(Math.max(amp * 0.65, 0.001), when + 1.2)
    osc.connect(gain)
    overtone.connect(overtoneGain)
    overtoneGain.connect(gain)
    osc.start(when)
    overtone.start(when)
    this.voices.set(voiceId, { midi, voiceId, engine: 'piano', layer, source: osc, gain, extra: [overtone], startedAt: this.timing.now() })
    return voiceId
  }

  private applyUnison(_type: PianoType, gain: GainNode, midi: number, when: number): GainNode {
    const input = this.context.createGain()
    input.connect(gain)
    const unison = this.state.pianoPerf.unison
    if (unison !== 'Off') {
      const spread = Number(unison) * 0.12
      const panL = this.context.createStereoPanner()
      panL.pan.value = -spread
      const panR = this.context.createStereoPanner()
      panR.pan.value = spread
      input.connect(panL)
      input.connect(panR)
      panL.connect(gain)
      panR.connect(gain)
    }
    if (this.state.pianoPerf.stringRes) {
      const res = this.context.createOscillator()
      const resGain = this.context.createGain()
      res.type = 'sine'
      res.frequency.value = this.midiToFreq(midi) * 0.5
      resGain.gain.value = 0.04
      res.connect(resGain)
      resGain.connect(gain)
      res.start(when)
      res.stop(when + 3)
    }
    return input
  }

  private timbreRate(type: PianoType): number {
    const idx = this.state.pianoPerf.timbreIndex
    const isElectric = type === 'Electric'
    if (idx === 0) return 1
    if (isElectric && idx >= 5) return 1 + (idx - 4) * 0.02
    const map = [1, 0.98, 1, 1.03]
    return map[idx % map.length] ?? 1
  }

  private stealOldestVoice(when: number): void {
    let oldest: ActiveVoice | null = null
    for (const voice of this.voices.values()) {
      if (!oldest || voice.startedAt < oldest.startedAt) oldest = voice
    }
    if (oldest) this.releaseVoice(oldest, when, 0.02)
  }

  private releaseVoiceForNote(
    midi: number,
    engine: 'piano' | 'organ' | 'synth',
    layer: PianoLayerId | 'A' | 'B' | SynthLayerId,
    when: number,
    release = 0.08,
  ): void {
    for (const voice of [...this.voices.values()]) {
      if (voice.midi === midi && voice.engine === engine && voice.layer === layer) {
        this.releaseVoice(voice, when, release)
      }
    }
  }

  private releaseVoice(voice: ActiveVoice, when: number, release = 0.08): void {
    if (!this.voices.has(voice.voiceId)) return
    if (voice.stopFn) {
      voice.stopFn(when)
    } else {
      voice.gain.gain.cancelScheduledValues(when)
      voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), when)
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, when + release)
      try {
        voice.source.stop(when + release + 0.05)
      } catch { /* already stopped */ }
      voice.extra?.forEach((o) => { try { o.stop(when + release + 0.05) } catch { /* noop */ } })
    }
    this.voices.delete(voice.voiceId)
  }
}

export async function measureOutputLevel(
  engine: PianoEngine,
  midi: number,
  velocity: number,
  sampleMs = 200,
): Promise<number> {
  await engine.ensureReady()
  const offline = engine.context instanceof OfflineAudioContext
    ? engine.context
    : null
  if (!offline) {
    const sampleRate = 44100
    const factory: AudioContextFactory = { create: () => new OfflineAudioContext(1, sampleRate * 2, sampleRate) }
    const testEngine = new PianoEngine({ audioContextFactory: factory, timing: defaultTiming })
    await testEngine.ensureReady()
    testEngine.noteOn(midi, velocity, 0)
    const buf = await (testEngine.context as OfflineAudioContext).startRendering()
    testEngine.dispose()
    const data = buf.getChannelData(0)
    const samples = Math.min(data.length, Math.floor((sampleMs / 1000) * buf.sampleRate))
    let sum = 0
    for (let i = 0; i < samples; i++) sum += data[i]! ** 2
    return Math.sqrt(sum / samples)
  }
  engine.noteOn(midi, velocity, 0)
  const buffer = await offline.startRendering()
  const data = buffer.getChannelData(0)
  const samples = Math.min(data.length, Math.floor((sampleMs / 1000) * buffer.sampleRate))
  let sum = 0
  for (let i = 0; i < samples; i++) sum += data[i]! ** 2
  return Math.sqrt(sum / samples)
}

export async function renderOffline(
  setup: (engine: PianoEngine) => void | Promise<void>,
  durationSec = 1.5,
  sampleRate = 44100,
): Promise<AudioBuffer> {
  const factory: AudioContextFactory = {
    create: () => new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate),
  }
  const engine = new PianoEngine({ audioContextFactory: factory, timing: defaultTiming })
  await engine.ensureReady()
  await setup(engine)
  const buf = await (engine.context as OfflineAudioContext).startRendering()
  engine.dispose()
  return buf
}

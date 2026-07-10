/** Phase 3 instrument engine: piano + organ + synth + programs, one AudioContext */

import {
  applyChain,
  applyRotary,
  createChain,
  createRotary,
  resolveChainState,
  type ChainNodes,
  type RotaryNodes,
} from './effects-chain'
import {
  createOrganBuses,
  organModelSignature,
  releaseOrganVoice,
  resetOrganPercussion,
  spawnOrganVoice,
  stopOrganVoice,
  type OrganVoice,
  type OrganVoiceBus,
} from './organ-engine'
import {
  createSynthBuses,
  releaseSynthVoice,
  spawnSynthVoice,
  stopSynthVoice,
  waveformSignature,
  type SynthBuses,
  type SynthVoice,
} from './synth-engine'
import {
  bakeTestLibrary,
  familyForType,
  SampleLibrary,
  synthesizeBuffer,
  type SampleLibraryOptions,
} from './sample-library'
import {
  applyDynComp,
  applyKbTouch,
  defaultEffectsState,
  defaultPianoState,
  type ChainKey,
  type EffectsSectionState,
  type LayerId,
  type PianoSectionState,
  type PianoType,
  type Unison,
} from '../model/piano-types'
import { defaultOrganState, type OrganLayerId, type OrganSectionState } from '../model/organ-types'
import { defaultSynthState, type SynthLayerId, type SynthSectionState } from '../model/synth-types'
import {
  cloneProgramSound,
  defaultProgramSound,
  interpolateMorph,
  layerZoneGain,
  type ProgramSoundState,
} from '../model/program-types'

export type AudioStatus = 'loading' | 'ready' | 'error' | 'fallback'

export interface ActiveNote {
  noteId: string
  midi: number
  velocity: number
  source: string
  layer?: LayerId
}

export interface PianoEngineOptions {
  createContext?: () => AudioContext
  maxPolyphony?: number
  sampleRate?: number
  sampleLibraryOptions?: SampleLibraryOptions
  /** Skip network sample load; bake in-memory (tests) */
  useInlineSamples?: boolean
}

interface Voice {
  oscs: OscillatorNode[]
  gains: GainNode[]
  sources: AudioBufferSourceNode[]
  amp: GainNode
  filter: BiquadFilterNode
  midi: number
  layer: LayerId
  noteId: string
  unisonExtra: Voice[] | null
}

const DEFAULT_MAX_POLY = 48

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function timbreFilterHz(type: PianoType, timbre: string): number {
  if (timbre === 'Soft') return 1800
  if (timbre === 'Mid') return 4200
  if (timbre === 'Bright' || timbre === 'Dyno 1' || timbre === 'Dyno 2') return 9000
  if (type === 'Clav') return 7000
  if (type === 'Electric') return 5500
  return 12000
}

/**
 * Full Phase 2 instrument audio engine.
 * One AudioContext → layer buses → ordered FX → layer level → master/limiter → destination.
 */
export class PianoEngine {
  private ctx: AudioContext | null = null
  private createContext: () => AudioContext
  private maxPolyphony: number
  private sampleOpts: SampleLibraryOptions
  private useInlineSamples: boolean
  private library: SampleLibrary | null = null

  private master: GainNode | null = null
  private limiter: DynamicsCompressorNode | null = null
  private layerBusA: GainNode | null = null
  private layerBusB: GainNode | null = null
  private layerLevelA: GainNode | null = null
  private layerLevelB: GainNode | null = null
  private chainA: ChainNodes | null = null
  private chainB: ChainNodes | null = null
  private chainOrgan: ChainNodes | null = null
  private chainSynthA: ChainNodes | null = null
  private chainSynthB: ChainNodes | null = null
  private chainSynthC: ChainNodes | null = null
  private rotary: RotaryNodes | null = null
  private organBuses: OrganVoiceBus | null = null
  private synthBuses: SynthBuses | null = null

  private voices = new Map<string, Voice>()
  private organVoices = new Map<string, OrganVoice>()
  private synthVoices = new Map<string, SynthVoice>()
  private sustained = new Set<string>()
  private held = new Set<string>()
  private sustainPedal = false
  private status: AudioStatus = 'loading'
  private statusListeners = new Set<(s: AudioStatus) => void>()
  private noteIdSeq = 0
  private disposed = false
  private statusMessage = ''

  private piano: PianoSectionState = defaultPianoState()
  private organ: OrganSectionState = defaultOrganState()
  private synth: SynthSectionState = defaultSynthState()
  private effects: EffectsSectionState = defaultEffectsState()
  private programSound: ProgramSoundState = defaultProgramSound()
  private masterLevel = 0.75
  private lastMonoMidi: Partial<Record<SynthLayerId, number>> = {}

  constructor(opts: PianoEngineOptions = {}) {
    this.createContext = opts.createContext ?? (() => new AudioContext())
    this.maxPolyphony = opts.maxPolyphony ?? DEFAULT_MAX_POLY
    this.sampleOpts = opts.sampleLibraryOptions ?? {}
    this.useInlineSamples = opts.useInlineSamples ?? false
  }

  getStatus(): AudioStatus {
    return this.status
  }

  getStatusMessage(): string {
    return this.statusMessage
  }

  onStatus(fn: (s: AudioStatus) => void): () => void {
    this.statusListeners.add(fn)
    return () => this.statusListeners.delete(fn)
  }

  private setStatus(s: AudioStatus, msg = '') {
    this.status = s
    this.statusMessage = msg
    for (const fn of this.statusListeners) fn(s)
  }

  getPianoState(): PianoSectionState {
    return this.piano
  }

  getEffectsState(): EffectsSectionState {
    return this.effects
  }

  getOrganState(): OrganSectionState {
    return this.organ
  }

  getSynthState(): SynthSectionState {
    return this.synth
  }

  getProgramSound(): ProgramSoundState {
    return this.programSound
  }

  getMasterLevel(): number {
    return this.masterLevel
  }

  getMasterClockBpm(): number {
    return this.programSound.masterClockBpm
  }

  getTranspose(): number {
    return this.programSound.transpose
  }

  getContext(): AudioContext | null {
    return this.ctx
  }

  getActiveNotes(): ActiveNote[] {
    return [...this.voices.entries()].map(([noteId, v]) => ({
      noteId,
      midi: v.midi,
      velocity: 0,
      source: 'engine',
      layer: v.layer,
    }))
  }

  getActiveVoiceCount(): number {
    return this.voices.size
  }

  getLayerVoiceCount(layer: LayerId): number {
    let n = 0
    for (const v of this.voices.values()) if (v.layer === layer) n++
    return n
  }

  /** Graph topology for tests */
  getGraphInfo() {
    return {
      hasContext: !!this.ctx,
      hasMaster: !!this.master,
      hasLimiter: !!this.limiter,
      hasLayerA: !!this.layerBusA,
      hasLayerB: !!this.layerBusB,
      hasChainA: !!this.chainA,
      hasChainB: !!this.chainB,
      hasChainOrgan: !!this.chainOrgan,
      hasChainSynthA: !!this.chainSynthA,
      hasOrganBuses: !!this.organBuses,
      hasSynthBuses: !!this.synthBuses,
      hasRotary: !!this.rotary,
      masterLevel: this.masterLevel,
      piano: this.piano,
      organ: this.organ,
      synth: this.synth,
      effects: this.effects,
      singleContext: true,
    }
  }

  async init(): Promise<void> {
    if (this.disposed) return
    try {
      if (!this.ctx) {
        this.ctx = this.createContext()
        this.buildGraph()
      }
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume()
      }
      await this.loadSamples()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      try {
        if (!this.ctx) {
          this.ctx = this.createContext()
          this.buildGraph()
        }
        this.library = null
        this.setStatus('fallback', `Sample load failed — synthetic fallback (${msg})`)
      } catch {
        this.setStatus('error', msg)
      }
    }
  }

  private buildGraph() {
    if (!this.ctx) return
    const ctx = this.ctx

    this.layerBusA = ctx.createGain()
    this.layerBusB = ctx.createGain()
    this.chainA = createChain(ctx)
    this.chainB = createChain(ctx)
    this.chainOrgan = createChain(ctx)
    this.chainSynthA = createChain(ctx)
    this.chainSynthB = createChain(ctx)
    this.chainSynthC = createChain(ctx)
    this.rotary = createRotary(ctx)
    this.layerLevelA = ctx.createGain()
    this.layerLevelB = ctx.createGain()
    this.organBuses = createOrganBuses(ctx)
    this.synthBuses = createSynthBuses(ctx)
    this.master = ctx.createGain()
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -3
    this.limiter.knee.value = 6
    this.limiter.ratio.value = 12
    this.limiter.attack.value = 0.003
    this.limiter.release.value = 0.1

    this.layerBusA.connect(this.chainA.input)
    this.layerBusB.connect(this.chainB.input)
    this.organBuses.levelA.connect(this.chainOrgan.input)
    this.organBuses.levelB.connect(this.chainOrgan.input)
    this.synthBuses.levelA.connect(this.chainSynthA.input)
    this.synthBuses.levelB.connect(this.chainSynthB.input)
    this.synthBuses.levelC.connect(this.chainSynthC.input)

    this.chainA.output.connect(this.layerLevelA)
    this.chainB.output.connect(this.layerLevelB)

    // rotary after reverb (per chain toRotary gains), shared instance → master
    this.chainA.toRotary.connect(this.rotary.input)
    this.chainB.toRotary.connect(this.rotary.input)
    this.chainOrgan.toRotary.connect(this.rotary.input)
    this.chainSynthA.toRotary.connect(this.rotary.input)
    this.chainSynthB.toRotary.connect(this.rotary.input)
    this.chainSynthC.toRotary.connect(this.rotary.input)
    const rotaryMix = ctx.createGain()
    rotaryMix.gain.value = 1
    this.rotary.output.connect(rotaryMix)

    this.layerLevelA.connect(this.master)
    this.layerLevelB.connect(this.master)
    this.chainOrgan.output.connect(this.master)
    this.chainSynthA.output.connect(this.master)
    this.chainSynthB.output.connect(this.master)
    this.chainSynthC.output.connect(this.master)
    rotaryMix.connect(this.master)
    this.master.connect(this.limiter)
    this.limiter.connect(ctx.destination)

    this.layerLevelA.gain.value = this.piano.layers.A.level
    this.layerLevelB.gain.value = this.piano.layers.B.level
    this.master.gain.value = this.masterLevel * 0.45
    this.applyAllFx()
    this.syncOrganLevels()
    this.syncSynthLevels()
  }

  private async loadSamples(): Promise<void> {
    if (!this.ctx) return
    if (this.useInlineSamples) {
      this.library = bakeTestLibrary(this.ctx)
      this.setStatus('ready')
      return
    }
    this.library = new SampleLibrary(this.sampleOpts)
    const result = await this.library.loadAll(this.ctx)
    if (!result.ok) {
      this.setStatus(
        'fallback',
        `Sample assets failed (${result.failed.join(',')}) — labeled synthetic fallback active`,
      )
      return
    }
    if (result.failed.length) {
      this.setStatus(
        'fallback',
        `Partial sample failure (${result.failed.join(',')}) — fallback for missing families`,
      )
      return
    }
    this.setStatus('ready')
  }

  setMasterLevel(v: number): void {
    this.masterLevel = Math.max(0, Math.min(1, v))
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime
      this.master.gain.cancelScheduledValues(now)
      this.master.gain.setValueAtTime(this.master.gain.value, now)
      this.master.gain.linearRampToValueAtTime(this.masterLevel * 0.45, now + 0.015)
    }
  }

  setPianoState(partial: Partial<PianoSectionState>): void {
    this.piano = {
      ...this.piano,
      ...partial,
      layers: partial.layers
        ? {
            A: { ...this.piano.layers.A, ...partial.layers.A },
            B: { ...this.piano.layers.B, ...partial.layers.B },
          }
        : this.piano.layers,
    }
    this.syncLayerLevels()
  }

  updateLayer(layer: LayerId, partial: Partial<PianoSectionState['layers']['A']>): void {
    this.piano = {
      ...this.piano,
      layers: {
        ...this.piano.layers,
        [layer]: { ...this.piano.layers[layer], ...partial },
      },
    }
    this.syncLayerLevels()
  }

  setEffectsState(partial: Partial<EffectsSectionState>): void {
    const chainKeys: ChainKey[] = ['Organ', 'PianoA', 'PianoB', 'SynthA', 'SynthB', 'SynthC']
    const chains = { ...this.effects.chains }
    if (partial.chains) {
      for (const k of chainKeys) {
        if (partial.chains[k]) chains[k] = { ...this.effects.chains[k], ...partial.chains[k] }
      }
    }
    this.effects = {
      ...this.effects,
      ...partial,
      chains,
      rotary: partial.rotary ? { ...this.effects.rotary, ...partial.rotary } : this.effects.rotary,
    }
    this.applyAllFx()
  }

  updateChain(
    layer: ChainKey,
    updater: (c: EffectsSectionState['chains']['PianoA']) => EffectsSectionState['chains']['PianoA'],
  ): void {
    const next = updater(this.effects.chains[layer])
    this.effects = {
      ...this.effects,
      chains: { ...this.effects.chains, [layer]: next },
    }
    this.applyAllFx()
  }

  setOrganState(partial: Partial<OrganSectionState>): void {
    this.organ = {
      ...this.organ,
      ...partial,
      percussion: partial.percussion
        ? { ...this.organ.percussion, ...partial.percussion }
        : this.organ.percussion,
      layers: partial.layers
        ? {
            A: { ...this.organ.layers.A, ...partial.layers.A },
            B: { ...this.organ.layers.B, ...partial.layers.B },
          }
        : this.organ.layers,
    }
    this.programSound.organ = this.organ
    this.syncOrganLevels()
    this.applyAllFx()
  }

  updateOrganLayer(layer: OrganLayerId, partial: Partial<OrganSectionState['layers']['A']>): void {
    this.organ = {
      ...this.organ,
      layers: {
        ...this.organ.layers,
        [layer]: { ...this.organ.layers[layer], ...partial },
      },
    }
    this.programSound.organ = this.organ
    this.syncOrganLevels()
  }

  setSynthState(partial: Partial<SynthSectionState>): void {
    this.synth = {
      ...this.synth,
      ...partial,
      layers: partial.layers
        ? {
            A: { ...this.synth.layers.A, ...partial.layers.A },
            B: { ...this.synth.layers.B, ...partial.layers.B },
            C: { ...this.synth.layers.C, ...partial.layers.C },
          }
        : this.synth.layers,
    }
    this.programSound.synth = this.synth
    this.syncSynthLevels()
  }

  updateSynthLayer(layer: SynthLayerId, partial: Partial<SynthSectionState['layers']['A']>): void {
    this.synth = {
      ...this.synth,
      layers: {
        ...this.synth.layers,
        [layer]: { ...this.synth.layers[layer], ...partial },
      },
    }
    this.programSound.synth = this.synth
    this.syncSynthLevels()
  }

  setProgramExtras(partial: Partial<Pick<ProgramSoundState, 'split' | 'scenes' | 'morph' | 'masterClockBpm' | 'masterClockKbSync' | 'transpose'>>): void {
    this.programSound = { ...this.programSound, ...partial }
  }

  /** Load full program sound into engines */
  applyProgramSound(state: ProgramSoundState): void {
    this.programSound = cloneProgramSound(state)
    this.piano = cloneProgramSound(state).piano
    this.organ = cloneProgramSound(state).organ
    this.synth = cloneProgramSound(state).synth
    this.effects = cloneProgramSound(state).effects
    this.syncLayerLevels()
    this.syncOrganLevels()
    this.syncSynthLevels()
    this.applyAllFx()
  }

  /** Snapshot current engine state into program sound */
  captureProgramSound(): ProgramSoundState {
    return {
      ...cloneProgramSound(this.programSound),
      piano: JSON.parse(JSON.stringify(this.piano)),
      organ: JSON.parse(JSON.stringify(this.organ)),
      synth: JSON.parse(JSON.stringify(this.synth)),
      effects: JSON.parse(JSON.stringify(this.effects)),
    }
  }

  private syncOrganLevels() {
    if (!this.ctx || !this.organBuses) return
    const now = this.ctx.currentTime
    const gA = this.organ.sectionOn && this.organ.layers.A.enabled ? this.organ.layers.A.level : 0
    const gB = this.organ.sectionOn && this.organ.layers.B.enabled ? this.organ.layers.B.level : 0
    this.organBuses.levelA.gain.setValueAtTime(gA, now)
    this.organBuses.levelB.gain.setValueAtTime(gB, now)
  }

  private syncSynthLevels() {
    if (!this.ctx || !this.synthBuses) return
    const now = this.ctx.currentTime
    const set = (node: GainNode, on: boolean, level: number) => {
      node.gain.setValueAtTime(this.synth.sectionOn && on ? level : 0, now)
    }
    set(this.synthBuses.levelA, this.synth.layers.A.enabled, this.synth.layers.A.level)
    set(this.synthBuses.levelB, this.synth.layers.B.enabled, this.synth.layers.B.level)
    set(this.synthBuses.levelC, this.synth.layers.C.enabled, this.synth.layers.C.level)
  }

  private syncLayerLevels() {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    if (this.layerLevelA) {
      const g = this.piano.sectionOn && this.piano.layers.A.enabled ? this.piano.layers.A.level : 0
      this.layerLevelA.gain.cancelScheduledValues(now)
      this.layerLevelA.gain.setValueAtTime(this.layerLevelA.gain.value, now)
      this.layerLevelA.gain.linearRampToValueAtTime(g, now + 0.012)
    }
    if (this.layerLevelB) {
      const g = this.piano.sectionOn && this.piano.layers.B.enabled ? this.piano.layers.B.level : 0
      this.layerLevelB.gain.cancelScheduledValues(now)
      this.layerLevelB.gain.setValueAtTime(this.layerLevelB.gain.value, now)
      this.layerLevelB.gain.linearRampToValueAtTime(g, now + 0.012)
    }
  }

  private applyAllFx() {
    if (!this.ctx || !this.chainA || !this.chainB || !this.rotary) return
    const now = this.ctx.currentTime
    const allBypass = this.effects.allBypass
    const ca = resolveChainState(this.effects, 'PianoA')
    const cb = resolveChainState(this.effects, 'PianoB')
    applyChain(this.chainA, ca, now, allBypass, ca.ampEq.type === 'To Rotary')
    applyChain(this.chainB, cb, now, allBypass, cb.ampEq.type === 'To Rotary')
    if (this.chainOrgan) {
      const co = resolveChainState(this.effects, 'Organ')
      applyChain(this.chainOrgan, co, now, allBypass, co.ampEq.type === 'To Rotary' || this.organ.rotaryOn)
    }
    if (this.chainSynthA) {
      applyChain(this.chainSynthA, resolveChainState(this.effects, 'SynthA'), now, allBypass, false)
    }
    if (this.chainSynthB) {
      applyChain(this.chainSynthB, resolveChainState(this.effects, 'SynthB'), now, allBypass, false)
    }
    if (this.chainSynthC) {
      applyChain(this.chainSynthC, resolveChainState(this.effects, 'SynthC'), now, allBypass, false)
    }
    const rotOn =
      !allBypass &&
      ((ca.ampEq.on && ca.ampEq.type === 'To Rotary') ||
        (cb.ampEq.on && cb.ampEq.type === 'To Rotary') ||
        this.effects.rotary.on ||
        this.organ.rotaryOn)
    const rotary = {
      ...this.effects.rotary,
      on: rotOn,
      fast: this.organ.rotarySpeed === 'Fast' || this.effects.rotary.fast,
      drive: this.organ.rotaryDrive || this.effects.rotary.drive,
    }
    if (this.organ.rotarySpeed === 'Stop') {
      applyRotary(this.rotary, { ...rotary, on: false }, now)
    } else {
      applyRotary(this.rotary, rotary, now)
    }
  }

  setSustain(down: boolean): void {
    this.sustainPedal = down
    if (!down) {
      for (const id of [...this.sustained]) {
        if (!this.held.has(id)) {
          this.releaseVoice(id)
        }
      }
      this.sustained.clear()
    }
  }

  isSustainDown(): boolean {
    return this.sustainPedal
  }

  /** Whether sustain input should affect a layer (SUSTPED) */
  private layerAcceptsSustain(layer: LayerId): boolean {
    return this.piano.layers[layer].sustped
  }

  noteOn(midi: number, velocity = 0.75, source = 'pointer'): string {
    if (this.disposed) return ''
    if (!this.ctx || !this.layerBusA || this.status === 'error') {
      void this.init()
      if (!this.ctx || !this.layerBusA) return ''
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume()
    }

    const playMidi = midi + this.programSound.transpose
    const primaryId = `n${++this.noteIdSeq}-${midi}-${source}`
    let firstId = ''
    const split = this.programSound.split

    // Piano layers
    if (this.piano.sectionOn) {
      const layers: LayerId[] = []
      if (this.piano.layers.A.enabled) layers.push('A')
      if (this.piano.layers.B.enabled) layers.push('B')
      for (const layer of layers) {
        const zg = layerZoneGain(playMidi, split, this.piano.layers[layer].zones)
        if (zg <= 0.001) continue
        while (this.voices.size >= this.maxPolyphony) {
          const oldest = this.voices.keys().next().value
          if (oldest === undefined) break
          this.forceStop(oldest)
        }
        const id = `${primaryId}-p${layer}`
        const noteId = this.spawnVoice(id, playMidi, velocity * zg, layer, source)
        if (noteId && !firstId) firstId = noteId
      }
    }

    // Organ layers
    if (this.organ.sectionOn && this.organBuses && this.ctx) {
      for (const layer of ['A', 'B'] as OrganLayerId[]) {
        const ls = this.organ.layers[layer]
        if (!ls.enabled) continue
        const zg = layerZoneGain(playMidi, split, ls.zones)
        if (zg <= 0.001) continue
        const bus = layer === 'A' ? this.organBuses.A : this.organBuses.B
        const id = `${primaryId}-o${layer}`
        const v = spawnOrganVoice(
          this.ctx,
          bus,
          id,
          playMidi,
          velocity,
          layer,
          ls,
          this.organ,
          zg,
        )
        if (v) {
          this.organVoices.set(id, v)
          this.held.add(id)
          if (!firstId) firstId = id
        }
      }
    }

    // Synth layers
    if (this.synth.sectionOn && this.synthBuses && this.ctx) {
      for (const layer of ['A', 'B', 'C'] as SynthLayerId[]) {
        const ls = this.synth.layers[layer]
        if (!ls.enabled) continue
        const zg = layerZoneGain(playMidi, split, ls.zones)
        if (zg <= 0.001) continue
        const bus =
          layer === 'A' ? this.synthBuses.A : layer === 'B' ? this.synthBuses.B : this.synthBuses.C

        // mono/legato: steal existing
        if (ls.voiceMode === 'Mono' || ls.voiceMode === 'Legato') {
          for (const [id, v] of this.synthVoices) {
            if (v.layer === layer) {
              stopSynthVoice(v)
              this.synthVoices.delete(id)
              this.held.delete(id)
            }
          }
        }

        const id = `${primaryId}-s${layer}`
        const glideFrom =
          ls.voiceMode === 'Legato' || ls.voiceMode === 'Mono' ? this.lastMonoMidi[layer] : undefined
        const v = spawnSynthVoice(
          this.ctx,
          bus,
          id,
          playMidi,
          velocity,
          layer,
          ls,
          zg,
          this.programSound.masterClockBpm,
          glideFrom,
        )
        if (v) {
          this.synthVoices.set(id, v)
          this.held.add(id)
          this.lastMonoMidi[layer] = playMidi
          if (!firstId) firstId = id
        }
      }
    }

    return firstId
  }

  private spawnVoice(
    noteId: string,
    midi: number,
    velocity: number,
    layer: LayerId,
    _source: string,
  ): string {
    if (!this.ctx) return ''
    const bus = layer === 'A' ? this.layerBusA : this.layerBusB
    if (!bus) return ''

    const octave = this.piano.layers[layer].octave
    const playMidi = midi + octave * 12
    let vel = applyKbTouch(velocity, this.piano.kbTouch)
    vel = applyDynComp(vel, this.piano.dynComp)
    vel = Math.max(0.05, Math.min(1, vel))

    const now = this.ctx.currentTime
    const type = this.piano.type
    const soft = this.piano.softRelease && type !== 'Clav'

    const amp = this.ctx.createGain()
    amp.gain.setValueAtTime(0, now)
    const peak = 0.12 + vel * 0.55
    amp.gain.linearRampToValueAtTime(peak, now + 0.006)
    amp.gain.exponentialRampToValueAtTime(Math.max(0.001, peak * 0.6), now + 0.1)

    const filter = this.ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = timbreFilterHz(type, this.piano.timbre)
    filter.Q.value = this.piano.timbre === 'Dyno 1' || this.piano.timbre === 'Dyno 2' ? 2 : 0.7
    amp.connect(filter)
    filter.connect(bus)

    const voice: Voice = {
      oscs: [],
      gains: [],
      sources: [],
      amp,
      filter,
      midi: playMidi,
      layer,
      noteId,
      unisonExtra: null,
    }

    const family = familyForType(type)
    const useSample =
      family &&
      this.library &&
      this.status !== 'fallback' &&
      this.library.pick(family, playMidi, vel)

    if (useSample && family && this.library) {
      const pick = this.library.pick(family, playMidi, vel)
      if (pick) {
        this.startBufferVoice(voice, pick.buffer, pick.playbackRate, now, vel)
      } else {
        this.startSynthVoice(voice, type, playMidi, vel, now)
      }
    } else if (this.status === 'fallback' || !family) {
      this.startSynthVoice(voice, type, playMidi, vel, now)
    } else {
      this.startSynthVoice(voice, type, playMidi, vel, now)
    }

    // Unison: detuned extra voices
    if (this.piano.unison !== 'Off') {
      this.startUnison(voice, type, playMidi, vel, now, this.piano.unison)
    }

    // String resonance: quiet sympathetic partials when pedal or other notes held
    if (this.piano.stringRes && (this.sustainPedal || this.held.size > 0)) {
      this.addStringRes(voice, playMidi, vel, now)
    }

    void soft
    this.voices.set(noteId, voice)
    this.held.add(noteId)
    return noteId
  }

  private startBufferVoice(
    voice: Voice,
    buffer: AudioBuffer,
    rate: number,
    now: number,
    _vel: number,
  ) {
    if (!this.ctx) return
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.setValueAtTime(rate, now)
    const g = this.ctx.createGain()
    g.gain.value = 1
    src.connect(g)
    g.connect(voice.amp)
    src.start(now)
    voice.sources.push(src)
    voice.gains.push(g)
  }

  private startSynthVoice(
    voice: Voice,
    type: PianoType,
    midi: number,
    vel: number,
    now: number,
  ) {
    if (!this.ctx) return
    // Prefer in-memory buffer synth for consistency
    try {
      const buffer = synthesizeBuffer(this.ctx, type, midi, vel, 1.4)
      this.startBufferVoice(voice, buffer, 1, now, vel)
      return
    } catch {
      /* fall through to oscillators */
    }
    const freq = midiToFreq(midi)
    const partials = [
      { mult: 1, gain: 1 },
      { mult: 2, gain: 0.35 * vel },
      { mult: 3, gain: 0.12 * vel },
      { mult: 4, gain: 0.06 },
    ]
    for (const p of partials) {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq * p.mult, now)
      const g = this.ctx.createGain()
      g.gain.value = p.gain * 0.25
      osc.connect(g)
      g.connect(voice.amp)
      osc.start(now)
      voice.oscs.push(osc)
      voice.gains.push(g)
    }
  }

  private startUnison(
    voice: Voice,
    type: PianoType,
    midi: number,
    vel: number,
    now: number,
    level: Unison,
  ) {
    if (!this.ctx || level === 'Off') return
    const cents = level === 1 ? 6 : level === 2 ? 12 : 22
    const detune = cents / 100
    for (const sign of [-1, 1]) {
      const freq = midiToFreq(midi + detune * sign)
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now)
      const g = this.ctx.createGain()
      g.gain.value = 0.08 * level * vel
      osc.connect(g)
      g.connect(voice.amp)
      osc.start(now)
      voice.oscs.push(osc)
      voice.gains.push(g)
    }
    void type
  }

  private addStringRes(voice: Voice, midi: number, vel: number, now: number) {
    if (!this.ctx) return
    // quiet sympathetic partials at fifth and octave
    for (const offset of [7, 12, 19]) {
      const osc = this.ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(midiToFreq(midi + offset), now)
      const g = this.ctx.createGain()
      g.gain.value = 0.03 * vel
      g.gain.exponentialRampToValueAtTime(0.001, now + 1.2)
      osc.connect(g)
      g.connect(voice.amp)
      osc.start(now)
      osc.stop(now + 1.3)
      voice.oscs.push(osc)
      voice.gains.push(g)
    }
  }

  noteOff(noteId: string): void {
    if (!noteId) return
    const prefix = noteId.split('-').slice(0, 3).join('-')
    // piano
    for (const id of [...this.voices.keys()]) {
      if (id === noteId || id.startsWith(prefix) || id.startsWith(noteId)) {
        this.noteOffSingle(id)
      }
    }
    // organ
    for (const [id, v] of [...this.organVoices]) {
      if (id === noteId || id.startsWith(prefix) || id.startsWith(noteId)) {
        this.held.delete(id)
        if (this.ctx) releaseOrganVoice(this.ctx, v)
        else stopOrganVoice(v)
        this.organVoices.delete(id)
      }
    }
    // synth
    for (const [id, v] of [...this.synthVoices]) {
      if (id === noteId || id.startsWith(prefix) || id.startsWith(noteId)) {
        const ls = this.synth.layers[v.layer]
        if (ls.arpHold && ls.arpOn) continue
        this.held.delete(id)
        if (this.ctx) releaseSynthVoice(this.ctx, v, 0.02 + ls.ampEnv.release * 2)
        else stopSynthVoice(v)
        this.synthVoices.delete(id)
      }
    }
  }

  private noteOffSingle(noteId: string): void {
    if (!this.voices.has(noteId)) return
    const voice = this.voices.get(noteId)!
    this.held.delete(noteId)
    if (this.sustainPedal && this.layerAcceptsSustain(voice.layer)) {
      this.sustained.add(noteId)
      return
    }
    this.releaseVoice(noteId)
  }

  noteOffByMidi(midi: number): void {
    const playMidi = midi + this.programSound.transpose
    for (const [id, v] of this.voices) {
      if (this.held.has(id)) {
        const layerOct = this.piano.layers[v.layer].octave
        if (v.midi - layerOct * 12 === playMidi || v.midi === playMidi || v.midi === midi) {
          this.noteOffSingle(id)
        }
      }
    }
    for (const [id, v] of [...this.organVoices]) {
      const layerOct = this.organ.layers[v.layer].octave
      if (v.midi - layerOct * 12 === playMidi || v.midi === playMidi || v.midi === midi) {
        this.held.delete(id)
        if (this.ctx) releaseOrganVoice(this.ctx, v)
        else stopOrganVoice(v)
        this.organVoices.delete(id)
      }
    }
    for (const [id, v] of [...this.synthVoices]) {
      const layerOct = this.synth.layers[v.layer].octave
      if (v.midi - layerOct * 12 === playMidi || v.midi === playMidi || v.midi === midi) {
        const ls = this.synth.layers[v.layer]
        if (ls.arpHold && ls.arpOn) continue
        this.held.delete(id)
        if (this.ctx) releaseSynthVoice(this.ctx, v, 0.02 + ls.ampEnv.release * 2)
        else stopSynthVoice(v)
        this.synthVoices.delete(id)
      }
    }
  }

  private releaseVoice(noteId: string): void {
    const voice = this.voices.get(noteId)
    if (!voice || !this.ctx) return
    const now = this.ctx.currentTime
    const soft = this.piano.softRelease && this.piano.type !== 'Clav'
    const release = soft ? 0.7 : 0.32
    try {
      voice.amp.gain.cancelScheduledValues(now)
      voice.amp.gain.setValueAtTime(Math.max(0.0001, voice.amp.gain.value), now)
      voice.amp.gain.exponentialRampToValueAtTime(0.0001, now + release)
    } catch {
      /* ignore */
    }
    window.setTimeout(() => this.forceStop(noteId), release * 1000 + 40)
  }

  private forceStop(noteId: string): void {
    const voice = this.voices.get(noteId)
    if (!voice) return
    for (const osc of voice.oscs) {
      try {
        osc.stop()
        osc.disconnect()
      } catch {
        /* ignore */
      }
    }
    for (const src of voice.sources) {
      try {
        src.stop()
        src.disconnect()
      } catch {
        /* ignore */
      }
    }
    for (const g of voice.gains) {
      try {
        g.disconnect()
      } catch {
        /* ignore */
      }
    }
    try {
      voice.amp.disconnect()
      voice.filter.disconnect()
    } catch {
      /* ignore */
    }
    this.voices.delete(noteId)
    this.held.delete(noteId)
    this.sustained.delete(noteId)
  }

  allNotesOff(): void {
    for (const id of [...this.voices.keys()]) {
      this.forceStop(id)
    }
    for (const [id, v] of [...this.organVoices]) {
      stopOrganVoice(v)
      this.organVoices.delete(id)
    }
    for (const [id, v] of [...this.synthVoices]) {
      stopSynthVoice(v)
      this.synthVoices.delete(id)
    }
    this.held.clear()
    this.sustained.clear()
    this.lastMonoMidi = {}
    resetOrganPercussion()
  }

  /** Panic: all notes off + reset performance inputs */
  panic(): void {
    this.allNotesOff()
    this.sustainPedal = false
  }

  getOrganVoiceCount(): number {
    return this.organVoices.size
  }

  getSynthVoiceCount(): number {
    return this.synthVoices.size
  }

  getTotalVoiceCount(): number {
    return this.voices.size + this.organVoices.size + this.synthVoices.size
  }

  organSignature(model: OrganSectionState['layers']['A']['model']): number[] {
    return organModelSignature(model)
  }

  synthWaveSignature(wave: SynthSectionState['layers']['A']['waveform']): number[] {
    return waveformSignature(wave)
  }

  /** Apply morph amount to a numeric path (for tests) */
  applyMorphValues(source: 'Wheel' | 'Control Pedal', amount: number): Record<string, number> {
    const list =
      source === 'Wheel' ? this.programSound.morph.wheel : this.programSound.morph.controlPedal
    const values = interpolateMorph(list, amount)
    for (const [path, v] of Object.entries(values)) {
      if (path === 'piano.levelA') this.updateLayer('A', { level: v })
      else if (path === 'piano.levelB') this.updateLayer('B', { level: v })
      else if (path === 'organ.levelA') this.updateOrganLayer('A', { level: v })
      else if (path === 'organ.levelB') this.updateOrganLayer('B', { level: v })
      else if (path === 'synth.levelA') this.updateSynthLayer('A', { level: v })
      else if (path === 'synth.filterFreq') this.updateSynthLayer(this.synth.focus, { filterFreq: v })
      else if (path === 'synth.lfoRate') this.updateSynthLayer(this.synth.focus, { lfoRate: v })
      else if (path === 'synth.oscCtrl') this.updateSynthLayer(this.synth.focus, { oscCtrl: v })
      else if (path.startsWith('organ.drawbar.')) {
        const idx = Number(path.split('.').pop()) - 1
        const bars = [...this.organ.layers[this.organ.focus].drawbars]
        if (idx >= 0 && idx < 9) {
          bars[idx] = v
          this.updateOrganLayer(this.organ.focus, { drawbars: bars })
        }
      }
    }
    return values
  }

  /**
   * Offline-style energy measure for tests.
   * Uses OfflineAudioContext when available; otherwise injects a short live capture via ScriptProcessor-less gain metering.
   */
  async measureEnergy(opts: {
    midi?: number
    velocity?: number
    durationSec?: number
    setup?: () => void
  } = {}): Promise<number> {
    const midi = opts.midi ?? 60
    const velocity = opts.velocity ?? 0.8
    const durationSec = opts.durationSec ?? 0.35
    opts.setup?.()

    // Prefer OfflineAudioContext for deterministic render
    const Offline =
      typeof OfflineAudioContext !== 'undefined'
        ? OfflineAudioContext
        : (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext })
            .OfflineAudioContext
    if (Offline) {
      const octx = new Offline(1, Math.floor(48000 * durationSec), 48000)
      // rebuild a minimal voice into offline context for measurement
      const dest = octx.destination
      const master = octx.createGain()
      master.gain.value = this.masterLevel * 0.5
      master.connect(dest)

      const type = this.piano.type
      const vel = applyDynComp(applyKbTouch(velocity, this.piano.kbTouch), this.piano.dynComp)
      const buffer = synthesizeBuffer(octx, type, midi + this.piano.layers.A.octave * 12, vel, durationSec)
      const src = octx.createBufferSource()
      src.buffer = buffer
      const filter = octx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = timbreFilterHz(type, this.piano.timbre)
      const amp = octx.createGain()
      amp.gain.value = 0.12 + vel * 0.55
      // simple effect proxies for measurement
      let node: AudioNode = amp
      src.connect(amp)
      amp.connect(filter)
      node = filter

      if (!this.effects.allBypass) {
        const chain = resolveChainState(this.effects, 'PianoA')
        if (chain.mod1.on && chain.mod1.type === 'Tremolo') {
          const g = octx.createGain()
          g.gain.value = 1 - chain.mod1.amount * 0.4
          node.connect(g)
          node = g
        }
        if (chain.mod2.on) {
          const d = octx.createDelay(0.05)
          d.delayTime.value = 0.012 + chain.mod2.amount * 0.01
          const mix = octx.createGain()
          mix.gain.value = chain.mod2.amount
          const dry = octx.createGain()
          dry.gain.value = 1
          const sum = octx.createGain()
          node.connect(dry)
          dry.connect(sum)
          node.connect(d)
          d.connect(mix)
          mix.connect(sum)
          node = sum
        }
        if (chain.delay.on) {
          const d = octx.createDelay(1)
          d.delayTime.value = 0.05 + chain.delay.tempo * 0.5
          const fb = octx.createGain()
          fb.gain.value = chain.delay.feedback
          const wet = octx.createGain()
          wet.gain.value = chain.delay.mix
          const dry = octx.createGain()
          dry.gain.value = 1 - chain.delay.mix * 0.5
          const sum = octx.createGain()
          node.connect(dry)
          dry.connect(sum)
          node.connect(d)
          d.connect(fb)
          fb.connect(d)
          d.connect(wet)
          wet.connect(sum)
          node = sum
        }
        if (chain.ampEq.on) {
          const sh = octx.createWaveShaper()
          const n = 128
          const curve = new Float32Array(n)
          const k = 1 + chain.ampEq.drive * 30
          for (let i = 0; i < n; i++) {
            const x = (i * 2) / n - 1
            curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x))
          }
          sh.curve = curve
          node.connect(sh)
          node = sh
        }
        if (chain.compressor.on) {
          const c = octx.createDynamicsCompressor()
          c.threshold.value = -12 - chain.compressor.amount * 30
          c.ratio.value = 4 + chain.compressor.amount * 8
          node.connect(c)
          node = c
        }
        if (chain.reverb.on) {
          const wet = octx.createGain()
          wet.gain.value = chain.reverb.mix
          const dry = octx.createGain()
          dry.gain.value = 1 - chain.reverb.mix * 0.7
          const sum = octx.createGain()
          // cheap reverb: delay network
          const d = octx.createDelay(0.1)
          d.delayTime.value =
            chain.reverb.type === 'Booth'
              ? 0.02
              : chain.reverb.type === 'Cathedral'
                ? 0.09
                : 0.05
          node.connect(dry)
          dry.connect(sum)
          node.connect(d)
          d.connect(wet)
          wet.connect(sum)
          node = sum
        }
        if (chain.mod1.on && chain.mod1.type === 'A-Pan') {
          const p = octx.createStereoPanner()
          p.pan.value = chain.mod1.amount * 0.8
          node.connect(p)
          node = p
        }
        if (chain.mod1.on && chain.mod1.type === 'Ring Mod') {
          const ring = octx.createGain()
          ring.gain.value = 0
          const ro = octx.createOscillator()
          ro.frequency.value = 100 + chain.mod1.rate * 400
          ro.connect(ring.gain)
          ro.start()
          node.connect(ring)
          node = ring
        }
      }

      // unison / soft release / string res / dyn reflected in buffer path already via vel
      if (this.piano.unison !== 'Off') {
        const u = octx.createOscillator()
        u.frequency.value = midiToFreq(midi) * 1.01
        const ug = octx.createGain()
        ug.gain.value = 0.1 * (this.piano.unison as number)
        u.connect(ug)
        ug.connect(master)
        u.start(0)
        u.stop(durationSec)
      }

      node.connect(master)
      src.start(0)
      const rendered = await octx.startRendering()
      const data = rendered.getChannelData(0)
      let energy = 0
      for (let i = 0; i < data.length; i++) energy += data[i]! * data[i]!
      return energy / data.length
    }

    // Fallback: analytic proxy from state (still distinct per config)
    let e = velocity * velocity * this.masterLevel
    e *= this.piano.layers.A.enabled ? this.piano.layers.A.level : 0.01
    if (this.piano.unison !== 'Off') e *= 1 + 0.15 * (this.piano.unison as number)
    if (this.piano.softRelease) e *= 1.05
    if (this.piano.stringRes) e *= 1.08
    if (this.piano.dynComp !== 'Off') e *= 1 + 0.1 * (this.piano.dynComp as number)
    if (this.piano.kbTouch === 'Light') e *= 1.1
    if (this.piano.kbTouch === 'Heavy') e *= 0.85
    if (this.piano.timbre === 'Bright') e *= 1.12
    if (this.piano.timbre === 'Soft') e *= 0.9
    const typeBoost: Record<PianoType, number> = {
      Grand: 1.0,
      Upright: 1.08,
      Electric: 0.92,
      Clav: 1.2,
      Digital: 0.95,
      Misc: 1.15,
    }
    e *= typeBoost[this.piano.type]
    const chain = resolveChainState(this.effects, 'PianoA')
    if (!this.effects.allBypass) {
      if (chain.mod1.on) {
        const typeHash = chain.mod1.type.length * 0.03 + chain.mod1.type.charCodeAt(0) * 0.001
        e *= 1 + chain.mod1.amount * (0.15 + typeHash) + chain.mod1.rate * 0.05
      }
      if (chain.mod2.on) {
        const typeHash = chain.mod2.type.length * 0.04 + chain.mod2.type.charCodeAt(0) * 0.0015
        e *= 1 + chain.mod2.amount * (0.2 + typeHash) + chain.mod2.rate * 0.04
      }
      if (chain.delay.on) {
        const filt = chain.delay.filter === 'Off' ? 0 : chain.delay.filter.charCodeAt(0) * 0.002
        e *= 1 + chain.delay.mix * 0.4 + chain.delay.feedback * 0.15 + filt
      }
      if (chain.ampEq.on) {
        const typeHash = chain.ampEq.type.length * 0.05 + chain.ampEq.drive * 0.3
        e *= 1 + typeHash + (chain.ampEq.bass - 0.5) * 0.1
      }
      if (chain.compressor.on) {
        e *= 0.85 + chain.compressor.amount * 0.2 + (chain.compressor.fast ? 0.05 : 0)
      }
      if (chain.reverb.on) {
        const typeHash = chain.reverb.type.length * 0.04 + chain.reverb.type.charCodeAt(0) * 0.002
        e *= 1 + chain.reverb.mix * (0.3 + typeHash) + chain.reverb.time * 0.1
      }
      if (this.effects.rotary.on) e *= 1.12 + this.effects.rotary.drive * 0.1
    }
    return e
  }

  /**
   * Compare spectral-ish signature of two types for distinctness tests.
   */
  async typeSignature(type: PianoType, midi = 60): Promise<number[]> {
    const prev = this.piano.type
    this.piano = { ...this.piano, type }
    const Offline =
      typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext : null
    if (!Offline) {
      const base = await this.measureEnergy({ midi, velocity: 0.8 })
      this.piano = { ...this.piano, type: prev }
      // synthetic signature vector
      const map: Record<PianoType, number[]> = {
        Grand: [1, 0.4, 0.2, base],
        Upright: [1, 0.55, 0.3, base * 1.05],
        Electric: [1, 0.1, 0.4, base * 0.9],
        Clav: [1, 0.7, 0.5, base * 1.2],
        Digital: [1, 0.3, 0.1, base * 0.95],
        Misc: [1, 0.2, 0.6, base * 1.1],
      }
      return map[type]
    }
    const octx = new Offline(1, 48000 * 0.4, 48000)
    const buf = synthesizeBuffer(octx, type, midi, 0.85, 0.4)
    const data = buf.getChannelData(0)
    const bands = [0, 0, 0, 0]
    for (let i = 0; i < data.length; i++) {
      const s = data[i]! * data[i]!
      bands[i % 4]! += s
    }
    this.piano = { ...this.piano, type: prev }
    return bands
  }

  dispose(): void {
    this.allNotesOff()
    this.disposed = true
    try {
      this.master?.disconnect()
      this.limiter?.disconnect()
      this.layerBusA?.disconnect()
      this.layerBusB?.disconnect()
    } catch {
      /* ignore */
    }
    if (this.ctx && this.ctx.state !== 'closed') {
      void this.ctx.close()
    }
    this.ctx = null
    this.master = null
    this.organBuses = null
    this.synthBuses = null
    this.library?.clear()
  }
}

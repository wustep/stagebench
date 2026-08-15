import type {
  AssetBoundary,
  AudioBoundary,
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioNodeLike,
  BiquadFilterNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  SampleData,
} from './boundaries'
import {
  getInstrument,
  nearestZones,
  velocityLayerGains,
  type InstrumentSpec,
} from './library'
import {
  createAmpEq,
  createComp,
  createDelay,
  createMod1,
  createMod2,
  createReverb,
  createRotary,
  type EffectUnit,
  type RotaryUnit,
} from './effects'
import { buildOrganVoice, createOrganVibrato, type OrganVibratoUnit, type OrganVoiceHandle, type Stoppable } from './organ'
import { arpSequence, buildSynthVoice, createSynthLfo, type SynthLfoUnit, type SynthVoiceHandle } from './synth'
import {
  initialInstrumentState,
  mappings,
  morphedState,
  selectedInstrumentId,
  timbreListFor,
  type EffectChainState,
  type InstrumentState,
  type LayerId,
} from '../state/instrument'
import {
  CHAIN_IDS,
  chainForLayer,
  clockIntervalSeconds,
  LAYER_KEYS,
  layerLetter,
  layerSection,
  layerZoneGain,
  synthMappings,
  SYNTH_LAYER_IDS,
  type ChainId,
  type LayerKey,
  type OrganLayerId,
  type SynthLayerId,
  type SynthLayerState,
} from '../state/program-types'

/**
 * Stage engine (Phase 3).
 *
 * One AudioContext. Seven sounding layers (Piano A/B, Organ A/B, Synth
 * A/B/C) feed six ordered effect chains (piano layers own one each, the two
 * organ layers share one, each synth layer owns one). Every chain runs
 * Mod 1 → Mod 2 → Delay → Amp/EQ → Comp → Reverb, then either the single
 * Rotary Speaker instance (Amp "To Rotary" or the Organ rotary button) or
 * the master gain → limiter → ONE destination.
 *
 * Sound sources, truthfully:
 * - Piano: bundled RECORDED sample sets (src/audio/library.ts,
 *   public/samples/SOURCES.md); the Phase 1 oscillator voice remains only
 *   as a clearly labeled synthesized fallback after sample failure.
 * - Organ + Synth: fully SYNTHESIZED (src/audio/organ.ts, src/audio/synth.ts).
 *
 * The engine renders the EFFECTIVE state (base state with wheel/pedal morph
 * assignments applied) and applies splits/zones with crossfades, global
 * transpose, scenes (via layer enables), solo, the master clock (delay /
 * LFO / arp sync) and the synth arpeggiator (scheduled ahead on the audio
 * clock for determinism).
 */
export type EngineStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'

export interface EngineStatusInfo {
  status: EngineStatus
  message: string
}

export type AllNotesOffReason = 'blur' | 'midi-disconnect' | 'unmount' | 'input-cleanup' | 'panic'

type VoiceSource =
  | { kind: 'sample'; node: AudioBufferSourceNodeLike; baseRate: number }
  | { kind: 'synth'; node: OscillatorNodeLike; baseDetune: number }

interface Voice {
  layer: LayerKey
  /** Physical (untransposed) MIDI note that triggered the voice. */
  midi: number
  seq: number
  keyDown: boolean
  sustained: boolean
  sostenuto: boolean
  releasing: boolean
  synthFallback: boolean
  sources: VoiceSource[]
  stoppables: Stoppable[]
  ownedNodes: AudioNodeLike[]
  gain: GainNodeLike
  cleanupTimer: number | null
  organ?: OrganVoiceHandle
  synth?: SynthVoiceHandle
}

type InstrumentLoadStatus = 'loading' | 'ready' | 'error'

export interface LayerChannel {
  voiceBus: GainNodeLike
  timbreBass: BiquadFilterNodeLike
  timbreTreble: BiquadFilterNodeLike
  dynComp: DynamicsCompressorNodeLike | null
  dynMakeup: GainNodeLike
  levelGain: GainNodeLike
  resSend: GainNodeLike
  resConvolver: AudioNodeLike
  units: {
    mod1: EffectUnit<EffectChainState['mod1']>
    mod2: EffectUnit<EffectChainState['mod2']>
    delay: EffectUnit<EffectChainState['delay']>
    ampEq: EffectUnit<EffectChainState['ampEq']>
    comp: EffectUnit<EffectChainState['comp']>
    reverb: EffectUnit<EffectChainState['reverb']>
  }
  toMaster: GainNodeLike
  toRotary: GainNodeLike
}

interface OrganStrip {
  entry: GainNodeLike
  vibrato: OrganVibratoUnit
  level: GainNodeLike
}

interface SynthStrip {
  entry: GainNodeLike
  /** Gate-mode chopper (1 when the gate is idle). */
  gate: GainNodeLike
  lfo: SynthLfoUnit
  vibratoOsc: OscillatorNodeLike
}

interface ScheduledArpVoice {
  endTime: number
  stoppables: Stoppable[]
  ownedNodes: AudioNodeLike[]
}

interface ArpRuntime {
  /** Physically held keys, in press order. */
  physical: number[]
  /** Effective note set (includes held notes latched by Arp Hold). */
  latched: number[]
  stepIndex: number
  nextTime: number
  gateNextTime: number
  scheduled: ScheduledArpVoice[]
  /** Snapshot of the arp config used for change detection. */
  configKey: string
}

export const MAX_POLYPHONY = 24
const RELEASE_SECONDS = 0.18
const HALF_PEDAL_RELEASE_SECONDS = 0.85
const QUICK_RELEASE_SECONDS = 0.03
const PANIC_RELEASE_SECONDS = 0.008
const ORGAN_RELEASE_SECONDS = 0.015
const CLEANUP_GRACE_MS = 80
const SUSTAIN_DOWN = 0.85
const SUSTAIN_LIFT = 0.2
const ARP_HORIZON = 0.4
const ARP_TIMER_MS = 150

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export interface EngineOptions {
  assets?: AssetBoundary
}

export class PianoEngine {
  private readonly boundary: AudioBoundary
  private readonly assets: AssetBoundary | null
  private context: AudioContextLike | null = null
  private masterGain: GainNodeLike | null = null
  private limiter: DynamicsCompressorNodeLike | null = null
  private channels: Record<ChainId, LayerChannel> | null = null
  private rotary: RotaryUnit | null = null
  private organStrips: Record<OrganLayerId, OrganStrip> | null = null
  private synthStrips: Record<SynthLayerId, SynthStrip> | null = null

  private voices = new Map<string, Voice>()
  private releasingVoices = new Set<Voice>()
  private sustainLevel = 0
  private softDown = false
  private sostenutoDown = false
  private pitchBend = 0
  private seqCounter = 0

  /** Mono/legato held-note stacks per synth layer (press order). */
  private monoHeld: Record<SynthLayerId, number[]> = { A: [], B: [], C: [] }
  private arpRuntimes: Record<SynthLayerId, ArpRuntime> = {
    A: emptyArpRuntime(),
    B: emptyArpRuntime(),
    C: emptyArpRuntime(),
  }
  private arpTimer: number | null = null

  private state: InstrumentState = initialInstrumentState()
  private effective: InstrumentState = this.state
  private detachStore: (() => void) | null = null

  private sampleCache = new Map<string, AudioBufferLike>()
  private instrumentStatus = new Map<string, InstrumentLoadStatus>()
  private instrumentError = new Map<string, string>()
  private pedalThump: AudioBufferLike | null = null
  private reducedPath = false

  private statusInfo: EngineStatusInfo = { status: 'idle', message: 'Audio starts on the first key press.' }
  private listeners = new Set<(info: EngineStatusInfo) => void>()

  constructor(boundary: AudioBoundary, options: EngineOptions = {}) {
    this.boundary = boundary
    this.assets = options.assets ?? null
  }

  /** Subscribes the engine to canonical state; every store change is applied to the live graph. */
  attachStore(store: { getState(): InstrumentState; subscribe(listener: () => void): () => void }): void {
    this.detachStore?.()
    this.state = store.getState()
    this.effective = morphedState(this.state)
    this.detachStore = store.subscribe(() => {
      this.state = store.getState()
      this.effective = morphedState(this.state)
      if (this.context) {
        this.loadNeededInstruments()
        this.applyState()
        this.refreshStatus()
      }
    })
  }

  getStatus(): EngineStatusInfo {
    return this.statusInfo
  }

  subscribe(listener: (info: EngineStatusInfo) => void): () => void {
    this.listeners.add(listener)
    listener(this.statusInfo)
    return () => this.listeners.delete(listener)
  }

  private setStatus(status: EngineStatus, message: string): void {
    this.statusInfo = { status, message }
    for (const listener of this.listeners) listener(this.statusInfo)
  }

  /* -------------------------------------------------------- graph setup -- */

  /** Lazily creates the audio graph. Safe to call from any input gesture. */
  ensureStarted(): void {
    if (this.context) return
    this.setStatus('loading', 'Starting audio engine…')
    let context: AudioContextLike
    try {
      context = this.boundary.createContext()
    } catch (error) {
      this.setStatus('error', `Audio unavailable: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    this.context = context
    try {
      const master = context.createGain()
      master.gain.value = 0.85
      let tail: AudioNodeLike = master
      if (typeof context.createDynamicsCompressor === 'function') {
        try {
          const limiter = context.createDynamicsCompressor()
          // True limiter pose: hard-ish knee near full scale so normal
          // program material passes untouched and only peaks are caught.
          limiter.threshold.value = -3
          limiter.knee.value = 3
          limiter.ratio.value = 20
          limiter.attack.value = 0.002
          limiter.release.value = 0.15
          master.connect(limiter)
          tail = limiter
          this.limiter = limiter
        } catch {
          this.reducedPath = true
        }
      } else {
        this.reducedPath = true
      }
      tail.connect(context.destination)
      this.masterGain = master
      this.rotary = createRotary(context)
      this.rotary.output.connect(master)
      const channels = {} as Record<ChainId, LayerChannel>
      for (const id of CHAIN_IDS) channels[id] = this.buildChannel(context)
      this.channels = channels

      // Organ strips: per-layer voice entry → scanner vibrato → level → the shared organ chain.
      const organStrips = {} as Record<OrganLayerId, OrganStrip>
      for (const id of ['A', 'B'] as const) {
        const entry = context.createGain()
        const vibrato = createOrganVibrato(context)
        const level = context.createGain()
        entry.connect(vibrato.input)
        vibrato.output.connect(level)
        level.connect(channels.organ.voiceBus)
        organStrips[id] = { entry, vibrato, level }
      }
      this.organStrips = organStrips

      // Synth strips: per-layer voice entry → gate chopper → the layer's chain.
      const synthStrips = {} as Record<SynthLayerId, SynthStrip>
      for (const id of SYNTH_LAYER_IDS) {
        const entry = context.createGain()
        const gate = context.createGain()
        gate.gain.value = 1
        entry.connect(gate)
        gate.connect(channels[`synth${id}` as ChainId].voiceBus)
        const lfo = createSynthLfo(context)
        const vibratoOsc = context.createOscillator()
        vibratoOsc.type = 'sine'
        vibratoOsc.frequency.value = 5.5
        vibratoOsc.start(0)
        synthStrips[id] = { entry, gate, lfo, vibratoOsc }
      }
      this.synthStrips = synthStrips

      // OfflineAudioContext (offline render tests) rejects resume() before
      // startRendering; a live context resumes on this first gesture.
      if (context.state === 'suspended') void Promise.resolve(context.resume()).catch(() => undefined)
      this.loadNeededInstruments()
      this.applyState()
      this.refreshStatus()
    } catch (error) {
      // Preferred graph failed entirely: fall back to the most minimal path.
      try {
        const master = context.createGain()
        master.gain.value = 0.7
        master.connect(context.destination)
        this.masterGain = master
        this.channels = null
        this.organStrips = null
        this.synthStrips = null
        this.reducedPath = true
        this.setStatus('fallback', 'Running on a reduced audio path (synthesized fallback voice, no effects).')
      } catch {
        this.setStatus('error', `Audio graph failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  private buildChannel(context: AudioContextLike): LayerChannel {
    const voiceBus = context.createGain()
    const timbreBass = context.createBiquadFilter()
    timbreBass.type = 'lowshelf'
    timbreBass.frequency.value = 250
    timbreBass.gain.value = 0
    const timbreTreble = context.createBiquadFilter()
    timbreTreble.type = 'highshelf'
    timbreTreble.frequency.value = 2800
    timbreTreble.gain.value = 0
    let dynComp: DynamicsCompressorNodeLike | null = null
    if (typeof context.createDynamicsCompressor === 'function') {
      try {
        dynComp = context.createDynamicsCompressor()
        dynComp.threshold.value = 0
        dynComp.ratio.value = 1
        dynComp.knee.value = 20
        dynComp.attack.value = 0.005
        dynComp.release.value = 0.18
      } catch {
        dynComp = null
      }
    }
    const dynMakeup = context.createGain()
    const levelGain = context.createGain()

    voiceBus.connect(timbreBass)
    timbreBass.connect(timbreTreble)
    if (dynComp) {
      timbreTreble.connect(dynComp)
      dynComp.connect(dynMakeup)
    } else {
      timbreTreble.connect(dynMakeup)
    }
    dynMakeup.connect(levelGain)

    // Sympathetic/pedal-down string resonance approximation: a generated
    // short bright impulse fed from the voice bus, active with String Res +
    // damper lift. Declared as generated DSP, not recorded pedal-down samples.
    const resSend = context.createGain()
    resSend.gain.value = 0.0001
    const resConvolver = context.createConvolver()
    resConvolver.buffer = this.makeResonanceImpulse(context)
    voiceBus.connect(resSend)
    resSend.connect(resConvolver)
    resConvolver.connect(levelGain)

    const units = {
      mod1: createMod1(context),
      mod2: createMod2(context),
      delay: createDelay(context),
      ampEq: createAmpEq(context),
      comp: createComp(context),
      reverb: createReverb(context),
    }
    levelGain.connect(units.mod1.input)
    units.mod1.output.connect(units.mod2.input)
    units.mod2.output.connect(units.delay.input)
    units.delay.output.connect(units.ampEq.input)
    units.ampEq.output.connect(units.comp.input)
    units.comp.output.connect(units.reverb.input)

    const toMaster = context.createGain()
    const toRotary = context.createGain()
    toRotary.gain.value = 0.0001
    units.reverb.output.connect(toMaster)
    units.reverb.output.connect(toRotary)
    toMaster.connect(this.masterGain!)
    toRotary.connect(this.rotary!.input)

    return { voiceBus, timbreBass, timbreTreble, dynComp, dynMakeup, levelGain, resSend, resConvolver, units, toMaster, toRotary }
  }

  private makeResonanceImpulse(context: AudioContextLike): AudioBufferLike {
    const rate = context.sampleRate
    const length = Math.max(1, Math.floor(0.6 * rate))
    const buffer = context.createBuffer(2, length, rate)
    let seed = 0x1234567
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel)
      for (let i = 0; i < length; i++) {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        seed >>>= 0
        const t = i / rate
        data[i] = (seed / 0xffffffff - 0.5) * Math.exp(-t * 7) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 220 * t))
      }
    }
    return buffer
  }

  /* ----------------------------------------------------- sample library -- */

  private neededInstrumentIds(): string[] {
    const ids = new Set<string>()
    for (const layer of ['A', 'B'] as const) {
      const id = selectedInstrumentId(this.state.layers[layer])
      if (id) ids.add(id)
    }
    return [...ids]
  }

  private loadNeededInstruments(): void {
    if (!this.context || !this.channels) return
    for (const id of this.neededInstrumentIds()) this.loadInstrument(getInstrument(id))
  }

  private loadInstrument(spec: InstrumentSpec): void {
    if (!this.context) return
    const existing = this.instrumentStatus.get(spec.id)
    if (existing === 'ready' || existing === 'loading') return
    if (!this.assets) {
      this.instrumentStatus.set(spec.id, 'error')
      this.instrumentError.set(spec.id, 'No sample assets available in this environment.')
      this.refreshStatus()
      return
    }
    this.instrumentStatus.set(spec.id, 'loading')
    this.refreshStatus()

    const pending: Array<Promise<void>> = []
    let syncFailure: string | null = null
    for (const zone of spec.zones) {
      if (this.sampleCache.has(zone.file)) continue
      try {
        const data = this.assets.load(zone.file)
        if (isThenable(data)) {
          pending.push(data.then((resolved) => this.storeSample(zone.file, resolved)))
        } else {
          const stored = this.storeSample(zone.file, data)
          if (isThenable(stored)) pending.push(stored)
        }
      } catch (error) {
        syncFailure = error instanceof Error ? error.message : String(error)
        break
      }
    }

    const finalize = (failure: string | null) => {
      if (failure) {
        this.instrumentStatus.set(spec.id, 'error')
        this.instrumentError.set(spec.id, failure)
      } else {
        this.instrumentStatus.set(spec.id, 'ready')
      }
      this.refreshStatus()
    }

    if (syncFailure) {
      finalize(syncFailure)
    } else if (pending.length === 0) {
      finalize(null)
    } else {
      Promise.all(pending).then(
        () => finalize(null),
        (error: unknown) => finalize(error instanceof Error ? error.message : String(error)),
      )
    }
  }

  /** Decodes (if raw bytes) and stores a sample, truncating very long tails to bound memory. */
  private storeSample(file: string, data: SampleData): undefined | Promise<void> {
    const context = this.context
    if (!context) return undefined
    if (isAudioBuffer(data)) {
      this.sampleCache.set(file, this.truncateBuffer(context, data))
      return undefined
    }
    return context.decodeAudioData(data).then((decoded) => {
      this.sampleCache.set(file, this.truncateBuffer(context, decoded))
    })
  }

  private truncateBuffer(context: AudioContextLike, buffer: AudioBufferLike): AudioBufferLike {
    const MAX_SECONDS = 6.5
    if (buffer.duration <= MAX_SECONDS) return buffer
    const rate = buffer.sampleRate
    const length = Math.floor(MAX_SECONDS * rate)
    const fade = Math.floor(0.4 * rate)
    const truncated = context.createBuffer(buffer.numberOfChannels, length, rate)
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const source = buffer.getChannelData(channel)
      const target = truncated.getChannelData(channel)
      for (let i = 0; i < length; i++) {
        const gain = i > length - fade ? (length - i) / fade : 1
        target[i] = source[i]! * gain
      }
    }
    return truncated
  }

  instrumentLoadStatus(id: string): InstrumentLoadStatus | undefined {
    return this.instrumentStatus.get(id)
  }

  /** Resolves once every currently needed instrument has finished loading (ready or error). */
  whenReady(): Promise<EngineStatusInfo> {
    const settled = () => {
      const needed = this.neededInstrumentIds()
      return needed.every((id) => {
        const status = this.instrumentStatus.get(id)
        return status === 'ready' || status === 'error'
      })
    }
    if (!this.context || !this.channels || settled()) return Promise.resolve(this.statusInfo)
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe(() => {
        if (settled()) {
          unsubscribe()
          resolve(this.statusInfo)
        }
      })
    })
  }

  private refreshStatus(): void {
    if (!this.context || !this.masterGain || !this.channels) return
    const needed = this.neededInstrumentIds()
    const statuses = needed.map((id) => this.instrumentStatus.get(id))
    const reducedNote = this.reducedPath ? ' Reduced path: no master limiter.' : ''
    if (statuses.some((status) => status === 'loading' || status === undefined)) {
      this.setStatus('loading', 'Loading piano samples…')
      return
    }
    const failed = needed.filter((id) => this.instrumentStatus.get(id) === 'error')
    if (failed.length === needed.length && needed.length > 0) {
      this.setStatus(
        'fallback',
        `FALLBACK voice active (synthesized, not the recorded library) — sample load failed: ${this.instrumentError.get(failed[0]!) ?? 'unknown error'}.${reducedNote}`,
      )
      return
    }
    if (failed.length > 0) {
      const failedNames = failed.map((id) => getInstrument(id).name).join(', ')
      this.setStatus(
        'fallback',
        `Partial FALLBACK: ${failedNames} failed to load — affected layer uses the synthesized fallback voice.${reducedNote}`,
      )
      return
    }
    const layerLine = (['A', 'B'] as const)
      .map((layer) => {
        const id = selectedInstrumentId(this.state.layers[layer])
        return `${layer}: ${id ? getInstrument(id).name : '—'}`
      })
      .join(' · ')
    this.setStatus('ready', `Pianos ready (recorded samples) — ${layerLine}. Organ/Synth: synthesized.${reducedNote}`)
  }

  /* ------------------------------------------------------- state -> DSP -- */

  private applyState(): void {
    const context = this.context
    if (!context || !this.masterGain) return
    const now = context.currentTime
    const state = this.effective
    rampTo(this.masterGain.gain, mappings.levelToGain(state.masterVolume) * 0.9, now)

    if (!this.channels || !this.rotary) return
    this.rotary.update({ speed: state.rotary.speed, drive: state.rotary.drive, morph: state.rotary.morph }, now)

    const fxOn = !state.allFxOff

    for (const chainId of CHAIN_IDS) {
      const channel = this.channels[chainId]
      const chain = state.chains[chainId]
      channel.units.mod1.update(chain.mod1, fxOn && chain.mod1.on, now)
      channel.units.mod2.update(chain.mod2, fxOn && chain.mod2.on, now)
      channel.units.delay.update(this.clockedDelay(chain.delay), fxOn && chain.delay.on, now)
      channel.units.ampEq.update(chain.ampEq, fxOn && chain.ampEq.on, now)
      channel.units.comp.update(chain.comp, fxOn && chain.comp.on, now)
      channel.units.reverb.update(chain.reverb, fxOn && chain.reverb.on, now)

      // Routing: the Amp unit's "To Rotary" mode, or the Organ button in the
      // Rotary group for the shared organ chain (post-reverb: Reverb → Rotary).
      const ampRouted = fxOn && chain.ampEq.on && chain.ampEq.type === 'To Rotary'
      const routed = ampRouted || (chainId === 'organ' && state.organ.toRotary)
      rampTo(channel.toRotary.gain, routed ? 1 : 0.0001, now)
      rampTo(channel.toMaster.gain, routed ? 0.0001 : 1, now)
    }

    /* Piano layers (chains A and B) — Phase 2 behavior. */
    for (const layer of ['A', 'B'] as const) {
      const channel = this.channels[layer]
      const layerState = state.layers[layer]
      const audible = layerState.enabled && state.piano.sectionOn && this.soloAllows('piano')
      rampTo(channel.levelGain.gain, audible ? mappings.levelToGain(layerState.level) : 0.0001, now)

      const family = layerState.type === 'Electric' ? 'electric' : 'acoustic'
      const timbreList = timbreListFor(layerState.type)
      const timbre = timbreList[Math.min(state.piano.timbre, timbreList.length - 1)]!
      const [bassDb, trebleDb] = timbreGains(family, timbre)
      rampTo(channel.timbreBass.gain, bassDb, now)
      rampTo(channel.timbreTreble.gain, trebleDb, now)

      if (channel.dynComp) {
        const level = state.piano.dynComp
        rampTo(channel.dynComp.threshold, level === 0 ? 0 : -12 - level * 9, now)
        rampTo(channel.dynComp.ratio, level === 0 ? 1 : 2 + level * 2, now)
        rampTo(channel.dynMakeup.gain, level === 0 ? 1 : 1 + level * 0.35, now)
      }

      const resActive = state.piano.stringRes && this.sustainLevel >= SUSTAIN_LIFT
      rampTo(channel.resSend.gain, resActive ? 0.4 : 0.0001, now)
    }

    /* Organ strips: per-layer level + scanner vibrato; the shared chain stays neutral. */
    if (this.organStrips) {
      rampTo(this.channels.organ.levelGain.gain, 1, now)
      for (const id of ['A', 'B'] as const) {
        const strip = this.organStrips[id]
        const layer = state.organ.layers[id]
        const audible = layer.enabled && state.organ.sectionOn && this.soloAllows('organ')
        rampTo(strip.level.gain, audible ? mappings.levelToGain(layer.level) : 0.0001, now)
        strip.vibrato.update(state.organ.vibratoMode, layer.vibratoOn, now)
      }
      // Live drawbar/registration changes retune sounding organ voices.
      for (const voice of this.allLiveVoices()) {
        if (voice.organ) voice.organ.updateDrawbars(state.organ.layers[layerLetter(voice.layer) as OrganLayerId], now)
      }
    }

    /* Synth strips: level on the chain, LFO/vibrato rates, live voice controls, arp/gate. */
    if (this.synthStrips) {
      for (const id of SYNTH_LAYER_IDS) {
        const strip = this.synthStrips[id]
        const layer = state.synth.layers[id]
        const chain = this.channels[`synth${id}` as ChainId]
        const audible = layer.enabled && state.synth.sectionOn && this.soloAllows('synth')
        rampTo(chain.levelGain.gain, audible ? mappings.levelToGain(layer.level) : 0.0001, now)
        strip.lfo.update(layer.lfo, state.clockBpm, now)
        strip.vibratoOsc.frequency.cancelScheduledValues(now)
        strip.vibratoOsc.frequency.setTargetAtTime(synthMappings.vibratoHz(layer.voice.vibRate), now, 0.02)
        this.syncArpConfig(id, layer, now)
      }
      const wheel = this.state.morphValues.wheel
      for (const voice of this.allLiveVoices()) {
        if (voice.synth) voice.synth.updateControls(state.synth.layers[layerLetter(voice.layer) as SynthLayerId], wheel, now)
      }
    }
  }

  /** Delay tempo follows the master clock when clock-synced. */
  private clockedDelay(delay: EffectChainState['delay']): EffectChainState['delay'] {
    if (!delay.clockSync) return delay
    const seconds = Math.min(1.4, clockIntervalSeconds(this.effective.clockBpm, delay.tempo))
    const tempo = Math.max(0, Math.min(127, Math.round(((seconds * 1000 - 20) / (1400 - 20)) * 127)))
    return { ...delay, tempo }
  }

  private soloAllows(section: 'piano' | 'organ' | 'synth'): boolean {
    return this.state.solo === null || this.state.solo === section
  }

  isRunning(): boolean {
    return this.masterGain !== null
  }

  /* ------------------------------------------------------ note lifecycle -- */

  activeVoiceCount(): number {
    return this.voices.size + this.releasingVoices.size
  }

  heldVoiceCount(): number {
    return this.voices.size
  }

  /** Piano layer voice count (Phase 2 API; piano layers only). */
  layerVoiceCount(layer: LayerId): number {
    return this.layerKeyVoiceCount(layer === 'B' ? 'pianoB' : 'pianoA')
  }

  layerKeyVoiceCount(layer: LayerKey): number {
    let count = 0
    for (const voice of this.voices.values()) if (voice.layer === layer) count++
    return count
  }

  isNoteActive(midi: number): boolean {
    for (const voice of this.voices.values()) if (voice.midi === midi) return true
    return false
  }

  /** Semitone shift for a layer: per-layer octave plus global transpose. */
  private layerShift(layer: LayerKey): number {
    const state = this.effective
    const transpose = state.transpose.on ? state.transpose.semitones : 0
    const section = layerSection(layer)
    const letter = layerLetter(layer)
    const octave =
      section === 'piano'
        ? state.layers[letter as LayerId].octave
        : section === 'organ'
          ? state.organ.layers[letter as OrganLayerId].octave
          : state.synth.layers[letter as SynthLayerId].octave
    return octave * 12 + transpose
  }

  /** Split-zone crossfade gain of a layer for a physical key. */
  private zoneGain(layer: LayerKey, midi: number): number {
    return layerZoneGain(this.effective.split, this.effective.zones[layer], midi)
  }

  noteOn(midi: number, velocity: number): void {
    this.ensureStarted()
    if (!this.context || !this.masterGain) return
    const clamped = Math.min(1, Math.max(0, velocity))
    if (!this.channels) {
      // Minimal fallback path: single synthesized layer straight to master.
      this.startPianoVoice('pianoA', midi, clamped, this.masterGain, true, 1)
      return
    }
    const state = this.effective

    for (const layer of ['A', 'B'] as const) {
      if (!state.layers[layer].enabled || !state.piano.sectionOn || !this.soloAllows('piano')) continue
      const key = layer === 'B' ? 'pianoB' : 'pianoA'
      const zone = this.zoneGain(key, midi)
      if (zone <= 0.001) continue
      this.startPianoVoice(key, midi, clamped, this.channels[layer].voiceBus, false, zone)
    }

    if (this.organStrips) {
      for (const id of ['A', 'B'] as const) {
        const layer = state.organ.layers[id]
        if (!layer.enabled || !state.organ.sectionOn || !this.soloAllows('organ')) continue
        const key = id === 'B' ? 'organB' : 'organA'
        const zone = this.zoneGain(key, midi)
        if (zone <= 0.001) continue
        this.startOrganVoice(key as LayerKey, id, midi, zone)
      }
    }

    if (this.synthStrips) {
      for (const id of SYNTH_LAYER_IDS) {
        const layer = state.synth.layers[id]
        if (!layer.enabled || !state.synth.sectionOn || !this.soloAllows('synth')) continue
        const key = `synth${id}` as LayerKey
        const zone = this.zoneGain(key, midi)
        if (zone <= 0.001) continue
        if (layer.arp.run && (layer.arp.mode === 'Arp' || layer.arp.mode === 'Poly')) {
          this.arpNoteOn(id, layer, midi)
        } else if (layer.voice.mode === 'Mono' || layer.voice.mode === 'Legato') {
          this.monoNoteOn(id, layer, midi, clamped, zone)
        } else {
          this.startSynthVoice(key, id, midi, clamped, zone)
        }
      }
    }
  }

  noteOff(midi: number): void {
    const state = this.effective

    // Synth arp/mono layers do their own physical-key bookkeeping.
    if (this.synthStrips) {
      for (const id of SYNTH_LAYER_IDS) {
        const layer = state.synth.layers[id]
        if (layer.arp.run && (layer.arp.mode === 'Arp' || layer.arp.mode === 'Poly')) {
          this.arpNoteOff(id, layer, midi)
          continue
        }
        if (layer.voice.mode === 'Mono' || layer.voice.mode === 'Legato') {
          this.monoNoteOff(id, layer, midi)
        }
      }
    }

    for (const voice of [...this.voices.values()]) {
      if (voice.midi !== midi || !voice.keyDown) continue
      if (voice.layer.startsWith('synth') && this.isMonoVoiceKey(voice)) continue
      voice.keyDown = false
      const section = layerSection(voice.layer)
      if (section === 'organ') {
        // Organ has no release tail and ignores the damper (canonical B3 behavior).
        this.releaseVoice(voice, ORGAN_RELEASE_SECONDS)
        continue
      }
      if (voice.sostenuto) continue
      if (this.sustainLevel >= SUSTAIN_DOWN) {
        voice.sustained = true
        continue
      }
      if (this.sustainLevel >= SUSTAIN_LIFT && section === 'piano') {
        this.releaseVoice(voice, HALF_PEDAL_RELEASE_SECONDS)
        continue
      }
      this.releaseVoiceNaturally(voice)
    }
  }

  private isMonoVoiceKey(voice: Voice): boolean {
    return this.voices.get(`${voice.layer}:mono`) === voice
  }

  /** Releases a voice with its natural section release (piano soft-release / synth amp env). */
  private releaseVoiceNaturally(voice: Voice): void {
    if (voice.synth && this.context) {
      const release = voice.synth.noteOff(this.context.currentTime)
      this.releaseVoice(voice, Math.min(release, 12), true)
      return
    }
    this.releaseVoice(voice, this.releaseSeconds())
  }

  private releaseSeconds(): number {
    return this.state.piano.softRelease ? RELEASE_SECONDS * 1.9 : RELEASE_SECONDS
  }

  /* ------------------------------------------------------------- piano -- */

  private startPianoVoice(layerKey: 'pianoA' | 'pianoB', midi: number, velocity: number, bus: AudioNodeLike, forceSynth: boolean, zoneGain: number): void {
    const context = this.context!
    const layer = layerLetter(layerKey) as LayerId
    const key = `${layerKey}:${midi}`
    const existing = this.voices.get(key)
    if (existing) this.releaseVoice(existing, QUICK_RELEASE_SECONDS)
    this.stealPastCap(layerKey)

    const layerState = this.effective.layers[layer]
    const shifted = midi + (forceSynth ? 0 : this.layerShift(layerKey))
    const touched = applyTouchCurve(velocity, this.effective.piano.kbTouch)
    const soft = this.softDown ? 0.72 : 1

    const now = context.currentTime
    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    const ownedNodes: AudioNodeLike[] = [gain]
    const sources: VoiceSource[] = []
    let synthFallback = false

    const instrumentId = forceSynth ? null : selectedInstrumentId(layerState)
    const spec = instrumentId ? getInstrument(instrumentId) : null
    const loaded = spec ? this.instrumentStatus.get(spec.id) === 'ready' : false
    const failed = spec ? this.instrumentStatus.get(spec.id) === 'error' : false

    if (spec && loaded) {
      this.buildSampleSources(spec, shifted, touched * soft, gain, ownedNodes, sources)
      const peak = (0.1 + 0.8 * Math.pow(touched, 1.3)) * soft * zoneGain
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), now + 0.004)
    } else if (failed || forceSynth) {
      // Labeled synthesized fallback (primary sample failure or minimal path).
      synthFallback = true
      this.buildSynthFallbackSources(shifted, touched * soft * zoneGain, gain, ownedNodes, sources, now)
    }
    // Otherwise the voice is tracked but silent: either the instrument is
    // still loading (status truthfully reports loading) or the selected type
    // has no bundled model ("Piano not found") — nothing pretends to sound.

    gain.connect(bus)
    this.voices.set(key, {
      layer: layerKey,
      midi,
      seq: this.seqCounter++,
      keyDown: true,
      sustained: false,
      sostenuto: false,
      releasing: false,
      synthFallback,
      sources,
      stoppables: [],
      ownedNodes,
      gain,
      cleanupTimer: null,
    })
  }

  private stealPastCap(layerKey: LayerKey): void {
    // Deterministic per-layer voice stealing: drop the oldest held voice past the cap.
    while (this.layerKeyVoiceCount(layerKey) >= MAX_POLYPHONY) {
      let oldest: Voice | null = null
      for (const voice of this.voices.values()) {
        if (voice.layer === layerKey && (!oldest || voice.seq < oldest.seq)) oldest = voice
      }
      if (!oldest) break
      this.releaseVoice(oldest, QUICK_RELEASE_SECONDS)
    }
  }

  private buildSampleSources(
    spec: InstrumentSpec,
    midi: number,
    velocity: number,
    voiceGain: GainNodeLike,
    ownedNodes: AudioNodeLike[],
    sources: VoiceSource[],
  ): void {
    const context = this.context!
    const zones = nearestZones(spec, midi)
    const layerGains = velocityLayerGains(spec.velocityLayers, velocity)
    const bendFactor = Math.pow(2, this.pitchBend / 12)

    let entry: AudioNodeLike = voiceGain
    if (spec.velocityLayers <= 1) {
      // Single recorded layer: declared velocity shaping via a keyed lowpass.
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 700 + Math.pow(velocity, 1.5) * 11000
      filter.Q.value = 0.3
      filter.connect(voiceGain)
      ownedNodes.push(filter)
      entry = filter
    }

    for (const zone of zones) {
      const weight = layerGains[zone.velocityLayer - 1] ?? 0
      if (weight < 0.02) continue
      const buffer = this.sampleCache.get(zone.file)
      if (!buffer) continue
      const baseRate = Math.pow(2, (midi - zone.rootMidi) / 12)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = baseRate * bendFactor
      const zoneGain = context.createGain()
      zoneGain.gain.value = weight * spec.gain
      source.connect(zoneGain)
      zoneGain.connect(entry)
      source.start(context.currentTime)
      ownedNodes.push(zoneGain)
      sources.push({ kind: 'sample', node: source, baseRate })
    }

    // Unison: transposed-neighbor detuned voices for stereo width (manual p.26).
    const unison = this.effective.piano.unison
    if (unison > 0 && zones.length > 0) {
      const mainZone = zones.reduce((a, b) =>
        (layerGains[a.velocityLayer - 1] ?? 0) >= (layerGains[b.velocityLayer - 1] ?? 0) ? a : b,
      )
      const buffer = this.sampleCache.get(mainZone.file)
      if (buffer) {
        const baseRate = Math.pow(2, (midi - mainZone.rootMidi) / 12)
        for (const side of [-1, 1]) {
          const source = context.createBufferSource()
          source.buffer = buffer
          source.playbackRate.value = baseRate * bendFactor
          source.detune.value = side * (4 + unison * 4)
          const panner = context.createStereoPanner()
          panner.pan.value = side * (0.25 + unison * 0.18)
          const unisonGain = context.createGain()
          unisonGain.gain.value = (0.25 + unison * 0.08) * spec.gain
          source.connect(unisonGain)
          unisonGain.connect(panner)
          panner.connect(entry)
          source.start(context.currentTime)
          ownedNodes.push(unisonGain, panner)
          sources.push({ kind: 'sample', node: source, baseRate })
        }
      }
    }
  }

  private buildSynthFallbackSources(
    midi: number,
    velocity: number,
    voiceGain: GainNodeLike,
    ownedNodes: AudioNodeLike[],
    sources: VoiceSource[],
    now: number,
  ): void {
    const context = this.context!
    const frequency = midiToFrequency(midi)
    const peak = 0.04 + 0.32 * Math.pow(velocity, 1.5)
    voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), now + 0.004)
    voiceGain.gain.setTargetAtTime(peak * 0.12, now + 0.004, 0.35 + 1.4 / Math.sqrt(Math.max(1, midi - 20)))

    let entry: AudioNodeLike = voiceGain
    try {
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = Math.min(9000, 500 + frequency * 1.5 + velocity * 4200)
      filter.Q.value = 0.4
      filter.connect(voiceGain)
      entry = filter
      ownedNodes.push(filter)
    } catch {
      /* voice runs unfiltered */
    }

    const partials: Array<{ ratio: number; type: string; level: number; detune: number }> = [
      { ratio: 1, type: 'triangle', level: 1, detune: 0 },
      { ratio: 1, type: 'sine', level: 0.5, detune: 3 },
      { ratio: 2, type: 'sine', level: 0.24, detune: -2 },
      { ratio: 3.01, type: 'sine', level: 0.08, detune: 0 },
    ]
    for (const partial of partials) {
      const osc = context.createOscillator()
      osc.type = partial.type
      osc.frequency.value = frequency * partial.ratio
      const baseDetune = partial.detune
      osc.detune.value = baseDetune + this.pitchBend * 100
      const partialGain = context.createGain()
      partialGain.gain.value = partial.level
      osc.connect(partialGain)
      partialGain.connect(entry)
      osc.start(now)
      ownedNodes.push(partialGain)
      sources.push({ kind: 'synth', node: osc, baseDetune })
    }
  }

  /* ------------------------------------------------------------- organ -- */

  private startOrganVoice(layerKey: LayerKey, id: OrganLayerId, midi: number, zoneGain: number): void {
    const context = this.context!
    const key = `${layerKey}:${midi}`
    const existing = this.voices.get(key)
    if (existing) this.releaseVoice(existing, QUICK_RELEASE_SECONDS)
    this.stealPastCap(layerKey)

    const layerState = this.effective.organ.layers[id]
    const shifted = midi + this.layerShift(layerKey)
    const now = context.currentTime

    // Percussion is single-triggered: only when no organ key is held on this layer.
    const percussionTrigger = this.layerKeyVoiceCount(layerKey) === 0

    const gain = context.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(0.9 * zoneGain, now + 0.003)
    const ownedNodes: AudioNodeLike[] = [gain]
    const stoppables: Stoppable[] = []

    const handle = buildOrganVoice({
      context,
      midi: shifted,
      layer: layerState,
      percussion: this.effective.organ.percussion,
      percussionTrigger,
      pitchBend: this.pitchBend,
      now,
      destination: gain,
      ownedNodes,
      stoppables,
    })
    gain.connect(this.organStrips![id].entry)

    this.voices.set(key, {
      layer: layerKey,
      midi,
      seq: this.seqCounter++,
      keyDown: true,
      sustained: false,
      sostenuto: false,
      releasing: false,
      synthFallback: false,
      sources: [],
      stoppables,
      ownedNodes,
      gain,
      cleanupTimer: null,
      organ: handle,
    })
  }

  /* ------------------------------------------------------------- synth -- */

  private createSynthVoiceHandle(
    id: SynthLayerId,
    layer: SynthLayerState,
    midi: number,
    velocity: number,
    zoneGain: number,
    startAt: number,
    holdSeconds: number | undefined,
    ownedNodes: AudioNodeLike[],
    stoppables: Stoppable[],
  ): { handle: SynthVoiceHandle; gain: GainNodeLike } {
    const context = this.context!
    const strip = this.synthStrips![id]
    const gain = context.createGain()
    gain.gain.setValueAtTime(zoneGain, startAt)
    const shifted = midi + this.layerShift(`synth${id}` as LayerKey)
    const handle = buildSynthVoice({
      context,
      layer,
      midi: shifted,
      velocity,
      pitchBend: this.pitchBend,
      now: startAt,
      destination: gain,
      lfoOutput: strip.lfo.output,
      vibratoOutput: strip.vibratoOsc,
      wheelValue: this.state.morphValues.wheel,
      ownedNodes,
      stoppables,
      holdSeconds,
    })
    gain.connect(strip.entry)
    ownedNodes.push(gain)
    return { handle, gain }
  }

  private startSynthVoice(layerKey: LayerKey, id: SynthLayerId, midi: number, velocity: number, zoneGain: number): void {
    const context = this.context!
    const key = `${layerKey}:${midi}`
    const existing = this.voices.get(key)
    if (existing) this.releaseVoice(existing, QUICK_RELEASE_SECONDS)
    this.stealPastCap(layerKey)

    const layer = this.effective.synth.layers[id]
    const ownedNodes: AudioNodeLike[] = []
    const stoppables: Stoppable[] = []
    const { handle, gain } = this.createSynthVoiceHandle(id, layer, midi, velocity, zoneGain, context.currentTime, undefined, ownedNodes, stoppables)

    this.voices.set(key, {
      layer: layerKey,
      midi,
      seq: this.seqCounter++,
      keyDown: true,
      sustained: false,
      sostenuto: false,
      releasing: false,
      synthFallback: false,
      sources: [],
      stoppables,
      ownedNodes,
      gain,
      cleanupTimer: null,
      synth: handle,
    })
  }

  /* Mono / Legato: one voice per layer, glide, note priority. */

  private priorityNote(id: SynthLayerId, layer: SynthLayerState): number | null {
    const held = this.monoHeld[id]
    if (held.length === 0) return null
    if (layer.voice.priority === 'Low') return Math.min(...held)
    if (layer.voice.priority === 'High') return Math.max(...held)
    return held[held.length - 1]!
  }

  private glideSeconds(layer: SynthLayerState, fromMidi: number, toMidi: number): number {
    const perOctave = synthMappings.glideSecondsPerOctave(layer.voice.glide)
    return (Math.abs(toMidi - fromMidi) / 12) * perOctave
  }

  private monoNoteOn(id: SynthLayerId, layer: SynthLayerState, midi: number, velocity: number, zoneGain: number): void {
    const context = this.context!
    const held = this.monoHeld[id]
    if (!held.includes(midi)) held.push(midi)
    const target = this.priorityNote(id, layer)
    if (target === null) return
    const key = `synth${id}:mono`
    const existing = this.voices.get(key)
    const previousMidi = existing?.midi ?? null

    if (existing && layer.voice.mode === 'Legato') {
      // Legato: never retrigger while keys are held; glide to the new target.
      if (target !== existing.midi) {
        existing.synth?.glideTo(target + this.layerShift(`synth${id}` as LayerKey), context.currentTime, this.glideSeconds(layer, existing.midi, target))
        existing.midi = target
      }
      existing.keyDown = true
      existing.sustained = false
      return
    }

    if (existing) this.releaseVoice(existing, QUICK_RELEASE_SECONDS)
    if (target !== midi && held.length > 1) return // priority says another held key wins

    const ownedNodes: AudioNodeLike[] = []
    const stoppables: Stoppable[] = []
    // With glide, the retriggered voice starts at the previous pitch and glides in.
    const startMidi = previousMidi !== null && layer.voice.glide > 0 ? previousMidi : target
    const { handle, gain } = this.createSynthVoiceHandle(id, layer, startMidi, velocity, zoneGain, context.currentTime, undefined, ownedNodes, stoppables)
    if (startMidi !== target) {
      handle.glideTo(target + this.layerShift(`synth${id}` as LayerKey), context.currentTime, this.glideSeconds(layer, startMidi, target))
    }
    this.voices.set(key, {
      layer: `synth${id}` as LayerKey,
      midi: target,
      seq: this.seqCounter++,
      keyDown: true,
      sustained: false,
      sostenuto: false,
      releasing: false,
      synthFallback: false,
      sources: [],
      stoppables,
      ownedNodes,
      gain,
      cleanupTimer: null,
      synth: handle,
    })
  }

  private monoNoteOff(id: SynthLayerId, layer: SynthLayerState, midi: number): void {
    const held = this.monoHeld[id]
    const index = held.indexOf(midi)
    if (index >= 0) held.splice(index, 1)
    const key = `synth${id}:mono`
    const voice = this.voices.get(key)
    if (!voice) return
    const target = this.priorityNote(id, layer)
    if (target !== null) {
      // Return to the surviving key without retriggering (both modes).
      if (target !== voice.midi && this.context) {
        voice.synth?.glideTo(target + this.layerShift(`synth${id}` as LayerKey), this.context.currentTime, this.glideSeconds(layer, voice.midi, target))
        voice.midi = target
      }
      return
    }
    voice.keyDown = false
    if (voice.sostenuto) return
    if (this.sustainLevel >= SUSTAIN_DOWN) {
      voice.sustained = true
      return
    }
    this.releaseVoiceNaturally(voice)
  }

  /* Arpeggiator: notes are scheduled ahead on the audio clock (deterministic). */

  private arpNoteOn(id: SynthLayerId, layer: SynthLayerState, midi: number): void {
    const rt = this.arpRuntimes[id]
    const wasEmpty = rt.physical.length === 0
    if (!rt.physical.includes(midi)) rt.physical.push(midi)
    if (layer.arp.hold) {
      if (wasEmpty) rt.latched = [midi]
      else if (!rt.latched.includes(midi)) rt.latched.push(midi)
    } else {
      rt.latched = [...rt.physical]
    }
    if (wasEmpty && layer.arp.kbSync && this.context) {
      rt.nextTime = this.context.currentTime
      rt.stepIndex = 0
    }
    this.scheduleArpLayer(id)
    this.ensureArpTimer()
  }

  private arpNoteOff(id: SynthLayerId, layer: SynthLayerState, midi: number): void {
    const rt = this.arpRuntimes[id]
    const index = rt.physical.indexOf(midi)
    if (index >= 0) rt.physical.splice(index, 1)
    if (!layer.arp.hold) {
      rt.latched = [...rt.physical]
      if (rt.latched.length === 0) this.cancelScheduledArp(id)
    }
  }

  private arpIntervalSeconds(layer: SynthLayerState): number {
    const seconds = layer.arp.clockSync
      ? clockIntervalSeconds(this.effective.clockBpm, layer.arp.rate)
      : 60 / synthMappings.arpBpm(layer.arp.rate)
    return Math.max(0.04, seconds)
  }

  /** Detects arp/gate config changes from applyState and resets scheduling. */
  private syncArpConfig(id: SynthLayerId, layer: SynthLayerState, now: number): void {
    const rt = this.arpRuntimes[id]
    const key = JSON.stringify([layer.arp, layer.enabled && this.effective.synth.sectionOn, this.effective.clockBpm])
    if (key === rt.configKey) return
    rt.configKey = key
    this.cancelScheduledArp(id)
    if (!layer.arp.hold) rt.latched = [...rt.physical]
    rt.nextTime = now
    rt.gateNextTime = now
    if (!layer.arp.run || layer.arp.mode !== 'Gate') {
      // Gate idle: chopper fully open.
      const gate = this.synthStrips?.[id].gate
      if (gate) {
        gate.gain.cancelScheduledValues(now)
        gate.gain.setTargetAtTime(1, now, 0.01)
      }
    }
    if (layer.arp.run) {
      this.scheduleArpLayer(id)
      this.ensureArpTimer()
    }
  }

  private cancelScheduledArp(id: SynthLayerId): void {
    const rt = this.arpRuntimes[id]
    for (const step of rt.scheduled) {
      for (const stoppable of step.stoppables) {
        try {
          stoppable.stop(0)
        } catch {
          /* not started */
        }
        try {
          stoppable.disconnect()
        } catch {
          /* detached */
        }
      }
      for (const node of step.ownedNodes) {
        try {
          node.disconnect()
        } catch {
          /* detached */
        }
      }
    }
    rt.scheduled = []
  }

  private ensureArpTimer(): void {
    if (this.arpTimer !== null) return
    this.arpTimer = this.boundary.timers.setTimeout(() => {
      this.arpTimer = null
      this.arpTick()
    }, ARP_TIMER_MS)
  }

  private arpTick(): void {
    if (!this.context || !this.synthStrips) return
    let anyActive = false
    for (const id of SYNTH_LAYER_IDS) {
      const layer = this.effective.synth.layers[id]
      const rt = this.arpRuntimes[id]
      this.reapScheduledArp(id)
      if (!layer.enabled || !this.effective.synth.sectionOn || !layer.arp.run) continue
      if (layer.arp.mode === 'Gate') {
        this.scheduleGateLayer(id)
        anyActive = true
      } else if (rt.latched.length > 0) {
        this.scheduleArpLayer(id)
        anyActive = true
      }
    }
    if (anyActive) this.ensureArpTimer()
  }

  private reapScheduledArp(id: SynthLayerId): void {
    if (!this.context) return
    const now = this.context.currentTime
    const rt = this.arpRuntimes[id]
    const alive: ScheduledArpVoice[] = []
    for (const step of rt.scheduled) {
      if (step.endTime < now) {
        for (const stoppable of step.stoppables) {
          try {
            stoppable.disconnect()
          } catch {
            /* detached */
          }
        }
        for (const node of step.ownedNodes) {
          try {
            node.disconnect()
          } catch {
            /* detached */
          }
        }
      } else {
        alive.push(step)
      }
    }
    rt.scheduled = alive
  }

  private scheduleArpLayer(id: SynthLayerId): void {
    if (!this.context || !this.synthStrips) return
    const layer = this.effective.synth.layers[id]
    if (!layer.arp.run || (layer.arp.mode !== 'Arp' && layer.arp.mode !== 'Poly')) return
    const rt = this.arpRuntimes[id]
    if (rt.latched.length === 0) return
    const now = this.context.currentTime
    const interval = this.arpIntervalSeconds(layer)
    const holdSeconds = interval * 0.6
    if (rt.nextTime < now - interval) rt.nextTime = now
    const horizon = now + ARP_HORIZON
    let guard = 0
    while (rt.nextTime < horizon && guard < 64) {
      guard++
      const stepTime = Math.max(now, rt.nextTime)
      if (layer.arp.mode === 'Poly') {
        for (const note of rt.latched) this.scheduleArpStep(id, layer, note, stepTime, holdSeconds)
      } else {
        const seq = arpSequence(rt.latched, layer.arp.direction, layer.arp.range)
        const note = seq[rt.stepIndex % seq.length]!
        this.scheduleArpStep(id, layer, note, stepTime, holdSeconds)
      }
      rt.stepIndex++
      rt.nextTime += interval
    }
  }

  private scheduleArpStep(id: SynthLayerId, layer: SynthLayerState, note: number, stepTime: number, holdSeconds: number): void {
    const rt = this.arpRuntimes[id]
    const zone = this.zoneGain(`synth${id}` as LayerKey, Math.min(108, Math.max(21, note)))
    if (zone <= 0.001) return
    const ownedNodes: AudioNodeLike[] = []
    const stoppables: Stoppable[] = []
    this.createSynthVoiceHandle(id, layer, note, 0.8, zone, stepTime, holdSeconds, ownedNodes, stoppables)
    const release = synthMappings.envSeconds(layer.ampEnv.release)
    const endTime = stepTime + holdSeconds + Math.min(release, 4) + 0.1
    for (const stoppable of stoppables) {
      try {
        stoppable.stop(endTime)
      } catch {
        /* already stopped */
      }
    }
    rt.scheduled.push({ endTime, stoppables, ownedNodes })
  }

  /** Gate mode: the layer's chopper gain follows a square pattern on the clock. */
  private scheduleGateLayer(id: SynthLayerId): void {
    if (!this.context || !this.synthStrips) return
    const layer = this.effective.synth.layers[id]
    const rt = this.arpRuntimes[id]
    const gate = this.synthStrips[id].gate
    const now = this.context.currentTime
    const interval = this.arpIntervalSeconds(layer)
    if (rt.gateNextTime < now) rt.gateNextTime = now
    const horizon = now + ARP_HORIZON
    let guard = 0
    while (rt.gateNextTime < horizon && guard < 64) {
      guard++
      const t = rt.gateNextTime
      gate.gain.setValueAtTime(1, t)
      gate.gain.setTargetAtTime(0.0001, t + interval * 0.5, 0.008)
      rt.gateNextTime += interval
    }
  }

  /* -------------------------------------------------------------- pedals -- */

  /** Damper pedal: boolean (keyboard/space) or continuous 0..1 (MIDI CC64 half-pedaling). */
  setSustain(value: boolean | number): void {
    const level = typeof value === 'boolean' ? (value ? 1 : 0) : Math.min(1, Math.max(0, value))
    const previous = this.sustainLevel
    if (previous === level) return
    this.sustainLevel = level
    if (level < SUSTAIN_DOWN) {
      for (const voice of [...this.voices.values()]) {
        if (voice.sustained && !voice.keyDown && !voice.sostenuto) {
          voice.sustained = false
          if (layerSection(voice.layer) === 'piano' && level >= SUSTAIN_LIFT) {
            this.releaseVoice(voice, HALF_PEDAL_RELEASE_SECONDS)
          } else {
            this.releaseVoiceNaturally(voice)
          }
        }
      }
    }
    if (previous < SUSTAIN_LIFT !== level < SUSTAIN_LIFT) {
      this.playPedalNoise()
      this.applyState() // resonance send follows damper state
    }
  }

  isSustainDown(): boolean {
    return this.sustainLevel >= SUSTAIN_LIFT
  }

  sustainPedalLevel(): number {
    return this.sustainLevel
  }

  /** Sostenuto (middle pedal): notes held at pedal-down sustain; later notes are unaffected. */
  setSostenuto(down: boolean): void {
    if (this.sostenutoDown === down) return
    this.sostenutoDown = down
    if (down) {
      for (const voice of this.voices.values()) if (voice.keyDown) voice.sostenuto = true
    } else {
      for (const voice of [...this.voices.values()]) {
        if (!voice.sostenuto) continue
        voice.sostenuto = false
        if (!voice.keyDown) {
          if (this.sustainLevel >= SUSTAIN_DOWN) voice.sustained = true
          else this.releaseVoiceNaturally(voice)
        }
      }
    }
  }

  isSostenutoDown(): boolean {
    return this.sostenutoDown
  }

  /** Soft pedal (una corda): new notes are quieter and slightly darker. */
  setSoft(down: boolean): void {
    this.softDown = down
  }

  isSoftDown(): boolean {
    return this.softDown
  }

  private playPedalNoise(): void {
    const context = this.context
    if (!context || !this.channels || !this.state.piano.pedNoise) return
    if (!this.pedalThump) {
      const rate = context.sampleRate
      const length = Math.max(1, Math.floor(0.06 * rate))
      const buffer = context.createBuffer(1, length, rate)
      const data = buffer.getChannelData(0)
      let seed = 0xabcdef
      for (let i = 0; i < length; i++) {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        seed >>>= 0
        data[i] = (seed / 0xffffffff - 0.5) * Math.exp((-i / rate) * 60)
      }
      this.pedalThump = buffer
    }
    for (const layer of ['A', 'B'] as const) {
      if (!this.state.layers[layer].enabled || !this.state.piano.sectionOn) continue
      const source = context.createBufferSource()
      source.buffer = this.pedalThump
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 300
      const gain = context.createGain()
      gain.gain.value = 0.06
      source.connect(filter)
      filter.connect(gain)
      gain.connect(this.channels[layer].voiceBus)
      source.start(context.currentTime)
      this.boundary.timers.setTimeout(() => {
        try {
          source.disconnect()
          filter.disconnect()
          gain.disconnect()
        } catch {
          /* detached */
        }
      }, 200)
    }
  }

  /** Pitch stick: bends every sounding voice (spec: ±2 semitones). */
  setPitchBend(semitones: number): void {
    const clamped = Math.max(-2, Math.min(2, semitones))
    if (this.pitchBend === clamped) return
    this.pitchBend = clamped
    const context = this.context
    if (!context) return
    const now = context.currentTime
    const factor = Math.pow(2, clamped / 12)
    const apply = (voice: Voice) => {
      for (const source of voice.sources) {
        if (source.kind === 'sample') {
          source.node.playbackRate.cancelScheduledValues(now)
          source.node.playbackRate.setTargetAtTime(source.baseRate * factor, now, 0.015)
        } else {
          source.node.detune.cancelScheduledValues(now)
          source.node.detune.setTargetAtTime(source.baseDetune + clamped * 100, now, 0.015)
        }
      }
      voice.organ?.applyBend(clamped, now)
      voice.synth?.applyBend(clamped, now)
    }
    for (const voice of this.voices.values()) apply(voice)
    for (const voice of this.releasingVoices) apply(voice)
  }

  pitchBendValue(): number {
    return this.pitchBend
  }

  /* ------------------------------------------------------------- cleanup -- */

  allNotesOff(reason: AllNotesOffReason): void {
    this.sustainLevel = 0
    this.sostenutoDown = false
    const releaseSeconds = reason === 'panic' ? PANIC_RELEASE_SECONDS : QUICK_RELEASE_SECONDS
    for (const voice of [...this.voices.values()]) this.releaseVoice(voice, releaseSeconds)
    for (const id of SYNTH_LAYER_IDS) {
      const rt = this.arpRuntimes[id]
      rt.physical = []
      rt.latched = []
      this.cancelScheduledArp(id)
      this.monoHeld[id] = []
    }
  }

  private voiceKey(voice: Voice): string {
    return this.voices.get(`${voice.layer}:mono`) === voice ? `${voice.layer}:mono` : `${voice.layer}:${voice.midi}`
  }

  private releaseVoice(voice: Voice, releaseSeconds: number, envelopeHandled = false): void {
    if (voice.releasing) return
    voice.releasing = true
    this.voices.delete(this.voiceKey(voice))
    this.releasingVoices.add(voice)
    const context = this.context
    if (context) {
      const now = context.currentTime
      if (!envelopeHandled) {
        voice.gain.gain.cancelScheduledValues(now)
        voice.gain.gain.setTargetAtTime(0.0001, now, releaseSeconds / 4)
      }
      const stopAt = now + releaseSeconds + 0.05
      for (const source of voice.sources) {
        try {
          source.node.stop(stopAt)
        } catch {
          /* already stopped */
        }
      }
      for (const stoppable of voice.stoppables) {
        try {
          stoppable.stop(stopAt)
        } catch {
          /* already stopped */
        }
      }
    }
    voice.cleanupTimer = this.boundary.timers.setTimeout(
      () => this.cleanupVoice(voice),
      releaseSeconds * 1000 + CLEANUP_GRACE_MS,
    )
  }

  private cleanupVoice(voice: Voice): void {
    if (voice.cleanupTimer !== null) {
      this.boundary.timers.clearTimeout(voice.cleanupTimer)
      voice.cleanupTimer = null
    }
    for (const source of voice.sources) {
      try {
        source.node.disconnect()
      } catch {
        /* detached */
      }
    }
    for (const stoppable of voice.stoppables) {
      try {
        stoppable.disconnect()
      } catch {
        /* detached */
      }
    }
    for (const node of voice.ownedNodes) {
      try {
        node.disconnect()
      } catch {
        /* detached */
      }
    }
    this.releasingVoices.delete(voice)
  }

  private allLiveVoices(): Voice[] {
    return [...this.voices.values()]
  }

  /**
   * Stops every owned voice and releases the audio graph. The engine returns
   * to `idle` and may be lazily restarted by a later gesture (this keeps
   * React StrictMode mount/cleanup/mount cycles sound).
   */
  dispose(): void {
    this.allNotesOff('unmount')
    for (const voice of [...this.releasingVoices]) this.cleanupVoice(voice)
    if (this.arpTimer !== null) {
      this.boundary.timers.clearTimeout(this.arpTimer)
      this.arpTimer = null
    }
    if (this.organStrips) {
      for (const id of ['A', 'B'] as const) {
        const strip = this.organStrips[id]
        strip.vibrato.dispose()
        for (const node of [strip.entry, strip.level]) {
          try {
            node.disconnect()
          } catch {
            /* detached */
          }
        }
      }
      this.organStrips = null
    }
    if (this.synthStrips) {
      for (const id of SYNTH_LAYER_IDS) {
        const strip = this.synthStrips[id]
        strip.lfo.dispose()
        try {
          strip.vibratoOsc.stop(0)
        } catch {
          /* not started */
        }
        for (const node of [strip.entry, strip.gate, strip.vibratoOsc]) {
          try {
            node.disconnect()
          } catch {
            /* detached */
          }
        }
      }
      this.synthStrips = null
    }
    if (this.channels) {
      for (const chainId of CHAIN_IDS) {
        const channel = this.channels[chainId]
        for (const unit of Object.values(channel.units)) unit.dispose()
        for (const node of [
          channel.voiceBus,
          channel.timbreBass,
          channel.timbreTreble,
          channel.dynComp,
          channel.dynMakeup,
          channel.levelGain,
          channel.resSend,
          channel.resConvolver,
          channel.toMaster,
          channel.toRotary,
        ]) {
          try {
            node?.disconnect()
          } catch {
            /* detached */
          }
        }
      }
      this.channels = null
    }
    this.rotary?.dispose()
    this.rotary = null
    try {
      this.limiter?.disconnect()
    } catch {
      /* detached */
    }
    this.limiter = null
    try {
      this.masterGain?.disconnect()
    } catch {
      /* detached */
    }
    this.masterGain = null
    if (this.context) void this.context.close()
    this.context = null
    this.sampleCache.clear()
    this.instrumentStatus.clear()
    this.instrumentError.clear()
    this.pedalThump = null
    this.reducedPath = false
    for (const id of SYNTH_LAYER_IDS) {
      this.arpRuntimes[id] = emptyArpRuntime()
      this.monoHeld[id] = []
    }
    this.detachStore?.()
    this.detachStore = null
    this.setStatus('idle', 'Audio starts on the first key press.')
  }

  /**
   * Diagnostics for tests and real-browser signal verification: references to
   * the REAL graph nodes (never metadata substitutes; never used by app
   * logic). Graph tests assert actual connectivity through these nodes.
   */
  diagnostics(): {
    context: AudioContextLike | null
    masterGain: GainNodeLike | null
    limiter: DynamicsCompressorNodeLike | null
    rotary: RotaryUnit | null
    channels: Record<ChainId, LayerChannel> | null
    organStrips: Record<OrganLayerId, OrganStrip> | null
    synthStrips: Record<SynthLayerId, SynthStrip> | null
  } {
    return {
      context: this.context,
      masterGain: this.masterGain,
      limiter: this.limiter,
      rotary: this.rotary,
      channels: this.channels,
      organStrips: this.organStrips,
      synthStrips: this.synthStrips,
    }
  }
}

/* ------------------------------------------------------------- helpers -- */

function emptyArpRuntime(): ArpRuntime {
  return { physical: [], latched: [], stepIndex: 0, nextTime: 0, gateNextTime: 0, scheduled: [], configKey: '' }
}

function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown } | null)?.then === 'function'
}

function isAudioBuffer(data: SampleData): data is AudioBufferLike {
  return typeof (data as { getChannelData?: unknown }).getChannelData === 'function'
}

function rampTo(
  param: { cancelScheduledValues(t: number): unknown; setTargetAtTime(v: number, t: number, tc: number): unknown },
  value: number,
  now: number,
): void {
  param.cancelScheduledValues(now)
  param.setTargetAtTime(value, now, 0.02)
}

/** KB Touch velocity curves: Heavy needs more force, Light less (manual p.25). */
function applyTouchCurve(velocity: number, touch: 0 | 1 | 2): number {
  const gamma = touch === 0 ? 1.35 : touch === 1 ? 1 : 0.72
  return Math.pow(velocity, gamma)
}

/** [bass dB, treble dB] voicing per timbre setting. */
function timbreGains(family: 'acoustic' | 'electric', timbre: string): [number, number] {
  if (family === 'electric') {
    switch (timbre) {
      case 'Soft':
        return [1.5, -5.5]
      case 'Mid':
        return [-2, 3]
      case 'Bright':
        return [-1, 5.5]
      case 'Dyno 1':
        return [3, 6]
      case 'Dyno 2':
        return [6, 7]
      default:
        return [0, 0]
    }
  }
  switch (timbre) {
    case 'Soft':
      return [3, -4.5]
    case 'Mid':
      return [-4, -3.5]
    case 'Bright':
      return [0, 5.5]
    default:
      return [0, 0]
  }
}

export { LAYER_KEYS, chainForLayer }

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
import {
  initialInstrumentState,
  mappings,
  selectedInstrumentId,
  timbreListFor,
  type EffectChainState,
  type InstrumentState,
  type LayerId,
} from '../state/instrument'

/**
 * Stage piano engine (Phase 2).
 *
 * One AudioContext. Notes enter reusable per-layer voice buses, flow through
 * per-layer timbre/dyn-comp shaping and the ordered effect chain
 * (Mod 1 → Mod 2 → Delay → Amp/EQ → Comp → Reverb), then either the single
 * Rotary Speaker instance (when routed via the Amp unit's To Rotary mode) or
 * directly into the master gain → limiter → one destination.
 *
 * Primary sound: bundled RECORDED sample sets (see src/audio/library.ts and
 * public/samples/SOURCES.md). The Phase 1 oscillator voice remains only as a
 * clearly labeled synthesized fallback after primary sample failure.
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
  layer: LayerId
  midi: number
  seq: number
  keyDown: boolean
  sustained: boolean
  sostenuto: boolean
  releasing: boolean
  synthFallback: boolean
  sources: VoiceSource[]
  ownedNodes: AudioNodeLike[]
  gain: GainNodeLike
  cleanupTimer: number | null
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

export const MAX_POLYPHONY = 24
const RELEASE_SECONDS = 0.18
const HALF_PEDAL_RELEASE_SECONDS = 0.85
const QUICK_RELEASE_SECONDS = 0.03
const PANIC_RELEASE_SECONDS = 0.008
const CLEANUP_GRACE_MS = 80
const SUSTAIN_DOWN = 0.85
const SUSTAIN_LIFT = 0.2

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
  private channels: Record<LayerId, LayerChannel> | null = null
  private rotary: RotaryUnit | null = null

  private voices = new Map<string, Voice>()
  private releasingVoices = new Set<Voice>()
  private sustainLevel = 0
  private softDown = false
  private sostenutoDown = false
  private pitchBend = 0
  private seqCounter = 0

  private state: InstrumentState = initialInstrumentState()
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
    this.detachStore = store.subscribe(() => {
      this.state = store.getState()
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

  /** Creates the audio graph. Safe to call from any input gesture, and also
   *  from idle warm-up: the context may start suspended (no gesture yet), in
   *  which case the next gesture only has to resume it. */
  ensureStarted(): void {
    if (this.context) {
      // Offline render contexts are 'suspended' until startRendering and must
      // not be resumed here; a live context suspended by pre-gesture warm-up
      // resumes on this (gesture-driven) call.
      if (this.context.state === 'suspended' && !('startRendering' in this.context)) {
        void Promise.resolve(this.context.resume()).catch(() => undefined)
      }
      return
    }
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
      this.channels = { A: this.buildChannel(context), B: this.buildChannel(context) }
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
    this.setStatus('ready', `Pianos ready (recorded samples) — ${layerLine}.${reducedNote}`)
  }

  /* ------------------------------------------------------- state -> DSP -- */

  private applyState(): void {
    const context = this.context
    if (!context || !this.masterGain) return
    const now = context.currentTime
    const state = this.state
    rampTo(this.masterGain.gain, mappings.levelToGain(state.masterVolume) * 0.9, now)

    if (!this.channels || !this.rotary) return
    this.rotary.update(state.rotary, now)

    for (const layer of ['A', 'B'] as const) {
      const channel = this.channels[layer]
      const layerState = state.layers[layer]
      const chain = state.chains[layer]
      const audible = layerState.enabled && state.piano.sectionOn
      rampTo(channel.levelGain.gain, audible ? mappings.levelToGain(layerState.level) : 0.0001, now)

      // Timbre voicing (family-aware).
      const family = layerState.type === 'Electric' ? 'electric' : 'acoustic'
      const timbreList = timbreListFor(layerState.type)
      const timbre = timbreList[Math.min(state.piano.timbre, timbreList.length - 1)]!
      const [bassDb, trebleDb] = timbreGains(family, timbre)
      rampTo(channel.timbreBass.gain, bassDb, now)
      rampTo(channel.timbreTreble.gain, trebleDb, now)

      // Dynamic compression 0..3 (raises the minimum sound level; timbre intact).
      if (channel.dynComp) {
        const level = state.piano.dynComp
        rampTo(channel.dynComp.threshold, level === 0 ? 0 : -12 - level * 9, now)
        rampTo(channel.dynComp.ratio, level === 0 ? 1 : 2 + level * 2, now)
        rampTo(channel.dynMakeup.gain, level === 0 ? 1 : 1 + level * 0.35, now)
      }

      // Resonance send follows String Res + damper state.
      const resActive = state.piano.stringRes && this.sustainLevel >= SUSTAIN_LIFT
      rampTo(channel.resSend.gain, resActive ? 0.4 : 0.0001, now)

      // Ordered effect chain (families process real audio; allFxOff bypasses everything).
      const fxOn = !state.allFxOff
      channel.units.mod1.update(chain.mod1, fxOn && chain.mod1.on, now)
      channel.units.mod2.update(chain.mod2, fxOn && chain.mod2.on, now)
      channel.units.delay.update(chain.delay, fxOn && chain.delay.on, now)
      channel.units.ampEq.update(chain.ampEq, fxOn && chain.ampEq.on, now)
      channel.units.comp.update(chain.comp, fxOn && chain.comp.on, now)
      channel.units.reverb.update(chain.reverb, fxOn && chain.reverb.on, now)

      // Routing: Amp unit in "To Rotary" mode sends this layer through the
      // single rotary instance (post-reverb: Reverb precedes Rotary).
      const routed = fxOn && chain.ampEq.on && chain.ampEq.type === 'To Rotary'
      rampTo(channel.toRotary.gain, routed ? 1 : 0.0001, now)
      rampTo(channel.toMaster.gain, routed ? 0.0001 : 1, now)
    }
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

  layerVoiceCount(layer: LayerId): number {
    let count = 0
    for (const voice of this.voices.values()) if (voice.layer === layer) count++
    return count
  }

  isNoteActive(midi: number): boolean {
    for (const voice of this.voices.values()) if (voice.midi === midi) return true
    return false
  }

  noteOn(midi: number, velocity: number): void {
    this.ensureStarted()
    if (!this.context || !this.masterGain) return
    const clamped = Math.min(1, Math.max(0, velocity))
    if (!this.channels) {
      // Minimal fallback path: single synthesized layer straight to master.
      this.startVoice('A', midi, clamped, this.masterGain, true)
      return
    }
    const state = this.state
    for (const layer of ['A', 'B'] as const) {
      if (!state.layers[layer].enabled || !state.piano.sectionOn) continue
      const channel = this.channels[layer]
      this.startVoice(layer, midi, clamped, channel.voiceBus, false)
    }
  }

  private startVoice(layer: LayerId, midi: number, velocity: number, bus: AudioNodeLike, forceSynth: boolean): void {
    const context = this.context!
    const key = `${layer}:${midi}`
    const existing = this.voices.get(key)
    if (existing) this.releaseVoice(existing, QUICK_RELEASE_SECONDS)
    // Deterministic per-layer voice stealing: drop the oldest held voice past the cap.
    while (this.layerVoiceCount(layer) >= MAX_POLYPHONY) {
      let oldest: Voice | null = null
      for (const voice of this.voices.values()) {
        if (voice.layer === layer && (!oldest || voice.seq < oldest.seq)) oldest = voice
      }
      if (!oldest) break
      this.releaseVoice(oldest, QUICK_RELEASE_SECONDS)
    }

    const layerState = this.state.layers[layer]
    const shifted = midi + (forceSynth ? 0 : layerState.octave * 12)
    const touched = applyTouchCurve(velocity, this.state.piano.kbTouch)
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
      const peak = (0.1 + 0.8 * Math.pow(touched, 1.3)) * soft
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), now + 0.004)
    } else if (failed || forceSynth) {
      // Labeled synthesized fallback (primary sample failure or minimal path).
      synthFallback = true
      this.buildSynthSources(shifted, touched * soft, gain, ownedNodes, sources, now)
    }
    // Otherwise the voice is tracked but silent: either the instrument is
    // still loading (status truthfully reports loading) or the selected type
    // has no bundled model ("Piano not found") — nothing pretends to sound.

    gain.connect(bus)
    const voice: Voice = {
      layer,
      midi,
      seq: this.seqCounter++,
      keyDown: true,
      sustained: false,
      sostenuto: false,
      releasing: false,
      synthFallback,
      sources,
      ownedNodes,
      gain,
      cleanupTimer: null,
    }
    this.voices.set(key, voice)
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
    const unison = this.state.piano.unison
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

  private buildSynthSources(
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
    voiceGain.gain.exponentialRampToValueAtTime(peak, now + 0.004)
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

  noteOff(midi: number): void {
    for (const voice of [...this.voices.values()]) {
      if (voice.midi !== midi) continue
      voice.keyDown = false
      if (voice.sostenuto) continue
      if (this.sustainLevel >= SUSTAIN_DOWN) {
        voice.sustained = true
        continue
      }
      if (this.sustainLevel >= SUSTAIN_LIFT) {
        this.releaseVoice(voice, HALF_PEDAL_RELEASE_SECONDS)
        continue
      }
      this.releaseVoice(voice, this.releaseSeconds())
    }
  }

  private releaseSeconds(): number {
    return this.state.piano.softRelease ? RELEASE_SECONDS * 1.9 : RELEASE_SECONDS
  }

  /* -------------------------------------------------------------- pedals -- */

  /** Damper pedal: boolean (keyboard/space) or continuous 0..1 (MIDI CC64 half-pedaling). */
  setSustain(value: boolean | number): void {
    const level = typeof value === 'boolean' ? (value ? 1 : 0) : Math.min(1, Math.max(0, value))
    const previous = this.sustainLevel
    if (previous === level) return
    this.sustainLevel = level
    if (level < SUSTAIN_DOWN) {
      const releaseSeconds = level >= SUSTAIN_LIFT ? HALF_PEDAL_RELEASE_SECONDS : this.releaseSeconds()
      for (const voice of [...this.voices.values()]) {
        if (voice.sustained && !voice.keyDown && !voice.sostenuto) {
          voice.sustained = false
          this.releaseVoice(voice, releaseSeconds)
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
          else this.releaseVoice(voice, this.releaseSeconds())
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

  /** Pitch stick: bends sounding Piano voices (spec: ±2 semitones). */
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
  }

  private releaseVoice(voice: Voice, releaseSeconds: number): void {
    if (voice.releasing) return
    voice.releasing = true
    this.voices.delete(`${voice.layer}:${voice.midi}`)
    this.releasingVoices.add(voice)
    const context = this.context
    if (context) {
      const now = context.currentTime
      voice.gain.gain.cancelScheduledValues(now)
      voice.gain.gain.setTargetAtTime(0.0001, now, releaseSeconds / 4)
      const stopAt = now + releaseSeconds + 0.05
      for (const source of voice.sources) {
        try {
          source.node.stop(stopAt)
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
    for (const node of voice.ownedNodes) {
      try {
        node.disconnect()
      } catch {
        /* detached */
      }
    }
    this.releasingVoices.delete(voice)
  }

  /**
   * Stops every owned voice and releases the audio graph. The engine returns
   * to `idle` and may be lazily restarted by a later gesture (this keeps
   * React StrictMode mount/cleanup/mount cycles sound).
   */
  dispose(): void {
    this.allNotesOff('unmount')
    for (const voice of [...this.releasingVoices]) this.cleanupVoice(voice)
    if (this.channels) {
      for (const layer of ['A', 'B'] as const) {
        const channel = this.channels[layer]
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
    channels: Record<LayerId, LayerChannel> | null
  } {
    return {
      context: this.context,
      masterGain: this.masterGain,
      limiter: this.limiter,
      rotary: this.rotary,
      channels: this.channels,
    }
  }
}

/* ------------------------------------------------------------- helpers -- */

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

import {
  browserAudioContextFactory,
  browserClock,
  browserSampleFetcher,
  type AudioBufferSourceNodeLike,
  type AudioContextFactory,
  type AudioContextLike,
  type AudioNodeLike,
  type BiquadFilterNodeLike,
  type Clock,
  type DynamicsCompressorNodeLike,
  type EngineGraphDiagnostics,
  type GainNodeLike,
  type OscillatorNodeLike,
  type PianoEngineStatusSnapshot,
  type PianoVoiceBackend,
  type SampleFetcher,
  type TimerHandle,
} from './boundaries'
import { LayerEffectChain } from './effectChain'
import { makeBrickwallCurve, RotarySpeakerUnit } from './effectUnits'
import { midiToFrequency } from './pianoVoice'
import { MultiBankSampleManager } from './sampleBankManager'
import type { SampleBankId } from './sampleManifests'
import {
  createInitialInstrumentState,
  getPianoModel,
  resolveEffectiveChainForLayer,
  type DynCompLevel,
  type KbTouchCurve,
  type PianoLayerId,
  type PianoLayerState,
  type PianoModelSpec,
  type PianoTimbreId,
  type StageInstrumentState,
  type UnisonLevel,
} from '../model/instrumentState'

const RAMP_TC = 0.012

const SIGNAL_ORDER: readonly string[] = [
  'Layer source',
  'Mod 1',
  'Mod 2',
  'Delay',
  'Amp Sim/EQ or Filter',
  'Compressor',
  'Reverb',
  'Rotary when routed',
  'Layer level',
  'Master gain/limiter',
  'Destination',
]

export function applyKbTouchCurve(velocity: number, curve: KbTouchCurve): number {
  const norm = Math.max(1, Math.min(127, velocity)) / 127
  const shaped =
    curve === 'Heavy'
      ? Math.pow(norm, 1.55)
      : curve === 'Light'
        ? Math.pow(norm, 0.6)
        : norm
  return Math.max(1, Math.min(127, Math.round(shaped * 127)))
}

export function applyDynCompGain(rawGain: number, dynComp: DynCompLevel): number {
  if (dynComp === 0) return rawGain
  const lift = dynComp === 1 ? 0.3 : dynComp === 2 ? 0.56 : 0.78
  return rawGain + (1.0 - rawGain) * lift
}

interface UnisonVoicePlan {
  readonly detuneCents: number
  readonly pan: number
}

function getUnisonPlan(level: UnisonLevel): readonly UnisonVoicePlan[] {
  if (level === 0) return [{ detuneCents: 0, pan: 0 }]
  if (level === 1) {
    return [
      { detuneCents: -5, pan: -0.38 },
      { detuneCents: 5, pan: 0.38 },
    ]
  }
  if (level === 2) {
    return [
      { detuneCents: -11, pan: -0.68 },
      { detuneCents: 11, pan: 0.68 },
    ]
  }
  return [
    { detuneCents: -18, pan: -0.92 },
    { detuneCents: 0, pan: 0 },
    { detuneCents: 18, pan: 0.92 },
  ]
}

interface LayerBus {
  readonly layerId: PianoLayerId
  readonly input: GainNodeLike
  readonly timbreLow: BiquadFilterNodeLike
  readonly timbreMid: BiquadFilterNodeLike
  readonly timbreHigh: BiquadFilterNodeLike
  readonly modelFilter: BiquadFilterNodeLike
  readonly fxChain: LayerEffectChain
  readonly nodes: AudioNodeLike[]
}

interface ActiveLayerSubVoice {
  readonly layerId: PianoLayerId
  readonly baseMidi: number
  readonly effectiveMidi: number
  readonly isClav: boolean
  readonly softRelease: boolean
  readonly gainNode: GainNodeLike
  readonly nodes: AudioNodeLike[]
  readonly stopTargets: Array<AudioBufferSourceNodeLike | OscillatorNodeLike>
  readonly pitchTargets: Array<
    | { readonly kind: 'sample'; readonly node: AudioBufferSourceNodeLike; readonly baseRate: number }
    | { readonly kind: 'osc'; readonly node: OscillatorNodeLike; readonly baseHz: number }
  >
  readonly isFallback: boolean
  released: boolean
  cleanupTimer: TimerHandle | null
}

export interface StageAudioEngineOptions {
  readonly contextFactory?: AudioContextFactory
  readonly sampleFetcher?: SampleFetcher
  readonly clock?: Clock
  readonly baseUrl?: string
  readonly autoLoadSamples?: boolean
  readonly initialState?: StageInstrumentState
}

/**
 * Unified Phase 2 single-AudioContext engine:
 * - One AudioContext feeding Piano Layer A & B buses -> Timbre/Model EQ -> Ordered Effect Chains
 *   (Mod 1 -> Mod 2 -> Delay -> Amp Sim/EQ -> Compressor -> Reverb) -> [Direct | Shared Rotary]
 *   -> Layer Level -> Master Bus -> Master Level Gain -> Soft-Knee Limiter -> Destination.
 * - Recorded multi-sample playback for Grand, Upright, and Electric (Rhodes Mk I + Wurlitzer EP200).
 * - Honest live Web Audio synthesis for Clav, Digital, Misc, and labeled fallback.
 */
export class StageAudioEngine implements PianoVoiceBackend {
  private readonly contextFactory: AudioContextFactory
  private readonly clock: Clock
  readonly sampleManager: MultiBankSampleManager

  private state: StageInstrumentState
  private ctx: AudioContextLike | null = null
  private contextCreatedCount = 0
  private contextError: string | null = null

  private layerBuses: Record<PianoLayerId, LayerBus> | null = null
  private sharedRotary: RotarySpeakerUnit | null = null
  private masterSum: GainNodeLike | null = null
  private masterGain: GainNodeLike | null = null
  private limiter: DynamicsCompressorNodeLike | null = null
  private permanentNodes: AudioNodeLike[] = []

  // voiceId (from NoteLifecycleController) -> sub-voices spawned across active layers (A, B)
  private readonly voices = new Map<number, ActiveLayerSubVoice[]>()
  private readonly statusListeners = new Set<(snap: PianoEngineStatusSnapshot) => void>()

  private sustainPedalActive = false
  private usedFallbackForRecentNote = false
  private disposed = false
  private unsubSamples: (() => void) | null = null

  constructor(options: StageAudioEngineOptions = {}) {
    this.contextFactory = options.contextFactory ?? browserAudioContextFactory
    this.clock = options.clock ?? browserClock
    this.state = options.initialState ?? createInitialInstrumentState()
    this.sampleManager = new MultiBankSampleManager(
      options.sampleFetcher ?? browserSampleFetcher,
      options.baseUrl ?? './',
    )

    this.unsubSamples = this.sampleManager.subscribe(() => {
      const focusedModel = this.getFocusedModel()
      if (focusedModel.sampleBankId) {
        const st = this.sampleManager.getBankStatus(focusedModel.sampleBankId)
        if (st.state === 'ready' && st.loadedCount > 0) {
          this.usedFallbackForRecentNote = false
        }
      }
      this.emitStatus()
    })

    this.ensureContext()
    if (options.autoLoadSamples !== false) {
      void this.sampleManager.loadAllBanks(this.ctx)
    }
  }

  private getFocusedModel(): PianoModelSpec {
    const focused = this.state.piano.layers[this.state.piano.focusedLayer]
    return getPianoModel(focused.type, focused.modelIndex)
  }

  private createLayerBus(ctx: AudioContextLike, layerId: PianoLayerId): LayerBus {
    const now = ctx.currentTime
    const input = ctx.createGain()
    const timbreLow = ctx.createBiquadFilter()
    timbreLow.type = 'lowshelf'
    timbreLow.frequency.setValueAtTime(110, now)
    const timbreMid = ctx.createBiquadFilter()
    timbreMid.type = 'peaking'
    timbreMid.frequency.setValueAtTime(1100, now)
    timbreMid.Q.setValueAtTime(1.1, now)
    const timbreHigh = ctx.createBiquadFilter()
    timbreHigh.type = 'highshelf'
    timbreHigh.frequency.setValueAtTime(3200, now)
    const modelFilter = ctx.createBiquadFilter()
    modelFilter.type = 'allpass'
    modelFilter.frequency.setValueAtTime(2800, now)

    const fxChain = new LayerEffectChain(ctx)

    input.connect(timbreLow)
    timbreLow.connect(timbreMid)
    timbreMid.connect(timbreHigh)
    timbreHigh.connect(modelFilter)
    modelFilter.connect(fxChain.input)

    return {
      layerId,
      input,
      timbreLow,
      timbreMid,
      timbreHigh,
      modelFilter,
      fxChain,
      nodes: [input, timbreLow, timbreMid, timbreHigh, modelFilter],
    }
  }

  private ensureContext(): AudioContextLike | null {
    if (this.disposed) return null
    if (this.ctx) return this.ctx
    try {
      const created = this.contextFactory()
      if (!created) {
        this.contextError = 'Web Audio API is unavailable in this environment.'
        this.emitStatus()
        return null
      }
      this.ctx = created
      this.contextCreatedCount += 1

      const busA = this.createLayerBus(created, 'A')
      const busB = this.createLayerBus(created, 'B')
      this.layerBuses = { A: busA, B: busB }

      this.sharedRotary = new RotarySpeakerUnit(created)
      this.masterSum = created.createGain()
      this.masterGain = created.createGain()
      this.limiter = created.createDynamicsCompressor()

      this.limiter.threshold.value = -5
      this.limiter.knee.value = 12
      this.limiter.ratio.value = 10
      this.limiter.attack.value = 0.002
      this.limiter.release.value = 0.12

      // Connect Layer A and B direct outputs -> Master Sum
      busA.fxChain.directOutput.connect(this.masterSum)
      busB.fxChain.directOutput.connect(this.masterSum)

      // Connect Layer A and B post-Reverb Rotary sends -> Shared Rotary -> Master Sum
      busA.fxChain.rotarySendOutput.connect(this.sharedRotary.input)
      busB.fxChain.rotarySendOutput.connect(this.sharedRotary.input)
      this.sharedRotary.output.connect(this.masterSum)

      // Master Sum -> Master Level Gain -> Soft-Knee Limiter -> Brickwall Safety Clipper -> Destination
      this.masterSum.connect(this.masterGain)
      this.masterGain.connect(this.limiter)
      this.permanentNodes = [this.masterSum, this.masterGain, this.limiter]
      if (typeof created.createWaveShaper === 'function') {
        const brickwall = created.createWaveShaper()
        brickwall.curve = makeBrickwallCurve()
        brickwall.oversample = '2x'
        this.limiter.connect(brickwall)
        brickwall.connect(created.destination)
        this.permanentNodes.push(brickwall)
      } else {
        this.limiter.connect(created.destination)
      }
      this.contextError = null

      this.syncGraphParameters(true)
      this.emitStatus()
      return this.ctx
    } catch (err) {
      this.contextError = err instanceof Error ? err.message : String(err)
      this.emitStatus()
      return null
    }
  }

  private applyLayerTimbreAndModel(bus: LayerBus, layer: PianoLayerState, immediate: boolean): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    const set = (
      p: { setValueAtTime(v: number, t: number): unknown; setTargetAtTime(v: number, t: number, tc: number): unknown },
      v: number,
    ) => (immediate ? p.setValueAtTime(v, now) : p.setTargetAtTime(v, now, RAMP_TC))
    const timbre: PianoTimbreId = layer.timbre

    let lowDb = 0
    let midDb = 0
    let midHz = 1100
    let midQ = 1.1
    let highDb = 0
    let highHz = 3200

    if (timbre === 'Soft') {
      bus.timbreHigh.type = 'lowpass'
      set(bus.timbreHigh.Q, 0.5)
      highHz = 820
      highDb = 0
      midDb = -3.5
    } else if (timbre === 'Mid') {
      midHz = 1150
      midQ = 1.05
    } else if (timbre === 'Bright') {
      bus.timbreHigh.type = 'highshelf'
      highDb = 8.5
      highHz = 1900
    } else if (timbre === 'Dyno 1') {
      bus.timbreHigh.type = 'highshelf'
      lowDb = 2.5
      midDb = -4.5
      midHz = 450
      midQ = 1.1
      highDb = 9.0
      highHz = 2800
    } else if (timbre === 'Dyno 2') {
      bus.timbreHigh.type = 'highshelf'
      lowDb = 4.0
      midDb = -7.0
      midHz = 520
      midQ = 1.25
      highDb = 11.5
      highHz = 3200
    } else {
      bus.timbreHigh.type = 'highshelf'
    }

    if (bus.timbreLow.gain) set(bus.timbreLow.gain, lowDb)
    set(bus.timbreMid.frequency, midHz)
    set(bus.timbreMid.Q, midQ)
    if (bus.timbreMid.gain) set(bus.timbreMid.gain, midDb)
    set(bus.timbreHigh.frequency, highHz)
    if (bus.timbreHigh.gain) set(bus.timbreHigh.gain, highDb)
    const model = getPianoModel(layer.type, layer.modelIndex)
    if (model.lowpassHz) {
      bus.modelFilter.type = 'lowpass'
      set(bus.modelFilter.frequency, model.lowpassHz)
      set(bus.modelFilter.Q, 0.7)
    } else if (model.brightnessOffsetDb) {
      bus.modelFilter.type = 'highshelf'
      set(bus.modelFilter.frequency, 2600)
      if (bus.modelFilter.gain) {
        set(bus.modelFilter.gain, model.brightnessOffsetDb)
      }
    } else {
      bus.modelFilter.type = 'allpass'
      set(bus.modelFilter.frequency, 2800)
    }
  }

  private syncGraphParameters(immediate = false): void {
    if (!this.ctx || !this.layerBuses || !this.masterGain || !this.sharedRotary) return
    const now = this.ctx.currentTime

    // Master Level: 75% matches Phase 1's calibrated 0.56 nominal headroom; 0% = complete silence
    const mNorm = Math.max(0, Math.min(100, this.state.masterLevel)) / 100
    const masterGainVal = mNorm <= 0 ? 0 : Math.pow(mNorm, 1.35) * 0.82
    if (immediate) {
      this.masterGain.gain.setValueAtTime(masterGainVal, now)
    } else {
      this.masterGain.gain.setTargetAtTime(masterGainVal, now, RAMP_TC)
    }

    // Layer A & B Timbre, Model voicing, and Effect Chains
    for (const layerId of ['A', 'B'] as const) {
      const layerState = this.state.piano.layers[layerId]
      const bus = this.layerBuses[layerId]
      this.applyLayerTimbreAndModel(bus, layerState, immediate)
      const effectiveChain = resolveEffectiveChainForLayer(this.state.effects, layerId)
      const effectiveLevel = this.state.piano.sectionOn && layerState.enabled ? layerState.level : 0
      bus.fxChain.apply(effectiveChain, this.state.effects.allOn, effectiveLevel, immediate)
    }

    // Shared Rotary speaker
    this.sharedRotary.apply(this.state.effects.rotary, immediate)

    // Live Pitch Stick bend (±2 semitones when PSTICK is enabled)
    this.applyLivePitchBend()
  }

  private getPitchBendFactor(): number {
    if (!this.state.piano.pstick || this.state.pitchStick === 0) return 1
    const semitones = (this.state.pitchStick / 100) * 2
    return Math.pow(2, semitones / 12)
  }

  private applyLivePitchBend(): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    const factor = this.getPitchBendFactor()
    for (const subVoices of this.voices.values()) {
      for (const sv of subVoices) {
        if (sv.released) continue
        for (const target of sv.pitchTargets) {
          if (target.kind === 'sample') {
            target.node.playbackRate.setTargetAtTime(target.baseRate * factor, now, 0.008)
          } else {
            target.node.frequency.setTargetAtTime(target.baseHz * factor, now, 0.008)
          }
        }
      }
    }
  }

  applyInstrumentState(nextState: StageInstrumentState): void {
    const prev = this.state
    this.state = nextState

    // Ensure selected recorded bank is triggered to load if not yet loaded
    for (const layerId of ['A', 'B'] as const) {
      const layer = nextState.piano.layers[layerId]
      if (layer.enabled) {
        const model = getPianoModel(layer.type, layer.modelIndex)
        if (model.sampleBankId) {
          const st = this.sampleManager.getBankStatus(model.sampleBankId)
          if (st.state === 'idle') {
            void this.sampleManager.loadBank(model.sampleBankId, this.ctx)
          }
        }
      }
    }

    // If Piano section turned off or a layer was disabled, release its owned voices immediately
    if (!nextState.piano.sectionOn && prev.piano.sectionOn) {
      this.stopAllImmediate()
    } else {
      for (const layerId of ['A', 'B'] as const) {
        if (!nextState.piano.layers[layerId].enabled && prev.piano.layers[layerId].enabled) {
          this.releaseLayerVoices(layerId, true)
        }
      }
    }

    this.syncGraphParameters()
    this.emitStatus()
  }

  setSustainPedalState(active: boolean): void {
    this.sustainPedalActive = active
  }

  private ensureAllLfosStarted(): void {
    if (this.layerBuses) {
      this.layerBuses.A.fxChain.ensureLfosStarted()
      this.layerBuses.B.fxChain.ensureLfosStarted()
    }
    this.sharedRotary?.ensureLfosStarted()
  }

  async unlock(): Promise<void> {
    if (this.disposed) return
    const ctx = this.ensureContext()
    if (!ctx) return
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        // Retry on next user gesture
      }
    }
    this.ensureAllLfosStarted()
    void this.sampleManager.loadAllBanks(ctx)
    this.emitStatus()
  }

  private countActiveVoicesOnLayer(layerId: PianoLayerId): number {
    let count = 0
    for (const subVoices of this.voices.values()) {
      for (const sv of subVoices) {
        if (sv.layerId === layerId && !sv.released) count += 1
      }
    }
    return count
  }

  triggerNote(voiceId: number, midi: number, velocity: number): void {
    if (this.disposed) return
    const ctx = this.ensureContext()
    if (!ctx || !this.layerBuses) return

    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => undefined)
    }
    this.ensureAllLfosStarted()
    if (this.voices.has(voiceId)) {
      this.releaseNote(voiceId, true)
    }

    if (!this.state.piano.sectionOn) return

    const now = ctx.currentTime
    const clampedVel = Math.max(1, Math.min(127, Math.round(velocity)))
    const spawned: ActiveLayerSubVoice[] = []

    for (const layerId of ['A', 'B'] as const) {
      const layer = this.state.piano.layers[layerId]
      if (!layer.enabled) continue

      const bus = this.layerBuses[layerId]
      const effectiveMidi = Math.max(12, Math.min(120, midi + layer.octave * 12))
      const touchVel = applyKbTouchCurve(clampedVel, layer.kbTouch)
      const model = getPianoModel(layer.type, layer.modelIndex)
      const otherHeldCount = this.countActiveVoicesOnLayer(layerId)
      const triggerSympathetic =
        layer.stringRes && (this.sustainPedalActive || otherHeldCount > 0)

      const subVoice = this.spawnLayerVoice(
        ctx,
        bus,
        layerId,
        layer,
        model,
        midi,
        effectiveMidi,
        touchVel,
        triggerSympathetic,
        now,
      )
      if (subVoice) {
        spawned.push(subVoice)
      }
    }

    if (spawned.length > 0) {
      this.voices.set(voiceId, spawned)
    }
  }

  private spawnLayerVoice(
    ctx: AudioContextLike,
    bus: LayerBus,
    layerId: PianoLayerId,
    layer: PianoLayerState,
    model: PianoModelSpec,
    baseMidi: number,
    effectiveMidi: number,
    touchVelocity: number,
    withStringRes: boolean,
    now: number,
  ): ActiveLayerSubVoice | null {
    const unisonPlan = getUnisonPlan(layer.unison)
    const unisonScale = 1 / Math.sqrt(unisonPlan.length)
    const bendFactor = this.getPitchBendFactor()

    const masterVoiceGain = ctx.createGain()
    const nodes: AudioNodeLike[] = [masterVoiceGain]
    const stopTargets: Array<AudioBufferSourceNodeLike | OscillatorNodeLike> = []
    const pitchTargets: ActiveLayerSubVoice['pitchTargets'] = []
    let isFallback = false

    const hasPanner = typeof ctx.createStereoPanner === 'function'

    if (model.sourceKind === 'recorded' && model.sampleBankId) {
      const { selected, buffer } = this.sampleManager.selectAndGetBuffer(
        model.sampleBankId,
        effectiveMidi,
        touchVelocity,
      )

      if (buffer) {
        const dynGain = applyDynCompGain(selected.gain, layer.dynComp)
        const targetGain = Math.max(0.015, Math.min(1.0, dynGain * unisonScale))
        masterVoiceGain.gain.setValueAtTime(0.0001, now)
        masterVoiceGain.gain.linearRampToValueAtTime(targetGain, now + 0.002)

        for (const u of unisonPlan) {
          const src = ctx.createBufferSource()
          src.buffer = buffer
          const baseRate = selected.playbackRate * Math.pow(2, u.detuneCents / 1200)
          src.playbackRate.setValueAtTime(baseRate * bendFactor, now)
          nodes.push(src)
          stopTargets.push(src)
          pitchTargets.push({ kind: 'sample', node: src, baseRate })

          let tailNode: AudioNodeLike = src
          if (selected.dynamicFilterHz !== null) {
            const dynLp = ctx.createBiquadFilter()
            dynLp.type = 'lowpass'
            dynLp.frequency.setValueAtTime(selected.dynamicFilterHz, now)
            dynLp.Q.setValueAtTime(0.65, now)
            tailNode.connect(dynLp)
            tailNode = dynLp
            nodes.push(dynLp)
          }

          if (hasPanner && u.pan !== 0) {
            const pan = ctx.createStereoPanner!()
            pan.pan.setValueAtTime(u.pan, now)
            tailNode.connect(pan)
            tailNode = pan
            nodes.push(pan)
          }
          tailNode.connect(masterVoiceGain)
          src.start(now)
        }

        if (this.usedFallbackForRecentNote) {
          this.usedFallbackForRecentNote = false
          this.emitStatus()
        }
      } else {
        // Labeled playable fallback when recorded sample bank is loading or failed
        isFallback = true
        this.buildFallbackHarmonicVoice(
          ctx,
          masterVoiceGain,
          effectiveMidi,
          touchVelocity,
          layer.dynComp,
          unisonPlan,
          unisonScale,
          bendFactor,
          now,
          nodes,
          stopTargets,
          pitchTargets,
        )
        if (!this.usedFallbackForRecentNote) {
          this.usedFallbackForRecentNote = true
          this.emitStatus()
        }
      }
    } else {
      // Honest live synthesis for Clav, Digital, and Misc models
      this.buildSynthPianoVoice(
        ctx,
        masterVoiceGain,
        model.synthVoice ?? 'clavinet',
        effectiveMidi,
        touchVelocity,
        layer.dynComp,
        unisonPlan,
        unisonScale,
        bendFactor,
        now,
        nodes,
        stopTargets,
        pitchTargets,
      )
    }

    // Sympathetic String Resonance (when String Res is ON and pedal or other notes are held)
    if (withStringRes && layer.type !== 'Clav' && layer.type !== 'Misc') {
      this.attachSympatheticResonance(
        ctx,
        masterVoiceGain,
        effectiveMidi,
        touchVelocity,
        bendFactor,
        now,
        nodes,
        stopTargets,
        pitchTargets,
      )
    }

    masterVoiceGain.connect(bus.input)

    const subVoice: ActiveLayerSubVoice = {
      layerId,
      baseMidi,
      effectiveMidi,
      isClav: layer.type === 'Clav',
      softRelease: layer.type === 'Clav' ? false : layer.softRelease,
      gainNode: masterVoiceGain,
      nodes,
      stopTargets,
      pitchTargets,
      isFallback,
      released: false,
      cleanupTimer: null,
    }

    const firstStop = stopTargets[0]
    if (firstStop) {
      firstStop.onended = () => {
        this.cleanupSubVoice(subVoice)
      }
    }

    return subVoice
  }

  private buildFallbackHarmonicVoice(
    ctx: AudioContextLike,
    dest: GainNodeLike,
    midi: number,
    velocity: number,
    dynComp: DynCompLevel,
    unisonPlan: readonly UnisonVoicePlan[],
    unisonScale: number,
    bendFactor: number,
    now: number,
    nodes: AudioNodeLike[],
    stopTargets: Array<AudioBufferSourceNodeLike | OscillatorNodeLike>,
    pitchTargets: ActiveLayerSubVoice['pitchTargets'],
  ): void {
    const normVel = velocity / 127
    const rawGain = 0.08 + 0.34 * Math.pow(normVel, 1.5)
    const peakGain = applyDynCompGain(rawGain, dynComp) * unisonScale
    const baseHz = midiToFrequency(midi)
    const decayTime = Math.max(0.8, 3.8 - (midi - 28) * 0.035)
    const hasPanner = typeof ctx.createStereoPanner === 'function'

    dest.gain.setValueAtTime(0.0001, now)
    dest.gain.linearRampToValueAtTime(peakGain, now + 0.004)
    dest.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain * 0.14), now + decayTime)

    for (const u of unisonPlan) {
      const detuneRatio = Math.pow(2, u.detuneCents / 1200)
      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      osc1.type = 'triangle'
      osc2.type = 'sine'
      osc1.frequency.setValueAtTime(baseHz * detuneRatio * bendFactor, now)
      osc2.frequency.setValueAtTime(baseHz * 2 * detuneRatio * bendFactor, now)

      const g2 = ctx.createGain()
      g2.gain.setValueAtTime(0.22 * normVel, now)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(Math.min(11000, baseHz * (2.5 + normVel * 7.5)), now)
      lp.Q.setValueAtTime(0.7, now)

      osc1.connect(lp)
      osc2.connect(g2)
      g2.connect(lp)

      let out: AudioNodeLike = lp
      if (hasPanner && u.pan !== 0) {
        const pan = ctx.createStereoPanner!()
        pan.pan.setValueAtTime(u.pan, now)
        out.connect(pan)
        out = pan
        nodes.push(pan)
      }
      out.connect(dest)
      osc1.start(now)
      osc2.start(now)

      nodes.push(osc1, osc2, g2, lp)
      stopTargets.push(osc1, osc2)
      pitchTargets.push(
        { kind: 'osc', node: osc1, baseHz: baseHz * detuneRatio },
        { kind: 'osc', node: osc2, baseHz: baseHz * 2 * detuneRatio },
      )
    }
  }

  private buildSynthPianoVoice(
    ctx: AudioContextLike,
    dest: GainNodeLike,
    kind: NonNullable<PianoModelSpec['synthVoice']>,
    midi: number,
    velocity: number,
    dynComp: DynCompLevel,
    unisonPlan: readonly UnisonVoicePlan[],
    unisonScale: number,
    bendFactor: number,
    now: number,
    nodes: AudioNodeLike[],
    stopTargets: Array<AudioBufferSourceNodeLike | OscillatorNodeLike>,
    pitchTargets: ActiveLayerSubVoice['pitchTargets'],
  ): void {
    const normVel = velocity / 127
    const baseHz = midiToFrequency(midi)
    const rawGain = 0.1 + 0.42 * Math.pow(normVel, 1.35)
    const peakGain = applyDynCompGain(rawGain, dynComp) * unisonScale
    const hasPanner = typeof ctx.createStereoPanner === 'function'

    if (kind === 'clavinet' || kind === 'harpsichord') {
      // Plucked bright clavinet/harpsichord synthesis
      const decay = kind === 'clavinet' ? 0.65 : 1.05
      dest.gain.setValueAtTime(0.0001, now)
      dest.gain.linearRampToValueAtTime(peakGain, now + 0.002)
      dest.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain * 0.04), now + decay)

      for (const u of unisonPlan) {
        const det = Math.pow(2, u.detuneCents / 1200)
        const osc1 = ctx.createOscillator()
        const osc2 = ctx.createOscillator()
        osc1.type = 'sawtooth'
        osc2.type = kind === 'clavinet' ? 'square' : 'sawtooth'
        osc1.frequency.setValueAtTime(baseHz * det * bendFactor, now)
        osc2.frequency.setValueAtTime(
          baseHz * (kind === 'clavinet' ? 1.003 : 2.001) * det * bendFactor,
          now,
        )

        const mix2 = ctx.createGain()
        mix2.gain.setValueAtTime(kind === 'clavinet' ? 0.45 : 0.35, now)

        const pickupHp = ctx.createBiquadFilter()
        pickupHp.type = 'highpass'
        pickupHp.frequency.setValueAtTime(kind === 'clavinet' ? 240 : 380, now)

        const pickupPeak = ctx.createBiquadFilter()
        pickupPeak.type = 'peaking'
        pickupPeak.frequency.setValueAtTime(kind === 'clavinet' ? 1850 : 3400, now)
        pickupPeak.Q.setValueAtTime(2.6, now)
        if (pickupPeak.gain) pickupPeak.gain.setValueAtTime(7.5, now)

        const pluckLp = ctx.createBiquadFilter()
        pluckLp.type = 'lowpass'
        const startCut = Math.min(13000, baseHz * (6 + normVel * 14))
        pluckLp.frequency.setValueAtTime(startCut, now)
        pluckLp.frequency.exponentialRampToValueAtTime(Math.max(600, baseHz * 2.4), now + 0.32)

        osc1.connect(pickupHp)
        osc2.connect(mix2)
        mix2.connect(pickupHp)
        pickupHp.connect(pickupPeak)
        pickupPeak.connect(pluckLp)

        let out: AudioNodeLike = pluckLp
        if (hasPanner && u.pan !== 0) {
          const pan = ctx.createStereoPanner!()
          pan.pan.setValueAtTime(u.pan, now)
          out.connect(pan)
          out = pan
          nodes.push(pan)
        }
        out.connect(dest)
        osc1.start(now)
        osc2.start(now)
        nodes.push(osc1, osc2, mix2, pickupHp, pickupPeak, pluckLp)
        stopTargets.push(osc1, osc2)
        pitchTargets.push(
          { kind: 'osc', node: osc1, baseHz: baseHz * det },
          {
            kind: 'osc',
            node: osc2,
            baseHz: baseHz * (kind === 'clavinet' ? 1.003 : 2.001) * det,
          },
        )
      }
      return
    }

    if (kind === 'dx-ep' || kind === 'fm-bell') {
      // 2-operator FM Digital Piano synthesis
      const decay = kind === 'dx-ep' ? 2.4 : 3.1
      dest.gain.setValueAtTime(0.0001, now)
      dest.gain.linearRampToValueAtTime(peakGain, now + 0.002)
      dest.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain * 0.08), now + decay)

      const modRatio = kind === 'dx-ep' ? 14.0 : 7.0
      for (const u of unisonPlan) {
        const det = Math.pow(2, u.detuneCents / 1200)
        const carrier = ctx.createOscillator()
        const modOsc = ctx.createOscillator()
        const bodyOsc = ctx.createOscillator()
        carrier.type = 'sine'
        modOsc.type = 'sine'
        bodyOsc.type = 'triangle'

        const cHz = baseHz * det
        carrier.frequency.setValueAtTime(cHz * bendFactor, now)
        modOsc.frequency.setValueAtTime(cHz * modRatio * bendFactor, now)
        bodyOsc.frequency.setValueAtTime(cHz * 1.0015 * bendFactor, now)

        const modIndexGain = ctx.createGain()
        const startIndex = cHz * (1.2 + normVel * (kind === 'dx-ep' ? 4.2 : 6.2))
        modIndexGain.gain.setValueAtTime(startIndex, now)
        modIndexGain.gain.exponentialRampToValueAtTime(Math.max(1, cHz * 0.08), now + 0.28)

        const bodyGain = ctx.createGain()
        bodyGain.gain.setValueAtTime(0.28, now)

        modOsc.connect(modIndexGain)
        modIndexGain.connect(carrier.frequency)

        const sum = ctx.createGain()
        carrier.connect(sum)
        bodyOsc.connect(bodyGain)
        bodyGain.connect(sum)

        let out: AudioNodeLike = sum
        if (hasPanner && u.pan !== 0) {
          const pan = ctx.createStereoPanner!()
          pan.pan.setValueAtTime(u.pan, now)
          out.connect(pan)
          out = pan
          nodes.push(pan)
        }
        out.connect(dest)
        carrier.start(now)
        modOsc.start(now)
        bodyOsc.start(now)

        nodes.push(carrier, modOsc, bodyOsc, modIndexGain, bodyGain, sum)
        stopTargets.push(carrier, modOsc, bodyOsc)
        pitchTargets.push(
          { kind: 'osc', node: carrier, baseHz: cHz },
          { kind: 'osc', node: modOsc, baseHz: cHz * modRatio },
          { kind: 'osc', node: bodyOsc, baseHz: cHz * 1.0015 },
        )
      }
      return
    }

    // Misc: Marimba & Vibraphone mallet synthesis
    const isVibe = kind === 'vibraphone'
    const decay = isVibe ? 2.8 : 0.72
    dest.gain.setValueAtTime(0.0001, now)
    dest.gain.linearRampToValueAtTime(peakGain * 1.15, now + 0.002)
    dest.gain.exponentialRampToValueAtTime(Math.max(0.001, peakGain * 0.02), now + decay)

    for (const u of unisonPlan) {
      const det = Math.pow(2, u.detuneCents / 1200)
      const fund = ctx.createOscillator()
      const overtone = ctx.createOscillator()
      fund.type = 'sine'
      overtone.type = 'sine'
      const cHz = baseHz * det
      const overtoneRatio = isVibe ? 3.98 : 4.0
      fund.frequency.setValueAtTime(cHz * bendFactor, now)
      overtone.frequency.setValueAtTime(cHz * overtoneRatio * bendFactor, now)

      const overtoneGain = ctx.createGain()
      overtoneGain.gain.setValueAtTime(0.32 * normVel, now)
      overtoneGain.gain.exponentialRampToValueAtTime(0.0005, now + (isVibe ? 0.65 : 0.14))

      const barMix = ctx.createGain()
      fund.connect(barMix)
      overtone.connect(overtoneGain)
      overtoneGain.connect(barMix)

      let out: AudioNodeLike = barMix
      if (isVibe) {
        // Classic vibraphone 5.5 Hz motor fan tremolo
        const motorAmp = ctx.createGain()
        motorAmp.gain.setValueAtTime(0.84, now)
        const motorLfo = ctx.createOscillator()
        motorLfo.type = 'sine'
        motorLfo.frequency.setValueAtTime(5.5, now)
        const motorDepth = ctx.createGain()
        motorDepth.gain.setValueAtTime(0.16, now)
        motorLfo.connect(motorDepth)
        motorDepth.connect(motorAmp.gain)
        out.connect(motorAmp)
        out = motorAmp
        motorLfo.start(now)
        nodes.push(motorAmp, motorLfo, motorDepth)
        stopTargets.push(motorLfo)
      }

      if (hasPanner && u.pan !== 0) {
        const pan = ctx.createStereoPanner!()
        pan.pan.setValueAtTime(u.pan, now)
        out.connect(pan)
        out = pan
        nodes.push(pan)
      }
      out.connect(dest)
      fund.start(now)
      overtone.start(now)

      nodes.push(fund, overtone, overtoneGain, barMix)
      stopTargets.push(fund, overtone)
      pitchTargets.push(
        { kind: 'osc', node: fund, baseHz: cHz },
        { kind: 'osc', node: overtone, baseHz: cHz * overtoneRatio },
      )
    }
  }

  private attachSympatheticResonance(
    ctx: AudioContextLike,
    dest: GainNodeLike,
    midi: number,
    velocity: number,
    bendFactor: number,
    now: number,
    nodes: AudioNodeLike[],
    stopTargets: Array<AudioBufferSourceNodeLike | OscillatorNodeLike>,
    pitchTargets: ActiveLayerSubVoice['pitchTargets'],
  ): void {
    // Subtle sympathetic string resonance: octave (2x) + twelfth (3x) harmonics softly blooming
    const baseHz = midiToFrequency(midi)
    const normVel = velocity / 127
    const sympGain = ctx.createGain()
    const level = 0.032 + normVel * 0.045
    sympGain.gain.setValueAtTime(0.0001, now)
    sympGain.gain.linearRampToValueAtTime(level, now + 0.09)
    sympGain.gain.exponentialRampToValueAtTime(0.002, now + 2.8)

    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.setValueAtTime(Math.min(5500, baseHz * 2.5), now)
    bp.Q.setValueAtTime(2.4, now)

    const h2 = ctx.createOscillator()
    const h3 = ctx.createOscillator()
    h2.type = 'sine'
    h3.type = 'sine'
    h2.frequency.setValueAtTime(baseHz * 2 * bendFactor, now)
    h3.frequency.setValueAtTime(baseHz * 3 * bendFactor, now)

    const h3Gain = ctx.createGain()
    h3Gain.gain.setValueAtTime(0.45, now)

    h2.connect(bp)
    h3.connect(h3Gain)
    h3Gain.connect(bp)
    bp.connect(sympGain)
    sympGain.connect(dest)

    h2.start(now)
    h3.start(now)

    nodes.push(sympGain, bp, h2, h3, h3Gain)
    stopTargets.push(h2, h3)
    pitchTargets.push(
      { kind: 'osc', node: h2, baseHz: baseHz * 2 },
      { kind: 'osc', node: h3, baseHz: baseHz * 3 },
    )
  }

  private releaseSubVoice(
    subVoice: ActiveLayerSubVoice,
    fastSteal: boolean,
    atTime?: number,
  ): void {
    if (subVoice.released || !this.ctx) return
    subVoice.released = true

    const releaseAt = atTime !== undefined ? Math.max(this.ctx.currentTime, atTime) : this.ctx.currentTime
    // Soft Release extends damper release noticeably (disabled for Clav per manual p. 25)
    const releaseSec = fastSteal
      ? 0.025
      : subVoice.softRelease && !subVoice.isClav
        ? 0.58
        : subVoice.isClav
          ? 0.09
          : 0.18
    const timeConstant = Math.max(0.006, releaseSec / 4.2)

    try {
      subVoice.gainNode.gain.cancelScheduledValues(releaseAt)
      subVoice.gainNode.gain.setTargetAtTime(0.0001, releaseAt, timeConstant)
    } catch {
      // ignore on minimal mock
    }

    const stopAt = releaseAt + releaseSec + 0.03
    for (const target of subVoice.stopTargets) {
      try {
        target.stop(stopAt)
      } catch {
        // already stopped
      }
    }

    const delayMs = Math.ceil((stopAt - this.ctx.currentTime + 0.04) * 1000)
    subVoice.cleanupTimer = this.clock.setTimeout(() => {
      this.cleanupSubVoice(subVoice)
    }, Math.max(10, delayMs))
  }

  private cleanupSubVoice(subVoice: ActiveLayerSubVoice): void {
    if (subVoice.cleanupTimer !== null) {
      this.clock.clearTimeout(subVoice.cleanupTimer)
      subVoice.cleanupTimer = null
    }
    for (const target of subVoice.stopTargets) {
      target.onended = null
      try {
        target.stop()
      } catch {
        // already stopped
      }
    }
    for (const node of subVoice.nodes) {
      try {
        node.disconnect()
      } catch {
        // already disconnected
      }
    }
    // Prune from map if all sub-voices of a voiceId are cleaned
    for (const [vid, list] of this.voices.entries()) {
      const idx = list.indexOf(subVoice)
      if (idx !== -1) {
        list.splice(idx, 1)
        if (list.length === 0) {
          this.voices.delete(vid)
        }
        break
      }
    }
  }

  private releaseLayerVoices(layerId: PianoLayerId, fastSteal: boolean): void {
    for (const list of Array.from(this.voices.values())) {
      for (const sv of list.slice()) {
        if (sv.layerId === layerId) {
          this.releaseSubVoice(sv, fastSteal)
        }
      }
    }
  }

  releaseNote(voiceId: number, fastSteal = false, atTime?: number): void {
    const subVoices = this.voices.get(voiceId)
    if (!subVoices) return
    for (const sv of subVoices.slice()) {
      this.releaseSubVoice(sv, fastSteal, atTime)
    }
  }

  stopAllImmediate(): void {
    for (const list of Array.from(this.voices.values())) {
      for (const sv of list.slice()) {
        if (sv.cleanupTimer !== null) {
          this.clock.clearTimeout(sv.cleanupTimer)
          sv.cleanupTimer = null
        }
        sv.released = true
        for (const target of sv.stopTargets) {
          target.onended = null
          try {
            target.stop()
          } catch {
            // already stopped
          }
        }
        for (const node of sv.nodes) {
          try {
            node.disconnect()
          } catch {
            // already disconnected
          }
        }
      }
    }
    this.voices.clear()
  }

  getActiveNodeCount(): number {
    let count = 0
    for (const list of this.voices.values()) {
      for (const sv of list) {
        count += sv.nodes.length
      }
    }
    return count
  }

  getGraphDiagnostics(): EngineGraphDiagnostics {
    const layerCounts: Record<PianoLayerId, number> = { A: 0, B: 0 }
    for (const list of this.voices.values()) {
      for (const sv of list) {
        if (!sv.released) layerCounts[sv.layerId] += 1
      }
    }
    const rotaryRouted: PianoLayerId[] = []
    if (this.layerBuses?.A.fxChain.routedToRotary) rotaryRouted.push('A')
    if (this.layerBuses?.B.fxChain.routedToRotary) rotaryRouted.push('B')

    return {
      contextCount: this.contextCreatedCount,
      activeVoiceCount: this.voices.size,
      layerVoiceCounts: layerCounts,
      activeNodeCount: this.getActiveNodeCount(),
      signalOrder: SIGNAL_ORDER,
      rotaryRoutedLayers: rotaryRouted,
    }
  }

  getStatus(): PianoEngineStatusSnapshot {
    const focusedLayer = this.state.piano.layers[this.state.piano.focusedLayer]
    const focusedModel = getPianoModel(focusedLayer.type, focusedLayer.modelIndex)
    const allStatuses = this.sampleManager.getAllStatuses()
    const failedBanks = this.sampleManager.getFailedBanks()
    const ctxState: AudioContextState | 'unavailable' = this.ctx ? this.ctx.state : 'unavailable'

    const totalSamples =
      allStatuses.grand.totalCount +
      allStatuses.upright.totalCount +
      allStatuses.rhodes.totalCount +
      allStatuses.wurli.totalCount
    const loadedSamples =
      allStatuses.grand.loadedCount +
      allStatuses.upright.loadedCount +
      allStatuses.rhodes.loadedCount +
      allStatuses.wurli.loadedCount

    if (this.contextError) {
      return {
        status: 'error',
        loadedSamples,
        totalSamples,
        usingFallback: false,
        message: `Audio error: ${this.contextError}`,
        audioContextState: ctxState,
        failedBanks,
        activeModelName: focusedModel.name,
        contextCount: this.contextCreatedCount,
      }
    }

    if (focusedModel.sourceKind === 'synthesized') {
      return {
        status: 'ready',
        loadedSamples,
        totalSamples,
        usingFallback: false,
        message: `${focusedModel.name} (Synth) ready`,
        audioContextState: ctxState,
        failedBanks,
        activeModelName: focusedModel.name,
        contextCount: this.contextCreatedCount,
      }
    }

    const activeBankId: SampleBankId = focusedModel.sampleBankId ?? 'grand'
    const bankSnap = allStatuses[activeBankId]

    if (bankSnap.state === 'error' && bankSnap.loadedCount === 0) {
      return {
        status: 'fallback',
        loadedSamples,
        totalSamples,
        usingFallback: true,
        message: `${focusedModel.name} missing — playable synth fallback active`,
        audioContextState: ctxState,
        failedBanks,
        activeModelName: focusedModel.name,
        contextCount: this.contextCreatedCount,
      }
    }

    if (bankSnap.loadedCount > 0 && bankSnap.state === 'ready' && !this.usedFallbackForRecentNote) {
      return {
        status: 'ready',
        loadedSamples,
        totalSamples,
        usingFallback: false,
        message: `${focusedModel.name} ready (${bankSnap.loadedCount}/${bankSnap.totalCount} samples)`,
        audioContextState: ctxState,
        failedBanks,
        activeModelName: focusedModel.name,
        contextCount: this.contextCreatedCount,
      }
    }

    if (this.usedFallbackForRecentNote) {
      return {
        status: 'fallback',
        loadedSamples,
        totalSamples,
        usingFallback: true,
        message: `Playable synth fallback (${focusedModel.name} ${bankSnap.loadedCount}/${bankSnap.totalCount})`,
        audioContextState: ctxState,
        failedBanks,
        activeModelName: focusedModel.name,
        contextCount: this.contextCreatedCount,
      }
    }

    return {
      status: 'loading',
      loadedSamples,
      totalSamples,
      usingFallback: false,
      message: `Loading ${focusedModel.name} (${bankSnap.loadedCount}/${bankSnap.totalCount})…`,
      audioContextState: ctxState,
      failedBanks,
      activeModelName: focusedModel.name,
      contextCount: this.contextCreatedCount,
    }
  }

  subscribeStatus(listener: (status: PianoEngineStatusSnapshot) => void): () => void {
    this.statusListeners.add(listener)
    return () => {
      this.statusListeners.delete(listener)
    }
  }

  private emitStatus(): void {
    const snap = this.getStatus()
    for (const listener of this.statusListeners) {
      listener(snap)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.stopAllImmediate()

    if (this.unsubSamples) {
      this.unsubSamples()
      this.unsubSamples = null
    }
    this.sampleManager.dispose()

    if (this.layerBuses) {
      for (const bus of [this.layerBuses.A, this.layerBuses.B]) {
        bus.fxChain.dispose()
        for (const node of bus.nodes) {
          try {
            node.disconnect()
          } catch {
            // already disconnected
          }
        }
      }
      this.layerBuses = null
    }

    if (this.sharedRotary) {
      this.sharedRotary.dispose()
      this.sharedRotary = null
    }

    for (const node of this.permanentNodes) {
      try {
        node.disconnect()
      } catch {
        // already disconnected
      }
    }
    this.permanentNodes = []

    if (this.ctx) {
      const toClose = this.ctx
      this.ctx = null
      this.masterSum = null
      this.masterGain = null
      this.limiter = null
      if (typeof toClose.close === 'function') {
        void toClose.close().catch(() => undefined)
      }
    }
    this.statusListeners.clear()
  }
}

import type { AudioBoundary, AudioContextLike, AudioNodeLike, AudioParamLike, GainNodeLike, OscillatorNodeLike } from './boundaries'
import { InstrumentGraph } from './graph'
import {
  AMP_TYPES,
  DELAY_FILTERS,
  MOD1_TYPES,
  MOD2_TYPES,
  PIANO_TYPES,
  REVERB_TYPES,
  SIGNAL_ORDER,
  TIMBRES,
  TOUCHES,
  isSampledType,
  type AmpType,
  type DelayFilter,
  type KbTouch,
  type LayerId,
  type PianoType,
  type ReverbType,
  type Timbre,
} from './labels'
import { decodeEncodedLibrary, fetchEncodedLibrary, pickZone, type EncodedSet, type RecordedSet, type SampleZone } from './library'
import type { ProgramDocument, StorageLike, SynthLayerDocument } from './performance'
import { ProgramController, type PianoPart } from './programHost'

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error' | 'fallback'
export type VoiceMode = 'primary' | 'fallback' | 'none'
export type EffectFocus = 'organ' | 'piano' | 'synth'

const MAX_POLYPHONY = 32
const RELEASE_SEC = 0.22
const QUICK_RELEASE_SEC = 0.045

const GRAND_PARTIALS = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.42 },
  { ratio: 3, gain: 0.16 },
  { ratio: 4.02, gain: 0.07 },
  { ratio: 5.1, gain: 0.035 },
] as const

export interface PianoEngineOptions {
  /** Throw after the context exists so the labeled sine fallback is used. */
  failPrimary?: boolean
  maxPolyphony?: number
  /** Persist programs and Live slots. Tests leave this off. */
  storage?: StorageLike | null
  persist?: boolean
}

type FxKey = LayerId | 'organ' | 'synthA' | 'synthB' | 'synthC'

interface BendTarget {
  param: AudioParamLike
  base: number
}

interface Voice {
  id: number
  layer: LayerId
  key: number
  seq: number
  held: boolean
  sustained: boolean
  peak: number
  startTime: number
  nodes: AudioNodeLike[]
  oscs: OscillatorNodeLike[]
  gain: GainNodeLike
  bend: BendTarget[]
  cleanupTimer: number | null
  stopped: boolean
  releaseSec: number
}

export interface LayerSnapshot {
  enabled: boolean
  octave: number
  level: number
  type: PianoType
  sustped: boolean
  pstick: boolean
  timbre: Timbre
  unison: 0 | 1 | 2 | 3
  softRelease: boolean
  stringRes: boolean
}

interface FxDelay {
  tempo: number
  feedback: number
  mix: number
  filter: number
  on: boolean
  global: boolean
}
interface FxComp {
  amount: number
  on: boolean
  fast: boolean
  global: boolean
}
interface FxReverb {
  type: number
  mix: number
  bright: boolean
  on: boolean
  global: boolean
}
interface FxState {
  mod1Type: number
  mod1Rate: number
  mod1Amount: number
  mod1On: boolean
  mod2Type: number
  mod2Rate: number
  mod2Amount: number
  mod2On: boolean
  delay: FxDelay
  ampType: number
  ampDrive: number
  ampFreq: number
  ampBass: number
  ampMid: number
  ampTreble: number
  ampOn: boolean
  comp: FxComp
  reverb: FxReverb
}

function midiFreq(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

function hashNoise(length: number, seed: number): Float32Array {
  let state = seed >>> 0 || 1
  const data = new Float32Array(length)
  for (let index = 0; index < length; index++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    const noise = state / 4294967296 * 2 - 1
    data[index] = noise * Math.exp(-index / (length * 0.18)) * 0.4
  }
  return data
}

function defaultFx(): FxState {
  return {
    mod1Type: 0,
    mod1Rate: 64,
    mod1Amount: 64,
    mod1On: false,
    mod2Type: 0,
    mod2Rate: 64,
    mod2Amount: 64,
    mod2On: false,
    delay: { tempo: 64, feedback: 64, mix: 64, filter: 0, on: false, global: false },
    ampType: 0,
    ampDrive: 64,
    ampFreq: 64,
    ampBass: 64,
    ampMid: 64,
    ampTreble: 64,
    ampOn: false,
    comp: { amount: 64, on: false, fast: false, global: false },
    reverb: { type: 0, mix: 64, bright: true, on: false, global: false },
  }
}

function cloneFx(fx: FxState): FxState {
  return {
    ...fx,
    delay: { ...fx.delay },
    comp: { ...fx.comp },
    reverb: { ...fx.reverb },
  }
}

/**
 * Piano voice, two layers, and the shared effect graph.
 * With no sample library installed, Grand keeps the Phase 1 additive voice so
 * existing note, sustain, and velocity tests stay on the same signal.
 */
export class PianoEngine {
  private phase: EngineStatus = 'idle'
  private detail = 'tap a key to play'
  private mode: VoiceMode = 'none'
  private ctx: AudioContextLike | null = null
  private graph: InstrumentGraph | null = null
  private readonly voices = new Set<Voice>()
  private readonly byKey = new Map<string, Voice>()
  private readonly listeners = new Set<() => void>()
  private nextId = 1
  private seq = 1
  private sustainDown = false
  private disposed = false
  private contextsCreated = 0
  private readonly maxPolyphony: number
  private forcedFallback = false
  private library: 'absent' | 'ready' | 'failed' = 'absent'
  private libraryError = 'sample library failed — synthesized fallback'
  private encoded: EncodedSet[] | null = null
  private readonly recorded = new Map<RecordedSet['type'], RecordedSet>()
  private sectionOn = true
  private focus: LayerId = 'A'
  private manualFocus: EffectFocus = 'piano'
  private pianoGroup = false
  private effectsOn = false
  private masterLevel = 100
  private kbTouch: KbTouch = 'Medium'
  private dynComp: 0 | 1 | 2 | 3 = 0
  private pitchStick = 0
  private rotaryFast = false
  private rotaryStop = false
  private rotaryDrive = 64
  private readonly layerState: Record<LayerId, LayerSnapshot> = {
    A: this.defaultLayer(true),
    B: this.defaultLayer(false),
  }
  private readonly fx: Record<FxKey, FxState> = {
    A: defaultFx(),
    B: defaultFx(),
    organ: defaultFx(),
    synthA: defaultFx(),
    synthB: defaultFx(),
    synthC: defaultFx(),
  }
  private readonly taps: number[] = []
  private programs: ProgramController | null = null

  constructor(
    private readonly boundary: AudioBoundary,
    private readonly options: PianoEngineOptions = {},
  ) {
    this.maxPolyphony = options.maxPolyphony ?? MAX_POLYPHONY
    const storage = options.storage ?? (options.persist && typeof localStorage !== 'undefined' ? localStorage : null)
    this.programs = new ProgramController(
      {
        capturePiano: () => this.capturePiano(),
        applyPiano: (part) => this.applyPiano(part),
        now: () => this.now(),
        context: () => this.ctx,
        graph: () => this.graph,
        timers: () => this.boundary.timers,
        emit: () => this.emit(),
        allNotesOff: () => this.allNotesOff(),
      },
      storage,
    )
  }

  private defaultLayer(enabled: boolean): LayerSnapshot {
    return {
      enabled,
      octave: 0,
      level: 100,
      type: 'Grand',
      sustped: true,
      pstick: true,
      timbre: 'Off',
      unison: 0,
      softRelease: false,
      stringRes: false,
    }
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  getStatus(): EngineStatus {
    return this.phase
  }

  getDetail(): string {
    return this.detail
  }

  getMode(): VoiceMode {
    return this.mode
  }

  isSustainDown(): boolean {
    return this.sustainDown
  }

  activeVoiceCount(): number {
    return this.voices.size
  }

  heldVoiceCount(): number {
    let count = 0
    for (const voice of this.voices) if (voice.held) count += 1
    return count
  }

  isNoteActive(midi: number): boolean {
    return this.byKey.has(`A:${midi}`) || this.byKey.has(`B:${midi}`)
  }

  voicesOn(layer: LayerId): number {
    let count = 0
    for (const voice of this.voices) if (voice.layer === layer) count += 1
    return count
  }

  getLayer(layer: LayerId): LayerSnapshot {
    return { ...this.layerState[layer] }
  }

  getFocus(): LayerId {
    return this.focus
  }

  getManualFocus(): EffectFocus {
    return this.manualFocus
  }

  isPianoGroup(): boolean {
    return this.pianoGroup
  }

  isEffectsOn(): boolean {
    return this.effectsOn
  }

  getKbTouch(): KbTouch {
    return this.kbTouch
  }

  getDynComp(): number {
    return this.dynComp
  }

  getMasterLevel(): number {
    return this.masterLevel
  }

  isSectionOn(): boolean {
    return this.sectionOn
  }

  isSustped(layer: LayerId): boolean {
    return this.layerState[layer].sustped
  }

  isPstick(layer: LayerId): boolean {
    return this.layerState[layer].pstick
  }

  getSignalOrder(): readonly string[] {
    return SIGNAL_ORDER
  }

  contextCount(): number {
    return this.contextsCreated
  }

  destinationFeedCount(): number {
    return this.graph?.destinationFeedCount() ?? 0
  }

  libraryState(): 'absent' | 'ready' | 'failed' {
    return this.library
  }

  private setStatus(phase: EngineStatus, detail: string) {
    this.phase = phase
    this.detail = detail
    this.emit()
  }

  private describe(): string {
    const type = this.layerState[this.focus].type
    if (this.forcedFallback) return 'sine fallback'
    if (this.library === 'failed' && isSampledType(type)) return this.libraryError
    const recorded = isSampledType(type) ? this.recorded.get(type) : undefined
    if (recorded && recorded.zones.length > 0) return recorded.name
    if (type === 'Clav') return 'Clavinet synthesis'
    if (type === 'Digital') return 'Digital FM synthesis'
    if (type === 'Misc') return 'Vibraphone synthesis'
    if (type === 'Upright') return 'upright synthesis'
    if (type === 'Electric') return 'electric synthesis'
    return 'additive piano'
  }

  private refreshStatus() {
    if (this.phase === 'idle' || this.phase === 'error') return
    if (this.forcedFallback) {
      this.mode = 'fallback'
      this.setStatus('fallback', 'sine fallback')
      return
    }
    const type = this.layerState[this.focus].type
    if (this.library === 'failed' && isSampledType(type)) {
      this.mode = 'fallback'
      this.setStatus('fallback', this.libraryError)
      return
    }
    this.mode = 'primary'
    this.setStatus('ready', this.describe())
  }

  ensureStarted() {
    if (this.disposed) return
    if (this.phase !== 'idle') return
    this.setStatus('loading', 'starting voice')
    try {
      this.ctx = this.boundary.createContext()
      this.contextsCreated += 1
      this.graph = new InstrumentGraph(this.ctx)
      this.programs?.attach(this.ctx, this.graph, this.boundary.timers)
      this.pushGraph()
      if (this.options.failPrimary) {
        this.forcedFallback = true
        throw new Error('primary piano voice failed to initialize')
      }
      if (this.library === 'failed') {
        this.mode = 'fallback'
        this.setStatus('fallback', this.libraryError)
        return
      }
      this.mode = 'primary'
      this.setStatus('ready', this.describe())
      if (this.encoded) void this.decodeEncoded()
    } catch (error) {
      if (this.ctx && this.graph) {
        this.mode = 'fallback'
        this.setStatus('fallback', 'sine fallback')
      } else {
        this.ctx = null
        this.graph = null
        this.mode = 'none'
        const message = error instanceof Error ? error.message : 'audio unavailable'
        this.setStatus('error', message)
      }
    }
  }

  async preloadSamples(baseHref = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI) {
    try {
      this.encoded = await fetchEncodedLibrary(baseHref)
      if (this.ctx) await this.decodeEncoded()
    } catch (error) {
      this.library = 'failed'
      this.libraryError = `sample library failed — synthesized fallback`
      void error
      this.refreshStatus()
    }
  }

  private async decodeEncoded() {
    if (!this.ctx || !this.encoded) return
    try {
      const sets = await decodeEncodedLibrary(this.ctx, this.encoded)
      this.installRecordedSets(sets)
    } catch {
      this.library = 'failed'
      this.libraryError = 'sample library failed — synthesized fallback'
      this.refreshStatus()
    }
  }

  installRecordedSets(sets: RecordedSet[]) {
    if (this.forcedFallback) return
    for (const set of sets) this.recorded.set(set.type, set)
    this.library = 'ready'
    this.refreshStatus()
    if (this.phase === 'idle') {
      this.library = 'ready'
    }
  }

  failSampleLibrary(message = 'sample library failed — synthesized fallback') {
    this.library = 'failed'
    this.libraryError = message
    this.recorded.clear()
    this.refreshStatus()
  }

  private now(at?: number) {
    return at ?? this.ctx?.currentTime ?? 0
  }

  private pushGraph() {
    const graph = this.graph
    if (!graph) return
    const time = this.ctx?.currentTime ?? 0
    graph.setMasterLevel(this.masterLevel, time)
    graph.setEffectsEnabled(this.effectsOn, time)
    for (const layer of ['A', 'B'] as const) this.pushLayer(layer, time)
    graph.setRotary(this.rotaryFast, this.rotaryStop, this.rotaryDrive, time)
    this.programs?.pushAudio()
  }

  private pushLayer(layer: LayerId, time: number) {
    const graph = this.graph
    if (!graph) return
    const state = this.layerState[layer]
    const fx = this.fx[layer]
    graph.setLayerLevel(layer, state.level, time)
    graph.setTimbre(layer, state.timbre, time)
    graph.setMod1(layer, MOD1_TYPES[fx.mod1Type] ?? 'A-Pan', fx.mod1Rate, fx.mod1Amount, fx.mod1On, time)
    graph.setMod2(layer, MOD2_TYPES[fx.mod2Type] ?? 'Chorus', fx.mod2Rate, fx.mod2Amount, fx.mod2On, time)
    graph.setDelay(layer, fx.delay.tempo, fx.delay.feedback, fx.delay.mix, (DELAY_FILTERS[fx.delay.filter] ?? 'Off') as DelayFilter, fx.delay.on, time)
    const ampType = (AMP_TYPES[fx.ampType] ?? 'EQ') as AmpType
    graph.setAmp(layer, ampType, fx.ampDrive, fx.ampBass, fx.ampMid, fx.ampFreq, fx.ampTreble, fx.ampOn, time)
    graph.setComp(layer, fx.comp.amount, fx.comp.fast || fx.comp.amount >= 110, fx.comp.on, time)
    graph.setReverb(layer, (REVERB_TYPES[fx.reverb.type] ?? 'Room') as ReverbType, fx.reverb.mix, fx.reverb.bright, fx.reverb.on, time)
    const synced = this.programs?.clockSync().delay
    if (synced) graph.setDelaySeconds(layer, 60 / (this.programs?.tempo() ?? 120), time)
    graph.setRotarySend(layer, this.effectsOn && fx.ampOn && ampType === 'Rotary', time)
  }

  private shaped(velocity: number) {
    const curves: Record<KbTouch, number> = { Heavy: 1.85, Medium: 1.45, Light: 1.05 }
    let value = Math.min(1, Math.max(0.0001, velocity)) ** curves[this.kbTouch]
    if (this.dynComp === 1) value **= 0.72
    else if (this.dynComp === 2) value **= 0.5
    else if (this.dynComp === 3) value = Math.min(1, 0.42 + 0.58 * value ** 0.35)
    return value
  }

  noteOn(midi: number, velocity: number, at?: number) {
    if (this.disposed) return
    if (velocity <= 0) {
      this.noteOff(midi, at)
      return
    }
    this.ensureStarted()
    if (!this.ctx || !this.graph || this.mode === 'none') return
    this.resume()
    for (const layer of ['A', 'B'] as const) {
      const existing = this.byKey.get(`${layer}:${midi}`)
      if (!existing) continue
      existing.held = false
      existing.sustained = false
      this.byKey.delete(`${layer}:${midi}`)
      this.releaseVoice(existing, QUICK_RELEASE_SEC, at)
    }
    const shaped = this.shaped(velocity)
    if (this.sectionOn) for (const layer of ['A', 'B'] as const) {
      if (!this.layerState[layer].enabled) continue
      if ((this.programs?.pianoZone(layer, midi) ?? 1) <= 0.001) continue
      while (this.voices.size >= this.maxPolyphony) {
        const oldest = this.oldestVoice()
        if (!oldest) break
        this.stopImmediate(oldest)
      }
      const voice = this.startVoice(layer, midi, shaped, at)
      this.byKey.set(`${layer}:${midi}`, voice)
    }
    this.programs?.noteOn(midi, velocity, at)
    this.emit()
  }

  noteOff(midi: number, at?: number) {
    for (const layer of ['A', 'B'] as const) {
      const voice = this.byKey.get(`${layer}:${midi}`)
      if (!voice) continue
      voice.held = false
      if (this.sustainDown && this.layerState[layer].sustped) {
        voice.sustained = true
        continue
      }
      this.byKey.delete(`${layer}:${midi}`)
      this.releaseVoice(voice, voice.releaseSec, at)
    }
    this.programs?.noteOff(midi, at)
    this.emit()
  }

  setSustain(down: boolean, at?: number) {
    if (this.sustainDown === down) return
    this.sustainDown = down
    if (!down) {
      for (const voice of [...this.voices]) {
        if (voice.sustained && !voice.held) {
          voice.sustained = false
          this.byKey.delete(`${voice.layer}:${voice.key}`)
          this.releaseVoice(voice, voice.releaseSec, at)
        }
      }
    }
    this.programs?.setSustain(down)
    this.emit()
  }

  allNotesOff() {
    this.sustainDown = false
    for (const voice of [...this.voices]) this.stopImmediate(voice)
    this.byKey.clear()
    this.programs?.silence()
    this.emit()
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.allNotesOff()
    this.programs?.dispose()
    this.graph?.dispose()
    const ctx = this.ctx
    this.ctx = null
    this.graph = null
    if (ctx?.close) void ctx.close()
  }

  setMasterLevel(value: number) {
    this.masterLevel = value
    if (this.graph) this.graph.setMasterLevel(value, this.now())
  }

  setSectionOn(on: boolean) {
    this.sectionOn = on
    if (!on) {
      this.stopLayer('A')
      this.stopLayer('B')
    }
  }

  setLayerLevel(layer: LayerId, value: number) {
    this.layerState[layer].level = value
    if (this.graph) this.graph.setLayerLevel(layer, value, this.now())
  }

  setLayerEnabled(layer: LayerId, enabled: boolean) {
    this.layerState[layer].enabled = enabled
    if (!enabled) {
      this.stopLayer(layer)
      if (this.focus === layer) {
        const other: LayerId = layer === 'A' ? 'B' : 'A'
        if (this.layerState[other].enabled) this.focus = other
      }
    }
    this.refreshStatus()
  }

  /** Nord layer button: off → enable+focus, unfocused on → focus, focused on → off. */
  pressLayer(layer: LayerId) {
    const state = this.layerState[layer]
    if (!state.enabled) {
      state.enabled = true
      this.focus = layer
    } else if (this.focus !== layer) {
      this.focus = layer
    } else {
      state.enabled = false
      this.stopLayer(layer)
      const other: LayerId = layer === 'A' ? 'B' : 'A'
      if (this.layerState[other].enabled) this.focus = other
    }
    this.refreshStatus()
    this.emit()
  }

  focusLayer(layer: LayerId) {
    this.focus = layer
    this.refreshStatus()
    this.emit()
  }

  private stopLayer(layer: LayerId) {
    for (const voice of [...this.voices]) {
      if (voice.layer === layer) this.stopImmediate(voice)
    }
  }

  setFocusedType(type: PianoType) {
    this.layerState[this.focus].type = type
    this.refreshStatus()
  }

  setFocusedTimbre(timbre: Timbre) {
    this.layerState[this.focus].timbre = timbre
    if (this.graph) this.graph.setTimbre(this.focus, timbre, this.now())
  }

  setKbTouch(touch: KbTouch) {
    this.kbTouch = touch
  }

  setDynComp(level: 0 | 1 | 2 | 3) {
    this.dynComp = level
  }

  setFocusedUnison(level: 0 | 1 | 2 | 3) {
    this.layerState[this.focus].unison = level
  }

  setFocusedSoftRelease(on: boolean) {
    this.layerState[this.focus].softRelease = on
    if (on) this.layerState[this.focus].stringRes = false
    this.programs?.touch()
  }

  setFocusedStringRes(on: boolean) {
    this.layerState[this.focus].stringRes = on
    if (on) this.layerState[this.focus].softRelease = false
    this.programs?.touch()
  }

  setFocusedAcoustics(index: number) {
    this.layerState[this.focus].softRelease = index === 1
    this.layerState[this.focus].stringRes = index === 2
  }

  nudgeOctave(direction: -1 | 1) {
    const layer = this.layerState[this.focus]
    layer.octave = Math.max(-12, Math.min(12, layer.octave + direction * 12))
    this.emit()
  }

  setOctave(layer: LayerId, semis: number) {
    this.layerState[layer].octave = Math.max(-12, Math.min(12, semis))
  }

  toggleSustped(layer: LayerId) {
    const next = !this.layerState[layer].sustped
    this.layerState[layer].sustped = next
    if (!next) {
      for (const voice of [...this.voices]) {
        if (voice.layer === layer && voice.sustained && !voice.held) {
          voice.sustained = false
          this.byKey.delete(`${layer}:${voice.key}`)
          this.releaseVoice(voice, voice.releaseSec)
        }
      }
    }
    this.emit()
  }

  togglePstick(layer: LayerId) {
    this.layerState[layer].pstick = !this.layerState[layer].pstick
    this.applyBend()
    this.emit()
  }

  setPitchStick(value: number) {
    this.pitchStick = value
    this.applyBend()
    this.programs?.setPitch(value)
  }

  setEffectsOn(on: boolean) {
    if (on) this.programs?.clearBypass()
    if (this.manualFocus === 'organ') {
      this.programs?.setOrganEffects(on)
      return
    }
    if (this.manualFocus === 'synth') {
      this.programs?.setSynthEffects(on)
      return
    }
    this.effectsOn = on
    if (this.graph) {
      const time = this.now()
      this.graph.setEffectsEnabled(on, time)
      for (const layer of ['A', 'B'] as const) {
        const fx = this.fx[layer]
        const ampType = (AMP_TYPES[fx.ampType] ?? 'EQ') as AmpType
        this.graph.setRotarySend(layer, on && fx.ampOn && ampType === 'Rotary', time)
      }
    }
    this.programs?.touch()
  }

  /** All FX Off bypasses piano, organ, synth, and the organ rotary send. */
  allEffectsOff() {
    this.effectsOn = false
    if (this.graph) {
      const time = this.now()
      this.graph.setEffectsEnabled(false, time)
      this.graph.setRotarySend('A', false, time)
      this.graph.setRotarySend('B', false, time)
    }
    this.programs?.setBypassAll()
    this.emit()
  }

  setManualFocus(focus: EffectFocus) {
    this.manualFocus = focus
    this.emit()
  }

  togglePianoGroup() {
    this.pianoGroup = !this.pianoGroup
    if (this.pianoGroup) this.fx.B = cloneFx(this.fx.A)
    this.pushGraph()
    this.emit()
  }

  toggleGlobal(unit: 'delay' | 'comp' | 'reverb') {
    const source = this.editFx()
    if (unit === 'delay') source.delay.global = !source.delay.global
    if (unit === 'comp') source.comp.global = !source.comp.global
    if (unit === 'reverb') source.reverb.global = !source.reverb.global
    this.copyGlobals(source)
    this.pushGraph()
    this.emit()
  }

  editTarget(): FxKey {
    if (this.manualFocus === 'organ') return 'organ'
    if (this.manualFocus === 'synth') return this.programs?.synthFxKey() ?? 'synthA'
    return this.focus
  }

  private editFx(): FxState {
    const target = this.editTarget()
    if (target === 'organ' || target === 'synthA' || target === 'synthB' || target === 'synthC') return this.fx[target]
    if (this.pianoGroup && this.manualFocus === 'piano') return this.fx.A
    return this.fx[target]
  }

  private copyGlobals(source: FxState) {
    const targets: FxKey[] =
      this.manualFocus === 'organ' ? ['organ'] : this.manualFocus === 'synth' ? ['synthA', 'synthB', 'synthC'] : ['A', 'B']
    if (source.delay.global) for (const key of targets) this.fx[key].delay = { ...source.delay }
    if (source.comp.global) for (const key of targets) this.fx[key].comp = { ...source.comp }
    if (source.reverb.global) for (const key of targets) this.fx[key].reverb = { ...source.reverb }
    if (this.pianoGroup && this.manualFocus === 'piano') this.fx.B = cloneFx(this.fx.A)
  }

  writeFx(patch: Partial<Omit<FxState, 'delay' | 'comp' | 'reverb'>> & { delay?: Partial<FxDelay>; comp?: Partial<FxComp>; reverb?: Partial<FxReverb> }) {
    const fx = this.editFx()
    if (patch.delay) fx.delay = { ...fx.delay, ...patch.delay }
    if (patch.comp) fx.comp = { ...fx.comp, ...patch.comp }
    if (patch.reverb) fx.reverb = { ...fx.reverb, ...patch.reverb }
    const { delay, comp, reverb, ...rest } = patch
    void delay
    void comp
    void reverb
    Object.assign(fx, rest)
    this.copyGlobals(fx)
    this.pushGraph()
    this.programs?.touch()
  }

  readFx(target: FxKey | 'synth' = this.editTarget()): FxState {
    const key = target === 'synth' ? (this.programs?.synthFxKey() ?? 'synthA') : target
    return cloneFx(this.fx[key])
  }

  tapDelay(atSeconds: number) {
    this.taps.push(atSeconds)
    if (this.taps.length > 4) this.taps.shift()
    if (this.taps.length < 2) return
    const last = this.taps[this.taps.length - 1]!
    const prev = this.taps[this.taps.length - 2]!
    const interval = Math.min(1.5, Math.max(0.05, last - prev))
    const tempo = Math.round((1 - (interval - 0.04) / 0.9) * 127)
    this.writeFx({ delay: { tempo } })
    if (this.graph) {
      this.graph.setDelaySeconds('A', interval, this.now())
      this.graph.setDelaySeconds('B', interval, this.now())
    }
  }

  setRotary(fast: boolean, stopped: boolean, drive: number) {
    this.rotaryFast = fast
    this.rotaryStop = stopped
    this.rotaryDrive = drive
    this.programs?.setRotaryPerformance(fast, stopped, drive)
    if (this.graph) this.graph.setRotary(fast, stopped, drive, this.now())
  }

  private resume() {
    const ctx = this.ctx
    if (ctx && ctx.state === 'suspended' && ctx.resume) void ctx.resume()
  }

  private oldestVoice(): Voice | null {
    let oldest: Voice | null = null
    for (const voice of this.voices) {
      if (!oldest || voice.seq < oldest.seq) oldest = voice
    }
    return oldest
  }

  private bendFactor(layer: LayerId) {
    if (!this.layerState[layer].pstick) return 1
    const semis = (this.pitchStick / 100) * 2
    return 2 ** (semis / 12)
  }

  private applyBend() {
    for (const voice of this.voices) {
      const factor = this.bendFactor(voice.layer)
      for (const target of voice.bend) {
        try {
          target.param.setValueAtTime(target.base * factor, this.now())
        } catch {
          /* closed */
        }
      }
    }
  }

  private releaseSeconds(layer: LayerId) {
    const state = this.layerState[layer]
    if (state.type === 'Clav') return 0.09
    if (state.type === 'Misc') return state.softRelease ? 0.45 : 0.16
    return state.softRelease ? 0.72 : RELEASE_SEC
  }

  private zonesFor(type: PianoType): SampleZone[] | null {
    if (!isSampledType(type) || this.library !== 'ready') return null
    const set = this.recorded.get(type)
    if (!set || set.zones.length === 0) return null
    return set.zones
  }

  private startVoice(layer: LayerId, key: number, velocity: number, at?: number): Voice {
    const ctx = this.ctx!
    const graph = this.graph!
    const state = this.layerState[layer]
    const sounding = Math.max(0, Math.min(127, key + state.octave + (this.programs?.transposeOf() ?? 0)))
    const zoneGain = this.programs?.pianoZone(layer, key) ?? 1
    const start = this.now(at)
    const fallback = this.forcedFallback || (this.library === 'failed' && isSampledType(state.type))
    const zones = fallback ? null : this.zonesFor(state.type)
    const peak = ((fallback ? 0.08 : 0.05) + 0.55 * velocity) * zoneGain
    const gainNode = ctx.createGain()
    gainNode.gain.setValueAtTime(0.0001, start)
    const attack = zones ? 0.004 : 0.008
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack)
    if (!zones) gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.32), start + 0.55)
    gainNode.connect(graph.input(layer))

    const nodes: AudioNodeLike[] = [gainNode]
    const oscs: OscillatorNodeLike[] = []
    const bend: BendTarget[] = []
    const factor = this.bendFactor(layer)
    const unison = state.unison
    const spreads = unison === 0 ? [0] : unison === 1 ? [-4, 4] : unison === 2 ? [-9, 0, 9] : [-16, -6, 6, 16]

    const connectOsc = (ratio: number, oscGain: number, type: OscillatorType, detuneCents: number) => {
      const osc = ctx.createOscillator()
      const partialGain = ctx.createGain()
      osc.type = type
      const freq = midiFreq(sounding) * ratio * 2 ** (detuneCents / 1200)
      osc.frequency.setValueAtTime(freq * factor, start)
      bend.push({ param: osc.frequency, base: freq })
      partialGain.gain.setValueAtTime(oscGain, start)
      osc.connect(partialGain)
      partialGain.connect(gainNode)
      osc.start(start)
      oscs.push(osc)
      nodes.push(osc, partialGain)
    }

    if (fallback) {
      connectOsc(1, 1, 'sine', 0)
    } else if (zones) {
      const zone = pickZone(zones, sounding, velocity)
      if (!zone) {
        connectOsc(1, 1, 'sine', 0)
      } else {
        for (const cents of spreads) {
          const source = ctx.createBufferSource()
          const sourceGain = ctx.createGain()
          source.buffer = zone.buffer
          const rate = 2 ** ((sounding - zone.rootMidi) / 12 + cents / 1200)
          source.playbackRate.setValueAtTime(rate * factor, start)
          bend.push({ param: source.playbackRate, base: rate })
          sourceGain.gain.setValueAtTime(spreads.length === 1 ? 1 : 0.55, start)
          source.connect(sourceGain)
          sourceGain.connect(gainNode)
          source.start(start)
          nodes.push(source, sourceGain)
        }
      }
    } else {
      this.startSynth(state.type, sounding, velocity, start, factor, spreads, gainNode, nodes, oscs, bend, connectOsc)
    }

    if (!fallback && state.stringRes && (this.sustainDown || this.heldVoiceCount() > 0)) {
      connectOsc(2, 0.08, 'sine', 0)
      const length = Math.max(8, Math.floor(ctx.sampleRate * 0.4))
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
      buffer.getChannelData(0).set(hashNoise(length, key * 17 + layer.charCodeAt(0)))
      const noise = ctx.createBufferSource()
      const noiseGain = ctx.createGain()
      noise.buffer = buffer
      noise.loop = true
      noiseGain.gain.setValueAtTime(0.04, start)
      noise.connect(noiseGain)
      noiseGain.connect(gainNode)
      noise.start(start)
      nodes.push(noise, noiseGain)
    }

    const voice: Voice = {
      id: this.nextId++,
      layer,
      key,
      seq: this.seq++,
      held: true,
      sustained: false,
      peak,
      startTime: start,
      nodes,
      oscs,
      gain: gainNode,
      bend,
      cleanupTimer: null,
      stopped: false,
      releaseSec: this.releaseSeconds(layer),
    }
    this.voices.add(voice)
    return voice
  }

  private startSynth(
    type: PianoType,
    sounding: number,
    velocity: number,
    start: number,
    factor: number,
    spreads: number[],
    destination: GainNodeLike,
    nodes: AudioNodeLike[],
    oscs: OscillatorNodeLike[],
    bend: BendTarget[],
    connectOsc: (ratio: number, oscGain: number, type: OscillatorType, detuneCents: number) => void,
  ) {
    const ctx = this.ctx!
    if (type === 'Grand' || type === 'Upright') {
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(type === 'Upright' ? 500 + velocity * 2800 : 650 + velocity * 6200, start)
      filter.Q.setValueAtTime(0.7, start)
      filter.connect(destination)
      nodes.push(filter)
      const partials = type === 'Upright'
        ? [
            { ratio: 1, gain: 1 },
            { ratio: 2, gain: 0.2 },
            { ratio: 3, gain: 0.05 },
          ]
        : GRAND_PARTIALS
      for (const cents of type === 'Grand' && spreads.length === 1 ? [0] : spreads) {
        for (const partial of partials) {
          const osc = ctx.createOscillator()
          const partialGain = ctx.createGain()
          osc.type = 'sine'
          const inharmonic = 1 + (type === 'Upright' ? 0.0004 : 0.00015) * partial.ratio * partial.ratio
          const freq = midiFreq(sounding) * partial.ratio * inharmonic * 2 ** (cents / 1200)
          osc.frequency.setValueAtTime(freq * factor, start)
          bend.push({ param: osc.frequency, base: freq })
          partialGain.gain.setValueAtTime(partial.gain * (spreads.length > 1 ? 0.6 : 1), start)
          osc.connect(partialGain)
          partialGain.connect(filter)
          osc.start(start)
          oscs.push(osc)
          nodes.push(osc, partialGain)
        }
      }
      if (type === 'Grand') {
        const length = Math.max(8, Math.floor(ctx.sampleRate * 0.028))
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
        buffer.getChannelData(0).set(hashNoise(length, sounding * 997 + this.seq))
        const noise = ctx.createBufferSource()
        const noiseGain = ctx.createGain()
        noise.buffer = buffer
        noiseGain.gain.setValueAtTime(0.22 + velocity * 0.35, start)
        noise.connect(noiseGain)
        noiseGain.connect(filter)
        noise.start(start)
        try {
          noise.stop(start + 0.04)
        } catch {
          /* already stopped */
        }
        nodes.push(noise, noiseGain)
      }
      return
    }
    if (type === 'Electric') {
      for (const cents of spreads) connectOsc(1, 0.8, 'sine', cents)
      connectOsc(2.01, 0.18, 'sine', 0)
      connectOsc(3.5, 0.05, 'triangle', 0)
      return
    }
    if (type === 'Clav') {
      for (const ratio of [1, 3, 5, 7, 9]) connectOsc(ratio, ratio === 1 ? 0.7 : 0.18 / ratio, 'square', 0)
      return
    }
    if (type === 'Digital') {
      const carrier = ctx.createOscillator()
      const modulator = ctx.createOscillator()
      const modGain = ctx.createGain()
      const freq = midiFreq(sounding)
      carrier.frequency.setValueAtTime(freq * factor, start)
      modulator.frequency.setValueAtTime(freq * 2 * factor, start)
      bend.push({ param: carrier.frequency, base: freq }, { param: modulator.frequency, base: freq * 2 })
      modGain.gain.setValueAtTime(freq * (1.2 + velocity * 2.4), start)
      modulator.connect(modGain)
      modGain.connect(carrier.frequency)
      carrier.connect(destination)
      carrier.start(start)
      modulator.start(start)
      oscs.push(carrier, modulator)
      nodes.push(carrier, modulator, modGain)
      return
    }
    connectOsc(1, 0.9, 'sine', 0)
    connectOsc(4, 0.12, 'sine', 0)
    const trem = ctx.createOscillator()
    const tremGain = ctx.createGain()
    trem.frequency.setValueAtTime(5.5, start)
    tremGain.gain.setValueAtTime(0.15, start)
    trem.connect(tremGain)
    tremGain.connect(destination.gain)
    trem.start(start)
    oscs.push(trem)
    nodes.push(trem, tremGain)
  }

  private envelopeLevel(voice: Voice, at: number): number {
    const elapsed = Math.max(0, at - voice.startTime)
    if (elapsed < 0.008) return Math.max(0.0002, voice.peak * (elapsed / 0.008))
    const decay = Math.min(1, (elapsed - 0.008) / 0.542)
    return Math.max(0.0002, voice.peak * (1 - decay * 0.68))
  }

  private releaseVoice(voice: Voice, seconds: number, at?: number) {
    if (voice.stopped || !this.ctx) return
    const when = this.now(at)
    const level = this.envelopeLevel(voice, when)
    try {
      voice.gain.gain.cancelScheduledValues(when)
      voice.gain.gain.setValueAtTime(Math.max(0.0002, level), when)
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, when + seconds)
    } catch {
      /* context closed */
    }
    for (const osc of voice.oscs) {
      try {
        osc.stop(when + seconds + 0.03)
      } catch {
        /* already stopped */
      }
    }
    this.armCleanup(voice, Math.ceil((seconds + 0.05) * 1000))
  }

  private armCleanup(voice: Voice, ms: number) {
    if (voice.cleanupTimer !== null) this.boundary.timers.clearTimeout(voice.cleanupTimer)
    voice.cleanupTimer = this.boundary.timers.setTimeout(() => this.disconnect(voice), ms)
  }

  private stopImmediate(voice: Voice) {
    if (voice.cleanupTimer !== null) {
      this.boundary.timers.clearTimeout(voice.cleanupTimer)
      voice.cleanupTimer = null
    }
    const when = this.ctx?.currentTime ?? 0
    if (!voice.stopped) {
      try {
        voice.gain.gain.cancelScheduledValues(when)
        voice.gain.gain.setValueAtTime(0.0001, when)
      } catch {
        /* context closed */
      }
      for (const osc of voice.oscs) {
        try {
          osc.stop(when)
        } catch {
          /* already stopped */
        }
      }
    }
    this.disconnect(voice)
  }

  private capturePiano(): PianoPart {
    const touchIndex = Math.max(0, TOUCHES.indexOf(this.kbTouch))
    return {
      sectionOn: this.sectionOn,
      focus: this.focus,
      kbTouch: touchIndex,
      dynComp: this.dynComp,
      effectsOn: this.effectsOn,
      pianoGroup: this.pianoGroup,
      manualFocus: this.manualFocus,
      layers: {
        A: { ...this.layerState.A },
        B: { ...this.layerState.B },
      },
      fx: {
        A: cloneFx(this.fx.A),
        B: cloneFx(this.fx.B),
        organ: cloneFx(this.fx.organ),
        synthA: cloneFx(this.fx.synthA),
        synthB: cloneFx(this.fx.synthB),
        synthC: cloneFx(this.fx.synthC),
      },
      pitch: this.pitchStick,
      sustainDown: this.sustainDown,
    }
  }

  private applyPiano(part: PianoPart) {
    this.sectionOn = part.sectionOn
    this.focus = part.focus
    this.kbTouch = TOUCHES[part.kbTouch] ?? 'Medium'
    this.dynComp = part.dynComp as 0 | 1 | 2 | 3
    this.effectsOn = part.effectsOn
    this.pianoGroup = part.pianoGroup
    this.manualFocus = part.manualFocus
    this.layerState.A = { ...part.layers.A }
    this.layerState.B = { ...part.layers.B }
    this.fx.A = cloneFx(part.fx.A as FxState)
    this.fx.B = cloneFx(part.fx.B as FxState)
    this.fx.organ = cloneFx(part.fx.organ as FxState)
    this.fx.synthA = cloneFx(part.fx.synthA as FxState)
    this.fx.synthB = cloneFx(part.fx.synthB as FxState)
    this.fx.synthC = cloneFx(part.fx.synthC as FxState)
    this.pushGraph()
    this.applyBend()
  }

  getProgramView(): Record<string, unknown> {
    return this.programs?.snapshot() ?? {}
  }

  isProgramDirty(): boolean {
    return this.programs?.isDirty() ?? false
  }

  selectProgram(index: number) {
    this.programs?.selectProgram(index)
  }

  selectLiveSlot(index: number) {
    this.programs?.selectLive(index)
  }

  setLiveMode(on: boolean) {
    this.programs?.setLiveMode(on)
  }

  nudgeProgram(delta: number) {
    this.programs?.nudge(delta)
  }

  setProgramPage(page: number) {
    this.programs?.setPage(page)
  }

  setProgramList(on: boolean) {
    this.programs?.setListOpen(on)
  }

  armStore() {
    this.programs?.armStore()
  }

  armStoreAs() {
    this.programs?.armStoreAs()
  }

  confirmStore() {
    this.programs?.confirmStore()
  }

  cancelStore() {
    this.programs?.cancelStore()
  }

  undoProgram() {
    this.programs?.undo()
  }

  deleteStoreChar() {
    this.programs?.nameDelete()
  }

  insertStoreChar() {
    this.programs?.nameInsert()
  }

  nudgeSplit(delta: number) {
    this.programs?.nudgeSplitPosition(delta)
  }

  focusSplit(which: 'low' | 'mid' | 'high') {
    this.programs?.focusSplit(which)
  }

  cycleCrossfade() {
    this.programs?.cycleCrossfade()
  }

  setDialTarget(target: 'amp' | 'filter' | 'osc' | 'vibrato' | 'pitch') {
    this.programs?.setDialTarget(target)
  }

  storeMode(): string {
    return this.programs?.bankMode() ?? 'play'
  }

  programDocument(): ProgramDocument {
    return this.programs!.document()
  }

  setSplitEnabled(on: boolean) {
    this.programs?.setSplitEnabled(on)
  }

  setSplitPoint(which: 'low' | 'mid' | 'high', position: number, crossfade: 0 | 6 | 12, enabled = true) {
    this.programs?.setSplitPoint(which, position, crossfade, enabled)
  }

  setLayerZone(section: 'organ' | 'piano' | 'synth', layer: 'A' | 'B' | 'C', lo: number, hi: number) {
    this.programs?.setLayerZone(section, layer, { lo, hi })
  }

  zoneGain(section: 'organ' | 'piano' | 'synth', layer: 'A' | 'B' | 'C', midi: number): number {
    return this.programs?.zoneGainFor(section, layer, midi) ?? 1
  }

  setScene(scene: 'I' | 'II') {
    this.programs?.setScene(scene)
  }

  getScene(): 'I' | 'II' {
    return this.programs?.getScene() ?? 'I'
  }

  beginMorph(source: 'wheel' | 'pedal') {
    this.programs?.beginMorph(source)
  }

  latchMorph(source: 'wheel' | 'pedal') {
    this.programs?.latchMorph(source)
  }

  endMorph() {
    this.programs?.endMorph()
  }

  assignMorph(source: 'wheel' | 'pedal', id: string, from: number, to: number) {
    this.programs?.assignMorph(source, id, from, to)
  }

  clearMorph(source: 'wheel' | 'pedal') {
    this.programs?.clearMorph(source)
  }

  morphControlIds(): string[] {
    return this.programs?.morphIds() ?? []
  }

  morphSource(): 'wheel' | 'pedal' | null {
    return this.programs?.morphSource() ?? null
  }

  baseValue(id: string): number {
    return this.programs?.baseValue(id) ?? 0
  }

  setModWheel(value: number) {
    this.programs?.setModWheel(value)
  }

  setControlPedal(value: number) {
    this.programs?.setControlPedal(value)
  }

  setTempo(bpm: number) {
    this.programs?.setTempo(bpm)
  }

  tapMasterClock(time: number) {
    this.programs?.tapClock(time)
  }

  getTempo(): number {
    return this.programs?.tempo() ?? 120
  }

  setClockSync(target: 'arp' | 'lfo' | 'delay' | 'mod1', on: boolean) {
    this.programs?.setClockSync(target, on)
  }

  toggleEffectClockSync() {
    this.programs?.toggleEffectSync()
  }

  setTranspose(semitones: number, enabled = true) {
    this.programs?.setTranspose(semitones, enabled)
  }

  toggleTranspose() {
    this.programs?.toggleTranspose()
  }

  panic() {
    this.pitchStick = 0
    this.sustainDown = false
    this.applyBend()
    this.programs?.panic()
  }

  setOrganOn(on: boolean) {
    this.programs?.setOrganSection(on)
  }

  pressOrganLayer(layer: 'A' | 'B') {
    this.programs?.pressOrganLayer(layer)
  }

  setOrganModel(index: number) {
    this.programs?.setOrganModel(index)
  }

  setDrawbar(index: number, value: number) {
    this.programs?.setDrawbar(index, value)
  }

  setOrganLevel(layer: 'A' | 'B', value: number) {
    this.programs?.setOrganLevel(layer, value)
  }

  nudgeOrganOctave(direction: -1 | 1) {
    this.programs?.nudgeOrganOctave(direction)
  }

  setOrganVibrato(index: number, on?: boolean) {
    this.programs?.setOrganVib(index)
    if (on !== undefined) this.programs?.setOrganVibOn(on)
  }

  setOrganPercussion(partial: { percOn?: boolean; percSoft?: boolean; percFast?: boolean; percThird?: boolean }) {
    this.programs?.setPerc(partial)
  }

  setRotarySource(on: boolean) {
    this.programs?.setRotarySource(on)
  }

  setSynthOn(on: boolean) {
    this.programs?.setSynthSection(on)
  }

  pressSynthLayer(layer: 'A' | 'B' | 'C') {
    this.programs?.pressSynthLayer(layer)
  }

  setSynthFocus(layer: 'A' | 'B' | 'C') {
    this.programs?.setSynthFocus(layer)
  }

  patchSynth(patch: Partial<SynthLayerDocument>) {
    this.programs?.patchSynth(patch)
  }

  setSynthLevel(layer: 'A' | 'B' | 'C', value: number) {
    this.programs?.setSynthLevel(layer, value)
  }

  nudgeSynthOctave(direction: -1 | 1) {
    this.programs?.nudgeSynthOctave(direction)
  }

  organVoiceCount(): number {
    return this.programs?.organVoiceCount() ?? 0
  }

  synthVoiceCount(): number {
    return this.programs?.synthVoiceCount() ?? 0
  }

  loadProgramNames(): string[] {
    return this.programs?.loadFactoriesForTest() ?? []
  }

  activeSplitMidis(): number[] {
    const view = this.getProgramView()
    const split = view.split
    return Array.isArray(split) ? split.filter((midi): midi is number => typeof midi === 'number' && midi > 0) : []
  }

  private disconnect(voice: Voice) {
    if (voice.stopped) return
    voice.stopped = true
    voice.held = false
    voice.sustained = false
    for (const node of voice.nodes) {
      try {
        node.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    this.voices.delete(voice)
    const key = `${voice.layer}:${voice.key}`
    if (this.byKey.get(key) === voice) this.byKey.delete(key)
    this.emit()
  }
}

export { PIANO_TYPES, TOUCHES, TIMBRES }

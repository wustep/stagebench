import { createLayerGraph, createMaster, rampTo, resolveFx, type LayerGraph } from './effects'
import { startOrganVoice } from './organ-voices'
import { arpPattern, arpStepSeconds, startSynthVoice } from './synth-voices'
import { soundingState } from '../model/morph'
import { zoneGain } from '../model/splits'
import {
  PIANO_TYPES,
  pickZone,
  tryLoadRecordedBanks,
  type PianoType,
  type SampleBanks,
  type SampleZone,
} from './samples'
import { createAudioContext } from './software-context'
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextFactory,
  AudioContextLike,
  AudioStatus,
  GainNodeLike,
  OscillatorNodeLike,
} from './types'
import {
  defaultInstrumentState,
  type InstrumentState,
  type LayerId,
  type OrganLayerId,
  type SynthLayerId,
} from '../model/instrument-state'

export const MAX_VOICES = 32
export const PARTIAL_COUNT = 6
const ATTACK = 0.005
const DECAY = 0.45
const SUSTAIN_RATIO = 0.28
const RELEASE = 0.28
const MAX_NOTE_SEC = 8
const STEAL_FADE = 0.008

export interface PianoEngineOptions {
  createAudioContext?: AudioContextFactory
  context?: AudioContextLike
  maxVoices?: number
  failSamples?: boolean
}

interface Voice {
  id: number
  engine: 'piano' | 'organ' | 'synth'
  layer: string
  note: number
  velocity: number
  startTime: number
  released: boolean
  sustained: boolean
  peak: number
  nodes: { stop: (time: number) => void; disconnect: () => void }[]
  gain: GainNodeLike
}

let nextVoiceId = 1

export class PianoEngine {
  readonly maxVoices: number
  private readonly createContext: AudioContextFactory
  private readonly failSamples: boolean
  private ctx: AudioContextLike | null = null
  private masterGain: GainNodeLike | null = null
  private graphs: Record<LayerId, LayerGraph> | null = null
  private organGraph: LayerGraph | null = null
  private synthGraphs: Record<SynthLayerId, LayerGraph> | null = null
  private voices: Voice[] = []
  private sustainDown = false
  private status: AudioStatus = 'loading'
  private statusDetail = 'Initializing audio'
  private disposed = false
  private heldNotes = new Map<number, number>()
  private state: InstrumentState = defaultInstrumentState()
  private banks: SampleBanks | null = null
  private buffers = new Map<string, AudioBufferLike>()
  private lastTap = -1
  private noiseBuffer: AudioBufferLike | null = null
  private pulse33: AudioBufferLike | null = null
  private pulse10: AudioBufferLike | null = null
  private organKeysHeld = 0
  private lastSynthNote: Record<SynthLayerId, number | null> = { A: null, B: null, C: null }
  private arpHeld: Record<SynthLayerId, Map<number, number>> = {
    A: new Map(),
    B: new Map(),
    C: new Map(),
  }

  constructor(options: PianoEngineOptions = {}) {
    this.createContext = options.createAudioContext ?? createAudioContext
    this.maxVoices = options.maxVoices ?? MAX_VOICES
    this.failSamples = options.failSamples === true
    if (!this.failSamples) this.banks = tryLoadRecordedBanks()
    if (options.context) {
      this.ctx = options.context
      this.setupGraph(options.context)
      this.finishStatus()
    }
  }

  getStatus(): AudioStatus {
    return this.status
  }

  getStatusDetail(): string {
    return this.statusDetail
  }

  getContext(): AudioContextLike | null {
    return this.ctx
  }

  getActiveVoiceCount(): number {
    return this.voices.length
  }

  getLayerVoiceCount(layer: LayerId): number {
    return this.voices.filter((voice) => voice.engine === 'piano' && voice.layer === layer).length
  }

  getOrganVoiceCount(layer?: OrganLayerId): number {
    return this.voices.filter((voice) => voice.engine === 'organ' && (layer == null || voice.layer === layer)).length
  }

  getSynthVoiceCount(layer?: SynthLayerId): number {
    return this.voices.filter((voice) => voice.engine === 'synth' && (layer == null || voice.layer === layer)).length
  }

  getHeldNoteCount(): number {
    return this.heldNotes.size
  }

  isSustainDown(): boolean {
    return this.sustainDown
  }

  getState(): InstrumentState {
    return this.state
  }

  applyState(state: InstrumentState, time?: number): void {
    this.state = state
    if (state.panicFlag) {
      this.panic(time)
      state.panicFlag = false
    }
    const ctx = this.ctx
    const when = time ?? ctx?.currentTime ?? 0
    if (!ctx || !this.graphs || !this.masterGain) return
    const sounded = soundingState(state)
    rampTo(this.masterGain.gain, 0.12 + sounded.masterLevel * 0.95, when)
    const rotarySpeed = sounded.rotaryStop ? 0 : sounded.rotaryFast ? 0.92 : sounded.rotarySpeed
    const common = {
      rotaryOn: sounded.rotaryOn,
      rotarySpeed,
      rotaryDrive: sounded.rotaryDrive,
      fxSectionOn: sounded.fxSectionOn,
      bpm: sounded.clockBpm,
      clockSync: sounded.clockSync,
    }
    this.graphs.A.apply(
      {
        ...common,
        fx: resolveFx(sounded, 'A'),
        level: sounded.layers.A.level * (sounded.layers.A.enable && sounded.pianoOn ? 1 : 0),
        toRotary: sounded.layers.A.fx.ampOn && sounded.layers.A.fx.ampType === 'To Rotary',
      },
      when,
    )
    this.graphs.B.apply(
      {
        ...common,
        fx: resolveFx(sounded, 'B'),
        level: sounded.layers.B.level * (sounded.layers.B.enable && sounded.pianoOn ? 1 : 0),
        toRotary: sounded.layers.B.fx.ampOn && sounded.layers.B.fx.ampType === 'To Rotary',
      },
      when,
    )
    this.organGraph?.apply(
      {
        ...common,
        fx: sounded.organFx,
        level: sounded.organOn ? 1 : 0,
        toRotary: sounded.rotaryOrgan,
      },
      when,
    )
    for (const id of ['A', 'B', 'C'] as SynthLayerId[]) {
      const layer = sounded.synth[id]
      this.synthGraphs?.[id].apply(
        {
          ...common,
          fx: layer.fx,
          level: layer.level * (layer.enable && sounded.synthOn ? 1 : 0),
          toRotary: layer.fx.ampOn && layer.fx.ampType === 'To Rotary',
        },
        when,
      )
    }
  }

  panic(time?: number): void {
    this.allNotesOff(time)
    this.state.modWheel = 0
    this.state.ctrlPedal = 0
    this.state.pitchStick = 0
    this.sustainDown = false
    this.organKeysHeld = 0
    this.arpHeld.A.clear()
    this.arpHeld.B.clear()
    this.arpHeld.C.clear()
  }

  tapTempo(time?: number): number {
    const when = time ?? this.ctx?.currentTime ?? 0
    if (this.lastTap >= 0 && when - this.lastTap > 0.12 && when - this.lastTap < 2.2) {
      const interval = when - this.lastTap
      const bpm = 60 / interval
      const knob = Math.min(1, Math.max(0, (bpm - 40) / 200))
      this.state.layers.A.fx.delayTempo = knob
      this.state.layers.B.fx.delayTempo = knob
      this.applyState(this.state, when)
      this.lastTap = when
      return knob
    }
    this.lastTap = when
    return this.state.layers.A.fx.delayTempo
  }

  async init(): Promise<void> {
    if (this.disposed) return
    if (this.ctx) {
      this.finishStatus()
      await this.ctx.resume()
      return
    }
    this.status = 'loading'
    this.statusDetail = 'Initializing audio'
    try {
      const ctx = this.createContext()
      this.ctx = ctx
      this.setupGraph(ctx)
      await ctx.resume()
      this.finishStatus()
    } catch (error) {
      this.status = 'error'
      this.statusDetail = 'Audio error — labeled fallback is playable (keys still track)'
      console.warn('PianoEngine init failed', error)
    }
  }

  noteOn(note: number, velocity: number, time?: number): void {
    if (this.disposed) return
    const ctx = this.ctx
    const when = time ?? ctx?.currentTime ?? 0
    const vel = clamp(velocity, 0, 1)
    if (vel <= 0) {
      this.noteOff(note, when)
      return
    }

    const existing = this.voices.filter((voice) => voice.note === note && !voice.released)
    for (const voice of existing) this.releaseVoice(voice, when, 0.02)

    this.heldNotes.set(note, vel)
    if (!ctx || !this.graphs) return

    const sounded = soundingState(this.state)
    const transposed = note + sounded.transpose

    for (const layer of ['A', 'B'] as LayerId[]) {
      const layerState = sounded.layers[layer]
      if (!sounded.pianoOn || !layerState.enable) continue
      const g = zoneGain(note, layerState.zone, sounded.split)
      if (g <= 0.001) continue
      this.ensureVoiceCapacity(when)
      this.spawnLayerVoice(layer, transposed, vel * g, when)
    }

    if (sounded.organOn && this.organGraph) {
      const percTrig = this.organKeysHeld === 0
      this.organKeysHeld += 1
      for (const id of ['A', 'B'] as OrganLayerId[]) {
        const layer = sounded.organ[id]
        if (!layer.enable) continue
        const g = zoneGain(note, layer.zone, sounded.split) * layer.level
        if (g <= 0.001) continue
        this.ensureVoiceCapacity(when)
        this.spawnOrganVoice(id, transposed, vel * Math.min(1, g / Math.max(0.05, layer.level)), when, percTrig)
      }
    }

    if (sounded.synthOn && this.synthGraphs) {
      for (const id of ['A', 'B', 'C'] as SynthLayerId[]) {
        const layer = sounded.synth[id]
        if (!layer.enable) continue
        const g = zoneGain(note, layer.zone, sounded.split)
        if (g <= 0.001) continue
        if (layer.arpOn && layer.arpRun) {
          this.arpHeld[id].set(note, vel * g)
          this.scheduleArp(id, when)
        } else {
          this.ensureVoiceCapacity(when)
          this.spawnSynthVoice(id, transposed, vel * g, when)
        }
      }
    }
  }

  noteOff(note: number, time?: number): void {
    const ctx = this.ctx
    const when = time ?? ctx?.currentTime ?? 0
    this.heldNotes.delete(note)
    if (this.organKeysHeld > 0) this.organKeysHeld -= 1
    for (const id of ['A', 'B', 'C'] as SynthLayerId[]) {
      const layer = this.state.synth[id]
      if (layer.arpHold) continue
      this.arpHeld[id].delete(note)
    }
    for (const voice of this.voices) {
      if (voice.note !== note || voice.released) continue
      const sustped = this.sustpedFor(voice)
      if (this.sustainDown && sustped) {
        voice.sustained = true
        continue
      }
      this.releaseVoice(voice, when, this.releaseTimeFor(voice))
    }
  }

  setSustain(down: boolean, time?: number): void {
    const ctx = this.ctx
    const when = time ?? ctx?.currentTime ?? 0
    this.sustainDown = down
    if (down) return
    for (const voice of this.voices) {
      if (voice.sustained && !this.heldNotes.has(voice.note)) {
        this.releaseVoice(voice, when, this.releaseTimeFor(voice))
      } else {
        voice.sustained = false
      }
    }
  }

  allNotesOff(time?: number): void {
    const ctx = this.ctx
    const when = time ?? ctx?.currentTime ?? 0
    this.heldNotes.clear()
    this.sustainDown = false
    this.organKeysHeld = 0
    this.arpHeld.A.clear()
    this.arpHeld.B.clear()
    this.arpHeld.C.clear()
    const current = this.voices
    this.voices = []
    for (const voice of current) this.killVoice(voice, when)
  }

  dispose(): void {
    this.disposed = true
    this.allNotesOff()
    this.graphs?.A.dispose()
    this.graphs?.B.dispose()
    this.organGraph?.dispose()
    this.synthGraphs?.A.dispose()
    this.synthGraphs?.B.dispose()
    this.synthGraphs?.C.dispose()
    const ctx = this.ctx
    this.ctx = null
    this.masterGain = null
    this.graphs = null
    this.organGraph = null
    this.synthGraphs = null
    void ctx?.close()
  }

  private finishStatus(): void {
    const sampledOk =
      !this.failSamples &&
      !!this.banks &&
      this.banks.grand.length > 0 &&
      this.banks.upright.length > 0 &&
      this.banks.electric.length > 0
    if (sampledOk) {
      this.status = 'ready'
      this.statusDetail = 'Audio ready — Grand/Upright/Electric recorded libraries loaded'
      return
    }
    this.status = 'fallback'
    this.statusDetail = 'Sample load failed — labeled fallback piano is playable'
  }

  private setupGraph(ctx: AudioContextLike): void {
    const master = createMaster(ctx)
    const graphA = createLayerGraph(ctx)
    const graphB = createLayerGraph(ctx)
    const organ = createLayerGraph(ctx)
    const synthA = createLayerGraph(ctx)
    const synthB = createLayerGraph(ctx)
    const synthC = createLayerGraph(ctx)
    graphA.level.connect(master.sum)
    graphB.level.connect(master.sum)
    organ.level.connect(master.sum)
    synthA.level.connect(master.sum)
    synthB.level.connect(master.sum)
    synthC.level.connect(master.sum)
    this.graphs = { A: graphA, B: graphB }
    this.organGraph = organ
    this.synthGraphs = { A: synthA, B: synthB, C: synthC }
    this.masterGain = master.master
    this.noiseBuffer = makeNoise(ctx, 0.2)
    this.pulse33 = makePulse(ctx, 0.33)
    this.pulse10 = makePulse(ctx, 0.1)
    this.prepareBuffers(ctx)
    this.applyState(this.state, ctx.currentTime)
  }

  private prepareBuffers(ctx: AudioContextLike): void {
    if (!this.banks) return
    for (const kind of ['grand', 'upright', 'electric'] as const) {
      for (const zone of this.banks[kind]) {
        const key = `${kind}:${zone.midi}:${zone.vel}`
        const buffer = ctx.createBuffer(1, zone.pcm.length, zone.rate)
        buffer.getChannelData(0).set(zone.pcm)
        this.buffers.set(key, buffer)
      }
    }
  }

  private bufferFor(zone: SampleZone, kind: string): AudioBufferLike | null {
    return this.buffers.get(`${kind}:${zone.midi}:${zone.vel}`) ?? null
  }

  private releaseTimeFor(voice: Voice): number {
    if (voice.engine === 'organ') return 0.08
    if (voice.engine === 'synth') {
      const st = this.state.synth[voice.layer as SynthLayerId]
      return 0.04 + (st?.ampEnvR ?? 0.3) * 1.4
    }
    return this.releaseTime(voice.layer as LayerId)
  }

  private sustpedFor(voice: Voice): boolean {
    if (voice.engine === 'organ') return this.state.organ[voice.layer as OrganLayerId]?.sustped ?? false
    if (voice.engine === 'synth') return this.state.synth[voice.layer as SynthLayerId]?.sustped ?? false
    return this.state.layers[voice.layer as LayerId]?.sustped ?? false
  }

  private releaseTime(layer: LayerId): number {
    const st = this.state.layers[layer]
    if (st.type === 'clav') return 0.12
    return st.softRelease ? RELEASE * 1.85 : RELEASE
  }

  private shapedVelocity(layer: LayerId, vel: number): number {
    const st = this.state.layers[layer]
    let v = vel
    if (st.kbTouch === 'Heavy') v = vel ** 1.7
    else if (st.kbTouch === 'Light') v = vel ** 0.48
    const comp = st.dynComp === 1 ? 0.28 : st.dynComp === 2 ? 0.5 : st.dynComp === 3 ? 0.72 : 0
    return clamp(v + (1 - v) * comp, 0, 1)
  }

  private soundingMidi(layer: LayerId, note: number): number {
    const st = this.state.layers[layer]
    const bend = st.pstick ? this.state.pitchStick * 2 : 0
    return note + st.octave + bend
  }

  private spawnLayerVoice(layer: LayerId, note: number, velocity: number, when: number): void {
    const ctx = this.ctx
    const graph = this.graphs?.[layer]
    if (!ctx || !graph) return
    const st = this.state.layers[layer]
    const vel = this.shapedVelocity(layer, velocity)
    const midi = this.soundingMidi(layer, note)
    const peak = 0.045 + vel ** 1.45 * 0.22
    const voiceGain = ctx.createGain()
    voiceGain.gain.setValueAtTime(0.0001, when)
    voiceGain.gain.linearRampToValueAtTime(peak, when + ATTACK)
    voiceGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * SUSTAIN_RATIO), when + ATTACK + DECAY)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(this.timbreCutoff(st.type, st.timbre, vel), when)
    filter.Q.setValueAtTime(0.7, when)
    filter.connect(voiceGain)
    voiceGain.connect(graph.input)

    const nodes: Voice['nodes'] = [oscAdapter(filter), oscAdapter(voiceGain)]
    const detunes = unisonDetunes(st.unison)
    const sampled = this.trySampled(st.type, midi, vel, when, filter, nodes, detunes)
    if (!sampled) this.synthesize(st.type, midi, vel, when, ctx, filter, nodes, detunes)
    if (st.stringRes && (this.sustainDown || this.heldNotes.size > 0)) {
      this.addStringRes(ctx, midi, vel, when, filter, nodes)
    }

    this.voices.push({
      id: nextVoiceId++,
      engine: 'piano',
      layer,
      note,
      velocity: vel,
      startTime: when,
      released: false,
      sustained: false,
      peak,
      nodes,
      gain: voiceGain,
    })
  }

  private trySampled(
    type: PianoType,
    midi: number,
    vel: number,
    when: number,
    dest: GainNodeLike | ReturnType<AudioContextLike['createBiquadFilter']>,
    nodes: Voice['nodes'],
    detunes: number[],
  ): boolean {
    if (type !== 'grand' && type !== 'upright' && type !== 'electric') return false
    if (!this.banks || this.status === 'fallback') return false
    const ctx = this.ctx
    if (!ctx) return false
    const zones = this.banks[type]
    if (!zones.length) return false
    for (const cents of detunes) {
      const pitched = midi + cents / 100
      const { zone, playbackRate } = pickZone(zones, Math.round(pitched), vel)
      const buffer = this.bufferFor(zone, type)
      if (!buffer) continue
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.loop = true
      src.loopStart = 0.14
      src.loopEnd = Math.max(0.42, buffer.length / buffer.sampleRate - 0.12)
      src.playbackRate.setValueAtTime(playbackRate * 2 ** (cents / 1200), when)
      const g = ctx.createGain()
      g.gain.setValueAtTime(cents === 0 ? 1 : 0.45, when)
      src.connect(g)
      g.connect(dest)
      src.start(when)
      src.stop(when + MAX_NOTE_SEC)
      nodes.push(oscAdapter(src), oscAdapter(g))
    }
    return nodes.length > 2
  }

  private synthesize(
    type: PianoType,
    midi: number,
    vel: number,
    when: number,
    ctx: AudioContextLike,
    dest: ReturnType<AudioContextLike['createBiquadFilter']>,
    nodes: Voice['nodes'],
    detunes: number[],
  ): void {
    const freq = midiToFreq(midi)
    const brightness = vel * 0.55 + 0.45
    for (const cents of detunes) {
      const f0 = freq * 2 ** (cents / 1200)
      if (type === 'clav') {
        const osc = ctx.createOscillator()
        osc.type = 'square'
        osc.frequency.setValueAtTime(f0, when)
        const g = ctx.createGain()
        g.gain.setValueAtTime((cents === 0 ? 0.55 : 0.22) * brightness, when)
        osc.connect(g)
        g.connect(dest)
        osc.start(when)
        osc.stop(when + MAX_NOTE_SEC)
        nodes.push(oscAdapter(osc), oscAdapter(g))
      } else if (type === 'digital') {
        for (const partial of [1, 2, 3, 4]) {
          const osc = ctx.createOscillator()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(f0 * partial * (1 + 0.0002 * partial), when)
          const g = ctx.createGain()
          g.gain.setValueAtTime((1 / partial ** 1.05) * brightness * (cents === 0 ? 0.7 : 0.28), when)
          osc.connect(g)
          g.connect(dest)
          osc.start(when)
          osc.stop(when + MAX_NOTE_SEC)
          nodes.push(oscAdapter(osc), oscAdapter(g))
        }
      } else if (type === 'misc') {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(f0 * 2.01, when)
        const mod = ctx.createOscillator()
        mod.type = 'sine'
        mod.frequency.setValueAtTime(f0 * 1.4, when)
        const modg = ctx.createGain()
        modg.gain.setValueAtTime(f0 * 1.8, when)
        mod.connect(modg)
        modg.connect(osc.frequency)
        const g = ctx.createGain()
        g.gain.setValueAtTime((cents === 0 ? 0.5 : 0.2) * brightness, when)
        osc.connect(g)
        g.connect(dest)
        osc.start(when)
        mod.start(when)
        osc.stop(when + MAX_NOTE_SEC)
        mod.stop(when + MAX_NOTE_SEC)
        nodes.push(oscAdapter(osc), oscAdapter(mod), oscAdapter(modg), oscAdapter(g))
      } else {
        for (let partial = 1; partial <= PARTIAL_COUNT; partial++) {
          const osc = ctx.createOscillator()
          osc.type = 'sine'
          const inharmonic = 1 + (type === 'upright' ? 0.00055 : 0.00035) * partial * partial
          osc.frequency.setValueAtTime(f0 * partial * inharmonic, when)
          const g = ctx.createGain()
          const amp = (1 / partial ** 1.18) * brightness * (partial === 1 ? 1 : 0.85) * (cents === 0 ? 1 : 0.4)
          g.gain.setValueAtTime(amp, when)
          osc.connect(g)
          g.connect(dest)
          osc.start(when)
          osc.stop(when + MAX_NOTE_SEC)
          nodes.push(oscAdapter(osc), oscAdapter(g))
        }
      }
    }
  }

  private addStringRes(
    ctx: AudioContextLike,
    midi: number,
    vel: number,
    when: number,
    dest: ReturnType<AudioContextLike['createBiquadFilter']>,
    nodes: Voice['nodes'],
  ): void {
    const freq = midiToFreq(midi)
    for (const ratio of [1.5, 2, 3.01]) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq * ratio, when)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.04 * vel, when)
      osc.connect(g)
      g.connect(dest)
      osc.start(when)
      osc.stop(when + MAX_NOTE_SEC)
      nodes.push(oscAdapter(osc), oscAdapter(g))
    }
  }

  private spawnOrganVoice(layer: OrganLayerId, note: number, velocity: number, when: number, percTrigger: boolean): void {
    const ctx = this.ctx
    const graph = this.organGraph
    if (!ctx || !graph) return
    const sounded = soundingState(this.state)
    const st = sounded.organ[layer]
    const midi = note + st.octave + (st.pstick ? sounded.pitchStick * 2 : 0)
    const started = startOrganVoice(ctx, graph.input, st, midi, velocity, when, this.noiseBuffer, percTrigger)
    this.voices.push({
      id: nextVoiceId++,
      engine: 'organ',
      layer,
      note,
      velocity,
      startTime: when,
      released: false,
      sustained: false,
      peak: 0.12,
      nodes: started.nodes,
      gain: started.gain,
    })
  }

  private spawnSynthVoice(layer: SynthLayerId, note: number, velocity: number, when: number): void {
    const ctx = this.ctx
    const graph = this.synthGraphs?.[layer]
    if (!ctx || !graph) return
    const sounded = soundingState(this.state)
    const st = sounded.synth[layer]
    const midi = note + st.octave + (st.pstick ? sounded.pitchStick * 2 : 0)
    if (st.voiceMode !== 'Poly') {
      for (const voice of this.voices) {
        if (voice.engine !== 'synth' || voice.layer !== layer || voice.released) continue
        if (st.voiceMode === 'Legato' && this.lastSynthNote[layer] != null) {
          this.releaseVoice(voice, when, 0.02)
        } else {
          this.releaseVoice(voice, when, 0.015)
        }
      }
    }
    const from = this.lastSynthNote[layer]
    const glideFrom = from != null && st.glide > 0.02 && st.voiceMode !== 'Poly' ? midiToFreq(from) : null
    if (st.priority === 'Low' && this.lastSynthNote[layer] != null && midi > (this.lastSynthNote[layer] ?? midi)) {
      if (st.voiceMode !== 'Poly') return
    }
    if (st.priority === 'High' && this.lastSynthNote[layer] != null && midi < (this.lastSynthNote[layer] ?? midi)) {
      if (st.voiceMode !== 'Poly') return
    }
    const started = startSynthVoice(
      ctx,
      graph.input,
      st,
      midi,
      velocity,
      when,
      this.noiseBuffer,
      this.pulse33,
      this.pulse10,
      glideFrom,
    )
    this.lastSynthNote[layer] = midi
    this.voices.push({
      id: nextVoiceId++,
      engine: 'synth',
      layer,
      note,
      velocity,
      startTime: when,
      released: false,
      sustained: false,
      peak: 0.16,
      nodes: started.nodes,
      gain: started.gain,
    })
  }

  private scheduleArp(layer: SynthLayerId, when: number): void {
    const sounded = soundingState(this.state)
    const st = sounded.synth[layer]
    const held = [...this.arpHeld[layer].entries()]
    if (held.length === 0) return
    const notes = held.map(([n]) => n)
    const step = arpStepSeconds(st, sounded.clockBpm, sounded.clockSync || st.arpSync)
    const pattern = arpPattern(notes, st.arpRange, st.arpDir, 7)
    if (pattern.length === 0) return
    const gateLen = st.arpMode === 'Gate' ? step * (0.25 + Math.min(4, st.arpRange) * 0.12) : step * 0.55
    const count = 8
    for (let i = 0; i < count; i++) {
      const t = when + i * step
      if (st.arpMode === 'Poly' || st.arpMode === 'Gate') {
        for (const [n, vel] of held) {
          this.spawnSynthVoice(layer, n + sounded.transpose, vel, t)
          const fake = this.voices[this.voices.length - 1]
          if (fake) this.releaseVoice(fake, t + gateLen, 0.03)
        }
      } else {
        const n = pattern[i % pattern.length]
        const vel = held[0]?.[1] ?? 0.7
        this.spawnSynthVoice(layer, n + sounded.transpose, vel, t)
        const fake = this.voices[this.voices.length - 1]
        if (fake) this.releaseVoice(fake, t + gateLen, 0.03)
      }
    }
  }

  private timbreCutoff(type: PianoType, timbre: string, vel: number): number {
    let base = 700 + vel * 9200
    if (type === 'clav') base = 900 + vel * 5000
    if (type === 'misc') base = 1200 + vel * 7000
    if (timbre === 'Soft') base *= 0.55
    if (timbre === 'Mid') base *= 0.85
    if (timbre === 'Bright') base *= 1.35
    if (timbre === 'Dyno 1') base *= 1.15
    if (timbre === 'Dyno 2') base *= 1.55
    return base
  }

  private ensureVoiceCapacity(time: number): void {
    while (this.voices.length >= this.maxVoices) {
      const stolen = pickStolenVoice(this.voices)
      if (!stolen) break
      this.releaseVoice(stolen, time, STEAL_FADE)
      this.voices = this.voices.filter((item) => item.id !== stolen.id)
    }
  }

  private releaseVoice(voice: Voice, time: number, release: number): void {
    if (voice.released && release > STEAL_FADE) return
    voice.released = true
    voice.sustained = false
    const current = Math.max(0.0001, voice.peak * SUSTAIN_RATIO)
    try {
      voice.gain.gain.cancelScheduledValues(time)
      voice.gain.gain.setValueAtTime(current, time)
      voice.gain.gain.exponentialRampToValueAtTime(0.0001, time + release)
    } catch {
      /* param scheduling unavailable */
    }
    windowSetTimeout(() => this.killVoice(voice, time + release), (release + 0.04) * 1000)
  }

  private killVoice(voice: Voice, time: number): void {
    for (const node of voice.nodes) {
      try {
        node.stop(time)
      } catch {
        /* already stopped */
      }
      try {
        node.disconnect()
      } catch {
        /* already disconnected */
      }
    }
    this.voices = this.voices.filter((item) => item.id !== voice.id)
  }
}

function oscAdapter(node: {
  stop?: (time: number) => void
  disconnect: () => void
}): Voice['nodes'][number] {
  return {
    stop: (time: number) => {
      node.stop?.(time)
    },
    disconnect: () => node.disconnect(),
  }
}

function unisonDetunes(level: InstrumentState['layers']['A']['unison']): number[] {
  if (level === 1) return [0, 8]
  if (level === 2) return [0, -11, 13]
  if (level === 3) return [0, -18, 16, 27]
  return [0]
}

function pickStolenVoice(voices: Voice[]): Voice | null {
  if (voices.length === 0) return null
  const released = voices.filter((voice) => voice.released)
  const pool = released.length > 0 ? released : voices
  let oldest = pool[0]
  for (const voice of pool) {
    if (voice.startTime < oldest.startTime) oldest = voice
    else if (voice.startTime === oldest.startTime && voice.id < oldest.id) oldest = voice
  }
  return oldest
}

function makeNoise(ctx: AudioContextLike, seconds: number): AudioBufferLike {
  const length = Math.max(32, Math.floor(ctx.sampleRate * seconds))
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  let s = 1
  for (let i = 0; i < length; i++) {
    s = (s * 16807) % 2147483647
    data[i] = (s / 2147483647) * 2 - 1
  }
  return buffer
}

function makePulse(ctx: AudioContextLike, duty: number): AudioBufferLike {
  const n = 64
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  const on = Math.max(1, Math.floor(n * duty))
  for (let i = 0; i < n; i++) data[i] = i < on ? 0.85 : -0.85
  return buffer
}

function midiToFreq(note: number): number {
  return 440 * 2 ** ((note - 69) / 12)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function windowSetTimeout(fn: () => void, ms: number): void {
  const timer = globalThis.setTimeout
  timer(fn, ms)
}

export function rms(samples: ArrayLike<number>, start = 0, end = samples.length): number {
  let sum = 0
  const from = Math.max(0, start)
  const to = Math.min(samples.length, end)
  const n = to - from
  if (n <= 0) return 0
  for (let i = from; i < to; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / n)
}

export function lastAudibleIndex(samples: ArrayLike<number>, threshold = 0.0008): number {
  for (let i = samples.length - 1; i >= 0; i--) {
    if (Math.abs(samples[i]) >= threshold) return i
  }
  return 0
}

export function meanAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  if (n <= 0) return 0
  let sum = 0
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i])
  return sum / n
}

export async function renderPianoScript(
  durationSec: number,
  script: (engine: PianoEngine) => void,
  sampleRate = 44100,
): Promise<Float32Array> {
  const ctx = createAudioContext({ offline: true, durationSec, sampleRate })
  const engine = new PianoEngine({ context: ctx })
  script(engine)
  if (!ctx.startRendering) throw new Error('offline context cannot render')
  const buffer = await ctx.startRendering()
  engine.dispose()
  return buffer.getChannelData(0)
}

export { PIANO_TYPES }
export type { AudioBufferSourceNodeLike, OscillatorNodeLike }

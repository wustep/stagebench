// The instrument's audio engine: ONE AudioContext with six effect chains and one master path.
//   piano voices(A|B) → layer bus → Timbre EQ (+ String Res) → FX chain A|B → layer level ─┐
//   organ voices(A|B) → Vox tone mix → vib/chorus scanner → layer level ─→ shared organ chain ─┤→ [direct | Rotary]
//   synth voices(A|B|C) → layer bus → arp gate → FX chain synthA|B|C → layer level ────────────┘
//   direct + shared Rotary → master gain (Master Level) → limiter → ceiling → destination
// Organ reaches the Rotary via the Rotary ORGAN button; piano/synth via Amp Sim "To Rotary".
// Every node reaches the destination only through the master gain and limiter.
import { holdParam, makeCurve, rampTo } from './fx/common'
import { LayerChain } from './fx/chain'
import { RotaryUnit } from './fx/rotary'
import {
  dynCompAmplitude,
  effectiveTimbre,
  midiToHz,
  releaseShape,
  TIMBRE_EQ,
  touchVelocity,
  unisonVoices,
  velocityAmplitude,
  velocityBrightness,
  type PianoModel,
} from './instruments'
import { packOf, type PianoLibrary } from './library'
import type { VoiceFactory, VoiceHandle } from './noteEngine'
import { organShared, OrganLayerGraph, startOrganVoice, type OrganShared, type OrganVoice } from './organ'
import type { AudioState, PianoStatus } from './pianoAudio'
import { lfoFrequency, startSynthVoice, synthShared, SynthLayerGraph, type SynthShared, type SynthVoice } from './synth'
import type { SynthVoiceFactory, SynthVoiceHandle } from './synthEngine'
import type { AudioContextLike, BiquadLike, BufferLike, BufferSourceLike, GainLike, NodeLike, ScheduledSourceLike } from './webAudioTypes'
import {
  CHAINS,
  currentModel,
  effectiveChain,
  LAYERS,
  routesToRotary,
  slotLayer,
  slotLayerState,
  slotSection,
  type ChainId,
  type LayerId,
  type ReverbType,
  type SlotId,
  type SoundState,
} from '../model/sound'
import { ORGAN_LAYERS, type OrganLayerId } from '../model/organState'
import { divisionSeconds, SYNTH_LAYERS, type SynthLayerId } from '../model/synthState'

export const MASTER_GAIN = 0.32
const ATTACK = 0.003
const FAST_TAU = 0.012
const STOP_AFTER_TAUS = 7
/** Recorded/generated voice amplitude trim relative to the Phase 1 voice. */
const VOICE_TRIM = 0.9

/** Master Level knob (0…127) → master gain; 96 is the Phase 1 reference level, 0 is silence. */
export function masterGain(level: number): number {
  const v = Math.min(127, Math.max(0, level)) / 96
  return MASTER_GAIN * v * v
}

/** Layer level fader (0…127) → layer gain. */
export function layerGain(level: number): number {
  const v = Math.min(127, Math.max(0, level)) / 127
  return 1.2 * v * v
}

/** Pitch stick (-100…100) → semitones (±2, manual p. 23). */
export const stickSemitones = (stick: number) => (Math.max(-100, Math.min(100, stick)) / 100) * 2

/** Sympathetic resonance strings (Hz): open low strings excited through the comb bank. */
const RES_STRINGS = [65.41, 98.0, 130.81, 164.81, 196.0]

interface LayerGraph {
  input: GainLike
  low: BiquadLike
  mid: BiquadLike
  high: BiquadLike
  resSend: GainLike
  chain: LayerChain
  level: GainLike
  direct: GainLike
  toRotary: GainLike
  nodes: NodeLike[]
}

/** A chain's tail: optional level (piano/synth; organ levels sit before the shared chain) and the rotary split. */
interface ChainTail {
  chain: LayerChain
  level: GainLike
  direct: GainLike
  toRotary: GainLike
}

interface ActiveVoice {
  layer: SlotId
  sources: ScheduledSourceLike[]
  rates: { src: BufferSourceLike; base: number }[]
  nodes: NodeLike[]
  gain: GainLike
  ended: boolean
  /** Organ: key currently held (percussion is single-triggered). */
  held?: boolean
  organ?: OrganVoice
  synth?: SynthVoice
  synthNote?: number
  cleanup: () => void
}

export interface StageAudioOptions {
  createContext: (() => AudioContextLike) | null
  library: PianoLibrary
  /** Reverb IR length scale (tests use short IRs). */
  irScale?: number
}

export interface StageStatus extends PianoStatus {
  /** Model names per layer whose source failed and currently play the labelled fallback. */
  fallbackModels: string[]
}

export class StageAudio {
  private ctx: AudioContextLike | null = null
  private master: GainLike | null = null
  private limiter: NodeLike | null = null
  private ceiling: NodeLike | null = null
  private rotary: RotaryUnit | null = null
  private layers: Record<LayerId, LayerGraph> | null = null
  /** Built chain tails: piano chains at start; organ/synth chains when their section is first used. */
  private tails: Partial<Record<ChainId, ChainTail>> | null = null
  private organGraphs: Record<OrganLayerId, OrganLayerGraph> | null = null
  private synthGraphs: Record<SynthLayerId, SynthLayerGraph> | null = null
  private organMaterial: OrganShared | null = null
  private synthMaterial: SynthShared | null = null
  private gateActive: Record<SynthLayerId, boolean> = { A: false, B: false, C: false }
  private readonly irCache = new Map<ReverbType, BufferLike>()
  private readonly active = new Set<ActiveVoice>()
  private readonly listeners = new Set<() => void>()
  private sound: SoundState | null = null
  private readonly sustainDown: Record<LayerId, boolean> = { A: false, B: false }
  private disposed = false
  private audio: AudioState
  private unsubLibrary: () => void

  constructor(private readonly options: StageAudioOptions) {
    this.audio = options.createContext ? 'not-started' : 'unavailable'
    this.unsubLibrary = options.library.subscribe(() => this.emit())
  }

  get library(): PianoLibrary {
    return this.options.library
  }

  get context(): AudioContextLike | null {
    return this.ctx
  }

  /** Voices whose Web Audio nodes are still allocated. */
  get liveVoiceCount(): number {
    return this.active.size
  }

  /** Live voices of one layer of any section. */
  liveVoices(layer: SlotId): number {
    let n = 0
    for (const v of this.active) if (v.layer === layer) n++
    return n
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    if (!this.disposed) this.listeners.forEach((l) => l())
  }

  get status(): StageStatus {
    const lib = this.options.library.sources()
    if (!this.options.createContext) {
      return { voice: 'error', audio: 'unavailable', progress: 0, detail: 'Web Audio is not available in this browser — the keybed cannot make sound.', fallbackModels: [] }
    }
    if (this.audio === 'unavailable') {
      return { voice: 'error', audio: 'unavailable', progress: 0, detail: 'Could not start Web Audio.', fallbackModels: [] }
    }
    const done = lib.filter((s) => s.status === 'ready' || s.status === 'failed').length
    const failed = lib.filter((s) => s.status === 'failed')
    const recordedFailed = failed.filter((s) => s.kind === 'recorded')
    const fallbackModels: string[] = []
    if (this.sound) {
      for (const id of LAYERS) {
        const m = currentModel(this.sound.piano.layers[id])
        if (this.options.library.modelStatus(m) === 'failed') fallbackModels.push(m.name)
      }
    }
    if (done < lib.length) {
      return { voice: 'loading', audio: this.audio, progress: done / lib.length, detail: `Loading piano library… ${done}/${lib.length} sources`, fallbackModels }
    }
    if (failed.length) {
      const names = failed.map((s) => s.label).join(', ')
      return {
        voice: 'fallback',
        audio: this.audio,
        progress: 1,
        detail: `${names} failed to load${recordedFailed.length ? ' — those recorded models play a labelled synthesized fallback' : ''}. Other models are ready.`,
        fallbackModels,
      }
    }
    return {
      voice: 'ready',
      audio: this.audio,
      progress: 1,
      detail: 'Piano library ready: Grand, Upright and Electric are recorded samples; Clav, Digital and Misc are synthesized in the browser.',
      fallbackModels,
    }
  }

  /** Create/resume the AudioContext. Call from a user gesture so browsers allow sound. */
  unlock(): AudioContextLike | null {
    if (this.disposed) return null
    if (!this.ctx) {
      if (!this.options.createContext) return null
      try {
        this.ctx = this.options.createContext()
        this.build(this.ctx)
      } catch (error) {
        this.ctx = null
        this.layers = null
        this.audio = 'unavailable'
        void error
        this.emit()
        return null
      }
    }
    const ctx = this.ctx
    this.syncAudioState()
    if (ctx.state === 'suspended') {
      ctx.resume().then(
        () => this.syncAudioState(),
        () => this.syncAudioState(),
      )
    }
    return ctx
  }

  private syncAudioState(): void {
    if (!this.ctx || this.disposed) return
    const audio: AudioState = this.ctx.state === 'running' ? 'running' : this.ctx.state === 'closed' ? 'closed' : 'suspended'
    if (audio !== this.audio) {
      this.audio = audio
      this.emit()
    }
  }

  private build(ctx: AudioContextLike): void {
    const master = ctx.createGain()
    master.gain.value = masterGain(this.sound?.master ?? 96)
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -2
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.002
    limiter.release.value = 0.12
    // Hard ceiling after the compressor-limiter (which has no look-ahead): transparent below 0.7,
    // then a soft knee that can never exceed full scale.
    const ceiling = ctx.createWaveShaper()
    ceiling.curve = makeCurve((x) => (Math.abs(x) <= 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((Math.abs(x) - 0.7) / 0.3))), 2049)
    master.connect(limiter)
    limiter.connect(ceiling)
    ceiling.connect(ctx.destination)
    this.master = master
    this.limiter = limiter
    this.ceiling = ceiling
    const rotary = new RotaryUnit(ctx)
    rotary.output.connect(master)
    this.rotary = rotary
    this.tails = {}
    const tails = { A: this.makeTail(ctx, 'A'), B: this.makeTail(ctx, 'B') }
    const make = (id: LayerId): LayerGraph => {
      const input = ctx.createGain()
      const eq = (type: string, f: number) => {
        const b = ctx.createBiquadFilter()
        b.type = type
        b.frequency.value = f
        b.Q.value = 0.7
        b.gain.value = 0
        return b
      }
      const low = eq('lowshelf', 200)
      const mid = eq('peaking', 1000)
      const high = eq('highshelf', 3000)
      input.connect(low)
      low.connect(mid)
      mid.connect(high)
      const chain = tails[id].chain
      high.connect(chain.input)
      // String Res: a bank of feedback combs tuned to open low strings, fed from the layer.
      const resSend = ctx.createGain()
      resSend.gain.value = 0
      high.connect(resSend)
      const nodes: NodeLike[] = [input, low, mid, high, resSend]
      const resOut = ctx.createGain()
      resOut.gain.value = 0.5
      for (const f of RES_STRINGS) {
        const d = ctx.createDelay(0.1)
        d.delayTime.value = 1 / f
        const damp = ctx.createBiquadFilter()
        damp.type = 'lowpass'
        damp.frequency.value = 2400
        damp.Q.value = 0.5
        const fb = ctx.createGain()
        fb.gain.value = 0.94
        resSend.connect(d)
        d.connect(damp)
        damp.connect(fb)
        fb.connect(d)
        damp.connect(resOut)
        nodes.push(d, damp, fb)
      }
      resOut.connect(chain.input)
      nodes.push(resOut)
      const { level, direct, toRotary } = tails[id]
      return { input, low, mid, high, resSend, chain, level, direct, toRotary, nodes }
    }
    this.layers = { A: make('A'), B: make('B') }
    if (this.sound) this.applyNow(this.sound, true, null)
  }

  /**
   * One effect chain ending in a level (organ: unity; its layer levels sit before the shared
   * chain) and the direct/Rotary split into the master path.
   */
  private makeTail(ctx: AudioContextLike, id: ChainId): ChainTail {
    const chain = new LayerChain(ctx, this.irCache, this.options.irScale ?? 1)
    const level = ctx.createGain()
    const direct = ctx.createGain()
    const toRotary = ctx.createGain()
    toRotary.gain.value = 0
    chain.output.connect(level)
    level.connect(direct)
    level.connect(toRotary)
    direct.connect(this.master!)
    toRotary.connect(this.rotary!.input)
    const t = { chain, level, direct, toRotary }
    this.tails![id] = t
    return t
  }

  /** Build the Organ or Synth graph (and chains) the first time the section is used. */
  private ensureSection(section: 'organ' | 'synth', sound: SoundState): void {
    const ctx = this.ctx
    if (!ctx || !this.tails) return
    if (section === 'organ' && !this.organGraphs) {
      this.organMaterial = organShared(ctx)
      const tail = this.makeTail(ctx, 'organ')
      const organ = (): OrganLayerGraph => {
        const g = new OrganLayerGraph(ctx)
        g.output.connect(tail.chain.input)
        return g
      }
      this.organGraphs = { A: organ(), B: organ() }
      this.applySection(section, sound, true, null)
    }
    if (section === 'synth' && !this.synthGraphs) {
      this.synthMaterial = synthShared(ctx)
      const synth = (id: SynthLayerId): SynthLayerGraph => {
        const tail = this.makeTail(ctx, `synth${id}`)
        const g = new SynthLayerGraph(ctx, this.synthMaterial!)
        g.output.connect(tail.chain.input)
        return g
      }
      this.synthGraphs = { A: synth('A'), B: synth('B'), C: synth('C') }
      this.applySection(section, sound, true, null)
    }
  }

  /** Which sections' graphs exist (organ/synth are built when first switched on). */
  get builtSections(): { organ: boolean; synth: boolean } {
    return { organ: !!this.organGraphs, synth: !!this.synthGraphs }
  }

  /** Apply canonical sound state to the graph (short ramps on every audible change). */
  apply(sound: SoundState, wheel = 0): void {
    const prev = this.sound
    this.sound = sound
    this.wheel = wheel
    if (this.ctx && this.layers) this.applyNow(sound, false, prev)
    const bendChanged = (id: SlotId) => !prev || slotLayerState(prev, id).pStick !== slotLayerState(sound, id).pStick
    if (prev?.pitchStick !== sound.pitchStick || (['A', 'B', 'organA', 'organB', 'synthA', 'synthB', 'synthC'] as SlotId[]).some(bendChanged)) this.bendVoices()
    this.emit()
  }

  private wheel = 0

  /** The Rotary's rotor LFO frequency params (diagnostics/tests). */
  get rotaryUnit(): RotaryUnit | null {
    return this.rotary
  }

  /** A synth layer's graph (tests and diagnostics). */
  synthGraph(layer: SynthLayerId): SynthLayerGraph | null {
    return this.synthGraphs?.[layer] ?? null
  }

  /** An effect chain (tests and diagnostics). */
  chain(id: ChainId): LayerChain | null {
    return this.tails?.[id]?.chain ?? null
  }

  private applyNow(sound: SoundState, initial: boolean, prev: SoundState | null): void {
    const ctx = this.ctx!
    const now = ctx.currentTime
    const set = (p: GainLike['gain'], v: number) => (initial ? p.setValueAtTime(v, now) : rampTo(p, v, now))
    set(this.master!.gain, masterGain(sound.master))
    this.rotary!.apply(sound.rotary, now)
    if (sound.organ.on) this.ensureSection('organ', sound)
    if (sound.synth.on) this.ensureSection('synth', sound)
    this.applyTail('A', sound, initial)
    this.applyTail('B', sound, initial)
    if (this.organGraphs) this.applySection('organ', sound, initial, prev)
    if (this.synthGraphs) this.applySection('synth', sound, initial, prev)
    for (const id of LAYERS) {
      const g = this.layers![id]
      const layer = sound.piano.layers[id]
      const model = currentModel(layer)
      const eq = TIMBRE_EQ[effectiveTimbre(layer.timbre, model.timbre)]
      g.low.frequency.value = eq.low.freq
      g.mid.frequency.value = eq.mid.freq
      g.mid.Q.value = eq.mid.q
      g.high.frequency.value = eq.high.freq
      set(g.low.gain, eq.low.gain)
      set(g.mid.gain, eq.mid.gain)
      set(g.high.gain, eq.high.gain)
      set(g.resSend.gain, this.resonanceSend(sound, id))
      set(g.level.gain, layerGain(layer.level))
    }
  }

  private applyTail(c: ChainId, sound: SoundState, initial: boolean): void {
    const t = this.tails?.[c]
    if (!t) return
    const now = this.ctx!.currentTime
    const set = (p: GainLike['gain'], v: number) => (initial ? p.setValueAtTime(v, now) : rampTo(p, v, now))
    const rot = routesToRotary(sound, c)
    set(t.direct.gain, rot ? 0 : 1)
    set(t.toRotary.gain, rot ? 1 : 0)
    t.chain.apply(effectiveChain(sound, c), sound.fx.on, now, sound.clock.bpm)
  }

  private applySection(section: 'organ' | 'synth', sound: SoundState, initial: boolean, prev: SoundState | null): void {
    const now = this.ctx!.currentTime
    const set = (p: GainLike['gain'], v: number) => (initial ? p.setValueAtTime(v, now) : rampTo(p, v, now))
    const bpm = sound.clock.bpm
    if (section === 'organ') {
      this.applyTail('organ', sound, initial)
      set(this.tails!.organ!.level.gain, 1)
      for (const id of ORGAN_LAYERS) {
        const layer = sound.organ.layers[id]
        this.organGraphs![id].apply(layer, sound.organ.vibType, layerGain(layer.level), now, initial)
        if (prev && prev.organ.layers[id].drawbars !== layer.drawbars) {
          for (const v of this.active) if (v.organ && v.layer === `organ${id}`) v.organ.setDrawbars(layer.drawbars, now)
        }
      }
      return
    }
    for (const id of SYNTH_LAYERS) {
      const layer = sound.synth.layers[id]
      const slot = `synth${id}` as ChainId & SlotId
      this.applyTail(slot, sound, initial)
      set(this.tails![slot]!.level.gain, layerGain(layer.level))
      const lfoHz = lfoFrequency(layer, (rate) => divisionSeconds(rate, bpm))
      this.synthGraphs![id].apply(layer, lfoHz, this.wheel, now, initial)
      const gate = layer.arp.run && layer.arp.mode === 'gate'
      if (!gate && this.gateActive[id]) this.synthGraphs![id].gateOpen(now)
      this.gateActive[id] = gate
      if (prev && prev.synth.layers[id] !== layer) {
        for (const v of this.active) if (v.synth && v.layer === slot) v.synth.update(layer)
      }
    }
  }

  /** Arpeggiator Gate mode: one gate step on a synth layer (Range = gate hardness). */
  gateStep(slot: SlotId, time: number, step: number): void {
    if (!this.synthGraphs || !this.sound || slotSection(slot) !== 'synth') return
    const id = slotLayer(slot) as SynthLayerId
    const hardness = this.sound.synth.layers[id].arp.range / 127
    const edge = 0.0015 + (1 - hardness) * Math.min(0.06, step * 0.25)
    this.synthGraphs[id].gateStep(Math.max(time, this.ctx!.currentTime), step * 0.55, edge)
  }

  private resonanceSend(sound: SoundState, id: LayerId): number {
    const layer = sound.piano.layers[id]
    if (!layer.stringRes || !currentModel(layer).stringRes) return 0
    return this.sustainDown[id] ? 0.3 : 0.07
  }

  /** The sustain pedal state as seen by one layer (SUSTPED-filtered), for piano String Res. */
  setLayerSustain(layer: SlotId, down: boolean): void {
    if (layer !== 'A' && layer !== 'B') return
    if (this.sustainDown[layer] === down) return
    this.sustainDown[layer] = down
    if (this.ctx && this.layers && this.sound) rampTo(this.layers[layer].resSend.gain, this.resonanceSend(this.sound, layer), this.ctx.currentTime)
  }

  private bend(layer: SlotId): number {
    const s = this.sound
    if (!s || !slotLayerState(s, layer).pStick) return 1
    return Math.pow(2, stickSemitones(s.pitchStick) / 12)
  }

  private bendVoices(): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    for (const v of this.active) {
      const k = this.bend(v.layer)
      for (const r of v.rates) rampTo(r.src.playbackRate, r.base * k, now, 0.01)
      v.organ?.setBend(1200 * Math.log2(k), now)
      if (v.synth && v.synthNote !== undefined) v.synth.setPitch(v.synthNote, 0.01, k)
    }
  }

  /** The voice factory for one layer of any section (its note engine owns the voices). */
  voices(layer: SlotId): VoiceFactory & SynthVoiceFactory {
    const section = slotSection(layer)
    if (section === 'organ') return { startVoice: (note, velocity, onEnded, gain) => this.startOrgan(layer, note, onEnded, gain ?? 1) as SynthVoiceHandle | null }
    if (section === 'synth') return { startVoice: (note, velocity, onEnded, gain) => this.startSynth(layer, note, velocity, onEnded, gain ?? 1) }
    return {
      startVoice: (note, velocity, onEnded, gain) => this.startVoice(layer as LayerId, note, velocity, onEnded, gain ?? 1) as SynthVoiceHandle | null,
    }
  }

  /** Register a voice's nodes and build its handle (shared by organ and synth voices). */
  private track(voice: ActiveVoice, onEnded: () => void): void {
    voice.cleanup = () => {
      if (voice.ended) return
      voice.ended = true
      for (const s of voice.sources) s.onended = null
      voice.synth?.detach()
      for (const n of voice.nodes) n.disconnect()
      this.active.delete(voice)
      onEnded()
    }
    voice.sources[0].onended = voice.cleanup
    this.active.add(voice)
  }

  private stopSources(sources: ScheduledSourceLike[], when?: number): void {
    for (const s of sources) {
      try {
        s.stop(when)
      } catch {
        // already stopped
      }
    }
  }

  private startOrgan(slot: SlotId, note: number, onEnded: () => void, gain: number): VoiceHandle | null {
    const ctx = this.unlock()
    const sound = this.sound
    if (ctx && sound) this.ensureSection('organ', sound)
    if (!ctx || !this.organGraphs || !sound || !this.organMaterial) return null
    const id = slotLayer(slot) as OrganLayerId
    const layer = sound.organ.layers[id]
    let othersHeld = false
    for (const v of this.active) if (v.layer === slot && v.held) othersHeld = true
    const organ = startOrganVoice(ctx, this.organMaterial, {
      layer,
      vibType: sound.organ.vibType,
      note,
      gain,
      percussion: !othersHeld,
      bend: this.bend(slot),
      dest: this.organGraphs[id].input,
    })
    const voice: ActiveVoice = { layer: slot, sources: organ.sources, rates: [], nodes: organ.nodes, gain: organ.gain, ended: false, held: true, organ, cleanup: () => undefined }
    this.track(voice, onEnded)
    return {
      release: (fast) => {
        if (voice.ended || !this.ctx) return
        voice.held = false
        this.stopSources(voice.sources, organ.release(fast, this.ctx.currentTime))
      },
      stopNow: () => {
        if (voice.ended) return
        this.stopSources(voice.sources)
        voice.cleanup()
      },
    }
  }

  private startSynth(slot: SlotId, note: number, velocity: number, onEnded: () => void, gain: number): SynthVoiceHandle | null {
    const ctx = this.unlock()
    const sound = this.sound
    if (ctx && sound) this.ensureSection('synth', sound)
    if (!ctx || !this.synthGraphs || !sound || !this.synthMaterial) return null
    const id = slotLayer(slot) as SynthLayerId
    const synth = startSynthVoice(ctx, this.synthMaterial, { layer: sound.synth.layers[id], graph: this.synthGraphs[id], note, velocity, gain, bend: this.bend(slot) })
    const voice: ActiveVoice = { layer: slot, sources: synth.sources, rates: [], nodes: synth.nodes, gain: synth.gain, ended: false, synth, synthNote: note, cleanup: () => undefined }
    this.track(voice, onEnded)
    return {
      release: (fast) => {
        if (voice.ended || !this.ctx) return
        this.stopSources(voice.sources, synth.release(fast))
      },
      stopNow: () => {
        if (voice.ended) return
        this.stopSources(voice.sources)
        voice.cleanup()
      },
      setPitch: (next, seconds) => {
        if (voice.ended) return
        voice.synthNote = next
        synth.setPitch(next, seconds, this.bend(slot))
      },
      retrigger: (v) => {
        if (!voice.ended) synth.retrigger(v)
      },
    }
  }

  private startVoice(layerId: LayerId, note: number, velocity: number, onEnded: () => void, zoneGain = 1): VoiceHandle | null {
    const ctx = this.unlock()
    const sound = this.sound
    if (!ctx || !this.layers || !sound) return null
    const layer = sound.piano.layers[layerId]
    const model = currentModel(layer)
    const bus = this.layers[layerId].input
    const t = ctx.currentTime
    const v = touchVelocity(velocity, layer.kbTouch)
    const amp = dynCompAmplitude(velocityAmplitude(v), layer.dynComp) * model.trim * VOICE_TRIM * zoneGain

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = velocityBrightness(v, note)
    filter.Q.value = 0.5
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(amp, t + ATTACK)
    filter.connect(gain)
    gain.connect(bus)

    const nodes: NodeLike[] = [filter, gain]
    const sources: ScheduledSourceLike[] = []
    const rates: ActiveVoice['rates'] = []
    const zone = this.options.library.zoneFor(ctx, model, note, Math.round(v))
    const fallbackZone = zone ?? this.fallbackZone(ctx, model, note, v)
    const bend = this.bend(layerId)
    let naturalStop: number | null = null
    if (fallbackZone) {
      for (const u of unisonVoices(layer.unison)) {
        const src = ctx.createBufferSource()
        src.buffer = fallbackZone.buffer
        const base = Math.pow(2, (note - fallbackZone.root) / 12 + u.cents / 1200)
        src.playbackRate.value = base * bend
        const pan = ctx.createStereoPanner()
        pan.pan.value = u.pan
        const ug = ctx.createGain()
        ug.gain.value = u.gain
        src.connect(pan)
        pan.connect(ug)
        ug.connect(filter)
        nodes.push(src, pan, ug)
        sources.push(src)
        rates.push({ src, base })
      }
    } else {
      // Labelled last-resort fallback: a decaying triangle oscillator.
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = midiToHz(note)
      gain.gain.setTargetAtTime(amp * 0.15, t + ATTACK, 0.9)
      osc.connect(filter)
      nodes.push(osc)
      sources.push(osc)
      naturalStop = t + 6
    }

    const voice: ActiveVoice = {
      layer: layerId,
      sources,
      rates,
      nodes,
      gain,
      ended: false,
      cleanup: () => {
        if (voice.ended) return
        voice.ended = true
        for (const s of sources) s.onended = null
        for (const n of nodes) n.disconnect()
        this.active.delete(voice)
        onEnded()
      },
    }
    // Every unison source shares the buffer and stop time; the first one's end frees the voice.
    sources[0].onended = voice.cleanup
    this.active.add(voice)
    for (const s of sources) s.start(t)
    if (naturalStop !== null) for (const s of sources) s.stop(naturalStop)

    const stopAll = (when?: number) => {
      for (const s of sources) {
        try {
          s.stop(when)
        } catch {
          // already stopped
        }
      }
    }
    return {
      release: (fast: boolean) => {
        if (voice.ended || !this.ctx) return
        const now = this.ctx.currentTime
        const cur = this.sound?.piano.layers[layerId]
        const tau = fast ? FAST_TAU : releaseShape(model, note, cur?.softRelease ?? false).tau
        holdParam(gain.gain, now)
        gain.gain.setTargetAtTime(0, now, tau)
        stopAll(now + tau * STOP_AFTER_TAUS)
      },
      stopNow: () => {
        if (voice.ended) return
        stopAll()
        voice.cleanup()
      },
    }
  }

  /** A recorded model whose pack failed plays the synthesized Digital piano, labelled as fallback. */
  private fallbackZone(ctx: AudioContextLike, model: PianoModel, note: number, velocity: number) {
    if (!packOf(model)) return null
    const digital = { ...model, source: { kind: 'generated' as const, generator: 'digital-piano' as const } }
    return this.options.library.zoneFor(ctx, digital, note, Math.round(velocity))
  }

  /** Stop every voice immediately and free its nodes. */
  stopAll(): void {
    for (const voice of [...this.active]) {
      for (const s of voice.sources) {
        try {
          s.stop()
        } catch {
          // ignore
        }
      }
      voice.cleanup()
    }
  }

  /** Nodes owned by the engine graph (excluding voices), for cleanup assertions. */
  get graphReady(): boolean {
    return !!this.layers
  }

  dispose(): void {
    if (this.disposed) return
    this.stopAll()
    this.disposed = true
    this.unsubLibrary()
    if (this.layers) {
      for (const id of LAYERS) for (const n of this.layers[id].nodes) n.disconnect()
    }
    if (this.tails) {
      for (const c of CHAINS) {
        const t = this.tails[c]
        if (!t) continue
        t.chain.dispose()
        t.level.disconnect()
        t.direct.disconnect()
        t.toRotary.disconnect()
      }
    }
    if (this.organGraphs) for (const id of ORGAN_LAYERS) this.organGraphs[id].dispose()
    if (this.synthGraphs) for (const id of SYNTH_LAYERS) this.synthGraphs[id].dispose()
    this.tails = null
    this.organGraphs = null
    this.synthGraphs = null
    this.organMaterial = null
    this.synthMaterial = null
    this.rotary?.dispose()
    this.master?.disconnect()
    this.limiter?.disconnect()
    this.ceiling?.disconnect()
    const ctx = this.ctx
    this.ctx = null
    this.layers = null
    this.rotary = null
    this.master = null
    this.limiter = null
    this.ceiling = null
    this.irCache.clear()
    this.options.library.clearBuffers()
    if (ctx) void ctx.close().catch(() => undefined)
    this.audio = 'closed'
    this.listeners.clear()
  }
}

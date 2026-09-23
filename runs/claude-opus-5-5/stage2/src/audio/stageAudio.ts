// The Phase 2 audio engine: ONE AudioContext with
//   voices(A) → layer bus A → Timbre EQ (+ String Res) → FX chain A ─┐
//   voices(B) → layer bus B → Timbre EQ (+ String Res) → FX chain B ─┤→ layer level → [direct | To Rotary → shared Rotary]
//                                                                    └→ master gain (Master Level) → limiter → ceiling → destination
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
import type { AudioState, PianoStatus } from './pianoAudio'
import type { AudioContextLike, BiquadLike, BufferLike, BufferSourceLike, GainLike, NodeLike, ScheduledSourceLike } from './webAudioTypes'
import { currentModel, effectiveChain, LAYERS, routesToRotary, type LayerId, type ReverbType, type SoundState } from '../model/sound'

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

interface ActiveVoice {
  layer: LayerId
  sources: ScheduledSourceLike[]
  rates: { src: BufferSourceLike; base: number }[]
  nodes: NodeLike[]
  gain: GainLike
  ended: boolean
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

  liveVoices(layer: LayerId): number {
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
    const make = (): LayerGraph => {
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
      const chain = new LayerChain(ctx, this.irCache, this.options.irScale ?? 1)
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
      const level = ctx.createGain()
      const direct = ctx.createGain()
      const toRotary = ctx.createGain()
      toRotary.gain.value = 0
      chain.output.connect(level)
      level.connect(direct)
      level.connect(toRotary)
      direct.connect(master)
      toRotary.connect(rotary.input)
      nodes.push(level, direct, toRotary)
      return { input, low, mid, high, resSend, chain, level, direct, toRotary, nodes }
    }
    this.layers = { A: make(), B: make() }
    if (this.sound) this.applyNow(this.sound, true)
  }

  /** Apply canonical sound state to the graph (short ramps on every audible change). */
  apply(sound: SoundState): void {
    const prev = this.sound
    this.sound = sound
    if (this.ctx && this.layers) this.applyNow(sound, false)
    if (prev?.pitchStick !== sound.pitchStick || prev?.piano.layers.A.pStick !== sound.piano.layers.A.pStick || prev?.piano.layers.B.pStick !== sound.piano.layers.B.pStick) this.bendVoices()
    this.emit()
  }

  private applyNow(sound: SoundState, initial: boolean): void {
    const ctx = this.ctx!
    const now = ctx.currentTime
    const set = (p: GainLike['gain'], v: number) => (initial ? p.setValueAtTime(v, now) : rampTo(p, v, now))
    set(this.master!.gain, masterGain(sound.master))
    this.rotary!.apply(sound.rotary, now)
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
      const rot = routesToRotary(sound, id)
      set(g.direct.gain, rot ? 0 : 1)
      set(g.toRotary.gain, rot ? 1 : 0)
      g.chain.apply(effectiveChain(sound, id), sound.fx.on, now)
    }
  }

  private resonanceSend(sound: SoundState, id: LayerId): number {
    const layer = sound.piano.layers[id]
    if (!layer.stringRes || !currentModel(layer).stringRes) return 0
    return this.sustainDown[id] ? 0.3 : 0.07
  }

  /** The sustain pedal state as seen by one layer (SUSTPED-filtered), for String Res. */
  setLayerSustain(layer: LayerId, down: boolean): void {
    if (this.sustainDown[layer] === down) return
    this.sustainDown[layer] = down
    if (this.ctx && this.layers && this.sound) rampTo(this.layers[layer].resSend.gain, this.resonanceSend(this.sound, layer), this.ctx.currentTime)
  }

  private bend(layer: LayerId): number {
    const s = this.sound
    if (!s || !s.piano.layers[layer].pStick) return 1
    return Math.pow(2, stickSemitones(s.pitchStick) / 12)
  }

  private bendVoices(): void {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    for (const v of this.active) {
      const k = this.bend(v.layer)
      for (const r of v.rates) rampTo(r.src.playbackRate, r.base * k, now, 0.01)
    }
  }

  /** The voice factory for one piano layer (its NoteEngine owns the voices). */
  voices(layer: LayerId): VoiceFactory {
    return { startVoice: (note, velocity, onEnded) => this.startVoice(layer, note, velocity, onEnded) }
  }

  private startVoice(layerId: LayerId, note: number, velocity: number, onEnded: () => void): VoiceHandle | null {
    const ctx = this.unlock()
    const sound = this.sound
    if (!ctx || !this.layers || !sound) return null
    const layer = sound.piano.layers[layerId]
    const model = currentModel(layer)
    const bus = this.layers[layerId].input
    const t = ctx.currentTime
    const v = touchVelocity(velocity, layer.kbTouch)
    const amp = dynCompAmplitude(velocityAmplitude(v), layer.dynComp) * model.trim * VOICE_TRIM

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
      for (const id of LAYERS) {
        const g = this.layers[id]
        g.chain.dispose()
        for (const n of g.nodes) n.disconnect()
      }
    }
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

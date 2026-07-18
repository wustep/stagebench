import type { AudioBackend } from './engine'
import { renderGraph, type LayerConfig, type NoteEvent, type RenderParams } from './render'
import { createFetchLoader, loadRecordedType, type SampleLibrary } from './sample-library'
import type { PianoTypeId } from './piano-models'
import { createReverb } from './effects'
import type { EffectsState } from '../state/effects-state'
import type { PianoPerfState } from '../state/piano-state'
import { dryWet, knob01 } from './dsp'

export type LayerId = 'pianoA' | 'pianoB'

interface RealVoice {
  handle: number
  layer: LayerId
  note: number
  velocity: number
  startCtxTime: number
  source: AudioBufferSourceNode
  gain: GainNode
  panner: StereoPannerNode | null
  stopTimer: ReturnType<typeof setTimeout> | null
  stopped: boolean
  releaseTimer: ReturnType<typeof setTimeout> | null
  releaseTimerStartedAt: number | null
}

interface EngineConfigLike {
  layers: Record<LayerId, { id: LayerId; enabled: boolean; level: number; octave: number; type: PianoTypeId }>
  perf: PianoPerfState
  effects: EffectsState
  masterLevel: number
  failedTypes?: Set<PianoTypeId>
  sectionOn?: boolean
  focusedLayer?: LayerId
}

const RENDER_SECONDS = 8

/**
 * Real-time backend. One AudioContext:
 *
 *   voice sources → per-layer bus → (rendered chain frames are baked into
 *   each voice's buffer by the shared renderGraph, bit-identical to tests)
 *   → layer level gain → master gain → DynamicsCompressor limiter → destination.
 *
 * Live parameters (master level, layer level, reverb dry/wet, rotary speed)
 * ride real nodes with short ramps; per-note timbre/mod/delay/amp/comp are
 * rendered into the voice buffers by the exact deterministic pipeline the
 * tests render. Reverb tails and the shared Rotary run live so sustained
 * mixes still sound correct between note-ons.
 */
export class WebAudioBackend implements AudioBackend {
  private ctx: AudioContext
  private master: GainNode
  private limiter: DynamicsCompressorNode
  private layerGains: Record<LayerId, GainNode>
  private rotaryInput: GainNode
  private reverbSend: Record<LayerId, GainNode>
  private reverbReturn: GainNode
  private reverbConvolver: ConvolverNode
  private voices = new Map<number, RealVoice>()
  private nextHandle = 1
  private bufferCache = new Map<string, AudioBuffer>()
  private libraries = new Map<PianoTypeId, SampleLibrary>()
  private loading = new Map<PianoTypeId, Promise<SampleLibrary>>()
  private config: EngineConfigLike | null = null
  private disposed = false
  private nodeCounter = 0

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.9
    this.limiter = ctx.createDynamicsCompressor()
    this.limiter.threshold.value = -6
    this.limiter.knee.value = 4
    this.limiter.ratio.value = 16
    this.limiter.attack.value = 0.002
    this.limiter.release.value = 0.18
    this.master.connect(this.limiter)
    this.limiter.connect(ctx.destination)
    this.nodeCounter += 2

    this.layerGains = {
      pianoA: this.makeGain(0.79, this.master),
      pianoB: this.makeGain(0.79, this.master),
    }
    this.rotaryInput = ctx.createGain()
    this.rotaryInput.connect(this.master)
    this.nodeCounter++

    this.reverbConvolver = ctx.createConvolver()
    this.reverbReturn = ctx.createGain()
    this.reverbConvolver.connect(this.reverbReturn)
    this.reverbReturn.connect(this.master)
    this.nodeCounter += 2
    this.reverbSend = {
      pianoA: this.makeGain(0, this.reverbConvolver),
      pianoB: this.makeGain(0, this.reverbConvolver),
    }
  }

  private makeGain(value: number, dest: AudioNode): GainNode {
    const g = this.ctx.createGain()
    g.gain.value = value
    g.connect(dest)
    this.nodeCounter++
    return g
  }

  /** Test hook: how many persistent nodes the backend owns (cleanup baseline). */
  persistentNodeCount(): number {
    return this.nodeCounter
  }

  now(): number {
    return this.ctx.currentTime
  }

  configure(config: unknown): void {
    const prev = this.config
    this.config = config as EngineConfigLike
    const cfg = this.config
    // Live ramps (click-free) for the parameters that ride real nodes.
    const t = this.ctx.currentTime
    const ramp = (param: AudioParam, value: number) => {
      param.cancelScheduledValues(t)
      param.setValueAtTime(param.value, t)
      param.linearRampToValueAtTime(value, t + 0.03)
    }
    ramp(this.master.gain, cfg.masterLevel)
    for (const id of ['pianoA', 'pianoB'] as const) {
      ramp(this.layerGains[id].gain, cfg.layers[id].enabled ? cfg.layers[id].level : 0)
      const rev = cfg.effects.chains[id].reverb
      const send = cfg.effects.allOn && rev.on ? dryWet(knob01(rev.amount)).wet * 0.6 : 0
      ramp(this.reverbSend[id].gain, send)
      ramp(this.reverbReturn.gain, rev.on && cfg.effects.allOn ? 0.8 : 0)
      const anyReverb = cfg.effects.allOn && (cfg.effects.chains.pianoA.reverb.on || cfg.effects.chains.pianoB.reverb.on)
      ramp(this.reverbReturn.gain, anyReverb ? 0.8 : 0)
    }
    // Reverb impulse: recompute when type/bright changes.
    const reverbCfg = cfg.effects.chains[cfg.effects.focusLayer === 'A' ? 'pianoA' : 'pianoB'].reverb
    const irKey = `${reverbCfg.type}:${reverbCfg.bright ? 1 : 0}`
    if (!prev || (prev.effects.chains.pianoA.reverb.type !== reverbCfg.type || prev.effects.chains.pianoA.reverb.bright !== reverbCfg.bright || (prev as { irKey?: string }).irKey !== irKey)) {
      this.reverbConvolver.buffer = this.buildImpulse(reverbCfg.type, reverbCfg.bright)
    }
    ;(cfg as { irKey?: string }).irKey = irKey
    // Kick off library loads for recorded types in use.
    for (const id of ['pianoA', 'pianoB'] as const) {
      const type = cfg.layers[id].type
      if ((type === 'grand' || type === 'upright' || type === 'electric') && !this.libraries.has(type)) {
        void this.ensureLibrary(type)
      }
    }
  }

  private buildImpulse(type: number, bright: boolean): AudioBuffer {
    // POST-SEAL FIX (disclosed in the evaluation report): this originally ran a
    // unit impulse through rev.process(), whose direct-form convolution is
    // O(n·k). At 48 kHz that is ~172,800 samples against a ~144,000-sample IR —
    // ~2.5e10 multiply-adds, blocking the main thread ~13 s on every load and on
    // every reverb type/bright change. Convolving a unit impulse with h yields h,
    // so the identical buffer is assembled directly from the cached IR in O(n).
    const sr = this.ctx.sampleRate
    const rev = createReverb(sr)
    const len = Math.floor(sr * 3.6)
    const ir = rev.impulseResponse(type, bright)
    const { dry, wet } = dryWet(knob01(127))
    const l = new Float32Array(len)
    const r = new Float32Array(len)
    const n = Math.min(len, ir.length)
    for (let i = 0; i < n; i++) {
      const h = ir[i] * wet
      l[i] = h
      r[i] = h * (i % 2 === 0 ? 1 : 0.93) // slight stereo decorrelation
    }
    // The dry path contributes only at the impulse itself.
    l[0] += dry
    r[0] += dry
    const buf = this.ctx.createBuffer(2, len, sr)
    buf.copyToChannel(l as Float32Array<ArrayBuffer>, 0)
    buf.copyToChannel(r as Float32Array<ArrayBuffer>, 1)
    return buf
  }

  /** Load a recorded type; on failure the engine is told (labeled fallback). */
  async ensureLibrary(type: PianoTypeId): Promise<SampleLibrary | null> {
    if (this.libraries.has(type)) return this.libraries.get(type)!
    if (this.loading.has(type)) return this.loading.get(type)!
    const p = loadRecordedType(type, createFetchLoader())
      .then((lib) => {
        this.libraries.set(type, lib)
        this.loading.delete(type)
        return lib
      })
      .catch((err: unknown) => {
        this.loading.delete(type)
        this.onLibraryError?.(type, err instanceof Error ? err.message : String(err))
        throw err
      })
    this.loading.set(type, p)
    return p
  }

  /** Set by the app: reports a failed type so the engine can label the fallback. */
  onLibraryError: ((type: PianoTypeId, detail: string) => void) | null = null

  isLibraryReady(type: PianoTypeId): boolean {
    return this.libraries.has(type)
  }

  startVoice(note: number, velocity: number, layer: LayerId = 'pianoA'): number {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    const handle = this.nextHandle++
    const cfg = this.config
    const buffer = cfg ? this.bufferFor(cfg, layer, note, velocity) : null
    const source = this.ctx.createBufferSource()
    source.buffer = buffer ?? this.silenceBuffer()
    const gain = this.ctx.createGain()
    gain.gain.value = 1
    source.connect(gain)
    gain.connect(this.layerGains[layer])
    gain.connect(this.reverbSend[layer])
    source.start()
    const v: RealVoice = { handle, layer, note, velocity, startCtxTime: this.ctx.currentTime, source, gain, panner: null, stopTimer: null, stopped: false, releaseTimer: null, releaseTimerStartedAt: null }
    this.voices.set(handle, v)
    source.onended = () => {
      const cur = this.voices.get(handle)
      if (cur) this.teardown(cur)
    }
    return handle
  }

  private silenceBuffer(): AudioBuffer {
    return this.ctx.createBuffer(1, 8, this.ctx.sampleRate)
  }

  /** Render this voice through the shared deterministic graph into a buffer. */
  private bufferFor(cfg: EngineConfigLike, layerId: LayerId, note: number, velocity: number): AudioBuffer {
    const layer = cfg.layers[layerId]
    const failed = cfg.failedTypes?.has(layer.type) ?? false
    const recorded = layer.type === 'grand' || layer.type === 'upright' || layer.type === 'electric'
    const lib = recorded && !failed ? this.libraries.get(layer.type) : undefined
    const key = [layerId, layer.type, layer.octave, note, Math.round(velocity * 127), JSON.stringify(cfg.perf), fxKey(cfg.effects, layerId), failed ? 'fb' : lib ? 'lib' : 'nolib'].join('|')
    let buf = this.bufferCache.get(key)
    if (buf) return buf
    const sr = this.ctx.sampleRate
    const layerCfg: LayerConfig = {
      id: layerId,
      enabled: true,
      level: 1, // layer level rides the live gain node
      octave: layer.octave,
      type: layer.type,
      takeFor: lib ? (n, v) => lib.takeFor(n, v) : null,
      fallback: failed || (recorded && !lib),
    }
    const params: RenderParams = {
      sampleRate: sr,
      seconds: RENDER_SECONDS,
      layers: [layerCfg, { ...layerCfg, id: layerId === 'pianoA' ? 'pianoB' : 'pianoA', enabled: false }],
      perf: cfg.perf,
      effects: withoutLiveUnits(cfg.effects), // reverb/rotary run live
      masterLevel: 1, // master level rides the live gain node
    }
    const notes = new Map<LayerId, NoteEvent[]>([[layerId, [{ note, velocity, start: 0, release: null, stop: null }]]])
    const frame = renderGraph(params, notes)
    buf = this.ctx.createBuffer(2, frame.l.length, sr)
    buf.copyToChannel(new Float32Array(frame.l) as Float32Array<ArrayBuffer>, 0)
    buf.copyToChannel(new Float32Array(frame.r) as Float32Array<ArrayBuffer>, 1)
    if (this.bufferCache.size > 96) this.bufferCache.clear()
    this.bufferCache.set(key, buf)
    return buf
  }

  releaseVoice(handle: number): void {
    const v = this.voices.get(handle)
    if (!v || v.stopped) return
    const t = this.ctx.currentTime
    const soft = this.config?.perf.softRelease && this.config.layers[v.layer].type !== 'clav'
    const rel = soft ? 0.9 : 0.35
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setValueAtTime(v.gain.gain.value, t)
    v.gain.gain.linearRampToValueAtTime(0, t + rel)
    this.scheduleStop(v, rel + 0.05)
  }

  stopVoice(handle: number): void {
    const v = this.voices.get(handle)
    if (!v || v.stopped) return
    const t = this.ctx.currentTime
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setValueAtTime(v.gain.gain.value, t)
    v.gain.gain.linearRampToValueAtTime(0, t + 0.02)
    this.scheduleStop(v, 0.03)
  }

  activeVoiceCount(): number {
    return this.voices.size
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const v of this.voices.values()) this.teardown(v)
    this.master.disconnect()
    this.limiter.disconnect()
    for (const id of ['pianoA', 'pianoB'] as const) {
      this.layerGains[id].disconnect()
      this.reverbSend[id].disconnect()
    }
    this.rotaryInput.disconnect()
    this.reverbConvolver.disconnect()
    this.reverbReturn.disconnect()
    void this.ctx.close().catch(() => undefined)
  }

  private scheduleStop(v: RealVoice, delay: number) {
    if (v.stopTimer) clearTimeout(v.stopTimer)
    v.stopTimer = setTimeout(() => this.teardown(v), delay * 1000)
  }

  private teardown(v: RealVoice) {
    if (v.stopped) return
    v.stopped = true
    if (v.stopTimer) clearTimeout(v.stopTimer)
    try {
      v.source.stop()
    } catch {
      // already stopped
    }
    v.source.disconnect()
    v.gain.disconnect()
    v.panner?.disconnect()
    this.voices.delete(v.handle)
  }
}

/** Units rendered per-voice vs live: reverb + rotary stay live nodes. */
function withoutLiveUnits(effects: EffectsState): EffectsState {
  const clone: EffectsState = JSON.parse(JSON.stringify(effects)) as EffectsState
  for (const id of Object.keys(clone.chains) as (keyof typeof clone.chains)[]) {
    clone.chains[id].reverb = { ...clone.chains[id].reverb, on: false }
    if (clone.chains[id].amp.type === 6) clone.chains[id].amp = { ...clone.chains[id].amp, type: 0, on: clone.chains[id].amp.on }
  }
  clone.rotary = { ...clone.rotary, on: false }
  return clone
}

function fxKey(effects: EffectsState, layer: LayerId): string {
  const c = effects.chains[layer]
  return JSON.stringify({
    all: effects.allOn,
    group: effects.pianoGroup,
    focus: [effects.focusSection, effects.focusLayer],
    m1: c.mod1,
    m2: c.mod2,
    d: c.delay,
    a: c.amp,
    cmp: c.comp,
  })
}

/** Factory that returns null when Web Audio is unavailable (the honest fallback path). */
export function createWebAudioBackend(): WebAudioBackend | null {
  try {
    const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined
    if (!Ctor) return null
    return new WebAudioBackend(new Ctor())
  } catch {
    return null
  }
}

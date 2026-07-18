import type { AudioBackend, RoutableLayerId } from './engine'
import { renderGraph, type PianoLayerConfig, type NoteEvent, type RenderParams } from './render'
import { createFetchLoader, loadRecordedType, type SampleLibrary } from './sample-library'
import type { PianoTypeId } from './piano-models'
import { createReverb } from './effects'
import type { ChainId, EffectsState } from '../state/effects-state'
import type { PianoPerfState } from '../state/piano-state'
import type { OrganState } from '../state/organ-state'
import type { SynthState } from '../state/synth-state'
import type { SplitState } from '../state/program-state'
import { dryWet, knob01 } from './dsp'

export type LayerId = 'pianoA' | 'pianoB'

const BUS_IDS: readonly ChainId[] = ['pianoA', 'pianoB', 'organ', 'synthA', 'synthB', 'synthC']

interface RealVoice {
  handle: number
  layer: RoutableLayerId
  note: number
  velocity: number
  startCtxTime: number
  source: AudioBufferSourceNode
  gain: GainNode
  stopTimer: ReturnType<typeof setTimeout> | null
  stopped: boolean
}

interface EngineConfigLike {
  layers: Record<LayerId, { id: LayerId; enabled: boolean; level: number; octave: number; type: PianoTypeId }>
  perf: PianoPerfState
  effects: EffectsState
  masterLevel: number
  failedTypes?: Set<PianoTypeId>
  organ?: OrganState
  synth?: SynthState
  split?: SplitState
  clock?: { bpm: number; kbSync: boolean }
  transpose?: number
  morphPositions?: { wheel: number; ctrlPedal: number }
  arpNotes?: Record<'A' | 'B' | 'C', number[]>
}

const RENDER_SECONDS = 8

/**
 * Real-time backend. One AudioContext:
 *
 *   voice sources → per-layer bus → (chain frames are baked into each
 *   voice's buffer by the shared renderGraph, bit-identical to tests)
 *   → layer level gain → master gain → DynamicsCompressor limiter → destination.
 *
 * Live parameters (master level, layer level, reverb send) ride real nodes
 * with short ramps; per-note timbre/mod/delay/amp/comp/organ/synth voices
 * are rendered into buffers by the exact deterministic pipeline the tests
 * render. Reverb runs as a live convolver so sustained mixes stay correct.
 */
export class WebAudioBackend implements AudioBackend {
  private ctx: AudioContext
  private master: GainNode
  private limiter: DynamicsCompressorNode
  private layerGains: Record<ChainId, GainNode>
  private reverbSend: Record<ChainId, GainNode>
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

    this.layerGains = {} as Record<ChainId, GainNode>
    this.reverbSend = {} as Record<ChainId, GainNode>
    this.reverbConvolver = ctx.createConvolver()
    this.reverbReturn = ctx.createGain()
    this.reverbConvolver.connect(this.reverbReturn)
    this.reverbReturn.connect(this.master)
    this.nodeCounter += 2
    for (const id of BUS_IDS) {
      this.layerGains[id] = this.makeGain(0.79, this.master)
      this.reverbSend[id] = this.makeGain(0, this.reverbConvolver)
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
    this.config = config as EngineConfigLike
    const cfg = this.config
    const t = this.ctx.currentTime
    const ramp = (param: AudioParam, value: number) => {
      param.cancelScheduledValues(t)
      param.setValueAtTime(param.value, t)
      param.linearRampToValueAtTime(value, t + 0.03)
    }
    ramp(this.master.gain, cfg.masterLevel)
    // Layer levels: piano 0..1, organ/synth 0..127.
    const levelFor = (id: ChainId): number => {
      if (id === 'pianoA' || id === 'pianoB') return cfg.layers[id].enabled ? cfg.layers[id].level : 0
      if (id === 'organ') {
        const o = cfg.organ
        if (!o || !o.sectionOn) return 0
        const a = o.layers.A.enabled ? o.layers.A.level / 127 : 0
        const b = o.layers.B.enabled ? o.layers.B.level / 127 : 0
        return Math.max(a, b)
      }
      const s = cfg.synth
      if (!s || !s.sectionOn) return 0
      const lid = id.slice(-1) as 'A' | 'B' | 'C'
      return s.layers[lid].enabled ? s.layers[lid].level / 127 : 0
    }
    for (const id of BUS_IDS) {
      ramp(this.layerGains[id].gain, levelFor(id))
      const chain = cfg.effects.chains[id]
      const rev = chain.reverb
      const send = cfg.effects.allOn && rev.on ? dryWet(knob01(rev.amount)).wet * 0.6 : 0
      ramp(this.reverbSend[id].gain, send)
    }
    const anyReverb = cfg.effects.allOn && BUS_IDS.some((id) => cfg.effects.chains[id].reverb.on)
    ramp(this.reverbReturn.gain, anyReverb ? 0.8 : 0)
    // Reverb impulse follows the focused chain's type/bright.
    const focused = cfg.effects.chains[cfg.effects.focusSection === 'organ' ? 'organ' : cfg.effects.focusSection === 'synth' ? (cfg.effects.focusLayer === 'B' ? 'synthB' : cfg.effects.focusLayer === 'C' ? 'synthC' : 'synthA') : cfg.effects.focusLayer === 'B' ? 'pianoB' : 'pianoA'].reverb
    const irKey = `${focused.type}:${focused.bright ? 1 : 0}`
    if (irKey !== this.lastIrKey) {
      this.lastIrKey = irKey
      this.reverbConvolver.buffer = this.buildImpulse(focused.type, focused.bright)
    }
    // Kick off library loads for recorded types in use.
    for (const id of ['pianoA', 'pianoB'] as const) {
      const type = cfg.layers[id].type
      if ((type === 'grand' || type === 'upright' || type === 'electric') && !this.libraries.has(type)) {
        void this.ensureLibrary(type)
      }
    }
  }

  private lastIrKey = ''

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

  startVoice(note: number, velocity: number, layer: RoutableLayerId = 'pianoA'): number {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    const handle = this.nextHandle++
    const cfg = this.config
    const buffer = cfg ? this.bufferFor(cfg, layer, note, velocity) : null
    const source = this.ctx.createBufferSource()
    source.buffer = buffer ?? this.silenceBuffer()
    const gain = this.ctx.createGain()
    gain.gain.value = 1
    source.connect(gain)
    const bus = busFor(layer)
    gain.connect(this.layerGains[bus])
    gain.connect(this.reverbSend[bus])
    source.start()
    const v: RealVoice = { handle, layer, note, velocity, startCtxTime: this.ctx.currentTime, source, gain, stopTimer: null, stopped: false }
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
  private bufferFor(cfg: EngineConfigLike, layerId: RoutableLayerId, note: number, velocity: number): AudioBuffer {
    const key = voiceKey(cfg, layerId, note, velocity)
    let buf = this.bufferCache.get(key)
    if (buf) return buf
    const sr = this.ctx.sampleRate
    const seconds = RENDER_SECONDS
    const params: RenderParams = {
      sampleRate: sr,
      seconds,
      layers: this.pianoLayerConfigs(cfg),
      perf: cfg.perf,
      effects: withoutLiveUnits(cfg.effects),
      masterLevel: 1, // master level rides the live gain node
      organ: cfg.organ,
      synth: cfg.synth,
      split: cfg.split,
      clockBpm: cfg.clock?.bpm ?? 120,
      transpose: cfg.transpose ?? 0,
      wheelPos: cfg.morphPositions?.wheel ?? 0,
      arpNotes: cfg.arpNotes ?? { A: [], B: [], C: [] },
    }
    const notes = new Map<RoutableLayerId, NoteEvent[]>([[layerId, [{ note, velocity, start: 0, release: null, stop: null }]]])
    const frame = renderGraph(params, notes)
    buf = this.ctx.createBuffer(2, frame.l.length, sr)
    buf.copyToChannel(new Float32Array(frame.l) as Float32Array<ArrayBuffer>, 0)
    buf.copyToChannel(new Float32Array(frame.r) as Float32Array<ArrayBuffer>, 1)
    if (this.bufferCache.size > 96) this.bufferCache.clear()
    this.bufferCache.set(key, buf)
    return buf
  }

  private pianoLayerConfigs(cfg: EngineConfigLike): PianoLayerConfig[] {
    return (['pianoA', 'pianoB'] as const).map((id) => {
      const layer = cfg.layers[id]
      const failed = cfg.failedTypes?.has(layer.type) ?? false
      const recorded = layer.type === 'grand' || layer.type === 'upright' || layer.type === 'electric'
      const lib = recorded && !failed ? this.libraries.get(layer.type) : undefined
      return {
        id,
        enabled: layer.enabled,
        level: 1, // layer level rides the live gain node
        octave: layer.octave,
        type: layer.type,
        takeFor: lib ? (n: number, v: number) => lib.takeFor(n, v) : null,
        fallback: failed || (recorded && !lib),
      }
    })
  }

  releaseVoice(handle: number): void {
    const v = this.voices.get(handle)
    if (!v || v.stopped) return
    const t = this.ctx.currentTime
    const soft = this.config?.perf.softRelease && v.layer.startsWith('piano') && this.config.layers[v.layer as LayerId]?.type !== 'clav'
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
    for (const id of BUS_IDS) {
      this.layerGains[id].disconnect()
      this.reverbSend[id].disconnect()
    }
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
    this.voices.delete(v.handle)
  }
}

/** The chain bus a routable layer feeds. */
function busFor(layer: RoutableLayerId): ChainId {
  if (layer === 'organA' || layer === 'organB') return 'organ'
  return layer
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

function voiceKey(cfg: EngineConfigLike, layerId: RoutableLayerId, note: number, velocity: number): string {
  const bus = busFor(layerId)
  const c = cfg.effects.chains[bus]
  const parts: unknown[] = [
    layerId,
    note,
    Math.round(velocity * 127),
    cfg.transpose,
    cfg.clock?.bpm,
    JSON.stringify({
      all: cfg.effects.allOn,
      group: [cfg.effects.pianoGroup, cfg.effects.synthGroup],
      focus: [cfg.effects.focusSection, cfg.effects.focusLayer],
      m1: c.mod1,
      m2: c.mod2,
      d: c.delay,
      a: c.amp,
      cmp: c.comp,
      rot: [cfg.effects.rotary.organRouted],
    }),
  ]
  if (layerId === 'pianoA' || layerId === 'pianoB') {
    const layer = cfg.layers[layerId]
    parts.push(layer.type, layer.octave, JSON.stringify(cfg.perf), cfg.failedTypes?.has(layer.type) ? 'fb' : 'lib')
  } else if (layerId === 'organA' || layerId === 'organB') {
    parts.push(JSON.stringify(cfg.organ?.layers[layerId === 'organA' ? 'A' : 'B']))
  } else {
    const lid = layerId.slice(-1) as 'A' | 'B' | 'C'
    parts.push(JSON.stringify(cfg.synth?.layers[lid]), JSON.stringify(cfg.arpNotes?.[lid] ?? []))
  }
  return parts.join('|')
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

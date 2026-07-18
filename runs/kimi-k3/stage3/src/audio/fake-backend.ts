import type { AudioBackend, LayerId, RoutableLayerId } from './engine'
import { renderVoiceBuffer, synthSample } from './voice'
import { renderGraph, type PianoLayerConfig, type NoteEvent, type RenderParams } from './render'
import { makeLibraryFromTakes, type SampleTake } from './sample-library'
import { renderRecordedTake, type PianoTypeId } from './piano-models'
import { defaultEffectsState, type EffectsState } from '../state/effects-state'
import { DEFAULT_PIANO_PERF, type PianoPerfState } from '../state/piano-state'
import { defaultOrganState, type OrganState } from '../state/organ-state'
import { defaultSynthState, type SynthState } from '../state/synth-state'
import { defaultProgramState, type SplitState } from '../state/program-state'

export type { LayerId }

interface FakeVoice {
  handle: number
  note: number
  velocity: number
  startTime: number
  releaseTime: number | null
  stopped: boolean
  stopTime: number | null
  layer: RoutableLayerId
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

/** Deterministic loader: renders the same takes the WAV recorder produced. */
export function fakeSampleLoader(sampleRate: number) {
  const cache = new Map<string, SampleTake>()
  return (type: PianoTypeId) => {
    return (note: number, velocity: number): SampleTake => {
      const layer = velocity < 0.5 ? 0 : 1
      const roots = [28, 33, 38, 43, 48, 53, 58, 62, 67, 72, 76, 80, 83, 86, 89, 93, 96, 100]
      let root = roots[0]
      let best = Infinity
      for (const r of roots) {
        const d = Math.abs(r - note)
        if (d < best) {
          best = d
          root = r
        }
      }
      const key = `${type}:${root}:${layer}:${sampleRate}`
      let take = cache.get(key)
      if (!take) {
        const data = renderRecordedTake(type as 'grand' | 'upright' | 'electric', root, layer === 0 ? 0.3 : 0.9, sampleRate)
        take = { root, layer, sampleRate, data }
        cache.set(key, take)
      }
      return take
    }
  }
}

/**
 * Deterministic in-memory backend for tests.
 *
 * Instead of Web Audio nodes it keeps a voice list and renders the exact
 * shared graph (`renderGraph`) into buffers on demand — the same code the
 * real-time backend plays. Tests assert tolerant signal relationships
 * (louder vs softer, longer vs shorter, silence vs not) rather than exact
 * waveforms.
 */
export class FakeAudioBackend implements AudioBackend {
  readonly sampleRate = 8000
  private clock = 0
  private nextHandle = 1
  private voices: FakeVoice[] = []
  /** Counters proving node/timer/listener hygiene. */
  startCount = 0
  stopCount = 0
  private config: EngineConfigLike | null = null

  now(): number {
    return this.clock
  }

  /** Test hook: advance the fake clock (seconds). */
  advance(seconds: number) {
    this.clock += seconds
  }

  configure(config: unknown): void {
    this.config = config as EngineConfigLike
  }

  /** Test hook: set config directly (no engine needed). */
  setConfig(config: EngineConfigLike): void {
    this.config = config
  }

  startVoice(note: number, velocity: number, layer: RoutableLayerId = 'pianoA'): number {
    const handle = this.nextHandle++
    this.voices.push({ handle, note, velocity, startTime: this.clock, releaseTime: null, stopped: false, stopTime: null, layer })
    this.startCount++
    return handle
  }

  releaseVoice(handle: number): void {
    const v = this.voices.find((x) => x.handle === handle)
    if (v && v.releaseTime === null) v.releaseTime = this.clock
  }

  stopVoice(handle: number): void {
    const v = this.voices.find((x) => x.handle === handle)
    if (v && !v.stopped) {
      v.stopped = true
      v.stopTime = this.clock
      this.stopCount++
    }
  }

  activeVoiceCount(): number {
    return this.voices.filter((v) => !v.stopped).length
  }

  dispose(): void {
    for (const v of this.voices) {
      if (!v.stopped) {
        v.stopped = true
        v.stopTime = this.clock
      }
    }
  }

  /** Live (not stopped) voices, for assertions. */
  liveVoices(): readonly FakeVoice[] {
    return this.voices.filter((v) => !v.stopped)
  }

  /** Default config when no engine has pushed one (isolated renderNote use). */
  private defaultConfig(): EngineConfigLike {
    return {
      layers: {
        pianoA: { id: 'pianoA', enabled: true, level: 0.79, octave: 0, type: 'grand' },
        pianoB: { id: 'pianoB', enabled: false, level: 0.79, octave: 0, type: 'upright' },
      },
      perf: { ...DEFAULT_PIANO_PERF },
      effects: defaultEffectsState(),
      masterLevel: 0.9,
      organ: defaultOrganState(),
      synth: defaultSynthState(),
      split: defaultProgramState().split,
      clock: { bpm: 120, kbSync: false },
      transpose: 0,
      morphPositions: { wheel: 0, ctrlPedal: 0 },
      arpNotes: { A: [], B: [], C: [] },
    }
  }

  /** Build render params from the pushed engine config (or a direct override). */
  buildRenderParams(overrides: Partial<EngineConfigLike> = {}, seconds = 1): RenderParams {
    const cfg = { ...this.defaultConfig(), ...this.config, ...overrides }
    const loader = fakeSampleLoader(this.sampleRate)
    const layers: PianoLayerConfig[] = (['pianoA', 'pianoB'] as const).map((id) => {
      const ls = cfg.layers[id]
      const recorded = ls.type === 'grand' || ls.type === 'upright' || ls.type === 'electric'
      const failed = cfg.failedTypes?.has(ls.type) ?? false
      return {
        id,
        enabled: ls.enabled,
        level: ls.level,
        octave: ls.octave,
        type: ls.type,
        takeFor: recorded && !failed ? loader(ls.type) : null,
        fallback: recorded && failed,
      }
    })
    return {
      sampleRate: this.sampleRate,
      seconds,
      layers,
      perf: cfg.perf,
      effects: cfg.effects,
      masterLevel: cfg.masterLevel,
      organ: cfg.organ,
      synth: cfg.synth,
      split: cfg.split,
      clockBpm: cfg.clock?.bpm ?? 120,
      transpose: cfg.transpose ?? 0,
      wheelPos: cfg.morphPositions?.wheel ?? 0,
      arpNotes: cfg.arpNotes ?? { A: [], B: [], C: [] },
    }
  }

  /** Convert owned voices into graph note events over [from, from+seconds]. */
  private noteEvents(seconds: number, startOffset: number): Map<RoutableLayerId, NoteEvent[]> {
    const map = new Map<RoutableLayerId, NoteEvent[]>()
    const t0 = this.clock + startOffset
    for (const v of this.voices) {
      const relStart = v.startTime - t0
      if (relStart > seconds) continue
      const ev: NoteEvent = {
        note: v.note,
        velocity: v.velocity,
        start: Math.max(0, relStart),
        release: v.releaseTime === null ? null : v.releaseTime - t0,
        stop: v.stopped && v.stopTime !== null ? v.stopTime - t0 : null,
      }
      const list = map.get(v.layer) ?? []
      list.push(ev)
      map.set(v.layer, list)
    }
    return map
  }

  /**
   * Render the mixed output of all voices that sound anywhere in the window
   * [startOffset, startOffset+seconds] relative to the current clock —
   * through the full configured graph (layers, effects, master, limiter).
   */
  renderMix(seconds: number, startOffset = 0): Float32Array {
    const params = this.buildRenderParams({}, seconds)
    const frame = renderGraph(params, this.noteEvents(seconds, startOffset))
    const out = new Float32Array(frame.l.length)
    for (let i = 0; i < out.length; i++) out[i] = (frame.l[i] + frame.r[i]) / 2
    return out
  }

  /** Render the full stereo graph (for width/routing assertions). */
  renderMixStereo(seconds: number, startOffset = 0): { l: Float32Array; r: Float32Array } {
    const params = this.buildRenderParams({}, seconds)
    return renderGraph(params, this.noteEvents(seconds, startOffset))
  }

  /**
   * Render a single note in isolation through a clean default graph
   * (for velocity/sustain/timbre comparisons). Pass overrides to vary state.
   */
  renderNote(note: number, velocity: number, seconds: number, releaseAt: number | null = null, overrides: Partial<EngineConfigLike> = {}): Float32Array {
    const params = this.buildRenderParams(overrides, seconds)
    const notes = new Map<RoutableLayerId, NoteEvent[]>([['pianoA', [{ note, velocity, start: 0, release: releaseAt, stop: null }]]])
    const frame = renderGraph(params, notes)
    const out = new Float32Array(frame.l.length)
    for (let i = 0; i < out.length; i++) out[i] = (frame.l[i] + frame.r[i]) / 2
    return out
  }

  /** Render one note on an arbitrary routable layer (organ/synth tests). */
  renderLayerNote(layer: RoutableLayerId, note: number, velocity: number, seconds: number, releaseAt: number | null = null, overrides: Partial<EngineConfigLike> = {}): Float32Array {
    const params = this.buildRenderParams(overrides, seconds)
    const notes = new Map<RoutableLayerId, NoteEvent[]>([[layer, [{ note, velocity, start: 0, release: releaseAt, stop: null }]]])
    const frame = renderGraph(params, notes)
    const out = new Float32Array(frame.l.length)
    for (let i = 0; i < out.length; i++) out[i] = (frame.l[i] + frame.r[i]) / 2
    return out
  }

  /** Phase 1 compatibility: the synthesized fallback voice in isolation. */
  renderFallbackNote(note: number, velocity: number, seconds: number, releaseAt: number | null = null): Float32Array {
    return renderVoiceBuffer({ note, velocity, startTime: 0, releaseTime: releaseAt }, seconds, this.sampleRate)
  }
}

/** RMS of a buffer — the tolerant loudness relationship used by tests. */
export function rms(buf: Float32Array): number {
  if (buf.length === 0) return 0
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

/** Energy (sum of squares) in a window of a buffer. */
export function windowEnergy(buf: Float32Array, from: number, to: number): number {
  let sum = 0
  const a = Math.max(0, from)
  const b = Math.min(buf.length, to)
  for (let i = a; i < b; i++) sum += buf[i] * buf[i]
  return sum
}

/** Normalized correlation in [-1, 1] between two buffers. */
export function corr(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0, ea = 0, eb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    ea += a[i] * a[i]
    eb += b[i] * b[i]
  }
  return dot / Math.max(1e-12, Math.sqrt(ea * eb))
}

/** Fraction of total energy above `cutHz` (zero-crossing-rate approximation). */
export function highBandRatio(buf: Float32Array, sr: number, cutHz: number): number {
  // Cheap spectral split: difference signal approximates the high band.
  let hp = 0
  let total = 0
  // One-pole lowpass to form the low band; residual is the high band.
  const rc = 1 / (2 * Math.PI * cutHz)
  const dt = 1 / sr
  const alpha = dt / (rc + dt)
  let lp = 0
  for (let i = 0; i < buf.length; i++) {
    lp += alpha * (buf[i] - lp)
    const h = buf[i] - lp
    hp += h * h
    total += buf[i] * buf[i]
  }
  return hp / Math.max(1e-12, total)
}

export { synthSample, makeLibraryFromTakes }

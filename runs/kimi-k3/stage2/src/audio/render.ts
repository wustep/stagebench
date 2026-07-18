/**
 * The render orchestrator — one deterministic pipeline shared by:
 *  - the real-time Web Audio backend (frames pre-rendered and played through
 *    a gain-only master path, bit-identical to what tests assert), and
 *  - the fake backend / offline test renderer.
 *
 * Signal order (effects spec `signalContract.requiredOrder`):
 *   layer source → Mod 1 → Mod 2 → Delay → Amp Sim/EQ/Filter → Compressor
 *   → Reverb → Rotary (when routed) → layer level → master gain → limiter.
 */

import {
  clamp01,
  frameRms,
  gainFrame,
  mixFrames,
  stereoFrame,
  type StereoFrame,
} from './dsp'
import {
  applyTimbre,
  createAmpEq,
  createCompressor,
  createDelay,
  createMod1,
  createMod2,
  createReverb,
  createRotary,
} from './effects'
import {
  applyDynComp,
  applyKbTouch,
  type PianoPerfState,
} from '../state/piano-state'
import {
  chainForLayer,
  resolveUnit,
  type ChainState,
  type EffectsState,
  type LayerId,
} from '../state/effects-state'
import { renderRecordedTake, renderSynthType, type PianoTypeId } from './piano-models'
import { playbackRate, type SampleTake } from './sample-library'

export type { LayerId }

export interface LayerConfig {
  id: LayerId
  enabled: boolean
  level: number // 0..1
  octave: number // semitone shift ±12
  type: PianoTypeId
  /** Recorded take source for grand/upright/electric; null → synth or fallback. */
  takeFor: ((note: number, velocity: number) => SampleTake) | null
  /** True when this layer is on the labeled synthesized fallback. */
  fallback: boolean
}

export interface NoteEvent {
  note: number
  velocity: number
  start: number // seconds, relative to render start
  release: number | null // damper-down time (release begins), null = still held
  stop: number | null // hard stop (steal/all-notes-off)
}

export interface RenderParams {
  sampleRate: number
  seconds: number
  layers: LayerConfig[]
  perf: PianoPerfState
  effects: EffectsState
  masterLevel: number // 0..1
  /** Absolute render start time (engine clock), for LFO-free determinism not needed but kept for parity. */
  at?: number
}

const UNISON_DETUNE_CENTS = [0, 6, 12, 22]
const UNISON_PAN = [0, 0.35, 0.6, 0.85]

/** Shift a take to the target note by linear resampling (≤ minor third by library design). */
function pitchShift(data: Float32Array, rate: number): Float32Array {
  if (Math.abs(rate - 1) < 1e-6) return data
  const n = Math.max(1, Math.floor(data.length / rate))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const pos = i * rate
    const a = Math.floor(pos)
    if (a >= data.length - 1) {
      out[i] = data[data.length - 1]
      continue
    }
    const frac = pos - a
    out[i] = data[a] * (1 - frac) + data[a + 1] * frac
  }
  return out
}

/** Sustaining loop excerpt for recorded voices held past the take length. */
function sustainSegment(type: PianoTypeId, note: number, velocity: number, seconds: number, sr: number): Float32Array {
  // Gentle mid-decay regeneration from the model — only used for very long holds.
  if (type === 'grand' || type === 'upright' || type === 'electric') {
    return renderRecordedTake(type, note, velocity * 0.8, sr).subarray(0, Math.floor(seconds * sr)) as Float32Array
  }
  return renderSynthType('digital', note, velocity * 0.8, seconds, sr)
}

interface RenderedVoice {
  start: number
  release: number | null
  stop: number | null
  note: number
  layer: LayerId
  data: Float32Array // source samples at context rate, post pitch-shift, pre-envelope
  baseGain: number
  releaseScale: number // soft release lengthens this
  type: PianoTypeId
}

function renderVoiceSource(layer: LayerConfig, note: number, velocity: number, seconds: number, sr: number): Float32Array {
  const shifted = note + layer.octave
  if (layer.takeFor) {
    const take = layer.takeFor(shifted, velocity)
    const shiftedData = pitchShift(take.data, playbackRate(take, shifted))
    const needed = Math.floor(seconds * sr)
    if (shiftedData.length >= needed) return shiftedData
    // Held past the take: append a sustaining segment.
    const ext = new Float32Array(needed)
    ext.set(shiftedData)
    const extra = sustainSegment(layer.type, shifted, velocity, seconds - shiftedData.length / sr, sr)
    ext.set(extra.subarray(0, needed - shiftedData.length), shiftedData.length)
    return ext
  }
  if (layer.type === 'clav' || layer.type === 'digital' || layer.type === 'misc') {
    return renderSynthType(layer.type, shifted, velocity, seconds, sr)
  }
  // Labeled fallback for a failed recorded type: honest synthesis.
  return renderSynthType('digital', shifted, velocity, seconds, sr)
}

/**
 * Sympathetic string resonance (manual p. 25, simulation allowed): while
 * other notes or the sustain pedal are held, each voice gains a faint wash of
 * the other held notes' fundamentals. Simulated — declared as such.
 */
function addStringResonance(voices: RenderedVoice[], n: number, sr: number, out: StereoFrame): void {
  const held = voices.filter((v) => v.stop === null)
  if (held.length < 2) return
  for (const v of held) {
    const freq = 440 * Math.pow(2, (v.note - 69) / 12)
    const start = Math.floor(v.start * sr)
    const end = v.stop !== null ? Math.floor(v.stop * sr) : n
    for (let i = Math.max(0, start); i < Math.min(n, end); i++) {
      const t = i / sr - v.start
      const ring = Math.sin(2 * Math.PI * freq * t) * 0.035 * Math.exp(-1.2 * t) * (held.length - 1)
      out.l[i] += ring
      out.r[i] += ring
    }
  }
}

/** Damper envelope applied per voice; soft release lengthens the decay. */
function envelopeVoice(v: RenderedVoice, sr: number, perf: PianoPerfState, gain: number): { l: Float32Array; r: Float32Array; startIdx: number; endIdx: number } {
  const n = v.data.length
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  const soft = perf.softRelease && v.type !== 'clav' // disabled for Clav (manual p. 25)
  const releaseTau = soft ? 0.9 : 0.32
  const startIdx = 0
  let endIdx = n
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const abs = v.start + t
    let env = 1
    if (v.release !== null && abs >= v.release) {
      const rel = abs - v.release
      env = Math.exp(-rel / releaseTau)
    }
    if (v.stop !== null && abs >= v.stop) {
      const rel = abs - v.stop
      env = Math.min(env, Math.exp(-rel / 0.015))
      if (rel > 0.12) {
        endIdx = i
        break
      }
    }
    const s = v.data[i] * env * gain
    l[i] = s
    r[i] = s
    if (v.release !== null && abs - v.release > releaseTau * 6) {
      endIdx = i
      break
    }
  }
  return { l, r, startIdx, endIdx }
}

/** Render one piano layer (voices + perf controls) to a stereo frame. */
export function renderLayerSource(
  layer: LayerConfig,
  notes: NoteEvent[],
  perf: PianoPerfState,
  seconds: number,
  sr: number,
): StereoFrame {
  const n = Math.max(1, Math.floor(seconds * sr))
  const out = stereoFrame(n)
  if (!layer.enabled || notes.length === 0) return out
  const unisonVoices = perf.unison > 0 ? 1 + perf.unison : 1
  const detune = UNISON_DETUNE_CENTS[perf.unison]
  const panSpread = UNISON_PAN[perf.unison]
  const voices: RenderedVoice[] = []
  for (const ev of notes) {
    const vel = applyKbTouch(ev.velocity, perf.kbTouch)
    const gain = applyDynComp(0.2 + 0.8 * vel * vel, perf.dynComp)
    const src = renderVoiceSource(layer, ev.note, vel, seconds - ev.start, sr)
    const v: RenderedVoice = {
      start: ev.start,
      release: ev.release,
      stop: ev.stop,
      note: ev.note + layer.octave,
      layer: layer.id,
      data: src,
      baseGain: gain,
      releaseScale: 1,
      type: layer.type,
    }
    voices.push(v)
    const frame = envelopeVoice(v, sr, perf, gain)
    const off = Math.floor(ev.start * sr)
    const len = Math.min(n - off, frame.endIdx)
    for (let i = 0; i < len; i++) {
      out.l[off + i] += frame.l[i]
      out.r[off + i] += frame.r[i]
    }
    // Unison: detuned stereo voices (manual p. 26).
    for (let u = 1; u < unisonVoices; u++) {
      const cents = detune * (u % 2 === 1 ? 1 : -1) * Math.ceil(u / 2)
      const rate = Math.pow(2, cents / 1200)
      const dup = pitchShift(src, rate)
      const uv: RenderedVoice = { ...v, data: dup }
      const uf = envelopeVoice(uv, sr, perf, gain / unisonVoices)
      const pan = panSpread * (u % 2 === 1 ? 1 : -1)
      const gl = Math.cos(((pan + 1) * Math.PI) / 4)
      const gr = Math.sin(((pan + 1) * Math.PI) / 4)
      const ulen = Math.min(n - off, uf.endIdx)
      for (let i = 0; i < ulen; i++) {
        out.l[off + i] += uf.l[i] * gl * 1.2
        out.r[off + i] += uf.r[i] * gr * 1.2
      }
    }
  }
  if (perf.stringRes) addStringResonance(voices, n, sr, out)
  // Timbre is per type family (acoustic list vs electric list).
  const electric = layer.type === 'electric'
  return applyTimbre(out, sr, perf.timbre, electric)
}

/** Run one chain's units over a layer frame, honoring bypass + all-effects bypass. Returns post-chain frame. */
export function runChain(input: StereoFrame, chain: ChainState, effects: EffectsState, layer: LayerId, sr: number): StereoFrame {
  if (!effects.allOn) return input
  let frame = input
  const delay = resolveUnit(effects, layer, 'delay')
  const comp = resolveUnit(effects, layer, 'comp')
  const reverb = resolveUnit(effects, layer, 'reverb')
  if (chain.mod1.on) frame = createMod1(sr).process(frame, chain.mod1)
  if (chain.mod2.on) frame = createMod2(sr).process(frame, chain.mod2)
  if (delay.on) frame = createDelay(sr).process(frame, delay)
  // Amp/EQ types 0..5 process in place; type 6 (To Rotary) passes through —
  // the rotary tap happens after reverb.
  if (chain.amp.on && chain.amp.type !== 6) frame = createAmpEq(sr).process(frame, chain.amp)
  if (comp.on) frame = createCompressor(sr).process(frame, comp)
  if (reverb.on) frame = createReverb(sr).process(frame, reverb)
  return frame
}

/** Full graph render: layers → chains → rotary → layer levels → master → limiter. */
export function renderGraph(params: RenderParams, notesByLayer: Map<LayerId, NoteEvent[]>): StereoFrame {
  const sr = params.sampleRate
  const n = Math.max(1, Math.floor(params.seconds * sr))
  const master = stereoFrame(n)
  const rotaryInput = stereoFrame(n)
  let anyRotary = false

  for (const layer of params.layers) {
    if (!layer.enabled) continue
    const notes = notesByLayer.get(layer.id) ?? []
    let frame = renderLayerSource(layer, notes, params.perf, params.seconds, sr)
    const chain = chainForLayer(params.effects, layer.id)
    frame = runChain(frame, chain, params.effects, layer.id, sr)
    // To Rotary tap: post-reverb, pre-layer-level (reverb precedes rotary).
    if (params.effects.allOn && chain.amp.on && chain.amp.type === 6 && params.effects.rotary.on) {
      mixFrames(rotaryInput, frame)
      anyRotary = true
      // Routed layer's direct path is replaced by the rotary return.
      frame = stereoFrame(n)
    }
    gainFrame(frame, layer.level)
    mixFrames(master, frame)
  }

  if (anyRotary) {
    const wet = createRotary(sr).process(rotaryInput, params.effects.rotary)
    mixFrames(master, wet)
  }

  // Master gain + hard-ish limiter: nothing bypasses the master path.
  const level = clamp01(params.masterLevel)
  gainFrame(master, level)
  for (let i = 0; i < n; i++) {
    master.l[i] = Math.tanh(master.l[i] * 1.1) * 0.95
    master.r[i] = Math.tanh(master.r[i] * 1.1) * 0.95
  }
  return master
}

/** Convenience: mix a rendered frame to mono (tests + meter taps). */
export function frameToMono(frame: StereoFrame): Float32Array {
  const out = new Float32Array(frame.l.length)
  for (let i = 0; i < out.length; i++) out[i] = (frame.l[i] + frame.r[i]) / 2
  return out
}

export { frameRms }

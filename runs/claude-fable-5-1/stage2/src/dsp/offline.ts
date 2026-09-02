/**
 * Offline rendering for tests and tooling: runs any StereoProcessor block by block over Float32Arrays (the very same
 * classes the AudioWorklet hosts) and provides deterministic test signals.
 */
import { LayerChain } from './chain'
import { defaultChainParams, type ChainParams, type StereoProcessor } from './types'
import { Rng, midiHz } from './util'

export interface StereoBuffer {
  l: Float32Array
  r: Float32Array
}

/** Copies the input, processes it in `blockSize` frames and returns the result. */
export function renderThrough(processor: StereoProcessor, l: Float32Array, r: Float32Array = l, blockSize = 128): StereoBuffer {
  const outL = l.slice()
  const outR = r.slice()
  const n = Math.min(outL.length, outR.length)
  for (let pos = 0; pos < n; pos += blockSize) {
    const len = Math.min(blockSize, n - pos)
    processor.process(outL.subarray(pos, pos + len), outR.subarray(pos, pos + len), len)
  }
  return { l: outL, r: outR }
}

/** Two independent copies of a mono signal. */
export function stereo(x: Float32Array): StereoBuffer {
  return { l: x.slice(), r: x.slice() }
}

export function silence(seconds: number, sr: number): Float32Array {
  return new Float32Array(Math.round(seconds * sr))
}

export interface BurstOptions {
  /** Linear attack in seconds. */
  attack?: number
  /** Exponential decay time constant in seconds (0 = sustained). */
  decay?: number
  amplitude?: number
  /** Total buffer length in seconds (≥ seconds); the rest is silent. */
  length?: number
}

/** Sine at `freq` for `seconds` with an attack ramp and exponential decay. */
export function sineBurst(freq: number, seconds: number, sr: number, options: BurstOptions = {}): Float32Array {
  const attack = options.attack ?? 0.005
  const decay = options.decay ?? 0
  const amp = options.amplitude ?? 0.5
  const total = Math.round((options.length ?? seconds) * sr)
  const len = Math.min(total, Math.round(seconds * sr))
  const out = new Float32Array(total)
  const w = (2 * Math.PI * freq) / sr
  const atk = Math.max(1, Math.round(attack * sr))
  const rel = Math.max(1, Math.round(0.005 * sr))
  for (let i = 0; i < len; i++) {
    let env = i < atk ? i / atk : 1
    if (decay > 0) env *= Math.exp(-i / (decay * sr))
    if (len - i < rel) env *= (len - i) / rel
    out[i] = amp * env * Math.sin(w * i)
  }
  return out
}

/** Piano-like tone: eight decaying harmonics (1/n^1.1, faster decay for higher partials), 3 ms attack, 5 ms release. */
export function harmonicTone(midi: number, seconds: number, sr: number, options: { amplitude?: number; length?: number } = {}): Float32Array {
  const amp = options.amplitude ?? 0.5
  const total = Math.round((options.length ?? seconds) * sr)
  const len = Math.min(total, Math.round(seconds * sr))
  const out = new Float32Array(total)
  const f0 = midiHz(midi)
  const atk = Math.max(1, Math.round(0.003 * sr))
  const rel = Math.max(1, Math.round(0.005 * sr))
  for (let h = 1; h <= 8; h++) {
    const f = f0 * h
    if (f >= sr * 0.45) break
    const a = 1 / Math.pow(h, 1.1)
    const tau = 0.9 / (1 + 0.25 * (h - 1))
    const w = (2 * Math.PI * f) / sr
    for (let i = 0; i < len; i++) out[i] += a * Math.exp(-i / (tau * sr)) * Math.sin(w * i)
  }
  let pk = 0
  for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(out[i]))
  const scale = pk > 0 ? amp / pk : 0
  for (let i = 0; i < len; i++) {
    let env = i < atk ? i / atk : 1
    if (len - i < rel) env *= (len - i) / rel
    out[i] *= scale * env
  }
  return out
}

/** Seeded white noise with an exponential decay. */
export function noiseBurst(seconds: number, sr: number, seed = 1, options: BurstOptions = {}): Float32Array {
  const rng = new Rng(seed)
  const decay = options.decay ?? 0
  const amp = options.amplitude ?? 0.5
  const total = Math.round((options.length ?? seconds) * sr)
  const len = Math.min(total, Math.round(seconds * sr))
  const out = new Float32Array(total)
  for (let i = 0; i < len; i++) {
    const env = decay > 0 ? Math.exp(-i / (decay * sr)) : 1
    out[i] = amp * env * (rng.next() * 2 - 1)
  }
  return out
}

/** A single-sample impulse at `at` seconds in a buffer of `seconds`. */
export function impulse(seconds: number, sr: number, amplitude = 1, at = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr))
  const i = Math.round(at * sr)
  if (i < out.length) out[i] = amplitude
  return out
}

/** Several harmonic tones mixed and peak-normalised. */
export function chord(midis: number[], seconds: number, sr: number, amplitude = 0.5): Float32Array {
  const total = Math.round(seconds * sr)
  const out = new Float32Array(total)
  for (const m of midis) {
    const t = harmonicTone(m, seconds, sr, { amplitude: 1 })
    for (let i = 0; i < total; i++) out[i] += t[i]
  }
  let pk = 0
  for (let i = 0; i < total; i++) pk = Math.max(pk, Math.abs(out[i]))
  const scale = pk > 0 ? amplitude / pk : 0
  for (let i = 0; i < total; i++) out[i] *= scale
  return out
}

export type ChainOverrides = { [K in keyof ChainParams]?: ChainParams[K] extends object ? Partial<ChainParams[K]> : ChainParams[K] }

/** defaultChainParams() with per-unit overrides merged one level deep. */
export function mergeChainParams(base: ChainParams, overrides: ChainOverrides = {}): ChainParams {
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(overrides) as (keyof ChainParams)[]) {
    const value = overrides[key]
    const current = base[key]
    if (value !== undefined && typeof current === 'object' && current !== null && typeof value === 'object' && value !== null) out[key] = { ...current, ...value }
    else if (value !== undefined) out[key] = value
  }
  return out as unknown as ChainParams
}

/** A LayerChain configured with defaults plus overrides. */
export function makeChain(sr: number, overrides: ChainOverrides = {}): { chain: LayerChain; params: ChainParams } {
  const params = mergeChainParams(defaultChainParams(), overrides)
  const chain = new LayerChain(sr)
  chain.setParams(params)
  return { chain, params }
}

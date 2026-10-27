/**
 * Node helpers for the audio graph.
 *
 * Everything here works on the injected `AudioContextLike`, so the identical code runs in
 * the browser and in the offline renderer the tests use. Short ramps are the default for
 * every audible parameter change: an instantaneous `.value = x` on a live graph clicks.
 */
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterLike,
  CompressorLike,
  ConvolverLike,
  DelayLike,
  GainNodeLike,
  OscillatorLike,
  StereoPannerLike,
  WaveShaperLike,
} from './types'

/** Time constants for parameter smoothing, in seconds. */
export const RAMP = 0.012
export const BYPASS_RAMP = 0.018

/**
 * Writes a parameter with a short ramp. `setTargetAtTime` is exponential, which is what a
 * real knob does; when the backend does not implement it we fall back to a linear ramp.
 */
export function ramp(param: AudioParamLike, value: number, now: number, seconds = RAMP): void {
  const safe = Number.isFinite(value) ? value : 0
  if (typeof param.setTargetAtTime === 'function') {
    param.cancelScheduledValues(now)
    param.setTargetAtTime(safe, now, seconds / 3)
    return
  }
  try {
    param.cancelScheduledValues(now)
    param.setValueAtTime(param.value, now)
    param.linearRampToValueAtTime(safe, now + seconds)
  } catch {
    param.value = safe
  }
}

/** Sets a parameter immediately at a known-safe instant (graph construction only). */
export function setNow(param: AudioParamLike, value: number, now: number): void {
  param.cancelScheduledValues(now)
  param.setValueAtTime(value, now)
}

export function gain(ctx: AudioContextLike, value: number): GainNodeLike {
  const node = ctx.createGain()
  setNow(node.gain, value, ctx.currentTime)
  return node
}

export function biquad(
  ctx: AudioContextLike,
  type: string,
  frequency: number,
  q = Math.SQRT1_2,
  gainDb = 0,
): BiquadFilterLike {
  if (!ctx.createBiquadFilter) throw new Error('biquad filters are unavailable')
  const node = ctx.createBiquadFilter()
  node.type = type
  setNow(node.frequency, frequency, ctx.currentTime)
  setNow(node.Q, q, ctx.currentTime)
  if (node.gain) setNow(node.gain, gainDb, ctx.currentTime)
  return node
}

export function delay(ctx: AudioContextLike, maxSeconds: number, seconds: number): DelayLike {
  if (!ctx.createDelay) throw new Error('delay nodes are unavailable')
  const node = ctx.createDelay(maxSeconds)
  setNow(node.delayTime, seconds, ctx.currentTime)
  return node
}

export function compressor(ctx: AudioContextLike): CompressorLike {
  if (!ctx.createDynamicsCompressor) throw new Error('compressors are unavailable')
  return ctx.createDynamicsCompressor()
}

export function convolver(ctx: AudioContextLike, buffer: AudioBufferLike): ConvolverLike {
  if (!ctx.createConvolver) throw new Error('convolution is unavailable')
  const node = ctx.createConvolver()
  // `normalize` divides by the IR's energy, which would flatten the level differences
  // between reverb types; we normalise the IR ourselves when we build it.
  if ('normalize' in node) node.normalize = false
  node.buffer = buffer
  return node
}

export function panner(ctx: AudioContextLike, pan = 0): StereoPannerLike {
  if (!ctx.createStereoPanner) throw new Error('stereo panners are unavailable')
  const node = ctx.createStereoPanner()
  setNow(node.pan, pan, ctx.currentTime)
  return node
}

export function shaper(ctx: AudioContextLike, curve: Float32Array, oversample = '2x'): WaveShaperLike {
  if (!ctx.createWaveShaper) throw new Error('waveshapers are unavailable')
  const node = ctx.createWaveShaper()
  node.curve = curve
  if ('oversample' in node) node.oversample = oversample
  return node
}

export function lfo(ctx: AudioContextLike, frequency: number, type = 'sine'): OscillatorLike {
  if (!ctx.createOscillator) throw new Error('oscillators are unavailable for modulation')
  const node = ctx.createOscillator()
  node.type = type
  setNow(node.frequency, frequency, ctx.currentTime)
  return node
}

export function safeDisconnect(node: AudioNodeLike | null | undefined): void {
  try {
    node?.disconnect()
  } catch {
    /* already disconnected */
  }
}

export function connect(from: AudioNodeLike, to: AudioNodeLike): void {
  from.connect(to)
}

/** Modulators connect to params, not nodes: oscillator -> AudioParam is legal Web Audio. */
export function modulate(source: AudioNodeLike, param: AudioParamLike): void {
  source.connect(param as unknown as AudioNodeLike)
}

/** Deterministic PRNG so generated impulse responses are identical in every render. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/**
 * Soft-clipping transfer curve. `drive` 0..1 maps to an increasingly saturated shape; the
 * curve is normalised so a drive change alters harmonic content rather than only level.
 */
export function driveCurve(amount: number, samples = 1024): Float32Array {
  const k = 1 + amount * 24
  const curve = new Float32Array(samples)
  const norm = Math.tanh(k)
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / norm
  }
  return curve
}

export function mix(curve: Float32Array, shape: 'sine' | 'saw' | 'square' | 'triangle'): Float32Array {
  const out = new Float32Array(curve.length)
  for (let i = 0; i < curve.length; i += 1) {
    const x = (i / (curve.length - 1)) * 2 - 1
    let y = x
    if (shape === 'sine') y = Math.sin(x * Math.PI * 0.5)
    else if (shape === 'saw') y = x
    else if (shape === 'square') y = x > 0 ? 1 : -1
    else if (shape === 'triangle') y = 1 - 4 * Math.abs(Math.round(x * 0.5) - x * 0.5)
    out[i] = curve[i] * 0.5 + y * 0.5
  }
  return out
}

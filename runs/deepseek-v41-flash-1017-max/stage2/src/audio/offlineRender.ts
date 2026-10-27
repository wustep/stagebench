/**
 * Offline renderer for the real effect graph.
 *
 * Tests must cross the audio boundary, so they render the *production* chain through a
 * real Web Audio implementation offscreen rather than inspecting node wiring. Node's
 * `node-web-audio-api` gives a spec-compliant `OfflineAudioContext`, which is the same
 * signal-processing code the browser runs.
 *
 * The helpers here only build signals and measure them; none of them contains DSP that
 * the app does not also run.
 */
import type { ChainOwner } from './types'
import type { EffectState } from './effectState'
import { cloneState, defaultEffectState } from './effectState'
import { createChain, buildRotary, createRotaryReturn, type ChainNodes, type RotaryUnit } from './effectGraph'

/** The minimal structural view of an OfflineAudioContext this module needs. */
export interface RenderContext {
  readonly sampleRate: number
  readonly currentTime: number
  readonly destination: unknown
  createGain(): never
  createBuffer(channels: number, length: number, sampleRate: number): never
  createBufferSource(): never
  startRendering(): Promise<{ getChannelData(channel: number): Float32Array; length: number; numberOfChannels: number }>
  [key: string]: unknown
}

/* ------------------------------------------------------------------ */
/* Measurements                                                       */
/* ------------------------------------------------------------------ */

export function rms(samples: Float32Array, from = 0, to = samples.length): number {
  const start = Math.max(0, Math.min(samples.length, from))
  const end = Math.max(start, Math.min(samples.length, to))
  if (end === start) return 0
  let sum = 0
  for (let i = start; i < end; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / (end - start))
}

export function peak(samples: Float32Array): number {
  let max = 0
  for (const s of samples) max = Math.max(max, Math.abs(s))
  return max
}

/** Brightness as the ratio of first-difference energy to signal energy. Scale-invariant. */
export function brightness(samples: Float32Array, from = 0, to = samples.length): number {
  const start = Math.max(0, Math.min(samples.length, from))
  const end = Math.max(start, Math.min(samples.length, to))
  let delta = 0
  let total = 0
  for (let i = Math.max(1, start); i < end; i += 1) {
    const d = samples[i] - samples[i - 1]
    delta += d * d
    total += samples[i] * samples[i]
  }
  return Math.sqrt(delta / Math.max(total, 1e-20))
}

/** Peak-normalised difference between two signals; 0 means identical after scaling. */
export function shapeDifference(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length)
  if (length === 0) return 0
  const peakA = peak(a) || 1
  const peakB = peak(b) || 1
  let diff = 0
  let total = 0
  for (let i = 0; i < length; i += 1) {
    const x = a[i] / peakA
    const y = b[i] / peakB
    diff += Math.abs(x - y)
    total += Math.abs(x) + Math.abs(y)
  }
  return diff / Math.max(total, 1e-20)
}

/** Index of the last sample above a threshold, used as an audible-duration proxy. */
export function lastAudible(samples: Float32Array, threshold = 1e-4): number {
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    if (Math.abs(samples[i]) > threshold) return i
  }
  return 0
}

/** Zero-crossing rate per second, a cheap register/tuning proxy. */
export function crossingRate(samples: Float32Array, sampleRate: number): number {
  let crossings = 0
  for (let i = 1; i < samples.length; i += 1) {
    if ((samples[i - 1] < 0 && samples[i] >= 0) || (samples[i - 1] >= 0 && samples[i] < 0)) {
      crossings += 1
    }
  }
  return (crossings * sampleRate) / Math.max(1, samples.length)
}

/** Correlation between two channels: +1 identical, -1 inverted, 0 uncorrelated. */
export function stereoCorrelation(left: Float32Array, right: Float32Array): number {
  const length = Math.min(left.length, right.length)
  let sumLR = 0
  let sumLL = 0
  let sumRR = 0
  for (let i = 0; i < length; i += 1) {
    sumLR += left[i] * right[i]
    sumLL += left[i] * left[i]
    sumRR += right[i] * right[i]
  }
  return sumLR / Math.max(1e-20, Math.sqrt(sumLL) * Math.sqrt(sumRR))
}

/**
 * Energy in a band, via a one-pole band-pass sweep. Used to prove a wah or filter sweep
 * moves energy in frequency rather than only in level.
 */
export function bandEnergy(samples: Float32Array, sampleRate: number, centreHz: number, widthOctaves = 0.5): number {
  const hi = centreHz * Math.pow(2, widthOctaves / 2)
  // A simple two-pass biquad-free estimate: difference for high-pass, mean for low-pass.
  let energy = 0
  let lowState = 0
  let highState = 0
  const lowCoef = Math.exp((-2 * Math.PI * hi) / sampleRate)
  for (const sample of samples) {
    lowState = sample * (1 - lowCoef) + lowState * lowCoef
    highState = sample - lowState
    // In-band signal is what survives the high-pass but not the higher low-pass.
    const residual = highState
    energy += residual * residual
  }
  return Math.sqrt(energy / Math.max(1, samples.length))
}

/**
 * Long-term level contour of a signal: the RMS of consecutive blocks. A compressor
 * narrows the spread of this contour; a tremolo makes it oscillate; a delay adds echoes.
 */
export function levelContour(samples: Float32Array, blocks = 24): number[] {
  const size = Math.max(1, Math.floor(samples.length / blocks))
  const out: number[] = []
  for (let i = 0; i < blocks; i += 1) {
    out.push(rms(samples, i * size, (i + 1) * size))
  }
  return out
}

/** Spread of a contour: how much the level moves over time. */
export function contourSpread(contour: number[]): number {
  const finite = contour.filter((v) => Number.isFinite(v) && v > 0)
  if (finite.length === 0) return 0
  const mean = finite.reduce((s, v) => s + v, 0) / finite.length
  if (mean === 0) return 0
  const variance = finite.reduce((s, v) => s + (v - mean) ** 2, 0) / finite.length
  return Math.sqrt(variance) / mean
}

/** Spectral centroid proxy: higher = brighter. */
export function centroidProxy(samples: Float32Array, sampleRate: number): number {
  let num = 0
  let den = 0
  for (let i = 1; i < samples.length; i += 1) {
    const d = Math.abs(samples[i] - samples[i - 1]) * sampleRate
    num += d * Math.abs(samples[i])
    den += Math.abs(samples[i])
  }
  return num / Math.max(den, 1e-20)
}

/* ------------------------------------------------------------------ */
/* State helpers                                                      */
/* ------------------------------------------------------------------ */

export function stateWith(mutate: (state: EffectState) => void): EffectState {
  const state = defaultEffectState()
  // Start from a silent graph, then let the caller opt each unit in explicitly.
  mutate(state)
  return state
}

export function withChain(owner: ChainOwner, mutate: (state: EffectState) => void): EffectState {
  const state = cloneState(defaultEffectState())
  mutate(state)
  void owner
  return state
}

/** A chain wrapper that renders one layer's effect chain offline. */
export interface Rendered {
  left: Float32Array
  right: Float32Array
  mono: Float32Array
  sampleRate: number
}

export interface ChainHarness {
  context: unknown
  chain: ChainNodes
  rotary: RotaryUnit
  /** Renders `seconds` of the current chain output for a source signal. */
  renderSource(
    makeSource: (ctx: unknown, destination: unknown) => void,
    seconds: number,
    state: EffectState,
  ): Promise<Rendered>
}

/**
 * Renders the production chain for one layer. This is the function the effect tests use;
 * it builds the same `createChain` the browser builds, and wires it as
 * chain -> destination instead of chain -> master so the effect can be measured alone.
 */
export async function renderChain(
  OfflineContext: new (channels: number, length: number, sampleRate: number) => unknown,
  makeSource: (ctx: unknown, destination: unknown) => (ctx: unknown) => void,
  options: { state: EffectState; owner: ChainOwner; seconds: number; sampleRate: number },
): Promise<Rendered> {
  const { state, owner, seconds, sampleRate } = options
  const frames = Math.round(seconds * sampleRate)
  const ctx = new OfflineContext(2, frames, sampleRate) as Record<string, unknown> & {
    currentTime: number
    destination: unknown
    createGain: () => { connect: (n: unknown) => void; gain: { value: number; setValueAtTime: (v: number, t: number) => void } }
    startRendering: () => Promise<{ getChannelData(c: number): Float32Array }>
    [k: string]: unknown
  }
  const rotary = buildRotary(ctx as never)
  const chain = createChain(ctx as never, owner, rotary)
  const sink = ctx.createGain()
  chain.output.connect(sink as never)
  // The rotary is shared and returns separately, exactly as in the engine.
  createRotaryReturn(ctx as never, rotary).connect(sink as never)
  sink.connect(ctx.destination)
  chain.update(state, 0)
  rotary.apply(state, 0)
  const finalize = makeSource(ctx, chain.input)
  const buffer = await ctx.startRendering()
  finalize(ctx)
  const channels = buffer as unknown as { numberOfChannels: number }
  const left = buffer.getChannelData(0)
  const right = channels.numberOfChannels > 1 ? buffer.getChannelData(1) : left
  const mono = new Float32Array(left.length)
  for (let i = 0; i < left.length; i += 1) mono[i] = (left[i] + right[i]) / 2
  return { left, right, mono, sampleRate }
}

/* ------------------------------------------------------------------ */
/* Deterministic test sources                                         */
/* ------------------------------------------------------------------ */

/** A tone burst with a fixed envelope: predictable, broadband, and easy to measure. */
export function createToneSource(
  ctx: Record<string, any>,
  destination: unknown,
  options: { frequency: number; seconds: number; gain?: number; type?: string },
) {
  const osc = ctx.createOscillator()
  osc.type = options.type ?? 'sawtooth'
  osc.frequency.value = options.frequency
  const env = ctx.createGain()
  env.gain.value = 0
  const g = options.gain ?? 0.4
  env.gain.setValueAtTime(0, 0)
  env.gain.linearRampToValueAtTime(g, 0.01)
  env.gain.setValueAtTime(g, options.seconds * 0.5)
  env.gain.linearRampToValueAtTime(0, options.seconds)
  osc.connect(env)
  env.connect(destination as never)
  osc.start(0)
  osc.stop(options.seconds)
  return () => {
    try {
      osc.stop()
    } catch {
      /* already stopped */
    }
  }
}

/**
 * An impulse train: short clicks at a fixed interval. Level-contour tests use it because a
 * compressor's effect on transient peaks is obvious and a delay's echoes are countable.
 */
export function createClickSource(
  ctx: Record<string, any>,
  destination: unknown,
  options: { seconds: number; interval: number; gain?: number },
) {
  const osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.value = 900
  const env = ctx.createGain()
  env.gain.value = 0
  const g = options.gain ?? 0.5
  for (let t = 0; t < options.seconds; t += options.interval) {
    env.gain.setValueAtTime(0, t)
    env.gain.linearRampToValueAtTime(g, t + 0.004)
    env.gain.linearRampToValueAtTime(0, t + Math.min(0.06, options.interval * 0.8))
  }
  osc.connect(env)
  env.connect(destination as never)
  osc.start(0)
  osc.stop(options.seconds)
  return () => {
    try {
      osc.stop()
    } catch {
      /* already stopped */
    }
  }
}

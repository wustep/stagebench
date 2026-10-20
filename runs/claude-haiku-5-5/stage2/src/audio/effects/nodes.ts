// Shared helpers for building effect graphs: a node bag that disposes everything it made, short
// parameter ramps, LFOs, and shaping curves. Nothing here decides what an effect sounds like.

import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  GainNodeLike,
  OscillatorNodeLike,
  OscillatorType,
} from '../audioBoundary'

/** Time constant for parameter moves. Short enough to feel immediate, long enough to avoid zipper clicks. */
export const RAMP_SECONDS = 0.03

/** Owns every node a unit creates so the unit can be disposed in one call. */
export class NodeBag {
  private readonly nodes: AudioNodeLike[] = []

  add<T extends AudioNodeLike>(node: T): T {
    this.nodes.push(node)
    return node
  }

  dispose(): void {
    for (const node of this.nodes) {
      node.disconnect()
    }
    this.nodes.length = 0
  }
}

export function gainNode(context: AudioContextLike, bag: NodeBag, value: number): GainNodeLike {
  const node = bag.add(context.createGain())
  node.gain.setValueAtTime(value, context.currentTime)
  return node
}

/** Moves a parameter to `value` over about RAMP_SECONDS. */
export function ramp(context: AudioContextLike, param: AudioParamLike, value: number, tau = RAMP_SECONDS): void {
  param.setTargetAtTime(value, context.currentTime, tau)
}

/** A free-running oscillator used as a low-frequency modulator. Its output is wired into an AudioParam. */
export function lfo(context: AudioContextLike, bag: NodeBag, rateHz: number, type: OscillatorType = 'sine'): OscillatorNodeLike {
  const osc = bag.add(context.createOscillator())
  osc.type = type
  osc.frequency.setValueAtTime(rateHz, context.currentTime)
  osc.start(context.currentTime)
  return osc
}

/** Maps a 0..1 control onto an exponential range, e.g. 0.2..8 Hz for rates. */
export function expRange(value: number, low: number, high: number): number {
  const v = Math.min(1, Math.max(0, value))
  return low * Math.pow(high / low, v)
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Waveshaper curve for drive: symmetric soft clip with `amount` in 0..1 (0 is close to linear). */
export function softClipCurve(amount: number, samples = 2048): Float32Array {
  const k = 1 + 9 * clamp01(amount)
  const curve = new Float32Array(samples)
  for (let i = 0; i < samples; i += 1) {
    const x = (2 * i) / (samples - 1) - 1
    curve[i] = Math.tanh(k * x) / Math.tanh(k)
  }
  return curve
}

/** Asymmetric clip for the warmer amp colour: the positive half clips earlier than the negative. */
export function asymmetricCurve(amount: number, samples = 2048): Float32Array {
  const k = 1 + 6 * clamp01(amount)
  const curve = new Float32Array(samples)
  for (let i = 0; i < samples; i += 1) {
    const x = (2 * i) / (samples - 1) - 1
    const y = x >= 0 ? Math.tanh(k * x * 1.6) / Math.tanh(k * 1.6) : Math.tanh(k * x) / Math.tanh(k)
    curve[i] = y
  }
  return curve
}

/** Hard-ish clip for the small amp: little headroom, sharp knee. */
export function hardClipCurve(amount: number, samples = 2048): Float32Array {
  const k = 2 + 18 * clamp01(amount)
  const curve = new Float32Array(samples)
  for (let i = 0; i < samples; i += 1) {
    const x = (2 * i) / (samples - 1) - 1
    curve[i] = Math.max(-1, Math.min(1, k * x)) / Math.max(1, k * 0.5)
  }
  return curve
}

/** Absolute value, for envelope followers: a waveshaper with a V-shaped curve. */
export function rectifierCurve(samples = 2048): Float32Array {
  const curve = new Float32Array(samples)
  for (let i = 0; i < samples; i += 1) {
    curve[i] = Math.abs((2 * i) / (samples - 1) - 1)
  }
  return curve
}

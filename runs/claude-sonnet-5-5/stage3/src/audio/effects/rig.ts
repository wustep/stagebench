import type {
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadLike,
  DelayLike,
  GainNodeLike,
  OscillatorLike,
  StereoPannerLike,
  WaveShaperLike,
} from '../types'

/** every audible parameter change uses a short ramp so bypass / knob moves never click */
export const RAMP_S = 0.02

let immediate = false
/** run `fn` with every ramp collapsed to an instant set: used once, to put a brand-new graph into its initial state */
export function withImmediateRamps<T>(fn: () => T): T {
  const previous = immediate
  immediate = true
  try {
    return fn()
  } finally {
    immediate = previous
  }
}

/** glide a parameter to `value` from wherever it is now */
export function ramp(ctx: AudioContextLike, param: AudioParamLike, value: number, seconds = RAMP_S): void {
  const now = ctx.currentTime
  if (immediate) {
    param.cancelScheduledValues(now)
    param.setValueAtTime(value, now)
    return
  }
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)
  param.linearRampToValueAtTime(value, now + seconds)
}

export interface FxNode {
  readonly input: AudioNodeLike
  readonly output: AudioNodeLike
  dispose(): void
}

/** Creates nodes for an effect and remembers them so one call frees everything (oscillators stopped, nodes disconnected). */
export class Rig {
  private readonly nodes: AudioNodeLike[] = []
  private readonly oscillators: OscillatorLike[] = []
  constructor(readonly ctx: AudioContextLike) {}

  add<T extends AudioNodeLike>(node: T): T {
    this.nodes.push(node)
    return node
  }
  gain(value = 1): GainNodeLike {
    const g = this.add(this.ctx.createGain())
    g.gain.value = value
    return g
  }
  biquad(type: string, frequency: number, q = 0.707, gain = 0): BiquadLike {
    const b = this.add(this.ctx.createBiquadFilter())
    b.type = type
    b.frequency.value = frequency
    b.Q.value = q
    b.gain.value = gain
    return b
  }
  delay(max: number, time: number): DelayLike {
    const d = this.add(this.ctx.createDelay(max))
    d.delayTime.value = time
    return d
  }
  panner(pan = 0): StereoPannerLike {
    const p = this.add(this.ctx.createStereoPanner())
    p.pan.value = pan
    return p
  }
  shaper(curve: Float32Array, oversample = '2x'): WaveShaperLike {
    const s = this.add(this.ctx.createWaveShaper())
    s.curve = curve
    s.oversample = oversample
    return s
  }
  osc(type: string, hz: number): OscillatorLike {
    const o = this.ctx.createOscillator()
    o.type = type
    o.frequency.value = hz
    o.start()
    this.oscillators.push(o)
    this.nodes.push(o)
    return o
  }
  /** serial chain: a → b → c ... returns the last node */
  chain(...list: AudioNodeLike[]): AudioNodeLike {
    for (let i = 0; i < list.length - 1; i++) list[i].connect(list[i + 1])
    return list[list.length - 1]
  }
  dispose(): void {
    for (const o of this.oscillators) {
      o.onended = null
      try {
        o.stop()
      } catch {
        // already stopped
      }
    }
    for (const n of this.nodes) {
      try {
        n.disconnect()
      } catch {
        // already disconnected
      }
    }
    this.nodes.length = 0
    this.oscillators.length = 0
  }
}

/** |x| transfer curve for the envelope follower */
export const ABS_CURVE = new Float32Array([1, 0, 1])

/** soft-clipping curve: tanh(k·x) normalised so ±1 stays ±1 */
export function driveCurve(k: number, asymmetry = 0, samples = 1024): Float32Array {
  const curve = new Float32Array(samples)
  const norm = Math.tanh(k)
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1
    curve[i] = Math.tanh(k * (x + asymmetry * x * x)) / norm
  }
  return curve
}

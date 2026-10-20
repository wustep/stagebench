// Reverb: a convolver fed by a generated impulse response, one per room type. Each type has its own
// decay (Booth is very short, Cathedral very long), its own early reflections, and Spring adds the
// boing of repeated spring echoes. Bright/Dark sets a low-pass after the convolver.
//
// Two convolvers alternate. A type change loads the idle one and crossfades, so changing type never
// clicks. Impulse responses use a fixed-seed generator, so every render is deterministic.

import type { AudioBufferLike, AudioContextLike, BiquadFilterNodeLike, ConvolverNodeLike, GainNodeLike } from '../audioBoundary'
import { EffectSlot } from './slot'
import { expRange, gainNode, NodeBag, ramp } from './nodes'
import { REVERB_TYPES, type ReverbSettings } from './types'

interface RoomShape {
  decaySeconds: number
  predelaySeconds: number
  /** Early reflections as [time in seconds, relative level]. */
  reflections: readonly [number, number][]
  /** Spring echoes as [time in seconds, relative level]; empty for non-spring rooms. */
  springs: readonly [number, number][]
}

const SHAPES: readonly RoomShape[] = [
  // Room
  { decaySeconds: 0.9, predelaySeconds: 0.008, reflections: [[0.011, 0.5], [0.017, 0.4], [0.023, 0.3], [0.031, 0.25]], springs: [] },
  // Booth
  { decaySeconds: 0.22, predelaySeconds: 0.002, reflections: [[0.004, 0.5], [0.007, 0.3]], springs: [] },
  // Spring
  { decaySeconds: 1.8, predelaySeconds: 0.003, reflections: [[0.005, 0.2]], springs: [[0.035, 0.7], [0.07, 0.5], [0.105, 0.35], [0.14, 0.2]] },
  // Stage
  { decaySeconds: 1.4, predelaySeconds: 0.014, reflections: [[0.018, 0.4], [0.026, 0.35], [0.039, 0.3], [0.052, 0.2]], springs: [] },
  // Hall
  { decaySeconds: 2.6, predelaySeconds: 0.02, reflections: [[0.03, 0.35], [0.045, 0.3], [0.065, 0.25]], springs: [] },
  // Cathedral
  { decaySeconds: 4.5, predelaySeconds: 0.03, reflections: [[0.045, 0.3], [0.07, 0.25], [0.1, 0.2]], springs: [] },
]

const impulseCache = new WeakMap<AudioContextLike, Map<number, AudioBufferLike>>()

/** A small seeded generator, so impulse responses are identical on every run. */
function seededNoise(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
  }
}

/** The impulse response for a room type, built once per context and shared by every layer. */
export function impulseResponse(context: AudioContextLike, type: number): AudioBufferLike {
  const index = Math.min(SHAPES.length - 1, Math.max(0, type))
  let cache = impulseCache.get(context)
  if (!cache) {
    cache = new Map()
    impulseCache.set(context, cache)
  }
  const cached = cache.get(index)
  if (cached) return cached

  const shape = SHAPES[index]
  const sampleRate = context.sampleRate
  const length = Math.ceil((shape.decaySeconds + shape.predelaySeconds) * sampleRate)
  const buffer = context.createBuffer(2, length, sampleRate)
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel)
    const noise = seededNoise(1000 * index + channel + 1)
    const decay = Math.log(1000) / shape.decaySeconds
    for (let i = 0; i < length; i += 1) {
      const t = i / sampleRate - shape.predelaySeconds
      if (t < 0) continue
      data[i] = noise() * Math.exp(-decay * t) * 0.3
    }
    for (const [time, level] of shape.reflections) {
      const at = Math.round((time + shape.predelaySeconds) * sampleRate)
      if (at < length) data[at] += level * (channel === 0 ? 1 : -0.8)
    }
    for (const [time, level] of shape.springs) {
      const start = Math.round((time + shape.predelaySeconds) * sampleRate)
      for (let i = 0; i < Math.round(0.03 * sampleRate) && start + i < length; i += 1) {
        data[start + i] += level * noise() * Math.exp(-i / (0.008 * sampleRate))
      }
    }
  }
  cache.set(index, buffer)
  return buffer
}

export class ReverbUnit {
  readonly slot: EffectSlot
  private readonly context: AudioContextLike
  private readonly convolvers: ConvolverNodeLike[] = []
  private readonly gains: GainNodeLike[] = []
  private tone: BiquadFilterNodeLike | undefined
  private active = -1
  private type = -1

  constructor(context: AudioContextLike) {
    this.context = context
    this.slot = new EffectSlot(context, {
      build: (ctx, bag, wetIn) => this.build(ctx, bag, wetIn),
    })
  }

  private build(ctx: AudioContextLike, bag: NodeBag, wetIn: GainNodeLike): GainNodeLike {
    const sum = gainNode(ctx, bag, 1)
    for (let i = 0; i < 2; i += 1) {
      const convolver = bag.add(ctx.createConvolver())
      const gain = gainNode(ctx, bag, 0)
      wetIn.connect(convolver)
      convolver.connect(gain)
      gain.connect(sum)
      this.convolvers.push(convolver)
      this.gains.push(gain)
    }
    const tone: BiquadFilterNodeLike = bag.add(ctx.createBiquadFilter())
    tone.type = 'lowpass'
    tone.frequency.setValueAtTime(12000, ctx.currentTime)
    tone.Q.setValueAtTime(0.5, ctx.currentTime)
    sum.connect(tone)
    this.tone = tone
    return tone
  }

  apply(settings: ReverbSettings): void {
    this.slot.setOn(settings.on)
    this.slot.setMix(settings.mix)
    if (this.tone) {
      ramp(this.context, this.tone.frequency, expRange(settings.bright, 2500, 14000))
    }
    const type = Math.min(REVERB_TYPES.length - 1, Math.max(0, settings.type))
    if (type === this.type) return
    this.type = type
    const incoming = this.active === 0 ? 1 : 0
    this.convolvers[incoming].buffer = impulseResponse(this.context, type)
    this.gains.forEach((gain, index) => {
      ramp(this.context, gain.gain, index === incoming ? 1 : 0, 0.05)
    })
    this.active = incoming
  }

  dispose(): void {
    this.slot.dispose()
  }
}

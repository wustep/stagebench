import type { ReverbState, ReverbType } from '../../engine/state'
import { clamp } from '../params'
import type { AudioBufferLike, AudioContextLike, ConvolverLike, GainNodeLike, Scheduler } from '../types'
import { ramp, RAMP_S, Rig, type FxNode } from './rig'

interface RoomSpec {
  decay: number
  preDelay: number
  /** high-frequency damping of the tail: higher = duller */
  damping: number
  /** density of early reflections */
  early: number
}

/** RT60-ish decay in seconds grows from Booth (very short) to Cathedral (very long) */
export const REVERB_SPECS: Record<ReverbType, RoomSpec> = {
  Booth: { decay: 0.22, preDelay: 0.002, damping: 0.7, early: 0.5 },
  Room: { decay: 0.55, preDelay: 0.006, damping: 0.45, early: 0.8 },
  Spring: { decay: 1.7, preDelay: 0.001, damping: 0.35, early: 0 },
  Stage: { decay: 1.25, preDelay: 0.012, damping: 0.4, early: 0.7 },
  Hall: { decay: 2.7, preDelay: 0.022, damping: 0.5, early: 0.6 },
  Cathedral: { decay: 5.6, preDelay: 0.038, damping: 0.62, early: 0.5 },
}

/** small deterministic PRNG so an impulse response is identical every time it is generated */
const prng = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * GENERATED impulse responses (not recordings): decaying, progressively low-passed noise for the room types, and a
 * train of dispersed downward chirps for the spring's characteristic "boing".
 */
export function makeImpulseResponse(ctx: AudioContextLike, type: ReverbType): AudioBufferLike {
  const spec = REVERB_SPECS[type]
  const sr = ctx.sampleRate
  const length = Math.max(64, Math.floor((spec.decay * 1.25 + spec.preDelay) * sr))
  const buffer = ctx.createBuffer(2, length, sr)
  const seedBase = 1000 + REVERB_ORDER.indexOf(type) * 77
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch)
    const rand = prng(seedBase + ch * 13)
    const pre = Math.floor(spec.preDelay * sr)
    if (type === 'Spring') {
      // chirps every ~37 ms, each a fast downward sweep, decaying by the spring's RT60
      const period = Math.floor(0.037 * sr + ch * 0.002 * sr)
      const chirpLen = Math.floor(0.03 * sr)
      for (let start = pre, k = 0; start < length; start += period, k++) {
        const amp = Math.pow(10, (-60 * (start / sr)) / spec.decay / 20) * (k % 2 ? -0.8 : 1)
        const sweepSeconds = chirpLen / sr
        const slope = (500 - 2600) / sweepSeconds
        for (let n = 0; n < chirpLen && start + n < length; n++) {
          const tau = n / sr
          const phase = 2 * Math.PI * (2600 * tau + 0.5 * slope * tau * tau)
          data[start + n] += amp * Math.sin(phase) * (1 - n / chirpLen) * 0.6
        }
      }
      let lp = 0
      for (let n = 0; n < length; n++) {
        lp += 0.35 * (rand() * 2 - 1 - lp)
        const env = Math.pow(10, (-60 * (n / sr)) / spec.decay / 20)
        data[n] += lp * env * 0.08
      }
      continue
    }
    let lp = 0
    const coef = 1 - spec.damping * 0.9
    for (let n = pre; n < length; n++) {
      const t = (n - pre) / sr
      const env = Math.pow(10, (-60 * t) / spec.decay / 20)
      // damping grows with time: later reflections are duller
      const c = Math.max(0.04, coef * Math.exp(-t * (0.8 + spec.damping * 2)))
      lp += c * (rand() * 2 - 1 - lp)
      data[n] = lp * env * (t < 0.08 ? 1 + spec.early * 1.5 : 1)
    }
    // a few discrete early reflections
    if (spec.early > 0) {
      for (let k = 0; k < 6; k++) {
        const at = pre + Math.floor((0.004 + rand() * 0.05 * (0.3 + spec.decay / 3)) * sr)
        if (at < length) data[at] += (rand() > 0.5 ? 1 : -1) * spec.early * (0.7 - k * 0.08)
      }
    }
    // fade the very end to avoid a truncation click
    const tail = Math.min(length, Math.floor(0.05 * sr))
    for (let n = 0; n < tail; n++) data[length - 1 - n] *= n / tail
  }
  return buffer
}

const REVERB_ORDER: readonly ReverbType[] = ['Room', 'Booth', 'Spring', 'Stage', 'Hall', 'Cathedral']

/**
 * Reverb: dry path + convolution of GENERATED impulse responses. Two convolvers alternate so a type change crossfades;
 * Bright/Dark shape the wet signal. Dry/Wet is equal-power and fully wet at maximum.
 */
export class ReverbUnit implements FxNode {
  readonly input: GainNodeLike
  readonly output: GainNodeLike
  private readonly rig: Rig
  private readonly dry: GainNodeLike
  private readonly wet: GainNodeLike
  private readonly slots: Array<{ conv: ConvolverLike; fade: GainNodeLike; type: ReverbType | null }>
  private active = 0
  private readonly bright: ReturnType<Rig['biquad']>
  private readonly dark: ReturnType<Rig['biquad']>
  private readonly cache = new Map<ReverbType, AudioBufferLike>()
  private readonly timers = new Set<number>()

  constructor(
    private readonly ctx: AudioContextLike,
    private readonly scheduler: Scheduler,
  ) {
    const rig = (this.rig = new Rig(ctx))
    this.input = rig.gain(1)
    this.output = rig.gain(1)
    this.dry = rig.gain(1)
    this.wet = rig.gain(0)
    this.bright = rig.biquad('highshelf', 4000, 0.7, 0)
    this.dark = rig.biquad('lowpass', 20000, 0.7)
    this.input.connect(this.dry)
    this.dry.connect(this.output)
    rig.chain(this.bright, this.dark, this.wet, this.output)
    this.slots = [0, 1].map(() => {
      const conv = rig.add(ctx.createConvolver())
      const fade = rig.gain(0)
      this.input.connect(conv)
      conv.connect(fade)
      fade.connect(this.bright)
      return { conv, fade, type: null }
    })
  }

  get type(): ReverbType | null {
    return this.slots[this.active].type
  }

  apply(cfg: ReverbState, active: boolean): void {
    const ctx = this.ctx
    if (!active) {
      ramp(ctx, this.dry.gain, 1)
      ramp(ctx, this.wet.gain, 0)
      return
    }
    this.selectType(cfg.type)
    const angle = clamp(cfg.dryWet, 0, 1) * Math.PI * 0.5
    ramp(ctx, this.dry.gain, Math.cos(angle))
    ramp(ctx, this.wet.gain, Math.sin(angle))
    ramp(ctx, this.bright.gain, cfg.tone === 'bright' ? 7 : 0)
    ramp(ctx, this.dark.frequency, cfg.tone === 'dark' ? 1800 : 20000)
  }

  private selectType(type: ReverbType) {
    const cur = this.slots[this.active]
    if (cur.type === type) return
    const next = this.slots[1 - this.active]
    let ir = this.cache.get(type)
    if (!ir) {
      ir = makeImpulseResponse(this.ctx, type)
      this.cache.set(type, ir)
    }
    next.conv.buffer = ir
    next.type = type
    ramp(this.ctx, next.fade.gain, 1, RAMP_S * 2)
    if (cur.type) ramp(this.ctx, cur.fade.gain, 0, RAMP_S * 2)
    this.active = 1 - this.active
    if (cur.type) {
      const timer = this.scheduler.setTimeout(() => {
        this.timers.delete(timer)
        if (cur.type !== this.slots[this.active].type) {
          cur.conv.buffer = null
          cur.type = null
        }
      }, 200)
      this.timers.add(timer)
    }
  }

  dispose(): void {
    for (const t of this.timers) this.scheduler.clearTimeout(t)
    this.timers.clear()
    this.rig.dispose()
    this.cache.clear()
  }
}

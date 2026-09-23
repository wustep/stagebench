// Reverb (manual pp. 52-53): six convolution types whose impulse responses are generated
// deterministically in the browser (not recordings). Decay grows from Booth (very short) to
// Cathedral (very long); Spring adds a dispersive, repeating "boing" chirp train. Bright/Dark tone
// shapes the wet signal; Dry/Wet is fully wet at max.
import type { ReverbState, ReverbTone, ReverbType } from '../../model/sound'
import type { AudioContextLike, BiquadLike, BufferLike, ConvolverLike } from '../webAudioTypes'
import { FxUnit, rampTo, TypeBranches, unit } from './common'

export interface ReverbShape {
  /** RT60-ish decay (s). */
  decay: number
  predelay: number
  /** Low-pass damping of the tail (Hz at the end of the tail). */
  damping: number
  spring?: boolean
}

export const REVERB_SHAPES: Record<ReverbType, ReverbShape> = {
  booth: { decay: 0.25, predelay: 0.002, damping: 5000 },
  room: { decay: 0.7, predelay: 0.006, damping: 4500 },
  spring: { decay: 1.6, predelay: 0.01, damping: 3500, spring: true },
  stage: { decay: 1.5, predelay: 0.015, damping: 5000 },
  hall: { decay: 2.4, predelay: 0.022, damping: 4000 },
  cathedral: { decay: 4.2, predelay: 0.035, damping: 3000 },
}

function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stereo impulse response for a reverb type. `lengthScale` < 1 shortens IRs (tests). */
export function renderImpulse(type: ReverbType, sampleRate: number, lengthScale = 1): [Float32Array, Float32Array] {
  const shape = REVERB_SHAPES[type]
  const seconds = Math.max(0.05, (shape.decay * 1.1 + shape.predelay) * lengthScale)
  const n = Math.round(seconds * sampleRate)
  const chans: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)]
  const pre = Math.round(shape.predelay * sampleRate)
  const k = Math.log(1000) / (shape.decay * lengthScale * sampleRate)
  for (let c = 0; c < 2; c++) {
    const rand = prng(1 + c * 7919 + type.length * 131)
    const out = chans[c]
    let lp = 0
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / n
      const env = Math.exp(-k * (i - pre))
      // Damping: a one-pole low-pass whose cutoff falls over the tail.
      const fc = shape.damping * (1 - 0.7 * t) + 300
      const a = Math.exp((-2 * Math.PI * fc) / sampleRate)
      lp = (1 - a) * (rand() * 2 - 1) + a * lp
      out[i] = lp * env
    }
    if (shape.spring) {
      // Dispersive chirps repeating every ~33 ms: the spring tank's boing.
      const period = Math.round(0.033 * sampleRate)
      const chirpLen = Math.round(0.02 * sampleRate)
      for (let start = pre + (c ? period >> 1 : 0); start < n; start += period) {
        const env = Math.exp(-k * (start - pre))
        for (let j = 0; j < chirpLen && start + j < n; j++) {
          const tt = j / sampleRate
          const f = 2600 - 90000 * tt
          out[start + j] += 0.9 * env * Math.sin(2 * Math.PI * Math.max(200, f) * tt) * (1 - j / chirpLen)
        }
      }
    }
  }
  return chans
}

const TONE: Record<ReverbTone, { type: string; freq: number; gain: number }> = {
  normal: { type: 'highshelf', freq: 3000, gain: 0 },
  bright: { type: 'highshelf', freq: 2500, gain: 7 },
  dark: { type: 'highshelf', freq: 1800, gain: -14 },
}

export class ReverbUnit extends FxUnit<ReverbState> {
  private readonly branches: TypeBranches<ReverbType>
  readonly tone: BiquadLike
  readonly convolvers = new Map<ReverbType, ConvolverLike>()

  constructor(ctx: AudioContextLike, irCache: Map<ReverbType, BufferLike>, lengthScale = 1) {
    super(ctx)
    const b = this.bag
    this.tone = b.add(ctx.createBiquadFilter())
    this.tone.type = 'highshelf'
    this.tone.frequency.value = 3000
    this.tone.gain.value = 0
    this.branches = new TypeBranches<ReverbType>(b, this.input, this.tone)
    this.tone.connect(this.wet)
    for (const type of Object.keys(REVERB_SHAPES) as ReverbType[]) {
      let buf = irCache.get(type)
      if (!buf) {
        const [l, r] = renderImpulse(type, ctx.sampleRate, lengthScale)
        const wb = ctx.createBuffer(2, l.length, ctx.sampleRate)
        wb.copyToChannel(l, 0)
        wb.copyToChannel(r, 1)
        irCache.set(type, wb)
        buf = wb
      }
      const br = this.branches.add(type)
      const conv = b.add(ctx.createConvolver())
      conv.normalize = true
      conv.buffer = buf
      br.in.connect(conv)
      conv.connect(br.out)
      this.convolvers.set(type, conv)
    }
  }

  apply(s: ReverbState, active: boolean, now: number): void {
    const t = TONE[s.tone]
    this.tone.frequency.value = t.freq
    rampTo(this.tone.gain, t.gain, now)
    this.branches.select(s.type, 1, now)
    const w = unit(s.dryWet)
    // Fully wet at max; equal-power-ish crossfade elsewhere.
    if (active) this.mix(Math.cos((w * Math.PI) / 2), Math.sin((w * Math.PI) / 2) * 1.4, now)
    else this.mix(1, 0, now)
  }
}

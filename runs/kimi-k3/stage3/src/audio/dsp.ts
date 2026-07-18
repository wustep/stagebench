/**
 * Pure, deterministic DSP primitives shared by the real-time Web Audio graph
 * and the offline test renderer.
 *
 * Every piano performance control (Timbre, Dyn Comp, KB Touch, Unison, Soft
 * Release, String Res) and every effect unit/type is implemented here as a
 * plain function or small stateful struct operating on Float32Array frames.
 * The same code renders (a) per-voice sample buffers in the browser, (b) the
 * effect chain in the WebAudio backend's ScriptProcessor-free render loop via
 * pre-computed frames, and (c) the deterministic offline renders tests assert
 * on. No Math.random anywhere — LFOs are phase-accumulated sine/tri oscs and
 * "noise" comes from a fixed-seed LCG.
 */

// ---------------------------------------------------------------- utilities

export const TAU = Math.PI * 2

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

/** Map a 0..127 panel knob value to 0..1. */
export function knob01(v: number): number {
  return clamp01(v / 127)
}

/** Equal-power crossfade gains for a dry/wet mix in 0..1. */
export function dryWet(mix: number): { dry: number; wet: number } {
  const m = clamp01(mix)
  return { dry: Math.cos((m * Math.PI) / 2), wet: Math.sin((m * Math.PI) / 2) }
}

/** Deterministic pseudo-noise (fixed-seed LCG) in [-1, 1). */
export function makeNoise(seed = 0x1a2b3c4d): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return (s / 0x80000000) - 1
  }
}

// ---------------------------------------------------------------- biquad

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'lowshelf' | 'highshelf' | 'allpass'

export class Biquad {
  private b0 = 1
  private b1 = 0
  private b2 = 0
  private a1 = 0
  private a2 = 0
  private x1 = 0
  private x2 = 0
  private y1 = 0
  private y2 = 0

  /** RBJ cookbook coefficients. gainDb only for peaking/shelf. */
  set(type: BiquadType, sampleRate: number, freq: number, q: number, gainDb = 0): void {
    const f = clamp(freq, 10, sampleRate * 0.45)
    const w0 = (TAU * f) / sampleRate
    const cosw = Math.cos(w0)
    const sinw = Math.sin(w0)
    const alpha = sinw / (2 * Math.max(0.05, q))
    const A = Math.pow(10, gainDb / 40)
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
    switch (type) {
      case 'lowpass':
        b0 = (1 - cosw) / 2; b1 = 1 - cosw; b2 = (1 - cosw) / 2; a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha
        break
      case 'highpass':
        b0 = (1 + cosw) / 2; b1 = -(1 + cosw); b2 = (1 + cosw) / 2; a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha
        break
      case 'bandpass':
        b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha
        break
      case 'peaking':
        b0 = 1 + alpha * A; b1 = -2 * cosw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cosw; a2 = 1 - alpha / A
        break
      case 'lowshelf': {
        const s = 2 * Math.sqrt(A) * alpha
        b0 = A * (A + 1 - (A - 1) * cosw + s); b1 = 2 * A * (A - 1 - (A + 1) * cosw); b2 = A * (A + 1 - (A - 1) * cosw - s)
        a0 = A + 1 + (A - 1) * cosw + s; a1 = -2 * (A - 1 + (A + 1) * cosw); a2 = A + 1 + (A - 1) * cosw - s
        break
      }
      case 'highshelf': {
        const s = 2 * Math.sqrt(A) * alpha
        b0 = A * (A + 1 + (A - 1) * cosw + s); b1 = -2 * A * (A - 1 + (A + 1) * cosw); b2 = A * (A + 1 + (A - 1) * cosw - s)
        a0 = A + 1 - (A - 1) * cosw + s; a1 = 2 * (A - 1 - (A + 1) * cosw); a2 = A + 1 - (A - 1) * cosw - s
        break
      }
      case 'allpass':
        b0 = 1 - alpha; b1 = -2 * cosw; b2 = 1 + alpha; a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha
        break
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0
  }

  next(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1; this.x1 = x
    this.y2 = this.y1; this.y1 = y
    return y
  }

  process(buf: Float32Array): Float32Array {
    for (let i = 0; i < buf.length; i++) buf[i] = this.next(buf[i])
    return buf
  }
}

/** One-pole lowpass — cheap, stable, used for timbre/darkening and smoothing. */
export class OnePole {
  private y = 0
  private a = 0
  setCutoff(sampleRate: number, freq: number): void {
    const f = clamp(freq, 1, sampleRate * 0.45)
    this.a = 1 - Math.exp((-TAU * f) / sampleRate)
  }
  reset(): void {
    this.y = 0
  }
  next(x: number): number {
    this.y += this.a * (x - this.y)
    return this.y
  }
  process(buf: Float32Array): Float32Array {
    for (let i = 0; i < buf.length; i++) buf[i] = this.next(buf[i])
    return buf
  }
}

// ---------------------------------------------------------------- LFO

export type LfoWave = 'sine' | 'tri' | 'square' | 'saw'

export class Lfo {
  private phase = 0
  constructor(
    public rateHz = 1,
    public wave: LfoWave = 'sine',
  ) {}
  /** Current value in [-1, 1]; advances by one sample. */
  next(sampleRate: number): number {
    const v = this.value()
    this.phase = (this.phase + this.rateHz / sampleRate) % 1
    return v
  }
  value(): number {
    const p = this.phase
    switch (this.wave) {
      case 'sine':
        return Math.sin(TAU * p)
      case 'tri':
        return 4 * Math.abs(p - 0.5) - 1
      case 'square':
        return p < 0.5 ? 1 : -1
      case 'saw':
        return 2 * p - 1
    }
  }
}

// ---------------------------------------------------------------- frames

export type StereoFrame = { l: Float32Array; r: Float32Array }

export function monoFrame(n: number): Float32Array {
  return new Float32Array(n)
}

export function stereoFrame(n: number): StereoFrame {
  return { l: new Float32Array(n), r: new Float32Array(n) }
}

export function cloneFrame(src: StereoFrame): StereoFrame {
  return { l: new Float32Array(src.l), r: new Float32Array(src.r) }
}

export function monoToStereo(mono: Float32Array): StereoFrame {
  return { l: new Float32Array(mono), r: new Float32Array(mono) }
}

export function mixFrames(dst: StereoFrame, src: StereoFrame, gain = 1): void {
  for (let i = 0; i < dst.l.length; i++) {
    dst.l[i] += src.l[i] * gain
    dst.r[i] += src.r[i] * gain
  }
}

export function gainFrame(frame: StereoFrame, gain: number): void {
  for (let i = 0; i < frame.l.length; i++) {
    frame.l[i] *= gain
    frame.r[i] *= gain
  }
}

export function rms(buf: Float32Array): number {
  if (buf.length === 0) return 0
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

export function frameRms(frame: StereoFrame): number {
  let sum = 0
  for (let i = 0; i < frame.l.length; i++) sum += frame.l[i] * frame.l[i] + frame.r[i] * frame.r[i]
  return Math.sqrt(sum / (frame.l.length * 2))
}

/** Stereo width: RMS of the side (L-R) signal relative to mid. */
export function frameWidth(frame: StereoFrame): number {
  let mid = 0
  let side = 0
  for (let i = 0; i < frame.l.length; i++) {
    const m = (frame.l[i] + frame.r[i]) / 2
    const s = (frame.l[i] - frame.r[i]) / 2
    mid += m * m
    side += s * s
  }
  return Math.sqrt(side / Math.max(1e-12, mid))
}

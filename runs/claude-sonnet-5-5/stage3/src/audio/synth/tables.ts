/**
 * Generated lookup data for the synth: LFO cycles, the hard-sync shaper curves, drive curves, pulse spectra and noise.
 * Everything is deterministic (seeded PRNG) and GENERATED — nothing here is a recording.
 */
import type { AudioBufferLike, AudioContextLike, PeriodicWaveLike } from '../types'
import { mulberry32 } from './arp'

export const LFO_TABLE_LENGTH = 2048
/** Sample & Hold cycle length in steps: one table cycle contains this many held values */
export const SH_STEPS = 8
/** largest hard-sync ratio the curve can express */
export const SYNC_MAX_RATIO = 8
export const SYNC_CURVE_LENGTH = 16384
/** Osc Ctrl 0..1 → synced-oscillator ratio 1..1+SYNC_RATIO_SPAN */
export const SYNC_RATIO_SPAN = 6

const frac = (x: number) => x - Math.floor(x)

/** value of LFO waveform `wave` (0 Triangle, 1 Saw down, 2 Saw up, 3 Square, 4 Sample & Hold) at phase p ∈ [0,1) */
export function lfoValue(wave: number, p: number, held: readonly number[]): number {
  switch (wave) {
    case 0:
      return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4
    case 1:
      return 1 - 2 * p
    case 2:
      return 2 * p - 1
    case 3:
      return p < 0.5 ? 1 : -1
    default:
      return held[Math.min(held.length - 1, Math.floor(p * held.length))]
  }
}

/** the fixed pseudo-random sequence the Sample & Hold LFO steps through (identical on every run) */
export const SH_VALUES: readonly number[] = (() => {
  const next = mulberry32(0x53484c)
  return Array.from({ length: SH_STEPS }, () => next() * 2 - 1)
})()

/** hard-sync shaper curve over inputs v ∈ [-1,1]: y = wave(frac(R·|v|)) */
export function syncCurve(kind: 'saw' | 'square'): Float32Array {
  const c = new Float32Array(SYNC_CURVE_LENGTH)
  for (let i = 0; i < c.length; i++) {
    const v = Math.abs((2 * i) / (c.length - 1) - 1)
    const ph = frac(SYNC_MAX_RATIO * v)
    c[i] = kind === 'saw' ? 2 * ph - 1 : ph < 0.5 ? 1 : -1
  }
  return c
}

/** Drive Off/1/2/3 → soft-clip curve (tanh) normalised to keep ±1 at ±1; level 0 is the identity line */
export const DRIVE_K: readonly number[] = [0, 2.5, 5, 10]
export function driveShape(level: number): Float32Array {
  const k = DRIVE_K[Math.min(3, Math.max(0, Math.round(level)))]
  if (k === 0) return new Float32Array([-1, 1])
  const n = 2048
  const c = new Float32Array(n)
  const norm = Math.tanh(k)
  for (let i = 0; i < n; i++) c[i] = Math.tanh((k * ((2 * i) / (n - 1) - 1))) / norm
  return c
}

/** Per-context cache of the buffers and periodic waves the voices share */
export class Tables {
  private readonly lfo = new Map<number, AudioBufferLike>()
  private noiseBuffer: AudioBufferLike | null = null
  private sineBuffer: AudioBufferLike | null = null
  private readonly pulses = new Map<number, PeriodicWaveLike>()
  private readonly curves = new Map<string, Float32Array>()
  constructor(private readonly ctx: AudioContextLike) {}

  private table(fn: (p: number) => number, length = LFO_TABLE_LENGTH): AudioBufferLike {
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = fn(i / length)
    return buffer
  }
  lfoTable(wave: number): AudioBufferLike {
    let b = this.lfo.get(wave)
    if (!b) this.lfo.set(wave, (b = this.table((p) => lfoValue(wave, p, SH_VALUES))))
    return b
  }
  sine(): AudioBufferLike {
    return (this.sineBuffer ??= this.table((p) => Math.sin(2 * Math.PI * p)))
  }
  /** two seconds of seeded white noise (loops) */
  noise(): AudioBufferLike {
    if (!this.noiseBuffer) {
      const next = mulberry32(0x6e6f6973)
      const length = Math.max(2, Math.floor(this.ctx.sampleRate * 2))
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < length; i++) data[i] = next() * 2 - 1
      this.noiseBuffer = buffer
    }
    return this.noiseBuffer
  }
  /** band-limited pulse wave of duty `d` (0..0.5], from its Fourier series; normalised by the engine (peak 1) */
  pulse(duty: number): PeriodicWaveLike {
    let w = this.pulses.get(duty)
    if (!w) {
      const n = 128
      const real = new Float32Array(n)
      const imag = new Float32Array(n)
      // symmetric pulse about phase 0: a_n cos(n·ωt), a_n = 2/(nπ)·sin(nπd)
      for (let k = 1; k < n; k++) real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty)
      w = this.ctx.createPeriodicWave(real, imag)
      this.pulses.set(duty, w)
    }
    return w
  }
  syncCurve(kind: 'saw' | 'square'): Float32Array {
    const key = `sync-${kind}`
    let c = this.curves.get(key)
    if (!c) this.curves.set(key, (c = syncCurve(kind)))
    return c
  }
  drive(level: number): Float32Array {
    const key = `drive-${level}`
    if (!this.curves.has(key)) this.curves.set(key, driveShape(level))
    return this.curves.get(key) as Float32Array
  }
}

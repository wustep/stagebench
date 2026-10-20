// Offline rendering helpers for the sound tests. These run the real instrument and effect code on
// node-web-audio-api's OfflineAudioContext, so the assertions are about rendered samples, not about
// which nodes exist. Tolerant relationships only: no test compares exact waveforms.

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { OfflineAudioContext } from 'node-web-audio-api'
import type { AudioContextLike } from '../audioBoundary'
import type { SampleLoader } from '../sampleLibrary'

export const RENDER_RATE = 44100

export interface Rendered {
  left: Float32Array
  right: Float32Array
  sampleRate: number
}

/** A stereo offline context of the given length. Cast to the app's boundary type at the call site. */
export function offlineContext(seconds: number): OfflineAudioContext {
  return new OfflineAudioContext({ numberOfChannels: 2, length: Math.round(seconds * RENDER_RATE), sampleRate: RENDER_RATE })
}

/**
 * The app's boundary view of an offline context. An offline context is already running, so the app's own
 * resume() is a no-op here, and close() has nothing to release. Only renderWithEvents resumes the context,
 * which keeps suspend and resume paired.
 */
export function asBoundary(context: OfflineAudioContext): AudioContextLike {
  return new Proxy(context, {
    get(target, property) {
      if (property === 'resume' || property === 'close') return () => Promise.resolve()
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as unknown as AudioContextLike
}

/**
 * Renders with actions at given times. Each action runs while the context is suspended at its time,
 * so note-offs and parameter moves land exactly where the test puts them.
 */
export async function renderWithEvents(
  context: OfflineAudioContext,
  events: readonly { time: number; run: () => void }[],
): Promise<Rendered> {
  // Events that share a time run inside one suspension, so the context is suspended and resumed once per time.
  const byTime = new Map<number, (() => void)[]>()
  for (const event of events) {
    if (event.time <= 0) {
      event.run()
      continue
    }
    const actions = byTime.get(event.time) ?? []
    actions.push(event.run)
    byTime.set(event.time, actions)
  }
  // Each suspension is awaited together with the render, so a failed suspend rejects this call instead of
  // surfacing later as an unhandled rejection.
  const suspensions: Promise<void>[] = []
  for (const [time, actions] of byTime) {
    // The suspend promise can resolve a moment before the context reports itself suspended, so wait for that first.
    suspensions.push(
      context
        .suspend(time)
        .then(async () => {
          while (context.state !== 'suspended') await new Promise((resolve) => setTimeout(resolve, 0))
          for (const action of actions) action()
          await context.resume()
        })
        .catch((error: unknown) => {
          throw new Error(`render event at ${time}s failed: ${String(error)}`)
        }),
    )
  }
  const [buffer] = await Promise.all([context.startRendering(), ...suspensions])
  return { left: buffer.getChannelData(0).slice(), right: buffer.getChannelData(1).slice(), sampleRate: buffer.sampleRate }
}

/** Loads bundled sample files from disk, the way the browser fetches them from the built app. */
export function diskSampleLoader(root = resolve(process.cwd(), 'public')): SampleLoader {
  return {
    async fetchBytes(path) {
      const bytes = await readFile(resolve(root, path))
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    },
  }
}

export function mono(rendered: Rendered): Float32Array {
  const out = new Float32Array(rendered.left.length)
  for (let i = 0; i < out.length; i += 1) out[i] = 0.5 * (rendered.left[i] + rendered.right[i])
  return out
}

/** Root-mean-square level over [from, to) in seconds. */
export function rms(data: ArrayLike<number>, sampleRate = RENDER_RATE, from = 0, to = data.length / sampleRate): number {
  const start = Math.max(0, Math.floor(from * sampleRate))
  const end = Math.min(data.length, Math.floor(to * sampleRate))
  if (end <= start) return 0
  let sum = 0
  for (let i = start; i < end; i += 1) sum += data[i] * data[i]
  return Math.sqrt(sum / (end - start))
}

export function peak(data: ArrayLike<number>): number {
  let max = 0
  for (let i = 0; i < data.length; i += 1) max = Math.max(max, Math.abs(data[i]))
  return max
}

/** Amplitude of one frequency within a window, via the Goertzel algorithm. */
export function toneAmplitude(data: ArrayLike<number>, hz: number, sampleRate = RENDER_RATE, from = 0, to = data.length / sampleRate): number {
  const start = Math.floor(from * sampleRate)
  const end = Math.min(data.length, Math.floor(to * sampleRate))
  const coefficient = 2 * Math.cos((2 * Math.PI * hz) / sampleRate)
  let s1 = 0
  let s2 = 0
  for (let i = start; i < end; i += 1) {
    const s0 = data[i] + coefficient * s1 - s2
    s2 = s1
    s1 = s0
  }
  const power = s1 * s1 + s2 * s2 - coefficient * s1 * s2
  return (2 * Math.sqrt(Math.max(0, power))) / Math.max(1, end - start)
}

/** Share of energy above a few kHz, estimated from the first difference. Higher means brighter. */
export function brightness(data: ArrayLike<number>, from = 0, to = data.length): number {
  let diff = 0
  let energy = 0
  for (let i = Math.max(1, from); i < to; i += 1) {
    const d = data[i] - data[i - 1]
    diff += d * d
    energy += data[i] * data[i]
  }
  return energy === 0 ? 0 : diff / energy
}

/** Largest absolute jump between neighbouring samples in a window. Large values mean a click. */
export function largestJump(data: ArrayLike<number>, from = 0, to = data.length): number {
  let max = 0
  for (let i = Math.max(1, from); i < to; i += 1) max = Math.max(max, Math.abs(data[i] - data[i - 1]))
  return max
}

/** Mean absolute difference between two rendered signals over their length. */
export function difference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < n; i += 1) sum += Math.abs(a[i] - b[i])
  return n === 0 ? 0 : sum / n
}

/** Zero-crossing frequency in a window: a rough pitch estimate for monophonic tones. */
export function zeroCrossingHz(data: ArrayLike<number>, sampleRate = RENDER_RATE, from = 0, to = data.length / sampleRate): number {
  const start = Math.floor(from * sampleRate)
  const end = Math.min(data.length, Math.floor(to * sampleRate))
  let crossings = 0
  for (let i = start + 1; i < end; i += 1) {
    if ((data[i - 1] < 0) !== (data[i] < 0)) crossings += 1
  }
  return (crossings / 2) / Math.max(1e-9, (end - start) / sampleRate)
}

/**
 * Ratio of energy above and below 1.5 kHz, from a one-pole split. Rises when the treble is boosted
 * and falls when it is dampened; the piano's energy sits mostly below 2 kHz, so the split is there.
 */
export function trebleRatio(data: ArrayLike<number>, sampleRate = RENDER_RATE, from = 0, to = data.length / sampleRate): number {
  const start = Math.floor(from * sampleRate)
  const end = Math.min(data.length, Math.floor(to * sampleRate))
  const alpha = 1 - Math.exp((-2 * Math.PI * 1500) / sampleRate)
  let low = 0
  let lowEnergy = 0
  let highEnergy = 0
  for (let i = start; i < end; i += 1) {
    low += alpha * (data[i] - low)
    const high = data[i] - low
    lowEnergy += low * low
    highEnergy += high * high
  }
  return lowEnergy === 0 ? 0 : highEnergy / lowEnergy
}

/**
 * Brightness of a harmonic sound: energy in harmonics 6 to 14 relative to harmonics 1 to 3 of f0.
 * It follows what a listener hears as darkness, and it is steadier than a broadband split when the
 * source is a harmonic tone (the split is dominated by a few partials).
 */
export function harmonicTilt(data: ArrayLike<number>, f0: number, from: number, to: number, sampleRate = RENDER_RATE): number {
  let high = 0
  let low = 0
  for (let k = 1; k <= 14; k += 1) {
    const amplitude = toneAmplitude(data, f0 * k, sampleRate, from, to)
    if (k <= 3) low += amplitude * amplitude
    if (k >= 6) high += amplitude * amplitude
  }
  return Math.sqrt(high) / Math.max(1e-12, Math.sqrt(low))
}

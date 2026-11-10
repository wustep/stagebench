import { PianoKernel, type KernelOptions } from '../../src/audio/dsp/kernel'

/** Measurement helpers. Tests compare relationships between renders, never exact waveforms. */

export const SR = 48000

export function makeKernel(options: Partial<KernelOptions> = {}): PianoKernel {
  return new PianoKernel({ sampleRate: SR, ...options })
}

export interface Stereo {
  left: Float32Array
  right: Float32Array
}

export function render(kernel: PianoKernel, seconds: number): Stereo {
  const frames = Math.round((seconds * kernel.sampleRate) / 128) * 128
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (let offset = 0; offset < frames; offset += 128) {
    kernel.process(left.subarray(offset, offset + 128), right.subarray(offset, offset + 128))
  }
  return { left, right }
}

export function rms(buffer: Float32Array, from = 0, to = buffer.length): number {
  let sum = 0
  for (let index = from; index < to; index += 1) sum += buffer[index] * buffer[index]
  return Math.sqrt(sum / Math.max(1, to - from))
}

export function peak(buffer: Float32Array): number {
  let max = 0
  for (const sample of buffer) max = Math.max(max, Math.abs(sample))
  return max
}

export function mono(stereo: Stereo): Float32Array {
  const out = new Float32Array(stereo.left.length)
  for (let index = 0; index < out.length; index += 1) out[index] = (stereo.left[index] + stereo.right[index]) / 2
  return out
}

/** RMS of a window given in seconds. */
export function rmsAt(buffer: Float32Array, startSeconds: number, lengthSeconds: number, sampleRate = SR): number {
  const from = Math.round(startSeconds * sampleRate)
  return rms(buffer, from, Math.min(buffer.length, from + Math.round(lengthSeconds * sampleRate)))
}

/**
 * Brightness proxy: energy of the first difference over energy of the signal.
 * A pure tone at f gives (2·sin(πf/sr))², so more high-frequency content gives a larger number.
 */
export function brightness(buffer: Float32Array): number {
  let signal = 0
  let difference = 0
  for (let index = 1; index < buffer.length; index += 1) {
    const delta = buffer[index] - buffer[index - 1]
    difference += delta * delta
    signal += buffer[index] * buffer[index]
  }
  return difference / Math.max(1e-20, signal)
}

/** Seconds until the short-time level stays below `threshold` (relative to full scale). */
export function timeToSilence(buffer: Float32Array, threshold: number, sampleRate = SR): number {
  const window = 480
  let last = 0
  for (let start = 0; start + window <= buffer.length; start += window) {
    if (rms(buffer, start, start + window) >= threshold) last = start + window
  }
  return last / sampleRate
}

/** Magnitude of one frequency via the Goertzel algorithm. */
export function magnitudeAt(buffer: Float32Array, frequency: number, sampleRate = SR): number {
  const omega = (2 * Math.PI * frequency) / sampleRate
  const coefficient = 2 * Math.cos(omega)
  let s1 = 0
  let s2 = 0
  for (const sample of buffer) {
    const s0 = sample + coefficient * s1 - s2
    s2 = s1
    s1 = s0
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coefficient * s1 * s2)) / (buffer.length / 2)
}

export function equal(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false
  return true
}

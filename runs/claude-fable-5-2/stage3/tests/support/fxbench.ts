import { FxChain } from '../../src/audio/dsp/effects'
import { defaultChain, type ChainSound } from '../../src/audio/dsp/params'
import { SR, type Stereo } from './signal'

/**
 * A bench for the effect units: standard deterministic test signals, and a way to push them
 * through a real FxChain in 128-frame blocks exactly as the kernel does.
 */

export function silence(seconds: number): Stereo {
  const frames = Math.round((seconds * SR) / 128) * 128
  return { left: new Float32Array(frames), right: new Float32Array(frames) }
}

/** White noise from a fixed-seed xorshift generator: the same samples every run. */
export function noise(seconds: number, level = 0.25, seed = 0x1234567): Stereo {
  const out = silence(seconds)
  let state = seed | 1
  for (let i = 0; i < out.left.length; i += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    const value = ((state | 0) / 2147483648) * level
    out.left[i] = value
    out.right[i] = value
  }
  return out
}

export function tone(frequency: number, seconds: number, level = 0.25): Stereo {
  const out = silence(seconds)
  for (let i = 0; i < out.left.length; i += 1) {
    const value = Math.sin((2 * Math.PI * frequency * i) / SR) * level
    out.left[i] = value
    out.right[i] = value
  }
  return out
}

/** A short burst (noise, or a tone when `frequency` is given) followed by silence. */
export function burst(burstSeconds: number, totalSeconds: number, level = 0.25, frequency?: number): Stereo {
  const out = silence(totalSeconds)
  const source = frequency ? tone(frequency, burstSeconds + 0.01, level) : noise(burstSeconds + 0.01, level)
  const frames = Math.round(burstSeconds * SR)
  const ramp = Math.min(96, Math.floor(frames / 4))
  for (let i = 0; i < frames; i += 1) {
    const edge = Math.min(1, i / ramp, (frames - i) / ramp)
    out.left[i] = source.left[i] * edge
    out.right[i] = source.right[i] * edge
  }
  return out
}

export function impulse(totalSeconds: number, level = 0.5): Stereo {
  const out = silence(totalSeconds)
  out.left[0] = level
  out.right[0] = level
  return out
}

/** A sum of signals of the same length. */
export function mix(...signals: Stereo[]): Stereo {
  const out = silence(signals[0].left.length / SR)
  for (const signal of signals) {
    for (let i = 0; i < out.left.length; i += 1) {
      out.left[i] += signal.left[i]
      out.right[i] += signal.right[i]
    }
  }
  return out
}

/** Run a block processor over a copy of `input`, 128 frames at a time. */
export function through(input: Stereo, process: (left: Float32Array, right: Float32Array, frames: number, block: number) => void): Stereo {
  const left = input.left.slice()
  const right = input.right.slice()
  for (let offset = 0, block = 0; offset < left.length; offset += 128, block += 1) {
    process(left.subarray(offset, offset + 128), right.subarray(offset, offset + 128), 128, block)
  }
  return { left, right }
}

/** The default chain with every unit off, then `configure` applied. */
export function chainSound(configure: (chain: ChainSound) => void): ChainSound {
  const chain = defaultChain()
  configure(chain)
  return chain
}

/**
 * Push `input` through a fresh FxChain set up by `configure`.
 *
 * The chain first runs 50 ms of silence, so its units have finished their 12 ms switch-on
 * crossfade and the measurement sees the effect itself, not the act of switching it on.
 */
export function runChain(input: Stereo, configure: (chain: ChainSound) => void, fxOn = true): Stereo {
  const chain = new FxChain(SR)
  chain.configure(chainSound(configure))
  through(silence(0.05), (left, right, frames) => chain.process(left, right, frames, fxOn))
  return through(input, (left, right, frames) => chain.process(left, right, frames, fxOn))
}

/** Energy in a band, by summing Goertzel magnitudes on a log-spaced grid. */
export function bandLevel(buffer: Float32Array, lowHz: number, highHz: number, points = 12): number {
  let sum = 0
  for (let k = 0; k < points; k += 1) {
    const frequency = lowHz * Math.pow(highHz / lowHz, (k + 0.5) / points)
    const omega = (2 * Math.PI * frequency) / SR
    const coefficient = 2 * Math.cos(omega)
    let s1 = 0
    let s2 = 0
    for (const sample of buffer) {
      const s0 = sample + coefficient * s1 - s2
      s2 = s1
      s1 = s0
    }
    sum += Math.max(0, s1 * s1 + s2 * s2 - coefficient * s1 * s2)
  }
  return Math.sqrt(sum / points) / (buffer.length / 2)
}

/** Short-time RMS envelope with the given window in seconds. */
export function envelope(buffer: Float32Array, windowSeconds = 0.01): Float32Array {
  const window = Math.max(1, Math.round(windowSeconds * SR))
  const out = new Float32Array(Math.floor(buffer.length / window))
  for (let k = 0; k < out.length; k += 1) {
    let sum = 0
    for (let i = k * window; i < (k + 1) * window; i += 1) sum += buffer[i] * buffer[i]
    out[k] = Math.sqrt(sum / window)
  }
  return out
}

export function db(ratio: number): number {
  return 20 * Math.log10(Math.max(1e-12, ratio))
}

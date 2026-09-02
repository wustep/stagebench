/**
 * Offline mirror of the runtime voice path (same renderer, same release constants) so tests can
 * prove audible relationships on real sample data without a browser: velocity moves level, sustain
 * and release change duration, distinct notes render distinctly.
 */
import { RELEASE_SECONDS } from './engine'
import { renderPianoNote } from './pianoRenderer'

export interface OfflineEvent {
  time: number
  type: 'on' | 'off' | 'sustain'
  midi?: number
  velocity?: number
  on?: boolean
}

export interface OfflineOptions {
  sampleRate?: number
  seconds?: number
  releaseSeconds?: number
}

const GAIN_FLOOR = 0.0005

export function renderPerformance(events: OfflineEvent[], options: OfflineOptions = {}): Float32Array {
  const sampleRate = options.sampleRate ?? 22050
  const seconds = options.seconds ?? 3
  const releaseSeconds = options.releaseSeconds ?? RELEASE_SECONDS
  const out = new Float32Array(Math.round(seconds * sampleRate))
  const sorted = [...events].sort((a, b) => a.time - b.time)
  interface V {
    midi: number
    start: number
    data: Float32Array
    keyDown: boolean
    sustained: boolean
    releaseAt: number | null
  }
  const voices: V[] = []
  let sustain = false
  const release = (v: V, t: number) => {
    if (v.releaseAt === null) v.releaseAt = t
  }
  for (const e of sorted) {
    if (e.type === 'on' && e.midi !== undefined) {
      for (const v of voices) if (v.midi === e.midi && v.releaseAt === null) release(v, e.time)
      voices.push({ midi: e.midi, start: e.time, data: renderPianoNote({ midi: e.midi, velocity: e.velocity ?? 100, sampleRate, maxSeconds: seconds }), keyDown: true, sustained: false, releaseAt: null })
    } else if (e.type === 'off' && e.midi !== undefined) {
      for (const v of voices) {
        if (v.midi === e.midi && v.keyDown) {
          v.keyDown = false
          if (sustain) v.sustained = true
          else release(v, e.time)
        }
      }
    } else if (e.type === 'sustain') {
      sustain = !!e.on
      if (!sustain) for (const v of voices) if (v.sustained && !v.keyDown) release(v, e.time)
    }
  }
  for (const v of voices) {
    const startSample = Math.round(v.start * sampleRate)
    const relSample = v.releaseAt === null ? Infinity : Math.round((v.releaseAt - v.start) * sampleRate)
    const relLen = Math.round(releaseSeconds * sampleRate)
    for (let i = 0; i < v.data.length; i++) {
      const o = startSample + i
      if (o >= out.length) break
      let g = 1
      if (i >= relSample) {
        const k = i - relSample
        if (k >= relLen) break
        g = Math.pow(GAIN_FLOOR, k / relLen) // exponential ramp 1 -> floor, like the runtime gain node
      }
      out[o] += v.data[i] * g
    }
  }
  return out
}

/** Length (in seconds) of the audible part of a buffer above a threshold. */
export function audibleSeconds(buffer: Float32Array, sampleRate: number, threshold = 0.002): number {
  let last = -1
  for (let i = 0; i < buffer.length; i++) if (Math.abs(buffer[i]) > threshold) last = i
  return last < 0 ? 0 : (last + 1) / sampleRate
}

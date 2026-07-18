import type { AudioBackend } from './engine'
import { renderVoiceBuffer, synthSample } from './voice'

interface FakeVoice {
  handle: number
  note: number
  velocity: number
  startTime: number
  releaseTime: number | null
  stopped: boolean
  stopTime: number | null
}

/**
 * Deterministic in-memory backend for tests.
 *
 * Instead of Web Audio nodes it keeps a voice list and can render the mix of
 * all owned voices to a buffer on demand. Tests assert tolerant signal
 * relationships (louder vs softer, longer vs shorter, silence vs not) rather
 * than exact waveforms.
 */
export class FakeAudioBackend implements AudioBackend {
  readonly sampleRate = 8000
  private clock = 0
  private nextHandle = 1
  private voices: FakeVoice[] = []
  /** Counters proving node/timer/listener hygiene. */
  startCount = 0
  stopCount = 0

  now(): number {
    return this.clock
  }

  /** Test hook: advance the fake clock (seconds). */
  advance(seconds: number) {
    this.clock += seconds
  }

  startVoice(note: number, velocity: number): number {
    const handle = this.nextHandle++
    this.voices.push({ handle, note, velocity, startTime: this.clock, releaseTime: null, stopped: false, stopTime: null })
    this.startCount++
    return handle
  }

  releaseVoice(handle: number): void {
    const v = this.voices.find((x) => x.handle === handle)
    if (v && v.releaseTime === null) v.releaseTime = this.clock
  }

  stopVoice(handle: number): void {
    const v = this.voices.find((x) => x.handle === handle)
    if (v && !v.stopped) {
      v.stopped = true
      v.stopTime = this.clock
      this.stopCount++
    }
  }

  activeVoiceCount(): number {
    return this.voices.filter((v) => !v.stopped).length
  }

  dispose(): void {
    for (const v of this.voices) {
      if (!v.stopped) {
        v.stopped = true
        v.stopTime = this.clock
      }
    }
  }

  /** Live (not stopped) voices, for assertions. */
  liveVoices(): readonly FakeVoice[] {
    return this.voices.filter((v) => !v.stopped)
  }

  /**
   * Render the mixed output of all voices that sound anywhere in the window
   * [startOffset, startOffset+seconds] relative to the current clock.
   */
  renderMix(seconds: number, startOffset = 0): Float32Array {
    const n = Math.floor(seconds * this.sampleRate)
    const out = new Float32Array(n)
    for (const v of this.voices) {
      for (let i = 0; i < n; i++) {
        const t = this.clock + startOffset + i / this.sampleRate
        const local = t - v.startTime
        if (local < 0) continue
        if (v.stopped && v.stopTime !== null && t > v.stopTime + 0.02) continue
        out[i] += synthSample({ note: v.note, velocity: v.velocity, startTime: 0, releaseTime: v.releaseTime === null ? null : v.releaseTime - v.startTime }, local)
      }
    }
    return out
  }

  /** Render a single note in isolation (for velocity/sustain comparisons). */
  renderNote(note: number, velocity: number, seconds: number, releaseAt: number | null = null): Float32Array {
    return renderVoiceBuffer({ note, velocity, startTime: 0, releaseTime: releaseAt }, seconds, this.sampleRate)
  }
}

/** RMS of a buffer — the tolerant loudness relationship used by tests. */
export function rms(buf: Float32Array): number {
  if (buf.length === 0) return 0
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

/** Energy (sum of squares) in a window of a buffer. */
export function windowEnergy(buf: Float32Array, from: number, to: number): number {
  let sum = 0
  const a = Math.max(0, from)
  const b = Math.min(buf.length, to)
  for (let i = a; i < b; i++) sum += buf[i] * buf[i]
  return sum
}

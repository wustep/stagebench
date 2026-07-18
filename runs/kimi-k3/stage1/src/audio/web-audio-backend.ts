import type { AudioBackend } from './engine'
import { renderVoiceBuffer, RELEASE_SECONDS } from './voice'

interface RealVoice {
  handle: number
  source: AudioBufferSourceNode
  gain: GainNode
  stopTimer: ReturnType<typeof setTimeout> | null
  stopped: boolean
}

const RENDER_SECONDS = 8 // full ring-out length of a synthesized note

/**
 * Real-time backend: renders each synthesized voice into an AudioBuffer once
 * (deterministic), then schedules it through a per-voice gain into a master
 * gain. Nothing bypasses the master path.
 */
export class WebAudioBackend implements AudioBackend {
  private ctx: AudioContext
  private master: GainNode
  private voices = new Map<number, RealVoice>()
  private nextHandle = 1
  private bufferCache = new Map<string, AudioBuffer>()

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.9
    this.master.connect(ctx.destination)
  }

  now(): number {
    return this.ctx.currentTime
  }

  startVoice(note: number, velocity: number): number {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    const handle = this.nextHandle++
    const buffer = this.bufferFor(note, velocity)
    const source = this.ctx.createBufferSource()
    source.buffer = buffer
    const gain = this.ctx.createGain()
    gain.gain.value = 1
    source.connect(gain)
    gain.connect(this.master)
    source.start()
    this.voices.set(handle, { handle, source, gain, stopTimer: null, stopped: false })
    source.onended = () => {
      const v = this.voices.get(handle)
      if (v) this.teardown(v)
    }
    return handle
  }

  releaseVoice(handle: number): void {
    // The rendered buffer already decays naturally; for a held note we
    // re-render with a release envelope at "now".
    const v = this.voices.get(handle)
    if (!v || v.stopped) return
    // Gentle gain ramp down over the release time, then stop.
    const t = this.ctx.currentTime
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setValueAtTime(v.gain.gain.value, t)
    v.gain.gain.linearRampToValueAtTime(0, t + RELEASE_SECONDS)
    this.scheduleStop(v, RELEASE_SECONDS + 0.05)
  }

  stopVoice(handle: number): void {
    const v = this.voices.get(handle)
    if (!v || v.stopped) return
    const t = this.ctx.currentTime
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setValueAtTime(v.gain.gain.value, t)
    v.gain.gain.linearRampToValueAtTime(0, t + 0.02)
    this.scheduleStop(v, 0.03)
  }

  activeVoiceCount(): number {
    return this.voices.size
  }

  dispose(): void {
    for (const v of this.voices.values()) this.teardown(v)
    void this.ctx.close().catch(() => undefined)
  }

  private bufferFor(note: number, velocity: number): AudioBuffer {
    const key = `${note}:${Math.round(velocity * 127)}`
    let buf = this.bufferCache.get(key)
    if (!buf) {
      const sr = this.ctx.sampleRate
      const data = renderVoiceBuffer({ note, velocity, startTime: 0, releaseTime: null }, RENDER_SECONDS, sr)
      buf = this.ctx.createBuffer(1, data.length, sr)
      buf.copyToChannel(new Float32Array(data) as Float32Array<ArrayBuffer>, 0)
      this.bufferCache.set(key, buf)
    }
    return buf
  }

  private scheduleStop(v: RealVoice, delay: number) {
    if (v.stopTimer) clearTimeout(v.stopTimer)
    v.stopTimer = setTimeout(() => this.teardown(v), delay * 1000)
  }

  private teardown(v: RealVoice) {
    if (v.stopped) return
    v.stopped = true
    if (v.stopTimer) clearTimeout(v.stopTimer)
    try {
      v.source.stop()
    } catch {
      // already stopped
    }
    v.source.disconnect()
    v.gain.disconnect()
    this.voices.delete(v.handle)
  }
}

/** Factory that returns null when Web Audio is unavailable (the honest fallback path). */
export function createWebAudioBackend(): WebAudioBackend | null {
  try {
    const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined
    if (!Ctor) return null
    return new WebAudioBackend(new Ctor())
  } catch {
    return null
  }
}

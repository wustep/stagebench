/**
 * Injectable audio and timer boundaries. Production uses the browser;
 * tests pass an OfflineAudioContext (node-web-audio-api) and manual timers.
 */

export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): void
  linearRampToValueAtTime(value: number, time: number): void
  exponentialRampToValueAtTime(value: number, time: number): void
  cancelScheduledValues(time: number): void
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike | AudioParamLike, output?: number, input?: number): void
  disconnect(): void
  channelCount?: number
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType | string
  frequency: AudioParamLike
  start(when?: number): void
  stop(when?: number): void
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType | string
  frequency: AudioParamLike
  Q: AudioParamLike
  gain: AudioParamLike
}

export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  playbackRate: AudioParamLike
  loop: boolean
  start(when?: number, offset?: number): void
  stop(when?: number): void
}

export interface DelayNodeLike extends AudioNodeLike {
  delayTime: AudioParamLike
}

export interface WaveShaperNodeLike extends AudioNodeLike {
  curve: Float32Array | null
}

export interface ConvolverNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  pan: AudioParamLike
}

export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  threshold: AudioParamLike
  knee: AudioParamLike
  ratio: AudioParamLike
  attack: AudioParamLike
  release: AudioParamLike
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly sampleRate: number
  readonly destination: AudioNodeLike
  readonly state?: string
  resume?: () => Promise<void>
  close?: () => Promise<void>
  createGain(): GainNodeLike
  createOscillator(): OscillatorNodeLike
  createBiquadFilter(): BiquadFilterNodeLike
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike
  createBufferSource(): AudioBufferSourceNodeLike
  createDelay(maxDelayTime?: number): DelayNodeLike
  createWaveShaper(): WaveShaperNodeLike
  createConvolver(): ConvolverNodeLike
  createStereoPanner?: () => StereoPannerNodeLike
  createDynamicsCompressor?: () => DynamicsCompressorNodeLike
  decodeAudioData?: (data: ArrayBuffer) => Promise<AudioBufferLike>
}

export interface TimerBoundary {
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(id: number): void
}

export interface AudioBoundary {
  createContext(): AudioContextLike
  timers: TimerBoundary
}

export function realTimers(): TimerBoundary {
  return {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  }
}

export function realAudioBoundary(): AudioBoundary {
  return {
    createContext() {
      const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) throw new Error('Web Audio is not supported in this browser')
      return new Ctor() as unknown as AudioContextLike
    },
    timers: realTimers(),
  }
}

/** Deterministic timers for tests. Nothing fires until `advance`. */
export class ManualTimers implements TimerBoundary {
  private nowMs = 0
  private nextId = 1
  private tasks: { id: number; at: number; fn: () => void }[] = []

  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId++
    this.tasks.push({ id, at: this.nowMs + ms, fn })
    return id
  }

  clearTimeout(id: number) {
    this.tasks = this.tasks.filter((task) => task.id !== id)
  }

  advance(ms: number) {
    const target = this.nowMs + ms
    for (;;) {
      const due = this.tasks
        .filter((task) => task.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id)
      const next = due[0]
      if (!next) break
      this.tasks = this.tasks.filter((task) => task.id !== next.id)
      this.nowMs = next.at
      next.fn()
    }
    this.nowMs = target
  }
}

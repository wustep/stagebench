// Injectable Web Audio boundary. Instrument and effect code only talks to these minimal shapes, so
// tests can supply a recording fake (no audio at all) or an OfflineAudioContext (real rendering, no device).
// A browser AudioContext satisfies these shapes structurally; nothing here is browser-specific.

export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): void
  linearRampToValueAtTime(value: number, time: number): void
  exponentialRampToValueAtTime(value: number, time: number): void
  setTargetAtTime(target: number, startTime: number, timeConstant: number): void
  cancelScheduledValues(time: number): void
}

export interface AudioNodeLike {
  /** Connects to another node, or to an AudioParam so the node's output modulates that parameter. */
  connect(destination: AudioNodeLike | AudioParamLike): unknown
  disconnect(): void
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike
}

export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle'

/** A custom periodic waveform, built from its Fourier coefficients. */
export interface PeriodicWaveLike {
  readonly __periodicWave: true
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType
  readonly frequency: AudioParamLike
  readonly detune: AudioParamLike
  /** Replaces the waveform; the `type` is ignored while a periodic wave is set. */
  setPeriodicWave(wave: PeriodicWaveLike): void
  start(when?: number): void
  stop(when?: number): void
  onended: (() => void) | null
}

export type BiquadFilterType =
  | 'lowpass'
  | 'highpass'
  | 'bandpass'
  | 'peaking'
  | 'lowshelf'
  | 'highshelf'
  | 'allpass'

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType
  readonly frequency: AudioParamLike
  readonly Q: AudioParamLike
  readonly gain: AudioParamLike
}

export interface DelayNodeLike extends AudioNodeLike {
  readonly delayTime: AudioParamLike
}

export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  readonly threshold: AudioParamLike
  readonly knee: AudioParamLike
  readonly ratio: AudioParamLike
  readonly attack: AudioParamLike
  readonly release: AudioParamLike
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  readonly pan: AudioParamLike
}

export interface WaveShaperNodeLike extends AudioNodeLike {
  curve: Float32Array | null
  oversample: 'none' | '2x' | '4x'
}

export interface AudioBufferLike {
  readonly length: number
  readonly sampleRate: number
  readonly numberOfChannels: number
  readonly duration: number
  getChannelData(channel: number): Float32Array
}

export interface ConvolverNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  loop: boolean
  loopStart: number
  loopEnd: number
  readonly playbackRate: AudioParamLike
  readonly detune: AudioParamLike
  start(when?: number, offset?: number): void
  stop(when?: number): void
  onended: (() => void) | null
}

export interface AudioContextLike {
  readonly state: 'suspended' | 'running' | 'closed'
  readonly currentTime: number
  readonly sampleRate: number
  readonly destination: AudioNodeLike
  resume(): Promise<void>
  close(): Promise<void>
  createGain(): GainNodeLike
  createOscillator(): OscillatorNodeLike
  createPeriodicWave(real: Float32Array, imag: Float32Array): PeriodicWaveLike
  createBiquadFilter(): BiquadFilterNodeLike
  createDelay(maxDelayTime: number): DelayNodeLike
  createDynamicsCompressor(): DynamicsCompressorNodeLike
  createStereoPanner(): StereoPannerNodeLike
  createWaveShaper(): WaveShaperNodeLike
  createConvolver(): ConvolverNodeLike
  createBufferSource(): AudioBufferSourceNodeLike
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>
}

/** Creates an audio context. Throws when Web Audio is unavailable. */
export type AudioContextFactory = () => AudioContextLike

export function createBrowserAudioContext(): AudioContextLike {
  const globals = globalThis as unknown as {
    AudioContext?: new () => AudioContextLike
    webkitAudioContext?: new () => AudioContextLike
  }
  const Constructor = globals.AudioContext ?? globals.webkitAudioContext
  if (!Constructor) {
    throw new Error('Web Audio is not available in this browser')
  }
  return new Constructor()
}

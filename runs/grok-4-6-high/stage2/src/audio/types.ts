export type AudioStatus = 'loading' | 'ready' | 'error' | 'fallback'

export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): void
  linearRampToValueAtTime(value: number, time: number): void
  exponentialRampToValueAtTime(value: number, time: number): void
  cancelScheduledValues(time: number): void
  getValueAtTime?(time: number): number
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike | AudioParamLike): AudioNodeLike | AudioParamLike
  disconnect(): void
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType | string
  frequency: AudioParamLike
  start(time?: number): void
  stop(time?: number): void
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType | string
  frequency: AudioParamLike
  Q: AudioParamLike
  gain: AudioParamLike
}

export interface DelayNodeLike extends AudioNodeLike {
  delayTime: AudioParamLike
}

export interface WaveShaperNodeLike extends AudioNodeLike {
  curve: Float32Array | null
  oversample: string
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  pan: AudioParamLike
}

export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  threshold: AudioParamLike
  ratio: AudioParamLike
  attack: AudioParamLike
  release: AudioParamLike
  knee: AudioParamLike
}

export interface AudioBufferLike {
  sampleRate: number
  length: number
  numberOfChannels: number
  getChannelData(channel: number): Float32Array
  copyToChannel?(source: Float32Array, channel: number): void
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  playbackRate: AudioParamLike
  loop: boolean
  loopStart: number
  loopEnd: number
  start(time?: number, offset?: number): void
  stop(time?: number): void
}

export interface AudioContextLike {
  sampleRate: number
  currentTime: number
  destination: AudioNodeLike
  state: string
  createOscillator(): OscillatorNodeLike
  createGain(): GainNodeLike
  createBiquadFilter(): BiquadFilterNodeLike
  createDelay(maxDelayTime?: number): DelayNodeLike
  createWaveShaper(): WaveShaperNodeLike
  createStereoPanner(): StereoPannerNodeLike
  createDynamicsCompressor(): DynamicsCompressorNodeLike
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike
  createBufferSource(): AudioBufferSourceNodeLike
  resume(): Promise<void>
  close(): Promise<void>
  startRendering?(): Promise<AudioBufferLike>
}

export type AudioContextFactory = (options?: {
  offline?: boolean
  durationSec?: number
  sampleRate?: number
}) => AudioContextLike

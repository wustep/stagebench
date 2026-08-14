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
  connect(destination: AudioNodeLike): AudioNodeLike
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
}

export interface AudioBufferLike {
  sampleRate: number
  length: number
  numberOfChannels: number
  getChannelData(channel: number): Float32Array
}

export interface AudioContextLike {
  sampleRate: number
  currentTime: number
  destination: AudioNodeLike
  state: string
  createOscillator(): OscillatorNodeLike
  createGain(): GainNodeLike
  createBiquadFilter(): BiquadFilterNodeLike
  resume(): Promise<void>
  close(): Promise<void>
  startRendering?(): Promise<AudioBufferLike>
}

export type AudioContextFactory = (options?: {
  offline?: boolean
  durationSec?: number
  sampleRate?: number
}) => AudioContextLike

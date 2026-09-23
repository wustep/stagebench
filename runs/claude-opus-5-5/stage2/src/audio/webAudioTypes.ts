// The subset of Web Audio this app uses. The browser's AudioContext satisfies it; tests
// provide a sample-accurate simulator (src/testing/simAudio.ts) with the same shape.

export interface ParamLike {
  value: number
  setValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
  setTargetAtTime(target: number, time: number, timeConstant: number): unknown
  cancelScheduledValues(time: number): unknown
  cancelAndHoldAtTime?(time: number): unknown
}

export interface NodeLike {
  connect(destination: NodeLike): unknown
  /** Audio-rate modulation: a node's output is added to a parameter's intrinsic value. */
  connect(destination: ParamLike): unknown
  disconnect(): void
}

export interface GainLike extends NodeLike {
  readonly gain: ParamLike
}

export interface BiquadLike extends NodeLike {
  type: string
  readonly frequency: ParamLike
  readonly Q: ParamLike
  readonly gain: ParamLike
}

export interface DelayLike extends NodeLike {
  readonly delayTime: ParamLike
}

export interface WaveShaperLike extends NodeLike {
  curve: Float32Array | null
}

export interface StereoPannerLike extends NodeLike {
  readonly pan: ParamLike
}

export interface CompressorLike extends NodeLike {
  readonly threshold: ParamLike
  readonly knee: ParamLike
  readonly ratio: ParamLike
  readonly attack: ParamLike
  readonly release: ParamLike
  readonly reduction: number
}

export interface ScheduledSourceLike extends NodeLike {
  onended: (() => void) | null
  start(when?: number): void
  stop(when?: number): void
}

export interface BufferLike {
  readonly length: number
  readonly sampleRate: number
  readonly duration: number
  readonly numberOfChannels: number
  getChannelData(channel: number): Float32Array
}

export interface ConvolverLike extends NodeLike {
  normalize: boolean
  buffer: BufferLike | null
}

export interface BufferSourceLike extends ScheduledSourceLike {
  buffer: BufferLike | null
  readonly playbackRate: ParamLike
}

export interface OscillatorLike extends ScheduledSourceLike {
  type: string
  readonly frequency: ParamLike
}

export type WritableBuffer = BufferLike & { copyToChannel(source: Float32Array, channel: number): void }

export interface AudioContextLike {
  readonly currentTime: number
  readonly sampleRate: number
  readonly state: string
  readonly destination: NodeLike
  createGain(): GainLike
  createBiquadFilter(): BiquadLike
  createBufferSource(): BufferSourceLike
  createOscillator(): OscillatorLike
  createDelay(maxDelayTime?: number): DelayLike
  createWaveShaper(): WaveShaperLike
  createStereoPanner(): StereoPannerLike
  createDynamicsCompressor(): CompressorLike
  createConvolver(): ConvolverLike
  createBuffer(channels: number, length: number, sampleRate: number): WritableBuffer
  resume(): Promise<void>
  close(): Promise<void>
}

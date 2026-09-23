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
  disconnect(): void
}

export interface GainLike extends NodeLike {
  readonly gain: ParamLike
}

export interface BiquadLike extends NodeLike {
  type: string
  readonly frequency: ParamLike
  readonly Q: ParamLike
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
  getChannelData(channel: number): Float32Array
}

export interface BufferSourceLike extends ScheduledSourceLike {
  buffer: BufferLike | null
  readonly playbackRate: ParamLike
}

export interface OscillatorLike extends ScheduledSourceLike {
  type: string
  readonly frequency: ParamLike
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly sampleRate: number
  readonly state: string
  readonly destination: NodeLike
  createGain(): GainLike
  createBiquadFilter(): BiquadLike
  createBufferSource(): BufferSourceLike
  createOscillator(): OscillatorLike
  createBuffer(channels: number, length: number, sampleRate: number): BufferLike & { copyToChannel(source: Float32Array, channel: number): void }
  resume(): Promise<void>
  close(): Promise<void>
}

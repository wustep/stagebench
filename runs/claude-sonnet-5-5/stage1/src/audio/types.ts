/** Minimal structural types for the Web Audio surface we use, so tests can inject fakes. */

export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
  cancelScheduledValues(time: number): unknown
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown
  disconnect(): void
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike
}

export interface AudioBufferLike {
  readonly length: number
  readonly sampleRate: number
  getChannelData(channel: number): Float32Array
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  onended: (() => void) | null
  start(when?: number): void
  stop(when?: number): void
}

export interface OscillatorLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  onended: (() => void) | null
  start(when?: number): void
  stop(when?: number): void
}

export interface CompressorLike extends AudioNodeLike {
  threshold: AudioParamLike
  knee: AudioParamLike
  ratio: AudioParamLike
  attack: AudioParamLike
  release: AudioParamLike
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly sampleRate: number
  readonly state: string
  readonly destination: AudioNodeLike
  onstatechange: (() => void) | null
  resume(): Promise<void>
  close(): Promise<void>
  createGain(): GainNodeLike
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike
  createBufferSource(): BufferSourceLike
  createOscillator(): OscillatorLike
  createDynamicsCompressor(): CompressorLike
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(id: number): void
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type AnyListener = (event: any) => void

export interface EventTargetLike {
  addEventListener(type: string, listener: AnyListener, options?: unknown): void
  removeEventListener(type: string, listener: AnyListener, options?: unknown): void
}

export type AudioPhase = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'

export interface AudioStatus {
  phase: AudioPhase
  message: string
}

/** Receives voice commands from the note lifecycle. */
export interface VoiceSink {
  onVoiceEnded: ((voiceId: number) => void) | null
  start(voiceId: number, note: number, velocity: number): void
  /** natural (damper) release */
  release(voiceId: number): void
  /** fast fade used for stolen voices and all-notes-off */
  steal(voiceId: number): void
  /** stop and free everything immediately */
  dispose(): void
}

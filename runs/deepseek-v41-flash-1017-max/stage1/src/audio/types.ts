/**
 * Audio boundary.
 *
 * The browser backend and the test doubles implement the same interface, so the note
 * lifecycle can be exercised deterministically with no AudioContext, no devices and no
 * real output. `createEngine` is injected by `App`, never reached for globally.
 */
export type AudioStatus = 'idle' | 'loading' | 'ready' | 'suspended' | 'error' | 'fallback'

export interface AudioStatusReport {
  status: AudioStatus
  /** Human-readable, shown verbatim in the Program display. */
  detail: string
}

export interface VoiceHandle {
  /** Stable id owned by the note session. */
  id: string
  midi: number
  velocity: number
}

export interface AudioEngine {
  readonly kind: 'webaudio' | 'silent'
  status(): AudioStatusReport
  /** Resumes/creates the context. Resolves once the engine can accept notes. */
  start(): Promise<AudioStatusReport>
  noteOn(voice: VoiceHandle): void
  /** Schedules the release ramp and the source stop for this voice. */
  noteOff(voiceId: string): void
  /** Immediate silence: every owned voice is stopped and dropped. */
  stopAll(): void
  /** Voices the engine still owns (scheduled but not ended). */
  activeVoiceCount(): number
  /** Nodes created minus nodes that have ended/been disconnected. Zero after cleanup. */
  liveNodeCount(): number
  subscribe(listener: (report: AudioStatusReport) => void): () => void
  dispose(): void
}

/**
 * The minimal slice of Web Audio this project uses. Declaring it explicitly keeps the
 * boundary injectable and makes the fake in tests small and honest.
 */
export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
  setValueCurveAtTime(values: Float32Array, time: number, duration: number): unknown
  cancelScheduledValues(time: number): unknown
}

export interface AudioNodeLike {
  connect(target: AudioNodeLike): unknown
  disconnect(): unknown
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  loop: boolean
  onended: ((event?: unknown) => void) | null
  start(when?: number): void
  stop(when?: number): void
}

export interface AudioBufferLike {
  duration: number
  length: number
  numberOfChannels: number
  sampleRate: number
  getChannelData(channel: number): Float32Array
}

export interface AudioContextLike {
  readonly sampleRate: number
  readonly currentTime: number
  readonly state: 'suspended' | 'running' | 'closed' | 'interrupted' | string
  readonly destination: AudioNodeLike
  resume(): Promise<void>
  suspend?(): Promise<void>
  close?(): Promise<void>
  createGain(): GainNodeLike
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike
  createBufferSource(): BufferSourceLike
}

export type AudioContextFactory = () => AudioContextLike

/** Minimal structural types for the Web Audio surface we use, so tests can inject fakes or an offline renderer. */

export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, time: number): unknown
  linearRampToValueAtTime(value: number, time: number): unknown
  cancelScheduledValues(time: number): unknown
  /** exponential approach to `target` (envelope decays and glides) */
  setTargetAtTime(target: number, time: number, timeConstant: number): unknown
  exponentialRampToValueAtTime(value: number, time: number): unknown
}

export interface AudioNodeLike {
  /** node → node, or node → AudioParam (modulation) */
  connect(destination: AudioNodeLike | AudioParamLike, output?: number, input?: number): unknown
  disconnect(): void
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike
}

export interface AudioBufferLike {
  readonly length: number
  readonly sampleRate: number
  readonly duration?: number
  readonly numberOfChannels?: number
  getChannelData(channel: number): Float32Array
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  playbackRate?: AudioParamLike
  detune?: AudioParamLike
  loop?: boolean
  onended: (() => void) | null
  start(when?: number, offset?: number): void
  stop(when?: number): void
}

/** opaque periodic wave made by `createPeriodicWave` */
export interface PeriodicWaveLike {
  readonly __periodicWave?: never
}

export interface OscillatorLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  detune?: AudioParamLike
  onended: (() => void) | null
  start(when?: number): void
  stop(when?: number): void
  /** switch to a custom harmonic spectrum (type becomes 'custom') */
  setPeriodicWave(wave: PeriodicWaveLike): void
}

export interface ConstantSourceLike extends AudioNodeLike {
  offset: AudioParamLike
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
  readonly reduction?: number
}

export interface BiquadLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  Q: AudioParamLike
  gain: AudioParamLike
}

export interface DelayLike extends AudioNodeLike {
  delayTime: AudioParamLike
}

export interface StereoPannerLike extends AudioNodeLike {
  pan: AudioParamLike
}

export interface WaveShaperLike extends AudioNodeLike {
  curve: Float32Array | null
  oversample: string
}

export interface ConvolverLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  normalize: boolean
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
  createBiquadFilter(): BiquadLike
  createDelay(maxDelayTime?: number): DelayLike
  createStereoPanner(): StereoPannerLike
  createWaveShaper(): WaveShaperLike
  createConvolver(): ConvolverLike
  createChannelMerger(inputs?: number): AudioNodeLike
  createConstantSource(): ConstantSourceLike
  /** `real`/`imag`: cosine and sine coefficients, index 0 is DC and unused; set `disableNormalization` to keep the given levels */
  createPeriodicWave(real: Float32Array, imag: Float32Array, constraints?: { disableNormalization?: boolean }): PeriodicWaveLike
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(id: number): void
}

/** Loads the bytes of one bundled sample file (relative URL). Injectable so tests never touch the network. */
export type SampleLoader = (url: string) => Promise<ArrayBuffer>

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

/** Which layer a voice belongs to and how the played key maps onto it. */
export interface VoiceTarget {
  layer: string
  /** semitones added to the played key (octave shift) */
  transpose: number
  /** damper pedal was down when the key was struck (drives string resonance) */
  pedal?: boolean
  /** linear zone-crossfade gain (0..1] scaling the whole voice; 1 when absent */
  gain?: number
}

/** Receives voice commands from the note lifecycle. */
export interface VoiceSink {
  onVoiceEnded: ((voiceId: number) => void) | null
  start(voiceId: number, note: number, velocity: number, target?: VoiceTarget): void
  /** natural (damper) release */
  release(voiceId: number): void
  /** fast fade used for stolen voices and all-notes-off */
  steal(voiceId: number): void
  /** Panic: silence every voice the sink owns, including latched or arpeggiated ones the lifecycle does not track */
  panic?(): void
  /** stop and free everything immediately */
  dispose(): void
}

/** Decides which layers a key press reaches and whether each honours the sustain pedal. */
export interface LayerRouter {
  targets(note: number): VoiceTarget[]
  sustPed(layer: string): boolean
  /** layers that can currently sound at all (enabled layers of enabled sections), regardless of zones */
  active?(): string[]
}

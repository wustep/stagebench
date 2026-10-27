/**
 * Audio boundary.
 *
 * The browser backend and the test doubles implement the same interface, so the note
 * lifecycle can be exercised deterministically with no devices and no real output.
 * `createContext` is injected by `App`, never reached for globally.
 *
 * Phase 2 keeps the Phase 1 contract (`noteOn` / `noteOff` / `stopAll` / `subscribe`)
 * and adds the layer-scoped, effect-aware surface the two new sections need. Nothing
 * here exposes a Web Audio type: the boundary stays a small description of behaviour.
 */
export type AudioStatus = 'idle' | 'loading' | 'ready' | 'suspended' | 'error' | 'fallback'

export interface AudioStatusReport {
  status: AudioStatus
  /** Human-readable, shown verbatim in the Program display. */
  detail: string
}

/** The two piano layers plus the section ids an effect chain can belong to. */
export type LayerId = 'piano.a' | 'piano.b'
export type ChainOwner = 'piano.a' | 'piano.b'

export type PianoTypeId = 'grand' | 'upright' | 'electric' | 'clav' | 'digital' | 'misc'
export type PianoModelId =
  | 'grand.salamander'
  | 'grand.studio'
  | 'upright.ivy'
  | 'electric.wurlitzer'
  | 'electric.cp80'
  | 'clav.modelled'
  | 'digital.modelled'
  | 'misc.modelled'

/** Everything that shapes one note beyond its pitch and velocity. */
export interface VoiceSettings {
  /** 0..1 normalized velocity. */
  velocity: number
  layer: LayerId
  /** Octave shift in semitones (-12, 0, +12). */
  octave: number
  /** Resolved piano model for this layer. */
  model: PianoModelId
  /** KB Touch exponent applied before the model. */
  touchExponent: number
  /** 0 = off, 1..3 (manual p. 25). */
  dynComp: number
  /** Timbre index into the type's option list. */
  timbre: number
  /** 0 = off, 1..3 (manual p. 26). */
  unison: number
  softRelease: boolean
  stringRes: boolean
}

export interface VoiceHandle {
  /** Stable id owned by the note session. */
  id: string
  midi: number
  velocity: number
  /** Phase 2: which chain the voice belongs to and how it should sound. */
  settings?: VoiceSettings
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
  exponentialRampToValueAtTime?(value: number, time: number): unknown
  setTargetAtTime?(target: number, startTime: number, timeConstant: number): unknown
  setValueCurveAtTime(values: Float32Array, time: number, duration: number): unknown
  cancelScheduledValues(time: number): unknown
}

export interface AudioNodeLike {
  /**
   * Web Audio allows connecting a node either to another node or to an `AudioParam`
   * (that is how every LFO and envelope is wired), so the target is the union.
   * A second argument selects the output / input index, which channel splitting needs.
   */
  connect(target: AudioNodeLike | AudioParamLike, output?: number, input?: number): unknown
  disconnect(): unknown
}

export interface GainNodeLike extends AudioNodeLike {
  gain: AudioParamLike
}

export interface BufferSourceLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  loop: boolean
  /** Playback rate, used for the <= 1.5 semitone pitch shift between sample roots. */
  playbackRate?: AudioParamLike
  detune?: AudioParamLike
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
  /**
   * Phase 2 graph nodes. Optional so the Phase 1 fake and any minimal backend still
   * satisfy the interface; the effect graph checks for them and reports an honest
   * fallback rather than pretending an effect is processing.
   */
  createBiquadFilter?: () => BiquadFilterLike
  createDelay?: (maxDelaySeconds?: number) => DelayLike
  createConvolver?: () => ConvolverLike
  createDynamicsCompressor?: () => CompressorLike
  createStereoPanner?: () => StereoPannerLike
  createOscillator?: () => OscillatorLike
  createWaveShaper?: () => WaveShaperLike
  createChannelSplitter?: (channels: number) => AudioNodeLike
  createChannelMerger?: (channels: number) => AudioNodeLike
  createAnalyser?: () => AudioNodeLike
  /** Decode a bundled sample file. Resolves with the platform's buffer. */
  decodeAudioData?: (data: ArrayBuffer) => Promise<AudioBufferLike>
}

export interface BiquadFilterLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  Q: AudioParamLike
  gain: AudioParamLike
  detune?: AudioParamLike
}

export interface DelayLike extends AudioNodeLike {
  delayTime: AudioParamLike
}

export interface ConvolverLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  normalize?: boolean
}

export interface CompressorLike extends AudioNodeLike {
  threshold: AudioParamLike
  knee: AudioParamLike
  ratio: AudioParamLike
  attack: AudioParamLike
  release: AudioParamLike
}

export interface StereoPannerLike extends AudioNodeLike {
  pan: AudioParamLike
}

export interface OscillatorLike extends AudioNodeLike {
  type: string
  frequency: AudioParamLike
  detune?: AudioParamLike
  start(when?: number): void
  stop(when?: number): void
  onended: ((event?: unknown) => void) | null
}

export interface WaveShaperLike extends AudioNodeLike {
  curve: Float32Array | null
  oversample?: string
}

export type AudioContextFactory = () => AudioContextLike

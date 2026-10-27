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

/**
 * Layers and effect chain owners.
 *
 * Phase 3 adds Organ and Synth, so a layer is no longer always a piano layer. Organ A and
 * Organ B share **one** effect chain (`chainInstancesPerProgram: 6` in
 * `specs/nord-stage-4.effects.json`), which is why `ChainOwner` and `LayerId` are separate:
 * two organ layers, one `organ` chain.
 */
export type PianoLayerId = 'piano.a' | 'piano.b'
export type OrganLayerId = 'organ.a' | 'organ.b'
export type SynthLayerId = 'synth.a' | 'synth.b' | 'synth.c'

/** Every layer the keybed can sound. */
export type LayerId = PianoLayerId | OrganLayerId | SynthLayerId
/** Every effect chain instance: Piano A, Piano B, the shared Organ chain, Synth A/B/C. */
export type ChainOwner = PianoLayerId | 'organ' | SynthLayerId
/** The three sound engines. */
export type EngineId = 'piano' | 'organ' | 'synth'

export const PIANO_LAYERS: readonly PianoLayerId[] = ['piano.a', 'piano.b']
export const ORGAN_LAYERS: readonly OrganLayerId[] = ['organ.a', 'organ.b']
export const SYNTH_LAYERS: readonly SynthLayerId[] = ['synth.a', 'synth.b', 'synth.c']
export const ALL_LAYERS: readonly LayerId[] = [...PIANO_LAYERS, ...ORGAN_LAYERS, ...SYNTH_LAYERS]
export const CHAIN_OWNERS: readonly ChainOwner[] = ['piano.a', 'piano.b', 'organ', 'synth.a', 'synth.b', 'synth.c']

/** Which chain a layer plays through. Both organ layers share one. */
export function chainOwnerFor(layer: LayerId): ChainOwner {
  if (layer === 'organ.a' || layer === 'organ.b') return 'organ'
  return layer
}

/** Which engine a layer belongs to. */
export function engineFor(layer: LayerId): EngineId {
  if (layer.startsWith('organ')) return 'organ'
  if (layer.startsWith('synth')) return 'synth'
  return 'piano'
}

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
  /**
   * Which layer this voice belongs to. Optional so the Phase 1/2 callers that only pass
   * `settings` keep working; when absent the engine resolves it from `settings.layer`,
   * defaulting to Piano A.
   */
  layer?: LayerId
  /** Phase 2: which chain the voice belongs to and how it should sound. */
  settings?: VoiceSettings
  /** Organ-specific payload, present when the voice's layer is an organ layer. */
  organSettings?: OrganVoiceRequest
  /** Synth-specific payload, present when the voice's layer is a synth layer. */
  synthSettings?: SynthVoiceRequest
}

/**
 * The organ part of a voice request.
 *
 * The engine reads the drawbar registration and model from `OrganState`, so the request only
 * carries what differs *per voice*: the shared vibrato setting, the percussion single-trigger
 * rule, and the split zone's gain.
 */
export interface OrganVoiceRequest {
  vibratoOn: boolean
  vibratoType: 'C1' | 'C2' | 'C3' | 'V1' | 'V2' | 'V3'
  percussion: { on: boolean; soft: boolean; fast: boolean; third: boolean; poly: boolean }
  keyClick: boolean
  zoneGain: number
}

/**
 * The synth part of a voice request.
 *
 * The layer configuration is read from `SynthState`; this carries the per-voice timing and
 * modulation inputs the renderer needs (hold and release lengths, glide source, mod wheel,
 * resolved LFO rate, and an optional arp gate).
 */
export interface SynthVoiceRequest {
  holdSeconds: number
  releaseSeconds: number
  glideFrom: number | null
  modWheel: number
  lfoRateHz: number
  zoneGain: number
  arpGate?: { times: number[]; gateSeconds: number; hardness: number } | null
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

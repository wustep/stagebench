export type TimerHandle = number | { readonly _opaqueTimer?: never }

export interface Clock {
  now(): number
  setTimeout(callback: () => void, delayMs: number): TimerHandle
  clearTimeout(id: TimerHandle): void
}

export const browserClock: Clock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms) as unknown as TimerHandle,
  clearTimeout: (id) => globalThis.clearTimeout(id as unknown as number),
}
export interface MidiMessageEventLike {
  readonly data: Uint8Array | null
}

export interface MidiInputLike {
  readonly id: string
  readonly name?: string | null
  readonly state?: string
  onmidimessage: ((event: MidiMessageEventLike) => void) | null
}

export interface MidiAccessLike {
  readonly inputs: Iterable<MidiInputLike> | { values(): IterableIterator<MidiInputLike> }
  onstatechange: ((event?: unknown) => void) | null
}

export interface MidiProvider {
  isSupported(): boolean
  requestAccess(): Promise<MidiAccessLike>
}

export const browserMidiProvider: MidiProvider = {
  isSupported: () =>
    typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function',
  requestAccess: async () => {
    if (typeof navigator === 'undefined' || typeof navigator.requestMIDIAccess !== 'function') {
      throw new Error('Web MIDI API is not supported in this browser.')
    }
    const access = await navigator.requestMIDIAccess({ sysex: false })
    return access as unknown as MidiAccessLike
  },
}

export type SampleFetcher = (url: string) => Promise<ArrayBuffer>

export const browserSampleFetcher: SampleFetcher = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch sample ${url}: HTTP ${response.status}`)
  }
  return response.arrayBuffer()
}

export interface AudioBufferLike {
  readonly duration: number
  readonly length: number
  readonly numberOfChannels: number
  readonly sampleRate: number
}

export interface AudioParamLike {
  value: number
  setValueAtTime(value: number, startTime: number): AudioParamLike
  linearRampToValueAtTime(value: number, endTime: number): AudioParamLike
  exponentialRampToValueAtTime(value: number, endTime: number): AudioParamLike
  setTargetAtTime(target: number, startTime: number, timeConstant: number): AudioParamLike
  cancelScheduledValues(cancelTime: number): AudioParamLike
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): AudioNodeLike | void
  disconnect(): void
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: BiquadFilterType
  readonly frequency: AudioParamLike
  readonly Q: AudioParamLike
}

export interface DynamicsCompressorNodeLike extends AudioNodeLike {
  readonly threshold: AudioParamLike
  readonly knee: AudioParamLike
  readonly ratio: AudioParamLike
  readonly attack: AudioParamLike
  readonly release: AudioParamLike
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: OscillatorType
  readonly frequency: AudioParamLike
  readonly detune: AudioParamLike
  onended: (() => void) | null
  start(when?: number): void
  stop(when?: number): void
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null
  readonly playbackRate: AudioParamLike
  onended: (() => void) | null
  start(when?: number, offset?: number, duration?: number): void
  stop(when?: number): void
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly state: AudioContextState
  readonly sampleRate: number
  readonly destination: AudioNodeLike
  resume(): Promise<void>
  close(): Promise<void>
  createGain(): GainNodeLike
  createBiquadFilter(): BiquadFilterNodeLike
  createDynamicsCompressor(): DynamicsCompressorNodeLike
  createOscillator(): OscillatorNodeLike
  createBufferSource(): AudioBufferSourceNodeLike
  decodeAudioData(audioData: ArrayBuffer): Promise<AudioBufferLike>
}

export type AudioContextFactory = () => AudioContextLike | null

interface WebkitAudioWindow {
  readonly webkitAudioContext?: typeof AudioContext
}

export const browserAudioContextFactory: AudioContextFactory = () => {
  if (typeof window === 'undefined') return null
  const webkitCtor =
    'webkitAudioContext' in window ? (window as WebkitAudioWindow).webkitAudioContext : undefined
  const Ctor = window.AudioContext || webkitCtor
  if (!Ctor) return null
  return new Ctor() as unknown as AudioContextLike
}

export type PianoAudioStatus = 'idle' | 'loading' | 'ready' | 'fallback' | 'error'

export interface PianoEngineStatusSnapshot {
  readonly status: PianoAudioStatus
  readonly loadedSamples: number
  readonly totalSamples: number
  readonly usingFallback: boolean
  readonly message: string
  readonly audioContextState: AudioContextState | 'unavailable'
}

export interface PianoVoiceBackend {
  unlock(): Promise<void>
  triggerNote(voiceId: number, midi: number, velocity: number): void
  releaseNote(voiceId: number, fastSteal?: boolean): void
  stopAllImmediate(): void
  getActiveNodeCount(): number
  getStatus(): PianoEngineStatusSnapshot
  subscribeStatus(listener: (status: PianoEngineStatusSnapshot) => void): () => void
  dispose(): void
}
